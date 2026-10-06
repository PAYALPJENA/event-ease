import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { ApiError, nowIso, readJson, regCtx } from '../http.ts';
import type { AppEnv } from '../http.ts';
import { hashToken, newId } from '../lib/ids.ts';
import { createPassToken } from '../lib/pass.ts';
import { PHONE_REGEX, UPCOMING_REGISTRATION_STATUSES, eventPhase } from '../lib/rules.ts';
import { certificatesForUser } from '../services/certificates.ts';
import { documentsForRegistrations, readDocumentFile, uploadDocument } from '../services/documents.ts';
import { PUBLIC_EVENT_STATUSES, eventQuery, toEventDto } from '../services/events.ts';
import { waitlistPosition } from '../services/lifecycle.ts';
import { CHANNELS, CRITICAL_CATEGORIES, NOTIFICATION_CATEGORIES, defaultEnabled } from '../services/notifications.ts';
import { effectivePayment, startPayment } from '../services/payments.ts';
import { preferencesFor, recommendFor } from '../services/recommendations.ts';
import { acceptOffer, cancelRegistration, toRegistrationSummary } from '../services/registrations.ts';

export const meRoutes = new Hono<AppEnv>();

meRoutes.use('*', async (c, next) => {
  requireUser(c);
  await next();
});

// ---------- Registrations ----------

meRoutes.get('/registrations', async c => {
  const user = requireUser(c);
  const { db, now } = c.get('deps');
  const registrations = await db
    .selectFrom('registrations')
    .leftJoin('feedback', 'feedback.registration_id', 'registrations.id')
    .leftJoin('check_ins', 'check_ins.registration_id', 'registrations.id')
    .selectAll('registrations')
    .select(['feedback.id as feedback_id', 'check_ins.scanned_at as checked_in_at'])
    .where('registrations.user_id', '=', user.id)
    .orderBy('registrations.created_at', 'desc')
    .execute();

  const eventIds = [...new Set(registrations.map(r => r.event_id))];
  const [events, certificates] = await Promise.all([
    eventIds.length ? eventQuery(db).where('events.id', 'in', eventIds).execute() : [],
    db.selectFrom('certificates').select('registration_id').where('registration_id', 'in', registrations.length ? registrations.map(r => r.id) : ['__none__']).where('revoked_at', 'is', null).execute(),
  ]);
  const current = now();
  const byId = new Map(events.map(e => [e.id, toEventDto(e, current)]));
  const withCertificate = new Set(certificates.map(c2 => c2.registration_id));

  return c.json({
    registrations: await Promise.all(
      registrations.map(async r => ({
        ...toRegistrationSummary(r),
        hasFeedback: r.feedback_id !== null,
        hasCertificate: withCertificate.has(r.id),
        waitlistPosition: await waitlistPosition(db, r),
        event: byId.get(r.event_id)!,
      }))
    ),
  });
});

meRoutes.get('/registrations/:id', async c => {
  const user = requireUser(c);
  const { db, config, now } = c.get('deps');
  const r = await db
    .selectFrom('registrations')
    .leftJoin('check_ins', 'check_ins.registration_id', 'registrations.id')
    .selectAll('registrations')
    .select('check_ins.scanned_at as checked_in_at')
    .where('registrations.id', '=', c.req.param('id'))
    .where('registrations.user_id', '=', user.id)
    .executeTakeFirst();
  if (!r) throw new ApiError(404, 'registration_not_found', 'Registration not found.');

  const [event, documents, payment, team] = await Promise.all([
    eventQuery(db).where('events.id', '=', r.event_id).executeTakeFirstOrThrow(),
    documentsForRegistrations(db, [r.id]),
    db.selectFrom('payments').select(['status', 'amount', 'gateway_order_id', 'paid_at', 'refunded_at', 'created_at']).where('registration_id', '=', r.id).execute().then(effectivePayment),
    r.team_id ? db.selectFrom('teams').selectAll().where('id', '=', r.team_id).executeTakeFirst() : undefined,
  ]);
  const members = team
    ? await db
        .selectFrom('registrations')
        .innerJoin('users', 'users.id', 'registrations.user_id')
        .select(['users.id', 'users.name'])
        .where('registrations.team_id', '=', team.id)
        .where('registrations.status', 'not in', ['cancelled', 'waitlist_expired'])
        .orderBy('registrations.created_at')
        .execute()
    : [];
  const certificates = (await certificatesForUser(db, user.id)).filter(cert => cert.event.id === r.event_id);

  return c.json({
    registration: {
      ...toRegistrationSummary(r),
      event: toEventDto(event, now()),
      // Only a registration for an upcoming or running event has a pass; cancelled ones never do.
      passToken: (UPCOMING_REGISTRATION_STATUSES as readonly string[]).includes(r.status) ? createPassToken(r.id, r.event_id, config.passSecret) : null,
      waitlistPosition: await waitlistPosition(db, r),
      documents: documents.get(r.id) ?? [],
      payment: payment
        ? { status: payment.status, amount: payment.amount, orderId: payment.gateway_order_id, paidAt: payment.paid_at, refundedAt: payment.refunded_at }
        : null,
      team: team
        ? {
            id: team.id,
            name: team.name,
            status: team.status,
            // The invite code lets others join, so only members see it.
            inviteCode: team.invite_code,
            isLeader: team.leader_id === user.id,
            members: members.map(m => ({ name: m.name, isLeader: m.id === team.leader_id })),
          }
        : null,
      certificates,
    },
  });
});

