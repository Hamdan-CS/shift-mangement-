import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WAvatar, WBox, WButton, WInput, WPageHeader } from '@/components/app/ui';
import { Switch } from '@/components/shared/ui/Switch';
import { PayError, updatePerson } from '@/services/pay';
import { notify } from '@/utils/notify';
import { roleLabel } from '@/utils/roles';

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
