import { Hono } from 'hono';
import { z } from 'zod';
import { hasRole, organizationIdsFor, requireUser } from '../auth.ts';
import type { EventRow, User } from '../db/types.ts';
import { ApiError, readJson } from '../http.ts';
import type { AppContext, AppEnv } from '../http.ts';
import { checkIn, checkInStats } from '../services/checkins.ts';
import type { CheckInInput } from '../services/checkins.ts';

/**
 * Door check-in (blueprint §5, §8.3 #6). Open to the event's organizers and
 * admins, and to check-in volunteers assigned to that one event (§2.2) —
 * which is why these routes live outside /admin.
 */
export const checkInRoutes = new Hono<AppEnv>();

/** The event, if the signed-in user may run its door. */
const doorEvent = async (c: AppContext): Promise<{ user: User; event: EventRow }> => {
  const user = requireUser(c);
  const { db } = c.get('deps');
  const event = await db.selectFrom('events').selectAll().where('id', '=', c.req.param('id')!).executeTakeFirst();
  if (!event) throw new ApiError(404, 'event_not_found', 'This event does not exist.');

  const staffOrgs = hasRole(user, 'admin') || hasRole(user, 'organizer') ? await organizationIdsFor(db, user) : [];
  if (staffOrgs === 'all' || (event.organization_id !== null && staffOrgs.includes(event.organization_id))) return { user, event };
  const volunteer = await db.selectFrom('event_volunteers').select('user_id').where('event_id', '=', event.id).where('user_id', '=', user.id).executeTakeFirst();
  if (volunteer) return { user, event };
  throw new ApiError(403, 'forbidden', 'You are not on the check-in team for this event.');
};

/** Scans can reach the server late from an offline device, but never from the future. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_OFFLINE_AGE_MS = 7 * 24 * 3600_000;

const scanFields = {
  token: z.string().min(10).max(1000).optional(),
  registrationId: z.string().min(1).max(100).optional(),
  scannedAt: z.iso.datetime({ offset: true }).optional(),
  device: z.string().trim().max(120).optional(),
};

const toCheckInInput = (c: AppContext, scan: { token?: string; registrationId?: string; scannedAt?: string; device?: string }): CheckInInput => {
  if (!scan.token === !scan.registrationId) {
    throw new ApiError(400, 'validation_failed', 'Send either a pass token or a registration id.');
  }
  const now = c.get('deps').now();
  const scannedAt = scan.scannedAt ? new Date(scan.scannedAt) : now;
  if (scannedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS || now.getTime() - scannedAt.getTime() > MAX_OFFLINE_AGE_MS) {
    throw new ApiError(400, 'invalid_scan_time', 'The scan time is not plausible. Check the device clock.');
  }
  return { token: scan.token, registrationId: scan.registrationId, scannedAt, device: scan.device ?? null };
};

const assertCheckInOpen = (status: string) => {
  if (status !== 'published') throw new ApiError(409, 'not_published', 'Check-in is only available for published events.');
};

checkInRoutes.get('/events/:id', async c => {
  const { event } = await doorEvent(c);
  return c.json({ event: { id: event.id, title: event.title, startsAt: event.starts_at, endsAt: event.ends_at, status: event.status } });
});

/**
 * The door list, cached on the device for offline lookup. Only what the door
 * needs (§9.2): name, roll number, department/year, code and status.
 */
checkInRoutes.get('/events/:id/roster', async c => {
  const { event } = await doorEvent(c);
  const rows = await c
    .get('deps')
    .db.selectFrom('registrations')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .leftJoin('check_ins', 'check_ins.registration_id', 'registrations.id')
    .select([
      'registrations.id',
      'registrations.registration_code as code',
      'registrations.status',
      'users.name',
      'users.university_id as universityId',
      'users.department',
      'users.year',
      'check_ins.scanned_at as checkedInAt',
    ])
    .where('registrations.event_id', '=', event.id)
    .where('registrations.status', 'not in', ['waitlisted', 'waitlist_expired'])
    .orderBy('users.name')
    .execute();
  return c.json({ roster: rows });
});

checkInRoutes.post('/events/:id/scans', async c => {
  const { user, event } = await doorEvent(c);
  const scan = await readJson(c, z.object(scanFields));
  assertCheckInOpen(event.status);
  const { db, now, config } = c.get('deps');
  const outcome = await checkIn(db, user, event, toCheckInInput(c, scan), now(), config.passSecret);
  return c.json({ ...outcome, stats: await checkInStats(db, event.id) });
});

/** Offline queue sync: scans made without a connection, replayed in order. */
checkInRoutes.post('/events/:id/scans/batch', async c => {
  const { user, event } = await doorEvent(c);
  const { items } = await readJson(c, z.object({ items: z.array(z.object({ clientId: z.string().min(1).max(100), ...scanFields })).min(1).max(200) }));
  assertCheckInOpen(event.status);
  const { db, now, config } = c.get('deps');

  const results = [];
  for (const item of items) {
    try {
      results.push({ clientId: item.clientId, ...(await checkIn(db, user, event, toCheckInInput(c, item), now(), config.passSecret)) });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      results.push({ clientId: item.clientId, result: 'error' as const, message: err.message });
    }
  }
  return c.json({ results, stats: await checkInStats(db, event.id) });
});

checkInRoutes.get('/events/:id/stats', async c => {
  const { event } = await doorEvent(c);
  return c.json(await checkInStats(c.get('deps').db, event.id));
});
