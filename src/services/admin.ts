/**
 * Owner settings extras (Phase 8–9): email log, test email, saved report views.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';

export class AdminError extends Error {}

export interface EmailLogRow { id: string; job: string; ref: string; recipient: string; status: string; detail: string | null; created_at: string }

/** Last emails sent / skipped (owner only, RLS). The '*' rows are job claims. */
export async function fetchEmailLog(limit = 20): Promise<EmailLogRow[]> {
  if (demoAuth) return [];
  const { data, error } = await supabase.from('email_log').select('*').neq('recipient', '*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as EmailLogRow[];
}

/** Sends a test email to the owner's own address (cron Edge Function, job 'test'). */
export async function sendTestEmail(): Promise<void> {
  if (demoAuth) throw new AdminError('Emails need the real database (demo mode has no server).');
  const { error } = await supabase.functions.invoke('cron', { body: { job: 'test' } });
  if (!error) return;
  let j: { message?: string } = {};
  try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
  throw new AdminError(j.message ?? 'Could not send the test email.');
}

/* ---------------- saved report views ---------------- */

export interface ReportConfig { period: string; from?: string; to?: string; group: 'person' | 'day' | 'week'; metric: 'hours' | 'cost'; people: string[] }
export interface ReportView { id: string; name: string; config: ReportConfig; created_at: string }

const VK = 'shiftclock-demo-views';
const readViews = (): ReportView[] => { try { return JSON.parse(localStorage.getItem(VK) || '[]') as ReportView[]; } catch { return []; } };

export async function fetchViews(): Promise<ReportView[]> {
  if (demoAuth) return readViews();
  const { data, error } = await supabase.from('report_views').select('id, name, config, created_at').order('created_at');
  if (error) throw error;
  return (data ?? []) as ReportView[];
}
export async function saveView(name: string, config: ReportConfig): Promise<ReportView> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new AdminError('Give the view a name.');
  if (demoAuth) {
    const v = { id: crypto.randomUUID(), name: clean, config, created_at: new Date().toISOString() };
    localStorage.setItem(VK, JSON.stringify([...readViews(), v]));
    return v;
  }
  const { data, error } = await supabase.from('report_views').insert({ name: clean, config }).select('id, name, config, created_at').single();
  if (error) throw new AdminError('Could not save the view.');
  return data as ReportView;
}
export async function deleteView(id: string): Promise<void> {
  if (demoAuth) { localStorage.setItem(VK, JSON.stringify(readViews().filter((v) => v.id !== id))); return; }
  const { error } = await supabase.from('report_views').delete().eq('id', id);
  if (error) throw new AdminError('Could not delete the view.');
}
