import type { DB } from '../db/index.ts';
import type { EventRow } from '../db/types.ts';
import { ACTIVE_REGISTRATION_STATUSES } from '../lib/rules.ts';

/**
 * Organizer analytics and admin insights (blueprint §5 "Feedback & analytics",
 * §6 "Reports & analytics", V4). Portable SQL only (no date functions), so
 * this moves to PostgreSQL unchanged.
 */

const ATTENDED = ['attended', 'checked_in'];
const round1 = (n: number | null) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Records one view per viewer per day (the top of the funnel). */
export const recordView = async (db: DB, eventId: string, viewerKey: string, now: Date) => {
  const nowIso = now.toISOString();
  await db
    .insertInto('event_views')
    .values({ event_id: eventId, viewer_key: viewerKey, day: nowIso.slice(0, 10), created_at: nowIso })
    .onConflict(oc => oc.columns(['event_id', 'viewer_key', 'day']).doNothing())
    .execute();
};

const DIMENSIONS = ['content_rating', 'speaker_rating', 'organization_rating', 'venue_rating', 'registration_rating'] as const;

const feedbackSummary = async (db: DB, eventIds: string[]) => {
  if (eventIds.length === 0) return { count: 0, overall: null, dimensions: {} as Record<string, number | null>, wouldAttendAgain: null };
  const rows = await db
    .selectFrom('feedback')
    .innerJoin('registrations', 'registrations.id', 'feedback.registration_id')
    .select(['feedback.rating', 'feedback.would_attend_again', ...DIMENSIONS.map(d => `feedback.${d}` as const)])
    .where('registrations.event_id', 'in', eventIds)
    .execute();
  const avg = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const dimensions: Record<string, number | null> = {};
  for (const d of DIMENSIONS) dimensions[d.replace('_rating', '')] = avg(rows.map(r => r[d]));
  const answered = rows.filter(r => r.would_attend_again !== null);
  return {
    count: rows.length,
    overall: avg(rows.map(r => r.rating)),
    dimensions,
    wouldAttendAgain: answered.length ? pct(answered.filter(r => r.would_attend_again === 1).length, answered.length) : null,
  };
};

