/**
 * Locations + QR clock-in data layer (Phase 4). The `clock` Edge Function
 * makes and checks codes; the location's secret never reaches the browser.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import type { Location } from '@/types';
import { DEMO_SETTINGS, demoEntries, demoSession } from './demo';

const LOC_COLUMNS = 'id, name, lat, lng, radius_m, allow_static, active, created_at';

export class QrError extends Error {
  constructor(message: string, public code: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/* ---------------- locations ---------------- */

const LK = 'shiftclock-demo-locations';
const readDemo = (): Location[] => { try { return JSON.parse(localStorage.getItem(LK) || '[]') as Location[]; } catch { return []; } };
const writeDemo = (l: Location[]) => { try { localStorage.setItem(LK, JSON.stringify(l)); } catch { /* storage unavailable */ } };

export async function fetchLocations(): Promise<Location[]> {
  if (demoAuth) return readDemo();
  const { data, error } = await supabase.from('locations').select(LOC_COLUMNS).order('name');
  if (error) throw error;
  return (data ?? []) as Location[];
}

export async function fetchLocation(id: string): Promise<Location | null> {
  if (demoAuth) return readDemo().find((l) => l.id === id) ?? null;
  const { data, error } = await supabase.from('locations').select(LOC_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Location | null) ?? null;
}

export type LocationInput = Pick<Location, 'name' | 'lat' | 'lng' | 'radius_m' | 'allow_static' | 'active'>;

export async function saveLocation(input: LocationInput, id?: string): Promise<Location> {
  const clean: LocationInput = { ...input, name: input.name.trim(), radius_m: input.lat === null ? null : input.radius_m };
  if (demoAuth) {
    const all = readDemo();
    const row: Location = { id: id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...clean };
    writeDemo(id ? all.map((l) => (l.id === id ? row : l)) : [...all, row]);
    return row;
  }
  const q = id
    ? supabase.from('locations').update(clean).eq('id', id).select(LOC_COLUMNS).single()
    : supabase.from('locations').insert(clean).select(LOC_COLUMNS).single();
  const { data, error } = await q;
  if (error) throw new QrError(error.code === '42501' ? 'Only the owner can change locations.' : 'Could not save the location.', error.code ?? 'db');
  return data as Location;
}

export async function deleteLocation(id: string): Promise<void> {
  if (demoAuth) { writeDemo(readDemo().filter((l) => l.id !== id)); return; }
  const { error } = await supabase.from('locations').delete().eq('id', id);
  if (error) throw new QrError('Could not delete the location.', error.code ?? 'db');
}

/* ---------------- codes ---------------- */

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('clock', { body });
  if (!error) return data as T;
  let j: { error?: string; message?: string } & Record<string, unknown> = {};
  try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
  if (j.error) throw new QrError(j.message ?? 'Something went wrong.', j.error, j);
  throw new QrError('No connection. Check your signal and try again.', 'offline');
}

export interface KioskToken { token: string; expires_at: number; period: number; server_time: number; name: string }

/** Current rotating code for the kiosk screen (managers / owner). */
export async function fetchKioskToken(loc: string): Promise<KioskToken> {
  if (demoAuth) {
    const now = Math.floor(Date.now() / 1000), win = Math.floor(now / 30);
    return { token: `demo-${win}`, expires_at: (win + 1) * 30, period: 30, server_time: now, name: readDemo().find((l) => l.id === loc)?.name ?? 'Workplace' };
  }
  return invoke<KioskToken>({ action: 'token', loc });
}

/** Printed (static) code, if the location allows it. */
export async function fetchStaticToken(loc: string): Promise<{ token: string; name: string }> {
  if (demoAuth) return { token: 'demo-static', name: readDemo().find((l) => l.id === loc)?.name ?? 'Workplace' };
  return invoke({ action: 'static', loc });
}

/** The link a code opens on the phone. */
export function clockUrl(loc: string, token: string): string {
  const base = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin;
  return `${base}/clock?loc=${encodeURIComponent(loc)}&t=${encodeURIComponent(token)}`;
}

export interface ScanResult { result: 'in' | 'out'; at: string; minutes?: number; location: string; repeat?: boolean }

/** Scan: the server checks the code (and GPS) and clocks you in or out. */
export async function scanCode(loc: string, t: string, pos?: { lat: number; lng: number; accuracy: number }): Promise<ScanResult> {
  if (demoAuth) {
    const user = demoSession.get();
    if (!user) throw new QrError('Sign in first.', 'signed_out');
    if (!t.startsWith('demo')) throw new QrError('This code has expired. Scan the code on the screen again.', 'expired');
    const l = readDemo().find((x) => x.id === loc);
    if (!l) throw new QrError('This workplace code is not in use any more.', 'no_location');
    const all = demoEntries.all();
    const open = all.find((e) => e.user_id === user.id && !e.clock_out);
    const now = new Date().toISOString();
    if (open) {
      open.clock_out = now;
      demoEntries.save(all);
      return { result: 'out', at: now, minutes: Math.round((Date.parse(now) - Date.parse(open.clock_in)) / 60000), location: l.name };
    }
    demoEntries.save([{ id: crypto.randomUUID(), user_id: user.id, clock_in: now, clock_out: null, method: 'qr', location_id: loc, break_minutes: 0, note: null, edited: false, created_at: now }, ...all]);
    return { result: 'in', at: now, location: l.name };
  }
  return invoke<ScanResult>({ action: 'scan', loc, t, ...(pos ?? {}) });
}

/** Ask the phone for its position (for locations with a GPS circle). */
export function currentPosition(timeout = 12_000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new QrError('This phone cannot share its location.', 'no_gps')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new QrError(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it for this site in your browser settings, then try again.' : 'Could not find your location. Try again near a window or outside.', 'no_gps')),
      { enableHighAccuracy: true, timeout, maximumAge: 15_000 },
    );
  });
}

/** Demo default: one location so the kiosk and /clock can be tried without Supabase. */
export function seedDemoLocation() {
  if (demoAuth && !readDemo().length) writeDemo([{ id: '00000000-0000-4000-8000-00000000d001', name: `${DEMO_SETTINGS.company_name} · Main door`, lat: null, lng: null, radius_m: null, allow_static: true, active: true, created_at: new Date().toISOString() }]);
}
