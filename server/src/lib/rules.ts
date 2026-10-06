import type { EventRow, RegistrationStatus, User } from '../db/types.ts';

/**
 * Pure business rules shared by the API routes. Keeping them free of I/O
 * makes the blueprint's invariants (§8.3) easy to unit-test.
 */

export const parseJsonArray = <T>(value: string | null): T[] | null => {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : null;
};

/** Where the event is in time. Stored status only says draft/published/cancelled. */
export type EventPhase = 'upcoming' | 'ongoing' | 'completed';

export const eventPhase = (event: Pick<EventRow, 'starts_at' | 'ends_at'>, now: Date): EventPhase => {
  if (now < new Date(event.starts_at)) return 'upcoming';
  if (now < new Date(event.ends_at)) return 'ongoing';
  return 'completed';
};

/**
 * Blueprint §3.3: derived, never stored. `no_registration` = students don't
 * register through EventEase (not required, or the source doesn't say).
 */
export type Availability = 'not_open' | 'open' | 'closing_soon' | 'full' | 'closed' | 'no_registration';

const CLOSING_SOON_MS = 48 * 60 * 60 * 1000;

export const availability = (
  event: Pick<EventRow, 'status' | 'registration_mode' | 'registration_opens_at' | 'registration_closes_at' | 'capacity'>,
  seatsTaken: number,
  now: Date
): Availability => {
  if (event.registration_mode !== 'eventease') return 'no_registration';
  if (event.status !== 'published' || !event.registration_opens_at || !event.registration_closes_at) return 'closed';
  const opens = new Date(event.registration_opens_at);
  const closes = new Date(event.registration_closes_at);
  if (now < opens) return 'not_open';
  if (now >= closes) return 'closed';
  if (event.capacity !== null && seatsTaken >= event.capacity) return 'full';
  if (closes.getTime() - now.getTime() <= CLOSING_SOON_MS) return 'closing_soon';
  return 'open';
};

/**
 * Registration states that hold a seat (§8.3 #2). A waitlist offer holds the
 * seat while the student decides; a pending payment or document review holds
 * it until it completes or expires.
 */
export const ACTIVE_REGISTRATION_STATUSES = [
  'pending_payment',
  'pending_documents',
  'offer_pending',
  'confirmed',
  'checked_in',
  'attended',
  'no_show',
] as const satisfies RegistrationStatus[];

/** Ended states that don't block registering again (the partial unique index uses the same list). */
export const CLOSED_REGISTRATION_STATUSES = ['cancelled', 'waitlist_expired'] as const satisfies RegistrationStatus[];

/** Registrations for an event that hasn't happened yet, which the student or organizer can still cancel. */
export const OPEN_REGISTRATION_STATUSES = ['pending_payment', 'pending_documents', 'waitlisted', 'offer_pending', 'confirmed'] as const satisfies RegistrationStatus[];

/** Registrations that get reminders and have a pass. */
export const UPCOMING_REGISTRATION_STATUSES = ['confirmed', 'checked_in'] as const satisfies RegistrationStatus[];

/** Everyone who must hear about a change or cancellation (blueprint §7.1: "all confirmed and waitlisted"). */
export const AFFECTED_BY_CHANGE_STATUSES = [...OPEN_REGISTRATION_STATUSES, 'checked_in'] as const satisfies RegistrationStatus[];

export const isActiveRegistration = (status: RegistrationStatus) => !(CLOSED_REGISTRATION_STATUSES as readonly string[]).includes(status);

/** Doors open for check-in this long before the event starts. */
export const CHECK_IN_OPENS_BEFORE_MS = 2 * 60 * 60 * 1000;

/** Blueprint §8.3 #6: check-in is valid only inside the check-in window. */
export const checkInWindow = (event: Pick<EventRow, 'starts_at' | 'ends_at'>, at: Date): 'too_early' | 'open' | 'ended' => {
  if (at.getTime() < new Date(event.starts_at).getTime() - CHECK_IN_OPENS_BEFORE_MS) return 'too_early';
  if (at >= new Date(event.ends_at)) return 'ended';
  return 'open';
};

/** Half-open time ranges [start, end) overlap. Used for the venue clash check (§8.3 #7). */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

/** Blueprint §8.3 invariant 3: eligibility is checked against the student's university profile. */
export const isEligible = (
  event: Pick<EventRow, 'eligible_departments' | 'eligible_years'>,
  user: Pick<User, 'department' | 'year'>
): boolean => {
  const departments = parseJsonArray<string>(event.eligible_departments);
  const years = parseJsonArray<number>(event.eligible_years);
  if (departments && (!user.department || !departments.includes(user.department))) return false;
  if (years && (user.year === null || !years.includes(user.year))) return false;
  return true;
};

export const userRoles = (user: Pick<User, 'roles'>) => parseJsonArray<string>(user.roles) ?? [];

// Indian mobile number: 10 digits starting 6-9, optional +91/0 prefix, optional
// space or hyphen after the prefix and after the 5th digit. Same rule as the web form.
export const PHONE_REGEX = /^(?:\+91[\s-]?|0)?[6-9][0-9]{4}[\s-]?[0-9]{5}$/;
