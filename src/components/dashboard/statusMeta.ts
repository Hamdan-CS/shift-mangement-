import type { WChipTone } from '@/components/app/ui';
import type { PublicProfile } from '@/types';

/** Status values from PLAN.md section 5 (v_today_board). */
export type BoardStatus = 'working' | 'upcoming' | 'late' | 'finished' | 'off' | 'on_leave' | 'absent';

/** Sort order from PLAN.md 10b: working → late → upcoming → finished → off/leave. */
export const STATUS_META: Record<BoardStatus, { label: string; tone: WChipTone; order: number }> = {
  working: { label: 'Working', tone: 'ok', order: 0 },
  late: { label: 'Late', tone: 'danger', order: 1 },
  upcoming: { label: 'Upcoming', tone: 'accent', order: 2 },
  finished: { label: 'Finished', tone: 'default', order: 3 },
  absent: { label: 'Absent', tone: 'warn', order: 4 },
  on_leave: { label: 'On leave', tone: 'violet', order: 5 },
  off: { label: 'Off', tone: 'default', order: 6 },
};

/** One row of the Today table. Times are minutes after midnight in the company timezone. */
export interface BoardRow {
  person: PublicProfile;
  status: BoardStatus;
  shiftStart: number | null;
  shiftEnd: number | null;
  shiftNote?: string | null;
  clockIn: number | null;
  clockOut: number | null;
  /** Worked today from the server (minutes), for people still working it grows with `now`. */
  workedMinutes?: number;
}

export type BoardFilter = 'all' | 'working' | 'off' | 'late';

export const FILTERS: { id: BoardFilter; label: string; match: (s: BoardStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'working', label: 'Working now', match: (s) => s === 'working' },
  { id: 'off', label: 'Off', match: (s) => s === 'off' || s === 'on_leave' },
  { id: 'late', label: 'Late', match: (s) => s === 'late' || s === 'absent' },
];

export const hhmm = (min: number | null) => {
  if (min === null) return '—';
  // truncate like a clock (09:02:50 is still 09:02)
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Minutes after midnight right now in a timezone (company timezone from settings). */
export function minutesNowIn(timeZone: string | undefined, d = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return n('hour') * 60 + n('minute') + n('second') / 60;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** "09:00" / "24:00" → minutes. */
export const timeToMin = (t: string | null | undefined, fallback: number) => {
  if (!t) return fallback;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : fallback;
};
