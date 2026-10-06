import type { Transaction } from 'kysely';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/index.ts';
import type { Database, EventRow } from '../db/types.ts';
import { formatIstDate, formatIstDateTime, formatIstTime, istDayKey, nextIstMorning } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import type { Senders } from '../lib/channels.ts';
import { UPCOMING_REGISTRATION_STATUSES, isEligible } from '../lib/rules.ts';
import { externalFrom, notifyUsers } from './notifications.ts';
import type { PaymentGateway } from './payments.ts';
import { expireOffers, expireUnpaid, lockTeams } from './registrations.ts';
import type { RegistrationCtx } from './registrations.ts';

/**
 * Server-side scheduled work (blueprint §7.2: "Reminders must be scheduled
 * and sent by the server").
 *
 * Rather than storing one job per reminder and rescheduling them whenever an
 * event moves, each tick works out what is due from the events themselves.
 * `scheduler_log` records what has run; its unique key includes the event
 * time the run was based on, so:
 *   - every reminder is sent once, even if two servers tick together;
 *   - an event that moves gets fresh reminders for its new time;
 *   - a cancelled registration simply stops receiving them.
 *
 *   T−7 days        "coming up" reminder              in-app
 *   T−1 day         "today"/"tomorrow" reminder        in-app + email
 *   close−24 h      "registration closes tomorrow"     in-app (students who saved it)
 *   end             checked_in → attended, confirmed → no_show, open waitlist places expire
 *   next morning    "How was it?" feedback request      in-app (attended only)
 *   deadline−24 h   saved opportunity closes tomorrow  in-app
 *   any time        waitlist offers and unpaid seats expire; teams lock when registration closes
 *
 * External channels (email, push, SMS/WhatsApp) follow each student's
 * notification preferences; delivery drains the outbox at the end of the tick.
 */

export interface SchedulerDeps {
  db: DB;
  config: Pick<AppConfig, 'appUrl' | 'smsMode' | 'whatsappMode' | 'paymentWindowMinutes'>;
  now: () => Date;
  senders: Senders;
  gateway: PaymentGateway;
}

const ctxOf = (deps: SchedulerDeps): RegistrationCtx => ({ ext: externalFrom(deps.config), gateway: deps.gateway, paymentWindowMinutes: deps.config.paymentWindowMinutes });

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Don't send a reminder that's this late (e.g. the server was down); it would only confuse. */
const FEEDBACK_REQUEST_WINDOW = 3 * DAY;
const MAX_DELIVERY_ATTEMPTS = 5;

