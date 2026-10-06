import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createPassToken } from '../src/lib/pass.ts';
import { deliverOutbox } from '../src/services/scheduler.ts';
import { createPublishedEvent, createTestContext, eventBody, REGISTER_BODY } from './helpers.ts';
import type { TestContext } from './helpers.ts';

// V2 — event operations (blueprint §10 V2): approval workflow, check-in and
// attendance, change propagation, announcements, reminders and email.
//
// Seed facts used below (see src/db/seed.ts), with "now" = 23 Sep 2026 06:00 UTC:
//   e1 TechFest (Tech Club) 15 Oct · e5 Hackathon (Coding Club, Innovation Lab) 5–6 Oct
//   e6 draft (Tech Club) · e7 pending approval (CSE, submitted by Anita)
//   e8 live talk (Tech Club): starts now+1h, ends now+4h; Priya and Rohan registered

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});

const HOUR = 3600_000;
const at = (offsetHours: number) => new Date(ctx.clock.now.getTime() + offsetHours * HOUR);

const registrationOf = async (userId: string, eventId: string) =>
  ctx.db
    .selectFrom('registrations')
    .selectAll()
    .where('user_id', '=', userId)
    .where('event_id', '=', eventId)
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow();

const passFor = async (userId: string, eventId: string) => {
  const reg = await registrationOf(userId, eventId);
  return createPassToken(reg.id, eventId, ctx.config.passSecret);
};

const notificationsOf = async (userId: string) =>
  (await ctx.request('GET', '/me/notifications', { cookie: await ctx.login(userId) })).json.notifications as { title: string; body: string; category: string }[];

describe('approval workflow (§3.3)', () => {
  it('hides events under review from students but shows them to their organizers and admins', async () => {
    assert.equal((await ctx.request('GET', '/events/e7', { cookie: await ctx.login('usr-priya') })).status, 404);
    assert.equal((await ctx.request('GET', '/events/e7', { cookie: await ctx.login('usr-rahul') })).status, 404);
    assert.equal((await ctx.request('GET', '/events/e7', { cookie: await ctx.login('usr-anita') })).status, 200);
    assert.equal((await ctx.request('GET', '/events/e7', { cookie: await ctx.login('usr-admin') })).status, 200);
  });

  it('runs submit → request changes → resubmit → approve, notifying each side', async () => {
    const rahul = await ctx.login('usr-rahul');
    const admin = await ctx.login('usr-admin');

    assert.equal((await ctx.request('POST', '/admin/events/e6/submit', { cookie: rahul, body: { note: 'Ready for review' } })).status, 200);
    assert.equal((await notificationsOf('usr-admin'))[0].title, 'Awaiting approval: Git & GitHub Bootcamp');

    // Organizers can't edit while it's under review.
    const current = (await ctx.request('GET', '/admin/events/e6', { cookie: rahul })).json.event;
    const body = eventBody({
      title: current.title,
      description: current.description,
      venueId: current.venue.id,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      registrationOpensAt: current.registrationOpensAt,
      registrationClosesAt: current.registrationClosesAt,
    });
    assert.equal((await ctx.request('PUT', '/admin/events/e6', { cookie: rahul, body })).json.error.code, 'under_review');

    const queue = await ctx.request('GET', '/admin/approvals', { cookie: admin });
    assert.deepEqual(queue.json.pending.map((e: { id: string }) => e.id).sort(), ['e6', 'e7']);

    // Changes need a comment.
    const noComment = await ctx.request('POST', '/admin/events/e6/review', { cookie: admin, body: { decision: 'request_changes' } });
    assert.equal(noComment.status, 400);
    const changes = await ctx.request('POST', '/admin/events/e6/review', {
      cookie: admin,
      body: { decision: 'request_changes', comments: 'Please add the laptop requirements.' },
    });
    assert.equal(changes.json.status, 'changes_requested');
    const [note] = await notificationsOf('usr-rahul');
    assert.equal(note.title, 'Changes requested: Git & GitHub Bootcamp');
    assert.equal(note.body, 'Please add the laptop requirements.');

    const edited = await ctx.request('PUT', '/admin/events/e6', { cookie: rahul, body: { ...body, requirements: ['Laptop with Git installed', 'GitHub account'] } });
    assert.equal(edited.status, 200);
    assert.equal((await ctx.request('POST', '/admin/events/e6/submit', { cookie: rahul })).status, 200);
    assert.equal((await ctx.request('POST', '/admin/events/e6/review', { cookie: admin, body: { decision: 'approve' } })).json.status, 'published');

    const detail = await ctx.request('GET', '/admin/events/e6', { cookie: rahul });
    assert.equal(detail.json.event.status, 'published');
    assert.deepEqual(
      detail.json.reviews.map((r: { action: string }) => r.action),
      ['submitted', 'changes_requested', 'submitted', 'approved']
    );
    assert.equal((await notificationsOf('usr-rahul'))[0].title, 'Approved: Git & GitHub Bootcamp');
  });

  it('rejects with a reason, after which the event is closed to edits', async () => {
    const admin = await ctx.login('usr-admin');
    const res = await ctx.request('POST', '/admin/events/e7/review', { cookie: admin, body: { decision: 'reject', comments: 'Clashes with mid-semester exams.' } });
    assert.equal(res.json.status, 'rejected');
    assert.equal((await notificationsOf('usr-anita'))[0].title, 'Not approved: Cloud Computing Fundamentals');
    const resubmit = await ctx.request('POST', '/admin/events/e7/submit', { cookie: await ctx.login('usr-anita') });
    assert.equal(resubmit.json.error.code, 'not_submittable');
  });

  it('only lets admins review', async () => {
    const res = await ctx.request('POST', '/admin/events/e7/review', { cookie: await ctx.login('usr-anita'), body: { decision: 'approve' } });
    assert.equal(res.status, 403);
    assert.equal((await ctx.request('GET', '/admin/approvals', { cookie: await ctx.login('usr-rahul') })).status, 403);
  });
});

