import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail, QrCode, Send, X } from 'lucide-react';
import { WBox, WButton, WChip, WInput, WPageHeader, WSelect } from '@/components/app/ui';
import { Switch } from '@/components/shared/ui/Switch';
import { fetchSettings, updateSettings } from '@/services/api';
import { AdminError, fetchEmailLog, sendTestEmail, type EmailLogRow } from '@/services/admin';
import { notify } from '@/utils/notify';
import { relativeDate } from '@/utils/labels';
import type { Settings } from '@/types';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Kyiv', 'Asia/Dubai', 'Asia/Amman', 'Asia/Riyadh', 'America/New_York', 'UTC'];
const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'AED', 'SAR', 'JOD'];
const JOB: Record<string, string> = { daily: 'Daily summary', staff_weekly: 'Weekly summary', owner_daily: 'Owner daily', owner_weekly: 'Owner weekly', reminder: 'Schedule reminder', missing: 'Schedule missing', instant: 'Notification', test: 'Test' };
const t5 = (t: string) => (t ?? '').slice(0, 5);

/** "/admin/settings" (owner): company, working day, schedule deadline, clock rules, emails. */
export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState<EmailLogRow[]>([]);
  const [rcpt, setRcpt] = useState('');

  useEffect(() => {
    fetchSettings().then((x) => { setS(x); setSaved(x); }).catch(() => notify.error('Could not load settings.'));
    fetchEmailLog().then(setLog).catch(() => setLog([]));
  }, []);
  if (!s) return <><WPageHeader title="Settings" /><section className="sc-card"><span className="sc-skel block h-48 w-full" /></section></>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const save = async () => {
    if (!s.company_name.trim()) { notify.error('Type the company name.'); return; }
    if (t5(s.day_end) <= t5(s.day_start)) { notify.error('The working day must end after it starts.'); return; }
    setBusy(true);
    try {
      const { id: _id, ...patch } = s;
      const next = await updateSettings({ ...patch, company_name: s.company_name.trim() });
      setS(next); setSaved(next);
      notify.success('Settings saved');
    } catch { notify.error('Could not save. Only the owner can change settings.'); }
    finally { setBusy(false); }
  };
  const addRcpt = () => {
    const v = rcpt.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { notify.error('That is not an email address.'); return; }
    if (!s.report_recipients.includes(v)) set('report_recipients', [...s.report_recipients, v]);
    setRcpt('');
  };
  const test = async () => {
    setTesting(true);
    try { await sendTestEmail(); notify.success('Test email sent. Check your inbox.'); fetchEmailLog().then(setLog).catch(() => undefined); }
    catch (e) { notify.error(e instanceof AdminError ? e.message : 'Could not send the test email.'); }
    finally { setTesting(false); }
  };

  return (
    <>
      <WPageHeader
        title="Settings"
        subtitle="Company, working day, schedule deadline, clock rules and emails. Times are company time."
        actions={<WButton onClick={save} disabled={busy || !dirty}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save changes'}</WButton>}
      />
      <div className="set-grid sc-stagger">
        <WBox title="Company">
          <div className="grid gap-4">
            <WInput label="Company name" value={s.company_name} onChange={(e) => set('company_name', e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <WSelect label="Currency" value={s.currency} onChange={(e) => set('currency', e.target.value)}>
                {[...new Set([s.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
              </WSelect>
              <WSelect label="Timezone" value={s.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {[...new Set([s.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </WSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <WInput label="Working day starts" type="time" value={t5(s.day_start)} onChange={(e) => set('day_start', e.target.value)} hint="Today timeline" />
              <WInput label="Working day ends" type="time" value={t5(s.day_end) === '24:00' ? '00:00' : t5(s.day_end)} onChange={(e) => set('day_end', e.target.value === '00:00' ? '24:00' : e.target.value)} hint="00:00 = midnight" />
            </div>
          </div>
        </WBox>

        <WBox title="Schedule and clock">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <WSelect label="Next week due by" value={s.schedule_deadline_dow} onChange={(e) => set('schedule_deadline_dow', Number(e.target.value))}>
                {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </WSelect>
              <WInput label="at" type="time" value={t5(s.schedule_deadline_time)} onChange={(e) => set('schedule_deadline_time', e.target.value)} />
            </div>
            <WInput label="Close forgotten shifts after (hours)" type="number" inputMode="numeric" min={1} max={24} value={s.auto_clockout_hours} onChange={(e) => set('auto_clockout_hours', Math.max(1, Math.min(24, Number(e.target.value) || 1)))} hint="Checked every 10 minutes. The person is told and can ask for a correction." />
            <label className="loc-toggle">
              <span><b>Start / Finish button</b><small>Off = staff must scan the QR code at work.</small></span>
              <Switch checked={s.allow_button_clock} onChange={(c) => set('allow_button_clock', c)} label="Start / Finish button" />
            </label>
            <Link to="/admin/locations" className="sc-cta">
              <span className="sc-cta-ic" aria-hidden="true"><QrCode size={18} /></span>
              <span className="min-w-0 flex-1"><b>Locations and QR codes</b><small>Workplaces, kiosk screen, GPS circle</small></span>
            </Link>
          </div>
        </WBox>

        <WBox title="Emails" meta="Sent from Gmail: needs GMAIL_USER and GMAIL_APP_PASSWORD in Supabase (see HANDOVER.md)" className="set-wide">
          <div className="grid gap-4">
            <label className="loc-toggle">
              <span><b>Send emails</b><small>Daily and weekly reports, reminders, approvals. In-app notifications always work.</small></span>
              <Switch checked={s.emails_enabled} onChange={(c) => set('emails_enabled', c)} label="Send emails" />
            </label>
            <div className="set-times">
              <WInput label="Staff daily summary" type="time" value={t5(s.daily_email_time)} onChange={(e) => set('daily_email_time', e.target.value)} />
              <WInput label="Owner daily report" type="time" value={t5(s.owner_daily_time)} onChange={(e) => set('owner_daily_time', e.target.value)} />
              <WSelect label="Weekly report on" value={s.weekly_email_dow} onChange={(e) => set('weekly_email_dow', Number(e.target.value))}>
                {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </WSelect>
              <WInput label="Weekly report at" type="time" value={t5(s.weekly_email_time)} onChange={(e) => set('weekly_email_time', e.target.value)} />
              <WInput label="Schedule reminder" type="time" value={t5(s.reminder_time)} onChange={(e) => set('reminder_time', e.target.value)} hint="On the deadline day" />
            </div>
            <div>
              <span className="w-label">Also send the owner reports to</span>
              <div className="flex gap-2">
                <input className="w-input" type="email" inputMode="email" placeholder="accountant@example.com" value={rcpt} onChange={(e) => setRcpt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRcpt(); } }} aria-label="Add a report recipient" />
                <WButton tone="secondary" onClick={addRcpt}>Add</WButton>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {s.report_recipients.map((r) => (
                  <span key={r} className="set-rcpt"><Mail size={14} />{r}<button type="button" aria-label={`Remove ${r}`} onClick={() => set('report_recipients', s.report_recipients.filter((x) => x !== r))}><X size={14} /></button></span>
                ))}
                {!s.report_recipients.length && <small className="text-[13px] text-ink-3">The owner and managers get them at the email set on their People page.</small>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <WButton tone="secondary" onClick={test} disabled={testing}>{testing ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Send me a test email</WButton>
              {dirty && <small className="text-[13px] text-ink-3">Save first so the new times are used.</small>}
            </div>
            <div>
              <p className="sheet-label">Recent emails</p>
              {log.length === 0 && <p className="m-0 text-[14px] text-ink-3 lg:text-[12.5px]">Nothing sent yet.</p>}
              <ul className="rq-list">
                {log.slice(0, 8).map((l) => (
                  <li key={l.id} className="rq-item">
                    <div className="rq-main"><b>{JOB[l.job] ?? l.job}</b><small className="truncate">{l.recipient}{l.detail ? ` · ${l.detail}` : ''}</small></div>
                    <div className="rq-side"><WChip tone={l.status === 'sent' ? 'ok' : l.status === 'failed' ? 'danger' : 'default'}>{l.status}</WChip><small className="text-[12px] text-ink-3">{relativeDate(l.created_at)}</small></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </WBox>
      </div>
      {dirty && (
        <div className="set-bar" role="status">
          <span>Unsaved changes</span>
          <WButton tone="ghost" onClick={() => setS(saved)}>Undo</WButton>
          <WButton onClick={save} disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save'}</WButton>
        </div>
      )}
    </>
  );
}
