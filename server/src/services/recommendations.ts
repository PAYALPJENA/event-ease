import type { DB } from '../db/index.ts';
import type { User } from '../db/types.ts';
import { ACTIVE_REGISTRATION_STATUSES, CLOSED_REGISTRATION_STATUSES, isEligible, parseJsonArray } from '../lib/rules.ts';
import { eventQuery, toEventDto } from './events.ts';
import type { EventDto } from './events.ts';

/**
 * Rule-based recommendations (blueprint §7.5, V4). Every suggestion carries
 * the reasons it was chosen ("Why am I seeing this?"), and students can switch
 * personalization off in their profile.
 *
 * Signals, strongest first:
 *   interests × category      +3   "You're interested in Workshops"
 *   club you follow           +3   "From Coding Club, which you follow"
 *   same category you attended +2  "Like AI & ML Workshop, which you attended"
 *   popular with your cohort  +2   "12 CSE year-3 students registered"
 *   closing within 48 h       +1   "Registration closes soon"
 * Only upcoming, published events the student is eligible for and hasn't
 * registered for are considered. Ties go to the sooner event.
 */

export interface Recommendation {
  event: EventDto;
  score: number;
  reasons: string[];
}

const COHORT_THRESHOLD = 3;
const MIN_SCORE = 2;

export const preferencesFor = async (db: DB, userId: string) => {
  const row = await db.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst();
  return {
    interests: parseJsonArray<string>(row?.interests ?? '[]') ?? [],
    personalizationEnabled: row ? row.personalization_enabled === 1 : true,
  };
};

export const recommendFor = async (db: DB, user: User, now: Date, limit = 6): Promise<{ personalizationEnabled: boolean; items: Recommendation[] }> => {
  const prefs = await preferencesFor(db, user.id);
  if (!prefs.personalizationEnabled) return { personalizationEnabled: false, items: [] };

  const nowIso = now.toISOString();
  const [candidates, follows, mine, categories] = await Promise.all([
    eventQuery(db).where('events.status', '=', 'published').where('events.starts_at', '>', nowIso).execute(),
    db.selectFrom('follows').innerJoin('organizations', 'organizations.id', 'follows.organization_id').select(['organizations.id', 'organizations.name']).where('follows.user_id', '=', user.id).execute(),
    db
      .selectFrom('registrations')
      .innerJoin('events', 'events.id', 'registrations.event_id')
      .select(['registrations.event_id', 'registrations.status', 'events.category_id', 'events.title'])
      .where('registrations.user_id', '=', user.id)
      .execute(),
    db.selectFrom('categories').select(['id', 'name']).execute(),
  ]);

  const registeredIds = new Set(mine.filter(r => !(CLOSED_REGISTRATION_STATUSES as readonly string[]).includes(r.status)).map(r => r.event_id));
  const attendedByCategory = new Map<string, string>();
  for (const r of mine) if (r.status === 'attended') attendedByCategory.set(r.category_id, r.title);
  const followed = new Map(follows.map(f => [f.id, f.name]));
  const categoryName = new Map(categories.map(c => [c.id, c.name]));

  // Popularity with the student's own department and year.
  const cohort = new Map<string, number>();
  if (user.department && user.year !== null && candidates.length) {
    const rows = await db
      .selectFrom('registrations')
      .innerJoin('users', 'users.id', 'registrations.user_id')
      .select(['registrations.event_id', eb => eb.fn.countAll<number>().as('n')])
      .where('registrations.event_id', 'in', candidates.map(c => c.id))
      .where('registrations.status', 'in', ACTIVE_REGISTRATION_STATUSES)
      .where('users.department', '=', user.department)
      .where('users.year', '=', user.year)
      .groupBy('registrations.event_id')
      .execute();
    for (const r of rows) cohort.set(r.event_id, Number(r.n));
  }

  const items: Recommendation[] = [];
  for (const row of candidates) {
    if (registeredIds.has(row.id) || !isEligible(row, user)) continue;
    const event = toEventDto(row, now);
    if (event.availability === 'closed') continue;

    let score = 0;
    const reasons: string[] = [];
    if (prefs.interests.includes(row.category_id)) {
      score += 3;
      reasons.push(`You're interested in ${categoryName.get(row.category_id) ?? 'this category'}`);
    }
    if (row.organization_id && followed.has(row.organization_id)) {
      score += 3;
      reasons.push(`From ${followed.get(row.organization_id)}, which you follow`);
    }
    if (attendedByCategory.has(row.category_id)) {
      score += 2;
      reasons.push(`Like ${attendedByCategory.get(row.category_id)}, which you attended`);
    }
    const peers = cohort.get(row.id) ?? 0;
    if (peers >= COHORT_THRESHOLD) {
      score += 2;
      reasons.push(`${peers} ${user.department} year-${user.year} students registered`);
    }
    if (event.availability === 'closing_soon') {
      score += 1;
      reasons.push('Registration closes soon');
    }
    if (score >= MIN_SCORE) items.push({ event, score, reasons });
  }

  items.sort((a, b) => b.score - a.score || a.event.startsAt.localeCompare(b.event.startsAt));
  return { personalizationEnabled: true, items: items.slice(0, limit) };
};
