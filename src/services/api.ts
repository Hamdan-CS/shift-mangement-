/**
 * Data layer. Pages and components never call Supabase directly (Webloop rule):
 * everything goes through here so RLS errors, demo mode and shapes live in one place.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { Notification, Profile, PublicProfile, Settings, TimeEntry } from '@/types';
import { DEMO_PROFILES, DEMO_SETTINGS, demoEntries } from './demo';
import { onUserEvent } from './userChannel';

/* ---------- profiles ---------- */

/** The signed-in person's own full row (RLS: own row is always readable). */
export async function fetchProfileByUserId(uid: string): Promise<Profile | null> {
  if (demoAuth) return DEMO_PROFILES.find((p) => p.id === uid) ?? null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/** Everyone active, without pay fields (view `profiles_public`). */
export async function fetchTeam(): Promise<PublicProfile[]> {
  if (demoAuth) return DEMO_PROFILES.map(({ id, username, full_name, avatar_url, role, job_title, active }) => ({ id, username, full_name, avatar_url, role, job_title, active }));
  const { data, error } = await supabase.from('profiles_public').select('*').eq('active', true).order('full_name');
  if (error) throw error;
  return (data ?? []) as PublicProfile[];
}

/* ---------- settings ---------- */

export async function fetchSettings(): Promise<Settings | null> {
  if (demoAuth) return DEMO_SETTINGS;
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return (data as Settings | null) ?? null;
}

/** Owner: change company settings (RLS: owner only). */
export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  if (demoAuth) { Object.assign(DEMO_SETTINGS, patch); return DEMO_SETTINGS; }
  const { data, error } = await supabase.from('settings').update(patch).eq('id', 1).select('*').single();
  if (error) throw error;
  return data as Settings;
}

/* ---------- time entries (Phase 2) ----------
 * Times are always set by the database (see migration 004); whatever the
 * phone sends for clock_in / clock_out is replaced with server time.
 */

/** Thrown when an action is refused; `message` is safe to show. */
export class ClockError extends Error {}

function clockError(e: { code?: string; message: string }): ClockError {
  if (e.code === '23505') return new ClockError("You're already clocked in.");
  if (e.code === '42501') return new ClockError(e.message);
  return new ClockError('Could not reach the server. Check your connection and try again.');
}

/** Your open entry (clocked in, not out yet), if any. */
export async function fetchOpenEntry(userId: string): Promise<TimeEntry | null> {
  if (demoAuth) return demoEntries.all().find((e) => e.user_id === userId && !e.clock_out) ?? null;
  const { data, error } = await supabase.from('time_entries').select('*').eq('user_id', userId).is('clock_out', null).maybeSingle();
  if (error) throw error;
  return (data as TimeEntry | null) ?? null;
}

/** Entries that overlap [from, to), newest first. RLS limits employees to their own. */
export async function fetchEntries(userId: string, from: Date, to: Date): Promise<TimeEntry[]> {
  if (demoAuth) {
    return demoEntries.all()
      .filter((e) => e.user_id === userId && new Date(e.clock_in) < to && (e.clock_out ? new Date(e.clock_out) : new Date()) > from)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in));
  }
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .lt('clock_in', to.toISOString())
    .or(`clock_out.is.null,clock_out.gt.${from.toISOString()}`)
    .order('clock_in', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

/** Start shift. */
export async function clockIn(userId: string): Promise<TimeEntry> {
  if (demoAuth) {
    const list = demoEntries.all();
    if (list.some((e) => e.user_id === userId && !e.clock_out)) throw new ClockError("You're already clocked in.");
    const now = new Date().toISOString();
    const entry: TimeEntry = { id: crypto.randomUUID(), user_id: userId, clock_in: now, clock_out: null, method: 'button', location_id: null, break_minutes: 0, note: null, edited: false, created_at: now };
    demoEntries.save([entry, ...list]);
    return entry;
  }
  const { data, error } = await supabase.from('time_entries').insert({ user_id: userId, method: 'button' }).select('*').single();
  if (error) throw clockError(error);
  return data as TimeEntry;
}

/** Finish shift. The server stamps the time. */
export async function clockOut(entry: TimeEntry): Promise<TimeEntry> {
  if (demoAuth) {
    const list = demoEntries.all();
    const i = list.findIndex((e) => e.id === entry.id && !e.clock_out);
    if (i < 0) throw new ClockError("You're not clocked in.");
    list[i] = { ...list[i], clock_out: new Date().toISOString() };
    demoEntries.save(list);
    return list[i];
  }
  const { data, error } = await supabase
    .from('time_entries')
    .update({ clock_out: new Date().toISOString() })
    .eq('id', entry.id)
    .is('clock_out', null)
    .select('*')
    .maybeSingle();
  if (error) throw clockError(error);
  if (!data) throw new ClockError("You're not clocked in any more. Pull to refresh.");
  return data as TimeEntry;
}

/* ---------- notifications (Phase 5) ----------
 * Created only by the database (migration 008). Each new one pings the
 * private Realtime channel "user:<id>", so the bell can update live.
 */

const NK = 'shiftclock-demo-notifications';
export const demoNotifications = {
  all(): Notification[] { try { return JSON.parse(localStorage.getItem(NK) || '[]') as Notification[]; } catch { return []; } },
  save(l: Notification[]) { try { localStorage.setItem(NK, JSON.stringify(l)); } catch { /* storage unavailable */ } window.dispatchEvent(new Event('shiftclock-notify')); },
  add(n: Omit<Notification, 'id' | 'read_at' | 'created_at'>) { this.save([{ ...n, id: crypto.randomUUID(), read_at: null, created_at: new Date().toISOString() }, ...this.all()]); },
};

export async function fetchNotifications(profileId: string, limit = 50): Promise<Notification[]> {
  if (demoAuth) return demoNotifications.all().filter((n) => n.recipient_id === profileId).slice(0, limit);
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function fetchUnreadNotificationCount(profileId: string): Promise<number> {
  if (demoAuth) return demoNotifications.all().filter((n) => n.recipient_id === profileId && !n.read_at).length;
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  if (demoAuth) { demoNotifications.save(demoNotifications.all().map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))); return; }
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  if (demoAuth) { demoNotifications.save(demoNotifications.all().map((n) => (n.recipient_id === profileId && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))); return; }
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
}

/** Live bell: calls back when a new notification arrives for this person. Returns unsubscribe. */
export function subscribeNotifications(profileId: string, onNew: () => void): () => void {
  return onUserEvent(profileId, 'notification', () => onNew());
}
