/**
 * Timesheets (managers / owner): every entry in a range, plus edit / add / delete.
 * RLS + the time_entries_guard trigger (migration 004) allow this for managers
 * only and mark every change as edited.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { TimeEntry } from '@/types';
import { demoEntries } from './demo';

export class SheetError extends Error {}

export async function fetchAllEntries(from: Date, to: Date, userId?: string): Promise<TimeEntry[]> {
  if (demoAuth) {
    return demoEntries.all()
      .filter((e) => (!userId || e.user_id === userId) && new Date(e.clock_in) >= from && new Date(e.clock_in) < to)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in));
  }
  let q = supabase.from('time_entries').select('*').gte('clock_in', from.toISOString()).lt('clock_in', to.toISOString()).order('clock_in', { ascending: false }).limit(1000);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

export interface EntryInput { user_id: string; clock_in: string; clock_out: string | null; break_minutes: number; note: string | null }

function check(e: EntryInput) {
  if (e.clock_out && Date.parse(e.clock_out) <= Date.parse(e.clock_in)) throw new SheetError('The end must be after the start.');
  if (e.clock_out && Date.parse(e.clock_out) - Date.parse(e.clock_in) > 24 * 3600_000) throw new SheetError('A shift can be at most 24 hours.');
  if (e.break_minutes < 0 || e.break_minutes > 600) throw new SheetError('Break must be 0–600 minutes.');
}
const fail = (error: { code?: string; message: string }) =>
  new SheetError(error.code === '42501' ? 'Only a manager can change hours.' : /overlap|exclu/i.test(error.message) ? 'This overlaps another shift for the same person.' : /one_open|unique/i.test(error.message) ? 'This person already has an open shift.' : 'Could not save.');

export async function saveEntry(id: string | null, e: EntryInput): Promise<void> {
  check(e);
  if (demoAuth) {
    const list = demoEntries.all();
    if (id) { const x = list.find((y) => y.id === id); if (x) Object.assign(x, e, { edited: true }); }
    else list.push({ ...e, id: crypto.randomUUID(), method: 'manual', location_id: null, edited: true, created_at: new Date().toISOString() });
    demoEntries.save(list);
    return;
  }
  const { error } = id
    ? await supabase.from('time_entries').update(e).eq('id', id)
    : await supabase.from('time_entries').insert({ ...e, method: 'manual' });
  if (error) throw fail(error);
}

export async function deleteEntry(id: string): Promise<void> {
  if (demoAuth) { demoEntries.save(demoEntries.all().filter((e) => e.id !== id)); return; }
  const { error } = await supabase.from('time_entries').delete().eq('id', id);
  if (error) throw fail(error);
}
