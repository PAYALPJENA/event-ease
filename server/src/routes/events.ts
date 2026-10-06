import crypto from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { hasRole, organizationIdsFor, requireUser } from '../auth.ts';
import { ApiError, readJson, regCtx } from '../http.ts';
import type { AppEnv } from '../http.ts';
import { hashToken } from '../lib/ids.ts';
import { PHONE_REGEX } from '../lib/rules.ts';
import { recordView } from '../services/analytics.ts';
import { listResults } from '../services/certificates.ts';
import { PUBLIC_EVENT_STATUSES, eventQuery, recentChanges, toEventDto } from '../services/events.ts';
import { startPayment } from '../services/payments.ts';
import { registerForEvent, toRegistrationSummary } from '../services/registrations.ts';

export const eventRoutes = new Hono<AppEnv>();

eventRoutes.get('/events', async c => {
  const { db, now } = c.get('deps');
  const rows = await eventQuery(db).where('events.status', '=', 'published').orderBy('events.starts_at').execute();
  const current = now();
  return c.json({ events: rows.map(r => toEventDto(r, current)) });
});

eventRoutes.get('/events/:idOrSlug', async c => {
  const { db, now } = c.get('deps');
  const key = c.req.param('idOrSlug');
  const row = await eventQuery(db)
    .where(eb => eb.or([eb('events.id', '=', key), eb('events.slug', '=', key)]))
    .executeTakeFirst();

  if (!row) throw new ApiError(404, 'event_not_found', 'This event does not exist.');

  // Unpublished events (drafts, under review, rejected) are visible only to
  // staff who manage the event's organization.
  if (!(PUBLIC_EVENT_STATUSES as readonly string[]).includes(row.status)) {
    const user = c.get('user');
    const allowed = user && (hasRole(user, 'admin') || hasRole(user, 'organizer')) ? await organizationIdsFor(db, user) : [];
    if (allowed !== 'all' && (row.organization_id === null || !allowed.includes(row.organization_id))) {
      throw new ApiError(404, 'event_not_found', 'This event does not exist.');
    }
  }
  // Time/venue changes feed the change banner on the event page (§7.1);
  // published results appear after the event (§4.4).
  const changes = row.status === 'published' ? await recentChanges(db, row.id) : [];
  const results = row.results_published_at ? await listResults(db, row.id) : [];
  return c.json({ event: toEventDto(row, now()), changes, results });
});

eventRoutes.get('/categories', async c => {
  const categories = await c.get('deps').db.selectFrom('categories').select(['id', 'name', 'slug']).orderBy('position').orderBy('name').execute();
  return c.json({ categories });
});

/**
 * Counts a view for the analytics funnel (V4). One per viewer per day. The
 * viewer key is a hash of the user id, or of a random anonymous cookie, so
 * views can't be traced back to a person.
 */
const VISITOR_COOKIE = 'ee_vid';
eventRoutes.post('/events/:id/views', async c => {
  const { db, now, config } = c.get('deps');
  const event = await db.selectFrom('events').select(['id', 'status']).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!event || event.status !== 'published') return c.json({ ok: true });

  const user = c.get('user');
  let visitor = getCookie(c, VISITOR_COOKIE);
  if (!user && !visitor) {
    visitor = crypto.randomBytes(16).toString('base64url');
    setCookie(c, VISITOR_COOKIE, visitor, { httpOnly: true, sameSite: 'Lax', secure: config.secureCookies, path: '/', maxAge: 365 * 24 * 3600 });
  }
  await recordView(db, event.id, hashToken(user ? `user:${user.id}` : `anon:${visitor}`), now());
  return c.json({ ok: true });
});

const registerSchema = z.object({
  phone: z.string().trim().regex(PHONE_REGEX, 'Enter a valid 10-digit Indian mobile number.'),
  agree: z.literal(true, { error: 'You must agree to the event guidelines.' }),
  answers: z.record(z.string(), z.string().max(1000)).optional(),
  team: z
    .union([
      z.object({ create: z.object({ name: z.string().trim().min(2).max(60) }) }),
      z.object({ join: z.object({ code: z.string().trim().min(4).max(20) }) }),
    ])
    .optional(),
  waitlist: z.boolean().optional(),
});

eventRoutes.post('/events/:id/registrations', async c => {
  const user = requireUser(c);
  const input = await readJson(c, registerSchema);
  const { db, now, gateway } = c.get('deps');
  const registration = await registerForEvent(db, user, c.req.param('id'), input, now(), regCtx(c));
  // Paid events: open a gateway order after the seat is held (outside the transaction).
  const payment = registration.status === 'pending_payment' ? await startPayment(db, gateway, registration.id, now()) : null;
  return c.json({ registration: toRegistrationSummary(registration), payment }, 201);
});
