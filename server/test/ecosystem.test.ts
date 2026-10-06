import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createPassToken } from '../src/lib/pass.ts';
import { signWebhook } from '../src/services/payments.ts';
import { REGISTER_BODY, createTestContext } from './helpers.ts';
import type { TestContext } from './helpers.ts';

// V3 (student ecosystem), V4 (platform intelligence) and V5 (integrations).
//
// Seed facts used below (src/db/seed.ts), with "now" = 23 Sep 2026 06:00 UTC:
//   e2  AI & ML Workshop (CSE) ended 12 Sep; certificate rule "attendance"; Aarav attended, cert CERT-AARAV001
//   e5  Hackathon (Coding Club): team event, 2–4 members, teams TEAM-HACK1..5 of four; closes 1 Oct 23:59 IST
//   e8  live talk (Tech Club): starts now+1h; Priya and Rohan registered
//   e9  Startup Pitch Night (Tech Club): ₹150, needs an ID document, question "stage"; cancel cut-off 48 h
//   e10 Alumni Mentorship Circle (Coding Club): 10/10 seats (usr-gen-0001..0010), waitlist gen-0011, gen-0012
//   Aarav follows Tech Club and Coding Club; interested in Technical and Competitions

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});

const reg = (userId: string, eventId: string) =>
  ctx.db.selectFrom('registrations').selectAll().where('user_id', '=', userId).where('event_id', '=', eventId).orderBy('created_at', 'desc').executeTakeFirstOrThrow();

const notes = async (userId: string) =>
  (await ctx.request('GET', '/me/notifications', { cookie: await ctx.login(userId) })).json.notifications as { title: string; body: string }[];

