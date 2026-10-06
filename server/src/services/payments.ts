import crypto from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DB } from '../db/index.ts';
import type { Database } from '../db/types.ts';
import { newId } from '../lib/ids.ts';
import { announceStatus, statusAfterPayment } from './lifecycle.ts';
import type { External } from './notifications.ts';
import { audit, notifyUsers } from './notifications.ts';

/**
 * Payments for paid events (blueprint §4.5 step 5, V5).
 *
 * The registration is confirmed on the gateway's signed webhook, never on the
 * browser's redirect alone. Until then it is `pending_payment` and holds its
 * seat for a limited time (the scheduler releases unpaid seats).
 *
 * The built-in mock gateway behaves like a real one (orders, signed webhooks,
 * refunds) so the whole flow can be tested. To connect Razorpay or another
 * gateway, implement `PaymentGateway` with its SDK and point its webhook at
 * POST /api/payments/webhook.
 */

export interface PaymentGateway {
  name: string;
  createOrder(input: { amount: number; currency: 'INR'; receipt: string }): Promise<{ orderId: string }>;
  refund(input: { paymentId: string; amount: number }): Promise<{ refundId: string }>;
}

const randomRef = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

export const mockGateway: PaymentGateway = {
  name: 'mock',
  async createOrder() {
    return { orderId: randomRef('order') };
  },
  async refund() {
    return { refundId: randomRef('rfnd') };
  },
};

export interface WebhookPayload {
  event: 'payment.captured' | 'payment.failed';
  orderId: string;
  paymentId: string;
}

export const signWebhook = (rawBody: string, secret: string) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

export const verifyWebhookSignature = (rawBody: string, signature: string | undefined, secret: string) => {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(rawBody, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

/**
 * The payment that matters for a registration: the paid (or refunded) one if
 * any, otherwise the newest attempt. Earlier failed attempts don't count.
 */
export const effectivePayment = <T extends { status: string; created_at: string }>(payments: T[]): T | null => {
  const settled = payments.find(p => p.status === 'paid' || p.status === 'refunded');
  if (settled) return settled;
  return [...payments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
};

/** Opens a gateway order for a registration waiting for payment. */
export const startPayment = async (db: DB, gateway: PaymentGateway, registrationId: string, now: Date) => {
  const row = await db
    .selectFrom('registrations')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select(['registrations.id', 'registrations.status', 'registrations.registration_code', 'registrations.payment_due_at', 'events.fee_amount', 'events.title'])
    .where('registrations.id', '=', registrationId)
    .executeTakeFirstOrThrow();
  if (row.status !== 'pending_payment') return null;

  const amount = row.fee_amount ?? 0;
  const { orderId } = await gateway.createOrder({ amount, currency: 'INR', receipt: row.registration_code });
  await db
    .insertInto('payments')
    .values({
      id: newId(),
      registration_id: row.id,
      amount,
      currency: 'INR',
      gateway: gateway.name,
      gateway_order_id: orderId,
      gateway_payment_id: null,
      status: 'created',
      created_at: now.toISOString(),
      paid_at: null,
      refunded_at: null,
      refund_ref: null,
    })
    .execute();
  return { orderId, amount, currency: 'INR' as const, eventTitle: row.title, dueAt: row.payment_due_at };
};

/**
 * Refunds the paid payment for each registration (cancellation by the
 * student, the organizer, or of the whole event). Runs last in the caller's
 * transaction, so a failed refund rolls the cancellation back.
 */
export const refundRegistrations = async (trx: Transaction<Database>, gateway: PaymentGateway, registrationIds: string[], reason: string, nowIso: string, ext: External) => {
  if (registrationIds.length === 0) return 0;
  const paid = await trx
    .selectFrom('payments')
    .innerJoin('registrations', 'registrations.id', 'payments.registration_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select(['payments.id', 'payments.amount', 'payments.gateway_payment_id', 'registrations.user_id', 'events.title'])
    .where('payments.registration_id', 'in', registrationIds)
    .where('payments.status', '=', 'paid')
    .execute();
  for (const p of paid) {
    const { refundId } = await gateway.refund({ paymentId: p.gateway_payment_id!, amount: p.amount });
    await trx.updateTable('payments').set({ status: 'refunded', refunded_at: nowIso, refund_ref: refundId }).where('id', '=', p.id).execute();
    await notifyUsers(
      trx,
      [p.user_id],
      { category: 'payments', title: `Refund issued: ${p.title}`, body: `₹${(p.amount / 100).toFixed(2)} is being refunded to your original payment method. ${reason}`, link: '/my-events' },
      nowIso,
      { external: ext }
    );
    await audit(trx, { actorId: null, action: 'payment.refund', entityType: 'payment', entityId: p.id, data: { refundId, reason } }, nowIso);
  }
  return paid.length;
};

/**
 * Applies a verified gateway webhook. Idempotent: gateways retry webhooks,
 * so a repeat of an event already applied changes nothing.
 */
export const handlePaymentWebhook = async (db: DB, gateway: PaymentGateway, payload: WebhookPayload, now: Date, ext: External) => {
  const nowIso = now.toISOString();
  return db.transaction().execute(async trx => {
    const payment = await trx.selectFrom('payments').selectAll().where('gateway_order_id', '=', payload.orderId).executeTakeFirst();
    if (!payment) return { applied: false, reason: 'unknown_order' as const };
    if (payment.status !== 'created') return { applied: false, reason: 'already_processed' as const };

    if (payload.event === 'payment.failed') {
      await trx.updateTable('payments').set({ status: 'failed', gateway_payment_id: payload.paymentId }).where('id', '=', payment.id).execute();
      return { applied: true, status: 'failed' as const };
    }

    await trx.updateTable('payments').set({ status: 'paid', paid_at: nowIso, gateway_payment_id: payload.paymentId }).where('id', '=', payment.id).execute();
    const registration = await trx.selectFrom('registrations').selectAll().where('id', '=', payment.registration_id).executeTakeFirstOrThrow();
    const event = await trx.selectFrom('events').selectAll().where('id', '=', registration.event_id).executeTakeFirstOrThrow();

    if (registration.status !== 'pending_payment') {
      // Paid after the seat was released (or the event was cancelled): give the money back.
      await refundRegistrations(trx, gateway, [registration.id], 'The payment arrived after your seat was released.', nowIso, ext);
      return { applied: true, status: 'refunded' as const };
    }
    const status = statusAfterPayment(event);
    await trx.updateTable('registrations').set({ status, payment_due_at: null }).where('id', '=', registration.id).execute();
    await audit(trx, { actorId: registration.user_id, action: 'payment.captured', entityType: 'payment', entityId: payment.id }, nowIso);
    await announceStatus(trx, event, { ...registration, status, payment_due_at: null }, ext, nowIso);
    return { applied: true, status };
  });
};
