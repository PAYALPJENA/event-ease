import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { createDb } from '../src/db/index.ts';
import { migrations } from '../src/db/migrations.ts';
import { CUTM_EVENTS } from '../src/db/seed-cutm.ts';
import { REGISTER_BODY, createTestContext } from './helpers.ts';
import type { TestContext } from './helpers.ts';

// The real CUTM events (src/db/seed-cutm.ts) as test cases for the event model:
// taxonomy, date-derived phase, and "not specified" instead of invented facts.
// "Today" is 1 October 2026, 12:00 IST.

const TODAY = new Date('2026-10-01T06:30:00.000Z');

interface Ev {
  id: string;
  title: string;
  phase: string;
  availability: string;
  category: { name: string };
  eventType: string;
  organization: { name: string } | null;
  [key: string]: unknown;
}

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext({}, { data: { cutm: true, samples: false }, now: TODAY });
});

const events = async () => (await ctx.request('GET', '/events')).json.events as Ev[];
const byId = (list: Ev[], id: string) => list.find(e => e.id === id)!;

describe('event taxonomy', () => {
  it('has the 13 CUTM categories in a fixed order', async () => {
    const names = (await ctx.request('GET', '/categories')).json.categories.map((c: { name: string }) => c.name);
    assert.deepEqual(names, [
      'Technical', 'Competitions', 'Workshops', 'Seminars & Talks', 'Research', 'Sports', 'Cultural',
      'Clubs & Societies', 'Student Development', 'Social Impact', 'Wellness', 'Career', 'Other',
    ]);
  });

  it('files each CUTM event under its category and event type', async () => {
    const list = await events();
    const seen = Object.fromEntries(list.map(e => [e.id, [e.category.name, e.eventType]]));
    assert.deepEqual(seen, {
      'cutm-college-rivals-4': ['Competitions', 'competition'],
      'cutm-happy-resilient-youth': ['Student Development', 'workshop'],
      'cutm-code-golf': ['Technical', 'competition'],
      'cutm-microorganism-day': ['Competitions', 'competition'],
      'cutm-ncc-plantation-drive': ['Social Impact', 'community_service'],
      'cutm-ieee-scopes-2027': ['Research', 'conference'],
    });
  });
});

describe('date logic on 1 October 2026', () => {
  it('shows the September events as ended and SCOPES 2027 as upcoming', async () => {
    const list = await events();
    for (const id of ['cutm-college-rivals-4', 'cutm-happy-resilient-youth', 'cutm-code-golf', 'cutm-microorganism-day', 'cutm-ncc-plantation-drive']) {
      assert.equal(byId(list, id).phase, 'completed', id);
    }
    assert.equal(byId(list, 'cutm-ieee-scopes-2027').phase, 'upcoming');
    // "Upcoming" is derived, not labelled: only SCOPES qualifies.
    assert.deepEqual(list.filter(e => e.phase !== 'completed').map(e => e.id), ['cutm-ieee-scopes-2027']);
  });

  it('keeps past events (history, analytics) rather than hiding them', async () => {
    assert.equal((await events()).length, CUTM_EVENTS.length);
    assert.equal((await ctx.request('GET', '/events/code-golf')).status, 200);
  });

  it('treats a date without an announced time as the whole IST day, and multi-day events as one span', async () => {
    ctx.clock.now = new Date('2026-09-18T12:00:00+05:30');
    assert.equal(byId(await events(), 'cutm-college-rivals-4').phase, 'ongoing');
    ctx.clock.now = new Date('2026-09-17T20:00:00+05:30');
    assert.equal(byId(await events(), 'cutm-microorganism-day').phase, 'ongoing');
    ctx.clock.now = new Date('2026-09-18T00:00:00+05:30');
    assert.equal(byId(await events(), 'cutm-microorganism-day').phase, 'completed');

    const scopes = byId(await events(), 'cutm-ieee-scopes-2027');
    assert.equal(scopes.startsAt, new Date('2027-02-04T00:00:00+05:30').toISOString());
    assert.equal(scopes.endsAt, new Date('2027-02-06T23:59:00+05:30').toISOString());
  });
});

