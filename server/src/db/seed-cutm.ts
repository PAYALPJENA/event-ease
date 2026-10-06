import type { Transaction } from 'kysely';
import type { Database, EventType } from './types.ts';

/**
 * Source-based CUTM events — the default content of the development database.
 *
 * Each record holds ONLY what the CUTM communication establishes: title, date,
 * event type, category and (where the title says so) the organizer. Facts the
 * source doesn't give — exact time, venue, capacity, fee, registration window,
 * eligibility, contact — are null and shown as "not specified". Nothing here
 * is invented, and no registrations, attendance or statistics are attached to
 * these events.
 *
 * Communications not seeded yet, because their dates/details weren't available
 * when this was written (add them once the source details are known):
 *   - Invitation to Interaction Session with MEAI
 *   - Alumni Talk / Alumni Interaction Session(s) — keep separate sessions separate
 *   - Daily Yoga / Therapeutic & Holistic Wellness Sessions (recurring)
 *   - Pre-Qiskit Fall Fest 2026
 */

const SEEDED_AT = '2026-10-01T00:00:00.000Z';
const SOURCE_NOTE = 'From a CUTM communication. Details the source doesn’t give are shown as not specified.';

/** Whole IST days: 00:00 on the first day to 23:59 on the last (the time isn't announced). */
const istDays = (first: string, last = first) => ({
  starts_at: new Date(`${first}T00:00:00+05:30`).toISOString(),
  ends_at: new Date(`${last}T23:59:00+05:30`).toISOString(),
});

interface SourceEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  category_id: string;
  event_type: EventType;
  tags: string[];
  organization_id: string | null;
  days: [string] | [string, string];
}

export const CUTM_EVENTS: SourceEvent[] = [
  {
    id: 'cutm-college-rivals-4',
    slug: 'college-rivals-4',
    title: 'College Rivals 4 – Gaming Event',
    description: 'College Rivals 4, a gaming competition.',
    category_id: 'cat-competitions',
    event_type: 'competition',
    tags: ['Gaming'],
    organization_id: null,
    days: ['2026-09-18'],
  },
  {
    id: 'cutm-happy-resilient-youth',
    slug: 'building-happy-and-resilient-youth',
    title: 'Interactive Student Development Workshop — “Building Happy & Resilient Youth”',
    description: 'An interactive student development workshop on building happy and resilient youth.',
    category_id: 'cat-student-development',
    event_type: 'workshop',
    tags: ['Student development'],
    organization_id: null,
    days: ['2026-09-25'],
  },
  {
    id: 'cutm-code-golf',
    slug: 'code-golf',
    title: 'Code Golf — Coding Competition in C, C++ & Java',
    description: 'A coding competition in C, C++ and Java.',
    category_id: 'cat-technical',
    event_type: 'competition',
    tags: ['Coding', 'C', 'C++', 'Java'],
    organization_id: null,
    days: ['2026-09-05'],
  },
  {
    id: 'cutm-microorganism-day',
    slug: 'international-microorganism-day',
    title: 'International Microorganism Day Celebration & Agar Art Competition',
    description: 'A celebration of International Microorganism Day, with an agar art competition.',
    category_id: 'cat-competitions',
    event_type: 'competition',
    tags: ['Science', 'Agar art'],
    organization_id: null,
    days: ['2026-09-16', '2026-09-17'],
  },
  {
    id: 'cutm-ncc-plantation-drive',
    slug: 'ncc-plantation-drive',
    title: 'Plantation Drive by NCC',
    description: 'A plantation drive by NCC.',
    category_id: 'cat-social-impact',
    event_type: 'community_service',
    tags: ['NCC', 'Community service'],
    organization_id: 'org-ncc',
    days: ['2026-09-25'],
  },
  {
    id: 'cutm-ieee-scopes-2027',
    slug: 'ieee-scopes-2027',
    title: 'IEEE International Conference “SCOPES – 2027”',
    description: 'The IEEE International Conference SCOPES 2027.',
    category_id: 'cat-research',
    event_type: 'conference',
    tags: ['IEEE', 'Conference'],
    organization_id: null,
    days: ['2027-02-04', '2027-02-06'],
  },
];

/** Organizations named by the sources. NCC is named in "Plantation Drive by NCC". */
const CUTM_ORGANIZATIONS = [{ id: 'org-ncc', type: 'cell' as const, name: 'NCC', slug: 'ncc' }];

export const seedCutm = async (trx: Transaction<Database>) => {
  await trx
    .insertInto('organizations')
    .values(
      CUTM_ORGANIZATIONS.map(o => ({
        ...o,
        description: null,
        contact_email: null,
        logo_url: null,
        social_links: '{}',
        recruitment: null,
        status: 'active' as const,
        created_at: SEEDED_AT,
      }))
    )
    .execute();

  for (const e of CUTM_EVENTS) {
    await trx
      .insertInto('events')
      .values({
        id: e.id,
        slug: e.slug,
        organization_id: e.organization_id,
        category_id: e.category_id,
        title: e.title,
        summary: null,
        description: e.description,
        image: null,
        venue_id: null,
        mode: 'in_person',
        online_url: null,
        ...istDays(e.days[0], e.days[1]),
        registration_opens_at: null,
        registration_closes_at: null,
        capacity: null,
        eligibility_text: null,
        eligible_departments: null,
        eligible_years: null,
        requirements: '[]',
        contact_person: null,
        contact_email: null,
        is_featured: 0,
        status: 'published',
        created_by: 'usr-admin',
        created_at: SEEDED_AT,
        updated_at: SEEDED_AT,
        published_at: SEEDED_AT,
        cancel_requested_at: null,
        cancel_requested_by: null,
        cancel_request_reason: null,
        participation: 'individual',
        team_min: null,
        team_max: null,
        waitlist_enabled: 0,
        offer_window_hours: 12,
        questions: '[]',
        required_documents: '[]',
        cancellation_cutoff_hours: null,
        certificate_rule: 'none',
        recap: null,
        gallery: '[]',
        results_published_at: null,
        fee_amount: null,
        event_type: e.event_type,
        tags: JSON.stringify(e.tags),
        time_tbd: 1,
        registration_mode: 'unspecified',
        source_note: SOURCE_NOTE,
        is_sample: 0,
      })
      .execute();
  }
};
