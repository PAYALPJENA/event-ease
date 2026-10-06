import { sql } from 'kysely';
import type { DB } from '../db/index.ts';
import type { EventQuestion, EventRow, EventStatus, EventType, RegistrationMode } from '../db/types.ts';
import { ACTIVE_REGISTRATION_STATUSES, availability, eventPhase, parseJsonArray } from '../lib/rules.ts';
import type { Availability, EventPhase } from '../lib/rules.ts';

/**
 * Event as returned by the API. Field names are camelCase for the web client.
 * `null` means "not specified" — the UI says so rather than guessing.
 */
export interface EventDto {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string;
  image: string | null;
  category: { id: string; name: string };
  organization: { id: string; name: string } | null;
  eventType: EventType;
  tags: string[];
  /** The date is known; the time isn't announced (startsAt/endsAt span whole IST days). */
  timeTbd: boolean;
  registrationMode: RegistrationMode;
  /** Provenance shown to students, e.g. "From a CUTM communication". */
  sourceNote: string | null;
  /** Fictional sample data (demos and tests). */
  isSample: boolean;
  venue: { id: string; name: string; mapsUrl: string | null } | null;
  mode: 'in_person' | 'online' | 'hybrid';
  onlineUrl: string | null;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** null = no limit / not specified */
  capacity: number | null;
  seatsTaken: number;
  seatsAvailable: number | null;
  eligibilityText: string | null;
  eligibleDepartments: string[] | null;
  eligibleYears: number[] | null;
  requirements: string[];
  contactPerson: string | null;
  contactEmail: string | null;
  isFeatured: boolean;
  status: EventStatus;
  phase: EventPhase;
  availability: Availability;
  participation: 'individual' | 'team';
  teamMin: number | null;
  teamMax: number | null;
  waitlistEnabled: boolean;
  waitlistCount: number;
  offerWindowHours: number;
  questions: EventQuestion[];
  requiredDocuments: { id: string; label: string }[];
  cancellationCutoffHours: number | null;
  certificateRule: EventRow['certificate_rule'];
  /** In paise; 0 = free; null = not specified. */
  feeAmount: number | null;
  recap: string | null;
  gallery: string[];
  resultsPublished: boolean;
}

/** Base query: event + organization, category, venue and the live count of seats held. */
export const eventQuery = (db: DB) =>
  db
    .selectFrom('events')
    .leftJoin('organizations', 'organizations.id', 'events.organization_id')
    .innerJoin('categories', 'categories.id', 'events.category_id')
    .leftJoin('venues', 'venues.id', 'events.venue_id')
    .selectAll('events')
    .select([
      'organizations.name as organization_name',
      'categories.name as category_name',
      'venues.name as venue_name',
      'venues.maps_url as venue_maps_url',
      eb =>
        eb
          .selectFrom('registrations')
          .select(eb2 => eb2.fn.countAll<number>().as('n'))
          .whereRef('registrations.event_id', '=', 'events.id')
          .where('registrations.status', 'in', ACTIVE_REGISTRATION_STATUSES)
          .as('seats_taken'),
      eb =>
        eb
          .selectFrom('registrations')
          .select(eb2 => eb2.fn.countAll<number>().as('n'))
          .whereRef('registrations.event_id', '=', 'events.id')
          .where('registrations.status', '=', 'waitlisted')
          .as('waitlist_count'),
    ]);

type EventQueryRow = Awaited<ReturnType<ReturnType<typeof eventQuery>['executeTakeFirstOrThrow']>>;

