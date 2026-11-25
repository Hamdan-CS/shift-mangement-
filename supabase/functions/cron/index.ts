// ShiftClock · Edge Function `cron` (PLAN.md section 9, Phase 8).
//
// Called every 5 minutes by pg_cron (migration 013) with the shared secret
// from Vault in `x-cron-secret`. Each tick, in company time:
//   instant       → emails for new notifications (approval needed, request result,
//                   shift changed, shift closed automatically)
//   daily         → each person who worked today: in/out, hours, earned   (settings.daily_email_time)
//   staff_weekly  → each person who worked this week: hours per day, total, gross, net (weekly time)
//   owner_daily   → owner + managers + report_recipients, Excel of the day (settings.owner_daily_time)
//   owner_weekly  → the same for the whole week, Excel attached          (weekly_email_dow / _time)
//   reminder      → people who haven't submitted next week (deadline day, reminder_time)
//   missing       → managers: who still hasn't submitted (after the deadline)
// Every scheduled job is claimed once in email_log, so a tick that runs twice
// never sends twice. Sends through Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) or
// Resend (RESEND_API_KEY); with neither, emails are logged as skipped
// (in-app notifications still happen).
//
// The owner can also call it signed in with { job: 'test' } to get a test email.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@6.9.16';
import { Buffer } from 'node:buffer';
import { buildWorkbook } from '../_shared/workbook.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';
// Gmail (preferred when set): GMAIL_USER + GMAIL_APP_PASSWORD (a Google App password).
// Port 465 because Supabase blocks outgoing 25 and 587.
const GMAIL_USER = (Deno.env.get('GMAIL_USER') ?? '').trim();
const GMAIL_PASS = (Deno.env.get('GMAIL_APP_PASSWORD') ?? '').replace(/\s+/g, '');
const gmail = GMAIL_USER && GMAIL_PASS ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } }) : null;
const MAIL_ON = Boolean(gmail || RESEND);
const MAILER = gmail ? 'gmail' : RESEND ? 'resend' : 'no key';
const FROM = Deno.env.get('EMAIL_FROM') ?? 'ShiftClock <onboarding@resend.dev>';
const APP = (Deno.env.get('APP_URL') ?? 'https://shiftclock-web-d448.vercel.app').replace(/\/$/, '');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
interface Settings {
  company_name: string; currency: string; timezone: string; emails_enabled: boolean;
  daily_email_time: string; owner_daily_time: string; weekly_email_dow: number; weekly_email_time: string;
  reminder_time: string; schedule_deadline_dow: number; schedule_deadline_time: string; report_recipients: string[];
}

