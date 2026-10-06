import { Hono } from 'hono';
import { z } from 'zod';
import { loadManagedEvent, requireStaff } from '../auth.ts';
import type { AnnouncementAudience, RegistrationStatus } from '../db/types.ts';
import { ApiError, extOf, nowIso, readJson, regCtx } from '../http.ts';
import type { AppContext, AppEnv } from '../http.ts';
import { newId } from '../lib/ids.ts';
import { ACTIVE_REGISTRATION_STATUSES, eventPhase } from '../lib/rules.ts';
import { eventAnalytics } from '../services/analytics.ts';
import { certificatesForEvent, issueCertificates, listResults, publishResults, revokeCertificate, saveResults } from '../services/certificates.ts';
import { documentsForRegistrations, readDocumentFile, reviewDocument } from '../services/documents.ts';
import { audit, notifyUsers } from '../services/notifications.ts';
import { effectivePayment } from '../services/payments.ts';
import { addRegistrationByOrganizer, removeRegistrationByOrganizer } from '../services/registrations.ts';

/**
 * Running an event (blueprint §5): participants, manual add/remove, documents,
 * volunteers, the overview and analytics, announcements, and after the event
 * results, certificates and the recap. Every route is scoped to staff who
 * manage the event's organization. (Door check-in is in routes/checkin.ts.)
 */
export const operationsRoutes = new Hono<AppEnv>();

operationsRoutes.use('*', async (c, next) => {
  requireStaff(c);
  await next();
});

const managedEvent = (c: AppContext) => loadManagedEvent(c.get('deps').db, requireStaff(c), c.req.param('id')!);

// ---------- Participants ----------

operationsRoutes.get('/events/:id/registrations', async c => {
  const event = await managedEvent(c);
  const { db } = c.get('deps');
  // Blueprint §9.2: organizers see only what they need to run the event.
  const rows = await db
    .selectFrom('registrations')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .leftJoin('check_ins', 'check_ins.registration_id', 'registrations.id')
    .leftJoin('feedback', 'feedback.registration_id', 'registrations.id')
    .leftJoin('teams', 'teams.id', 'registrations.team_id')
    .select([
      'registrations.id',
      'registrations.registration_code as code',
      'registrations.status',
      'registrations.source',
      'registrations.created_at as createdAt',
      'registrations.cancelled_at as cancelledAt',
      'registrations.cancel_reason as cancelReason',
      'registrations.phone',
      'registrations.answers',
      'users.name',
      'users.university_id as universityId',
      'users.email',
      'users.department',
      'users.year',
      'check_ins.scanned_at as checkedInAt',
      'check_ins.method as checkInMethod',
      'feedback.rating as feedbackRating',
      'teams.name as teamName',
    ])
    .where('registrations.event_id', '=', event.id)
    .orderBy('registrations.created_at')
    .execute();
  const [documents, payments] = await Promise.all([
    documentsForRegistrations(db, rows.map(r => r.id)),
    rows.length
      ? db.selectFrom('payments').select(['registration_id', 'status', 'amount', 'created_at']).where('registration_id', 'in', rows.map(r => r.id)).execute()
      : Promise.resolve([]),
  ]);
  const lastPayment = new Map<string, { status: string; amount: number }>();
  for (const id of new Set(payments.map(p => p.registration_id))) {
    const p = effectivePayment(payments.filter(x => x.registration_id === id))!;
    lastPayment.set(id, { status: p.status, amount: p.amount });
  }
  return c.json({
    registrations: rows.map(r => ({
      ...r,
      answers: r.answers ? (JSON.parse(r.answers) as Record<string, string>) : null,
      documents: documents.get(r.id) ?? [],
      payment: lastPayment.get(r.id) ?? null,
    })),
  });
});

operationsRoutes.post('/events/:id/registrations', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, z.object({ universityId: z.string().trim().min(3).max(40), reason: z.string().trim().min(3).max(300) }));
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  const { registration, studentName } = await addRegistrationByOrganizer(db, user, event, input, now(), regCtx(c));
  return c.json({ registration: { id: registration.id, code: registration.registration_code, name: studentName } }, 201);
});

