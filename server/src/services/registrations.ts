import crypto from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DB } from '../db/index.ts';
import type { Database, EventQuestion, EventRow, Registration, RegistrationStatus, User } from '../db/types.ts';
import { ApiError } from '../http.ts';
import { newId, newRegistrationCode } from '../lib/ids.ts';
import { CLOSED_REGISTRATION_STATUSES, OPEN_REGISTRATION_STATUSES, availability, eventPhase, isEligible, parseJsonArray } from '../lib/rules.ts';
import { announceStatus, offerFreedSeats, recomputeTeam, seatsHeld, statusAfterSeat } from './lifecycle.ts';
import type { External } from './notifications.ts';
import { audit, notifyUsers } from './notifications.ts';
import { refundRegistrations } from './payments.ts';
import type { PaymentGateway } from './payments.ts';

/** What registration changes need beyond the database. Built from AppDeps in the routes. */
export interface RegistrationCtx {
  ext: External;
  gateway: PaymentGateway;
  paymentWindowMinutes: number;
}

type Trx = Transaction<Database>;

export const toRegistrationSummary = (r: Registration & { checked_in_at?: string | null }) => ({
  id: r.id,
  eventId: r.event_id,
  code: r.registration_code,
  status: r.status,
  source: r.source,
  createdAt: r.created_at,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  checkedInAt: r.checked_in_at ?? null,
  teamId: r.team_id,
  answers: r.answers ? (JSON.parse(r.answers) as Record<string, string>) : null,
  offerExpiresAt: r.offer_expires_at,
  paymentDueAt: r.payment_due_at,
});

export const isUniqueViolation = (err: unknown, column: string) =>
  err instanceof Error &&
  (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
  err.message.includes(column);

export const eventQuestions = (event: Pick<EventRow, 'questions'>) => parseJsonArray<EventQuestion>(event.questions) ?? [];

/** Checks answers against the organizer's questions (blueprint §4.5 step 3). */
const validateAnswers = (event: EventRow, answers: Record<string, string> | undefined) => {
  const questions = eventQuestions(event);
  const clean: Record<string, string> = {};
  for (const q of questions) {
    const value = (answers?.[q.id] ?? '').trim();
    if (!value) {
      if (q.required) throw new ApiError(400, 'invalid_answers', `Please answer: ${q.label}`);
      continue;
    }
    if (q.type === 'choice' && !(q.options ?? []).includes(value)) throw new ApiError(400, 'invalid_answers', `Choose one of the options for: ${q.label}`);
    if (value.length > 1000) throw new ApiError(400, 'invalid_answers', `Your answer to "${q.label}" is too long.`);
    clean[q.id] = value;
  }
  return questions.length ? JSON.stringify(clean) : null;
};

const TEAM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const newTeamCode = () => `TEAM-${Array.from({ length: 6 }, () => TEAM_CODE_ALPHABET[crypto.randomInt(TEAM_CODE_ALPHABET.length)]).join('')}`;

const activeMemberCount = async (trx: Trx, teamId: string) => {
  const row = await trx
    .selectFrom('registrations')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .where('team_id', '=', teamId)
    .where('status', 'not in', CLOSED_REGISTRATION_STATUSES)
    .executeTakeFirstOrThrow();
  return Number(row.n);
};

interface InsertInput {
  event: EventRow;
  userId: string;
  phone: string | null;
  source: Registration['source'];
  status: RegistrationStatus;
  teamId?: string | null;
  answers?: string | null;
  now: Date;
  paymentWindowMinutes: number;
}

/**
 * Inserts a registration inside the caller's transaction, after the caller
 * has checked the rules. Enforces invariant #1 (one active registration per
 * student and event) for every way in.
 */
const insertRegistration = async (trx: Trx, input: InsertInput) => {
  const existing = await trx
    .selectFrom('registrations')
    .select('id')
    .where('event_id', '=', input.event.id)
    .where('user_id', '=', input.userId)
    .where('status', 'not in', CLOSED_REGISTRATION_STATUSES)
    .executeTakeFirst();
  if (existing) {
    throw new ApiError(409, 'already_registered', input.source === 'self' ? 'You are already registered for this event.' : 'This student is already registered.');
  }

  const nowIso = input.now.toISOString();
  // Registration codes are random; retry on the (very unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const registration: Registration = {
      id: newId(),
      event_id: input.event.id,
      user_id: input.userId,
      status: input.status,
      registration_code: newRegistrationCode(),
      phone: input.phone,
      created_at: nowIso,
      cancelled_at: null,
      cancel_reason: null,
      source: input.source,
      team_id: input.teamId ?? null,
      answers: input.answers ?? null,
      offer_expires_at: null,
      payment_due_at: input.status === 'pending_payment' ? new Date(input.now.getTime() + input.paymentWindowMinutes * 60_000).toISOString() : null,
    };
    try {
      await trx.insertInto('registrations').values(registration).execute();
      return registration;
    } catch (err) {
      if (isUniqueViolation(err, 'registration_code')) continue;
      if (isUniqueViolation(err, 'registrations.event_id')) {
        throw new ApiError(409, 'already_registered', 'You are already registered for this event.');
      }
      throw err;
    }
  }
  throw new ApiError(500, 'code_generation_failed', 'Could not generate a registration code. Please try again.');
};