/** Raw response (for non-JSON bodies such as ICS and CSV). */
const raw = async (path: string, cookie?: string) => {
  const res = await ctx.app.request(`/api${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
};

const PDF = Buffer.from('%PDF-1.4\n% test document\n').toString('base64');

// ======================= V3 =======================

describe('waitlist with offers (§3.3)', () => {
  it('joins the waitlist when full, offers freed seats in order, and lets the student accept', async () => {
    const rohan = await ctx.login('usr-rohan');
    const full = await ctx.request('POST', '/events/e10/registrations', { cookie: rohan, body: REGISTER_BODY });
    assert.equal(full.json.error.code, 'event_full');

    const joined = await ctx.request('POST', '/events/e10/registrations', { cookie: rohan, body: { ...REGISTER_BODY, waitlist: true } });
    assert.equal(joined.status, 201);
    assert.equal(joined.json.registration.status, 'waitlisted');
    const mine = (await ctx.request('GET', '/me/registrations', { cookie: rohan })).json.registrations.find((r: { eventId: string }) => r.eventId === 'e10');
    assert.equal(mine.waitlistPosition, 3);
    assert.match((await notes('usr-rohan'))[0].body, /#3 on the waitlist/);

    // Three seat-holders cancel: the seats go to the waitlist in order.
    for (const n of ['0001', '0002', '0003']) {
      const r = await reg(`usr-gen-${n}`, 'e10');
      assert.equal((await ctx.request('POST', `/me/registrations/${r.id}/cancel`, { cookie: await ctx.login(`usr-gen-${n}`) })).status, 200);
    }
    assert.equal((await reg('usr-gen-0011', 'e10')).status, 'offer_pending');
    assert.equal((await reg('usr-gen-0012', 'e10')).status, 'offer_pending');
    const offer = await reg('usr-rohan', 'e10');
    assert.equal(offer.status, 'offer_pending');
    assert.match((await notes('usr-rohan'))[0].title, /A seat opened/);
    // An offer holds the seat, so the event still counts as full.
    assert.equal((await ctx.request('GET', '/events/e10')).json.event.seatsTaken, 10);

    const accepted = await ctx.request('POST', `/me/registrations/${offer.id}/accept-offer`, { cookie: rohan });
    assert.equal(accepted.json.registration.status, 'confirmed');
    const detail = await ctx.request('GET', `/me/registrations/${offer.id}`, { cookie: rohan });
    assert.ok(detail.json.registration.passToken);
  });

  it('moves an expired offer to the next person', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e10/registrations', { cookie: priya, body: { ...REGISTER_BODY, waitlist: true } });
    for (const n of ['0001', '0002', '0003']) {
      const r = await reg(`usr-gen-${n}`, 'e10');
      await ctx.request('POST', `/me/registrations/${r.id}/cancel`, { cookie: await ctx.login(`usr-gen-${n}`) });
    }
    assert.equal((await reg('usr-priya', 'e10')).status, 'offer_pending');

    ctx.clock.now = new Date(ctx.clock.now.getTime() + 13 * 3600_000); // offers last 12 h
    const tick = await ctx.runScheduler();
    assert.equal(tick.expiredOffers, 3);
    assert.equal((await reg('usr-priya', 'e10')).status, 'waitlist_expired');
    assert.equal((await notes('usr-priya'))[0].title, 'Seat offer expired: Alumni Mentorship Circle');
    // An expired place doesn't block registering again (the partial unique index).
    const again = await ctx.request('POST', '/events/e10/registrations', { cookie: await ctx.login('usr-priya'), body: REGISTER_BODY });
    assert.equal(again.status, 201);
  });
});

describe('teams (§3.3 Team)', () => {
  it('creates a team, joins by invite code, enforces size, and locks at registration close', async () => {
    const priya = await ctx.login('usr-priya');
    const aarav = await ctx.login('usr-aarav');
    assert.equal((await ctx.request('POST', '/events/e5/registrations', { cookie: aarav, body: REGISTER_BODY })).json.error.code, 'team_required');

    const created = await ctx.request('POST', '/events/e5/registrations', { cookie: priya, body: { ...REGISTER_BODY, team: { create: { name: 'Circuit Breakers' } } } });
    assert.equal(created.status, 201);
    const detail = (await ctx.request('GET', `/me/registrations/${created.json.registration.id}`, { cookie: priya })).json.registration;
    assert.equal(detail.team.status, 'forming');
    assert.equal(detail.team.isLeader, true);

    const joined = await ctx.request('POST', '/events/e5/registrations', { cookie: await ctx.login('usr-rohan'), body: { ...REGISTER_BODY, team: { join: { code: detail.team.inviteCode.toLowerCase() } } } });
    assert.equal(joined.status, 201);
    const after = (await ctx.request('GET', `/me/registrations/${created.json.registration.id}`, { cookie: priya })).json.registration;
    assert.equal(after.team.status, 'complete');
    assert.deepEqual(after.team.members.map((m: { name: string }) => m.name), ['Priya Das', 'Rohan Mishra']);

    assert.equal((await ctx.request('POST', '/events/e5/registrations', { cookie: aarav, body: { ...REGISTER_BODY, team: { join: { code: 'TEAM-HACK1' } } } })).json.error.code, 'team_full');
    assert.equal((await ctx.request('POST', '/events/e5/registrations', { cookie: aarav, body: { ...REGISTER_BODY, team: { create: { name: 'Circuit Breakers' } } } })).json.error.code, 'team_name_taken');
    assert.equal((await ctx.request('POST', '/events/e5/registrations', { cookie: aarav, body: { ...REGISTER_BODY, team: { create: { name: 'Solo Act' } } } })).status, 201);

    ctx.clock.now = new Date('2026-10-02T00:00:00.000Z'); // registration closed on 1 Oct
    const tick = await ctx.runScheduler();
    assert.equal(tick.teamsLocked, 7);
    const teams = await ctx.db.selectFrom('teams').select(['name', 'status']).where('event_id', '=', 'e5').execute();
    assert.equal(teams.find(t => t.name === 'Circuit Breakers')?.status, 'locked');
    assert.equal(teams.find(t => t.name === 'Solo Act')?.status, 'disbanded');
    assert.equal((await reg('usr-aarav', 'e5')).status, 'cancelled');
    assert.match((await notes('usr-aarav'))[0].title, /Team not registered/);
  });
});

describe('paid registration with questions and documents (§4.5, V5 payments)', () => {
  it('runs questions → payment (webhook) → documents → confirmed, then refunds on cancel', async () => {
    const priya = await ctx.login('usr-priya');
    const noAnswer = await ctx.request('POST', '/events/e9/registrations', { cookie: priya, body: REGISTER_BODY });
    assert.equal(noAnswer.json.error.code, 'invalid_answers');
    const badChoice = await ctx.request('POST', '/events/e9/registrations', { cookie: priya, body: { ...REGISTER_BODY, answers: { stage: 'Unicorn' } } });
    assert.equal(badChoice.json.error.code, 'invalid_answers');

    const res = await ctx.request('POST', '/events/e9/registrations', { cookie: priya, body: { ...REGISTER_BODY, answers: { stage: 'Prototype', pitch: 'Campus food delivery' } } });
    assert.equal(res.status, 201);
    assert.equal(res.json.registration.status, 'pending_payment');
    assert.equal(res.json.payment.amount, 15000);
    const regId = res.json.registration.id;

    // A failed payment leaves the seat held; the student can try again.
    const failed = await ctx.request('POST', `/payments/mock-checkout/${res.json.payment.orderId}`, { cookie: priya, body: { outcome: 'failure' } });
    assert.equal(failed.json.status, 'failed');
    const retry = await ctx.request('POST', `/me/registrations/${regId}/payment`, { cookie: priya });
    const paid = await ctx.request('POST', `/payments/mock-checkout/${retry.json.payment.orderId}`, { cookie: priya, body: { outcome: 'success' } });
    assert.equal(paid.json.status, 'pending_documents');

    // A pending registration can't get in at the door.
    const rahul = await ctx.login('usr-rahul');
    assert.equal((await ctx.request('POST', '/check-in/events/e9/scans', { cookie: rahul, body: { registrationId: regId } })).json.result, 'not_confirmed');

    // Documents: type checked from the bytes; rejection explains itself; approval confirms.
    const notPdf = await ctx.request('POST', `/me/registrations/${regId}/documents`, { cookie: priya, body: { requirementId: 'id-card', fileName: 'id.pdf', dataBase64: Buffer.from('hello').toString('base64') } });
    assert.equal(notPdf.status, 415);
    assert.equal((await ctx.request('POST', `/me/registrations/${regId}/documents`, { cookie: priya, body: { requirementId: 'id-card', fileName: 'id.pdf', dataBase64: PDF } })).status, 201);

    const docId = async () =>
      (await ctx.request('GET', '/admin/events/e9/registrations', { cookie: rahul })).json.registrations.find((r: { id: string }) => r.id === regId).documents[0].id as string;
    const rejected = await ctx.request('POST', `/admin/events/e9/documents/${await docId()}/review`, { cookie: rahul, body: { approve: false, reason: 'The photo is blurry' } });
    assert.equal(rejected.json.registrationStatus, 'pending_documents');
    assert.match((await notes('usr-priya'))[0].body, /blurry/);

    await ctx.request('POST', `/me/registrations/${regId}/documents`, { cookie: priya, body: { requirementId: 'id-card', fileName: 'id-2.pdf', dataBase64: PDF } });
    const file = await raw(`/admin/events/e9/documents/${await docId()}/file`, rahul);
    assert.equal(file.type, 'application/pdf');
    const approved = await ctx.request('POST', `/admin/events/e9/documents/${await docId()}/review`, { cookie: rahul, body: { approve: true } });
    assert.equal(approved.json.registrationStatus, 'confirmed');

    const detail = (await ctx.request('GET', `/me/registrations/${regId}`, { cookie: priya })).json.registration;
    assert.ok(detail.passToken);
    assert.equal(detail.payment.status, 'paid');
    assert.deepEqual(detail.answers, { stage: 'Prototype', pitch: 'Campus food delivery' });

    // Cancelling before the cut-off refunds the fee.
    assert.equal((await ctx.request('POST', `/me/registrations/${regId}/cancel`, { cookie: priya })).status, 200);
    const refunded = (await ctx.request('GET', `/me/registrations/${regId}`, { cookie: priya })).json.registration;
    assert.equal(refunded.payment.status, 'refunded');
    assert.ok((await notes('usr-priya')).some(n => n.title === 'Refund issued: Startup Pitch Night'));
  });

  it('releases unpaid seats, and refunds a payment that arrives after the release', async () => {
    const rohan = await ctx.login('usr-rohan');
    const res = await ctx.request('POST', '/events/e9/registrations', { cookie: rohan, body: { ...REGISTER_BODY, answers: { stage: 'Just an idea' } } });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 60_000);
    assert.equal((await ctx.runScheduler()).releasedUnpaid, 1);
    assert.equal((await reg('usr-rohan', 'e9')).status, 'cancelled');

    const late = await ctx.request('POST', `/payments/mock-checkout/${res.json.payment.orderId}`, { cookie: await ctx.login('usr-rohan'), body: { outcome: 'success' } });
    assert.equal(late.json.status, 'refunded');
  });

  it('enforces the cancellation cut-off', async () => {
    const r = await reg('usr-gen-0001', 'e9');
    ctx.clock.now = new Date('2026-10-27T12:00:00.000Z'); // 24 h before the start; cut-off is 48 h
    const res = await ctx.request('POST', `/me/registrations/${r.id}/cancel`, { cookie: await ctx.login('usr-gen-0001') });
    assert.equal(res.json.error.code, 'cancellation_closed');
  });

  it('only accepts correctly signed gateway webhooks, and ignores repeats', async () => {
    const body = { event: 'payment.captured', orderId: 'order_seed0', paymentId: 'pay_seed0' };
    const forged = await ctx.request('POST', '/payments/webhook', { body, headers: { 'x-signature': 'nope' } });
    assert.equal(forged.status, 401);
    const signed = await ctx.request('POST', '/payments/webhook', { body, headers: { 'x-signature': signWebhook(JSON.stringify(body), ctx.config.paymentWebhookSecret) } });
    assert.deepEqual(signed.json, { applied: false, reason: 'already_processed' });

    const admin = await ctx.login('usr-admin');
    const payments = await ctx.request('GET', '/admin/payments', { cookie: admin });
    assert.equal(payments.json.totals.collected, 12 * 15000);
    assert.equal((await ctx.request('GET', '/admin/payments', { cookie: await ctx.login('usr-rahul') })).status, 403);
  });
});

describe('results and certificates (§4.13, §8.3 #5)', () => {
  it('verifies certificates publicly with minimal information, and revokes them', async () => {
    const ok = await ctx.request('GET', '/verify/cert-aarav001');
    assert.equal(ok.json.valid, true);
    assert.equal(ok.json.certificate.holderName, 'Aarav Kumar');
    assert.equal(ok.json.certificate.issuer, 'Department of Computer Science');
    assert.equal('universityId' in ok.json.certificate, false);
    assert.equal((await ctx.request('GET', '/verify/CERT-NOPE0000')).json.valid, false);

    const anita = await ctx.login('usr-anita');
    // Everyone who attended already has one: issuing again adds nothing.
    assert.equal((await ctx.request('POST', '/admin/events/e2/certificates/issue', { cookie: anita })).json.issued, 0);
    const list = (await ctx.request('GET', '/admin/events/e2/certificates', { cookie: anita })).json.certificates;
    const aaravCert = list.find((x: { code: string }) => x.code === 'CERT-AARAV001');
    await ctx.request('POST', `/admin/events/e2/certificates/${aaravCert.id}/revoke`, { cookie: anita, body: { reason: 'Issued in error' } });
    const revoked = await ctx.request('GET', '/verify/CERT-AARAV001');
    assert.deepEqual([revoked.json.valid, revoked.json.revoked], [false, true]);
    assert.equal((await ctx.request('POST', '/admin/events/e8/certificates/issue', { cookie: await ctx.login('usr-rahul') })).json.error.code, 'no_certificates');
  });

  it('publishes results to attendees and issues winner certificates when the rule says so', async () => {
    const anita = await ctx.login('usr-anita');
    const aaravReg = await reg('usr-aarav', 'e2');
    const noShow = await ctx.db.selectFrom('registrations').select('id').where('event_id', '=', 'e2').where('status', '=', 'no_show').executeTakeFirstOrThrow();
    const bad = await ctx.request('PUT', '/admin/events/e2/results', { cookie: anita, body: { results: [{ position: 1, title: 'Winner', registrationId: noShow.id }] } });
    assert.equal(bad.json.error.code, 'invalid_result');

    await ctx.db.updateTable('events').set({ certificate_rule: 'attendance_and_winners' }).where('id', '=', 'e2').execute();
    await ctx.request('PUT', '/admin/events/e2/results', { cookie: anita, body: { results: [{ position: 1, title: 'Best Project', registrationId: aaravReg.id }] } });
    const published = await ctx.request('POST', '/admin/events/e2/results/publish', { cookie: anita });
    assert.equal(published.json.notified, 41);
    assert.equal(published.json.certificatesIssued, 1);

    const page = await ctx.request('GET', '/events/e2');
    assert.deepEqual(page.json.results.map((r: { name: string; title: string }) => [r.title, r.name]), [['Best Project', 'Aarav Kumar']]);
    const mine = await ctx.request('GET', '/me/certificates', { cookie: await ctx.login('usr-aarav') });
    assert.deepEqual(mine.json.certificates.map((x: { kind: string }) => x.kind).sort(), ['participation', 'winner']);
    assert.match((await notes('usr-aarav')).map(n => n.title).join('|'), /Results are out: AI & Machine Learning Workshop/);
  });

  it('adds a recap after the event, and collects feedback on each dimension', async () => {
    const anita = await ctx.login('usr-anita');
    assert.equal((await ctx.request('PUT', '/admin/events/e2/recap', { cookie: anita, body: { recap: 'Thank you all!', gallery: ['https://example.com/a.jpg'] } })).status, 200);
    assert.equal((await ctx.request('GET', '/events/e2')).json.event.recap, 'Thank you all!');
    assert.equal((await ctx.request('PUT', '/admin/events/e1/recap', { cookie: await ctx.login('usr-rahul'), body: { recap: 'Too early', gallery: [] } })).json.error.code, 'event_not_finished');

    const aaravReg = await reg('usr-aarav', 'e2');
    const res = await ctx.request('POST', `/me/registrations/${aaravReg.id}/feedback`, {
      cookie: await ctx.login('usr-aarav'),
      body: { rating: 5, comment: 'Brilliant', content: 5, speaker: 4, venue: 3, wouldAttendAgain: true },
    });
    assert.equal(res.status, 201);
    const analytics = await ctx.request('GET', '/admin/events/e2/analytics', { cookie: anita });
    assert.equal(analytics.json.feedback.count, 21);
    assert.equal(analytics.json.funnel.attended, 41);
    assert.ok(analytics.json.feedback.dimensions.speaker >= 4);
  });
});

describe('clubs, following and opportunities (§4.11, §4.12)', () => {
  it('lists clubs, shows a club page, and tells followers about new events', async () => {
    const clubs = (await ctx.request('GET', '/clubs')).json.clubs;
    assert.equal(clubs.length, 5);
    assert.equal(clubs.find((c: { slug: string }) => c.slug === 'coding-club').followers, 1);
    const tech = (await ctx.request('GET', '/clubs/tech-club')).json;
    assert.ok(tech.events.some((e: { id: string }) => e.id === 'e9'));
    assert.deepEqual(tech.club.contacts, [{ name: 'Rahul Sharma', role: 'lead' }]);

    const priya = await ctx.login('usr-priya');
    await ctx.request('PUT', '/me/follows/org-tech-club', { cookie: priya });
    await ctx.request('POST', '/admin/events/e6/submit', { cookie: await ctx.login('usr-rahul') });
    await ctx.request('POST', '/admin/events/e6/review', { cookie: await ctx.login('usr-admin'), body: { decision: 'approve' } });
    assert.equal((await notes('usr-priya'))[0].title, 'New from CUTM Tech Club: Git & GitHub Bootcamp');
  });

  it('shows eligibility on opportunities, reminds savers of deadlines, and scopes who can post', async () => {
    const priya = await ctx.login('usr-priya');
    const list = (await ctx.request('GET', '/opportunities', { cookie: priya })).json.opportunities;
    assert.equal(list.length, 3);
    assert.equal(list.find((o: { id: string }) => o.id === 'opp-1').eligible, false);
    assert.equal(list.find((o: { id: string }) => o.id === 'opp-3').eligible, true);

    await ctx.request('PUT', '/me/saved-opportunities/opp-2', { cookie: priya });
    ctx.clock.now = new Date('2026-10-04T12:00:00.000Z'); // deadline 5 Oct 17:00 IST
    assert.equal((await ctx.runScheduler()).opportunityReminders, 1);
    assert.equal((await notes('usr-priya'))[0].title, 'Deadline tomorrow: Women in Tech Scholarship 2026');

    const rahul = await ctx.login('usr-rahul');
    const body = {
      type: 'competition', title: 'ICPC regional qualifier', provider: 'ICPC', description: 'Register your team of three for the regional round.',
      deadline: '2026-11-30T12:00:00.000Z', eligibilityText: 'All students', eligibleDepartments: null, eligibleYears: null, externalUrl: null, tags: ['Coding'],
    };
    assert.equal((await ctx.request('POST', '/admin/opportunities', { cookie: rahul, body: { ...body, organizationId: 'org-coding' } })).status, 201);
    assert.equal((await ctx.request('POST', '/admin/opportunities', { cookie: rahul, body: { ...body, organizationId: 'org-cse' } })).status, 403);
    assert.equal((await ctx.request('POST', '/admin/opportunities', { cookie: rahul, body: { ...body, organizationId: null } })).status, 403);
  });

  it('lets admins assign organizer roles in a club', async () => {
    const admin = await ctx.login('usr-admin');
    assert.equal((await ctx.request('POST', '/admin/organizations/org-sports/members', { cookie: admin, body: { universityId: '220101130045', role: 'organizer' } })).status, 201);
    const priya = await ctx.login('usr-priya');
    assert.deepEqual((await ctx.request('GET', '/auth/me', { cookie: priya })).json.user.roles, ['student', 'organizer']);
    const events = (await ctx.request('GET', '/admin/events', { cookie: priya })).json.events;
    assert.deepEqual(events.map((e: { id: string }) => e.id), ['e4']);
  });
});

describe('check-in volunteers (§2.2)', () => {
  it('can scan passes for their event and nothing else', async () => {
    const rahul = await ctx.login('usr-rahul');
    assert.equal((await ctx.request('POST', '/admin/events/e8/volunteers', { cookie: rahul, body: { universityId: '210101120001' } })).status, 201);

    const aarav = await ctx.login('usr-aarav');
    const priyaReg = await reg('usr-priya', 'e8');
    const scan = await ctx.request('POST', '/check-in/events/e8/scans', { cookie: aarav, body: { token: createPassToken(priyaReg.id, 'e8', ctx.config.passSecret) } });
    assert.equal(scan.json.result, 'checked_in');
    const roster = await ctx.request('GET', '/check-in/events/e8/roster', { cookie: aarav });
    assert.equal(roster.status, 200);
    assert.equal('email' in roster.json.roster[0], false);

    assert.equal((await ctx.request('GET', '/admin/events/e8/registrations', { cookie: aarav })).status, 403);
    assert.equal((await ctx.request('GET', '/check-in/events/e1/roster', { cookie: aarav })).status, 403);
    assert.deepEqual((await ctx.request('GET', '/me/volunteering', { cookie: aarav })).json.events.map((e: { id: string }) => e.id), ['e8']);
  });
});

// ======================= V4 =======================

describe('recommendations (§7.5)', () => {
  it('explains each suggestion, and respects the personalization switch', async () => {
    const aarav = await ctx.login('usr-aarav');
    const res = await ctx.request('GET', '/me/recommendations', { cookie: aarav });
    assert.equal(res.json.personalizationEnabled, true);
    const pitch = res.json.items.find((i: { event: { id: string } }) => i.event.id === 'e9');
    assert.ok(pitch, 'the paid pitch night matches a followed club and an interest');
    assert.ok(pitch.reasons.includes('From CUTM Tech Club, which you follow'));
    assert.ok(pitch.reasons.includes("You're interested in Competitions"));
    assert.ok(res.json.items.every((i: { event: { id: string } }) => i.event.id !== 'e2'), 'never past events');

    await ctx.request('PUT', '/me/preferences', { cookie: aarav, body: { interests: ['cat-technical'], personalizationEnabled: false } });
    const off = await ctx.request('GET', '/me/recommendations', { cookie: aarav });
    assert.deepEqual([off.json.personalizationEnabled, off.json.items.length], [false, 0]);
  });
});

describe('analytics and insights (V4)', () => {
  it('counts one view per viewer per day in the funnel', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/views', { cookie: priya });
    await ctx.request('POST', '/events/e1/views', { cookie: priya });
    await ctx.request('POST', '/events/e1/views');
    const analytics = await ctx.request('GET', '/admin/events/e1/analytics', { cookie: await ctx.login('usr-rahul') });
    assert.equal(analytics.json.funnel.views, 2);
    assert.equal(analytics.json.fillRate, 75);
  });

  it('gives admins institution-wide insights', async () => {
    const res = await ctx.request('GET', '/admin/insights?from=2026-09-01T00:00:00Z&to=2026-12-31T00:00:00Z', { cookie: await ctx.login('usr-admin') });
    assert.ok(res.json.totals.events >= 7);
    const workshop = res.json.byCategory.find((c: { name: string }) => c.name === 'Workshops');
    assert.equal(workshop.attended, 41);
    assert.ok(res.json.byCohort.some((c: { department: string; year: number }) => c.department === 'CSE' && c.year === 3));
    assert.equal((await ctx.request('GET', '/admin/insights', { cookie: await ctx.login('usr-rahul') })).status, 403);
  });
});

// ======================= V5 =======================

describe('notification channels and preferences (§4.10, §7.2)', () => {
  it('honours opt-outs but never for critical changes', async () => {
    const priya = await ctx.login('usr-priya');
    await ctx.request('PUT', '/me/notification-preferences', {
      cookie: priya,
      body: { changes: [{ category: 'registrations', channel: 'email', enabled: false }, { category: 'changes', channel: 'email', enabled: false }] },
    });
    const prefs = (await ctx.request('GET', '/me/notification-preferences', { cookie: priya })).json;
    const row = (cat: string) => prefs.categories.find((c: { category: string }) => c.category === cat);
    assert.equal(row('registrations').channels.email, false);
    assert.deepEqual([row('changes').channels.email, row('changes').critical], [true, true]);

    await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    const emails = await ctx.db.selectFrom('message_outbox').select('subject').where('to_address', '=', 'priya.d@cutm.ac.in').execute();
    assert.equal(emails.length, 0);
  });

  it('queues push for subscribed devices and delivers it', async () => {
    const priya = await ctx.login('usr-priya');
    const sub = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } };
    assert.equal((await ctx.request('POST', '/me/push-subscriptions', { cookie: priya, body: sub })).status, 201);
    await ctx.request('POST', '/events/e3/registrations', { cookie: priya, body: REGISTER_BODY });
    await ctx.runScheduler();
    const push = ctx.sent.find(m => m.channel === 'push');
    assert.ok(push);
    assert.equal(JSON.parse(push.text).url, '/register-success/e3');
    assert.equal((await ctx.request('GET', '/push/public-key')).json.publicKey.length > 40, true);
  });

  it('sends SMS for critical updates only, when the university turns SMS on', async () => {
    ctx = await createTestContext({ smsMode: 'console' });
    const priya = await ctx.login('usr-priya');
    await ctx.request('POST', '/events/e1/registrations', { cookie: priya, body: REGISTER_BODY });
    await ctx.request('POST', '/admin/events/e1/cancel', { cookie: await ctx.login('usr-admin'), body: { reason: 'Venue flooded' } });
    const sms = await ctx.db.selectFrom('message_outbox').select(['to_address', 'subject']).where('channel', '=', 'sms').execute();
    assert.deepEqual(sms, [{ to_address: '+91 98765 43210', subject: 'CUTM TechFest 2026 has been cancelled' }]);
  });
});

describe('calendar feed and exports (§4.8, §9.2, V5 records)', () => {
  it('serves a private, revocable calendar feed', async () => {
    const priya = await ctx.login('usr-priya');
    const created = await ctx.request('POST', '/me/calendar-feed', { cookie: priya });
    assert.match(created.json.webcalUrl, /^webcal:\/\/localhost:5173\/api\/calendar\/.+\.ics$/);
    const path = new URL(created.json.url).pathname.replace(/^\/api/, '');

    const feed = await raw(path);
    assert.equal(feed.status, 200);
    assert.match(feed.type ?? '', /text\/calendar/);
    assert.match(feed.text, /SUMMARY:Tech Talk: Building for the Web/);
    assert.match(feed.text, /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);

    await ctx.request('DELETE', '/me/calendar-feed', { cookie: priya });
    assert.equal((await raw(path)).status, 404);
  });

  it('exports co-curricular records for the university and a student’s own data', async () => {
    const admin = await ctx.login('usr-admin');
    const json = await ctx.request('GET', '/admin/exports/co-curricular?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z', { cookie: admin });
    const aarav = json.json.records.find((r: { universityId: string }) => r.universityId === '210101120001');
    assert.deepEqual([aarav.event, aarav.hours, aarav.certificateCode], ['AI & Machine Learning Workshop', 6, 'CERT-AARAV001']);
    const csv = await raw('/admin/exports/co-curricular?format=csv&from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z', admin);
    assert.match(csv.text.split('\r\n')[0], /"universityId","name"/);

    const mine = await ctx.request('GET', '/me/export', { cookie: await ctx.login('usr-aarav') });
    assert.equal(mine.json.profile.universityId, '210101120001');
    assert.equal(mine.json.certificates.length, 1);
    assert.equal(mine.json.followedClubs.length, 2);
  });
});

describe('CSRF for the gateway webhook', () => {
  it('accepts server-to-server posts without an Origin header', async () => {
    const body = JSON.stringify({ event: 'payment.failed', orderId: 'order_unknown', paymentId: 'x' });
    const res = await ctx.app.request('/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signWebhook(body, ctx.config.paymentWebhookSecret) },
      body,
    });
    assert.deepEqual(await res.json(), { applied: false, reason: 'unknown_order' });
  });
});
