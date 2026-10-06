import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import type { User } from '../db/types.ts';
import { ApiError } from '../http.ts';
import { newId } from '../lib/ids.ts';
import { announceStatus, requiredDocuments } from './lifecycle.ts';
import type { External } from './notifications.ts';
import { audit, notifyUsers } from './notifications.ts';

/**
 * Required documents (blueprint §3.3 Document, §4.5 step 4, §9.3).
 *
 *   required → submitted → approved | rejected (with reason) → resubmitted
 *
 * A registration stays `pending_documents` (holding its seat) until every
 * required document's latest upload is approved; then it is confirmed.
 *
 * Uploads are limited by type (checked against the file's own bytes, not the
 * name the browser sends) and size. Files are stored under random names
 * outside the web root and only served to the student and the organizers.
 * A malware scanner (e.g. ClamAV) would run in `storeUpload` before the file
 * is accepted; none is wired in development.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: 'application/pdf', ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
];

const sniff = (bytes: Buffer) => SIGNATURES.find(s => s.magic.every((b, i) => bytes[i] === b)) ?? null;

export interface UploadInput {
  requirementId: string;
  fileName: string;
  dataBase64: string;
}

export const uploadDocument = async (db: DB, user: User, registrationId: string, input: UploadInput, uploadsDir: string, now: Date) => {
  const reg = await db.selectFrom('registrations').selectAll().where('id', '=', registrationId).executeTakeFirst();
  if (!reg || reg.user_id !== user.id) throw new ApiError(404, 'registration_not_found', 'Registration not found.');
  if (reg.status !== 'pending_documents') throw new ApiError(409, 'documents_not_needed', 'This registration isn’t waiting for documents.');
  const event = await db.selectFrom('events').selectAll().where('id', '=', reg.event_id).executeTakeFirstOrThrow();
  const requirement = requiredDocuments(event).find(r => r.id === input.requirementId);
  if (!requirement) throw new ApiError(400, 'unknown_requirement', 'This event doesn’t ask for that document.');

  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0) throw new ApiError(400, 'empty_file', 'The file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ApiError(413, 'file_too_large', 'Files can be at most 2 MB.');
  const type = sniff(bytes);
  if (!type) throw new ApiError(415, 'unsupported_file', 'Upload a PDF, PNG or JPEG file.');

  await fs.mkdir(uploadsDir, { recursive: true });
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
  await fs.writeFile(path.join(uploadsDir, storedName), bytes, { flag: 'wx' });

  const id = newId();
  const nowIso = now.toISOString();
  await db
    .insertInto('registration_documents')
    .values({
      id,
      registration_id: reg.id,
      requirement_id: requirement.id,
      stored_name: storedName,
      original_name: input.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `document.${type.ext}`,
      mime_type: type.mime,
      size_bytes: bytes.length,
      status: 'submitted',
      rejection_reason: null,
      submitted_at: nowIso,
      reviewed_by: null,
      reviewed_at: null,
    })
    .execute();
  await audit(db, { actorId: user.id, action: 'document.upload', entityType: 'registration', entityId: reg.id, data: { documentId: id, requirement: requirement.id } }, nowIso);
  return { id, status: 'submitted' as const };
};

/** The newest upload for each requirement: the one that counts. */
export const documentsForRegistrations = async (db: DB, registrationIds: string[]) => {
  if (registrationIds.length === 0) return new Map<string, DocumentDto[]>();
  const rows = await db
    .selectFrom('registration_documents')
    .select(['id', 'registration_id', 'requirement_id', 'original_name', 'mime_type', 'size_bytes', 'status', 'rejection_reason', 'submitted_at'])
    .where('registration_id', 'in', registrationIds)
    .orderBy('submitted_at', 'desc')
    .execute();
  const byReg = new Map<string, DocumentDto[]>();
  for (const r of rows) {
    const list = byReg.get(r.registration_id) ?? [];
    if (list.some(d => d.requirementId === r.requirement_id)) continue;
    list.push({
      id: r.id,
      requirementId: r.requirement_id,
      fileName: r.original_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      status: r.status,
      rejectionReason: r.rejection_reason,
      submittedAt: r.submitted_at,
    });
    byReg.set(r.registration_id, list);
  }
  return byReg;
};

