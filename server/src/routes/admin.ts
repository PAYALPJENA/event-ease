import { Hono } from 'hono';
import { z } from 'zod';
import { assertCanManageOrganization, hasRole, loadManagedEvent, organizationIdsFor, requireAdmin, requireStaff } from '../auth.ts';
import type { DB } from '../db/index.ts';
import type { EventRow, EventUpdate, ReviewAction, User } from '../db/types.ts';
import { ApiError, extOf, nowIso, readJson, readOptionalJson } from '../http.ts';
import type { AppContext, AppEnv } from '../http.ts';
import { formatIstDateTime } from '../lib/format.ts';
import { newId, slugify } from '../lib/ids.ts';
import { verifyPassToken } from '../lib/pass.ts';
import { AFFECTED_BY_CHANGE_STATUSES, eventPhase } from '../lib/rules.ts';
import { adminInsights } from '../services/analytics.ts';
import { countActive, eventQuery, findVenueClashes, recentChanges, toEventDto } from '../services/events.ts';
import type { VenueClash } from '../services/events.ts';
import { offerFreedSeats } from '../services/lifecycle.ts';
import { audit, notifyUsers } from '../services/notifications.ts';
import { refundRegistrations } from '../services/payments.ts';
import { opportunityDto } from './public.ts';

/**
 * Organizer portal and admin portal (blueprint §5, §6): events, the approval
 * workflow, cancellation, and the email log. Event-day operations
 * (participants, check-in, announcements) live in routes/operations.ts.
 *
 * Organizers act only for their own organizations. They create drafts and
 * submit them; an admin approves, requests changes or rejects (§3.3).
 * Admins can also publish directly, e.g. events they enter themselves.
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  requireStaff(c);
  await next();
});

const isoDateTime = z.iso.datetime({ offset: true }).transform(v => new Date(v).toISOString());

const eventFields = {
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().min(10).max(5000),
  image: z.url().nullable().optional(),
  /** null = organizer not specified; only admins may leave it empty. */
  organizationId: z.string().min(1).nullable(),
  categoryId: z.string().min(1),
  eventType: z
    .enum(['workshop', 'competition', 'talk', 'seminar', 'conference', 'fest', 'sports', 'cultural', 'club_activity', 'community_service', 'wellness', 'student_development', 'other'])
    .default('other'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** The date is set but the time isn't announced yet. */
  timeTbd: z.boolean().default(false),
  /** 'eventease' = students register here; otherwise there is no registration through EventEase. */
  registrationMode: z.enum(['eventease', 'not_required', 'unspecified']).default('eventease'),
  venueId: z.string().min(1).nullable(),
  mode: z.enum(['in_person', 'online', 'hybrid']),
  onlineUrl: z.url().nullable().optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  registrationOpensAt: isoDateTime.nullable().default(null),
  registrationClosesAt: isoDateTime.nullable().default(null),
  /** null = no limit */
  capacity: z.number().int().min(1).max(100_000).nullable(),
  /** null = not specified */
  eligibilityText: z.string().trim().min(3).max(200).nullable(),
  eligibleDepartments: z.array(z.string().trim().min(1)).min(1).nullable(),
  eligibleYears: z.array(z.number().int().min(1).max(5)).min(1).nullable(),
  requirements: z.array(z.string().trim().min(1).max(120)).max(20),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  isFeatured: z.boolean(),
  // ---- V3/V5 options; all optional so simple events stay simple ----
  participation: z.enum(['individual', 'team']).default('individual'),
  teamMin: z.number().int().min(1).max(50).nullable().default(null),
  teamMax: z.number().int().min(1).max(50).nullable().default(null),
  waitlistEnabled: z.boolean().default(true),
  offerWindowHours: z.number().int().min(1).max(72).default(12),
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        label: z.string().trim().min(2).max(200),
        type: z.enum(['text', 'choice']),
        options: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
        required: z.boolean(),
      })
    )
    .max(10)
    .default([]),
  requiredDocuments: z.array(z.object({ id: z.string().trim().min(1).max(40), label: z.string().trim().min(2).max(120) })).max(5).default([]),
  cancellationCutoffHours: z.number().int().min(0).max(720).nullable().default(null),
  certificateRule: z.enum(['none', 'attendance', 'winners', 'attendance_and_winners']).default('none'),
  /** Fee in paise; 0 = free; null = not specified. */
  feeAmount: z.number().int().min(0).max(10_000_00).nullable().default(0),
};

const updateSchema = z.object({
  ...eventFields,
  /** Required when a published event's time or venue changes; sent to registrants (§5). */
  changeReason: z.string().trim().min(3).max(300).optional(),
  /** Admins only: publish despite a venue clash. The override is logged (§8.3 #7). */
  overrideClash: z.boolean().optional(),
});

type EventInput = z.infer<z.ZodObject<typeof eventFields>>;

const checkTimeline = (e: Pick<EventInput, 'startsAt' | 'endsAt' | 'registrationOpensAt' | 'registrationClosesAt' | 'registrationMode'>) => {
  if (e.endsAt <= e.startsAt) throw new ApiError(400, 'validation_failed', 'The event must end after it starts.');
  if (e.registrationMode !== 'eventease') return;
  if (!e.registrationOpensAt || !e.registrationClosesAt) {
    throw new ApiError(400, 'validation_failed', 'Set when registration opens and closes, or choose that registration isn’t needed.');
  }
  if (e.registrationClosesAt <= e.registrationOpensAt) {
    throw new ApiError(400, 'validation_failed', 'Registration must close after it opens.');
  }
  if (e.registrationClosesAt > e.endsAt) {
    throw new ApiError(400, 'validation_failed', 'Registration must close before the event ends.');
  }
};

