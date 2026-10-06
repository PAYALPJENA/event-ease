/**
 * Formatting for text the server writes (notifications, emails). CUTM events
 * are shown in India Standard Time, matching the web app (web/src/utils/format.ts).
 */

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options });

const dateFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: true });

export const formatIstDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatIstTime = (iso: string) => timeFmt.format(new Date(iso)).toUpperCase();
export const formatIstDateTime = (iso: string) => `${formatIstDate(iso)}, ${formatIstTime(iso)}`;

/** "YYYY-MM-DD" of the instant in IST. */
export const istDayKey = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** 09:00 IST on the day after `iso` (in IST), as a Date. */
export const nextIstMorning = (iso: string) => {
  const next = new Date(`${istDayKey(iso)}T09:00:00+05:30`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
};