operationsRoutes.post('/events/:id/registrations/:registrationId/cancel', async c => {
  const user = requireStaff(c);
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(3).max(300) }));
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  await removeRegistrationByOrganizer(db, user, event, c.req.param('registrationId'), reason, now(), regCtx(c));
  return c.json({ ok: true });
});

// ---------- Documents (§3.3 Document) ----------

operationsRoutes.post('/events/:id/documents/:documentId/review', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, z.object({ approve: z.boolean(), reason: z.string().trim().min(3).max(300).optional() }));
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  const doc = await db
    .selectFrom('registration_documents')
    .innerJoin('registrations', 'registrations.id', 'registration_documents.registration_id')
    .select('registrations.event_id')
    .where('registration_documents.id', '=', c.req.param('documentId'))
    .executeTakeFirst();
  if (!doc || doc.event_id !== event.id) throw new ApiError(404, 'document_not_found', 'Document not found.');
  if (!input.approve && !input.reason) throw new ApiError(400, 'validation_failed', 'Tell the student why the document was not accepted.');
  const decision = input.approve ? ({ approve: true } as const) : ({ approve: false, reason: input.reason! } as const);
  return c.json(await reviewDocument(db, user, c.req.param('documentId'), decision, now(), extOf(c)));
});

operationsRoutes.get('/events/:id/documents/:documentId/file', async c => {
  const event = await managedEvent(c);
  const { db, config } = c.get('deps');
  const file = await readDocumentFile(db, c.req.param('documentId'), config.uploadsDir);
  if (file.organization_id !== event.organization_id) throw new ApiError(404, 'document_not_found', 'Document not found.');
  return c.body(file.bytes, 200, { 'Content-Type': file.mime_type, 'Content-Disposition': `attachment; filename="${file.original_name}"`, 'Cache-Control': 'private, no-store' });
});

// ---------- Check-in volunteers (§2.2) ----------

operationsRoutes.get('/events/:id/volunteers', async c => {
  const event = await managedEvent(c);
  const rows = await c
    .get('deps')
    .db.selectFrom('event_volunteers')
    .innerJoin('users', 'users.id', 'event_volunteers.user_id')
    .select(['users.id', 'users.name', 'users.university_id as universityId', 'event_volunteers.created_at as addedAt'])
    .where('event_volunteers.event_id', '=', event.id)
    .orderBy('users.name')
    .execute();
  return c.json({ volunteers: rows });
});

operationsRoutes.post('/events/:id/volunteers', async c => {
  const user = requireStaff(c);
  const { universityId } = await readJson(c, z.object({ universityId: z.string().trim().min(3).max(40) }));
  const event = await managedEvent(c);
  const { db } = c.get('deps');
  const volunteer = await db.selectFrom('users').select(['id', 'name']).where('university_id', '=', universityId).where('status', '=', 'active').executeTakeFirst();
  if (!volunteer) throw new ApiError(404, 'student_not_found', `No active user with roll number ${universityId}.`);
  const ts = nowIso(c);
  await db
    .insertInto('event_volunteers')
    .values({ event_id: event.id, user_id: volunteer.id, added_by: user.id, created_at: ts })
    .onConflict(oc => oc.columns(['event_id', 'user_id']).doNothing())
    .execute();
  await notifyUsers(db, [volunteer.id], { category: 'announcements', title: `You're on the check-in team: ${event.title}`, body: 'Open Volunteering in the menu to scan passes at the door.', link: `/check-in/${event.id}` }, ts);
  await audit(db, { actorId: user.id, action: 'volunteer.add', entityType: 'event', entityId: event.id, data: { userId: volunteer.id } }, ts);
  return c.json({ volunteer: { id: volunteer.id, name: volunteer.name } }, 201);
});

operationsRoutes.delete('/events/:id/volunteers/:userId', async c => {
  const user = requireStaff(c);
  const event = await managedEvent(c);
  const { db } = c.get('deps');
  await db.deleteFrom('event_volunteers').where('event_id', '=', event.id).where('user_id', '=', c.req.param('userId')).execute();
  await audit(db, { actorId: user.id, action: 'volunteer.remove', entityType: 'event', entityId: event.id, data: { userId: c.req.param('userId') } }, nowIso(c));
  return c.json({ ok: true });
});

// ---------- Event overview (§5) and analytics (V4) ----------