const checkOptions = (e: EventInput, user: User) => {
  if (!e.organizationId && !hasRole(user, 'admin')) throw new ApiError(400, 'validation_failed', 'Choose the organization running this event.');
  if (e.registrationMode !== 'eventease' && (e.participation === 'team' || e.questions.length || e.requiredDocuments.length || (e.feeAmount ?? 0) > 0)) {
    throw new ApiError(400, 'validation_failed', 'Teams, questions, documents and fees need registration through EventEase.');
  }
  if (e.participation === 'team') {
    if (!e.teamMin || !e.teamMax) throw new ApiError(400, 'validation_failed', 'Team events need a minimum and maximum team size.');
    if (e.teamMin > e.teamMax) throw new ApiError(400, 'validation_failed', 'The minimum team size can’t be larger than the maximum.');
  }
  const ids = [...e.questions.map(q => q.id), ...e.requiredDocuments.map(d => d.id)];
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'validation_failed', 'Each question and document needs its own id.');
  for (const q of e.questions) {
    if (q.type === 'choice' && (q.options?.length ?? 0) < 2) throw new ApiError(400, 'validation_failed', `"${q.label}" needs at least two options.`);
  }
};

const checkVenueAndMode = (e: Pick<EventInput, 'mode' | 'venueId' | 'onlineUrl'>) => {
  if (e.mode !== 'online' && !e.venueId) throw new ApiError(400, 'validation_failed', 'In-person and hybrid events need a venue.');
  if (e.mode !== 'in_person' && !e.onlineUrl) throw new ApiError(400, 'validation_failed', 'Online and hybrid events need a meeting link.');
};

const toColumns = (e: EventInput) => ({
  title: e.title,
  summary: e.summary ?? null,
  description: e.description,
  image: e.image ?? null,
  organization_id: e.organizationId,
  category_id: e.categoryId,
  venue_id: e.mode === 'online' ? null : e.venueId,
  mode: e.mode,
  online_url: e.onlineUrl ?? null,
  starts_at: e.startsAt,
  ends_at: e.endsAt,
  registration_opens_at: e.registrationMode === 'eventease' ? e.registrationOpensAt : null,
  registration_closes_at: e.registrationMode === 'eventease' ? e.registrationClosesAt : null,
  capacity: e.capacity,
  eligibility_text: e.eligibilityText,
  eligible_departments: e.eligibleDepartments ? JSON.stringify(e.eligibleDepartments) : null,
  eligible_years: e.eligibleYears ? JSON.stringify(e.eligibleYears) : null,
  requirements: JSON.stringify(e.requirements),
  contact_person: e.contactPerson ?? null,
  contact_email: e.contactEmail ?? null,
  is_featured: e.isFeatured ? 1 : 0,
  participation: e.participation,
  team_min: e.participation === 'team' ? e.teamMin : null,
  team_max: e.participation === 'team' ? e.teamMax : null,
  waitlist_enabled: e.waitlistEnabled ? 1 : 0,
  offer_window_hours: e.offerWindowHours,
  questions: JSON.stringify(e.questions),
  required_documents: JSON.stringify(e.requiredDocuments),
  cancellation_cutoff_hours: e.cancellationCutoffHours,
  certificate_rule: e.certificateRule,
  fee_amount: e.feeAmount,
  event_type: e.eventType,
  tags: JSON.stringify(e.tags),
  time_tbd: e.timeTbd ? 1 : 0,
  registration_mode: e.registrationMode,
});

const uniqueSlug = async (db: DB, title: string) => {
  const base = slugify(title);
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.selectFrom('events').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!taken) return slug;
  }
};

const emailTo = (c: AppContext) => ({ external: extOf(c) });

const clashMessage = (clashes: VenueClash[]) =>
  `The venue is already booked at that time for ${clashes.map(x => `"${x.title}" (${formatIstDateTime(x.startsAt)})`).join(', ')}.`;

/**
 * Venue clash rule (§8.3 #7). Organizers must pick another time or venue;
 * admins may override, and the override is logged.
 */
const assertNoClash = async (c: AppContext, user: User, event: Pick<EventRow, 'id' | 'venue_id' | 'mode' | 'starts_at' | 'ends_at'>, override: boolean | undefined) => {
  const { db } = c.get('deps');
  const clashes = await findVenueClashes(db, event);
  if (clashes.length === 0) return;
  if (!(override && hasRole(user, 'admin'))) {
    throw new ApiError(409, 'venue_clash', clashMessage(clashes) + (hasRole(user, 'admin') ? ' Choose override to publish anyway.' : ''));
  }
  await audit(db, { actorId: user.id, action: 'event.venue_clash_override', entityType: 'event', entityId: event.id, data: { clashes: clashes.map(x => x.id) } }, nowIso(c));
};

const addReview = (db: DB, eventId: string, actorId: string, action: ReviewAction, comments: string | null, ts: string) =>
  db.insertInto('approval_reviews').values({ id: newId(), event_id: eventId, actor_id: actorId, action, comments, created_at: ts }).execute();

const adminUserIds = async (db: DB) => {
  const users = await db.selectFrom('users').select(['id', 'roles']).where('status', '=', 'active').where('roles', 'like', '%"admin"%').execute();
  return users.map(u => u.id);
};

/** Whoever last submitted the event for review, or its creator. */
const submitterOf = async (db: DB, event: EventRow) => {
  const row = await db
    .selectFrom('approval_reviews')
    .select('actor_id')
    .where('event_id', '=', event.id)
    .where('action', '=', 'submitted')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return row?.actor_id ?? event.created_by;
};

// ---------- Event DTO for staff: adds review and cancellation state ----------

const reviewQuery = (db: DB) =>
  db
    .selectFrom('approval_reviews')
    .innerJoin('users', 'users.id', 'approval_reviews.actor_id')
    .select([
      'approval_reviews.event_id',
      'approval_reviews.action',
      'approval_reviews.comments',
      'approval_reviews.created_at',
      'users.name as actor_name',
    ]);

type ReviewRow = Awaited<ReturnType<ReturnType<typeof reviewQuery>['execute']>>[number];
const toReviewDto = (r: ReviewRow) => ({ action: r.action, comments: r.comments, createdAt: r.created_at, actorName: r.actor_name });

