import crypto from 'node:crypto';
import type { DB } from '../db/index.ts';
import type { EventRow, User } from '../db/types.ts';
import { ApiError } from '../http.ts';
import { newId } from '../lib/ids.ts';
import { eventPhase } from '../lib/rules.ts';
import type { External } from './notifications.ts';
import { audit, notifyUsers } from './notifications.ts';
import { isUniqueViolation } from './registrations.ts';

/**
 * Results and certificates (blueprint §3.3 Certificate, §4.13, §5, invariant §8.3 #5).
 *
 *   not_eligible → eligible (attendance / result rule met) → issued → (revoked)
 *
 * Eligibility comes from the event's certificate rule: `attendance` gives a
 * participation certificate to everyone who attended; `winners` gives one to
 * each registration named in the published results (for a team, every member
 * who attended). Issuing is idempotent — one certificate per registration and
 * kind — so organizers can run it again after late check-ins sync.
 */

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const newCertificateCode = () => `CERT-${Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('')}`;

const ATTENDED = ['attended', 'checked_in'] as const;

export interface ResultInput {
  position: number;
  title: string;
  registrationId?: string;
  teamId?: string;
}

/** Replaces the event's results (before or after publishing). */
export const saveResults = async (db: DB, staff: User, event: EventRow, results: ResultInput[], now: Date) => {
  if (eventPhase(event, now) !== 'completed') throw new ApiError(409, 'event_not_finished', 'Results can be entered once the event has ended.');
  const nowIso = now.toISOString();
  return db.transaction().execute(async trx => {
    for (const r of results) {
      if (!r.registrationId === !r.teamId) throw new ApiError(400, 'validation_failed', 'Each result names either a participant or a team.');
      if (r.registrationId) {
        const reg = await trx.selectFrom('registrations').select(['event_id', 'status']).where('id', '=', r.registrationId).executeTakeFirst();
        if (!reg || reg.event_id !== event.id || !(ATTENDED as readonly string[]).includes(reg.status)) {
          throw new ApiError(400, 'invalid_result', 'Results can only name participants who attended.');
        }
      } else {
        const team = await trx.selectFrom('teams').select(['event_id', 'status']).where('id', '=', r.teamId!).executeTakeFirst();
        if (!team || team.event_id !== event.id || team.status === 'disbanded') throw new ApiError(400, 'invalid_result', 'Unknown team for this event.');
      }
    }
    await trx.deleteFrom('results').where('event_id', '=', event.id).execute();
    if (results.length) {
      await trx
        .insertInto('results')
        .values(results.map(r => ({ id: newId(), event_id: event.id, position: r.position, title: r.title, registration_id: r.registrationId ?? null, team_id: r.teamId ?? null, created_at: nowIso })))
        .execute();
    }
    await audit(trx, { actorId: staff.id, action: 'results.save', entityType: 'event', entityId: event.id, data: { count: results.length } }, nowIso);
  });
};

/** Results as shown on the event page: position, title and who (student or team name). */
export const listResults = async (db: DB, eventId: string) => {
  const rows = await db
    .selectFrom('results')
    .leftJoin('registrations', 'registrations.id', 'results.registration_id')
    .leftJoin('users', 'users.id', 'registrations.user_id')
    .leftJoin('teams', 'teams.id', 'results.team_id')
    .select(['results.id', 'results.position', 'results.title', 'results.registration_id', 'results.team_id', 'users.name as user_name', 'teams.name as team_name'])
    .where('results.event_id', '=', eventId)
    .orderBy('results.position')
    .execute();
  return rows.map(r => ({ id: r.id, position: r.position, title: r.title, registrationId: r.registration_id, teamId: r.team_id, name: r.team_name ?? r.user_name ?? '' }));
};

/** Registrations each result covers: the named participant, or every attending member of the team. */
const winnerRegistrations = async (db: DB, eventId: string) => {
  const results = await db.selectFrom('results').selectAll().where('event_id', '=', eventId).execute();
  const out: { registrationId: string; title: string }[] = [];
  for (const r of results) {
    if (r.registration_id) out.push({ registrationId: r.registration_id, title: r.title });
    else {
      const members = await db.selectFrom('registrations').select('id').where('team_id', '=', r.team_id!).where('status', 'in', ATTENDED).execute();
      out.push(...members.map(m => ({ registrationId: m.id, title: r.title })));
    }
  }
  return out;
};

export const publishResults = async (db: DB, staff: User, event: EventRow, now: Date, ext: External) => {
  const results = await listResults(db, event.id);
  if (results.length === 0) throw new ApiError(409, 'no_results', 'Enter the results before publishing them.');
  const nowIso = now.toISOString();
  await db.updateTable('events').set({ results_published_at: nowIso }).where('id', '=', event.id).execute();

  const participants = await db.selectFrom('registrations').select('user_id').where('event_id', '=', event.id).where('status', 'in', ATTENDED).execute();
  await notifyUsers(
    db,
    participants.map(p => p.user_id),
    { category: 'results', title: `Results are out: ${event.title}`, body: `${results[0].title}: ${results[0].name}. See the full results on the event page.`, link: `/event/${event.id}` },
    nowIso,
    { external: ext }
  );
  await audit(db, { actorId: staff.id, action: 'results.publish', entityType: 'event', entityId: event.id }, nowIso);

  // Winners get their certificates with the results when the rule says so (§7.1 "Results published").
  const published = { ...event, results_published_at: nowIso };
  const issued = event.certificate_rule === 'winners' || event.certificate_rule === 'attendance_and_winners' ? await issueCertificates(db, staff, published, now, ext, ['winner']) : 0;
  return { notified: participants.length, certificatesIssued: issued };
};

