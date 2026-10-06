import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createPublishedEvent, createTestContext, eventBody, REGISTER_BODY } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});

describe('auth', () => {
  it('signs in with the development sign-in and returns the profile', async () => {
    const cookie = await ctx.login('usr-aarav');
    const me = await ctx.request('GET', '/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.name, 'Aarav Kumar');
    assert.deepEqual(me.json.user.roles, ['student']);
  });

  it('hides bulk seed students from the sign-in picker', async () => {
    const res = await ctx.request('GET', '/auth/dev-users');
    assert.equal(res.status, 200);
    assert.equal(res.json.users.length, 6);
    assert.ok(res.json.users.every((u: { universityId: string }) => !u.universityId.startsWith('GEN')));
  });

  it('logs out and invalidates the session server-side', async () => {
    const cookie = await ctx.login('usr-aarav');
    await ctx.request('POST', '/auth/logout', { cookie });
    assert.equal((await ctx.request('GET', '/auth/me', { cookie })).json.user, null);
    assert.equal((await ctx.request('GET', '/me/registrations', { cookie })).status, 401);
  });

  it('rejects expired sessions', async () => {
    const cookie = await ctx.login('usr-aarav');
    ctx.clock.now = new Date(ctx.clock.now.getTime() + (ctx.config.sessionTtlHours + 1) * 3600_000);
    assert.equal((await ctx.request('GET', '/auth/me', { cookie })).json.user, null);
    assert.equal((await ctx.request('GET', '/me/saved', { cookie })).status, 401);
  });

  it('disables the development sign-in outside dev mode', async () => {
    const sso = await createTestContext({ authMode: 'sso' });
    assert.equal((await sso.request('GET', '/auth/dev-users')).status, 404);
    assert.equal((await sso.request('POST', '/auth/dev-login', { body: { userId: 'usr-admin' } })).status, 404);
  });
});

describe('CSRF protection', () => {
  it('rejects writes from another origin', async () => {
    const cookie = await ctx.login('usr-aarav');
    const res = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY, headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });

  it('rejects non-JSON bodies (what a cross-site form would send)', async () => {
    const cookie = await ctx.login('usr-aarav');
    const res = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY, headers: { 'content-type': 'text/plain' } });
    assert.equal(res.status, 415);
  });
});

describe('public events', () => {
  it('lists only published events with live seat counts and derived state', async () => {
    const res = await ctx.request('GET', '/events');
    assert.equal(res.status, 200);
    const ids = res.json.events.map((e: { id: string }) => e.id);
    // e6 is a draft and e7 is waiting for approval; neither is public.
    assert.deepEqual(ids.sort(), ['e1', 'e10', 'e2', 'e3', 'e4', 'e5', 'e8', 'e9']);
    const e1 = res.json.events.find((e: { id: string }) => e.id === 'e1');
    assert.equal(e1.seatsTaken, 150);
    assert.equal(e1.seatsAvailable, 50);
    assert.equal(e1.availability, 'open');
    assert.equal(e1.phase, 'upcoming');
    const e2 = res.json.events.find((e: { id: string }) => e.id === 'e2');
    assert.equal(e2.phase, 'completed');
    assert.equal(e2.availability, 'closed');
  });

  it('shows drafts only to staff of the owning organization', async () => {
    assert.equal((await ctx.request('GET', '/events/e6')).status, 404);
    assert.equal((await ctx.request('GET', '/events/e6', { cookie: await ctx.login('usr-aarav') })).status, 404);
    assert.equal((await ctx.request('GET', '/events/e6', { cookie: await ctx.login('usr-anita') })).status, 404);
    assert.equal((await ctx.request('GET', '/events/e6', { cookie: await ctx.login('usr-rahul') })).status, 200);
    assert.equal((await ctx.request('GET', '/events/e6', { cookie: await ctx.login('usr-admin') })).status, 200);
  });

  it('finds events by slug as well as id', async () => {
    const res = await ctx.request('GET', '/events/cutm-techfest-2026');
    assert.equal(res.json.event.id, 'e1');
  });
});

