/**
 * Corrections + leave + approvals data layer (Phase 5). The database applies
 * an approved correction to time_entries and reverts it on Undo (migration 008).
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { Correction, LeaveRequest, LeaveType, RequestStatus } from '@/types';
import { DEMO_PROFILES, demoEntries, demoSession } from './demo';
import { demoNotifications } from './api';

export class RequestError extends Error {}

function requestError(e: { code?: string; message: string }): RequestError {
  if (/out_after_in/.test(e.message)) return new RequestError('The clock-out time must be after the clock-in time.');
  if (/max_length/.test(e.message)) return new RequestError('That is too long for one shift or one leave request.');
  if (/leave_end_after_start/.test(e.message)) return new RequestError('The last day must be on or after the first day.');
  if (/reason/.test(e.message) && e.code === '23514') return new RequestError('Please write a short reason (at least 3 letters).');
  if (/corrections_one_pending/.test(e.message)) return new RequestError('You already asked to fix this shift. Wait for the answer.');
  if (['42501', '23514', '23P01', '23503'].includes(e.code ?? '')) return new RequestError(e.message);
  return new RequestError('Could not send. Check your connection and try again.');
}

/* ---------------- demo store (dev only) ---------------- */
const CK = 'shiftclock-demo-corrections', LK = 'shiftclock-demo-leave';
const rd = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]') as T[]; } catch { return []; } };
const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } window.dispatchEvent(new Event('shiftclock-board')); };
const me = () => demoSession.get();
const nameOf = (id: string) => DEMO_PROFILES.find((p) => p.id === id)?.full_name ?? 'Someone';
const notifyManagers = (type: 'correction.requested' | 'leave.requested', kind: string, requestId: string, uid: string) => {
  for (const p of DEMO_PROFILES.filter((x) => (x.role === 'owner' || x.role === 'manager') && x.id !== uid)) {
    demoNotifications.add({ recipient_id: p.id, type, payload: { kind, request_id: requestId, employee_name: nameOf(uid) } });
  }
};

/* ---------------- employee: corrections ---------------- */

export interface CorrectionInput { entryId: string | null; newIn: Date; newOut: Date; reason: string }

export async function createCorrection(userId: string, input: CorrectionInput): Promise<Correction> {
  if (input.newOut <= input.newIn) throw new RequestError('The clock-out time must be after the clock-in time.');
  if (input.newOut.getTime() > Date.now() + 5 * 60_000) throw new RequestError("The new times can't be in the future.");
  if (input.reason.trim().length < 3) throw new RequestError('Please write a short reason (at least 3 letters).');
  if (demoAuth) {
    const all = rd<Correction>(CK);
    if (input.entryId && all.some((c) => c.entry_id === input.entryId && c.status === 'pending')) throw new RequestError('You already asked to fix this shift. Wait for the answer.');
    const e = input.entryId ? demoEntries.all().find((x) => x.id === input.entryId) : undefined;
    const row: Correction = {
      id: crypto.randomUUID(), user_id: userId, entry_id: input.entryId, old_clock_in: e?.clock_in ?? null, old_clock_out: e?.clock_out ?? null,
      new_clock_in: input.newIn.toISOString(), new_clock_out: input.newOut.toISOString(), reason: input.reason.trim(), status: 'pending',
      reviewed_by: null, reviewed_at: null, review_note: null, applied_entry_id: null, created_at: new Date().toISOString(),
    };
    wr(CK, [row, ...all]);
    notifyManagers('correction.requested', 'correction', row.id, userId);
    return row;
  }
  const { data, error } = await supabase.from('corrections').insert({
    user_id: userId, entry_id: input.entryId, new_clock_in: input.newIn.toISOString(), new_clock_out: input.newOut.toISOString(), reason: input.reason.trim(),
  }).select('*').single();
  if (error) throw requestError(error);
  return data as Correction;
}

export async function fetchMyCorrections(userId: string): Promise<Correction[]> {
  if (demoAuth) return rd<Correction>(CK).filter((c) => c.user_id === userId);
  const { data, error } = await supabase.from('corrections').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as Correction[];
}

export async function withdrawCorrection(id: string): Promise<void> {
  if (demoAuth) { wr(CK, rd<Correction>(CK).filter((c) => !(c.id === id && c.status === 'pending'))); return; }
  const { error } = await supabase.from('corrections').delete().eq('id', id).eq('status', 'pending');
  if (error) throw requestError(error);
}

/* ---------------- employee: leave ---------------- */

export interface LeaveInput { type: LeaveType; start: string; end: string; reason: string }

export async function createLeave(userId: string, input: LeaveInput): Promise<LeaveRequest> {
  if (input.end < input.start) throw new RequestError('The last day must be on or after the first day.');
  if (demoAuth) {
    const all = rd<LeaveRequest>(LK);
    if (all.some((l) => l.user_id === userId && l.status !== 'declined' && l.start_date <= input.end && l.end_date >= input.start)) throw new RequestError('You already asked for leave on some of these days');
    const row: LeaveRequest = { id: crypto.randomUUID(), user_id: userId, type: input.type, start_date: input.start, end_date: input.end, reason: input.reason.trim() || null, status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, created_at: new Date().toISOString() };
    wr(LK, [row, ...all]);
    notifyManagers('leave.requested', 'leave', row.id, userId);
    return row;
  }
  const { data, error } = await supabase.from('leave_requests').insert({ user_id: userId, type: input.type, start_date: input.start, end_date: input.end, reason: input.reason.trim() || null }).select('*').single();
  if (error) throw requestError(error);
  return data as LeaveRequest;
}

