/**
 * Date/time formatting. The API sends UTC timestamps; CUTM events are shown
 * in India Standard Time regardless of the viewer's device timezone.
 */

export const EVENT_TIME_ZONE = 'Asia/Kolkata';

const dateFmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: EVENT_TIME_ZONE, ...options });

const longDate = dateFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = dateFmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeOnly = dateFmt({ hour: '2-digit', minute: '2-digit', hour12: true });
const dayKeyFmt = dateFmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTime = dateFmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

export const formatLongDate = (iso: string) => longDate.format(new Date(iso));
export const formatShortDate = (iso: string) => shortDate.format(new Date(iso));
export const formatTime = (iso: string) => timeOnly.format(new Date(iso)).toUpperCase();
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso)).replace(/am|pm/, m => m.toUpperCase());

/** "YYYY-MM-DD" of the instant in IST — used to place events on calendar days. */
export const istDayKey = (iso: string | Date) => {
  const parts = dayKeyFmt.formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/** "09:00 AM – 05:00 PM", or with "(next day)" for events that run past midnight. */
export const formatTimeRange = (startIso: string, endIso: string) => {
  const sameDay = istDayKey(startIso) === istDayKey(endIso);
  return `${formatTime(startIso)} – ${formatTime(endIso)}${sameDay ? '' : ` (${formatShortDate(endIso)})`}`;
};

export const venueLabel = (event: { venue: { name: string } | null; mode: string }) =>
  event.venue?.name ?? (event.mode === 'online' ? 'Online' : 'Venue not specified');

/** Shown when the source (or the organizer) didn't give the organizer. */
export const organizerName = (event: { organization: { name: string } | null }) => event.organization?.name ?? 'Organizer not specified';

/** "09:00 AM – 05:00 PM", or "Time to be announced" when only the date is known. */
export const eventTimeLabel = (event: { startsAt: string; endsAt: string; timeTbd: boolean }) =>
  event.timeTbd ? 'Time to be announced' : formatTimeRange(event.startsAt, event.endsAt);

const dayMonthYear = dateFmt({ day: 'numeric', month: 'short', year: 'numeric' });

/** "Thu, 15 Oct 2026", or a compact span for multi-day events: "16–17 Sept 2026", "30 Sept – 2 Oct 2026". */
export const eventDateLabel = (event: { startsAt: string; endsAt: string }) => {
  if (istDayKey(event.startsAt) === istDayKey(event.endsAt)) return formatShortDate(event.startsAt);
  const part = (iso: string) => {
    const parts = dayMonthYear.formatToParts(new Date(iso));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return { day: get('day'), month: get('month'), year: get('year') };
  };
  const a = part(event.startsAt), b = part(event.endsAt);
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day}–${b.day} ${b.month} ${b.year}`;
};

export const initials = (name: string) =>
  name
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');

/** Converts an ISO UTC timestamp to the value a <input type="datetime-local"> expects, in IST. */
export const isoToIstInput = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
};

/** Converts a datetime-local value (entered in IST) back to an ISO UTC timestamp. */
export const istInputToIso = (value: string) => new Date(`${value}:00+05:30`).toISOString();