const toAdminEvents = async (db: DB, rows: Awaited<ReturnType<ReturnType<typeof eventQuery>['execute']>>, now: Date) => {
  const ids = rows.map(r => r.id);
  const reviews = ids.length ? await reviewQuery(db).where('approval_reviews.event_id', 'in', ids).orderBy('approval_reviews.created_at', 'desc').execute() : [];
  const latest = new Map<string, ReviewRow>();
  for (const r of reviews) if (!latest.has(r.event_id)) latest.set(r.event_id, r);
  return rows.map(row => ({
    ...toEventDto(row, now),
    cancelRequest: row.cancel_requested_at ? { reason: row.cancel_request_reason ?? '', requestedAt: row.cancel_requested_at } : null,
    latestReview: latest.has(row.id) ? toReviewDto(latest.get(row.id)!) : null,
  }));
};

// ---------- Options for the event form ----------

adminRoutes.get('/options', async c => {
  const user = requireStaff(c);
  const { db } = c.get('deps');
  const allowed = await organizationIdsFor(db, user);
  let orgQuery = db.selectFrom('organizations').select(['id', 'name', 'type']).orderBy('name');
  if (allowed !== 'all') orgQuery = orgQuery.where('id', 'in', allowed.length ? allowed : ['__none__']);

  const [organizations, categories, venues] = await Promise.all([
    orgQuery.execute(),
    db.selectFrom('categories').select(['id', 'name']).orderBy('position').orderBy('name').execute(),
    db.selectFrom('venues').select(['id', 'name', 'campus', 'capacity']).orderBy('name').execute(),
  ]);
  return c.json({ organizations, categories, venues });
});

// ---------- Events ----------

adminRoutes.get('/events', async c => {
  const user = requireStaff(c);
  const { db, now } = c.get('deps');
  const allowed = await organizationIdsFor(db, user);
  let query = eventQuery(db).orderBy('events.starts_at', 'desc');
  if (allowed !== 'all') query = query.where('events.organization_id', 'in', allowed.length ? allowed : ['__none__']);
  return c.json({ events: await toAdminEvents(db, await query.execute(), now()) });
});

adminRoutes.get('/events/:id', async c => {
  const user = requireStaff(c);
  const { db, now } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  const row = await eventQuery(db).where('events.id', '=', event.id).executeTakeFirstOrThrow();
  const [dto] = await toAdminEvents(db, [row], now());
  const reviews = await reviewQuery(db).where('approval_reviews.event_id', '=', event.id).orderBy('approval_reviews.created_at').execute();
  return c.json({ event: dto, reviews: reviews.map(toReviewDto), changes: await recentChanges(db, event.id) });
});

adminRoutes.post('/events', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, z.object(eventFields));
  checkTimeline(input);
  checkVenueAndMode(input);
  checkOptions(input, user);
  const { db, now } = c.get('deps');
  if (input.organizationId) await assertCanManageOrganization(db, user, input.organizationId);

  const id = newId();
  const ts = nowIso(c);
  await db
    .insertInto('events')
    .values({
      id,
      slug: await uniqueSlug(db, input.title),
      ...toColumns(input),
      status: 'draft',
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
      published_at: null,
      cancel_requested_at: null,
      cancel_requested_by: null,
      cancel_request_reason: null,
      recap: null,
      gallery: '[]',
      results_published_at: null,
      source_note: null,
      is_sample: 0,
    })
    .execute();
  await audit(db, { actorId: user.id, action: 'event.create', entityType: 'event', entityId: id }, ts);

  const row = await eventQuery(db).where('events.id', '=', id).executeTakeFirstOrThrow();
  return c.json({ event: toEventDto(row, now()) }, 201);
});

const venueName = async (db: DB, venueId: string | null, mode: string) => {
  if (mode === 'online' || !venueId) return 'Online';
  const v = await db.selectFrom('venues').select('name').where('id', '=', venueId).executeTakeFirst();
  return (v?.name ?? 'Venue') + (mode === 'hybrid' ? ' (and online)' : '');
};

