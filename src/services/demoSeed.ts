/**
 * Marketing demo (dev only, VITE_DEMO_AUTH=1 + VITE_DEMO_SEED=cookiery): fills
 * the browser's demo stores with a believable Cookiery PL fortnight so the
 * guide's screenshots look real. Two weeks of clock-ins, this week's (and
 * last/next week's) schedules, one pending correction, one pending leave
 * request, one late arrival today, two people off today, one deduction.
 * Re-seeds once per day; never touches a database.
 */
import { DEMO_SETTINGS } from './demo';
import { dayKey, zoned } from '@/utils/tz';
import type { Correction, LeaveRequest, Location, Notification, ScheduleShift, ScheduleWeek, TimeEntry } from '@/types';

const TZ = DEMO_SETTINGS.timezone;
const MARK = 'shiftclock-demo-seeded';
const KEYS = ['entries', 'shifts', 'weeks', 'corrections', 'leave', 'deductions', 'locations', 'notifications', 'payreq', 'convos', 'messages', 'reads', 'views'];

/** weekday (0 = Monday) → [start, end] */
type Pattern = Record<number, [string, string]>;
const PATTERNS: Record<string, Pattern> = {
  'demo-manager': { 0: ['07:00', '15:00'], 1: ['07:00', '15:00'], 2: ['07:00', '15:00'], 3: ['07:00', '15:00'], 4: ['07:00', '15:00'] },
  'demo-jakub': { 0: ['07:00', '15:00'], 1: ['07:00', '15:00'], 2: ['07:00', '15:00'], 3: ['07:00', '15:00'], 5: ['08:00', '16:00'] },
  'demo-magda': { 1: ['10:00', '18:00'], 2: ['10:00', '18:00'], 3: ['10:00', '18:00'], 4: ['10:00', '18:00'], 5: ['10:00', '18:00'] },
  'demo-anna': { 0: ['08:00', '16:00'], 1: ['08:00', '16:00'], 2: ['08:00', '16:00'], 3: ['08:00', '16:00'], 4: ['08:00', '16:00'] },
  'demo-michal': { 2: ['12:00', '20:00'], 3: ['12:00', '20:00'], 4: ['12:00', '20:00'], 5: ['12:00', '20:00'], 6: ['12:00', '20:00'] },
  'demo-piotr': { 0: ['14:00', '22:00'], 2: ['14:00', '22:00'], 3: ['14:00', '22:00'], 4: ['14:00', '22:00'], 5: ['14:00', '22:00'] },
  'demo-zofia': { 0: ['14:00', '22:00'], 3: ['14:00', '22:00'], 4: ['14:00', '22:00'], 5: ['14:00', '22:00'], 6: ['10:00', '18:00'] },
  'demo-pawel': { 0: ['12:00', '20:00'], 1: ['14:00', '22:00'], 2: ['15:00', '22:00'], 4: ['14:00', '22:00'], 5: ['12:00', '22:00'], 6: ['12:00', '20:00'] },
};
const MANAGER = 'Katarzyna Wiśniewska';

const plusDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
const at = (d: string, hm: string, plusMin = 0) => new Date(zoned(d, hm, TZ).getTime() + plusMin * 60_000).toISOString();
const mins = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
/** small, repeatable "random" number from a string */
const jitter = (seed: string, lo: number, hi: number) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return lo + (h % (hi - lo + 1)); };
const id = () => crypto.randomUUID();

