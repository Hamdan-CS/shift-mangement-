import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Mail, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WAvatar, WBox, WButton, WChip, WInput, WPageHeader, WSegmented, WTextarea } from '@/components/app/ui';
import { useScheduleView, type ScheduleView } from '@/hooks/useScheduleView';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { useSettings } from '@/hooks/useSettings';
import { createPayRequest, fetchMyPayRequests, RequestError, withdrawPayRequest } from '@/services/requests';
import { STATUS_CHIP } from '@/components/requests/status';
import { formatMoney, relativeDate } from '@/utils/labels';
import { Switch } from '@/components/shared/ui/Switch';
import { PayError, updatePerson } from '@/services/pay';
import { notify } from '@/utils/notify';
import { roleLabel } from '@/utils/roles';

import type { PayRequest } from '@/types';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "/account" (everyone): your email for hours emails, which emails you want, password. */
export function AccountPage() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [daily, setDaily] = useState(true);
  const [weekly, setWeekly] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setEmail(profile.notify_email ?? '');
    setDaily(profile.email_daily ?? true);
    setWeekly(profile.email_weekly ?? true);
  }, [profile]);
  if (!profile) return null;

  const clean = email.trim().toLowerCase();
  const dirty = clean !== (profile.notify_email ?? '') || daily !== (profile.email_daily ?? true) || weekly !== (profile.email_weekly ?? true);
  const bad = clean !== '' && !EMAIL.test(clean);

  const save = async () => {
    if (bad) { notify.error('That is not an email address.'); return; }
    setBusy(true);
    try {
      await updatePerson(profile.id, { notify_email: clean || null, email_daily: daily, email_weekly: weekly });
      await refreshProfile();
      notify.success(clean ? 'Saved. Your hours emails go to ' + clean : 'Saved. No emails will be sent to you.');
    } catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <WPageHeader title="My settings" subtitle="Where your hours emails go, and which ones you want." />
      <div className="set-grid sc-stagger">
        <WBox title="Hours emails">
          <div className="grid gap-4">
            <WInput
              label="Your email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint={bad ? 'Check the address' : 'Your ShiftClock sign-in is not an email, so add a real one here.'}
              aria-invalid={bad}
            />
            <label className="loc-toggle">
              <span><b>Daily summary</b><small>Each day you work: clock in and out, hours, earned.</small></span>
              <Switch checked={daily} onChange={setDaily} label="Daily summary" />
            </label>
            <label className="loc-toggle">
              <span><b>Weekly summary</b><small>Every week: hours per day, total, overtime, gross and net.</small></span>
              <Switch checked={weekly} onChange={setWeekly} label="Weekly summary" />
            </label>
            {!clean && <div className="sc-alert info"><Mail size={16} className="mt-0.5 shrink-0" /><span>Add your email to start getting these.</span></div>}
            <WButton onClick={save} disabled={busy || !dirty || bad}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save'}</WButton>
          </div>
        </WBox>

        <ScheduleViewCard />
        <NameCard />
        {profile.role !== 'owner' && <PayRateCard />}

        <WBox title="Account">
          <div className="flex items-center gap-3">
            <WAvatar name={profile.full_name} src={profile.avatar_url} size={52} />
            <div className="min-w-0">
              <b className="block truncate text-[17px] font-semibold">{profile.full_name}</b>
              <small className="block text-[14px] text-ink-3 lg:text-[12.5px]">@{profile.username} · {roleLabel[profile.role]}{profile.job_title ? ` · ${profile.job_title}` : ''}</small>
            </div>
          </div>
          <WButton tone="secondary" block className="mt-5" onClick={() => navigate('/reset-password')}><KeyRound size={17} /> Change password</WButton>
        </WBox>
      </div>
    </>
  );
}

/** Your name, as everyone sees it (changes straight away). */
function NameCard() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(profile?.full_name ?? ''); }, [profile?.full_name]);
  if (!profile) return null;
  const clean = name.trim().replace(/\s+/g, ' ');
  const save = async () => {
    if (clean.length < 2) { notify.error('Type your full name.'); return; }
    setBusy(true);
    try { await updatePerson(profile.id, { full_name: clean.slice(0, 80) }); await refreshProfile(); notify.success('Name saved'); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <WBox title="Your name">
      <div className="grid gap-4">
        <WInput label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} hint="Shown on the schedule, in chats and on your pay." maxLength={80} />
        <WButton tone="secondary" onClick={save} disabled={busy || clean === profile.full_name || clean.length < 2}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save name'}</WButton>
      </div>
    </WBox>
  );
}