adminRoutes.put('/events/:id', async c => {
  const user = requireStaff(c);
  const { changeReason, overrideClash, ...input } = await readJson(c, updateSchema);
  checkTimeline(input);
  checkVenueAndMode(input);
  checkOptions(input, user);
  const { db, now } = c.get('deps');
  const existing = await loadManagedEvent(db, user, c.req.param('id'));
  // Moving an event to another organization requires rights over that one too.
  await assertCanManageOrganization(db, user, input.organizationId);

  const isAdmin = hasRole(user, 'admin');
  if (existing.status === 'cancelled') throw new ApiError(409, 'event_cancelled', 'Cancelled events cannot be edited.');
  if (existing.status === 'rejected') throw new ApiError(409, 'event_rejected', 'Rejected events cannot be edited. Create a new event instead.');
  if (existing.status === 'pending_approval' && !isAdmin) {
    throw new ApiError(409, 'under_review', 'This event is waiting for approval and can’t be edited until it has been reviewed.');
  }
  if (existing.status === 'published' && eventPhase(existing, now()) === 'completed') {
    throw new ApiError(409, 'event_ended', 'This event has ended and can no longer be edited.');
  }

  const taken = await countActive(db, existing.id);
  if (input.capacity !== null && input.capacity < taken) {
    throw new ApiError(409, 'capacity_below_registrations', `Capacity can't be lower than the ${taken} confirmed registrations.`);
  }

  const columns = toColumns(input);
  // Registrants agreed to the fee, participation type and paperwork they signed up under.
  if (taken > 0 && (existing.fee_amount !== columns.fee_amount || existing.participation !== columns.participation || existing.required_documents !== columns.required_documents || existing.registration_mode !== columns.registration_mode)) {
    throw new ApiError(409, 'terms_locked', 'The fee, team setting and required documents can’t change once students have registered.');
  }
  const timeChanged = existing.starts_at !== columns.starts_at || existing.ends_at !== columns.ends_at;
  const venueChanged = existing.venue_id !== columns.venue_id || existing.mode !== columns.mode;
  const isLive = existing.status === 'published';

  // Blueprint §5 / §8.3 #8: time or venue changes after publishing need a
  // reason, are recorded, and reach every registrant.
  if (isLive && (timeChanged || venueChanged)) {
    if (!changeReason) {
      throw new ApiError(400, 'change_reason_required', 'Give a reason for changing the time or venue; registered students will see it.');
    }
    await assertNoClash(c, user, { id: existing.id, venue_id: columns.venue_id, mode: columns.mode, starts_at: columns.starts_at, ends_at: columns.ends_at }, overrideClash);
  }

  const ts = nowIso(c);
  const update: EventUpdate = { ...columns, updated_at: ts };

  // Work out the change records before the transaction (SQLite has one connection).
  const range = (s: string, e: string) => `${formatIstDateTime(s)} – ${formatIstDateTime(e)}`;
  const records: { field: 'time' | 'venue'; old_value: string; new_value: string }[] = [];
  if (isLive && changeReason) {
    if (timeChanged) {
      records.push({ field: 'time', old_value: range(existing.starts_at, existing.ends_at), new_value: range(columns.starts_at, columns.ends_at) });
    }
    if (venueChanged) {
      records.push({
        field: 'venue',
        old_value: await venueName(db, existing.venue_id, existing.mode),
        new_value: await venueName(db, columns.venue_id, columns.mode),
      });
    }
  }
  const changes = records.map(r => r.field);

  await db.transaction().execute(async trx => {
    await trx.updateTable('events').set(update).where('id', '=', existing.id).execute();
    // More seats: offer them to the waitlist straight away.
    if (isLive && (columns.capacity ?? Infinity) > (existing.capacity ?? Infinity)) await offerFreedSeats(trx, existing.id, now(), extOf(c));
    if (records.length === 0) return;
    await trx
      .insertInto('event_changes')
      .values(records.map(r => ({ id: newId(), event_id: existing.id, ...r, reason: changeReason!, changed_by: user.id, created_at: ts })))
      .execute();

    const registrants = await trx
      .selectFrom('registrations')
      .select('user_id')
      .where('event_id', '=', existing.id)
      .where('status', 'in', AFFECTED_BY_CHANGE_STATUSES)
      .execute();
    const details = records.map(r => `${r.field === 'time' ? 'Time' : 'Venue'}: ${r.new_value} (was ${r.old_value}).`).join(' ');
    await notifyUsers(
      trx,
      registrants.map(r => r.user_id),
      {
        category: 'changes',
        title: `${input.title}: ${changes.join(' and ')} changed`,
        body: `${details} Reason: ${changeReason}`,
        link: `/event/${existing.id}`,
      },
      ts,
      emailTo(c)
    );
  });
  await audit(db, { actorId: user.id, action: 'event.update', entityType: 'event', entityId: existing.id, data: { changes, reason: changeReason ?? null } }, ts);

  const row = await eventQuery(db).where('events.id', '=', existing.id).executeTakeFirstOrThrow();
  return c.json({ event: toEventDto(row, now()) });
});

// ---------- Approval workflow (§3.3) ----------

adminRoutes.post('/events/:id/submit', async c => {
  const user = requireStaff(c);
  const { note } = await readOptionalJson(c, z.object({ note: z.string().trim().max(500).optional() }));
  const { db, now } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  if (event.status !== 'draft' && event.status !== 'changes_requested') {
    throw new ApiError(409, 'not_submittable', 'Only drafts and events with requested changes can be submitted for approval.');
  }
  if (new Date(event.starts_at) <= now()) throw new ApiError(409, 'event_in_past', 'This event’s start time has passed. Update the date first.');

  const ts = nowIso(c);
  await db.updateTable('events').set({ status: 'pending_approval', updated_at: ts }).where('id', '=', event.id).execute();
  await addReview(db, event.id, user.id, 'submitted', note || null, ts);
  await notifyUsers(
    db,
    await adminUserIds(db),
    { category: 'approvals', title: `Awaiting approval: ${event.title}`, body: `${user.name} submitted ${event.title} for review.`, link: '/admin/approvals' },
    ts
  );
  await audit(db, { actorId: user.id, action: 'event.submit', entityType: 'event', entityId: event.id }, ts);
  return c.json({ ok: true });
});

/** Publishes after the clash check; tells the submitter if someone else's submission was approved. */
const publish = async (c: AppContext, user: User, event: EventRow, action: 'approved' | 'published', comments: string | null, overrideClash?: boolean) => {
  const { db, now } = c.get('deps');
  if (new Date(event.ends_at) <= now()) throw new ApiError(409, 'event_in_past', 'This event has already ended.');
  await assertNoClash(c, user, event, overrideClash);

  const ts = nowIso(c);
  await db.updateTable('events').set({ status: 'published', published_at: ts, updated_at: ts }).where('id', '=', event.id).execute();
  await addReview(db, event.id, user.id, action, comments, ts);
  const submitter = await submitterOf(db, event);
  if (submitter !== user.id) {
    await notifyUsers(
      db,
      [submitter],
      { category: 'approvals', title: `Approved: ${event.title}`, body: `${event.title} is now published.${comments ? ` Comments: ${comments}` : ''}`, link: `/event/${event.id}` },
      ts,
      emailTo(c)
    );
  }
  // Followers hear about new events from their clubs (blueprint §7.1 "Club publishes event").
  const org = await db.selectFrom('organizations').select('name').where('id', '=', event.organization_id).executeTakeFirstOrThrow();
  const followers = await db.selectFrom('follows').select('user_id').where('organization_id', '=', event.organization_id).execute();
  await notifyUsers(
    db,
    followers.map(f => f.user_id),
    { category: 'clubs', title: `New from ${org.name}: ${event.title}`, body: `${event.title} is open on EventEase.`, link: `/event/${event.id}` },
    ts,
    emailTo(c)
  );
  await audit(db, { actorId: user.id, action: 'event.publish', entityType: 'event', entityId: event.id }, ts);
};