meRoutes.post('/registrations/:id/cancel', async c => {
  const user = requireUser(c);
  const { db, now } = c.get('deps');
  await cancelRegistration(db, user, c.req.param('id'), now(), regCtx(c));
  return c.json({ ok: true });
});

meRoutes.post('/registrations/:id/accept-offer', async c => {
  const user = requireUser(c);
  const { db, now, gateway } = c.get('deps');
  const reg = await acceptOffer(db, user, c.req.param('id'), now(), regCtx(c));
  const payment = reg.status === 'pending_payment' ? await startPayment(db, gateway, reg.id, now()) : null;
  return c.json({ registration: toRegistrationSummary(reg), payment });
});

/** Opens a new payment order, e.g. after a failed attempt, while the seat is still held. */
meRoutes.post('/registrations/:id/payment', async c => {
  const user = requireUser(c);
  const { db, now, gateway } = c.get('deps');
  const reg = await db.selectFrom('registrations').select(['id', 'user_id', 'status']).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!reg || reg.user_id !== user.id) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
  const payment = await startPayment(db, gateway, reg.id, now());
  if (!payment) throw new ApiError(409, 'payment_not_needed', 'This registration isn’t waiting for payment.');
  return c.json({ payment });
});

// ---------- Documents ----------

meRoutes.post('/registrations/:id/documents', async c => {
  const user = requireUser(c);
  const input = await readJson(
    c,
    z.object({
      requirementId: z.string().min(1).max(60),
      fileName: z.string().trim().min(1).max(200),
      // Base64 of at most 2 MB (the service checks the decoded size and the file type).
      dataBase64: z.string().min(4).max(2_900_000),
    })
  );
  const { db, now, config } = c.get('deps');
  return c.json({ document: await uploadDocument(db, user, c.req.param('id'), input, config.uploadsDir, now()) }, 201);
});

meRoutes.get('/documents/:id/file', async c => {
  const user = requireUser(c);
  const { db, config } = c.get('deps');
  const file = await readDocumentFile(db, c.req.param('id'), config.uploadsDir);
  if (file.user_id !== user.id) throw new ApiError(404, 'document_not_found', 'Document not found.');
  return c.body(file.bytes, 200, { 'Content-Type': file.mime_type, 'Content-Disposition': `attachment; filename="${file.original_name}"`, 'Cache-Control': 'private, no-store' });
});

// ---------- Feedback (blueprint §5 dimensions) ----------

const stars = z.number().int().min(1).max(5);
const feedbackSchema = z.object({
  rating: stars,
  comment: z.string().trim().min(1, 'Please tell us a little about your experience.').max(2000),
  content: stars.optional(),
  speaker: stars.optional(),
  organization: stars.optional(),
  venue: stars.optional(),
  registrationExperience: stars.optional(),
  wouldAttendAgain: z.boolean().optional(),
});

