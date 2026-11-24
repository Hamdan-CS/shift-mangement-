/**
 * Schedules + Today board data layer (Phase 3). Pages never call Supabase
 * directly. All rules (locked weeks, overlaps, week bounds, edited_by) live in
 * the database (migration 005); demo mode mirrors the important ones.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { ScheduleShift, ScheduleWeek, TodayBoardRow, TimeEntry, WeekStatus } from '@/types';
import { DEMO_PROFILES, DEMO_SETTINGS, demoEntries } from './demo';
import { dayKey, minutesOfDay, startOfDay } from '@/utils/tz';

/** Thrown when the database refuses a schedule change; `message` is safe to show. */
export class ScheduleError extends Error {}

function scheduleError(e: { code?: string; message: string }): ScheduleError {
  if (/end_after_start/.test(e.message)) return new ScheduleError('The end time must be after the start time.');
  if (/week_start_check/.test(e.message)) return new ScheduleError('A week has to start on a Monday.');
  if (e.code === '23505') return new ScheduleError('That week already exists. Pull to refresh.');
  if (['42501', '23514', '23P01'].includes(e.code ?? '')) return new ScheduleError(e.message);
  return new ScheduleError('Could not save. Check your connection and try again.');
}

/** "09:00:00" → "09:00" */
export const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
/** "09:30" → 570 */
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/* ---------------- demo store (dev only) ---------------- */

const WK = 'shiftclock-demo-weeks';
const SH = 'shiftclock-demo-shifts';
const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]') as T[]; } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const demoPing = () => window.dispatchEvent(new Event('shiftclock-board'));

/* ---------------- weeks ---------------- */

/** Your (or, for managers, anyone's) week and its shifts. Week may not exist yet. */
export async function fetchWeek(userId: string, weekStart: string): Promise<{ week: ScheduleWeek | null; shifts: ScheduleShift[] }> {
  if (demoAuth) {
    const week = read<ScheduleWeek>(WK).find((w) => w.user_id === userId && w.week_start === weekStart) ?? null;
    const shifts = week ? read<ScheduleShift>(SH).filter((s) => s.week_id === week.id) : [];
    return { week, shifts: sortShifts(shifts) };
  }
  const { data: week, error } = await supabase.from('schedule_weeks').select('*').eq('user_id', userId).eq('week_start', weekStart).maybeSingle();
  if (error) throw error;
  if (!week) return { week: null, shifts: [] };
  const { data: shifts, error: e2 } = await supabase.from('schedule_shifts').select('*').eq('week_id', week.id);
  if (e2) throw e2;
  return { week: week as ScheduleWeek, shifts: sortShifts((shifts ?? []) as ScheduleShift[]) };
}

/** Creates the week row if it doesn't exist yet, and returns it. */
export async function ensureWeek(userId: string, weekStart: string): Promise<ScheduleWeek> {
  if (demoAuth) {
    const all = read<ScheduleWeek>(WK);
    const hit = all.find((w) => w.user_id === userId && w.week_start === weekStart);
    if (hit) return hit;
    const week: ScheduleWeek = { id: crypto.randomUUID(), user_id: userId, week_start: weekStart, status: 'draft', submitted_at: null, locked_by: null, locked_at: null };
    write(WK, [...all, week]);
    return week;
  }
  const existing = await fetchWeek(userId, weekStart);
  if (existing.week) return existing.week;
  const { data, error } = await supabase.from('schedule_weeks').insert({ user_id: userId, week_start: weekStart }).select('*').single();
  if (error?.code === '23505') { const again = await fetchWeek(userId, weekStart); if (again.week) return again.week; }
  if (error) throw scheduleError(error);
  return data as ScheduleWeek;
}

export async function setWeekStatus(week: ScheduleWeek, status: WeekStatus, byManager = false): Promise<ScheduleWeek> {
  if (demoAuth) {
    if (week.status === 'locked' && !byManager) throw new ScheduleError('This week is locked. Ask your manager to change it.');
    const all = read<ScheduleWeek>(WK).map((w) => (w.id === week.id ? { ...w, status, submitted_at: status === 'submitted' ? new Date().toISOString() : w.submitted_at, locked_at: status === 'locked' ? new Date().toISOString() : null } : w));
    write(WK, all); demoPing();
    return all.find((w) => w.id === week.id)!;
  }
  const { data, error } = await supabase.from('schedule_weeks').update({ status }).eq('id', week.id).select('*').single();
  if (error) throw scheduleError(error);
  return data as ScheduleWeek;
}