/* ---------------- time helpers (company timezone) ---------------- */
function nowIn(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, dow: new Date(`${date}T12:00:00Z`).getUTCDay(), minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const hm = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '—');
const hours = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/* ---------------- email ---------------- */
function page(title: string, intro: string, inner: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f1115">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #ebecef;border-radius:18px">
<tr><td style="padding:24px 24px 8px"><div style="font-size:13px;font-weight:600;color:#2f5bea">ShiftClock</div>
<h1 style="margin:6px 0 4px;font-size:22px;letter-spacing:-.02em">${esc(title)}</h1>
<p style="margin:0;color:#565c69;font-size:14px;line-height:1.5">${intro}</p></td></tr>
<tr><td style="padding:16px 24px 8px">${inner}</td></tr>
${cta ? `<tr><td style="padding:8px 24px 24px"><a href="${cta.href}" style="display:inline-block;background:#2f5bea;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:10px">${esc(cta.label)}</a></td></tr>` : ''}
</table><p style="color:#8b909b;font-size:12px;margin:14px 0 0">Sent by ShiftClock. Times are in company time. Change which emails you get under My settings.</p></td></tr></table></body></html>`;
}
function table(head: string[], rows: (string | number)[][], right: number[] = []) {
  const th = head.map((h, i) => `<th style="text-align:${right.includes(i) ? 'right' : 'left'};font-size:12px;font-weight:500;color:#8b909b;padding:8px 6px;border-bottom:1px solid #ebecef">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${right.includes(i) ? 'right' : 'left'};font-size:13px;padding:8px 6px;border-bottom:1px solid #f1f2f4">${c}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

async function log(job: string, ref: string, recipient: string, status: string, detail?: string) {
  await admin.from('email_log').upsert({ job, ref, recipient, status, detail: detail?.slice(0, 500) ?? null }, { onConflict: 'job,ref,recipient' });
}
/** First caller wins: true when this tick should run (job, ref). */
async function claim(job: string, ref: string) {
  const { error } = await admin.from('email_log').insert({ job, ref, recipient: '*', status: 'claimed' });
  return !error;
}

async function send(s: Settings, job: string, ref: string, to: string[], subject: string, html: string, attachment?: { filename: string; bytes: Uint8Array }) {
  const list = [...new Set(to.map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && !x.endsWith('@shiftclock.local')))];
  if (!list.length) return 0;
  if (!s.emails_enabled) { for (const r of list) await log(job, ref, r, 'skipped', 'emails switched off in Settings'); return 0; }
  if (!MAIL_ON) { for (const r of list) await log(job, ref, r, 'skipped', 'no email service: set GMAIL_USER + GMAIL_APP_PASSWORD (or RESEND_API_KEY)'); return 0; }
  let sent = 0;
  for (const r of list) {
    if (gmail) {
      try {
        await gmail.sendMail({ from: { name: s.company_name || 'ShiftClock', address: GMAIL_USER }, to: r, subject, html, attachments: attachment ? [{ filename: attachment.filename, content: Buffer.from(attachment.bytes) }] : undefined });
        sent++; await log(job, ref, r, 'sent', 'gmail');
      } catch (e) { await log(job, ref, r, 'failed', `gmail: ${e instanceof Error ? e.message : String(e)}`); }
      continue;
    }
    const body: Row = { from: FROM, to: [r], subject, html };
    if (attachment) {
      let bin = '';
      for (let i = 0; i < attachment.bytes.length; i += 0x8000) bin += String.fromCharCode(...attachment.bytes.subarray(i, i + 0x8000));
      body.attachments = [{ filename: attachment.filename, content: btoa(bin) }];
    }
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { sent++; await log(job, ref, r, 'sent'); } else await log(job, ref, r, 'failed', `${res.status} ${await res.text()}`);
  }
  return sent;
}

/* ---------------- data ---------------- */
async function people() {
  const { data } = await admin.from('profiles').select('id, full_name, role, active, notify_email, hourly_rate, email_daily, email_weekly').eq('active', true);
  return (data ?? []) as Row[];
}
function managersTo(ps: Row[], s: Settings) {
  return [...ps.filter((p) => p.role !== 'employee').map((p) => p.notify_email ?? ''), ...(s.report_recipients ?? [])];
}
const moneyF = (s: Settings) => (n: number) => new Intl.NumberFormat(s.currency === 'PLN' ? 'pl-PL' : 'en-GB', { style: 'currency', currency: s.currency }).format(n);