meRoutes.post('/registrations/:id/feedback', async c => {
  const user = requireUser(c);
  const body = await readJson(c, feedbackSchema);
  const { db, now } = c.get('deps');

  const row = await db
    .selectFrom('registrations')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select(['registrations.id', 'registrations.status', 'registrations.user_id', 'events.starts_at', 'events.ends_at'])
    .where('registrations.id', '=', c.req.param('id'))
    .executeTakeFirst();

  if (!row || row.user_id !== user.id) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
  // Blueprint §8.3 #4: only attended registrations can be rated. A checked-in
  // registration counts as attended once the event has ended, even if the
  // end-of-event job hasn't run yet.
  if (eventPhase(row, now()) !== 'completed') {
    if (row.status === 'cancelled') throw new ApiError(409, 'not_attended', 'Only events you attended can be rated.');
    throw new ApiError(409, 'event_not_finished', 'You can rate this event after it ends.');
  }
  if (row.status !== 'attended' && row.status !== 'checked_in') {
    throw new ApiError(409, 'not_attended', 'Only events you checked in at can be rated.');
  }

  try {
    await db
      .insertInto('feedback')
      .values({
        id: newId(),
        registration_id: row.id,
        rating: body.rating,
        comment: body.comment,
        created_at: nowIso(c),
        content_rating: body.content ?? null,
        speaker_rating: body.speaker ?? null,
        organization_rating: body.organization ?? null,
        venue_rating: body.venue ?? null,
        registration_rating: body.registrationExperience ?? null,
        would_attend_again: body.wouldAttendAgain === undefined ? null : body.wouldAttendAgain ? 1 : 0,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new ApiError(409, 'feedback_exists', 'You have already rated this event.');
    }
    throw err;
  }
  return c.json({ ok: true }, 201);
});

// ---------- Saved events and opportunities ----------

meRoutes.get('/saved', async c => {
  const user = requireUser(c);
  const rows = await c.get('deps').db.selectFrom('saved_events').select('event_id').where('user_id', '=', user.id).execute();
  return c.json({ eventIds: rows.map(r => r.event_id) });
});

meRoutes.put('/saved/:eventId', async c => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const eventId = c.req.param('eventId');
  const event = await db.selectFrom('events').select('id').where('id', '=', eventId).where('status', 'in', PUBLIC_EVENT_STATUSES).executeTakeFirst();
  if (!event) throw new ApiError(404, 'event_not_found', 'This event does not exist.');

  await db
    .insertInto('saved_events')
    .values({ user_id: user.id, event_id: eventId, created_at: nowIso(c) })
    .onConflict(oc => oc.columns(['user_id', 'event_id']).doNothing())
    .execute();
  return c.json({ ok: true });
});

meRoutes.delete('/saved/:eventId', async c => {
  const user = requireUser(c);
  await c.get('deps').db.deleteFrom('saved_events').where('user_id', '=', user.id).where('event_id', '=', c.req.param('eventId')).execute();
  return c.json({ ok: true });
});

meRoutes.get('/saved-opportunities', async c => {
  const user = requireUser(c);
  const rows = await c.get('deps').db.selectFrom('saved_opportunities').select('opportunity_id').where('user_id', '=', user.id).execute();
  return c.json({ opportunityIds: rows.map(r => r.opportunity_id) });
});

meRoutes.put('/saved-opportunities/:id', async c => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const opp = await db.selectFrom('opportunities').select('id').where('id', '=', c.req.param('id')).where('status', '=', 'published').executeTakeFirst();
  if (!opp) throw new ApiError(404, 'opportunity_not_found', 'This opportunity does not exist.');
  await db
    .insertInto('saved_opportunities')
    .values({ user_id: user.id, opportunity_id: opp.id, created_at: nowIso(c) })
    .onConflict(oc => oc.columns(['user_id', 'opportunity_id']).doNothing())
    .execute();
  return c.json({ ok: true });
});

