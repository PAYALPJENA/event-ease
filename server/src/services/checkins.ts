import type { DB } from '../db/index.ts';
import type { EventRow, User } from '../db/types.ts';
import { newId } from '../lib/ids.ts';
import { verifyPassToken } from '../lib/pass.ts';
import { checkInWindow } from '../lib/rules.ts';
import { isUniqueViolation } from './registrations.ts';
import { audit } from './notifications.ts';

/**
 * QR check-in at the door (blueprint §5 Check-in, §7.1, invariant §8.3 #6).
 *
 * A scan is valid only for a confirmed registration of *this* event, inside
 * the check-in window, and only once. Every outcome is an answer for the
 * person at the door, not an error, so the API returns 200 with `result`:
 *
 *   checked_in          ✅ let them in
 *   already_checked_in  ⚠️ the pass was used before (shows when)
 *   cancelled           ❌ registration was cancelled
 *   not_confirmed       ❌ still waiting for payment, documents, or on the waitlist
 *   not_found           ❌ forged/garbled QR, or unknown registration
 *   wrong_event         ❌ a valid pass for a different event
 *   too_early / ended   ❌ outside the check-in window
 *
 * Scans may arrive late from a device that was offline, so the window is
 * checked against the time of the scan (`scannedAt`), not the time of sync.
 */

export type CheckInResult = 'checked_in' | 'already_checked_in' | 'cancelled' | 'not_confirmed' | 'not_found' | 'wrong_event' | 'too_early' | 'ended';

export interface CheckInOutcome {
  result: CheckInResult;
  registration?: { id: string; code: string; status: string };
  student?: { name: string; universityId: string; department: string | null; year: number | null };
  checkedInAt?: string;
}

export interface CheckInInput {
  token?: string;
  registrationId?: string;
  scannedAt: Date;
  device?: string | null;
}

export const checkIn = async (
  db: DB,
  staff: User,
  event: EventRow,
  input: CheckInInput,
  now: Date,
  passSecret: string
): Promise<CheckInOutcome> => {
  let registrationId = input.registrationId;
  const method = input.token ? 'qr' : 'manual';
  if (input.token) {
    const parsed = verifyPassToken(input.token, passSecret);
    if (!parsed) return { result: 'not_found' };
    if (parsed.eventId !== event.id) return { result: 'wrong_event' };
    registrationId = parsed.registrationId;
  }
  if (!registrationId) return { result: 'not_found' };

  return db.transaction().execute(async trx => {
    const row = await trx
      .selectFrom('registrations')
      .innerJoin('users', 'users.id', 'registrations.user_id')
      .leftJoin('check_ins', 'check_ins.registration_id', 'registrations.id')
      .select([
        'registrations.id',
        'registrations.event_id',
        'registrations.registration_code as code',
        'registrations.status',
        'users.name',
        'users.university_id',
        'users.department',
        'users.year',
        'check_ins.scanned_at',
      ])
      .where('registrations.id', '=', registrationId)
      .executeTakeFirst();

    if (!row) return { result: 'not_found' as const };
    if (row.event_id !== event.id) return { result: 'wrong_event' as const };

    const base = {
      registration: { id: row.id, code: row.code, status: row.status as string },
      student: { name: row.name, universityId: row.university_id, department: row.department, year: row.year },
    };
    if (row.status === 'cancelled') return { result: 'cancelled' as const, ...base };
    if (row.scanned_at) return { result: 'already_checked_in' as const, ...base, checkedInAt: row.scanned_at };
    if (row.status !== 'confirmed' && row.status !== 'no_show') return { result: 'not_confirmed' as const, ...base };

    const window = checkInWindow(event, input.scannedAt);
    if (window === 'too_early') return { result: 'too_early' as const, ...base };
    if (window === 'ended') return { result: 'ended' as const, ...base };

    // A scan synced after the event ended (offline device) goes straight to
    // `attended`; it also corrects a `no_show` set by the end-of-event job.
    const status = now >= new Date(event.ends_at) ? 'attended' : 'checked_in';
    const scannedAt = input.scannedAt.toISOString();
    try {
      await trx
        .insertInto('check_ins')
        .values({
          id: newId(),
          registration_id: row.id,
          event_id: event.id,
          scanned_at: scannedAt,
          recorded_at: now.toISOString(),
          scanned_by: staff.id,
          method,
          device: input.device ?? null,
        })
        .execute();
    } catch (err) {
      // Two devices scanned the same pass at the same moment.
      if (isUniqueViolation(err, 'check_ins.registration_id')) {
        const existing = await trx.selectFrom('check_ins').select('scanned_at').where('registration_id', '=', row.id).executeTakeFirstOrThrow();
        return { result: 'already_checked_in' as const, ...base, checkedInAt: existing.scanned_at };
      }
      throw err;
    }
    await trx.updateTable('registrations').set({ status }).where('id', '=', row.id).execute();
    await audit(trx, { actorId: staff.id, action: 'registration.check_in', entityType: 'registration', entityId: row.id, data: { method } }, now.toISOString());
    return { result: 'checked_in' as const, ...base, registration: { ...base.registration, status }, checkedInAt: scannedAt };
  });
};

/** Live counter for the check-in screen. */
export const checkInStats = async (db: DB, eventId: string) => {
  const rows = await db
    .selectFrom('registrations')
    .select(['status', eb => eb.fn.countAll<number>().as('n')])
    .where('event_id', '=', eventId)
    .groupBy('status')
    .execute();
  const count = (s: string) => Number(rows.find(r => r.status === s)?.n ?? 0);
  const checkedIn = count('checked_in') + count('attended');
  return { checkedIn, expected: checkedIn + count('confirmed') + count('no_show'), noShow: count('no_show') };
};
