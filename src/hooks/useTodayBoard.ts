import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTeam } from '@/services/api';
import { fetchTodayBoard, subscribeBoard, toMin } from '@/services/schedules';
import { useClock } from '@/contexts/ClockContext';
import { minutesOfDay } from '@/utils/tz';
import type { BoardRow } from '@/components/dashboard/statusMeta';
import type { PublicProfile, TodayBoardRow } from '@/types';

/** Safety net if a Realtime ping is missed (phone asleep, flaky signal). */
const REFRESH_MS = 120_000;

/**
 * Rows for the Today schedule table from `v_today_board` (shifts + clock
 * data, statuses worked out in the database). Reloads live on every Realtime
 * "board" ping, on your own clock actions and when the app comes back.
 */
export function useTodayBoard() {
  const { version, timeZone } = useClock();
  const [team, setTeam] = useState<PublicProfile[] | null>(null);
  const [board, setBoard] = useState<TodayBoardRow[]>([]);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, b] = await Promise.all([fetchTeam(), fetchTodayBoard()]);
      setTeam(t);
      setBoard(b);
    } catch {
      setTeam((x) => x ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load, version]);

  // Realtime pings arrive in bursts (one per changed table): reload once.
  useEffect(() => subscribeBoard(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void load(); }, 400);
  }), [load]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const t = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const rows = useMemo<BoardRow[]>(() => {
    const by = new Map(board.map((r) => [r.user_id, r]));
    return (team ?? []).map((person) => {
      const b = by.get(person.id);
      return {
        person,
        status: b?.status ?? 'off',
        shiftStart: b?.shift_start ? toMin(b.shift_start) : null,
        shiftEnd: b?.shift_end ? toMin(b.shift_end) : null,
        shiftNote: b?.shift_note ?? null,
        clockIn: b?.first_in ? minutesOfDay(new Date(b.first_in), timeZone) : null,
        clockOut: b?.last_out ? minutesOfDay(new Date(b.last_out), timeZone) : null,
        workedMinutes: b?.worked_minutes ?? 0,
      };
    });
  }, [team, board, timeZone]);

  return { rows, loading: team === null, reload: load };
}