export interface DocumentDto {
  id: string;
  requirementId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'submitted' | 'approved' | 'rejected';
  rejectionReason: string | null;
  submittedAt: string;
}

/** Organizer approves or rejects an upload. When every document is approved, the registration is confirmed. */
export const reviewDocument = async (
  db: DB,
  staff: User,
  documentId: string,
  decision: { approve: true } | { approve: false; reason: string },
  now: Date,
  ext: External
) => {
  const nowIso = now.toISOString();
  return db.transaction().execute(async trx => {
    const doc = await trx.selectFrom('registration_documents').selectAll().where('id', '=', documentId).executeTakeFirst();
    if (!doc) throw new ApiError(404, 'document_not_found', 'Document not found.');
    const reg = await trx.selectFrom('registrations').selectAll().where('id', '=', doc.registration_id).executeTakeFirstOrThrow();
    const event = await trx.selectFrom('events').selectAll().where('id', '=', reg.event_id).executeTakeFirstOrThrow();

    await trx
      .updateTable('registration_documents')
      .set({ status: decision.approve ? 'approved' : 'rejected', rejection_reason: decision.approve ? null : decision.reason, reviewed_by: staff.id, reviewed_at: nowIso })
      .where('id', '=', doc.id)
      .execute();
    await audit(trx, { actorId: staff.id, action: decision.approve ? 'document.approve' : 'document.reject', entityType: 'registration', entityId: reg.id, data: { documentId: doc.id } }, nowIso);

    if (!decision.approve) {
      const label = requiredDocuments(event).find(r => r.id === doc.requirement_id)?.label ?? 'A document';
      await notifyUsers(
        trx,
        [reg.user_id],
        { category: 'registrations', title: `Document needs another upload: ${event.title}`, body: `${label} was not accepted: ${decision.reason}`, link: `/register-success/${event.id}` },
        nowIso,
        { external: ext }
      );
      return { registrationStatus: reg.status };
    }

    if (reg.status !== 'pending_documents') return { registrationStatus: reg.status };
    const latest = (await trx
      .selectFrom('registration_documents')
      .select(['requirement_id', 'status', 'submitted_at'])
      .where('registration_id', '=', reg.id)
      .orderBy('submitted_at', 'desc')
      .execute());
    const allApproved = requiredDocuments(event).every(r => latest.find(d => d.requirement_id === r.id)?.status === 'approved');
    if (!allApproved) return { registrationStatus: reg.status };

    await trx.updateTable('registrations').set({ status: 'confirmed' }).where('id', '=', reg.id).execute();
    await announceStatus(trx, event, { ...reg, status: 'confirmed' }, ext, nowIso);
    return { registrationStatus: 'confirmed' as const };
  });
};

/** Reads an uploaded file for download. Callers check who may see it. */
export const readDocumentFile = async (db: DB, documentId: string, uploadsDir: string) => {
  const doc = await db
    .selectFrom('registration_documents')
    .innerJoin('registrations', 'registrations.id', 'registration_documents.registration_id')
    .innerJoin('events', 'events.id', 'registrations.event_id')
    .select([
      'registration_documents.stored_name',
      'registration_documents.original_name',
      'registration_documents.mime_type',
      'registrations.user_id',
      'events.organization_id',
    ])
    .where('registration_documents.id', '=', documentId)
    .executeTakeFirst();
  if (!doc) throw new ApiError(404, 'document_not_found', 'Document not found.');
  const bytes = await fs.readFile(path.join(uploadsDir, path.basename(doc.stored_name)));
  return { ...doc, bytes };
};