adminRoutes.post('/events/:id/publish', async c => {
  const user = requireAdmin(c);
  const { overrideClash } = await readOptionalJson(c, z.object({ overrideClash: z.boolean().optional() }));
  const { db } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  if (!['draft', 'pending_approval', 'changes_requested'].includes(event.status)) {
    throw new ApiError(409, 'not_draft', 'Only unpublished events can be published.');
  }
  await publish(c, user, event, 'published', null, overrideClash);
  return c.json({ ok: true });
});

const reviewSchema = z
  .object({
    decision: z.enum(['approve', 'request_changes', 'reject']),
    comments: z.string().trim().max(1000).optional(),
    overrideClash: z.boolean().optional(),
  })
  .refine(r => r.decision === 'approve' || (r.comments?.length ?? 0) >= 3, {
    message: 'Tell the organizer what to change or why the event was rejected.',
    path: ['comments'],
  });

adminRoutes.post('/events/:id/review', async c => {
  const user = requireAdmin(c);
  const { decision, comments, overrideClash } = await readJson(c, reviewSchema);
  const { db } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  if (event.status !== 'pending_approval') throw new ApiError(409, 'not_pending', 'This event is not waiting for approval.');

  if (decision === 'approve') {
    await publish(c, user, event, 'approved', comments || null, overrideClash);
    return c.json({ ok: true, status: 'published' });
  }

  const ts = nowIso(c);
  const status = decision === 'reject' ? 'rejected' : 'changes_requested';
  await db.updateTable('events').set({ status, updated_at: ts }).where('id', '=', event.id).execute();
  await addReview(db, event.id, user.id, status, comments!, ts);
  await notifyUsers(
    db,
    [await submitterOf(db, event)],
    {
      category: 'approvals',
      title: decision === 'reject' ? `Not approved: ${event.title}` : `Changes requested: ${event.title}`,
      body: comments!,
      link: decision === 'reject' ? '/admin' : `/admin/events/${event.id}/edit`,
    },
    ts,
    emailTo(c)
  );
  await audit(db, { actorId: user.id, action: `event.${status}`, entityType: 'event', entityId: event.id, data: { comments } }, ts);
  return c.json({ ok: true, status });
});

adminRoutes.get('/approvals', async c => {
  requireAdmin(c);
  const { db, now } = c.get('deps');
  const rows = await eventQuery(db)
    .where(eb => eb.or([eb('events.status', '=', 'pending_approval'), eb.and([eb('events.status', '=', 'published'), eb('events.cancel_requested_at', 'is not', null)])]))
    .orderBy('events.updated_at')
    .execute();
  const events = await toAdminEvents(db, rows, now());

  const pending = [];
  const cancelRequests = [];
  for (const [i, event] of events.entries()) {
    const row = rows[i];
    if (event.status === 'pending_approval') {
      pending.push({ ...event, clashes: await findVenueClashes(db, row) });
    } else {
      const by = row.cancel_requested_by
        ? await db.selectFrom('users').select('name').where('id', '=', row.cancel_requested_by).executeTakeFirst()
        : undefined;
      cancelRequests.push({ ...event, requestedBy: by?.name ?? null });
    }
  }
  return c.json({ pending, cancelRequests });
});

// ---------- Cancellation ----------

/** Cancels the event, its active registrations and passes, and tells everyone (§7.1). */
const cancelNow = async (c: AppContext, user: User, event: EventRow, reason: string) => {
  const { db, gateway } = c.get('deps');
  const ts = nowIso(c);
  await db.transaction().execute(async trx => {
    const registrants = await trx
      .selectFrom('registrations')
      .select(['id', 'user_id'])
      .where('event_id', '=', event.id)
      .where('status', 'in', AFFECTED_BY_CHANGE_STATUSES)
      .execute();
    await trx
      .updateTable('events')
      .set({ status: 'cancelled', updated_at: ts, cancel_requested_at: null, cancel_requested_by: null, cancel_request_reason: null })
      .where('id', '=', event.id)
      .execute();
    await trx
      .updateTable('registrations')
      .set({ status: 'cancelled', cancelled_at: ts, cancel_reason: `Event cancelled: ${reason}` })
      .where('event_id', '=', event.id)
      .where('status', 'in', AFFECTED_BY_CHANGE_STATUSES)
      .execute();
    await refundRegistrations(trx, gateway, registrants.map(r => r.id), `${event.title} was cancelled.`, ts, extOf(c));
    await notifyUsers(
      trx,
      registrants.map(r => r.user_id),
      { category: 'changes', title: `${event.title} has been cancelled`, body: `Reason: ${reason}`, link: `/event/${event.id}` },
      ts,
      emailTo(c)
    );
    if (event.cancel_requested_by && event.cancel_requested_by !== user.id) {
      await notifyUsers(
        trx,
        [event.cancel_requested_by],
        { category: 'approvals', title: `Cancellation confirmed: ${event.title}`, body: 'Registered students have been notified.', link: '/admin' },
        ts
      );
    }
    await audit(trx, { actorId: user.id, action: 'event.cancel', entityType: 'event', entityId: event.id, data: { reason } }, ts);
  });
};

/**
 * Admins cancel directly. Organizers cancel directly only while nobody is
 * registered; otherwise the request goes to an admin to confirm (§5).
 */
adminRoutes.post('/events/:id/cancel', async c => {
  const user = requireStaff(c);
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(3).max(300) }));
  const { db, now } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  if (event.status === 'cancelled') throw new ApiError(409, 'already_cancelled', 'This event is already cancelled.');
  if (event.status === 'published' && eventPhase(event, now()) === 'completed') {
    throw new ApiError(409, 'event_ended', 'This event has already ended.');
  }

  const active = await countActive(db, event.id);
  if (hasRole(user, 'admin') || active === 0) {
    await cancelNow(c, user, event, reason);
    return c.json({ ok: true, status: 'cancelled' });
  }

  if (event.cancel_requested_at) throw new ApiError(409, 'cancel_already_requested', 'Cancellation has already been requested.');
  const ts = nowIso(c);
  await db
    .updateTable('events')
    .set({ cancel_requested_at: ts, cancel_requested_by: user.id, cancel_request_reason: reason, updated_at: ts })
    .where('id', '=', event.id)
    .execute();
  await addReview(db, event.id, user.id, 'cancel_requested', reason, ts);
  await notifyUsers(
    db,
    await adminUserIds(db),
    { category: 'approvals', title: `Cancellation requested: ${event.title}`, body: `${user.name}: ${reason} (${active} registered)`, link: '/admin/approvals' },
    ts
  );
  await audit(db, { actorId: user.id, action: 'event.cancel_request', entityType: 'event', entityId: event.id, data: { reason } }, ts);
  return c.json({ ok: true, status: 'cancel_requested' }, 202);
});