describe('registration (blueprint §8.3 invariants)', () => {
  it('requires sign-in', async () => {
    assert.equal((await ctx.request('POST', '/events/e1/registrations', { body: REGISTER_BODY })).status, 401);
  });

  it('registers, takes a seat, notifies, and blocks duplicates (#1)', async () => {
    const cookie = await ctx.login('usr-priya');
    const res = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY });
    assert.equal(res.status, 201);
    assert.match(res.json.registration.code, /^CUTM-[0-9A-Z]{6}$/);
    assert.equal(res.json.registration.status, 'confirmed');

    const event = await ctx.request('GET', '/events/e1');
    assert.equal(event.json.event.seatsTaken, 151);

    const notes = await ctx.request('GET', '/me/notifications', { cookie });
    assert.match(notes.json.notifications[0].title, /^Registration confirmed/);
    assert.equal(notes.json.unreadCount, 1);

    const again = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'already_registered');
  });

  it('validates the phone number and the agreement', async () => {
    const cookie = await ctx.login('usr-priya');
    const badPhone = await ctx.request('POST', '/events/e1/registrations', { cookie, body: { phone: '12345', agree: true } });
    assert.equal(badPhone.status, 400);
    const noAgree = await ctx.request('POST', '/events/e1/registrations', { cookie, body: { phone: '9876543210' } });
    assert.equal(noAgree.status, 400);
  });

  it('enforces eligibility from the university profile (#3)', async () => {
    const admin = await ctx.login('usr-admin');
    const id = await createPublishedEvent(ctx, admin, { eligibilityText: 'CSE 2nd & 3rd year', eligibleDepartments: ['CSE'], eligibleYears: [2, 3] });
    const rohan = await ctx.request('POST', `/events/${id}/registrations`, { cookie: await ctx.login('usr-rohan'), body: REGISTER_BODY });
    assert.equal(rohan.status, 403);
    assert.equal(rohan.json.error.code, 'not_eligible');
    const aarav = await ctx.request('POST', `/events/${id}/registrations`, { cookie: await ctx.login('usr-aarav'), body: REGISTER_BODY });
    assert.equal(aarav.status, 201);
  });

  it('enforces the registration window (#3)', async () => {
    const cookie = await ctx.login('usr-priya');
    const closed = await ctx.request('POST', '/events/e4/registrations', { cookie, body: REGISTER_BODY });
    assert.equal(closed.json.error.code, 'registration_closed');

    const admin = await ctx.login('usr-admin');
    const id = await createPublishedEvent(ctx, admin, { registrationOpensAt: '2026-10-01T00:00:00.000Z' });
    const early = await ctx.request('POST', `/events/${id}/registrations`, { cookie, body: REGISTER_BODY });
    assert.equal(early.json.error.code, 'registration_not_open');
  });

  it('never exceeds capacity, and a cancellation frees the seat (#2)', async () => {
    const admin = await ctx.login('usr-admin');
    const id = await createPublishedEvent(ctx, admin, { capacity: 2 });
    const [a, b, c] = await Promise.all(['usr-aarav', 'usr-priya', 'usr-rohan'].map(u => ctx.login(u)));

    assert.equal((await ctx.request('POST', `/events/${id}/registrations`, { cookie: a, body: REGISTER_BODY })).status, 201);
    const second = await ctx.request('POST', `/events/${id}/registrations`, { cookie: b, body: REGISTER_BODY });
    assert.equal(second.status, 201);
    const full = await ctx.request('POST', `/events/${id}/registrations`, { cookie: c, body: REGISTER_BODY });
    assert.equal(full.json.error.code, 'event_full');

    const cancel = await ctx.request('POST', `/me/registrations/${second.json.registration.id}/cancel`, { cookie: b });
    assert.equal(cancel.status, 200);
    assert.equal((await ctx.request('POST', `/events/${id}/registrations`, { cookie: c, body: REGISTER_BODY })).status, 201);
  });

  it('gives exactly one seat when many students race for the last one (#2)', async () => {
    const admin = await ctx.login('usr-admin');
    const id = await createPublishedEvent(ctx, admin, { capacity: 1 });
    const cookies = await Promise.all(['usr-aarav', 'usr-priya', 'usr-rohan', 'usr-rahul'].map(u => ctx.login(u)));
    const results = await Promise.all(cookies.map(cookie => ctx.request('POST', `/events/${id}/registrations`, { cookie, body: REGISTER_BODY })));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal(results.filter(r => r.json?.error?.code === 'event_full').length, 3);
    assert.equal((await ctx.request('GET', `/events/${id}`)).json.event.seatsTaken, 1);
  });

  it('allows re-registering after cancelling', async () => {
    const cookie = await ctx.login('usr-priya');
    const first = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY });
    await ctx.request('POST', `/me/registrations/${first.json.registration.id}/cancel`, { cookie });
    assert.equal((await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY })).status, 201);
  });

  it("doesn't let students cancel someone else's registration or cancel after the start", async () => {
    const priya = await ctx.login('usr-priya');
    const reg = await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const other = await ctx.request('POST', `/me/registrations/${reg.json.registration.id}/cancel`, { cookie: await ctx.login('usr-rohan') });
    assert.equal(other.status, 404);

    ctx.clock.now = new Date('2026-10-15T04:00:00.000Z'); // TechFest has started
    // (The earlier session has expired by then, so sign in again.)
    const late = await ctx.request('POST', `/me/registrations/${reg.json.registration.id}/cancel`, { cookie: await ctx.login('usr-priya') });
    assert.equal(late.json.error.code, 'event_started');
  });
});