/* ---------------- shifts ---------------- */

export interface ShiftInput { id?: string; week: ScheduleWeek; date: string; start: string; end: string; note?: string | null }

export async function saveShift(input: ShiftInput, byManager = false): Promise<ScheduleShift> {
  if (toMin(input.end) <= toMin(input.start)) throw new ScheduleError('The end time must be after the start time.');
  if (demoAuth) {
    if (input.week.status === 'locked' && !byManager) throw new ScheduleError('This week is locked. Ask your manager to change it.');
    const all = read<ScheduleShift>(SH);
    const clash = all.find((s) => s.user_id === input.week.user_id && s.date === input.date && s.id !== input.id && toMin(s.start_time) < toMin(input.end) && toMin(s.end_time) > toMin(input.start));
    if (clash) throw new ScheduleError('This overlaps another shift on the same day');
    const row: ScheduleShift = { id: input.id ?? crypto.randomUUID(), week_id: input.week.id, user_id: input.week.user_id, date: input.date, start_time: input.start, end_time: input.end, note: input.note ?? null, edited_by: byManager ? 'demo-manager' : null };
    write(SH, input.id ? all.map((s) => (s.id === input.id ? row : s)) : [...all, row]); demoPing();
    return row;
  }
  const payload = { week_id: input.week.id, user_id: input.week.user_id, date: input.date, start_time: input.start, end_time: input.end, note: input.note?.trim() || null };
  const q = input.id
    ? supabase.from('schedule_shifts').update(payload).eq('id', input.id).select('*').single()
    : supabase.from('schedule_shifts').insert(payload).select('*').single();
  const { data, error } = await q;
  if (error) throw scheduleError(error);
  return data as ScheduleShift;
}

export async function deleteShift(shift: ScheduleShift, week: ScheduleWeek, byManager = false): Promise<void> {
  if (demoAuth) {
    if (week.status === 'locked' && !byManager) throw new ScheduleError('This week is locked. Ask your manager to change it.');
    write(SH, read<ScheduleShift>(SH).filter((s) => s.id !== shift.id)); demoPing();
    return;
  }
  const { error } = await supabase.from('schedule_shifts').delete().eq('id', shift.id);
  if (error) throw scheduleError(error);
}

/** Copies last week's shifts onto the same weekdays of `week` (skips days that already have shifts). */
export async function copyWeek(userId: string, fromWeekStart: string, week: ScheduleWeek): Promise<number> {
  const prev = await fetchWeek(userId, fromWeekStart);
  const current = await fetchWeek(userId, week.week_start);
  const taken = new Set(current.shifts.map((s) => s.date));
  let n = 0;
  for (const s of prev.shifts) {
    const date = shiftDate(week.week_start, dayIndex(fromWeekStart, s.date));
    if (taken.has(date)) continue;
    await saveShift({ week, date, start: hm(s.start_time), end: hm(s.end_time), note: s.note });
    n++;
  }
  return n;
}

/* ---------------- manager: everyone's week / a day ---------------- */

export async function fetchTeamWeek(weekStart: string): Promise<{ weeks: ScheduleWeek[]; shifts: ScheduleShift[] }> {
  const end = shiftDate(weekStart, 6);
  if (demoAuth) {
    return {
      weeks: read<ScheduleWeek>(WK).filter((w) => w.week_start === weekStart),
      shifts: sortShifts(read<ScheduleShift>(SH).filter((s) => s.date >= weekStart && s.date <= end)),
    };
  }
  const [w, s] = await Promise.all([
    supabase.from('schedule_weeks').select('*').eq('week_start', weekStart),
    supabase.from('schedule_shifts').select('*').gte('date', weekStart).lte('date', end),
  ]);
  if (w.error) throw w.error;
  if (s.error) throw s.error;
  return { weeks: (w.data ?? []) as ScheduleWeek[], shifts: sortShifts((s.data ?? []) as ScheduleShift[]) };
}