/** Your hourly rate, and a request to change it (the owner approves). */
function PayRateCard() {
  const { profile } = useAuth();
  const settings = useSettings();
  const money = (n: number | null) => (n === null ? 'Not set' : `${formatMoney(n, settings?.currency ?? 'PLN')}/h`);
  const [list, setList] = useState<PayRequest[] | null>(null);
  const [asking, setAsking] = useState(false);
  const load = useCallback(async () => {
    if (!profile) return;
    try { setList(await fetchMyPayRequests(profile.id)); } catch { setList([]); }
  }, [profile]);
  useEffect(() => { void load(); }, [load]);
  if (!profile) return null;
  const pending = list?.find((x) => x.status === 'pending');
  const last = list?.find((x) => x.status !== 'pending');

  return (
    <WBox title="Pay rate" meta="Changes need the owner's approval">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent"><Wallet size={20} /></span>
        <div className="min-w-0">
          <small className="block text-[13px] text-ink-3">Your rate now</small>
          <b className="block text-[22px] font-semibold tnum">{money(profile.hourly_rate)}</b>
        </div>
      </div>
      {pending && (
        <div className="sc-inset mt-4 grid gap-2">
          <div className="flex items-center justify-between gap-2"><b className="text-[15px]">Asked for {money(pending.new_rate)}</b><WChip tone={STATUS_CHIP.pending.tone}>{STATUS_CHIP.pending.label}</WChip></div>
          <small className="text-[13px] text-ink-3">Sent {relativeDate(pending.created_at)} · “{pending.reason}”</small>
          <WButton tone="ghost" size="sm" onClick={async () => { try { await withdrawPayRequest(pending.id); notify.success('Request withdrawn'); await load(); } catch { notify.error('Could not withdraw.'); } }}>Withdraw request</WButton>
        </div>
      )}
      {!pending && last && (
        <p className="mt-4 mb-0 text-[14px] text-ink-2 lg:text-[12.5px]">
          Last request: {money(last.new_rate)} <WChip tone={STATUS_CHIP[last.status].tone}>{STATUS_CHIP[last.status].label}</WChip>
          {last.reviewed_by_name ? ` by ${last.reviewed_by_name}` : ''}{last.review_note ? ` · “${last.review_note}”` : ''}
        </p>
      )}
      {!pending && <WButton tone="secondary" block className="mt-4" onClick={() => setAsking(true)} disabled={list === null}>Ask for a new rate</WButton>}
      <PayRequestSheet open={asking} current={profile.hourly_rate} onClose={() => setAsking(false)} onSent={async () => { setAsking(false); await load(); }} />
    </WBox>
  );
}

function PayRequestSheet({ open, current, onClose, onSent }: { open: boolean; current: number | null; onClose(): void; onSent(): Promise<void> }) {
  const { profile } = useAuth();
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setRate(current !== null ? String(current) : ''); setReason(''); setBusy(false); } }, [open, current]);
  const send = async () => {
    if (!profile) return;
    setBusy(true);
    try { await createPayRequest(profile.id, Number(rate), reason); notify.success('Sent to the owner for approval'); await onSent(); }
    catch (e) { notify.error(e instanceof RequestError ? e.message : 'Could not send.'); setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Ask for a new rate" footer={<WButton onClick={send} disabled={busy || rate === '' || Number(rate) === current || reason.trim().length < 3}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Send for approval'}</WButton>}>
      <p className="sheet-sub">The owner gets a notification. Your rate changes only when they approve it.</p>
      <div className="grid gap-4">
        <WInput label="New hourly rate" type="number" inputMode="decimal" min={0} max={10000} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
        <WTextarea label="Why?" rows={3} maxLength={500} placeholder="e.g. One year in the job, new responsibilities" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </BottomSheet>
  );
}

/** How the schedule pages open: Day, Week or Month (also remembered when switched there). */
function ScheduleViewCard() {
  const view = useScheduleView();
  return (
    <WBox title="Schedule view" meta="How your schedule opens. You can switch on the page too.">
      <WSegmented<ScheduleView> ariaLabel="Schedule view" value={view.value} onChange={(v) => { view.set(v); notify.success(`Schedule opens in ${v} view`); }} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
    </WBox>
  );
}