/** Claims a run inside `trx`. False if it already ran; the claim rolls back if the work fails. */
const claim = async (trx: Transaction<Database>, kind: string, eventId: string, runKey: string, recipients: number, nowIso: string) => {
  const result = await trx
    .insertInto('scheduler_log')
    .values({ id: newId(), kind, event_id: eventId, run_key: runKey, ran_at: nowIso, recipients })
    .onConflict(oc => oc.columns(['kind', 'event_id', 'run_key']).doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
};

const upcomingRegistrants = (trx: Transaction<Database>, eventId: string) =>
  trx
    .selectFrom('registrations')
    .select('user_id')
    .where('event_id', '=', eventId)
    .where('status', 'in', UPCOMING_REGISTRATION_STATUSES)
    .execute()
    .then(rows => rows.map(r => r.user_id));

const whereLabel = async (trx: Transaction<Database>, event: EventRow) => {
  if (!event.venue_id) return 'online';
  const venue = await trx.selectFrom('venues').select('name').where('id', '=', event.venue_id).executeTakeFirst();
  return venue?.name ?? 'the venue';
};

const sendEventReminders = async (deps: SchedulerDeps, now: Date) => {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  // Events starting within the next 7 days.
  const events = await deps.db
    .selectFrom('events')
    .selectAll()
    .where('status', '=', 'published')
    .where('starts_at', '>', nowIso)
    .where('starts_at', '<=', new Date(nowMs + 7 * DAY).toISOString())
    .execute();

  let sent = 0;
  for (const event of events) {
    const startMs = new Date(event.starts_at).getTime();
    // The 7-day reminder only makes sense while the 1-day one isn't due yet.
    const kind = startMs - nowMs <= DAY ? 'reminder_1d' : 'reminder_7d';

    await deps.db.transaction().execute(async trx => {
      const userIds = await upcomingRegistrants(trx, event.id);
      if (!(await claim(trx, kind, event.id, event.starts_at, userIds.length, nowIso))) return;
      if (kind === 'reminder_1d') {
        const requirements = JSON.parse(event.requirements) as string[];
        // Within 24 hours of the start, the event is either later today or tomorrow (IST).
        const when = istDayKey(event.starts_at) === istDayKey(nowIso) ? 'today' : 'tomorrow';
        await notifyUsers(
          trx,
          userIds,
          {
            category: 'reminders',
            title: `${event.title} is ${when}`,
            body:
              `${event.title} starts ${formatIstDateTime(event.starts_at)} at ${await whereLabel(trx, event)}.` +
              (requirements.length ? ` Bring: ${requirements.join(', ')}.` : '') +
              ' Keep your pass ready.',
            link: `/register-success/${event.id}`,
          },
          nowIso,
          { external: externalFrom(deps.config) }
        );
      } else {
        await notifyUsers(
          trx,
          userIds,
          {
            category: 'reminders',
            title: `Coming up: ${event.title}`,
            body: `${event.title} is on ${formatIstDate(event.starts_at)} at ${formatIstTime(event.starts_at)}. Add it to your calendar so you don't miss it.`,
            link: `/event/${event.id}`,
          },
          nowIso
        );
      }
      sent += userIds.length;
    });
  }
  return sent;
};

const sendClosingReminders = async (deps: SchedulerDeps, now: Date) => {
  const nowIso = now.toISOString();
  const events = await deps.db
    .selectFrom('events')
    .selectAll()
    .where('status', '=', 'published')
    .where('registration_opens_at', '<=', nowIso)
    .where('registration_closes_at', '>', nowIso)
    .where('registration_closes_at', '<=', new Date(now.getTime() + DAY).toISOString())
    .execute();

  let sent = 0;
  for (const event of events) {
    await deps.db.transaction().execute(async trx => {
      // Students who saved the event, are eligible, and haven't registered.
      const savers = await trx
        .selectFrom('saved_events')
        .innerJoin('users', 'users.id', 'saved_events.user_id')
        .select(['users.id', 'users.department', 'users.year'])
        .where('saved_events.event_id', '=', event.id)
        .where('users.status', '=', 'active')
        .where(eb =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('registrations')
                .select('registrations.id')
                .whereRef('registrations.user_id', '=', 'users.id')
                .where('registrations.event_id', '=', event.id)
                .where('registrations.status', '<>', 'cancelled')
            )
          )
        )
        .execute();
      const userIds = savers.filter(u => isEligible(event, u)).map(u => u.id);
      if (!(await claim(trx, 'closing_soon', event.id, event.registration_closes_at!, userIds.length, nowIso))) return;
      await notifyUsers(
        trx,
        userIds,
        {
          category: 'reminders',
          title: `Registration for ${event.title} closes soon`,
          body: `You saved ${event.title}. Registration closes ${formatIstDateTime(event.registration_closes_at!)}.`,
          link: `/event/${event.id}`,
        },
        nowIso
      );
      sent += userIds.length;
    });
  }
  return sent;
};

/**
 * Blueprint §7.1 "Event ends": checked_in → attended, confirmed → no_show.
 * Waitlist places still open expire, and registrations that never finished
 * payment or document review are cancelled.
 */
const finalizeEndedEvents = async (deps: SchedulerDeps, now: Date) => {
  const nowIso = now.toISOString();
  const events = await deps.db
    .selectFrom('events')
    .select(['id', 'ends_at'])
    .where('status', '=', 'published')
    .where('ends_at', '<=', nowIso)
    .where(eb =>
      eb.exists(
        eb
          .selectFrom('registrations')
          .select('registrations.id')
          .whereRef('registrations.event_id', '=', 'events.id')
          .where('registrations.status', 'in', ['confirmed', 'checked_in', 'waitlisted', 'offer_pending', 'pending_payment', 'pending_documents'])
      )
    )
    .execute();

  for (const event of events) {
    await deps.db.transaction().execute(async trx => {
      await trx.updateTable('registrations').set({ status: 'attended' }).where('event_id', '=', event.id).where('status', '=', 'checked_in').execute();
      const noShows = await trx.updateTable('registrations').set({ status: 'no_show' }).where('event_id', '=', event.id).where('status', '=', 'confirmed').executeTakeFirst();
      await trx.updateTable('registrations').set({ status: 'waitlist_expired', offer_expires_at: null }).where('event_id', '=', event.id).where('status', 'in', ['waitlisted', 'offer_pending']).execute();
      await trx
        .updateTable('registrations')
        .set({ status: 'cancelled', cancelled_at: nowIso, cancel_reason: 'Registration was not completed before the event ended', payment_due_at: null })
        .where('event_id', '=', event.id)
        .where('status', 'in', ['pending_payment', 'pending_documents'])
        .execute();
      await trx
        .insertInto('scheduler_log')
        .values({ id: newId(), kind: 'finalize', event_id: event.id, run_key: nowIso, ran_at: nowIso, recipients: Number(noShows.numUpdatedRows) })
        .execute();
    });
  }
  return events.length;
};