export interface RegisterInput {
  phone: string;
  answers?: Record<string, string>;
  /** Team events: start a team or join one with its invite code. */
  team?: { create: { name: string } } | { join: { code: string } };
  /** When the event is full, join the waitlist instead of failing. */
  waitlist?: boolean;
}

/**
 * Registers a student for an event (blueprint §4.5, invariants §8.3 #1–#3).
 *
 * Runs in one transaction. On SQLite, Kysely serializes transactions on the
 * single connection, so the seat count can't change between the check and
 * the insert. When moving to PostgreSQL, lock the event row
 * (`.forUpdate()` on the first select) so concurrent registrations for the
 * same event queue up instead of both taking the last seat.
 */
export const registerForEvent = async (db: DB, user: User, eventId: string, input: RegisterInput, now: Date, ctx: RegistrationCtx): Promise<Registration> => {
  const nowIso = now.toISOString();

  return db.transaction().execute(async trx => {
    const event = await trx.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirst();
    if (!event || (event.status !== 'published' && event.status !== 'cancelled')) {
      throw new ApiError(404, 'event_not_found', 'This event does not exist.');
    }
    if (event.status === 'cancelled') {
      throw new ApiError(409, 'event_cancelled', 'This event has been cancelled.');
    }

    const existing = await trx
      .selectFrom('registrations')
      .select('id')
      .where('event_id', '=', eventId)
      .where('user_id', '=', user.id)
      .where('status', 'not in', CLOSED_REGISTRATION_STATUSES)
      .executeTakeFirst();
    if (existing) {
      throw new ApiError(409, 'already_registered', 'You are already registered for this event.');
    }

    const state = availability(event, await seatsHeld(trx, eventId), now);
    if (state === 'no_registration') throw new ApiError(409, 'registration_not_available', 'This event doesn’t take registrations through EventEase.');
    if (state === 'not_open') throw new ApiError(409, 'registration_not_open', 'Registration has not opened yet.');
    if (state === 'closed') throw new ApiError(409, 'registration_closed', 'Registration for this event has closed.');
    if (!isEligible(event, user)) {
      throw new ApiError(403, 'not_eligible', `This event is open to: ${event.eligibility_text}.`);
    }
    const answers = validateAnswers(event, input.answers);

    let status: RegistrationStatus = statusAfterSeat(event);
    if (state === 'full') {
      // Waitlists are for individual registrations; a team needs its seats together.
      if (!event.waitlist_enabled || event.participation === 'team') throw new ApiError(409, 'event_full', 'This event is full.');
      if (!input.waitlist) throw new ApiError(409, 'event_full', 'This event is full. You can join the waitlist.');
      status = 'waitlisted';
    }

    // Teams (blueprint §3.3 Team): start one, or join with the invite code.
    let teamId: string | null = null;
    if (event.participation === 'team') {
      if (!input.team) throw new ApiError(400, 'team_required', 'This is a team event: create a team or join one with its invite code.');
      if ('create' in input.team) {
        const name = input.team.create.name.trim();
        const taken = await trx.selectFrom('teams').select('id').where('event_id', '=', eventId).where('name', '=', name).where('status', '<>', 'disbanded').executeTakeFirst();
        if (taken) throw new ApiError(409, 'team_name_taken', 'Another team already uses that name.');
        teamId = newId();
        await trx
          .insertInto('teams')
          .values({ id: teamId, event_id: eventId, name, leader_id: user.id, invite_code: newTeamCode(), status: 'forming', created_at: nowIso })
          .execute();
      } else {
        const team = await trx.selectFrom('teams').selectAll().where('invite_code', '=', input.team.join.code.trim().toUpperCase()).executeTakeFirst();
        if (!team || team.event_id !== eventId || team.status === 'disbanded') throw new ApiError(404, 'team_not_found', 'No team with that invite code for this event.');
        if (team.status === 'locked') throw new ApiError(409, 'team_locked', 'This team is locked.');
        if (event.team_max && (await activeMemberCount(trx, team.id)) >= event.team_max) {
          throw new ApiError(409, 'team_full', `This team already has the maximum of ${event.team_max} members.`);
        }
        teamId = team.id;
      }
    }

    const registration = await insertRegistration(trx, {
      event,
      userId: user.id,
      phone: input.phone,
      source: 'self',
      status,
      teamId,
      answers,
      now,
      paymentWindowMinutes: ctx.paymentWindowMinutes,
    });
    if (teamId) await recomputeTeam(trx, teamId);
    // Remember the phone for SMS updates (blueprint §4.1: contact fields are the student's to edit).
    if (!user.phone) await trx.updateTable('users').set({ phone: input.phone }).where('id', '=', user.id).execute();

    await announceStatus(trx, event, registration, ctx.ext, nowIso);
    await audit(trx, { actorId: user.id, action: 'registration.create', entityType: 'registration', entityId: registration.id, data: { status } }, nowIso);
    return registration;
  });
};