export function seedCookieryDemo() {
  const now = new Date();
  const today = dayKey(now, TZ);
  try { if (localStorage.getItem(MARK) === today) return; } catch { return; }
  for (const k of KEYS) localStorage.removeItem(`shiftclock-demo-${k}`);

  const nowMin = (now.getTime() - zoned(today, '00:00', TZ).getTime()) / 60_000;
  const monday = plusDays(today, -dow(today));
  const created = now.toISOString();

  /* ---- schedules: last week + this week locked, next week submitted by most ---- */
  const weeks: ScheduleWeek[] = [];
  const shifts: ScheduleShift[] = [];
  const nextDraft = new Set(['demo-michal', 'demo-zofia']);
  for (const [w, status] of [[-7, 'locked'], [0, 'locked'], [7, 'submitted']] as const) {
    const ws = plusDays(monday, w);
    for (const [uid, pat] of Object.entries(PATTERNS)) {
      const st = w === 7 && nextDraft.has(uid) ? 'draft' : status;
      const wid = id();
      weeks.push({ id: wid, user_id: uid, week_start: ws, status: st, submitted_at: st === 'draft' ? null : at(plusDays(ws, -4), '17:20'), locked_by: st === 'locked' ? 'demo-manager' : null, locked_at: st === 'locked' ? at(plusDays(ws, -3), '18:05') : null });
      if (st === 'draft') continue;
      for (const [d, [s, e]] of Object.entries(pat)) shifts.push({ id: id(), week_id: wid, user_id: uid, date: plusDays(ws, Number(d)), start_time: `${s}:00`, end_time: `${e}:00`, note: null, edited_by: null });
    }
  }

  /* ---- clock-ins: the last 13 days, plus today so far ---- */
  const entries: TimeEntry[] = [];
  let correctionEntry: TimeEntry | null = null;
  for (let back = 13; back >= 0; back--) {
    const d = plusDays(today, -back);
    for (const [uid, pat] of Object.entries(PATTERNS)) {
      const sh = pat[dow(d)];
      if (!sh) continue;
      const [s, e] = sh;
      const key = `${uid}${d}`;
      let inMin = jitter(key, -7, 3);
      if (uid === 'demo-magda' && back === 6) inMin = 17; // one late morning last week
      if (back === 0) {
        if (uid === 'demo-magda') continue; // late today: not in yet
        if (mins(s) + inMin > nowMin) continue; // shift hasn't started yet
      }
      const outMin = jitter(`${key}o`, -2, 9);
      const open = back === 0 && mins(e) + outMin > nowMin;
      const long = mins(e) - mins(s) >= 8 * 60;
      const entry: TimeEntry = {
        id: id(), user_id: uid, clock_in: at(d, s, inMin), clock_out: open ? null : at(d, e, outMin),
        method: jitter(`${key}m`, 0, 4) === 0 ? 'button' : 'qr', location_id: 'loc-counter', break_minutes: !open && long ? 30 : 0,
        note: null, edited: false, edited_by_name: null, created_at: at(d, s, inMin),
      };
      // Piotr forgot to clock out 2 days ago: closed automatically, asked for a fix
      if (uid === 'demo-piotr' && back === 2) { entry.clock_out = at(d, s, inMin + 14 * 60); entry.method = 'qr'; entry.edited = true; entry.edited_by_name = 'Auto clock-out'; correctionEntry = entry; }
      // one shift a manager fixed last week (shows "approved by")
      if (uid === 'demo-jakub' && back === 8) { entry.clock_out = at(d, e, 25); entry.edited = true; entry.edited_by_name = MANAGER; entry.method = 'manual'; }
      entries.push(entry);
    }
  }

  /* ---- requests waiting for approval ---- */
  const corrections: Correction[] = correctionEntry ? [{
    id: id(), user_id: 'demo-piotr', entry_id: correctionEntry.id, old_clock_in: correctionEntry.clock_in, old_clock_out: correctionEntry.clock_out,
    new_clock_in: correctionEntry.clock_in, new_clock_out: at(plusDays(today, -2), '22:06'), reason: 'Forgot to clock out after closing. Left at 22:06.',
    status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, applied_entry_id: null, created_at: at(plusDays(today, -1), '09:12'),
  }] : [];
  const leaveFrom = plusDays(monday, 10); // Thursday next week
  const leave: LeaveRequest[] = [{
    id: id(), user_id: 'demo-zofia', type: 'annual', start_date: leaveFrom, end_date: plusDays(leaveFrom, 2), reason: 'Family wedding in Kraków',
    status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, created_at: at(plusDays(today, -1), '20:41'),
  }];

  /* ---- one deduction ---- */
  const deductions = [{ id: id(), user_id: 'demo-magda', name: 'Uniform (apron)', type: 'fixed', amount: 45, recurring: 'once', start_date: monday, end_date: null, created_at: created }];

  /* ---- the QR at the counter ---- */
  const locations: Location[] = [{ id: 'loc-counter', name: 'Cookiery PL · counter', lat: null, lng: null, radius_m: null, allow_static: false, active: true, created_at: created }];

  /* ---- bell: the two requests for the owner and the shift lead ---- */
  const notes: Notification[] = [];
  for (const to of ['demo-owner', 'demo-manager']) {
    notes.push({ id: id(), recipient_id: to, type: 'leave.requested', payload: { kind: 'leave', request_id: leave[0].id, employee_name: 'Zofia Dąbrowska' }, read_at: null, created_at: leave[0].created_at });
    if (corrections[0]) notes.push({ id: id(), recipient_id: to, type: 'correction.requested', payload: { kind: 'correction', request_id: corrections[0].id, employee_name: 'Piotr Wójcik' }, read_at: null, created_at: corrections[0].created_at });
  }

  const put = (k: string, v: unknown) => localStorage.setItem(`shiftclock-demo-${k}`, JSON.stringify(v));
  put('weeks', weeks); put('shifts', shifts); put('entries', entries); put('corrections', corrections); put('leave', leave);
  put('deductions', deductions); put('locations', locations); put('notifications', notes);
  localStorage.setItem(MARK, today);
}