/** Counts timestamps per IST calendar day (portable: no database date functions). */
const perIstDay = (timestamps: string[]) => {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const day = new Date(new Date(ts).getTime() + 330 * 60_000).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
};

operationsRoutes.get('/events/:id/overview', async c => {
  const event = await managedEvent(c);
  const { db } = c.get('deps');
  const [byStatus, feedback, created, announcements, pendingDocs] = await Promise.all([
    db.selectFrom('registrations').select(['status', eb => eb.fn.countAll<number>().as('n')]).where('event_id', '=', event.id).groupBy('status').execute(),
    db
      .selectFrom('feedback')
      .innerJoin('registrations', 'registrations.id', 'feedback.registration_id')
      .select([eb => eb.fn.countAll<number>().as('n'), eb => eb.fn.avg<number>('feedback.rating').as('avg')])
      .where('registrations.event_id', '=', event.id)
      .executeTakeFirstOrThrow(),
    db.selectFrom('registrations').select('created_at').where('event_id', '=', event.id).execute(),
    db.selectFrom('announcements').select(eb => eb.fn.countAll<number>().as('n')).where('event_id', '=', event.id).executeTakeFirstOrThrow(),
    db
      .selectFrom('registration_documents')
      .innerJoin('registrations', 'registrations.id', 'registration_documents.registration_id')
      .select(eb => eb.fn.countAll<number>().as('n'))
      .where('registrations.event_id', '=', event.id)
      .where('registration_documents.status', '=', 'submitted')
      .executeTakeFirstOrThrow(),
  ]);

  const counts = Object.fromEntries(byStatus.map(r => [r.status, Number(r.n)])) as Partial<Record<RegistrationStatus, number>>;
  const get = (s: RegistrationStatus) => counts[s] ?? 0;
  return c.json({
    capacity: event.capacity,
    registered: ACTIVE_REGISTRATION_STATUSES.reduce((sum, s) => sum + get(s), 0),
    confirmed: get('confirmed'),
    pending: get('pending_payment') + get('pending_documents'),
    waitlisted: get('waitlisted') + get('offer_pending'),
    checkedIn: get('checked_in') + get('attended'),
    noShow: get('no_show'),
    cancelled: get('cancelled'),
    feedbackCount: Number(feedback.n),
    averageRating: feedback.avg === null ? null : Math.round(Number(feedback.avg) * 10) / 10,
    documentsToReview: Number(pendingDocs.n),
    registrationsPerDay: perIstDay(created.map(r => r.created_at)),
    announcementsSent: Number(announcements.n),
  });
});

operationsRoutes.get('/events/:id/analytics', async c => {
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  return c.json(await eventAnalytics(db, event, now()));
});

// ---------- Announcements (§5 Communication) ----------

const AUDIENCE_STATUSES: Record<AnnouncementAudience, RegistrationStatus[]> = {
  all: [...ACTIVE_REGISTRATION_STATUSES],
  checked_in: ['checked_in', 'attended'],
  not_checked_in: ['confirmed', 'no_show'],
};

operationsRoutes.get('/events/:id/announcements', async c => {
  const event = await managedEvent(c);
  const rows = await c
    .get('deps')
    .db.selectFrom('announcements')
    .innerJoin('users', 'users.id', 'announcements.author_id')
    .select([
      'announcements.id',
      'announcements.audience',
      'announcements.title',
      'announcements.body',
      'announcements.recipient_count as recipientCount',
      'announcements.created_at as createdAt',
      'users.name as authorName',
    ])
    .where('announcements.event_id', '=', event.id)
    .orderBy('announcements.created_at', 'desc')
    .execute();
  return c.json({ announcements: rows });
});