/** Shared by every way a registration is cancelled: team upkeep, refund, and offering the seat on. */
const releaseRegistration = async (trx: Trx, reg: Registration, reason: string, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  await trx.updateTable('registrations').set({ status: 'cancelled', cancelled_at: nowIso, cancel_reason: reason, offer_expires_at: null, payment_due_at: null }).where('id', '=', reg.id).execute();
  if (reg.team_id) await recomputeTeam(trx, reg.team_id);
  await refundRegistrations(trx, ctx.gateway, [reg.id], reason, nowIso, ctx.ext);
  if (reg.status !== 'waitlisted') await offerFreedSeats(trx, reg.event_id, now, ctx.ext);
};

/** Student cancels their own registration, or leaves the waitlist (blueprint §4.7). */
export const cancelRegistration = async (db: DB, user: User, registrationId: string, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();

  return db.transaction().execute(async trx => {
    const reg = await trx.selectFrom('registrations').selectAll().where('id', '=', registrationId).executeTakeFirst();
    if (!reg || reg.user_id !== user.id) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
    const event = await trx.selectFrom('events').selectAll().where('id', '=', reg.event_id).executeTakeFirstOrThrow();

    if (reg.status === 'cancelled' || reg.status === 'waitlist_expired') {
      throw new ApiError(409, 'already_cancelled', 'This registration is already cancelled.');
    }
    if (!(OPEN_REGISTRATION_STATUSES as readonly string[]).includes(reg.status)) {
      throw new ApiError(409, 'already_checked_in', "You've already checked in, so this registration can't be cancelled.");
    }
    if (now >= new Date(event.starts_at)) {
      throw new ApiError(409, 'event_started', 'Registrations can only be cancelled before the event starts.');
    }
    // The event's own cut-off applies to seats, not to waitlist places (blueprint §4.7).
    const holdsSeat = reg.status !== 'waitlisted' && reg.status !== 'offer_pending';
    if (holdsSeat && event.cancellation_cutoff_hours !== null && now.getTime() > new Date(event.starts_at).getTime() - event.cancellation_cutoff_hours * 3600_000) {
      throw new ApiError(409, 'cancellation_closed', `Cancellations for this event closed ${event.cancellation_cutoff_hours} hours before the start.`);
    }

    const reason = reg.status === 'waitlisted' ? 'Left the waitlist' : reg.status === 'offer_pending' ? 'Declined the waitlist offer' : 'Cancelled by student';
    await releaseRegistration(trx, reg, reason, now, ctx);
    await notifyUsers(
      trx,
      [user.id],
      { category: 'registrations', title: 'Registration cancelled', body: `Your registration for ${event.title} was cancelled.`, link: `/event/${event.id}` },
      nowIso
    );
    await audit(trx, { actorId: user.id, action: 'registration.cancel', entityType: 'registration', entityId: registrationId, data: { from: reg.status } }, nowIso);
  });
};