/* ---------------- jobs ---------------- */
function describe(n: Row, tz: string): { subject: string; text: string; path: string; label: string } {
  const p = n.payload ?? {};
  const kind = p.kind === 'leave' ? 'leave request' : 'time correction';
  switch (n.type) {
    case 'correction.requested': return { subject: `Approval needed: ${p.employee_name ?? 'someone'} asked to fix a clock time`, text: `${esc(p.employee_name ?? 'Someone')} asked to correct a clock time.`, path: '/admin/approvals', label: 'Review request' };
    case 'leave.requested': return { subject: `Approval needed: ${p.employee_name ?? 'someone'} requested leave`, text: `${esc(p.employee_name ?? 'Someone')} requested leave.`, path: '/admin/approvals', label: 'Review request' };
    case 'request.approved': return { subject: `Your ${kind} was approved`, text: `${esc(p.reviewer_name ?? 'Your manager')} approved your ${kind}.${p.review_note ? ` Note: ${esc(p.review_note)}` : ''}`, path: p.kind === 'leave' ? '/leave' : '/history', label: 'Open ShiftClock' };
    case 'request.declined': return { subject: `Your ${kind} was declined`, text: `${esc(p.reviewer_name ?? 'Your manager')} declined your ${kind}.${p.review_note ? ` Note: ${esc(p.review_note)}` : ''}`, path: p.kind === 'leave' ? '/leave' : '/history', label: 'Open ShiftClock' };
    case 'schedule.changed': return { subject: 'Your shift was changed', text: `${esc(p.editor_name ?? 'A manager')} ${p.change === 'delete' ? 'removed your shift' : p.change === 'insert' ? 'added a shift' : 'changed your shift'} on ${p.date ? longDay(p.date) : 'a day'}${p.change !== 'delete' && p.start ? ` (${esc(p.start)}–${esc(p.end)})` : ''}.`, path: '/schedule', label: 'View schedule' };
    case 'shift.auto_closed': return { subject: 'Your shift was closed automatically', text: `You didn't finish your shift that started at ${hm(p.clock_in, tz)}, so it was closed after ${esc(p.hours)} hours. If that's wrong, request a correction.`, path: '/history', label: 'Request a correction' };
    case 'schedule.missing': return { subject: typeof p.count === 'number' ? `${p.count} people haven't submitted next week` : "Submit next week's schedule", text: typeof p.count === 'number' ? `${p.count} people haven't submitted their schedule for next week.` : "You haven't submitted next week's schedule yet.", path: typeof p.count === 'number' ? '/admin/schedule' : '/schedule', label: 'Open schedule' };
    default: return { subject: 'ShiftClock notification', text: 'You have a new notification.', path: '/', label: 'Open ShiftClock' };
  }
}

async function instant(s: Settings) {
  const { data } = await admin.from('notifications').select('id, recipient_id, type, payload, created_at')
    .is('emailed_at', null).gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).order('created_at').limit(50);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return 0;
  await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', rows.map((r) => r.id));
  const { data: ps } = await admin.from('profiles').select('id, notify_email').in('id', [...new Set(rows.map((r) => r.recipient_id))]);
  const mail = new Map((ps ?? []).map((p: Row) => [p.id, p.notify_email]));
  let n = 0;
  for (const r of rows) {
    const to = mail.get(r.recipient_id);
    if (!to) continue;
    const d = describe(r, s.timezone);
    n += await send(s, 'instant', r.id, [to], d.subject, page(d.subject, d.text, '', { href: APP + d.path, label: d.label }));
  }
  return n;
}

async function daily(s: Settings, date: string, only?: string, ref = date) {
  const [{ data: days }, ps] = await Promise.all([admin.rpc('pay_days', { p_from: date, p_to: date }), people()]);
  const money = moneyF(s);
  let n = 0;
  for (const d of (days ?? []) as Row[]) {
    const p = ps.find((x) => x.id === d.user_id);
    if (!p?.notify_email || p.email_daily === false || (only && p.id !== only)) continue;
    const earned = (Number(p.hourly_rate ?? 0) * d.minutes) / 60;
    const inner = table(['', ''], [['Clock in', hm(d.first_in, s.timezone)], ['Clock out', d.last_out ? hm(d.last_out, s.timezone) : 'still working'], ['Break', `${d.break_minutes} min`], ['Hours', `<b>${hours(d.minutes)}</b>`], ['Earned today', `<b>${money(earned)}</b>`]], [1]);
    n += await send(s, 'daily', ref, [p.notify_email], `Your day: ${hours(d.minutes)}`, page(`Your day, ${longDay(date)}`, `Here is today at ${esc(s.company_name)}. Something wrong? Ask for a correction.`, inner, { href: `${APP}/history`, label: 'Request a correction' }));
  }
  return n;
}