/** Issues every certificate the event's rule makes due and that hasn't been issued yet. */
export const issueCertificates = async (db: DB, staff: User, event: EventRow, now: Date, ext: External, kinds: ('participation' | 'winner')[] = ['participation', 'winner']) => {
  if (event.certificate_rule === 'none') throw new ApiError(409, 'no_certificates', 'This event doesn’t issue certificates. Set a certificate rule first.');
  if (eventPhase(event, now) !== 'completed') throw new ApiError(409, 'event_not_finished', 'Certificates can be issued once the event has ended.');
  const nowIso = now.toISOString();

  const due: { registrationId: string; kind: 'participation' | 'winner'; title: string }[] = [];
  if (kinds.includes('participation') && (event.certificate_rule === 'attendance' || event.certificate_rule === 'attendance_and_winners')) {
    const attended = await db.selectFrom('registrations').select('id').where('event_id', '=', event.id).where('status', 'in', ATTENDED).execute();
    due.push(...attended.map(a => ({ registrationId: a.id, kind: 'participation' as const, title: `Certificate of Participation — ${event.title}` })));
  }
  if (kinds.includes('winner') && (event.certificate_rule === 'winners' || event.certificate_rule === 'attendance_and_winners') && event.results_published_at) {
    const winners = await winnerRegistrations(db, event.id);
    due.push(...winners.map(w => ({ registrationId: w.registrationId, kind: 'winner' as const, title: `${w.title} — ${event.title}` })));
  }

  const issuedTo: string[] = [];
  for (const d of due) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db
          .insertInto('certificates')
          .values({ id: newId(), code: newCertificateCode(), registration_id: d.registrationId, kind: d.kind, title: d.title, issued_at: nowIso, issued_by: staff.id, revoked_at: null, revoke_reason: null })
          .execute();
        const reg = await db.selectFrom('registrations').select('user_id').where('id', '=', d.registrationId).executeTakeFirstOrThrow();
        issuedTo.push(reg.user_id);
        break;
      } catch (err) {
        if (isUniqueViolation(err, 'certificates.code')) continue; // retry with a new code
        if (isUniqueViolation(err, 'certificates.registration_id')) break; // already issued
        throw err;
      }
    }
  }
  await notifyUsers(
    db,
    issuedTo,
    { category: 'certificates', title: `Your certificate is ready: ${event.title}`, body: 'Download it or share its verification link from My Certificates.', link: '/certificates' },
    nowIso,
    { external: ext }
  );
  if (issuedTo.length) await audit(db, { actorId: staff.id, action: 'certificates.issue', entityType: 'event', entityId: event.id, data: { count: issuedTo.length } }, nowIso);
  return issuedTo.length;
};

export const revokeCertificate = async (db: DB, staff: User, certificateId: string, reason: string, now: Date) => {
  const nowIso = now.toISOString();
  const result = await db
    .updateTable('certificates')
    .set({ revoked_at: nowIso, revoke_reason: reason })
    .where('id', '=', certificateId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw new ApiError(404, 'certificate_not_found', 'No active certificate with that id.');
  await audit(db, { actorId: staff.id, action: 'certificate.revoke', entityType: 'certificate', entityId: certificateId, data: { reason } }, nowIso);
};

const certificateQuery = (db: DB) =>
  db
    .selectFrom('certificates')
    .innerJoin('registrations', 'registrations.id', 'certificates.registration_id')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .innerJoin('organizations', 'organizations.id', 'events.organization_id')
    .select([
      'certificates.id',
      'certificates.code',
      'certificates.kind',
      'certificates.title',
      'certificates.issued_at',
      'certificates.revoked_at',
      'certificates.revoke_reason',
      'users.id as user_id',
      'users.name as holder_name',
      'users.university_id',
      'events.id as event_id',
      'events.title as event_title',
      'events.starts_at',
      'organizations.name as issuer',
    ]);

type CertRow = Awaited<ReturnType<ReturnType<typeof certificateQuery>['execute']>>[number];

const toCertificateDto = (r: CertRow) => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  title: r.title,
  issuedAt: r.issued_at,
  revokedAt: r.revoked_at,
  holderName: r.holder_name,
  universityId: r.university_id,
  event: { id: r.event_id, title: r.event_title, startsAt: r.starts_at },
  issuer: r.issuer,
});

export const certificatesForUser = async (db: DB, userId: string) =>
  (await certificateQuery(db).where('users.id', '=', userId).orderBy('certificates.issued_at', 'desc').execute()).map(toCertificateDto);

export const certificatesForEvent = async (db: DB, eventId: string) =>
  (await certificateQuery(db).where('events.id', '=', eventId).orderBy('certificates.issued_at').execute()).map(toCertificateDto);

/**
 * Public verification (blueprint §4.13): confirms the certificate is genuine
 * and shows the minimum needed — holder, event, issuer, date — never contact
 * details or the roll number.
 */
export const verifyCertificate = async (db: DB, code: string) => {
  const row = await certificateQuery(db).where('certificates.code', '=', code.trim().toUpperCase()).executeTakeFirst();
  if (!row) return { valid: false as const };
  return {
    valid: row.revoked_at === null,
    revoked: row.revoked_at !== null,
    revokeReason: row.revoke_reason,
    certificate: { code: row.code, kind: row.kind, title: row.title, issuedAt: row.issued_at, holderName: row.holder_name, eventTitle: row.event_title, eventDate: row.starts_at, issuer: row.issuer },
  };
};