/** Blueprint §7.2 "Day after the event: How was {event}?" — attended students who haven't rated it. */
const sendFeedbackRequests = async (deps: SchedulerDeps, now: Date) => {
  const nowIso = now.toISOString();
  const events = await deps.db
    .selectFrom('events')
    .selectAll()
    .where('status', '=', 'published')
    .where('ends_at', '<=', nowIso)
    .where('ends_at', '>', new Date(now.getTime() - FEEDBACK_REQUEST_WINDOW - DAY).toISOString())
    .execute();

  let sent = 0;
  for (const event of events) {
    const due = nextIstMorning(event.ends_at);
    if (now < due || now.getTime() - due.getTime() > FEEDBACK_REQUEST_WINDOW) continue;

    await deps.db.transaction().execute(async trx => {
      const rows = await trx
        .selectFrom('registrations')
        .leftJoin('feedback', 'feedback.registration_id', 'registrations.id')
        .select('registrations.user_id')
        .where('registrations.event_id', '=', event.id)
        .where('registrations.status', '=', 'attended')
        .where('feedback.id', 'is', null)
        .execute();
      const userIds = rows.map(r => r.user_id);
      if (!(await claim(trx, 'feedback_request', event.id, event.ends_at, userIds.length, nowIso))) return;
      await notifyUsers(
        trx,
        userIds,
        { category: 'reminders', title: `How was ${event.title}?`, body: 'Rate the event in a minute — organizers read every response.', link: `/feedback/${event.id}` },
        nowIso
      );
      sent += userIds.length;
    });
  }
  return sent;
};

/** "Deadline tomorrow" for opportunities students saved (blueprint §4.12: same deadline reminders as events). */
const sendOpportunityReminders = async (deps: SchedulerDeps, now: Date) => {
  const nowIso = now.toISOString();
  const due = await deps.db
    .selectFrom('opportunities')
    .select(['id', 'title', 'deadline'])
    .where('status', '=', 'published')
    .where('deadline', '>', nowIso)
    .where('deadline', '<=', new Date(now.getTime() + DAY).toISOString())
    .execute();
  let sent = 0;
  for (const opp of due) {
    await deps.db.transaction().execute(async trx => {
      const claimed = await trx
        .insertInto('opportunity_reminders')
        .values({ opportunity_id: opp.id, deadline: opp.deadline, sent_at: nowIso })
        .onConflict(oc => oc.columns(['opportunity_id', 'deadline']).doNothing())
        .executeTakeFirst();
      if (Number(claimed.numInsertedOrUpdatedRows ?? 0) === 0) return;
      const savers = await trx.selectFrom('saved_opportunities').select('user_id').where('opportunity_id', '=', opp.id).execute();
      await notifyUsers(
        trx,
        savers.map(s => s.user_id),
        { category: 'opportunities', title: `Deadline tomorrow: ${opp.title}`, body: `Applications close ${formatIstDateTime(opp.deadline)}.`, link: `/opportunities/${opp.id}` },
        nowIso
      );
      sent += savers.length;
    });
  }
  return sent;
};

/** Hands queued messages to each channel's sender. A failed send stays queued and is retried on the next tick. */
export const deliverOutbox = async (deps: Pick<SchedulerDeps, 'db' | 'now' | 'senders'>) => {
  const channels = Object.keys(deps.senders) as (keyof Senders)[];
  if (channels.length === 0) return 0;
  const pending = await deps.db
    .selectFrom('message_outbox')
    .selectAll()
    .where('status', '=', 'pending')
    .where('channel', 'in', channels)
    .orderBy('created_at')
    .limit(200)
    .execute();

  let delivered = 0;
  for (const message of pending) {
    try {
      await deps.senders[message.channel]!({ channel: message.channel, to: message.to_address, subject: message.subject, text: message.body });
      await deps.db.updateTable('message_outbox').set({ status: 'sent', sent_at: deps.now().toISOString(), attempts: message.attempts + 1 }).where('id', '=', message.id).execute();
      delivered++;
    } catch (err) {
      const attempts = message.attempts + 1;
      await deps.db
        .updateTable('message_outbox')
        .set({ attempts, last_error: String(err instanceof Error ? err.message : err).slice(0, 500), status: attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending' })
        .where('id', '=', message.id)
        .execute();
    }
  }
  return delivered;
};

/** One scheduler tick. Safe to run as often as you like. */
export const runScheduledTasks = async (deps: SchedulerDeps) => {
  const now = deps.now();
  const ctx = ctxOf(deps);
  const expiredOffers = await expireOffers(deps.db, now, ctx);
  const releasedUnpaid = await expireUnpaid(deps.db, now, ctx);
  const teamsLocked = await lockTeams(deps.db, now, ctx);
  const reminders = await sendEventReminders(deps, now);
  const closing = await sendClosingReminders(deps, now);
  const finalized = await finalizeEndedEvents(deps, now);
  const feedbackRequests = await sendFeedbackRequests(deps, now);
  const opportunityReminders = await sendOpportunityReminders(deps, now);
  const messages = await deliverOutbox(deps);
  return { expiredOffers, releasedUnpaid, teamsLocked, reminders, closing, finalized, feedbackRequests, opportunityReminders, messages };
};
