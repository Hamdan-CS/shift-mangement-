#!/usr/bin/env node
/**
 * Seed 1 owner, 1 manager and 3 employees (PLAN.md Phase 1).
 *
 *   npm run seed                    # creates missing users, leaves existing ones alone
 *   npm run seed -- --reset         # also gives existing seed users new passwords
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (service role is
 * never shipped to the browser). Passwords are random and written to
 * scripts/seed-credentials.local.md (gitignored).
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. Add them to .env.');
  process.exit(1);
}

const reset = process.argv.includes('--reset');
const DOMAIN = 'shiftclock.local';

// Same people as src/services/demo.ts so demo mode and a real project look alike.
const PEOPLE = [
  { username: 'owner', full_name: 'Sara Mansour', role: 'owner', job_title: 'Owner', hourly_rate: null },
  { username: 'manager', full_name: 'Omar Haddad', role: 'manager', job_title: 'Shift manager', hourly_rate: 45 },
  { username: 'ali', full_name: 'Ali Hassan', role: 'employee', job_title: 'Cashier', hourly_rate: 30 },
  { username: 'lina', full_name: 'Lina Farah', role: 'employee', job_title: 'Kitchen', hourly_rate: 32 },
  { username: 'yusuf', full_name: 'Yusuf Karim', role: 'employee', job_title: 'Front desk', hourly_rate: 28 },
];

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const newPassword = () => randomBytes(9).toString('base64url'); // 12 chars

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const rows = [];
for (const p of PEOPLE) {
  const email = `${p.username}@${DOMAIN}`;
  const existing = await findUserByEmail(email);
  let password = null;
  let id;

  if (!existing) {
    password = newPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: p.role },
      user_metadata: { username: p.username, full_name: p.full_name, job_title: p.job_title },
    });
    if (error) throw new Error(`${p.username}: ${error.message}`);
    id = data.user.id;
    console.log(`created  ${p.username.padEnd(8)} (${p.role})`);
  } else {
    id = existing.id;
    if (reset) {
      password = newPassword();
      const { error } = await admin.auth.admin.updateUserById(id, { password, app_metadata: { role: p.role } });
      if (error) throw new Error(`${p.username}: ${error.message}`);
      console.log(`reset    ${p.username.padEnd(8)} (${p.role})`);
    } else {
      console.log(`exists   ${p.username.padEnd(8)} (${p.role}) — run with --reset for a new password`);
    }
  }

  // The trigger created the profile; set role / pay with the service role.
  const { error: upErr } = await admin
    .from('profiles')
    .upsert({ id, username: p.username, full_name: p.full_name, role: p.role, job_title: p.job_title, hourly_rate: p.hourly_rate }, { onConflict: 'id' });
  if (upErr) throw new Error(`profile ${p.username}: ${upErr.message}`);

  rows.push({ ...p, password });
}

const { error: setErr } = await admin.from('settings').upsert({ id: 1, company_name: 'Cookiery PL', currency: 'PLN', timezone: 'Europe/Warsaw' });
if (setErr) throw new Error(`settings: ${setErr.message}`);

const created = rows.filter((r) => r.password);
if (created.length) {
  const out = fileURLToPath(new URL('./seed-credentials.local.md', import.meta.url));
  const md = [
    '# ShiftClock seed logins (local only, do not commit)',
    '',
    '| Username | Password | Role | Name |',
    '|---|---|---|---|',
    ...created.map((r) => `| ${r.username} | ${r.password} | ${r.role} | ${r.full_name} |`),
    '',
  ].join('\n');
  writeFileSync(out, md);
  console.log(`\nNew passwords written to ${out}`);
}
console.log('Done.');