adminRoutes.post('/events/:id/cancel-request/decline', async c => {
  const user = requireAdmin(c);
  const { comments } = await readJson(c, z.object({ comments: z.string().trim().min(3).max(500) }));
  const { db } = c.get('deps');
  const event = await loadManagedEvent(db, user, c.req.param('id'));
  if (!event.cancel_requested_at) throw new ApiError(409, 'no_cancel_request', 'There is no cancellation request for this event.');

  const ts = nowIso(c);
  await db
    .updateTable('events')
    .set({ cancel_requested_at: null, cancel_requested_by: null, cancel_request_reason: null, updated_at: ts })
    .where('id', '=', event.id)
    .execute();
  await addReview(db, event.id, user.id, 'cancel_declined', comments, ts);
  if (event.cancel_requested_by) {
    await notifyUsers(
      db,
      [event.cancel_requested_by],
      { category: 'approvals', title: `Cancellation declined: ${event.title}`, body: comments, link: '/admin' },
      ts,
      emailTo(c)
    );
  }
  await audit(db, { actorId: user.id, action: 'event.cancel_declined', entityType: 'event', entityId: event.id, data: { comments } }, ts);
  return c.json({ ok: true });
});

// ---------- Message log (admin) ----------

adminRoutes.get('/outbox', async c => {
  requireAdmin(c);
  const channel = c.req.query('channel');
  let query = c
    .get('deps')
    .db.selectFrom('message_outbox')
    .select(['id', 'channel', 'to_address', 'subject', 'body', 'status', 'attempts', 'created_at', 'sent_at', 'last_error'])
    .orderBy('created_at', 'desc')
    .limit(100);
  if (channel === 'email' || channel === 'push' || channel === 'sms' || channel === 'whatsapp') query = query.where('channel', '=', channel);
  const rows = await query.execute();
  const { config } = c.get('deps');
  return c.json({
    mailMode: config.mailMode,
    modes: { email: config.mailMode, push: config.pushMode, sms: config.smsMode, whatsapp: config.whatsappMode },
    emails: rows.map(r => ({
      id: r.id,
      channel: r.channel,
      // Push subscriptions are long JSON blobs; show only the push service host.
      to: r.channel === 'push' ? `push: ${new URL((JSON.parse(r.to_address) as { endpoint: string }).endpoint).host}` : r.to_address,
      subject: r.subject,
      body: r.body,
      status: r.status,
      attempts: r.attempts,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      lastError: r.last_error,
    })),
  });
});

// ---------- Pass verification (look-up only; check-in is in operations.ts) ----------

adminRoutes.post('/passes/verify', async c => {
  const user = requireStaff(c);
  const { token } = await readJson(c, z.object({ token: z.string().min(10).max(1000) }));
  const { db, config } = c.get('deps');

  const parsed = verifyPassToken(token, config.passSecret);
  if (!parsed) return c.json({ valid: false, reason: 'invalid_signature' });

  const row = await db
    .selectFrom('registrations')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select([
      'registrations.status',
      'registrations.registration_code as code',
      'registrations.event_id as eventId',
      'events.title as eventTitle',
      'events.organization_id as organizationId',
      'users.name',
      'users.university_id as universityId',
    ])
    .where('registrations.id', '=', parsed.registrationId)
    .executeTakeFirst();

  if (!row || row.eventId !== parsed.eventId) return c.json({ valid: false, reason: 'not_found' });
  await assertCanManageOrganization(db, user, row.organizationId);
  if (row.status === 'cancelled') return c.json({ valid: false, reason: 'registration_cancelled', code: row.code });

  return c.json({
    valid: true,
    registration: { code: row.code, status: row.status },
    student: { name: row.name, universityId: row.universityId },
    event: { id: row.eventId, title: row.eventTitle },
  });
});

// ---------- Clubs & organizations (blueprint §6) ----------

const orgInput = z.object({
  name: z.string().trim().min(3).max(120),
  type: z.enum(['club', 'department', 'cell']),
  description: z.string().trim().max(2000).nullable(),
  contactEmail: z.email().nullable(),
  logoUrl: z.url().max(500).nullable(),
  socialLinks: z.partialRecord(z.enum(['website', 'instagram', 'linkedin', 'youtube']), z.url().max(300)).default({}),
  recruitment: z.string().trim().max(1000).nullable(),
});

const orgColumns = (o: z.infer<typeof orgInput>) => ({
  name: o.name,
  type: o.type,
  description: o.description,
  contact_email: o.contactEmail,
  logo_url: o.logoUrl,
  social_links: JSON.stringify(o.socialLinks),
  recruitment: o.recruitment,
});

adminRoutes.get('/organizations', async c => {
  const user = requireStaff(c);
  const { db } = c.get('deps');
  const allowed = await organizationIdsFor(db, user);
  let query = db.selectFrom('organizations').selectAll().orderBy('name');
  if (allowed !== 'all') query = query.where('id', 'in', allowed.length ? allowed : ['__none__']);
  const orgs = await query.execute();
  const members = orgs.length
    ? await db
        .selectFrom('organization_members')
        .innerJoin('users', 'users.id', 'organization_members.user_id')
        .select(['organization_members.organization_id', 'organization_members.role', 'users.id', 'users.name', 'users.university_id'])
        .where('organization_members.organization_id', 'in', orgs.map(o => o.id))
        .orderBy('users.name')
        .execute()
    : [];
  return c.json({
    organizations: orgs.map(o => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      status: o.status,
      description: o.description,
      contactEmail: o.contact_email,
      logoUrl: o.logo_url,
      socialLinks: JSON.parse(o.social_links) as Record<string, string>,
      recruitment: o.recruitment,
      members: members.filter(m => m.organization_id === o.id).map(m => ({ userId: m.id, name: m.name, universityId: m.university_id, role: m.role })),
    })),
  });
});

