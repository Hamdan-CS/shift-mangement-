import { hm, toMin } from '@/services/schedules';
import type { ScheduleShift } from '@/types';

/** Day header label pieces for 'YYYY-MM-DD'. */
export function dayParts(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    num: d.getUTCDate(),
    long: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

export const dayMinutes = (shifts: ScheduleShift[]) => shifts.reduce((s, x) => s + toMin(hm(x.end_time)) - toMin(hm(x.start_time)), 0);