export const toEventDto = (row: EventQueryRow, now: Date): EventDto => {
  const seatsTaken = Number(row.seats_taken ?? 0);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    image: row.image,
    category: { id: row.category_id, name: row.category_name },
    organization: row.organization_id ? { id: row.organization_id, name: row.organization_name ?? '' } : null,
    eventType: row.event_type,
    tags: parseJsonArray<string>(row.tags) ?? [],
    timeTbd: row.time_tbd === 1,
    registrationMode: row.registration_mode,
    sourceNote: row.source_note,
    isSample: row.is_sample === 1,
    venue: row.venue_id ? { id: row.venue_id, name: row.venue_name ?? '', mapsUrl: row.venue_maps_url } : null,
    mode: row.mode,
    onlineUrl: row.online_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    capacity: row.capacity,
    seatsTaken,
    seatsAvailable: row.capacity === null ? null : Math.max(0, row.capacity - seatsTaken),
    eligibilityText: row.eligibility_text,
    eligibleDepartments: parseJsonArray<string>(row.eligible_departments),
    eligibleYears: parseJsonArray<number>(row.eligible_years),
    requirements: parseJsonArray<string>(row.requirements) ?? [],
    contactPerson: row.contact_person,
    contactEmail: row.contact_email,
    isFeatured: row.is_featured === 1,
    status: row.status,
    phase: eventPhase(row, now),
    availability: availability(row, seatsTaken, now),
    participation: row.participation,
    teamMin: row.team_min,
    teamMax: row.team_max,
    waitlistEnabled: row.waitlist_enabled === 1 && row.participation === 'individual',
    waitlistCount: Number(row.waitlist_count ?? 0),
    offerWindowHours: row.offer_window_hours,
    questions: parseJsonArray<EventQuestion>(row.questions) ?? [],
    requiredDocuments: parseJsonArray<{ id: string; label: string }>(row.required_documents) ?? [],
    cancellationCutoffHours: row.cancellation_cutoff_hours,
    certificateRule: row.certificate_rule,
    feeAmount: row.fee_amount,
    recap: row.recap,
    gallery: parseJsonArray<string>(row.gallery) ?? [],
    resultsPublished: row.results_published_at !== null,
  };
};

/** Seats held: every registration that isn't cancelled (confirmed, checked in, attended, no-show). */
export const countActive = async (db: DB, eventId: string) => {
  const row = await db
    .selectFrom('registrations')
    .select(sql<number>`count(*)`.as('n'))
    .where('event_id', '=', eventId)
    .where('status', 'in', ACTIVE_REGISTRATION_STATUSES)
    .executeTakeFirstOrThrow();
  return Number(row.n);
};

/** Statuses the public can see. Everything else is visible only to the organizing staff. */
export const PUBLIC_EVENT_STATUSES = ['published', 'cancelled'] as const satisfies EventStatus[];

export interface VenueClash {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Blueprint §8.3 #7: a venue can't be double-booked for overlapping published
 * events. Returns the published events that would clash with `event`.
 */
export const findVenueClashes = async (
  db: DB,
  event: Pick<EventRow, 'id' | 'venue_id' | 'mode' | 'starts_at' | 'ends_at'>
): Promise<VenueClash[]> => {
  if (!event.venue_id || event.mode === 'online') return [];
  const rows = await db
    .selectFrom('events')
    .select(['id', 'title', 'starts_at', 'ends_at'])
    .where('venue_id', '=', event.venue_id)
    .where('id', '<>', event.id)
    .where('status', '=', 'published')
    .where('mode', '<>', 'online')
    .where('starts_at', '<', event.ends_at)
    .where('ends_at', '>', event.starts_at)
    .orderBy('starts_at')
    .execute();
  return rows.map(r => ({ id: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at }));
};

/** Recent time/venue changes to a published event, newest first (the event page's change banner). */
export const recentChanges = async (db: DB, eventId: string) => {
  const rows = await db
    .selectFrom('event_changes')
    .select(['field', 'old_value', 'new_value', 'reason', 'created_at'])
    .where('event_id', '=', eventId)
    .orderBy('created_at', 'desc')
    .limit(5)
    .execute();
  return rows.map(r => ({ field: r.field, oldValue: r.old_value, newValue: r.new_value, reason: r.reason, createdAt: r.created_at }));
};
