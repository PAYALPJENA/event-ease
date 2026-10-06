import QRCode from 'qrcode';
import type { EventType } from '../types/event';
import { formatLongDate, formatTimeRange, venueLabel } from './format';

/**
 * Client-side helpers for the secondary event actions (Add to Calendar,
 * Share, Download Pass).
 */

// ---------- Add to Calendar (.ics) ----------

// "2026-10-15T03:30:00.000Z" → "20261015T033000Z"
const toIcsUtc = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 text escaping for SUMMARY / LOCATION / DESCRIPTION values.
const escapeIcsText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export const buildIcsFile = (event: EventType, eventUrl: string): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventEase//CUTM Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@eventease.cutm`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(new Date(event.startsAt).toISOString())}`,
    `DTEND:${toIcsUtc(new Date(event.endsAt).toISOString())}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(venueLabel(event))}`,
    `DESCRIPTION:${escapeIcsText(`${event.description}\n\nOrganized by ${event.organization?.name ?? 'an organizer not specified'}.\n${eventUrl}`)}`,
    `URL:${eventUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
};

// ---------- File download ----------

const toFileSlug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';

export const downloadFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadIcs = (event: EventType, eventUrl: string) => {
  downloadFile(`${toFileSlug(event.title)}.ics`, buildIcsFile(event, eventUrl), 'text/calendar;charset=utf-8');
};

// ---------- Share ----------

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Uses the Web Share API where available, otherwise copies the link to the clipboard. */
export const shareEvent = async (event: EventType, eventUrl: string): Promise<ShareOutcome> => {
  const shareData = {
    title: event.title,
    text: `${event.title} — ${venueLabel(event)}. Check it out on EventEase:`,
    url: eventUrl,
  };

  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other share failure falls through to the clipboard fallback.
    }
  }

  try {
    await navigator.clipboard.writeText(eventUrl);
    return 'copied';
  } catch {
    return 'failed';
  }
};

// ---------- Digital pass ----------

/** SVG markup of the pass QR code. The token is signed by the server (blueprint §4.9). */
export const passQrSvg = (passToken: string) =>
  QRCode.toString(passToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 192 });

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface PassDetails {
  event: EventType;
  registrationCode: string;
  passToken: string;
  studentName: string;
  universityId: string;
}

/** Self-contained, printable HTML pass with the signed QR code, for saving offline. */
export const buildPassHtml = async ({ event, registrationCode, passToken, studentName, universityId }: PassDetails) => {
  const qr = await passQrSvg(passToken);
  const e = {
    title: escapeHtml(event.title),
    student: escapeHtml(studentName),
    universityId: escapeHtml(universityId),
    date: escapeHtml(formatLongDate(event.startsAt)),
    time: escapeHtml(formatTimeRange(event.startsAt, event.endsAt)),
    venue: escapeHtml(venueLabel(event)),
    organizer: escapeHtml(event.organization?.name ?? 'Organizer not specified'),
    code: escapeHtml(registrationCode),
    bring: event.requirements.length ? escapeHtml(event.requirements.join(', ')) : '',
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Event Pass — ${e.title}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 32px 16px; }
  .pass { max-width: 420px; margin: 0 auto; background: #fff; border: 1px solid #e0e7ff; border-radius: 16px; overflow: hidden; }
  .head { background: #4f46e5; color: #fff; padding: 20px 24px; }
  .head p { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .9; }
  .head h1 { margin: 6px 0 0; font-size: 22px; }
  .body { padding: 20px 24px; }
  .who { margin: 0 0 16px; }
  .who strong { display: block; font-size: 18px; }
  .who span { color: #4b5563; font-size: 14px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; }
  dt { color: #4b5563; font-weight: 500; }
  dd { margin: 0; font-weight: 600; }
  .qr { margin: 20px auto 8px; width: 192px; }
  .qr svg { display: block; width: 192px; height: 192px; }
  .code { text-align: center; font-family: ui-monospace, monospace; font-size: 20px; font-weight: 700; letter-spacing: .05em; }
  .note { margin-top: 16px; font-size: 12px; color: #4b5563; text-align: center; }
  @media print { body { background: #fff; padding: 0; } .pass { border-color: #9ca3af; } }
</style>
</head>
<body>
  <main class="pass">
    <div class="head"><p>EventEase · Event Pass</p><h1>${e.title}</h1></div>
    <div class="body">
      <p class="who"><strong>${e.student}</strong><span>${e.universityId}</span></p>
      <dl>
        <dt>Date</dt><dd>${e.date}</dd>
        <dt>Time</dt><dd>${e.time}</dd>
        <dt>Venue</dt><dd>${e.venue}</dd>
        <dt>Organizer</dt><dd>${e.organizer}</dd>
        ${e.bring ? `<dt>Bring</dt><dd>${e.bring}</dd>` : ''}
      </dl>
      <div class="qr">${qr}</div>
      <p class="code">${e.code}</p>
      <p class="note">Show this QR code at the venue. It is checked live against your registration, so a cancelled registration will not be accepted.</p>
    </div>
  </main>
</body>
</html>
`;
};

export const downloadPass = async (details: PassDetails) => {
  downloadFile(
    `eventease-pass-${toFileSlug(details.event.title)}-${toFileSlug(details.registrationCode)}.html`,
    await buildPassHtml(details),
    'text/html;charset=utf-8'
  );
};