async function staffWeekly(s: Settings, from: string, to: string, only?: string, ref = from) {
  const [{ data: rep }, { data: days }, ps] = await Promise.all([admin.rpc('pay_report', { p_from: from, p_to: to }), admin.rpc('pay_days', { p_from: from, p_to: to }), people()]);
  const money = moneyF(s);
  let n = 0;
  for (const r of (rep ?? []) as Row[]) {
    const p = ps.find((x) => x.id === r.user_id);
    if (!p?.notify_email || p.email_weekly === false || !r.worked_minutes || (only && p.id !== only)) continue;
    const mine = ((days ?? []) as Row[]).filter((d) => d.user_id === r.user_id);
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(from, i);
      const d = mine.find((x) => x.day === day);
      const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      rows.push(d ? [label, `${hm(d.first_in, s.timezone)} – ${d.last_out ? hm(d.last_out, s.timezone) : 'now'}`, hours(d.minutes), money((Number(r.rate ?? 0) * d.minutes) / 60)] : [label, '—', '—', '—']);
    }
    rows.push(['<b>Total</b>', '', `<b>${hours(r.worked_minutes)}</b>`, `<b>${money(Number(r.gross))}</b>`]);
    const sumUp = table(['', ''], [
      ...(r.overtime_minutes ? [['Overtime', hours(r.overtime_minutes)]] : []),
      ['Gross', money(Number(r.gross))],
      ...(Number(r.deductions) ? [['Deductions', `−${money(Number(r.deductions))}`]] : []),
      ['Net pay', `<b>${money(Number(r.net))}</b>`],
    ], [1]);
    n += await send(s, 'staff_weekly', ref, [p.notify_email], `Your week: ${hours(r.worked_minutes)}, net ${money(Number(r.net))}`,
      page(`Your week, ${from} to ${to}`, `Here are your hours at ${esc(s.company_name)}. Something wrong? Ask for a correction.`, table(['Day', 'In – out', 'Hours', 'Earned'], rows, [2, 3]) + '<div style="height:14px"></div>' + sumUp, { href: `${APP}/pay`, label: 'Open my pay' }));
  }
  return n;
}

