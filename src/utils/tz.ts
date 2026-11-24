/*
 * Company-timezone date helpers (settings.timezone, e.g. Europe/Warsaw).
 * Days and weeks are counted in the company's timezone, not the phone's.
 */

function parts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour'), mi: n('minute'), s: n('second') };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (Warsaw in winter = +60). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Midnight (company time) of the day `date` falls on, as a real instant. */
export function startOfDay(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  const guess = Date.UTC(p.y, p.m - 1, p.d);
  // two passes handle DST changes on the day itself
  let t = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - tzOffsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Calendar day key in company time, e.g. "2026-11-24". */
export function dayKey(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Add whole calendar days in company time. */
export function addDays(day: Date, n: number, timeZone: string): Date {
  return startOfDay(new Date(day.getTime() + n * 86_400_000 + 12 * 3_600_000), timeZone);
}

/** Monday 00:00 (company time) of the week `date` is in. */
export function startOfWeek(date: Date, timeZone: string): Date {
  const day0 = startOfDay(date, timeZone);
  const dow = new Date(dayKey(day0, timeZone) + 'T12:00:00Z').getUTCDay(); // 0 = Sun
  return addDays(day0, -((dow + 6) % 7), timeZone);
}

/** First day of the month (company time). */
export function startOfMonth(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  return startOfDay(new Date(Date.UTC(p.y, p.m - 1, 1, 12)), timeZone);
}

/** Minutes after midnight (company time), for the Today timeline. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return p.h * 60 + p.mi + p.s / 60;
}

/** "09:02" in company time. */
export function clockTime(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
}

/** "Mon 24 Nov" in company time. */
export function shortDay(date: Date | string, timeZone: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }).format(new Date(date));
}

/** 'YYYY-MM-DD' + 'HH:MM' in company time → the real instant. */
export function zoned(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(startOfDay(new Date(`${date}T12:00:00Z`), timeZone).getTime() + (h * 60 + (m || 0)) * 60_000);
}