describe('venue clashes (§8.3 #7)', () => {
  const overlappingHackathon = { venueId: 'ven-innovation-lab', startsAt: '2026-10-05T10:00:00.000Z', endsAt: '2026-10-05T12:00:00.000Z', registrationClosesAt: '2026-10-04T00:00:00.000Z' };

  it('blocks publishing into a booked venue unless an admin overrides, and logs the override', async () => {
    const admin = await ctx.login('usr-admin');
    const created = await ctx.request('POST', '/admin/events', { cookie: admin, body: eventBody(overlappingHackathon) });
    const id = created.json.event.id;

    const blocked = await ctx.request('POST', `/admin/events/${id}/publish`, { cookie: admin });
    assert.equal(blocked.json.error.code, 'venue_clash');
    assert.match(blocked.json.error.message, /Hackathon Bhubaneswar/);

    // The approval queue shows the clash to the reviewer.
    const rahul = await ctx.login('usr-rahul');
    await ctx.request('POST', `/admin/events/${id}/submit`, { cookie: rahul });
    const queue = await ctx.request('GET', '/admin/approvals', { cookie: admin });
    assert.equal(queue.json.pending.find((e: { id: string }) => e.id === id).clashes[0].id, 'e5');

    const ok = await ctx.request('POST', `/admin/events/${id}/review`, { cookie: admin, body: { decision: 'approve', overrideClash: true } });
    assert.equal(ok.status, 200);
    const logged = await ctx.db.selectFrom('audit_log').select('action').where('entity_id', '=', id).execute();
    assert.ok(logged.some(l => l.action === 'event.venue_clash_override'));
  });

  it("stops organizers moving a published event into a clash, and online events never clash", async () => {
    const rahul = await ctx.login('usr-rahul');
    const current = (await ctx.request('GET', '/admin/events/e1', { cookie: rahul })).json.event;
    const moved = eventBody({
      title: current.title,
      description: current.description,
      ...overlappingHackathon,
      registrationOpensAt: current.registrationOpensAt,
      capacity: current.capacity,
      changeReason: 'Moving earlier',
      overrideClash: true, // ignored for organizers
    });
    assert.equal((await ctx.request('PUT', '/admin/events/e1', { cookie: rahul, body: moved })).json.error.code, 'venue_clash');

    const admin = await ctx.login('usr-admin');
    const online = await createPublishedEvent(ctx, admin, { ...overlappingHackathon, mode: 'online', venueId: null, onlineUrl: 'https://meet.example/x' });
    assert.ok(online);
  });
});