operationsRoutes.post('/events/:id/announcements', async c => {
  const user = requireStaff(c);
  const input = await readJson(
    c,
    z.object({
      audience: z.enum(['all', 'checked_in', 'not_checked_in']),
      title: z.string().trim().min(3).max(120),
      body: z.string().trim().min(3).max(2000),
    })
  );
  const event = await managedEvent(c);
  if (event.status !== 'published') throw new ApiError(409, 'not_published', 'Announcements can only be sent for published events.');
  const { db } = c.get('deps');
  const ts = nowIso(c);

  const id = newId();
  const recipientCount = await db.transaction().execute(async trx => {
    const recipients = await trx
      .selectFrom('registrations')
      .select('user_id')
      .where('event_id', '=', event.id)
      .where('status', 'in', AUDIENCE_STATUSES[input.audience])
      .execute();
    if (recipients.length === 0) throw new ApiError(409, 'no_recipients', 'Nobody matches this audience yet.');
    await trx
      .insertInto('announcements')
      .values({ id, event_id: event.id, audience: input.audience, title: input.title, body: input.body, author_id: user.id, recipient_count: recipients.length, created_at: ts })
      .execute();
    await notifyUsers(
      trx,
      recipients.map(r => r.user_id),
      { category: 'announcements', title: `${event.title}: ${input.title}`, body: input.body, link: `/event/${event.id}` },
      ts,
      { external: extOf(c) }
    );
    await audit(trx, { actorId: user.id, action: 'announcement.send', entityType: 'event', entityId: event.id, data: { announcementId: id, audience: input.audience } }, ts);
    return recipients.length;
  });
  return c.json({ announcement: { id, recipientCount } }, 201);
});

// ---------- After the event: results, certificates, recap (§5, §7.1) ----------

operationsRoutes.get('/events/:id/results', async c => {
  const event = await managedEvent(c);
  const { db } = c.get('deps');
  const [results, teams] = await Promise.all([
    listResults(db, event.id),
    db.selectFrom('teams').select(['id', 'name', 'status']).where('event_id', '=', event.id).where('status', '<>', 'disbanded').orderBy('name').execute(),
  ]);
  return c.json({ results, published: event.results_published_at !== null, teams });
});

operationsRoutes.put('/events/:id/results', async c => {
  const user = requireStaff(c);
  const { results } = await readJson(
    c,
    z.object({
      results: z
        .array(z.object({ position: z.number().int().min(1).max(100), title: z.string().trim().min(2).max(80), registrationId: z.string().optional(), teamId: z.string().optional() }))
        .max(50),
    })
  );
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  await saveResults(db, user, event, results, now());
  return c.json({ results: await listResults(db, event.id) });
});

operationsRoutes.post('/events/:id/results/publish', async c => {
  const user = requireStaff(c);
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  return c.json(await publishResults(db, user, event, now(), extOf(c)));
});

operationsRoutes.get('/events/:id/certificates', async c => {
  const event = await managedEvent(c);
  return c.json({ certificates: await certificatesForEvent(c.get('deps').db, event.id) });
});

operationsRoutes.post('/events/:id/certificates/issue', async c => {
  const user = requireStaff(c);
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  return c.json({ issued: await issueCertificates(db, user, event, now(), extOf(c)) });
});

operationsRoutes.post('/events/:id/certificates/:certificateId/revoke', async c => {
  const user = requireStaff(c);
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(3).max(300) }));
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  const cert = await db
    .selectFrom('certificates')
    .innerJoin('registrations', 'registrations.id', 'certificates.registration_id')
    .select('registrations.event_id')
    .where('certificates.id', '=', c.req.param('certificateId'))
    .executeTakeFirst();
  if (!cert || cert.event_id !== event.id) throw new ApiError(404, 'certificate_not_found', 'Certificate not found.');
  await revokeCertificate(db, user, c.req.param('certificateId'), reason, now());
  return c.json({ ok: true });
});

/** Recap text and photos, shown on the event page after it ends (blueprint §4.4 "results/gallery"). */
operationsRoutes.put('/events/:id/recap', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, z.object({ recap: z.string().trim().max(5000).nullable(), gallery: z.array(z.url().max(500)).max(24) }));
  const event = await managedEvent(c);
  const { db, now } = c.get('deps');
  if (event.status !== 'published' || eventPhase(event, now()) !== 'completed') {
    throw new ApiError(409, 'event_not_finished', 'A recap can be added once the event has ended.');
  }
  const ts = nowIso(c);
  await db.updateTable('events').set({ recap: input.recap || null, gallery: JSON.stringify(input.gallery), updated_at: ts }).where('id', '=', event.id).execute();
  await audit(db, { actorId: user.id, action: 'event.recap', entityType: 'event', entityId: event.id }, ts);
  return c.json({ ok: true });
});
