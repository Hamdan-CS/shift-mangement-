import type { Profile, Settings, TimeEntry } from '@/types';

/**
 * Dev-only demo data (VITE_DEMO_AUTH=1). Mirrors scripts/seed.mjs so screens
 * look the same with or without a Supabase project. Never used in production builds.
 */
const base = { avatar_url: null, notify_email: null, email_daily: true, email_weekly: true, schedule_view: 'week' as const, overtime_after_hours: 40, overtime_multiplier: 1.5, active: true, created_at: '2026-11-01T08:00:00Z' };

export const DEMO_PROFILES: Profile[] = [
  { ...base, id: 'demo-owner', username: 'owner', full_name: 'Sara Mansour', role: 'owner', job_title: 'Owner', hourly_rate: null },
  { ...base, id: 'demo-manager', username: 'manager', full_name: 'Omar Haddad', role: 'manager', job_title: 'Shift manager', hourly_rate: 45 },
  { ...base, id: 'demo-ali', username: 'ali', full_name: 'Ali Hassan', role: 'employee', job_title: 'Cashier', hourly_rate: 30 },
  { ...base, id: 'demo-lina', username: 'lina', full_name: 'Lina Farah', role: 'employee', job_title: 'Kitchen', hourly_rate: 32 },
  { ...base, id: 'demo-yusuf', username: 'yusuf', full_name: 'Yusuf Karim', role: 'employee', job_title: 'Front desk', hourly_rate: 28 },
];

export const DEMO_SETTINGS: Settings = {
  id: 1,
  company_name: 'Cookiery PL',
  currency: 'PLN',
  timezone: 'Europe/Warsaw',
  schedule_deadline_dow: 4,
  schedule_deadline_time: '18:00',
  daily_email_time: '23:00',
  auto_clockout_hours: 14,
  day_start: '06:00',
  day_end: '24:00',
  allow_button_clock: true,
  report_recipients: [],
  emails_enabled: true,
  owner_daily_time: '23:15',
  weekly_email_dow: 0,
  weekly_email_time: '23:30',
  reminder_time: '12:00',
};

const KEY = 'shiftclock-demo-user';

export const demoSession = {
  get(): Profile | null {
    try {
      const id = localStorage.getItem(KEY);
      return DEMO_PROFILES.find((p) => p.id === id) ?? null;
    } catch { return null; }
  },
  set(id: string | null) {
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  },
};

/* ---------- demo time entries (dev only), kept in localStorage ---------- */

const ENTRIES_KEY = 'shiftclock-demo-entries';

export const demoEntries = {
  all(): TimeEntry[] {
    try { return JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]') as TimeEntry[]; } catch { return []; }
  },
  save(list: TimeEntry[]) {
    try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  },
};