describe('QR check-in (§5, §8.3 #6)', () => {
  it('checks in a valid pass once, and says so on a repeat scan', async () => {
    const rahul = await ctx.login('usr-rahul');
    const token = await passFor('usr-priya', 'e8');

    const first = await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token, device: 'Door 1' } });
    assert.equal(first.json.result, 'checked_in');
    assert.equal(first.json.student.name, 'Priya Das');
    assert.equal(first.json.stats.checkedIn, 1);
    assert.equal(first.json.stats.expected, 27);

    const again = await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token } });
    assert.equal(again.json.result, 'already_checked_in');
    assert.equal(again.json.checkedInAt, first.json.checkedInAt);

    // The student sees it on their pass and can no longer cancel.
    const priya = await ctx.login('usr-priya');
    const reg = await registrationOf('usr-priya', 'e8');
    const detail = await ctx.request('GET', `/me/registrations/${reg.id}`, { cookie: priya });
    assert.equal(detail.json.registration.status, 'checked_in');
    assert.equal(detail.json.registration.checkedInAt, first.json.checkedInAt);
    assert.equal((await ctx.request('POST', `/me/registrations/${reg.id}/cancel`, { cookie: priya })).json.error.code, 'already_checked_in');
  });

  it('rejects forged, foreign, cancelled and out-of-window passes', async () => {
    const rahul = await ctx.login('usr-rahul');
    const priya = await ctx.login('usr-priya');

    const forged = (await passFor('usr-rohan', 'e8')).slice(0, -3) + 'abc';
    assert.equal((await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: forged } })).json.result, 'not_found');

    const techfest = await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const e1Token = createPassToken(techfest.json.registration.id, 'e1', ctx.config.passSecret);
    assert.equal((await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: e1Token } })).json.result, 'wrong_event');
    // TechFest is weeks away: the door isn't open yet.
    assert.equal((await ctx.request('POST', '/check-in/events/e1/scans', { cookie: rahul, body: { token: e1Token } })).json.result, 'too_early');

    const rohanReg = await registrationOf('usr-rohan', 'e8');
    await ctx.request('POST', `/me/registrations/${rohanReg.id}/cancel`, { cookie: await ctx.login('usr-rohan') });
    const cancelled = await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: await passFor('usr-rohan', 'e8') } });
    assert.equal(cancelled.json.result, 'cancelled');
  });

  it('supports manual check-in by registration, and is limited to the organizing staff', async () => {
    const reg = await registrationOf('usr-rohan', 'e8');
    const anita = await ctx.login('usr-anita');
    assert.equal((await ctx.request('POST', '/check-in/events/e8/scans', { cookie: anita, body: { registrationId: reg.id } })).status, 403);
    assert.equal((await ctx.request('POST', '/check-in/events/e8/scans', { cookie: await ctx.login('usr-priya'), body: { registrationId: reg.id } })).status, 403);

    const res = await ctx.request('POST', '/check-in/events/e8/scans', { cookie: await ctx.login('usr-admin'), body: { registrationId: reg.id } });
    assert.equal(res.json.result, 'checked_in');
    const row = await ctx.db.selectFrom('check_ins').selectAll().where('registration_id', '=', reg.id).executeTakeFirstOrThrow();
    assert.equal(row.method, 'manual');
  });

  it('syncs an offline queue using the time of each scan', async () => {
    const priyaToken = await passFor('usr-priya', 'e8');
    const rohanToken = await passFor('usr-rohan', 'e8');
    const scannedAt = at(1.5).toISOString(); // during the event
    const beforeDoorsOpen = at(-3).toISOString(); // doors open 2 h before the 1 h start

    // The device comes back online after the event has ended.
    ctx.clock.now = at(6);
    const res = await ctx.request('POST', '/check-in/events/e8/scans/batch', {
      cookie: await ctx.login('usr-rahul'),
      body: {
        items: [
          { clientId: 'a', token: priyaToken, scannedAt },
          { clientId: 'b', token: priyaToken, scannedAt }, // same pass scanned twice while offline
          { clientId: 'c', token: rohanToken, scannedAt: beforeDoorsOpen },
          { clientId: 'd', token: rohanToken, scannedAt: at(1).toISOString() }, // "in the future"
        ],
      },
    });
    assert.deepEqual(
      res.json.results.map((r: { clientId: string; result: string }) => [r.clientId, r.result]),
      [['a', 'checked_in'], ['b', 'already_checked_in'], ['c', 'too_early'], ['d', 'error']]
    );
    // Synced after the end, so it counts straight away as attendance.
    assert.equal((await registrationOf('usr-priya', 'e8')).status, 'attended');
  });
});

