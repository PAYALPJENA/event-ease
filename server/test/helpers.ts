import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { AppConfig } from '../src/config.ts';
import { createDb, migrateToLatest } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import type { SeedOptions } from '../src/db/seed.ts';
import os from 'node:os';
import path from 'node:path';
import { createMemorySenders } from '../src/lib/channels.ts';
import { mockGateway } from '../src/services/payments.ts';
import { runScheduledTasks } from '../src/services/scheduler.ts';

/** 23 Sep 2026, 11:30 IST — the same "today" the seed data was written for. */
export const DEFAULT_NOW = new Date('2026-09-23T06:00:00.000Z');
export const ORIGIN = 'http://localhost:5173';

/**
 * A fresh in-memory app. By default it runs on the fictional sample set at
 * DEFAULT_NOW; pass `data`/`now` to test against other seed content.
 */
export const createTestContext = async (overrides: Partial<AppConfig> = {}, options: { data?: SeedOptions; now?: Date } = {}) => {
  const start = options.now ?? DEFAULT_NOW;
  const uploadsDir = path.join(os.tmpdir(), `eventease-test-uploads-${process.pid}`);
  const config: AppConfig = { ...loadConfig({ NODE_ENV: 'test' }), dbPath: ':memory:', uploadsDir, ...overrides };
  const db = createDb(':memory:');
  await migrateToLatest(db);
  // The API tests run against the fictional sample set (fixed ids e1–e10);
  // the real CUTM events have their own tests in cutm-seed.test.ts.
  await seed(db, start, options.data ?? { cutm: false, samples: true });

  const clock = { now: new Date(start) };
  const { senders, sent } = createMemorySenders();
  const deps = { db, config, now: () => new Date(clock.now), senders, gateway: mockGateway };
  /** Emails delivered so far (other channels are in `sent`). */
  const emails = { some: (fn: (m: (typeof sent)[number]) => boolean) => sent.filter(m => m.channel === 'email').some(fn) };
  const app = createApp(deps);
  /** One scheduler tick at the test clock's current time. */
  const runScheduler = () => runScheduledTasks(deps);

  const request = async (method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...opts.headers };
    if (opts.cookie) headers.cookie = opts.cookie;
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await app.request(`/api${path}`, { method, headers, body });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, json, headers: res.headers };
  };

  /** Signs in with the development sign-in and returns the session cookie. */
  const login = async (userId: string) => {
    const res = await request('POST', '/auth/dev-login', { body: { userId } });
    if (res.status !== 200) throw new Error(`login failed for ${userId}: ${JSON.stringify(res.json)}`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    return setCookie.split(';')[0];
  };

  return { db, app, clock, config, request, login, emails, sent, runScheduler, deps };
};

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

/** A valid event body for the admin API, open for registration at DEFAULT_NOW. */
export const eventBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Test Event',
  summary: null,
  description: 'A test event created by the automated test suite.',
  image: null,
  organizationId: 'org-tech-club',
  categoryId: 'cat-workshop',
  venueId: 'ven-innovation-lab',
  mode: 'in_person',
  onlineUrl: null,
  startsAt: '2026-10-30T08:30:00.000Z',
  endsAt: '2026-10-30T11:30:00.000Z',
  registrationOpensAt: '2026-09-01T00:00:00.000Z',
  registrationClosesAt: '2026-10-28T18:29:00.000Z',
  capacity: 50,
  eligibilityText: 'All CUTM students',
  eligibleDepartments: null,
  eligibleYears: null,
  requirements: [],
  contactPerson: null,
  contactEmail: null,
  isFeatured: false,
  ...overrides,
});

/** Creates and publishes an event as the given admin cookie; returns its id. */
export const createPublishedEvent = async (ctx: TestContext, staffCookie: string, overrides: Record<string, unknown> = {}) => {
  const created = await ctx.request('POST', '/admin/events', { cookie: staffCookie, body: eventBody(overrides) });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.json)}`);
  const id = created.json.event.id as string;
  const published = await ctx.request('POST', `/admin/events/${id}/publish`, { cookie: staffCookie });
  if (published.status !== 200) throw new Error(`publish failed: ${JSON.stringify(published.json)}`);
  return id;
};

export const REGISTER_BODY = { phone: '+91 98765 43210', agree: true };