/** Your own shifts between two dates (Next shift card). */
export async function fetchMyShifts(userId: string, from: string, to: string): Promise<ScheduleShift[]> {
  if (demoAuth) return sortShifts(read<ScheduleShift>(SH).filter((s) => s.user_id === userId && s.date >= from && s.date <= to));
  const { data, error } = await supabase.from('schedule_shifts').select('*').eq('user_id', userId).gte('date', from).lte('date', to).order('date').order('start_time');
  if (error) throw error;
  return (data ?? []) as ScheduleShift[];
}

/* ---------------- Today board ---------------- */

export async function fetchTodayBoard(): Promise<TodayBoardRow[]> {
  if (demoAuth) return demoBoard();
  const { data, error } = await supabase.from('v_today_board').select('*');
  if (error) throw error;
  return (data ?? []) as TodayBoardRow[];
}

/**
 * Live board: a data-free ping on the private Realtime channel "board"
 * whenever a clock entry or shift changes (migration 005). Returns unsubscribe.
 */
export function subscribeBoard(onChange: () => void): () => void {
  if (demoAuth) {
    window.addEventListener('shiftclock-board', onChange);
    return () => window.removeEventListener('shiftclock-board', onChange);
  }
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let stopped = false;
  void (async () => {
    await supabase.realtime.setAuth();
    if (stopped) return;
    channel = supabase.channel('board', { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => onChange())
      .subscribe();
  })();
  return () => { stopped = true; if (channel) void supabase.removeChannel(channel); };
}

/* ---------------- helpers ---------------- */

function sortShifts(list: ScheduleShift[]) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
}

/** 'YYYY-MM-DD' + n days (calendar maths, no timezone). */
export function shiftDate(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dayIndex(weekStart: string, day: string): number {
  return Math.round((new Date(`${day}T12:00:00Z`).getTime() - new Date(`${weekStart}T12:00:00Z`).getTime()) / 86_400_000);
}

/** Demo mode: same status rules as private.today_board(). */
function demoBoard(): TodayBoardRow[] {
  const tz = DEMO_SETTINGS.timezone;
  const now = new Date();
  const today = dayKey(now, tz);
  const d0 = startOfDay(now, tz);
  const nowMin = minutesOfDay(now, tz);
  const shifts = read<ScheduleShift>(SH).filter((s) => s.date === today);
  const entries = demoEntries.all();
  return DEMO_PROFILES.filter((p) => p.active).map((p) => {
    const mine = shifts.filter((s) => s.user_id === p.id);
    const st = mine.length ? mine.map((s) => hm(s.start_time)).sort()[0] : null;
    const en = mine.length ? mine.map((s) => hm(s.end_time)).sort().slice(-1)[0] : null;
    const es = entries.filter((e: TimeEntry) => e.user_id === p.id && (e.clock_out ? new Date(e.clock_out) : now) > d0 && new Date(e.clock_in) < new Date(d0.getTime() + 86_400_000));
    const open = es.some((e) => !e.clock_out);
    const worked = es.reduce((m, e) => m + Math.max(0, ((e.clock_out ? new Date(e.clock_out) : now).getTime() - Math.max(new Date(e.clock_in).getTime(), d0.getTime())) / 60000), 0);
    const first = es.map((e) => e.clock_in).sort()[0] ?? null;
    const last = open ? null : (es.map((e) => e.clock_out!).sort().slice(-1)[0] ?? null);
    let status: TodayBoardRow['status'] = 'off';
    if (open) status = 'working';
    else if (es.length) status = 'finished';
    else if (st && en) status = nowMin < toMin(st) + 10 ? 'upcoming' : nowMin < toMin(en) ? 'late' : 'absent';
    return { user_id: p.id, shift_start: st, shift_end: en, shift_note: mine.map((s) => s.note).filter(Boolean).join(', ') || null, first_in: first, last_out: last, is_open: open, worked_minutes: Math.round(worked), status };
  });
}