describe('no invented facts', () => {
  it('leaves everything the source doesn’t give as not specified', async () => {
    for (const e of await events()) {
      assert.equal(e.timeTbd, true, e.id);
      assert.equal(e.registrationMode, 'unspecified', e.id);
      assert.equal(e.availability, 'no_registration', e.id);
      assert.equal(e.capacity, null, e.id);
      assert.equal(e.seatsAvailable, null, e.id);
      assert.equal(e.feeAmount, null, e.id);
      assert.equal(e.eligibilityText, null, e.id);
      assert.equal(e.registrationOpensAt, null, e.id);
      assert.equal(e.venue, null, e.id);
      assert.equal(e.contactPerson, null, e.id);
      assert.equal(e.image, null, e.id);
      assert.equal(e.isSample, false, e.id);
      assert.match(String(e.sourceNote), /CUTM communication/);
      // No fabricated activity attached to real events.
      assert.equal(e.seatsTaken, 0, e.id);
      assert.equal(e.waitlistCount, 0, e.id);
    }
  });

  it('names an organizer only when the source does', async () => {
    const list = await events();
    assert.deepEqual(byId(list, 'cutm-ncc-plantation-drive').organization?.name, 'NCC');
    for (const e of list.filter(x => x.id !== 'cutm-ncc-plantation-drive')) assert.equal(e.organization, null, e.id);
    const ncc = await ctx.request('GET', '/clubs/ncc');
    assert.deepEqual(ncc.json.events.map((e: Ev) => e.id), ['cutm-ncc-plantation-drive']);
    assert.equal(ncc.json.club.description, null);
  });

  it('doesn’t take registrations the source didn’t announce', async () => {
    const res = await ctx.request('POST', '/events/cutm-ieee-scopes-2027/registrations', { cookie: await ctx.login('usr-aarav'), body: REGISTER_BODY });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'registration_not_available');
  });

  it('lets only admins manage an event whose organizer isn’t specified', async () => {
    assert.equal((await ctx.request('GET', '/admin/events/cutm-ieee-scopes-2027', { cookie: await ctx.login('usr-admin') })).status, 200);
    assert.equal((await ctx.request('GET', '/admin/events/cutm-ieee-scopes-2027', { cookie: await ctx.login('usr-rahul') })).status, 403);
  });

  it('has no opportunities, clubs or sample activity it can’t source', async () => {
    assert.deepEqual((await ctx.request('GET', '/opportunities')).json.opportunities, []);
    assert.deepEqual((await ctx.request('GET', '/clubs')).json.clubs.map((c: { name: string }) => c.name), ['NCC']);
  });
});

describe('migration 0006 on an existing database', () => {
  it('keeps existing events, marks the built-in sample ids, and relaxes the not-specified columns', async () => {
    const db = createDb(':memory:');
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
    assert.equal((await migrator.migrateTo('0005_integrations')).error, undefined);

    await sql`insert into users (id, university_id, name, email, campus, roles, created_at) values ('u1', 'U1', 'Admin', 'a@x', 'Bhubaneswar', '["admin"]', '2026-01-01')`.execute(db);
    await sql`insert into organizations (id, type, name, slug, created_at) values ('o1', 'club', 'Club', 'club', '2026-01-01')`.execute(db);
    await sql`insert into categories (id, name, slug) values ('cat-workshop', 'Workshop', 'workshop')`.execute(db);
    for (const id of ['e1', 'x1']) {
      await sql`insert into events (id, slug, organization_id, category_id, title, description, starts_at, ends_at, registration_opens_at,
                registration_closes_at, capacity, eligibility_text, created_by, created_at, updated_at, status)
                values (${id}, ${id}, 'o1', 'cat-workshop', 'T', 'Description here', '2026-10-02', '2026-10-03', '2026-09-01', '2026-10-01', 30, 'All', 'u1', '2026-01-01', '2026-01-01', 'published')`.execute(db);
    }
    await sql`insert into saved_events (user_id, event_id, created_at) values ('u1', 'e1', '2026-01-01')`.execute(db);

    assert.equal((await migrator.migrateToLatest()).error, undefined);
    const rows = (await sql<{ id: string; is_sample: number; registration_mode: string; capacity: number }>`select id, is_sample, registration_mode, capacity from events order by id`.execute(db)).rows;
    assert.deepEqual(rows, [
      { id: 'e1', is_sample: 1, registration_mode: 'eventease', capacity: 30 },
      { id: 'x1', is_sample: 0, registration_mode: 'eventease', capacity: 30 },
    ]);
    // References survive the rebuild, and the new nullable columns accept "not specified".
    assert.equal((await sql<{ n: number }>`select count(*) as n from saved_events`.execute(db)).rows[0].n, 1);
    await sql`update events set capacity = null, organization_id = null, registration_mode = 'unspecified', registration_opens_at = null, registration_closes_at = null where id = 'x1'`.execute(db);
    assert.equal((await sql<{ name: string }>`select name from categories where id = 'cat-workshop'`.execute(db)).rows[0].name, 'Workshops');
    await db.destroy();
  });
});
