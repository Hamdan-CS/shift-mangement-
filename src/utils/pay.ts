import type { TimeEntry } from '@/types';

/** Minutes of `e` that fall inside [from, to), minus its break. Open entries run until `now`. */
export function entryMinutes(e: TimeEntry, from: Date, to: Date, now = new Date()): number {
  const start = Math.max(new Date(e.clock_in).getTime(), from.getTime());
  const end = Math.min((e.clock_out ? new Date(e.clock_out) : now).getTime(), to.getTime());
  if (end <= start) return 0;
  const whole = (new Date(e.clock_out ?? now).getTime() - new Date(e.clock_in).getTime()) / 60000;
  const inside = (end - start) / 60000;
  // spread the break over the entry so split days stay fair
  const brk = whole > 0 ? (e.break_minutes * inside) / whole : 0;
  return Math.max(0, inside - brk);
}

export function totalMinutes(entries: TimeEntry[], from: Date, to: Date, now = new Date()): number {
  return entries.reduce((sum, e) => sum + entryMinutes(e, from, to, now), 0);
}

/**
 * Gross pay for one week of minutes (PLAN.md section 8):
 * regular up to `overtimeAfterHours`, the rest at `multiplier`.
 * An estimate for the screen; Phase 7 does payroll with numeric maths in the database.
 */
export function weekGross(minutes: number, rate: number | null, overtimeAfterHours = 40, multiplier = 1.5) {
  const hours = minutes / 60;
  const regular = Math.min(hours, overtimeAfterHours);
  const overtime = Math.max(0, hours - overtimeAfterHours);
  const r = rate ?? 0;
  return { regular, overtime, gross: Math.round((regular * r + overtime * r * multiplier) * 100) / 100 };
}
