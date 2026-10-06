import type { Transaction } from 'kysely';
import type { DB } from '../db/index.ts';
import type { Database, EventRow, Registration, RegistrationStatus } from '../db/types.ts';
import { formatIstDateTime } from '../lib/format.ts';
import { ACTIVE_REGISTRATION_STATUSES, parseJsonArray } from '../lib/rules.ts';
import type { External } from './notifications.ts';
import { notifyUsers } from './notifications.ts';

/**
 * Registration lifecycle (blueprint §3.3): which state a registration moves
 * to next, what the student is told at each step, and how freed seats reach
 * the waitlist. Shared by registration, payments, documents and the scheduler.
 */

type Trx = Transaction<Database>;

export const requiredDocuments = (event: Pick<EventRow, 'required_documents'>) =>
  parseJsonArray<{ id: string; label: string }>(event.required_documents) ?? [];

/** Where a registration goes once it has a seat: pay first, then documents, then confirmed. */
export const statusAfterSeat = (event: Pick<EventRow, 'fee_amount' | 'required_documents'>): RegistrationStatus =>
  (event.fee_amount ?? 0) > 0 ? 'pending_payment' : statusAfterPayment(event);

export const statusAfterPayment = (event: Pick<EventRow, 'required_documents'>): RegistrationStatus =>
  requiredDocuments(event).length > 0 ? 'pending_documents' : 'confirmed';

export const seatsHeld = async (trx: Trx, eventId: string) => {
  const row = await trx
    .selectFrom('registrations')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', eventId)
    .where('status', 'in', ACTIVE_REGISTRATION_STATUSES)
    .executeTakeFirstOrThrow();
  return Number(row.n);
};

export const waitlistPosition = async (trx: Trx | DB, registration: Pick<Registration, 'event_id' | 'created_at' | 'status'>) => {
  if (registration.status !== 'waitlisted') return null;
  const row = await trx
    .selectFrom('registrations')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', registration.event_id)
    .where('status', '=', 'waitlisted')
    .where('created_at', '<', registration.created_at)
    .executeTakeFirstOrThrow();
  return Number(row.n) + 1;
};

/** Tells the student where their registration stands now (in-app, plus external channels). */
export const announceStatus = async (trx: Trx, event: EventRow, registration: Registration, ext: External, nowIso: string) => {
  const passLink = `/register-success/${event.id}`;
  const send = (category: 'registrations' | 'waitlist' | 'payments', title: string, body: string) =>
    notifyUsers(trx, [registration.user_id], { category, title, body, link: passLink }, nowIso, { external: ext });

  switch (registration.status) {
    case 'confirmed':
      return send(
        'registrations',
        `Registration confirmed: ${event.title}`,
        `You're registered for ${event.title}. Your registration ID is ${registration.registration_code}. Show your pass at the venue.`
      );
    case 'pending_documents': {
      const docs = requiredDocuments(event).map(d => d.label).join(', ');
      return send('registrations', `Documents needed: ${event.title}`, `Your seat is held. Upload ${docs} so the organizer can confirm your registration.`);
    }
    case 'waitlisted': {
      const position = await waitlistPosition(trx, registration);
      return send('waitlist', `On the waitlist: ${event.title}`, `${event.title} is full. You're #${position} on the waitlist; we'll offer you a seat if one frees up.`);
    }
    case 'offer_pending':
      return send(
        'waitlist',
        `A seat opened: ${event.title}`,
        `A seat is yours if you confirm by ${formatIstDateTime(registration.offer_expires_at!)}. After that it goes to the next person on the waitlist.`
      );
    default:
      return undefined;
  }
};

/**
 * Offers freed seats to the waitlist in order (blueprint §3.3 "Waitlist
 * offer"). Each offer holds the seat until it's accepted or expires.
 */
export const offerFreedSeats = async (trx: Trx, eventId: string, now: Date, ext: External) => {
  const event = await trx.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirstOrThrow();
  // No capacity limit means nobody waits, so there's nothing to offer.
  if (event.status !== 'published' || !event.waitlist_enabled || event.capacity === null || now >= new Date(event.starts_at)) return 0;

  let free = event.capacity - (await seatsHeld(trx, eventId));
  let offered = 0;
  while (free > 0) {
    const next = await trx
      .selectFrom('registrations')
      .selectAll()
      .where('event_id', '=', eventId)
      .where('status', '=', 'waitlisted')
      .orderBy('created_at')
      .executeTakeFirst();
    if (!next) break;
    // The offer can't outlast the start of the event.
    const expires = new Date(Math.min(now.getTime() + event.offer_window_hours * 3600_000, new Date(event.starts_at).getTime()));
    const updated = { ...next, status: 'offer_pending' as const, offer_expires_at: expires.toISOString() };
    await trx.updateTable('registrations').set({ status: updated.status, offer_expires_at: updated.offer_expires_at }).where('id', '=', next.id).execute();
    await announceStatus(trx, event, updated, ext, now.toISOString());
    free--;
    offered++;
  }
  return offered;
};

/** Team status follows its size: forming → complete at the minimum. Locked and disbanded teams stay put. */
export const recomputeTeam = async (trx: Trx, teamId: string) => {
  const team = await trx
    .selectFrom('teams')
    .innerJoin('events', 'events.id', 'teams.event_id')
    .select(['teams.id', 'teams.status', 'teams.leader_id', 'events.team_min'])
    .where('teams.id', '=', teamId)
    .executeTakeFirstOrThrow();
  if (team.status === 'locked' || team.status === 'disbanded') return;

  const members = await trx
    .selectFrom('registrations')
    .select(['id', 'user_id', 'created_at'])
    .where('team_id', '=', teamId)
    .where('status', 'not in', ['cancelled', 'waitlist_expired'])
    .orderBy('created_at')
    .execute();
  if (members.length === 0) {
    await trx.updateTable('teams').set({ status: 'disbanded' }).where('id', '=', teamId).execute();
    return;
  }
  // If the leader left, the longest-standing member leads.
  const leaderId = members.some(m => m.user_id === team.leader_id) ? team.leader_id : members[0].user_id;
  const status = members.length >= (team.team_min ?? 1) ? 'complete' : 'forming';
  await trx.updateTable('teams').set({ status, leader_id: leaderId }).where('id', '=', teamId).execute();
};