/** Views → registrations → attendance → feedback for one event, with the organization's past events for comparison. */
export const eventAnalytics = async (db: DB, event: EventRow, now: Date) => {
  const [views, regs] = await Promise.all([
    db.selectFrom('event_views').select(['viewer_key', 'day']).where('event_id', '=', event.id).execute(),
    db.selectFrom('registrations').select(['status', 'created_at']).where('event_id', '=', event.id).execute(),
  ]);
  const uniqueViewers = new Set(views.map(v => v.viewer_key)).size;
  const registered = regs.filter(r => (ACTIVE_REGISTRATION_STATUSES as readonly string[]).includes(r.status)).length;
  const everRegistered = regs.filter(r => r.status !== 'waitlisted' && r.status !== 'waitlist_expired').length;
  const attended = regs.filter(r => ATTENDED.includes(r.status)).length;
  const noShow = regs.filter(r => r.status === 'no_show').length;
  const waitlisted = regs.filter(r => r.status === 'waitlisted' || r.status === 'offer_pending').length;
  const feedback = await feedbackSummary(db, [event.id]);

  // Trend: the same organization's other completed events.
  const past = await db
    .selectFrom('events')
    .select(['id'])
    .where('organization_id', '=', event.organization_id)
    .where('id', '<>', event.id)
    .where('status', '=', 'published')
    .where('ends_at', '<=', now.toISOString())
    .execute();
  const pastIds = past.map(p => p.id);
  let pastAttendanceRate: number | null = null;
  if (pastIds.length) {
    const rows = await db.selectFrom('registrations').select('status').where('event_id', 'in', pastIds).where('status', 'in', ['attended', 'no_show']).execute();
    pastAttendanceRate = pct(rows.filter(r => r.status === 'attended').length, rows.length);
  }
  const pastFeedback = await feedbackSummary(db, pastIds);

  const viewsPerDay = new Map<string, number>();
  for (const v of views) viewsPerDay.set(v.day, (viewsPerDay.get(v.day) ?? 0) + 1);

  return {
    funnel: {
      views: uniqueViewers,
      registrations: everRegistered,
      attended,
      feedback: feedback.count,
      viewToRegistration: pct(everRegistered, uniqueViewers),
      registrationToAttendance: pct(attended, attended + noShow || registered),
      attendanceToFeedback: pct(feedback.count, attended),
    },
    capacity: event.capacity,
    fillRate: event.capacity === null ? null : pct(registered, event.capacity),
    waitlisted,
    noShowRate: pct(noShow, attended + noShow),
    feedback,
    comparison: { pastEvents: pastIds.length, pastAttendanceRate, pastAverageRating: pastFeedback.overall },
    viewsPerDay: [...viewsPerDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
  };
};

/**
 * Institution-wide insights (blueprint §6): participation by department and
 * year, demand by category, attendance vs registration, no-show rates and
 * organizer performance, for events starting in [from, to).
 */
export const adminInsights = async (db: DB, from: string, to: string) => {
  const events = await db
    .selectFrom('events')
    .innerJoin('categories', 'categories.id', 'events.category_id')
    .innerJoin('organizations', 'organizations.id', 'events.organization_id')
    .select(['events.id', 'events.capacity', 'events.category_id', 'categories.name as category', 'events.organization_id', 'organizations.name as organization'])
    .where('events.status', '=', 'published')
    .where('events.starts_at', '>=', from)
    .where('events.starts_at', '<', to)
    .execute();
  const ids = events.map(e => e.id);
  const regs = ids.length
    ? await db
        .selectFrom('registrations')
        .innerJoin('users', 'users.id', 'registrations.user_id')
        .select(['registrations.event_id', 'registrations.status', 'registrations.user_id', 'users.department', 'users.year'])
        .where('registrations.event_id', 'in', ids)
        .execute()
    : [];
  const feedbackRows = ids.length
    ? await db.selectFrom('feedback').innerJoin('registrations', 'registrations.id', 'feedback.registration_id').select(['registrations.event_id', 'feedback.rating']).where('registrations.event_id', 'in', ids).execute()
    : [];

  const isActive = (s: string) => (ACTIVE_REGISTRATION_STATUSES as readonly string[]).includes(s);
  const eventById = new Map(events.map(e => [e.id, e]));

  // By department × year: registrations, attended, unique students.
  const cohorts = new Map<string, { department: string; year: number | null; registrations: number; attended: number; students: Set<string> }>();
  for (const r of regs) {
    if (!isActive(r.status)) continue;
    const key = `${r.department ?? '—'}|${r.year ?? ''}`;
    const c = cohorts.get(key) ?? { department: r.department ?? '—', year: r.year, registrations: 0, attended: 0, students: new Set<string>() };
    c.registrations++;
    if (r.status === 'attended') c.attended++;
    c.students.add(r.user_id);
    cohorts.set(key, c);
  }

  const group = <K extends 'category' | 'organization'>(key: K) => {
    const out = new Map<string, { name: string; events: number; capacity: number; registrations: number; waitlisted: number; attended: number; noShow: number; ratings: number[] }>();
    for (const e of events) {
      const g = out.get(e[key]) ?? { name: e[key], events: 0, capacity: 0, registrations: 0, waitlisted: 0, attended: 0, noShow: 0, ratings: [] };
      g.events++;
      // Events without a capacity limit don't count toward fill rate.
      g.capacity += e.capacity ?? 0;
      out.set(e[key], g);
    }
    for (const r of regs) {
      const g = out.get(eventById.get(r.event_id)![key])!;
      if (isActive(r.status)) g.registrations++;
      if (r.status === 'waitlisted' || r.status === 'offer_pending') g.waitlisted++;
      if (r.status === 'attended') g.attended++;
      if (r.status === 'no_show') g.noShow++;
    }
    for (const f of feedbackRows) out.get(eventById.get(f.event_id)![key])!.ratings.push(f.rating);
    return [...out.values()]
      .map(({ ratings, ...g }) => ({
        ...g,
        fillRate: pct(g.registrations, g.capacity),
        attendanceRate: pct(g.attended, g.attended + g.noShow),
        noShowRate: pct(g.noShow, g.attended + g.noShow),
        averageRating: ratings.length ? round1(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
      }))
      .sort((a, b) => b.registrations - a.registrations);
  };

  const attended = regs.filter(r => r.status === 'attended').length;
  const noShow = regs.filter(r => r.status === 'no_show').length;
  return {
    range: { from, to },
    totals: {
      events: events.length,
      registrations: regs.filter(r => isActive(r.status)).length,
      uniqueStudents: new Set(regs.filter(r => isActive(r.status)).map(r => r.user_id)).size,
      attended,
      noShowRate: pct(noShow, attended + noShow),
      averageRating: feedbackRows.length ? round1(feedbackRows.reduce((a, f) => a + f.rating, 0) / feedbackRows.length) : null,
    },
    byCohort: [...cohorts.values()]
      .map(({ students, ...c }) => ({ ...c, students: students.size, attendanceRate: pct(c.attended, c.registrations) }))
      .sort((a, b) => a.department.localeCompare(b.department) || (a.year ?? 0) - (b.year ?? 0)),
    byCategory: group('category'),
    byOrganization: group('organization'),
  };
};
