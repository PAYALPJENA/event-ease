import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.ts';

/** A production environment with every required secret set. */
const PROD_ENV = {
  NODE_ENV: 'production',
  PASS_SECRET: 'x'.repeat(40),
  PAYMENT_WEBHOOK_SECRET: 'w'.repeat(40),
  PAYMENT_GATEWAY: 'razorpay',
  VAPID_PUBLIC_KEY: 'pub',
  VAPID_PRIVATE_KEY: 'priv',
};
import { createPassToken, verifyPassToken } from '../src/lib/pass.ts';
import { availability, eventPhase, isEligible, PHONE_REGEX } from '../src/lib/rules.ts';

const event = {
  status: 'published' as const,
  registration_opens_at: '2026-09-01T00:00:00.000Z',
  registration_closes_at: '2026-09-30T00:00:00.000Z',
  capacity: 10 as number | null,
  registration_mode: 'eventease' as const,
};

describe('availability (derived, blueprint §3.3)', () => {
  it('reports not_open / open / closing_soon / full / closed', () => {
    assert.equal(availability(event, 0, new Date('2026-08-31T23:59:00Z')), 'not_open');
    assert.equal(availability(event, 0, new Date('2026-09-10T00:00:00Z')), 'open');
    assert.equal(availability(event, 0, new Date('2026-09-28T12:00:00Z')), 'closing_soon');
    assert.equal(availability(event, 10, new Date('2026-09-10T00:00:00Z')), 'full');
    assert.equal(availability(event, 0, new Date('2026-09-30T00:00:00Z')), 'closed');
    assert.equal(availability({ ...event, status: 'cancelled' }, 0, new Date('2026-09-10T00:00:00Z')), 'closed');
  });

  it('never reports full without a capacity limit, and no_registration when students don’t register here', () => {
    assert.equal(availability({ ...event, capacity: null }, 5000, new Date('2026-09-10T00:00:00Z')), 'open');
    for (const mode of ['not_required', 'unspecified'] as const) {
      assert.equal(availability({ ...event, registration_mode: mode, registration_opens_at: null, registration_closes_at: null }, 0, new Date('2026-09-10T00:00:00Z')), 'no_registration');
    }
  });
});

describe('eventPhase', () => {
  const e = { starts_at: '2026-10-05T04:30:00.000Z', ends_at: '2026-10-06T04:30:00.000Z' };
  it('handles an overnight event', () => {
    assert.equal(eventPhase(e, new Date('2026-10-05T04:29:00Z')), 'upcoming');
    assert.equal(eventPhase(e, new Date('2026-10-05T20:00:00Z')), 'ongoing');
    assert.equal(eventPhase(e, new Date('2026-10-06T04:30:00Z')), 'completed');
  });
});

describe('isEligible', () => {
  const restricted = { eligible_departments: '["CSE"]', eligible_years: '[2,3]' };
  it('checks department and year from the university profile', () => {
    assert.equal(isEligible(restricted, { department: 'CSE', year: 3 }), true);
    assert.equal(isEligible(restricted, { department: 'CSE', year: 1 }), false);
    assert.equal(isEligible(restricted, { department: 'BBA', year: 2 }), false);
    assert.equal(isEligible(restricted, { department: null, year: null }), false);
    assert.equal(isEligible({ eligible_departments: null, eligible_years: null }, { department: null, year: null }), true);
  });
});

describe('PHONE_REGEX', () => {
  it('accepts Indian mobile formats and rejects invalid ones', () => {
    for (const ok of ['9876543210', '+91 98765 43210', '+91-9876543210', '09876543210', '98765 43210']) assert.match(ok, PHONE_REGEX);
    for (const bad of ['1234567890', '98765abcde', '987654321', '98765432101', '']) assert.doesNotMatch(bad, PHONE_REGEX);
  });
});

describe('pass tokens (blueprint §9.3)', () => {
  const secret = 'test-secret';
  it('round-trips a signed token', () => {
    const token = createPassToken('reg-1', 'evt-1', secret);
    assert.deepEqual(verifyPassToken(token, secret), { registrationId: 'reg-1', eventId: 'evt-1' });
  });
  it('rejects tampered, re-signed or malformed tokens', () => {
    const token = createPassToken('reg-1', 'evt-1', secret);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, r: 'reg-2', e: 'evt-1' })).toString('base64url');
    assert.equal(verifyPassToken(`${forgedPayload}.${sig}`, secret), null);
    assert.equal(verifyPassToken(token, 'other-secret'), null);
    assert.equal(verifyPassToken('not-a-token', secret), null);
    assert.equal(verifyPassToken(`${token}.extra`, secret), null);
  });
});

describe('config safety', () => {
  it('refuses the development sign-in in production', () => {
    assert.throws(() => loadConfig({ ...PROD_ENV, AUTH_MODE: 'dev' }), /cannot run in production/);
  });
  it('refuses the default pass secret in production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'sso' }), /PASS_SECRET/);
  });
  it('defaults to SSO mode in production', () => {
    assert.equal(loadConfig({ ...PROD_ENV }).authMode, 'sso');
  });
  it('refuses the mock payment gateway and missing secrets in production', () => {
    assert.throws(() => loadConfig({ ...PROD_ENV, PAYMENT_GATEWAY: 'mock' }), /mock payment gateway/);
    assert.throws(() => loadConfig({ ...PROD_ENV, PAYMENT_WEBHOOK_SECRET: undefined }), /PAYMENT_WEBHOOK_SECRET/);
    assert.throws(() => loadConfig({ ...PROD_ENV, VAPID_PRIVATE_KEY: undefined }), /VAPID/);
  });
});
