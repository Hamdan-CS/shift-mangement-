/**
 * Pay, deductions, staff and export (Phase 7). Pay itself is worked out in the
 * database (migration 011: pay_days / pay_report), so every screen, the Copy
 * text and the Excel file show the same numbers.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { Profile, Role } from '@/types';
import { DEMO_PROFILES, DEMO_SETTINGS, demoEntries } from './demo';

export interface PayRow {
  user_id: string; full_name: string; job_title: string | null; role: Role;
  rate: number | null; overtime_after_hours: number; overtime_multiplier: number;
  days_worked: number; worked_minutes: number; regular_minutes: number; overtime_minutes: number;
  gross: number; deductions: number; net: number; late_count: number; absent_count: number; leave_days: number;
}

export interface PayDay {
  user_id: string; day: string; first_in: string; last_out: string | null; minutes: number; break_minutes: number;
  entries: number; methods: string; corrected: boolean; open: boolean; shift_start: string | null; shift_end: string | null; late: boolean;
  /** Names of whoever added or approved hours that day (null = clocked by the person). */
  approved_by?: string | null;
}

export interface Deduction {
  id: string; user_id: string | null; name: string; type: 'fixed' | 'percent'; amount: number;
  recurring: 'once' | 'weekly' | 'monthly'; start_date: string; end_date: string | null; created_at: string;
}