describe('end of event: attendance and feedback (§7.1, §8.3 #4)', () => {
  it('marks attendance, lets only attendees rate, and asks them the next morning', async () => {
    // An hour before the start, the reminder says "today", not "tomorrow".
    await ctx.runScheduler();
    assert.equal((await notificationsOf('usr-rohan'))[0].title, 'Tech Talk: Building for the Web is today');

    const rahul = await ctx.login('usr-rahul');
    await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: await passFor('usr-priya', 'e8') } });

    ctx.clock.now = at(5); // the talk has ended
    const tick = await ctx.runScheduler();
    assert.equal(tick.finalized, 1);
    assert.equal((await registrationOf('usr-priya', 'e8')).status, 'attended');
    assert.equal((await registrationOf('usr-rohan', 'e8')).status, 'no_show');

    const rohan = await ctx.login('usr-rohan');
    const rohanReg = await registrationOf('usr-rohan', 'e8');
    const denied = await ctx.request('POST', `/me/registrations/${rohanReg.id}/feedback`, { cookie: rohan, body: { rating: 3, comment: 'n/a' } });
    assert.equal(denied.json.error.code, 'not_attended');

    // Next morning 09:00 IST: attendees who haven't rated get a nudge, once.
    ctx.clock.now = new Date('2026-09-24T04:00:00.000Z');
    assert.equal((await ctx.runScheduler()).feedbackRequests, 1);
    assert.equal((await ctx.runScheduler()).feedbackRequests, 0);
    assert.equal((await notificationsOf('usr-priya'))[0].title, 'How was Tech Talk: Building for the Web?');

    const priyaReg = await registrationOf('usr-priya', 'e8');
    const ok = await ctx.request('POST', `/me/registrations/${priyaReg.id}/feedback`, { cookie: await ctx.login('usr-priya'), body: { rating: 5, comment: 'Loved it' } });
    assert.equal(ok.status, 201);

    const overview = await ctx.request('GET', '/admin/events/e8/overview', { cookie: await ctx.login('usr-rahul') });
    assert.equal(overview.json.checkedIn, 1);
    assert.equal(overview.json.noShow, 26);
    assert.equal(overview.json.averageRating, 5);
  });
});