adminRoutes.post('/organizations', async c => {
  const user = requireAdmin(c);
  const input = await readJson(c, orgInput);
  const { db } = c.get('deps');
  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await db.selectFrom('organizations').select('id').where('slug', '=', slug).executeTakeFirst(); i++) slug = `${base}-${i}`;
  const id = newId();
  const ts = nowIso(c);
  await db.insertInto('organizations').values({ id, slug, ...orgColumns(input), status: 'active', created_at: ts }).execute();
  await audit(db, { actorId: user.id, action: 'organization.create', entityType: 'organization', entityId: id }, ts);
  return c.json({ organization: { id, slug } }, 201);
});

/** Admins edit any organization; a club's own lead edits its page (about, recruitment, links). */
adminRoutes.put('/organizations/:id', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, orgInput.extend({ status: z.enum(['active', 'inactive']).optional() }));
  const { db } = c.get('deps');
  const org = await db.selectFrom('organizations').selectAll().where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!org) throw new ApiError(404, 'organization_not_found', 'Organization not found.');
  if (!hasRole(user, 'admin')) {
    const lead = await db.selectFrom('organization_members').select('role').where('organization_id', '=', org.id).where('user_id', '=', user.id).where('role', '=', 'lead').executeTakeFirst();
    if (!lead) throw new ApiError(403, 'forbidden', 'Only the club lead or an administrator can edit this page.');
    if (input.status && input.status !== org.status) throw new ApiError(403, 'forbidden', 'Only administrators can deactivate a club.');
    if (input.name !== org.name || input.type !== org.type) throw new ApiError(403, 'forbidden', 'Only administrators can rename a club or change its type.');
  }
  const ts = nowIso(c);
  await db.updateTable('organizations').set({ ...orgColumns(input), ...(input.status ? { status: input.status } : {}) }).where('id', '=', org.id).execute();
  await audit(db, { actorId: user.id, action: 'organization.update', entityType: 'organization', entityId: org.id }, ts);
  return c.json({ ok: true });
});

/** Assigns a role in an organization. Giving someone a lead/organizer role also grants the organizer role (§6 "assign organizer roles"). */
adminRoutes.post('/organizations/:id/members', async c => {
  const user = requireAdmin(c);
  const input = await readJson(c, z.object({ universityId: z.string().trim().min(3).max(40), role: z.enum(['lead', 'organizer', 'member', 'volunteer']) }));
  const { db } = c.get('deps');
  const org = await db.selectFrom('organizations').select('id').where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!org) throw new ApiError(404, 'organization_not_found', 'Organization not found.');
  const member = await db.selectFrom('users').selectAll().where('university_id', '=', input.universityId).where('status', '=', 'active').executeTakeFirst();
  if (!member) throw new ApiError(404, 'student_not_found', `No active user with roll number ${input.universityId}.`);

  const ts = nowIso(c);
  await db.transaction().execute(async trx => {
    await trx
      .insertInto('organization_members')
      .values({ organization_id: org.id, user_id: member.id, role: input.role })
      .onConflict(oc => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role: input.role }))
      .execute();
    if (input.role === 'lead' || input.role === 'organizer') {
      const roles = JSON.parse(member.roles) as string[];
      if (!roles.includes('organizer')) await trx.updateTable('users').set({ roles: JSON.stringify([...roles, 'organizer']) }).where('id', '=', member.id).execute();
    }
    await audit(trx, { actorId: user.id, action: 'organization.member_set', entityType: 'organization', entityId: org.id, data: { userId: member.id, role: input.role } }, ts);
  });
  return c.json({ ok: true }, 201);
});

adminRoutes.delete('/organizations/:id/members/:userId', async c => {
  const user = requireAdmin(c);
  const { db } = c.get('deps');
  await db.deleteFrom('organization_members').where('organization_id', '=', c.req.param('id')).where('user_id', '=', c.req.param('userId')).execute();
  await audit(db, { actorId: user.id, action: 'organization.member_remove', entityType: 'organization', entityId: c.req.param('id'), data: { userId: c.req.param('userId') } }, nowIso(c));
  return c.json({ ok: true });
});

// ---------- Opportunities (blueprint §4.12) ----------

const opportunityInput = z.object({
  type: z.enum(['internship', 'scholarship', 'research', 'fellowship', 'competition', 'conference']),
  title: z.string().trim().min(3).max(150),
  provider: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(5000),
  deadline: isoDateTime,
  eligibilityText: z.string().trim().min(3).max(200),
  eligibleDepartments: z.array(z.string().trim().min(1)).min(1).nullable(),
  eligibleYears: z.array(z.number().int().min(1).max(5)).min(1).nullable(),
  externalUrl: z.url().max(500).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  organizationId: z.string().nullable(),
});

const opportunityColumns = (o: z.infer<typeof opportunityInput>) => ({
  type: o.type,
  title: o.title,
  provider: o.provider,
  description: o.description,
  deadline: o.deadline,
  eligibility_text: o.eligibilityText,
  eligible_departments: o.eligibleDepartments ? JSON.stringify(o.eligibleDepartments) : null,
  eligible_years: o.eligibleYears ? JSON.stringify(o.eligibleYears) : null,
  external_url: o.externalUrl,
  tags: JSON.stringify(o.tags),
  organization_id: o.organizationId,
});

/** Organizers post opportunities for their own organizations; admins for anyone (or none). */
const assertCanPostOpportunity = async (db: DB, user: User, organizationId: string | null) => {
  if (organizationId) await assertCanManageOrganization(db, user, organizationId);
  else if (!hasRole(user, 'admin')) throw new ApiError(403, 'forbidden', 'Choose one of your organizations.');
};