export class PayError extends Error {}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/* ---------------- demo (dev only): same rules, simplified ---------------- */
function demoDays(from: string, to: string): PayDay[] {
  const out = new Map<string, PayDay>();
  for (const e of demoEntries.all()) {
    const day = new Date(e.clock_in).toLocaleDateString('en-CA', { timeZone: DEMO_SETTINGS.timezone });
    if (day < from || day > to) continue;
    const mins = Math.max(0, ((e.clock_out ? Date.parse(e.clock_out) : Date.now()) - Date.parse(e.clock_in)) / 60000 - e.break_minutes);
    const k = `${e.user_id}:${day}`;
    const d = out.get(k) ?? { user_id: e.user_id, day, first_in: e.clock_in, last_out: e.clock_out, minutes: 0, break_minutes: 0, entries: 0, methods: e.method, corrected: false, open: false, shift_start: null, shift_end: null, late: false, approved_by: null as string | null };
    if (e.edited_by_name) d.approved_by = d.approved_by && !d.approved_by.includes(e.edited_by_name) ? `${d.approved_by}, ${e.edited_by_name}` : e.edited_by_name;
    d.minutes += Math.round(mins); d.entries++; d.corrected ||= e.edited; d.open ||= !e.clock_out;
    if (e.clock_in < d.first_in) d.first_in = e.clock_in;
    d.last_out = d.open ? null : e.clock_out && (!d.last_out || e.clock_out > d.last_out) ? e.clock_out : d.last_out;
    out.set(k, d);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}
function demoReport(from: string, to: string): PayRow[] {
  const days = demoDays(from, to);
  return DEMO_PROFILES.map((p) => {
    const mine = days.filter((d) => d.user_id === p.id);
    const weeks = new Map<string, number>();
    for (const d of mine) { const dt = new Date(`${d.day}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); const k = dt.toISOString().slice(0, 10); weeks.set(k, (weeks.get(k) ?? 0) + d.minutes); }
    let reg = 0, ot = 0;
    for (const m of weeks.values()) { reg += Math.min(m, p.overtime_after_hours * 60); ot += Math.max(0, m - p.overtime_after_hours * 60); }
    const rate = p.hourly_rate ?? 0;
    const gross = Math.round((rate * reg / 60 + rate * p.overtime_multiplier * ot / 60) * 100) / 100;
    const ded = Math.min(gross, readDed().filter((x) => (x.user_id === null || x.user_id === p.id) && x.start_date <= to && (!x.end_date || x.end_date >= from)).reduce((s, x) => s + deductionAmount(x, gross, from, to), 0));
    return { user_id: p.id, full_name: p.full_name, job_title: p.job_title, role: p.role, rate: p.hourly_rate, overtime_after_hours: p.overtime_after_hours, overtime_multiplier: p.overtime_multiplier, days_worked: mine.length, worked_minutes: reg + ot, regular_minutes: reg, overtime_minutes: ot, gross, deductions: ded, net: gross - ded, late_count: 0, absent_count: 0, leave_days: 0 };
  });
}

/**
 * What one deduction takes in a period: the same rules as pay_report (migration 011).
 * percent → % of gross; once → its amount if it starts in the period;
 * weekly / monthly → amount × weeks / months it touches.
 */
export function deductionAmount(d: Deduction, gross: number, from: string, to: string): number {
  if (gross <= 0) return 0;
  if (d.type === 'percent') return Math.round(gross * d.amount) / 100;
  if (d.recurring === 'once') return d.start_date >= from && d.start_date <= to ? d.amount : 0;
  const start = new Date(`${d.start_date > from ? d.start_date : from}T00:00:00Z`);
  const end = new Date(`${d.end_date && d.end_date < to ? d.end_date : to}T00:00:00Z`);
  if (end < start) return 0;
  if (d.recurring === 'weekly') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return d.amount * (Math.floor((end.getTime() - start.getTime()) / (7 * 86400000)) + 1);
  }
  return d.amount * ((end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1);
}

/* ---------------- pay ---------------- */

export async function fetchPayReport(from: string, to: string): Promise<PayRow[]> {
  if (demoAuth) return demoReport(from, to);
  const { data, error } = await supabase.rpc('pay_report', { p_from: from, p_to: to });
  if (error) throw error;
  return ((data ?? []) as PayRow[]).map((r) => ({ ...r, rate: r.rate === null ? null : num(r.rate), gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), overtime_after_hours: num(r.overtime_after_hours), overtime_multiplier: num(r.overtime_multiplier) }));
}

export async function fetchPayDays(from: string, to: string): Promise<PayDay[]> {
  if (demoAuth) return demoDays(from, to);
  const { data, error } = await supabase.rpc('pay_days', { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as PayDay[];
}

/* ---------------- deductions (owner edits; everyone reads their own) ---------------- */

const DK = 'shiftclock-demo-deductions';
const readDed = (): Deduction[] => { try { return JSON.parse(localStorage.getItem(DK) || '[]') as Deduction[]; } catch { return []; } };

export async function fetchDeductions(userId?: string): Promise<Deduction[]> {
  if (demoAuth) return readDed().filter((d) => !userId || d.user_id === userId || d.user_id === null);
  let q = supabase.from('deductions').select('*').order('start_date', { ascending: false });
  if (userId) q = q.or(`user_id.eq.${userId},user_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Deduction[]).map((d) => ({ ...d, amount: num(d.amount) }));
}

export type DeductionInput = Omit<Deduction, 'id' | 'created_at'>;
export async function addDeduction(d: DeductionInput): Promise<void> {
  if (!d.name.trim()) throw new PayError('Give the deduction a name.');
  if (!(d.amount > 0)) throw new PayError('The amount must be more than 0.');
  if (d.type === 'percent' && d.amount > 100) throw new PayError('A percent can be at most 100.');
  if (demoAuth) { localStorage.setItem(DK, JSON.stringify([{ ...d, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...readDed()])); return; }
  const { error } = await supabase.from('deductions').insert({ ...d, name: d.name.trim() });
  if (error) throw new PayError(error.code === '42501' ? 'Only the owner can change deductions.' : 'Could not save the deduction.');
}
export async function removeDeduction(id: string): Promise<void> {
  if (demoAuth) { localStorage.setItem(DK, JSON.stringify(readDed().filter((d) => d.id !== id))); return; }
  const { error } = await supabase.from('deductions').delete().eq('id', id);
  if (error) throw new PayError('Could not remove the deduction.');
}

/* ---------------- people (owner) ---------------- */

export async function fetchPeople(): Promise<Profile[]> {
  if (demoAuth) return DEMO_PROFILES;
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) throw error;
  return ((data ?? []) as Profile[]).map((p) => ({ ...p, hourly_rate: p.hourly_rate === null ? null : num(p.hourly_rate), overtime_after_hours: num(p.overtime_after_hours), overtime_multiplier: num(p.overtime_multiplier) }));
}

export type ProfilePatch = Partial<Pick<Profile, 'full_name' | 'job_title' | 'role' | 'hourly_rate' | 'overtime_after_hours' | 'overtime_multiplier' | 'active' | 'notify_email' | 'email_daily' | 'email_weekly'>>;
export async function updatePerson(id: string, patch: ProfilePatch): Promise<void> {
  if (demoAuth) { const p = DEMO_PROFILES.find((x) => x.id === id); if (p) Object.assign(p, patch); return; }
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw new PayError(/owner/.test(error.message) ? error.message : error.code === '42501' ? 'Only the owner can change this.' : 'Could not save.');
}

/** Calls the `staff` Edge Function (owner only): add a person or set a new password. */
async function staff<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff', { body });
  if (!error) return data as T;
  let j: { message?: string } = {};
  try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
  throw new PayError(j.message ?? 'Could not reach the server.');
}

export interface NewPerson { full_name: string; username: string; password: string; role: Role; job_title: string; hourly_rate: number | null }
export async function addPerson(p: NewPerson): Promise<{ id: string }> {
  if (!/^[a-z0-9._-]{3,32}$/.test(p.username)) throw new PayError('Username: 3–32 small letters, numbers, dot, dash or underscore.');
  if (p.password.length < 8) throw new PayError('The password needs at least 8 characters.');
  if (demoAuth) {
    const id = `demo-${p.username}`;
    DEMO_PROFILES.push({ id, username: p.username, full_name: p.full_name, avatar_url: null, notify_email: null, email_daily: true, email_weekly: true, role: p.role, job_title: p.job_title || null, hourly_rate: p.hourly_rate, overtime_after_hours: 40, overtime_multiplier: 1.5, active: true, created_at: new Date().toISOString() });
    return { id };
  }
  return staff({ action: 'create', ...p });
}
export async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < 8) throw new PayError('The password needs at least 8 characters.');
  if (demoAuth) return;
  await staff({ action: 'password', user_id: userId, password });
}

/** A readable password suggestion for a new person (the owner can change it). */
export function suggestPassword(): string {
  const words = ['river', 'maple', 'cloud', 'stone', 'amber', 'tiger', 'lemon', 'piano', 'orbit', 'cedar'];
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${words[r[0] % words.length]}-${words[r[1] % words.length]}-${(r[2] % 900) + 100}`;
}

/* ---------------- Excel (export-xlsx Edge Function) ---------------- */

/** Downloads ShiftClock_<Company>_<from>_<to>.xlsx (managers / owner). */
export async function downloadExcel(from: string, to: string, userIds?: string[]): Promise<void> {
  if (demoAuth) throw new PayError('Excel needs the real database (demo mode has no server).');
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-xlsx`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, users: userIds }),
  });
  if (!res.ok) {
    let m = 'Could not make the Excel file.';
    try { m = (await res.json()).message ?? m; } catch { /* not JSON */ }
    throw new PayError(m);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `ShiftClock_${from}_${to}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** CSV of a payroll period (plain, opens in any spreadsheet). */
export function payrollCsv(rows: PayRow[], currency: string): string {
  const head = ['Employee', 'Job title', 'Days worked', 'Hours', 'Regular hours', 'Overtime hours', `Rate (${currency})`, `Gross (${currency})`, `Deductions (${currency})`, `Net (${currency})`, 'Late', 'Absent', 'Leave days'];
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const h = (m: number) => (m / 60).toFixed(2);
  const lines = rows.map((r) => [r.full_name, r.job_title ?? '', r.days_worked, h(r.worked_minutes), h(r.regular_minutes), h(r.overtime_minutes), r.rate?.toFixed(2) ?? '', r.gross.toFixed(2), r.deductions.toFixed(2), r.net.toFixed(2), r.late_count, r.absent_count, r.leave_days].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}