describe('scheduled reminders and email (§7.2)', () => {
  it('sends the 7-day and 1-day reminders once each, and again after a reschedule', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    await ctx.runScheduler(); // delivers the registration email
    assert.ok(ctx.emails.some(e => e.to === 'priya.d@cutm.ac.in' && /Registration confirmed/.test(e.subject)));

    ctx.clock.now = new Date('2026-10-09T04:00:00.000Z'); // 6 days before TechFest
    await ctx.runScheduler();
    await ctx.runScheduler();
    const weekNotes = (await notificationsOf('usr-priya')).filter(n => n.title === 'Coming up: CUTM TechFest 2026');
    assert.equal(weekNotes.length, 1);

    ctx.clock.now = new Date('2026-10-14T06:00:00.000Z'); // the day before
    await ctx.runScheduler();
    const [tomorrow] = await notificationsOf('usr-priya');
    assert.equal(tomorrow.title, 'CUTM TechFest 2026 is tomorrow');
    assert.match(tomorrow.body, /Bring: College ID Card/);
    assert.ok(ctx.emails.some(e => e.subject === 'CUTM TechFest 2026 is tomorrow'), 'the 1-day reminder is also emailed');

    // Postponed by two days: a fresh 1-day reminder goes out for the new time.
    const rahul = await ctx.login('usr-rahul');
    const current = (await ctx.request('GET', '/admin/events/e1', { cookie: rahul })).json.event;
    const put = await ctx.request('PUT', '/admin/events/e1', {
      cookie: rahul,
      body: eventBody({
        title: current.title,
        description: current.description,
        venueId: current.venue.id,
        capacity: current.capacity,
        startsAt: '2026-10-17T03:30:00.000Z',
        endsAt: '2026-10-17T11:30:00.000Z',
        registrationOpensAt: current.registrationOpensAt,
        registrationClosesAt: current.registrationClosesAt,
        changeReason: 'Chief guest rescheduled',
      }),
    });
    assert.equal(put.status, 200);
    ctx.clock.now = new Date('2026-10-16T06:00:00.000Z');
    await ctx.runScheduler();
    const reminders = (await notificationsOf('usr-priya')).filter(n => n.title === 'CUTM TechFest 2026 is tomorrow');
    assert.equal(reminders.length, 2);
  });

  it("doesn't remind students who cancelled", async () => {
    const priya = await ctx.login('usr-priya');
    const reg = await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    await ctx.request('POST', `/me/registrations/${reg.json.registration.id}/cancel`, { cookie: priya });
    ctx.clock.now = new Date('2026-10-14T06:00:00.000Z');
    await ctx.runScheduler();
    assert.ok(!(await notificationsOf('usr-priya')).some(n => /tomorrow/.test(n.title)));
  });

  it('reminds students who saved an event that registration closes tomorrow', async () => {
    const aarav = await ctx.login('usr-aarav');
    await ctx.request('PUT', '/me/saved/e5', { cookie: aarav });
    ctx.clock.now = new Date('2026-10-01T06:00:00.000Z'); // closes 1 Oct 23:59 IST
    const tick = await ctx.runScheduler();
    assert.equal(tick.closing, 1);
    assert.equal((await notificationsOf('usr-aarav'))[0].title, 'Registration for Hackathon Bhubaneswar closes soon');
  });

  it('keeps failed emails queued for retry, and shows the log to admins only', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const failingMailer = async () => {
      throw new Error('SMTP down');
    };
    await deliverOutbox({ db: ctx.db, now: () => ctx.clock.now, senders: { email: failingMailer } });

    const admin = await ctx.login('usr-admin');
    const log = await ctx.request('GET', '/admin/outbox', { cookie: admin });
    assert.equal(log.json.emails[0].status, 'pending');
    assert.equal(log.json.emails[0].attempts, 1);
    assert.equal(log.json.emails[0].lastError, 'SMTP down');
    assert.equal((await ctx.request('GET', '/admin/outbox', { cookie: await ctx.login('usr-rahul') })).status, 403);

    await ctx.runScheduler();
    assert.equal((await ctx.request('GET', '/admin/outbox', { cookie: admin })).json.emails[0].status, 'sent');
  });
});