/** Student takes the seat offered from the waitlist, if the offer hasn't expired. */
export const acceptOffer = async (db: DB, user: User, registrationId: string, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  return db.transaction().execute(async trx => {
    const reg = await trx.selectFrom('registrations').selectAll().where('id', '=', registrationId).executeTakeFirst();
    if (!reg || reg.user_id !== user.id) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
    if (reg.status !== 'offer_pending') throw new ApiError(409, 'no_offer', 'There is no seat offer to accept.');
    if (new Date(reg.offer_expires_at!) <= now) throw new ApiError(409, 'offer_expired', 'This offer has expired.');

    const event = await trx.selectFrom('events').selectAll().where('id', '=', reg.event_id).executeTakeFirstOrThrow();
    const status = statusAfterSeat(event);
    const paymentDue = status === 'pending_payment' ? new Date(now.getTime() + ctx.paymentWindowMinutes * 60_000).toISOString() : null;
    await trx.updateTable('registrations').set({ status, offer_expires_at: null, payment_due_at: paymentDue }).where('id', '=', reg.id).execute();
    const updated = { ...reg, status, offer_expires_at: null, payment_due_at: paymentDue };
    await announceStatus(trx, event, updated, ctx.ext, nowIso);
    await audit(trx, { actorId: user.id, action: 'registration.accept_offer', entityType: 'registration', entityId: reg.id }, nowIso);
    return updated;
  });
};

/**
 * An organizer adds a student by roll number (blueprint §5 Participants:
 * "manual add/remove with a reason, logged"). The organizer's decision
 * overrides the registration window, eligibility, fee and documents, but never
 * capacity or the one-registration rule.
 */
export const addRegistrationByOrganizer = async (db: DB, actor: User, event: EventRow, input: { universityId: string; reason: string }, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  if (event.status !== 'published') throw new ApiError(409, 'not_published', 'Students can only be added to published events.');
  if (eventPhase(event, now) === 'completed') throw new ApiError(409, 'event_ended', 'This event has already ended.');

  return db.transaction().execute(async trx => {
    const student = await trx
      .selectFrom('users')
      .select(['id', 'name'])
      .where('university_id', '=', input.universityId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!student) throw new ApiError(404, 'student_not_found', `No active student with roll number ${input.universityId}.`);
    if (event.registration_mode !== 'eventease') throw new ApiError(409, 'registration_not_available', 'This event doesn’t take registrations through EventEase.');
    if (event.capacity !== null && (await seatsHeld(trx, event.id)) >= event.capacity) throw new ApiError(409, 'event_full', 'This event is full.');

    const registration = await insertRegistration(trx, {
      event,
      userId: student.id,
      phone: null,
      source: 'organizer',
      status: 'confirmed',
      now,
      paymentWindowMinutes: ctx.paymentWindowMinutes,
    });
    await announceStatus(trx, event, registration, ctx.ext, nowIso);
    await audit(
      trx,
      { actorId: actor.id, action: 'registration.add_by_organizer', entityType: 'registration', entityId: registration.id, data: { reason: input.reason } },
      nowIso
    );
    return { registration, studentName: student.name };
  });
};

/** An organizer removes a student before they check in, with a reason the student sees. Paid fees are refunded. */
export const removeRegistrationByOrganizer = async (db: DB, actor: User, event: EventRow, registrationId: string, reason: string, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  return db.transaction().execute(async trx => {
    const reg = await trx.selectFrom('registrations').selectAll().where('id', '=', registrationId).where('event_id', '=', event.id).executeTakeFirst();
    if (!reg) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
    if (reg.status === 'cancelled' || reg.status === 'waitlist_expired') throw new ApiError(409, 'already_cancelled', 'This registration is already cancelled.');
    if (!(OPEN_REGISTRATION_STATUSES as readonly string[]).includes(reg.status)) {
      throw new ApiError(409, 'already_checked_in', 'Students who have checked in can’t be removed.');
    }

    await releaseRegistration(trx, reg, `Removed by the organizer: ${reason}`, now, ctx);
    await notifyUsers(
      trx,
      [reg.user_id],
      { category: 'registrations', title: `Registration cancelled: ${event.title}`, body: `The organizer cancelled your registration. Reason: ${reason}`, link: `/event/${event.id}` },
      nowIso,
      { external: ctx.ext }
    );
    await audit(trx, { actorId: actor.id, action: 'registration.remove_by_organizer', entityType: 'registration', entityId: reg.id, data: { reason } }, nowIso);
  });
};