meRoutes.delete('/saved-opportunities/:id', async c => {
  const user = requireUser(c);
  await c.get('deps').db.deleteFrom('saved_opportunities').where('user_id', '=', user.id).where('opportunity_id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

// ---------- Clubs you follow (blueprint §4.11) ----------

meRoutes.get('/follows', async c => {
  const user = requireUser(c);
  const rows = await c.get('deps').db.selectFrom('follows').select('organization_id').where('user_id', '=', user.id).execute();
  return c.json({ organizationIds: rows.map(r => r.organization_id) });
});

meRoutes.put('/follows/:organizationId', async c => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const org = await db.selectFrom('organizations').select('id').where('id', '=', c.req.param('organizationId')).where('status', '=', 'active').executeTakeFirst();
  if (!org) throw new ApiError(404, 'organization_not_found', 'This club does not exist.');
  await db
    .insertInto('follows')
    .values({ user_id: user.id, organization_id: org.id, created_at: nowIso(c) })
    .onConflict(oc => oc.columns(['user_id', 'organization_id']).doNothing())
    .execute();
  return c.json({ ok: true });
});

meRoutes.delete('/follows/:organizationId', async c => {
  const user = requireUser(c);
  await c.get('deps').db.deleteFrom('follows').where('user_id', '=', user.id).where('organization_id', '=', c.req.param('organizationId')).execute();
  return c.json({ ok: true });
});

// ---------- Certificates (blueprint §4.13) ----------

meRoutes.get('/certificates', async c => {
  const user = requireUser(c);
  return c.json({ certificates: await certificatesForUser(c.get('deps').db, user.id) });
});

// ---------- Interests and recommendations (V4, blueprint §4.1, §7.5) ----------

meRoutes.get('/preferences', async c => {
  const user = requireUser(c);
  return c.json(await preferencesFor(c.get('deps').db, user.id));
});

meRoutes.put('/preferences', async c => {
  const user = requireUser(c);
  const input = await readJson(c, z.object({ interests: z.array(z.string().min(1).max(60)).max(30), personalizationEnabled: z.boolean() }));
  const { db } = c.get('deps');
  const known = await db.selectFrom('categories').select('id').execute();
  const interests = input.interests.filter(id => known.some(k => k.id === id));
  const row = { interests: JSON.stringify(interests), personalization_enabled: input.personalizationEnabled ? 1 : 0, updated_at: nowIso(c) };
  await db
    .insertInto('user_preferences')
    .values({ user_id: user.id, ...row })
    .onConflict(oc => oc.column('user_id').doUpdateSet(row))
    .execute();
  return c.json({ interests, personalizationEnabled: input.personalizationEnabled });
});

meRoutes.get('/recommendations', async c => {
  const user = requireUser(c);
  const { db, now } = c.get('deps');
  return c.json(await recommendFor(db, user, now()));
});

// ---------- Notifications ----------

meRoutes.get('/notifications', async c => {
  const user = requireUser(c);
  const rows = await c.get('deps').db.selectFrom('notifications').selectAll().where('user_id', '=', user.id).orderBy('created_at', 'desc').limit(50).execute();
  return c.json({
    notifications: rows.map(n => ({
      id: n.id,
      category: n.category,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      read: n.read_at !== null,
    })),
    unreadCount: rows.filter(n => n.read_at === null).length,
  });
});

meRoutes.post('/notifications/read-all', async c => {
  const user = requireUser(c);
  await c.get('deps').db.updateTable('notifications').set({ read_at: nowIso(c) }).where('user_id', '=', user.id).where('read_at', 'is', null).execute();
  return c.json({ ok: true });
});

/** Category × channel matrix (blueprint §4.10). Critical categories are always on. */
meRoutes.get('/notification-preferences', async c => {
  const user = requireUser(c);
  const { db, config } = c.get('deps');
  const rows = await db.selectFrom('notification_prefs').selectAll().where('user_id', '=', user.id).execute();
  const channels = CHANNELS.filter(ch => (ch === 'sms' ? config.smsMode !== 'none' : ch === 'whatsapp' ? config.whatsappMode !== 'none' : true));
  return c.json({
    channels,
    categories: NOTIFICATION_CATEGORIES.map(category => ({
      category,
      critical: CRITICAL_CATEGORIES.includes(category),
      channels: Object.fromEntries(
        channels.map(ch => {
          const row = rows.find(r => r.category === category && r.channel === ch);
          return [ch, CRITICAL_CATEGORIES.includes(category) || (row ? row.enabled === 1 : defaultEnabled(category, ch))];
        })
      ),
    })),
  });
});

meRoutes.put('/notification-preferences', async c => {
  const user = requireUser(c);
  const { changes } = await readJson(
    c,
    z.object({
      changes: z
        .array(z.object({ category: z.enum(NOTIFICATION_CATEGORIES as [string, ...string[]]), channel: z.enum(CHANNELS as [string, ...string[]]), enabled: z.boolean() }))
        .min(1)
        .max(100),
    })
  );
  const { db } = c.get('deps');
  for (const ch of changes) {
    if (CRITICAL_CATEGORIES.includes(ch.category as never)) continue;
    const row = { user_id: user.id, category: ch.category as never, channel: ch.channel as never, enabled: ch.enabled ? 1 : 0 };
    await db
      .insertInto('notification_prefs')
      .values(row)
      .onConflict(oc => oc.columns(['user_id', 'category', 'channel']).doUpdateSet({ enabled: row.enabled }))
      .execute();
  }
  return c.json({ ok: true });
});

// ---------- Push (V5, blueprint §9.6) ----------

meRoutes.post('/push-subscriptions', async c => {
  const user = requireUser(c);
  const sub = await readJson(c, z.object({ endpoint: z.url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) }));
  const { db } = c.get('deps');
  await db
    .insertInto('push_subscriptions')
    .values({ id: newId(), user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, created_at: nowIso(c) })
    .onConflict(oc => oc.column('endpoint').doUpdateSet({ user_id: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth }))
    .execute();
  return c.json({ ok: true }, 201);
});

meRoutes.delete('/push-subscriptions', async c => {
  const user = requireUser(c);
  const { endpoint } = await readJson(c, z.object({ endpoint: z.url().max(1000) }));
  await c.get('deps').db.deleteFrom('push_subscriptions').where('user_id', '=', user.id).where('endpoint', '=', endpoint).execute();
  return c.json({ ok: true });
});

// ---------- Calendar subscription feed (V5, blueprint §4.8) ----------

meRoutes.get('/calendar-feed', async c => {
  const user = requireUser(c);
  const row = await c.get('deps').db.selectFrom('calendar_feeds').select('created_at').where('user_id', '=', user.id).executeTakeFirst();
  return c.json({ active: !!row, createdAt: row?.created_at ?? null });
});

/** Creates (or replaces) the private feed URL. The token is shown once and stored hashed; replacing it revokes the old URL. */
meRoutes.post('/calendar-feed', async c => {
  const user = requireUser(c);
  const { db, config } = c.get('deps');
  const token = crypto.randomBytes(24).toString('base64url');
  const row = { token_hash: hashToken(token), created_at: nowIso(c) };
  await db.insertInto('calendar_feeds').values({ user_id: user.id, ...row }).onConflict(oc => oc.column('user_id').doUpdateSet(row)).execute();
  const httpsUrl = `${config.appUrl}/api/calendar/${token}.ics`;
  return c.json({ url: httpsUrl, webcalUrl: httpsUrl.replace(/^https?:/, 'webcal:') }, 201);
});

meRoutes.delete('/calendar-feed', async c => {
  const user = requireUser(c);
  await c.get('deps').db.deleteFrom('calendar_feeds').where('user_id', '=', user.id).execute();
  return c.json({ ok: true });
});

// ---------- Profile, volunteering and data export ----------

meRoutes.put('/contact', async c => {
  const user = requireUser(c);
  const { phone } = await readJson(c, z.object({ phone: z.string().trim().regex(PHONE_REGEX, 'Enter a valid 10-digit Indian mobile number.').nullable() }));
  await c.get('deps').db.updateTable('users').set({ phone }).where('id', '=', user.id).execute();
  return c.json({ ok: true });
});

/** Events this student volunteers at (check-in only, blueprint §2.2). */
meRoutes.get('/volunteering', async c => {
  const user = requireUser(c);
  const { db, now } = c.get('deps');
  const rows = await eventQuery(db)
    .innerJoin('event_volunteers', 'event_volunteers.event_id', 'events.id')
    .where('event_volunteers.user_id', '=', user.id)
    .where('events.status', '=', 'published')
    .where('events.ends_at', '>', now().toISOString())
    .orderBy('events.starts_at')
    .execute();
  return c.json({ events: rows.map(r => toEventDto(r, now())) });
});

/**
 * Everything EventEase holds about the student, as JSON (blueprint §9.2,
 * India's DPDP Act 2023: the right to see one's data).
 */
meRoutes.get('/export', async c => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const [registrations, saved, follows, notifications, feedback, certificates, prefs] = await Promise.all([
    db.selectFrom('registrations').innerJoin('events', 'events.id', 'registrations.event_id').select(['registrations.registration_code', 'registrations.status', 'registrations.created_at', 'registrations.cancelled_at', 'registrations.phone', 'registrations.answers', 'events.title']).where('registrations.user_id', '=', user.id).execute(),
    db.selectFrom('saved_events').innerJoin('events', 'events.id', 'saved_events.event_id').select(['events.title', 'saved_events.created_at']).where('saved_events.user_id', '=', user.id).execute(),
    db.selectFrom('follows').innerJoin('organizations', 'organizations.id', 'follows.organization_id').select(['organizations.name', 'follows.created_at']).where('follows.user_id', '=', user.id).execute(),
    db.selectFrom('notifications').select(['title', 'body', 'created_at', 'read_at']).where('user_id', '=', user.id).execute(),
    db.selectFrom('feedback').innerJoin('registrations', 'registrations.id', 'feedback.registration_id').selectAll('feedback').where('registrations.user_id', '=', user.id).execute(),
    certificatesForUser(db, user.id),
    preferencesFor(db, user.id),
  ]);
  c.header('Content-Disposition', 'attachment; filename="eventease-my-data.json"');
  return c.json({
    exportedAt: nowIso(c),
    profile: {
      universityId: user.university_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      campus: user.campus,
      department: user.department,
      programme: user.programme,
      year: user.year,
      semester: user.semester,
    },
    preferences: prefs,
    registrations: registrations.map(r => ({ ...r, answers: r.answers ? (JSON.parse(r.answers) as Record<string, string>) : null })),
    savedEvents: saved,
    followedClubs: follows,
    notifications,
    feedback,
    certificates,
  });
});