async function ownerReport(s: Settings, job: 'owner_daily' | 'owner_weekly', from: string, to: string) {
  const ps = await people();
  const recipients = managersTo(ps, s);
  if (!recipients.some(Boolean)) { await log(job, from, '*none*', 'skipped', 'no email addresses for owner / managers / report recipients'); return 0; }
  const [{ data: rep }, { count: corrections }, { count: leave }, { data: shifts }, { data: days }] = await Promise.all([
    admin.rpc('pay_report', { p_from: from, p_to: to }),
    admin.from('corrections').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('schedule_shifts').select('user_id, start_time, end_time').gte('date', from).lte('date', to),
    admin.rpc('pay_days', { p_from: from, p_to: to }),
  ]);
  const money = moneyF(s);
  const rows = ((rep ?? []) as Row[]).filter((r) => r.role !== 'owner' || r.worked_minutes > 0);
  const planned = (uid: string) => ((shifts ?? []) as Row[]).filter((x) => x.user_id === uid).reduce((m, x) => m + toMin(x.end_time) - toMin(x.start_time), 0);
  const firstIn = (uid: string) => ((days ?? []) as Row[]).find((d) => d.user_id === uid);
  const single = from === to;
  const head = single ? ['Person', 'Planned', 'In – out', 'Hours', 'Earned', 'Status'] : ['Person', 'Planned', 'Hours', 'Overtime', 'Gross', 'Deductions', 'Net'];
  const body = rows.map((r) => {
    const status = r.late_count ? '<span style="color:#b7791f">Late</span>' : r.absent_count ? '<span style="color:#e0383e">Absent</span>' : r.leave_days ? 'On leave' : r.worked_minutes ? 'OK' : '—';
    const d = firstIn(r.user_id);
    return single
      ? [esc(r.full_name), hours(planned(r.user_id)), d ? `${hm(d.first_in, s.timezone)} – ${d.last_out ? hm(d.last_out, s.timezone) : 'now'}` : '—', hours(r.worked_minutes), money(Number(r.gross)), status]
      : [esc(r.full_name), hours(planned(r.user_id)), hours(r.worked_minutes), hours(r.overtime_minutes), money(Number(r.gross)), money(Number(r.deductions)), `<b>${money(Number(r.net))}</b>`];
  });
  const tot = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  body.push(single
    ? ['<b>Total</b>', '', '', `<b>${hours(tot('worked_minutes'))}</b>`, `<b>${money(tot('gross'))}</b>`, '']
    : ['<b>Total</b>', '', `<b>${hours(tot('worked_minutes'))}</b>`, `<b>${hours(tot('overtime_minutes'))}</b>`, `<b>${money(tot('gross'))}</b>`, `<b>${money(tot('deductions'))}</b>`, `<b>${money(tot('net'))}</b>`]);
  const late = rows.reduce((a, r) => a + r.late_count, 0), absent = rows.reduce((a, r) => a + r.absent_count, 0);
  const intro = `${single ? longDay(from) : `Week ${from} to ${to}`} · ${esc(s.company_name)}. ${late} late, ${absent} absent, ${(corrections ?? 0) + (leave ?? 0)} requests waiting for approval. The Excel file has the full detail.`;
  const inner = table(head, body, single ? [1, 3, 4] : [1, 2, 3, 4, 5, 6]);
  const file = await buildWorkbook(admin, { from, to });
  const subject = single ? `Daily report ${from}: ${hours(tot('worked_minutes'))}, ${money(tot('gross'))}` : `Weekly report ${from} – ${to}: net ${money(tot('net'))}`;
  return send(s, job, from, recipients, subject, page(single ? 'Daily report' : 'Weekly report', intro, inner, { href: `${APP}/admin/${single ? 'timesheets' : 'payroll'}`, label: single ? 'Open timesheets' : 'Open payroll' }), file);
}

/** People (employees + managers) whose week starting `week` isn't submitted yet. */
async function notSubmitted(week: string) {
  const [ps, { data: weeks }] = await Promise.all([people(), admin.from('schedule_weeks').select('user_id, status').eq('week_start', week)]);
  const done = new Set(((weeks ?? []) as Row[]).filter((w) => w.status !== 'draft').map((w) => w.user_id));
  return ps.filter((p) => p.role !== 'owner' && !done.has(p.id));
}

async function reminder(s: Settings, week: string) {
  const late = await notSubmitted(week);
  const deadline = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.schedule_deadline_dow]} ${s.schedule_deadline_time.slice(0, 5)}`;
  if (late.length) await admin.from('notifications').insert(late.map((p) => ({ recipient_id: p.id, type: 'schedule.missing', payload: { week_start: week }, emailed_at: new Date().toISOString() })));
  let n = 0;
  for (const p of late) {
    if (!p.notify_email) continue;
    n += await send(s, 'reminder', week, [p.notify_email], "Submit next week's schedule", page("Submit next week's schedule", `Please plan your shifts for the week of ${longDay(week)} before ${esc(deadline)} today.`, '', { href: `${APP}/schedule`, label: 'Plan my week' }));
  }
  return n;
}

async function missing(s: Settings, week: string) {
  const late = await notSubmitted(week);
  if (!late.length) return 0;
  const ps = await people();
  const mgrs = ps.filter((p) => p.role !== 'employee');
  await admin.from('notifications').insert(mgrs.map((p) => ({ recipient_id: p.id, type: 'schedule.missing', payload: { count: late.length, week_start: week }, emailed_at: new Date().toISOString() })));
  const inner = table(['Not submitted'], late.map((p) => [esc(p.full_name)]));
  return send(s, 'missing', week, mgrs.map((p) => p.notify_email ?? ''), `${late.length} people haven't submitted next week`, page('Schedules missing', `The deadline has passed for the week of ${longDay(week)}.`, inner, { href: `${APP}/admin/schedule`, label: 'Open schedule' }));
}