adminRoutes.get('/opportunities', async c => {
  const user = requireStaff(c);
  const { db } = c.get('deps');
  const allowed = await organizationIdsFor(db, user);
  let query = db.selectFrom('opportunities').selectAll().orderBy('deadline', 'desc');
  if (allowed !== 'all') query = query.where('organization_id', 'in', allowed.length ? allowed : ['__none__']);
  return c.json({ opportunities: (await query.execute()).map(opportunityDto) });
});

adminRoutes.post('/opportunities', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, opportunityInput);
  const { db } = c.get('deps');
  await assertCanPostOpportunity(db, user, input.organizationId);
  const id = newId();
  const ts = nowIso(c);
  await db.insertInto('opportunities').values({ id, ...opportunityColumns(input), created_by: user.id, status: 'published', created_at: ts }).execute();
  await audit(db, { actorId: user.id, action: 'opportunity.create', entityType: 'opportunity', entityId: id }, ts);
  return c.json({ opportunity: { id } }, 201);
});

adminRoutes.put('/opportunities/:id', async c => {
  const user = requireStaff(c);
  const input = await readJson(c, opportunityInput.extend({ status: z.enum(['published', 'archived']) }));
  const { db } = c.get('deps');
  const existing = await db.selectFrom('opportunities').selectAll().where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!existing) throw new ApiError(404, 'opportunity_not_found', 'Opportunity not found.');
  await assertCanPostOpportunity(db, user, existing.organization_id);
  await assertCanPostOpportunity(db, user, input.organizationId);
  await db.updateTable('opportunities').set({ ...opportunityColumns(input), status: input.status }).where('id', '=', existing.id).execute();
  await audit(db, { actorId: user.id, action: 'opportunity.update', entityType: 'opportunity', entityId: existing.id }, nowIso(c));
  return c.json({ ok: true });
});

// ---------- Insights, exports and payments (admin, blueprint §6 and V5) ----------

const rangeQuery = (c: AppContext) => {
  const now = c.get('deps').now();
  const from = c.req.query('from') ?? new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
  const to = c.req.query('to') ?? new Date(now.getTime() + 365 * 24 * 3600_000).toISOString();
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new ApiError(400, 'validation_failed', 'from and to must be dates.');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
};

adminRoutes.get('/insights', async c => {
  requireAdmin(c);
  const { from, to } = rangeQuery(c);
  return c.json(await adminInsights(c.get('deps').db, from, to));
});

/**
 * Co-curricular record export for the university's records system (V5):
 * one row per attended event per student, with the hours and any
 * certificate. JSON by default, CSV with ?format=csv.
 */
adminRoutes.get('/exports/co-curricular', async c => {
  requireAdmin(c);
  const { from, to } = rangeQuery(c);
  const rows = await c
    .get('deps')
    .db.selectFrom('registrations')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .innerJoin('organizations', 'organizations.id', 'events.organization_id')
    .innerJoin('categories', 'categories.id', 'events.category_id')
    .leftJoin('certificates', join => join.onRef('certificates.registration_id', '=', 'registrations.id').on('certificates.revoked_at', 'is', null))
    .select([
      'users.university_id',
      'users.name',
      'users.department',
      'users.programme',
      'users.year',
      'events.title',
      'events.starts_at',
      'events.ends_at',
      'categories.name as category',
      'organizations.name as organizer',
      'registrations.registration_code',
      'certificates.code as certificate_code',
      'certificates.kind as certificate_kind',
    ])
    .where('registrations.status', '=', 'attended')
    .where('events.starts_at', '>=', from)
    .where('events.starts_at', '<', to)
    .orderBy('users.university_id')
    .orderBy('events.starts_at')
    .execute();
  const records = rows.map(r => ({
    universityId: r.university_id,
    name: r.name,
    department: r.department,
    programme: r.programme,
    year: r.year,
    event: r.title,
    category: r.category,
    organizer: r.organizer,
    date: r.starts_at.slice(0, 10),
    hours: Math.round(((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 3600_000) * 10) / 10,
    registrationCode: r.registration_code,
    certificateCode: r.certificate_code,
    certificateKind: r.certificate_kind,
  }));
  if (c.req.query('format') === 'csv') {
    const cell = (v: unknown) => {
      let t = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(t)) t = `'${t}`;
      return `"${t.replace(/"/g, '""')}"`;
    };
    const header = Object.keys(records[0] ?? { universityId: '' });
    const csv = [header.map(cell).join(','), ...records.map(r => header.map(h => cell((r as Record<string, unknown>)[h])).join(','))].join('\r\n') + '\r\n';
    return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="co-curricular-records.csv"' });
  }
  return c.json({ range: { from, to }, records });
});

/** Payment reconciliation (V5 exit criterion: "no manual reconciliation"). */
adminRoutes.get('/payments', async c => {
  requireAdmin(c);
  const rows = await c
    .get('deps')
    .db.selectFrom('payments')
    .innerJoin('registrations', 'registrations.id', 'payments.registration_id')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select([
      'payments.id',
      'payments.amount',
      'payments.status',
      'payments.gateway',
      'payments.gateway_order_id as orderId',
      'payments.gateway_payment_id as paymentId',
      'payments.refund_ref as refundRef',
      'payments.created_at as createdAt',
      'payments.paid_at as paidAt',
      'payments.refunded_at as refundedAt',
      'registrations.registration_code as registrationCode',
      'registrations.status as registrationStatus',
      'users.name',
      'users.university_id as universityId',
      'events.title as eventTitle',
    ])
    .orderBy('payments.created_at', 'desc')
    .limit(500)
    .execute();
  const sum = (status: string) => rows.filter(r => r.status === status).reduce((a, r) => a + r.amount, 0);
  return c.json({ payments: rows, totals: { collected: sum('paid'), refunded: sum('refunded'), pending: sum('created') } });
});
