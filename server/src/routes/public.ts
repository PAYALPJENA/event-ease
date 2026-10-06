import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { ApiError, extOf, readJson } from '../http.ts';
import type { AppEnv } from '../http.ts';
import { buildCalendar } from '../lib/ics.ts';
import { hashToken } from '../lib/ids.ts';
import { isEligible, parseJsonArray } from '../lib/rules.ts';
import { verifyCertificate } from '../services/certificates.ts';
import { eventQuery, toEventDto } from '../services/events.ts';
import { handlePaymentWebhook, verifyWebhookSignature } from '../services/payments.ts';
import type { WebhookPayload } from '../services/payments.ts';

/**
 * Routes that anyone can reach: the club directory, opportunities,
 * certificate verification, the calendar feed (authenticated by its secret
 * URL), the payment gateway's webhook, and the push public key.
 */
export const publicRoutes = new Hono<AppEnv>();

// ---------- Clubs (blueprint §4.11) ----------

const orgDto = (o: { id: string; type: string; name: string; slug: string; description: string | null; contact_email: string | null; logo_url: string | null; social_links: string; recruitment: string | null }) => ({
  id: o.id,
  type: o.type,
  name: o.name,
  slug: o.slug,
  description: o.description,
  contactEmail: o.contact_email,
  logoUrl: o.logo_url,
  socialLinks: JSON.parse(o.social_links) as Record<string, string>,
  recruitment: o.recruitment,
});

publicRoutes.get('/clubs', async c => {
  const { db, now } = c.get('deps');
  const nowIso = now().toISOString();
  const orgs = await db
    .selectFrom('organizations')
    .selectAll()
    .select([
      eb => eb.selectFrom('follows').select(eb2 => eb2.fn.countAll<number>().as('n')).whereRef('follows.organization_id', '=', 'organizations.id').as('followers'),
      eb =>
        eb
          .selectFrom('events')
          .select(eb2 => eb2.fn.countAll<number>().as('n'))
          .whereRef('events.organization_id', '=', 'organizations.id')
          .where('events.status', '=', 'published')
          .where('events.ends_at', '>', nowIso)
          .as('upcoming'),
    ])
    .where('status', '=', 'active')
    .orderBy('name')
    .execute();
  return c.json({ clubs: orgs.map(o => ({ ...orgDto(o), followers: Number(o.followers ?? 0), upcomingEvents: Number(o.upcoming ?? 0) })) });
});

publicRoutes.get('/clubs/:slug', async c => {
  const { db, now } = c.get('deps');
  const org = await db.selectFrom('organizations').selectAll().where('slug', '=', c.req.param('slug')).where('status', '=', 'active').executeTakeFirst();
  if (!org) throw new ApiError(404, 'club_not_found', 'This club does not exist.');
  const [events, followers, leads] = await Promise.all([
    eventQuery(db).where('events.organization_id', '=', org.id).where('events.status', 'in', ['published', 'cancelled']).orderBy('events.starts_at', 'desc').limit(30).execute(),
    db.selectFrom('follows').select(eb => eb.fn.countAll<number>().as('n')).where('organization_id', '=', org.id).executeTakeFirstOrThrow(),
    // Leads and organizers are the club's public contacts; ordinary members stay private (§9.2).
    db
      .selectFrom('organization_members')
      .innerJoin('users', 'users.id', 'organization_members.user_id')
      .select(['users.name', 'organization_members.role'])
      .where('organization_members.organization_id', '=', org.id)
      .where('organization_members.role', 'in', ['lead', 'organizer'])
      .execute(),
  ]);
  const current = now();
  return c.json({ club: { ...orgDto(org), followers: Number(followers.n), contacts: leads }, events: events.map(e => toEventDto(e, current)) });
});

// ---------- Opportunities (blueprint §4.12) ----------

const opportunityDto = (o: {
  id: string; type: string; title: string; provider: string; description: string; deadline: string; eligibility_text: string;
  eligible_departments: string | null; eligible_years: string | null; external_url: string | null; tags: string; organization_id: string | null; status: string;
}) => ({
  id: o.id,
  type: o.type,
  title: o.title,
  provider: o.provider,
  description: o.description,
  deadline: o.deadline,
  eligibilityText: o.eligibility_text,
  eligibleDepartments: parseJsonArray<string>(o.eligible_departments),
  eligibleYears: parseJsonArray<number>(o.eligible_years),
  externalUrl: o.external_url,
  tags: parseJsonArray<string>(o.tags) ?? [],
  organizationId: o.organization_id,
  status: o.status,
});
export { opportunityDto };

publicRoutes.get('/opportunities', async c => {
  const { db, now } = c.get('deps');
  const rows = await db.selectFrom('opportunities').selectAll().where('status', '=', 'published').where('deadline', '>', now().toISOString()).orderBy('deadline').execute();
  const user = c.get('user');
  return c.json({ opportunities: rows.map(o => ({ ...opportunityDto(o), eligible: user ? isEligible(o, user) : null })) });
});

publicRoutes.get('/opportunities/:id', async c => {
  const o = await c.get('deps').db.selectFrom('opportunities').selectAll().where('id', '=', c.req.param('id')).where('status', '=', 'published').executeTakeFirst();
  if (!o) throw new ApiError(404, 'opportunity_not_found', 'This opportunity does not exist.');
  const user = c.get('user');
  return c.json({ opportunity: { ...opportunityDto(o), eligible: user ? isEligible(o, user) : null } });
});