describe('my events, pass and feedback', () => {
  it('lists registrations with their events and seeded history', async () => {
    const cookie = await ctx.login('usr-aarav');
    const res = await ctx.request('GET', '/me/registrations', { cookie });
    assert.equal(res.json.registrations.length, 1);
    assert.equal(res.json.registrations[0].event.id, 'e2');
    assert.equal(res.json.registrations[0].event.phase, 'completed');
  });

  it('issues a signed pass that staff of the organizing club can verify', async () => {
    const priya = await ctx.login('usr-priya');
    const reg = await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const detail = await ctx.request('GET', `/me/registrations/${reg.json.registration.id}`, { cookie: priya });
    const token = detail.json.registration.passToken as string;
    assert.ok(token.includes('.'));

    const rahul = await ctx.login('usr-rahul'); // leads CUTM Tech Club, which runs e1
    const ok = await ctx.request('POST', '/admin/passes/verify', { cookie: rahul, body: { token } });
    assert.equal(ok.json.valid, true);
    assert.equal(ok.json.student.name, 'Priya Das');

    const tampered = await ctx.request('POST', '/admin/passes/verify', { cookie: rahul, body: { token: token.slice(0, -2) + 'xx' } });
    assert.equal(tampered.json.valid, false);

    const anita = await ctx.login('usr-anita'); // CSE department; not the organizer of e1
    assert.equal((await ctx.request('POST', '/admin/passes/verify', { cookie: anita, body: { token } })).status, 403);

    await ctx.request('POST', `/me/registrations/${reg.json.registration.id}/cancel`, { cookie: priya });
    const afterCancel = await ctx.request('POST', '/admin/passes/verify', { cookie: rahul, body: { token } });
    assert.deepEqual([afterCancel.json.valid, afterCancel.json.reason], [false, 'registration_cancelled']);
    const cancelledDetail = await ctx.request('GET', `/me/registrations/${reg.json.registration.id}`, { cookie: priya });
    assert.equal(cancelledDetail.json.registration.passToken, null);
  });

  it("hides other students' registrations", async () => {
    const aarav = await ctx.login('usr-aarav');
    const mine = await ctx.request('GET', '/me/registrations', { cookie: aarav });
    const res = await ctx.request('GET', `/me/registrations/${mine.json.registrations[0].id}`, { cookie: await ctx.login('usr-priya') });
    assert.equal(res.status, 404);
  });

  it('accepts one feedback per attended past event (#4)', async () => {
    const cookie = await ctx.login('usr-aarav');
    const regId = (await ctx.request('GET', '/me/registrations', { cookie })).json.registrations[0].id;
    const first = await ctx.request('POST', `/me/registrations/${regId}/feedback`, { cookie, body: { rating: 5, comment: 'Great workshop' } });
    assert.equal(first.status, 201);
    const again = await ctx.request('POST', `/me/registrations/${regId}/feedback`, { cookie, body: { rating: 4, comment: 'Again' } });
    assert.equal(again.json.error.code, 'feedback_exists');
    const list = await ctx.request('GET', '/me/registrations', { cookie });
    assert.equal(list.json.registrations[0].hasFeedback, true);
  });

  it('refuses feedback before the event ends', async () => {
    const cookie = await ctx.login('usr-priya');
    const reg = await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY });
    const res = await ctx.request('POST', `/me/registrations/${reg.json.registration.id}/feedback`, { cookie, body: { rating: 5, comment: 'Too early' } });
    assert.equal(res.json.error.code, 'event_not_finished');
  });

  it('saves and unsaves events, but never drafts', async () => {
    const cookie = await ctx.login('usr-priya');
    await ctx.request('PUT', '/me/saved/e3', { cookie });
    await ctx.request('PUT', '/me/saved/e3', { cookie }); // idempotent
    assert.deepEqual((await ctx.request('GET', '/me/saved', { cookie })).json.eventIds, ['e3']);
    await ctx.request('DELETE', '/me/saved/e3', { cookie });
    assert.deepEqual((await ctx.request('GET', '/me/saved', { cookie })).json.eventIds, []);
    assert.equal((await ctx.request('PUT', '/me/saved/e6', { cookie })).status, 404);
  });

  it('marks all notifications read', async () => {
    const cookie = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/registrations', { cookie, body: REGISTER_BODY });
    await ctx.request('POST', '/me/notifications/read-all', { cookie });
    assert.equal((await ctx.request('GET', '/me/notifications', { cookie })).json.unreadCount, 0);
  });
});

