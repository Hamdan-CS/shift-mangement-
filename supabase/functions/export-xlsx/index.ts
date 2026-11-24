// ShiftClock · Edge Function `export-xlsx` (PLAN.md section 8b, managers / owner).
//
// POST { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', users?: uuid[] }
//   → ShiftClock_<Company>_<from>_<to>.xlsx with sheets:
//     Summary · Daily detail · Deductions · Leave · Corrections
//
// Data is read AS THE CALLER (their JWT), so RLS decides what is in the file;
// pay numbers come from pay_report / pay_days, the same as the app screens.
// The workbook itself is built in ../_shared/workbook.ts (also used by `cron`).
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { buildWorkbook } from '../_shared/workbook.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition',
};
const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: code, message }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');

  const db = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser();
  if (whoErr || !who.user) return fail(401, 'signed_out', 'Sign in first.');
  const { data: me } = await db.from('profiles').select('id, role, active').eq('id', who.user.id).maybeSingle();
  if (!me || !me.active || (me.role !== 'owner' && me.role !== 'manager')) return fail(403, 'not_allowed', 'Only a manager or the owner can download Excel files.');

  let body: { from?: string; to?: string; users?: string[] };
  try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Bad request.'); }
  const from = String(body.from ?? ''), to = String(body.to ?? '');
  if (!DAY.test(from) || !DAY.test(to) || to < from) return fail(400, 'bad_range', 'Pick a valid period.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) return fail(400, 'bad_range', 'The period can be at most a year.');
  const users = Array.isArray(body.users) ? body.users.filter((u) => UUID.test(String(u))) : [];

  try {
    const { bytes, filename } = await buildWorkbook(db, { from, to, users });
    return new Response(bytes, {
      headers: {
        ...cors,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return fail(500, 'query_failed', 'Could not read the hours.');
  }
});
