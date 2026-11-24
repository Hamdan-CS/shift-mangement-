// ShiftClock · Edge Function `clock` (PLAN.md section 7).
//
// POST { action: 'token',  loc }                 → current rotating code (managers / owner, kiosk screen)
// POST { action: 'static', loc }                 → printed code, if the location allows it (managers / owner)
// POST { action: 'scan',   loc, t, lat?, lng?, accuracy? } → clock the signed-in person in or out
//
// Codes are HMAC-SHA256(location.qr_secret, "<loc>:<30-second window>") and are
// valid for 60 s; printed codes use "<loc>:static". The secret never leaves the
// server. QR time entries are written with the service role, so the app can't
// fake a scan through the REST API (migration 006).
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const PERIOD = 30; // seconds per rotating code
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: code, message, ...extra });

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  // 18 bytes → 24 base64url characters: short enough for a dense-free QR
  return btoa(String.fromCharCode(...mac.slice(0, 18))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** constant-time compare */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** metres between two points */
function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');

  // Who is calling? (the platform already checked the JWT; this gets the user)
  const auth = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who.user) return fail(401, 'signed_out', 'Sign in first.');

  let body: { action?: string; loc?: string; t?: string; lat?: number; lng?: number; accuracy?: number };
  try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Bad request.'); }
  const loc = String(body.loc ?? '');
  if (!UUID.test(loc)) return fail(400, 'bad_request', 'This QR code is not a ShiftClock code.');

  const [{ data: profile }, { data: location }] = await Promise.all([
    admin.from('profiles').select('id, full_name, role, active').eq('id', who.user.id).maybeSingle(),
    admin.from('locations').select('id, name, qr_secret, lat, lng, radius_m, allow_static, active').eq('id', loc).maybeSingle(),
  ]);
  if (!profile || !profile.active) return fail(403, 'not_member', 'Your account is not active. Ask the owner.');
  if (!location || !location.active) return fail(404, 'no_location', 'This workplace code is not in use any more.');
  const isManager = profile.role === 'owner' || profile.role === 'manager';
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / PERIOD);

  if (body.action === 'token') {
    if (!isManager) return fail(403, 'not_allowed', 'Only a manager can show the clock-in screen.');
    return json(200, { token: await sign(location.qr_secret, `${loc}:${win}`), expires_at: (win + 1) * PERIOD, period: PERIOD, server_time: now, name: location.name });
  }

  if (body.action === 'static') {
    if (!isManager) return fail(403, 'not_allowed', 'Only a manager can print the code.');
    if (!location.allow_static) return fail(409, 'static_off', 'Printed codes are switched off for this location.');
    return json(200, { token: await sign(location.qr_secret, `${loc}:static`), name: location.name });
  }

  if (body.action !== 'scan') return fail(400, 'bad_request', 'Unknown action.');

  // 1. the code: this window or the one before (valid 60 s), or the printed one
  const t = String(body.t ?? '');
  const valid =
    same(t, await sign(location.qr_secret, `${loc}:${win}`)) ||
    same(t, await sign(location.qr_secret, `${loc}:${win - 1}`)) ||
    (location.allow_static && same(t, await sign(location.qr_secret, `${loc}:static`)));
  if (!t || !valid) return fail(410, 'expired', 'This code has expired. Scan the code on the screen again.');

  // 2. optional GPS circle
  if (location.radius_m && location.lat !== null && location.lng !== null) {
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return fail(412, 'need_location', 'Allow location so we can check you are at work.', { radius_m: location.radius_m });
    }
    const slack = Math.min(Math.max(Number(body.accuracy) || 0, 0), 75);
    const d = distance(body.lat, body.lng, location.lat, location.lng);
    if (d > location.radius_m + slack) {
      return fail(422, 'too_far', `You seem to be ${Math.round(d)} m from ${location.name}. Move closer and scan again.`, { distance_m: Math.round(d) });
    }
  }

  // 3. Same person + same code within 2 minutes = a repeat (cameras often open
  //    the link twice, sometimes at the same moment). Claim the code first; the
  //    primary key makes the claim atomic, so only one request ever toggles.
  const DUP_MS = 2 * 60 * 1000;
  const nowIso = new Date().toISOString();
  let claimed = false;
  const ins = await admin.from('qr_scans').insert({ user_id: profile.id, token: t, location_id: loc, result: 'pending', at: nowIso });
  if (!ins.error) claimed = true;
  else if (ins.error.code === '23505') {
    // seen before: only reclaim it if the last use is older than 2 minutes (printed codes are reused daily)
    const re = await admin.from('qr_scans').update({ result: 'pending', at: nowIso, location_id: loc })
      .eq('user_id', profile.id).eq('token', t).lt('at', new Date(Date.now() - DUP_MS).toISOString()).select('user_id');
    claimed = !re.error && (re.data?.length ?? 0) > 0;
  } else {
    return fail(500, 'server', 'Could not check the code. Try again.');
  }
  if (!claimed) {
    // a repeat: give back what the first scan did
    let first = (await admin.from('qr_scans').select('result').eq('user_id', profile.id).eq('token', t).maybeSingle()).data?.result;
    if (first === 'pending') { await new Promise((r) => setTimeout(r, 900)); first = (await admin.from('qr_scans').select('result').eq('user_id', profile.id).eq('token', t).maybeSingle()).data?.result; }
    const { data: e } = await admin.from('time_entries').select('clock_in, clock_out').eq('user_id', profile.id).order('clock_in', { ascending: false }).limit(1).maybeSingle();
    const result = first === 'out' || first === 'in' ? first : (e && !e.clock_out ? 'in' : 'out');
    const at = result === 'out' ? (e?.clock_out ?? nowIso) : (e?.clock_in ?? nowIso);
    const minutes = result === 'out' && e?.clock_out ? Math.round((new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000) : undefined;
    return json(200, { result, at, minutes, location: location.name, repeat: true });
  }
  const remember = async (result: 'in' | 'out') => {
    await admin.from('qr_scans').update({ result }).eq('user_id', profile.id).eq('token', t);
    // keep the table small
    await admin.from('qr_scans').delete().lt('at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  };
  const release = () => admin.from('qr_scans').delete().eq('user_id', profile.id).eq('token', t).eq('result', 'pending');

  // 4. toggle: clock out if there is an open entry, otherwise clock in
  const { data: open } = await admin.from('time_entries').select('id, clock_in').eq('user_id', profile.id).is('clock_out', null).maybeSingle();
  if (open) {
    const out = new Date().toISOString();
    const { data, error } = await admin.from('time_entries').update({ clock_out: out }).eq('id', open.id).is('clock_out', null).select('clock_in, clock_out').maybeSingle();
    if (error || !data) { await release(); return fail(409, 'busy', 'That scan was already handled. Check your Home screen.'); }
    const minutes = Math.round((new Date(data.clock_out).getTime() - new Date(data.clock_in).getTime()) / 60000);
    await remember('out');
    return json(200, { result: 'out', at: data.clock_out, minutes, location: location.name });
  }
  const { data, error } = await admin.from('time_entries').insert({ user_id: profile.id, method: 'qr', location_id: loc }).select('clock_in').single();
  if (error) {
    await release();
    if (error.code === '23505') return fail(409, 'busy', "You're already clocked in.");
    return fail(500, 'server', 'Could not clock you in. Try again.');
  }
  await remember('in');
  return json(200, { result: 'in', at: data.clock_in, location: location.name });
});