describe('announcements (§5 Communication)', () => {
  it('reaches exactly the chosen audience and is logged', async () => {
    const rahul = await ctx.login('usr-rahul');
    await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: await passFor('usr-priya', 'e8') } });

    const res = await ctx.request('POST', '/admin/events/e8/announcements', {
      cookie: rahul,
      body: { audience: 'not_checked_in', title: 'Doors close in 15 minutes', body: 'Please make your way to the Auditorium.' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.announcement.recipientCount, 26);

    assert.equal((await notificationsOf('usr-rohan'))[0].title, 'Tech Talk: Building for the Web: Doors close in 15 minutes');
    assert.ok(!(await notificationsOf('usr-priya')).some(n => /Doors close/.test(n.title)));

    const list = await ctx.request('GET', '/admin/events/e8/announcements', { cookie: rahul });
    assert.equal(list.json.announcements[0].authorName, 'Rahul Sharma');
    assert.equal((await ctx.request('POST', '/admin/events/e6/announcements', { cookie: rahul, body: { audience: 'all', title: 'Hello', body: 'Draft event' } })).json.error.code, 'not_published');
  });
});

describe('manual participant management (§5 Participants)', () => {
  it('adds a student by roll number with a reason, bypassing the window but not the rules on duplicates', async () => {
    ctx.clock.now = at(0.75); // registration for e8 has closed
    const cookie = await ctx.login('usr-rahul');
    const added = await ctx.request('POST', '/admin/events/e8/registrations', { cookie, body: { universityId: '210101120001', reason: 'Volunteer on the AV desk' } });
    assert.equal(added.status, 201);
    assert.equal(added.json.registration.name, 'Aarav Kumar');
    assert.equal((await registrationOf('usr-aarav', 'e8')).source, 'organizer');
    assert.match((await notificationsOf('usr-aarav'))[0].title, /^Registration confirmed/);

    const dup = await ctx.request('POST', '/admin/events/e8/registrations', { cookie, body: { universityId: '210101120001', reason: 'Again' } });
    assert.equal(dup.json.error.code, 'already_registered');
    const unknown = await ctx.request('POST', '/admin/events/e8/registrations', { cookie, body: { universityId: 'NOPE-1', reason: 'Typo' } });
    assert.equal(unknown.status, 404);
  });

  it('removes a registration with a reason the student sees, but not after check-in', async () => {
    const rahul = await ctx.login('usr-rahul');
    const rohanReg = await registrationOf('usr-rohan', 'e8');
    const res = await ctx.request('POST', `/admin/events/e8/registrations/${rohanReg.id}/cancel`, { cookie: rahul, body: { reason: 'Duplicate account' } });
    assert.equal(res.status, 200);
    assert.match((await notificationsOf('usr-rohan'))[0].body, /Duplicate account/);

    await ctx.request('POST', '/check-in/events/e8/scans', { cookie: rahul, body: { token: await passFor('usr-priya', 'e8') } });
    const priyaReg = await registrationOf('usr-priya', 'e8');
    const blocked = await ctx.request('POST', `/admin/events/e8/registrations/${priyaReg.id}/cancel`, { cookie: rahul, body: { reason: 'Test' } });
    assert.equal(blocked.json.error.code, 'already_checked_in');
  });
});

describe('cancellation requests (§5)', () => {
  it('lets an admin decline an organizer’s request, and organizers cancel empty events directly', async () => {
    const rahul = await ctx.login('usr-rahul');
    await ctx.request('POST', '/admin/events/e1/cancel', { cookie: rahul, body: { reason: 'Budget cut' } });
    const admin = await ctx.login('usr-admin');
    assert.equal((await ctx.request('POST', '/admin/events/e1/cancel-request/decline', { cookie: admin, body: { comments: 'Funding approved' } })).status, 200);
    assert.equal((await notificationsOf('usr-rahul'))[0].title, 'Cancellation declined: CUTM TechFest 2026');
    assert.equal((await ctx.request('GET', '/admin/approvals', { cookie: admin })).json.cancelRequests.length, 0);

    // The draft has no registrations, so its organizer can withdraw it.
    const draft = await ctx.request('POST', '/admin/events/e6/cancel', { cookie: rahul, body: { reason: 'Not running this term' } });
    assert.equal(draft.json.status, 'cancelled');
  });
});