/* ---------------- entry ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' });
  let body: { job?: string; [k: string]: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).single();
  const s = settings as Settings;

  // owner test email (signed in, no cron secret)
  const secret = req.headers.get('x-cron-secret');
  if (!secret) {
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: who } = await asUser.auth.getUser();
    if (!who.user) return json(401, { message: 'Sign in first.' });
    const { data: me } = await admin.from('profiles').select('role, notify_email, full_name').eq('id', who.user.id).single();
    if (me?.role !== 'owner') return json(403, { message: 'Only the owner can send a test email.' });
    if (body.job !== 'test') return json(400, { message: 'Unknown action.' });
    if (!me.notify_email) return json(400, { message: 'Add your email address under My settings first.' });
    if (!MAIL_ON) return json(409, { message: 'Emails are not set up yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Supabase secrets.' });
    const ref = `test-${Date.now()}`;
    const n = await send({ ...s, emails_enabled: true }, 'test', ref, [me.notify_email], 'ShiftClock test email', page('It works', `Hi ${esc(me.full_name)}, emails from ShiftClock reach you.`, ''));
    return n ? json(200, { ok: true }) : json(502, { message: 'The email service refused it. Check the Gmail app password (or EMAIL_FROM and your Resend domain).' });
  }
  const { data: ok } = await admin.rpc('check_cron_secret', { p_secret: secret });
  if (ok !== true) return json(403, { message: 'Bad secret.' });

  const t = nowIn(s.timezone);
  // test one person's daily + weekly hours emails (cron secret only): { job: 'preview', user_id, date }
  if (body.job === 'preview') {
    const b = body as { user_id?: string; date?: string };
    if (!b.user_id) return json(400, { message: 'user_id is required.' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') ? b.date! : t.date;
    const week = mondayOf(date), ref = `test-${Date.now()}`;
    return json(200, { daily: await daily(s, date, b.user_id, ref), weekly: await staffWeekly(s, week, addDays(week, 6), b.user_id, ref), email: MAILER, gmail_user: GMAIL_USER.replace(/^(.).*(@.*)$/, '$1…$2'), app_password_length: GMAIL_PASS.length });
  }
  const done: Record<string, number | string> = {};
  try {
    done.instant = await instant(s);
    if (t.minutes >= toMin(s.daily_email_time) && await claim('daily', t.date)) done.daily = await daily(s, t.date);
    if (t.minutes >= toMin(s.owner_daily_time) && await claim('owner_daily', t.date)) done.owner_daily = await ownerReport(s, 'owner_daily', t.date, t.date);
    const week = mondayOf(t.date);
    if (t.dow === s.weekly_email_dow && t.minutes >= toMin(s.weekly_email_time) && await claim('owner_weekly', week)) done.owner_weekly = await ownerReport(s, 'owner_weekly', week, addDays(week, 6));
    if (t.dow === s.weekly_email_dow && t.minutes >= toMin(s.weekly_email_time) && await claim('staff_weekly', week)) done.staff_weekly = await staffWeekly(s, week, addDays(week, 6));
    const next = addDays(week, 7);
    if (t.dow === s.schedule_deadline_dow) {
      const dl = toMin(s.schedule_deadline_time);
      if (t.minutes >= toMin(s.reminder_time) && t.minutes < dl && await claim('reminder', next)) done.reminder = await reminder(s, next);
      if (t.minutes >= dl && await claim('missing', next)) done.missing = await missing(s, next);
    }
  } catch (e) {
    done.error = e instanceof Error ? e.message : String(e);
  }
  return json(200, { at: t, done, email: MAILER });
});
