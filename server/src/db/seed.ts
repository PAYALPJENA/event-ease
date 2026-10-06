import type { DB } from './index.ts';
import { seedCutm } from './seed-cutm.ts';
import { seedSamples } from './seed-samples.ts';

/**
 * Development and test data. Never loaded in production.
 *
 * Content comes from two clearly separated sources:
 *   - seed-cutm.ts     real CUTM events, holding only facts from the source (default)
 *   - seed-samples.ts  fictional sample events, labelled "Sample" (tests, and
 *                      `npm run db:reset -w server -- --with-samples`)
 * The category taxonomy is reference data installed by the migrations.
 *
 * The accounts below are fictional sample people for the development sign-in.
 */

const SEEDED_AT = '2026-08-01T00:00:00.000Z';

/** Sample people you can sign in as with the development sign-in. */
const PEOPLE = [
  { id: 'usr-aarav', university_id: '210101120001', name: 'Aarav Kumar', email: 'aarav.k@cutm.ac.in', department: 'CSE', programme: 'B.Tech', year: 3, semester: 5, roles: ['student'] },
  { id: 'usr-priya', university_id: '220101130045', name: 'Priya Das', email: 'priya.d@cutm.ac.in', department: 'ECE', programme: 'B.Tech', year: 2, semester: 3, roles: ['student'] },
  { id: 'usr-rohan', university_id: '240101510012', name: 'Rohan Mishra', email: 'rohan.m@cutm.ac.in', department: 'BBA', programme: 'BBA', year: 1, semester: 1, roles: ['student'] },
  { id: 'usr-rahul', university_id: '200101120077', name: 'Rahul Sharma', email: 'rahul.s@cutm.ac.in', department: 'CSE', programme: 'B.Tech', year: 4, semester: 7, roles: ['student', 'organizer'] },
  { id: 'usr-anita', university_id: 'FAC-CSE-014', name: 'Dr. Anita Desai', email: 'anita.d@cutm.ac.in', department: 'CSE', programme: null, year: null, semester: null, roles: ['organizer'] },
  { id: 'usr-admin', university_id: 'ADM-SA-001', name: 'Student Affairs Office', email: 'studentaffairs@cutm.ac.in', department: null, programme: null, year: null, semester: null, roles: ['admin'] },
];

/** The campus itself; other venues are admin-managed (and part of the sample set). */
const BASE_VENUES = [
  {
    id: 'ven-main-campus',
    name: 'Main Campus, CUTM Bhubaneswar',
    campus: 'Bhubaneswar',
    capacity: null,
    maps_url: 'https://www.google.com/maps/search/?api=1&query=Centurion+University+Bhubaneswar',
  },
];

export interface SeedOptions {
  /** Real, source-based CUTM events (default on). */
  cutm?: boolean;
  /** Fictional sample events, clubs, students and activity (default off). */
  samples?: boolean;
}

/** `now` places the live sample event; tests pass their fixed clock. */
export const seed = async (db: DB, now: Date = new Date(), options: SeedOptions = {}) => {
  const { cutm = true, samples = false } = options;
  await db.transaction().execute(async trx => {
    await trx
      .insertInto('users')
      .values(PEOPLE.map(p => ({ ...p, roles: JSON.stringify(p.roles), phone: null, campus: 'Bhubaneswar', school: null, status: 'active' as const, created_at: SEEDED_AT })))
      .execute();
    await trx.insertInto('venues').values(BASE_VENUES).execute();
    if (cutm) await seedCutm(trx);
    if (samples) await seedSamples(trx, now);
  });
};
