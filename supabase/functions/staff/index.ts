// ShiftClock · Edge Function `staff` (PLAN.md section 10).
//
// Who may do what:
//   owner   → add employees, managers or another owner; new password for anyone
//   manager → add employees; new password for employees (forgotten passwords)
//
// POST { action: 'create', full_name, username, password, role, job_title, hourly_rate }
//   → makes a login "<username>@shiftclock.local". The role goes in app_metadata
//     (only the service role can write it), so the profile trigger trusts it.
// POST { action: 'password', user_id, password } → sets a new password.
//
// The service role key stays on the server. Every change is written to audit_log.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => json(status, { error: code, message });

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const USERNAME = /^[a-z0-9._-]{3,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who.user) return fail(401, 'signed_out', 'Sign in first.');
  const { data: me } = await admin.from('profiles').select('id, role, active').eq('id', who.user.id).maybeSingle();
  if (!me || !me.active || (me.role !== 'owner' && me.role !== 'manager')) return fail(403, 'not_allowed', 'Only the owner or a manager can add people or set passwords.');
  const isOwner = me.role === 'owner';

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Bad request.'); }
  const password = String(body.password ?? '');
  if (password.length < 8 || password.length > 72) return fail(400, 'weak_password', 'The password needs 8–72 characters.');

  if (body.action === 'create') {
    const username = String(body.username ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim().slice(0, 80);
    const role = body.role === 'owner' || body.role === 'manager' ? String(body.role) : 'employee';
    if (role !== 'employee' && !isOwner) return fail(403, 'not_allowed', 'Only the owner can add managers or owners.');
    const jobTitle = String(body.job_title ?? '').trim().slice(0, 60) || null;
    // pay rates are owner-only everywhere (profiles_guard_update), so a manager's new person starts without one
    const rate = !isOwner || body.hourly_rate === null || body.hourly_rate === undefined || body.hourly_rate === '' ? null : Number(body.hourly_rate);
    if (!USERNAME.test(username)) return fail(400, 'bad_username', 'Username: 3–32 small letters, numbers, dot, dash or underscore.');
    if (fullName.length < 2) return fail(400, 'bad_name', 'Type the full name.');
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 10000)) return fail(400, 'bad_rate', 'The rate must be between 0 and 10000.');

    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) return fail(409, 'username_taken', `The username "${username}" is already taken.`);

    const { data: made, error } = await admin.auth.admin.createUser({
      email: `${username}@shiftclock.local`,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { username, full_name: fullName, job_title: jobTitle },
    });
    if (error || !made.user) {
      const msg = /already|exists|registered/i.test(error?.message ?? '') ? `The username "${username}" is already taken.` : 'Could not add the person.';
      return fail(/already|exists|registered/i.test(error?.message ?? '') ? 409 : 500, 'create_failed', msg);
    }
    const id = made.user.id;
    // The auth service writes app_metadata after its insert, so the profile
    // trigger may not have made the profile yet: make (or finish) it here.
    const { data: has } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
    const { error: pErr } = has
      ? await admin.from('profiles').update({ hourly_rate: rate, job_title: jobTitle }).eq('id', id)
      : await admin.from('profiles').insert({ id, username, full_name: fullName, role, job_title: jobTitle, hourly_rate: rate });
    if (pErr) {
      await admin.auth.admin.deleteUser(id); // roll back: no login without a profile
      return fail(500, 'create_failed', 'Could not add the person.');
    }
    await admin.from('audit_log').insert({ actor_id: me.id, action: 'person.created', target_type: 'profile', target_id: id, before: null, after: { username, full_name: fullName, role, job_title: jobTitle, hourly_rate: rate } });
    return json(200, { id });
  }

  if (body.action === 'password') {
    const userId = String(body.user_id ?? '');
    if (!UUID.test(userId)) return fail(400, 'bad_request', 'Bad request.');
    const { data: target } = await admin.from('profiles').select('id, role').eq('id', userId).maybeSingle();
    if (!target) return fail(404, 'not_found', 'This person was not found.');
    if (!isOwner && target.role !== 'employee') return fail(403, 'not_allowed', 'A manager can only reset employee passwords. Ask the owner.');
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return fail(500, 'password_failed', 'Could not set the password.');
    await admin.from('audit_log').insert({ actor_id: me.id, action: 'person.password_set', target_type: 'profile', target_id: userId, before: null, after: null });
    return json(200, { ok: true });
  }

  return fail(400, 'bad_request', 'Unknown action.');
});