export async function fetchMyLeave(userId: string): Promise<LeaveRequest[]> {
  if (demoAuth) return rd<LeaveRequest>(LK).filter((l) => l.user_id === userId).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const { data, error } = await supabase.from('leave_requests').select('*').eq('user_id', userId).order('start_date', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as LeaveRequest[];
}

export async function withdrawLeave(id: string): Promise<void> {
  if (demoAuth) { wr(LK, rd<LeaveRequest>(LK).filter((l) => !(l.id === id && l.status === 'pending'))); return; }
  const { error } = await supabase.from('leave_requests').delete().eq('id', id).eq('status', 'pending');
  if (error) throw requestError(error);
}

/* ---------------- managers: approvals ---------------- */

/** Everything pending, plus decisions from the last 60 days. */
export async function fetchApprovals(): Promise<{ corrections: Correction[]; leave: LeaveRequest[] }> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  if (demoAuth) {
    return {
      corrections: rd<Correction>(CK).filter((c) => c.status === 'pending' || (c.reviewed_at ?? c.created_at) >= since),
      leave: rd<LeaveRequest>(LK).filter((l) => l.status === 'pending' || (l.reviewed_at ?? l.created_at) >= since),
    };
  }
  const [c, l] = await Promise.all([
    supabase.from('corrections').select('*').or(`status.eq.pending,reviewed_at.gte.${since}`).order('created_at').limit(300),
    supabase.from('leave_requests').select('*').or(`status.eq.pending,reviewed_at.gte.${since}`).order('created_at').limit(300),
  ]);
  if (c.error) throw c.error;
  if (l.error) throw l.error;
  return { corrections: (c.data ?? []) as Correction[], leave: (l.data ?? []) as LeaveRequest[] };
}

export type RequestKind = 'correction' | 'leave';

/** Approve / decline (or `pending` = Undo). */
export async function decide(kind: RequestKind, id: string, status: RequestStatus, note?: string): Promise<void> {
  if (demoAuth) {
    const key = kind === 'correction' ? CK : LK;
    const all = rd<Correction & LeaveRequest>(key);
    const row = all.find((x) => x.id === id);
    if (!row) throw new RequestError('That request no longer exists.');
    const reviewer = me();
    if (reviewer && row.user_id === reviewer.id && reviewer.role !== 'owner') throw new RequestError("You can't decide your own request. Ask the owner.");
    if (row.status !== 'pending' && status !== 'pending') throw new RequestError('Undo the decision first, then decide again');
    // demo: apply / revert corrections on the demo clock entries
    if (kind === 'correction') {
      const entries = demoEntries.all();
      if (status === 'approved') {
        if (row.entry_id) { const e = entries.find((x) => x.id === row.entry_id); if (e) { e.clock_in = row.new_clock_in; e.clock_out = row.new_clock_out; e.edited = true; } }
        else { const nid = crypto.randomUUID(); entries.unshift({ id: nid, user_id: row.user_id, clock_in: row.new_clock_in, clock_out: row.new_clock_out, method: 'manual', location_id: null, break_minutes: 0, note: 'Added by correction', edited: true, created_at: new Date().toISOString() }); row.applied_entry_id = nid; }
      } else if (status === 'pending' && row.status === 'approved') {
        if (row.entry_id) { const e = entries.find((x) => x.id === row.entry_id); if (e) { e.clock_in = row.old_clock_in!; e.clock_out = row.old_clock_out; } }
        if (row.applied_entry_id) { const i = entries.findIndex((x) => x.id === row.applied_entry_id); if (i >= 0) entries.splice(i, 1); row.applied_entry_id = null; }
      }
      demoEntries.save(entries);
    }
    row.status = status;
    row.reviewed_by = status === 'pending' ? null : reviewer?.id ?? null;
    row.reviewed_at = status === 'pending' ? null : new Date().toISOString();
    row.review_note = status === 'pending' ? null : note?.trim() || null;
    wr(key, all);
    if (status !== 'pending') demoNotifications.add({ recipient_id: row.user_id, type: status === 'approved' ? 'request.approved' : 'request.declined', payload: { kind, request_id: id, review_note: row.review_note, reviewer_name: reviewer?.full_name } });
    return;
  }
  const table = kind === 'correction' ? 'corrections' : 'leave_requests';
  const { error } = await supabase.from(table).update({ status, review_note: status === 'pending' ? null : note?.trim() || null }).eq('id', id);
  if (error) throw requestError(error);
}

/** Calendar days in a leave request (inclusive). */
export const leaveDays = (l: Pick<LeaveRequest, 'start_date' | 'end_date'>) =>
  Math.round((Date.parse(`${l.end_date}T12:00:00Z`) - Date.parse(`${l.start_date}T12:00:00Z`)) / 86_400_000) + 1;

export const LEAVE_LABEL: Record<LeaveType, string> = { annual: 'Annual leave', sick: 'Sick leave', unpaid: 'Unpaid leave', other: 'Other' };

/** Approved / pending leave for one person in a date range (managers, or yourself). */
export async function fetchLeaveFor(userId: string, from: string, to: string): Promise<LeaveRequest[]> {
  if (demoAuth) return rd<LeaveRequest>(LK).filter((l) => l.user_id === userId && l.start_date <= to && l.end_date >= from);
  const { data, error } = await supabase.from('leave_requests').select('*').eq('user_id', userId).lte('start_date', to).gte('end_date', from);
  if (error) throw error;
  return (data ?? []) as LeaveRequest[];
}