describe('admin and organizer', () => {
  it('keeps students and anonymous users out', async () => {
    assert.equal((await ctx.request('GET', '/admin/events')).status, 401);
    assert.equal((await ctx.request('GET', '/admin/events', { cookie: await ctx.login('usr-aarav') })).status, 403);
  });

  it("scopes organizers to their own organizations' events", async () => {
    const rahul = await ctx.login('usr-rahul');
    const res = await ctx.request('GET', '/admin/events', { cookie: rahul });
    assert.deepEqual(res.json.events.map((e: { id: string }) => e.id).sort(), ['e1', 'e10', 'e5', 'e6', 'e8', 'e9']);
    const opts = await ctx.request('GET', '/admin/options', { cookie: rahul });
    assert.deepEqual(opts.json.organizations.map((o: { id: string }) => o.id).sort(), ['org-coding', 'org-tech-club']);

    const foreign = await ctx.request('POST', '/admin/events', { cookie: rahul, body: eventBody({ organizationId: 'org-cse' }) });
    assert.equal(foreign.status, 403);
    assert.equal((await ctx.request('GET', '/admin/events/e2/registrations', { cookie: rahul })).status, 403);
  });

  it('publishes a draft after admin approval so students can see and register for it', async () => {
    const rahul = await ctx.login('usr-rahul');
    // Organizers can't publish directly; they submit for approval (§3.3).
    assert.equal((await ctx.request('POST', '/admin/events/e6/publish', { cookie: rahul })).status, 403);
    assert.equal((await ctx.request('POST', '/admin/events/e6/submit', { cookie: rahul })).status, 200);
    const admin = await ctx.login('usr-admin');
    assert.equal((await ctx.request('POST', '/admin/events/e6/review', { cookie: admin, body: { decision: 'approve' } })).status, 200);
    assert.ok((await ctx.request('GET', '/events')).json.events.some((e: { id: string }) => e.id === 'e6'));
    // Registration for e6 opens on 25 Sep, two days after "today".
    ctx.clock.now = new Date('2026-09-26T06:00:00.000Z');
    const reg = await ctx.request('POST', '/events/e6/registrations', { cookie: await ctx.login('usr-priya'), body: REGISTER_BODY });
    assert.equal(reg.status, 201);
    assert.equal((await ctx.request('POST', '/admin/events/e6/publish', { cookie: await ctx.login('usr-admin') })).json.error.code, 'not_draft');
  });

  it('validates the event timeline and venue', async () => {
    const admin = await ctx.login('usr-admin');
    const backwards = await ctx.request('POST', '/admin/events', { cookie: admin, body: eventBody({ endsAt: '2026-10-30T07:00:00.000Z' }) });
    assert.equal(backwards.status, 400);
    const noVenue = await ctx.request('POST', '/admin/events', { cookie: admin, body: eventBody({ venueId: null }) });
    assert.equal(noVenue.status, 400);
    const online = await ctx.request('POST', '/admin/events', { cookie: admin, body: eventBody({ venueId: null, mode: 'online', onlineUrl: 'https://meet.example/abc' }) });
    assert.equal(online.status, 201);
  });

  it('notifies registrants when a published event changes time or venue (§7.1)', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const rahul = await ctx.login('usr-rahul');
    const current = (await ctx.request('GET', '/admin/events/e1', { cookie: rahul })).json.event;

    const body = eventBody({
      title: current.title,
      description: current.description,
      organizationId: current.organization.id,
      categoryId: current.category.id,
      venueId: 'ven-oat',
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      registrationOpensAt: current.registrationOpensAt,
      registrationClosesAt: current.registrationClosesAt,
      capacity: current.capacity,
    });
    // A time or venue change after publishing needs a reason (§5).
    const noReason = await ctx.request('PUT', '/admin/events/e1', { cookie: rahul, body });
    assert.equal(noReason.json.error.code, 'change_reason_required');
    const changeReason = 'Main campus lawns are being re-turfed';
    assert.equal((await ctx.request('PUT', '/admin/events/e1', { cookie: rahul, body: { ...body, changeReason } })).status, 200);
    const notes = await ctx.request('GET', '/me/notifications', { cookie: priya });
    assert.equal(notes.json.notifications[0].category, 'changes');
    assert.match(notes.json.notifications[0].title, /venue changed/);
    assert.match(notes.json.notifications[0].body, /Open Air Theatre.*re-turfed/);

    // The change is recorded for the event page's change banner, and emailed (critical, §7.2).
    const page = await ctx.request('GET', '/events/e1');
    assert.equal(page.json.changes[0].field, 'venue');
    assert.equal(page.json.changes[0].reason, changeReason);
    const outbox = await ctx.db.selectFrom('message_outbox').select('subject').where('channel', '=', 'email').where('to_address', '=', 'priya.d@cutm.ac.in').execute();
    assert.ok(outbox.some(e => /venue changed/.test(e.subject)));

    const tooSmall = await ctx.request('PUT', '/admin/events/e1', { cookie: rahul, body: { ...body, capacity: 10 } });
    assert.equal(tooSmall.json.error.code, 'capacity_below_registrations');
  });

  it('cancelling an event with registrations needs an admin, then cancels registrations and notifies students', async () => {
    const priya = await ctx.login('usr-priya');
    const reg = await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const rahul = await ctx.login('usr-rahul');
    const requested = await ctx.request('POST', '/admin/events/e1/cancel', { cookie: rahul, body: { reason: 'Venue unavailable' } });
    assert.equal(requested.status, 202);
    assert.equal(requested.json.status, 'cancel_requested');
    assert.equal((await ctx.request('GET', '/events/e1')).json.event.status, 'published');

    const admin = await ctx.login('usr-admin');
    const queue = await ctx.request('GET', '/admin/approvals', { cookie: admin });
    assert.equal(queue.json.cancelRequests[0].id, 'e1');
    assert.equal(queue.json.cancelRequests[0].requestedBy, 'Rahul Sharma');
    const res = await ctx.request('POST', '/admin/events/e1/cancel', { cookie: admin, body: { reason: 'Venue unavailable' } });
    assert.equal(res.status, 200);

    const detail = await ctx.request('GET', `/me/registrations/${reg.json.registration.id}`, { cookie: priya });
    assert.equal(detail.json.registration.status, 'cancelled');
    assert.match(detail.json.registration.cancelReason, /Venue unavailable/);
    assert.equal((await ctx.request('GET', '/me/notifications', { cookie: priya })).json.notifications[0].title, 'CUTM TechFest 2026 has been cancelled');
    assert.equal((await ctx.request('GET', '/events/e1')).json.event.seatsTaken, 0);
    const again = await ctx.request('POST', '/events/e1/registrations', { cookie: await ctx.login('usr-rohan'), body: REGISTER_BODY });
    assert.equal(again.json.error.code, 'event_cancelled');
  });

  it('lists participants with only the fields organizers need', async () => {
    const res = await ctx.request('GET', '/admin/events/e2/registrations', { cookie: await ctx.login('usr-anita') });
    assert.equal(res.status, 200);
    assert.equal(res.json.registrations.length, 46);
    assert.deepEqual(Object.keys(res.json.registrations[0]).sort(), [
      'answers', 'cancelReason', 'cancelledAt', 'checkInMethod', 'checkedInAt', 'code', 'createdAt', 'department', 'documents', 'email',
      'feedbackRating', 'id', 'name', 'payment', 'phone', 'source', 'status', 'teamName', 'universityId', 'year',
    ]);
  });
});