// ---------- Certificate verification (blueprint §4.13) ----------

publicRoutes.get('/verify/:code', async c => c.json(await verifyCertificate(c.get('deps').db, c.req.param('code'))));

// ---------- Calendar subscription feed (blueprint §4.8) ----------

publicRoutes.get('/calendar/:file', async c => {
  const token = c.req.param('file').replace(/\.ics$/, '');
  const { db, config, now } = c.get('deps');
  const feed = await db
    .selectFrom('calendar_feeds')
    .innerJoin('users', 'users.id', 'calendar_feeds.user_id')
    .select(['users.id', 'users.name'])
    .where('calendar_feeds.token_hash', '=', hashToken(token))
    .where('users.status', '=', 'active')
    .executeTakeFirst();
  if (!feed) return c.text('Not found', 404);

  const since = new Date(now().getTime() - 60 * 24 * 3600_000).toISOString();
  const rows = await db
    .selectFrom('registrations')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .leftJoin('venues', 'venues.id', 'events.venue_id')
    .select(['registrations.id', 'registrations.status', 'events.id as event_id', 'events.title', 'events.summary', 'events.starts_at', 'events.ends_at', 'events.updated_at', 'events.status as event_status', 'events.mode', 'events.online_url', 'venues.name as venue'])
    .where('registrations.user_id', '=', feed.id)
    .where('registrations.status', 'in', ['confirmed', 'checked_in', 'attended', 'pending_documents', 'pending_payment', 'cancelled'])
    .where('events.ends_at', '>', since)
    .execute();
  // A registration cancelled because the event was cancelled stays in the feed as CANCELLED, so calendars remove it.
  const events = rows
    .filter(r => r.status !== 'cancelled' || r.event_status === 'cancelled')
    .map(r => ({
      uid: r.id,
      title: r.title,
      description: `${r.summary ?? ''}\n\nPass and details: ${config.appUrl}/register-success/${r.event_id}`.trim(),
      location: r.venue ?? (r.mode === 'online' ? r.online_url ?? 'Online' : ''),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      url: `${config.appUrl}/event/${r.event_id}`,
      cancelled: r.event_status === 'cancelled',
      updatedAt: r.updated_at,
    }));
  return c.body(buildCalendar(`EventEase — ${feed.name}`, events), 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' });
});

// ---------- Payments (V5) ----------

/** The gateway's webhook: the only thing that confirms a payment (blueprint §4.5 step 5). */
publicRoutes.post('/payments/webhook', async c => {
  const raw = await c.req.text();
  const { db, gateway, config, now } = c.get('deps');
  if (!verifyWebhookSignature(raw, c.req.header('x-signature'), config.paymentWebhookSecret)) {
    throw new ApiError(401, 'invalid_signature', 'Invalid webhook signature.');
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  return c.json(await handlePaymentWebhook(db, gateway, payload, now(), extOf(c)));
});

/** The checkout page's order summary (the student's own orders only). */
publicRoutes.get('/payments/orders/:orderId', async c => {
  const user = requireUser(c);
  const row = await c
    .get('deps')
    .db.selectFrom('payments')
    .innerJoin('registrations', 'registrations.id', 'payments.registration_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select(['payments.gateway_order_id', 'payments.amount', 'payments.status', 'registrations.user_id', 'registrations.payment_due_at', 'events.id as event_id', 'events.title'])
    .where('payments.gateway_order_id', '=', c.req.param('orderId'))
    .executeTakeFirst();
  if (!row || row.user_id !== user.id) throw new ApiError(404, 'order_not_found', 'Order not found.');
  return c.json({ order: { orderId: row.gateway_order_id, amount: row.amount, status: row.status, dueAt: row.payment_due_at, event: { id: row.event_id, title: row.title } } });
});

/**
 * Development only: the mock gateway's checkout. It builds the payload a real
 * gateway would send to the webhook and applies it through the same code path
 * as POST /payments/webhook (which additionally checks the signature).
 */
publicRoutes.post('/payments/mock-checkout/:orderId', async c => {
  const user = requireUser(c);
  const { outcome } = await readJson(c, z.object({ outcome: z.enum(['success', 'failure']) }));
  const { db, gateway, config, now } = c.get('deps');
  if (config.paymentGateway !== 'mock') throw new ApiError(404, 'not_found', 'Not found.');
  const order = await db
    .selectFrom('payments')
    .innerJoin('registrations', 'registrations.id', 'payments.registration_id')
    .select(['payments.gateway_order_id', 'registrations.user_id'])
    .where('payments.gateway_order_id', '=', c.req.param('orderId'))
    .executeTakeFirst();
  if (!order || order.user_id !== user.id) throw new ApiError(404, 'order_not_found', 'Order not found.');

  const payload: WebhookPayload = {
    event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
    orderId: order.gateway_order_id,
    paymentId: `pay_${crypto.randomBytes(9).toString('base64url')}`,
  };
  return c.json(await handlePaymentWebhook(db, gateway, payload, now(), extOf(c)));
});

// ---------- Push (V5) ----------

publicRoutes.get('/push/public-key', c => c.json({ publicKey: c.get('deps').config.vapidPublicKey, enabled: c.get('deps').config.pushMode !== 'none' }));