// ---------- Scheduled expiries (called by the scheduler) ----------

/** Offers not accepted in time move on to the next person (blueprint §3.3). */
export const expireOffers = async (db: DB, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  const expired = await db.selectFrom('registrations').selectAll().where('status', '=', 'offer_pending').where('offer_expires_at', '<=', nowIso).execute();
  for (const reg of expired) {
    await db.transaction().execute(async trx => {
      await trx.updateTable('registrations').set({ status: 'waitlist_expired', offer_expires_at: null }).where('id', '=', reg.id).where('status', '=', 'offer_pending').execute();
      const event = await trx.selectFrom('events').select('title').where('id', '=', reg.event_id).executeTakeFirstOrThrow();
      await notifyUsers(trx, [reg.user_id], { category: 'waitlist', title: `Seat offer expired: ${event.title}`, body: 'The seat has gone to the next person on the waitlist.', link: `/event/${reg.event_id}` }, nowIso);
      await offerFreedSeats(trx, reg.event_id, now, ctx.ext);
    });
  }
  return expired.length;
};

/** Seats held for a payment that never arrived go back to the pool (and the waitlist). */
export const expireUnpaid = async (db: DB, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  const unpaid = await db.selectFrom('registrations').selectAll().where('status', '=', 'pending_payment').where('payment_due_at', '<=', nowIso).execute();
  for (const reg of unpaid) {
    await db.transaction().execute(async trx => {
      await releaseRegistration(trx, reg, 'Payment not completed in time', now, ctx);
      const event = await trx.selectFrom('events').select('title').where('id', '=', reg.event_id).executeTakeFirstOrThrow();
      await notifyUsers(trx, [reg.user_id], { category: 'payments', title: `Seat released: ${event.title}`, body: 'Payment wasn’t completed in time, so your seat was released. You can register again if seats remain.', link: `/event/${reg.event_id}` }, nowIso);
    });
  }
  return unpaid.length;
};

/**
 * When registration closes, teams are locked (blueprint §3.3 Team). Teams
 * below the minimum size can't compete, so their registrations are cancelled.
 */
export const lockTeams = async (db: DB, now: Date, ctx: RegistrationCtx) => {
  const nowIso = now.toISOString();
  const teams = await db
    .selectFrom('teams')
    .innerJoin('events', 'events.id', 'teams.event_id')
    .select(['teams.id', 'teams.name', 'teams.status', 'events.title', 'events.id as event_id'])
    .where('teams.status', 'in', ['forming', 'complete'])
    .where('events.registration_closes_at', '<=', nowIso)
    .execute();
  for (const team of teams) {
    await db.transaction().execute(async trx => {
      const members = await trx.selectFrom('registrations').selectAll().where('team_id', '=', team.id).where('status', 'not in', CLOSED_REGISTRATION_STATUSES).execute();
      if (team.status === 'complete') {
        await trx.updateTable('teams').set({ status: 'locked' }).where('id', '=', team.id).execute();
        await notifyUsers(trx, members.map(m => m.user_id), { category: 'registrations', title: `Team locked: ${team.name}`, body: `Registration for ${team.title} has closed and your team is final.`, link: `/register-success/${team.event_id}` }, nowIso);
        return;
      }
      for (const m of members) await releaseRegistration(trx, m, "Team didn't reach the minimum size before registration closed", now, ctx);
      await trx.updateTable('teams').set({ status: 'disbanded' }).where('id', '=', team.id).execute();
      await notifyUsers(
        trx,
        members.map(m => m.user_id),
        { category: 'registrations', title: `Team not registered: ${team.name}`, body: `Your team didn't reach the minimum size for ${team.title} before registration closed, so its registrations were cancelled.`, link: `/event/${team.event_id}` },
        nowIso,
        { external: ctx.ext }
      );
    });
  }
  return teams.length;
};
