import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Copy, Download, KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { addDeduction, downloadExcel, fetchDeductions, fetchPayDays, fetchPeople, PayError, removeDeduction, setPassword, suggestPassword, updatePerson, type Deduction, type DeductionInput, type PayDay } from '@/services/pay';
import { WAvatar, WBox, WButton, WInput } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { Switch } from '@/components/shared/ui/Switch';
import { formatMoney } from '@/utils/labels';
import { PersonMonth } from '@/components/calendar/MonthCalendar';
import { notify } from '@/utils/notify';
import { copyText } from '@/utils/summary';
import { roleLabel } from '@/utils/roles';
import { dayKey } from '@/utils/tz';
import type { Profile, Role } from '@/types';


/**
 * "/admin/people/:id": one person (Grovia ref 08): month calendar of hours,
 * month totals, profile + rate (owner edits), deductions, Excel download.
 */
export function PersonPage() {
  const { id = '' } = useParams();
  const { profile: me } = useAuth();
  const isOwner = me?.role === 'owner';
  const navigate = useNavigate();
  const { timeZone: tz } = useClock();
  const settings = useSettings();
  const currency = settings?.currency ?? 'PLN';
  const money = (n: number) => formatMoney(n, currency);
  const [person, setPerson] = useState<Profile | null>(null);
  const [month, setMonth] = useState(() => dayKey(new Date(), tz).slice(0, 7)); // 'YYYY-MM'
  const [days, setDays] = useState<PayDay[] | null>(null);
  const [deds, setDeds] = useState<Deduction[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'deduction' | 'password' | null>(null);

  const from = `${month}-01`;
  const to = useMemo(() => { const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); }, [from]);

  const load = useCallback(async () => {
    setDays(null);
    try {
      const [people, d, x] = await Promise.all([fetchPeople(), fetchPayDays(from, to), fetchDeductions(id)]);
      setPerson(people.find((p) => p.id === id) ?? null);
      setDays(d.filter((row) => row.user_id === id));
      setDeds(x);
    } catch { setDays([]); notify.error('Could not load this person.'); }
  }, [id, from, to]);
  useEffect(() => { void load(); }, [load]);

  const excel = async () => {
    setBusy(true);
    try { await downloadExcel(from, to, [id]); notify.success('Excel file downloaded'); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not make the Excel file.'); }
    finally { setBusy(false); }
  };

  if (days !== null && !person) return <WBox><p className="m-0">Person not found. <Link to="/admin/people">Back to People</Link></p></WBox>;

  return (
    <>
      <div className="pt-4 lg:pt-8">
        <Link to="/admin/people" className="sc-btn sc-btn-ghost" style={{ paddingLeft: 6 }}><ArrowLeft size={18} /> People</Link>
      </div>
      <div className="person-grid">
        <section className="sc-card">
          {person && <PersonMonth key={person.id} userId={person.id} rate={person.hourly_rate} initialMonth={month} onMonth={setMonth} />}
        </section>

        <aside className="sc-card person-side">
          {person && (
            <>
              <div className="flex flex-col items-center text-center">
                <WAvatar name={person.full_name} src={person.avatar_url} size={88} />
                <b className="mt-3 block text-[22px] font-semibold tracking-[-0.02em]">{person.full_name}</b>
                <small className="block text-[14px] text-ink-3 lg:text-[12.5px]">{person.job_title || '—'} · {roleLabel[person.role]}{person.active ? '' : ' · switched off'}</small>
              </div>
              <ProfileForm key={person.id + String(person.hourly_rate)} person={person} editable={isOwner && person.id !== me?.id} onSaved={load} />
              {(isOwner || person.id === me?.id) && <EmailField key={`e${person.id}${person.notify_email ?? ''}`} person={person} onSaved={load} />}
              <p className="sheet-label">Deductions</p>
              {deds.length === 0 && <p className="m-0 text-[14px] text-ink-3 lg:text-[12.5px]">None.</p>}
              <ul className="rq-list">
                {deds.map((x) => (
                  <li key={x.id} className="rq-item">
                    <div className="rq-main"><b>{x.name}{x.user_id === null ? ' (everyone)' : ''}</b><small>{x.type === 'percent' ? `${x.amount}% of gross, every period` : `${money(x.amount)} · ${x.recurring === 'once' ? `once, ${x.start_date}` : x.recurring === 'weekly' ? 'every week' : 'every month'}`}{x.end_date ? ` until ${x.end_date}` : ''}</small></div>
                    {isOwner && x.user_id !== null && <WButton tone="ghost" size="sm" className="min-w-[44px]" onClick={async () => { try { await removeDeduction(x.id); notify.success('Deduction removed'); await load(); } catch { notify.error('Could not remove.'); } }} aria-label={`Remove ${x.name}`}><Trash2 size={16} /></WButton>}
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-2">
                {isOwner && <WButton tone="secondary" onClick={() => setSheet('deduction')}><Plus size={17} /> Add deduction</WButton>}
                <WButton tone="secondary" onClick={() => navigate(`/admin/timesheets?person=${person.id}&add=1`)}><Clock3 size={17} /> Add worked hours</WButton>
                {(isOwner ? person.id !== me?.id : person.role === 'employee') && <WButton tone="secondary" onClick={() => setSheet('password')}><KeyRound size={17} /> Reset password</WButton>}
                <WButton onClick={excel} disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download Excel (this month)</WButton>
              </div>
            </>
          )}
        </aside>
      </div>

      {person && <DeductionSheet open={sheet === 'deduction'} userId={person.id} onClose={() => setSheet(null)} onSaved={async () => { setSheet(null); await load(); }} />}
      {person && <PasswordSheet open={sheet === 'password'} person={person} onClose={() => setSheet(null)} />}
    </>
  );
}

function ProfileForm({ person, editable, onSaved }: { person: Profile; editable: boolean; onSaved(): Promise<void> }) {
  const [v, setV] = useState({ job_title: person.job_title ?? '', role: person.role, hourly_rate: person.hourly_rate, overtime_after_hours: person.overtime_after_hours, overtime_multiplier: person.overtime_multiplier, active: person.active });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await updatePerson(person.id, { ...v, job_title: v.job_title.trim() || null }); notify.success('Saved'); await onSaved(); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  if (!editable) {
    return (
      <dl className="tl-dl mt-5">
        <div><dt>Rate</dt><dd className="tnum">{person.hourly_rate ?? '—'}</dd></div>
        <div><dt>Overtime after</dt><dd className="tnum">{person.overtime_after_hours}h/week</dd></div>
        <div><dt>Overtime pay</dt><dd className="tnum">×{person.overtime_multiplier}</dd></div>
        <div><dt>Username</dt><dd>{person.username}</dd></div>
      </dl>
    );
  }
  return (
    <div className="mt-5 grid gap-3">
      <WInput label="Job title" value={v.job_title} onChange={(e) => setV((x) => ({ ...x, job_title: e.target.value }))} />
      <div className="grid grid-cols-3 gap-2">
        <WInput label="Rate / h" type="number" inputMode="decimal" min={0} step="0.01" value={v.hourly_rate ?? ''} onChange={(e) => setV((x) => ({ ...x, hourly_rate: e.target.value === '' ? null : Number(e.target.value) }))} />
        <WInput label="OT after (h)" type="number" inputMode="numeric" min={0} step="1" value={v.overtime_after_hours} onChange={(e) => setV((x) => ({ ...x, overtime_after_hours: Number(e.target.value) }))} />
        <WInput label="OT ×" type="number" inputMode="decimal" min={1} step="0.05" value={v.overtime_multiplier} onChange={(e) => setV((x) => ({ ...x, overtime_multiplier: Number(e.target.value) }))} />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Role">
        {(['employee', 'manager', 'owner'] as Role[]).map((r) => <button key={r} type="button" role="radio" aria-checked={v.role === r} className="sc-preset" aria-pressed={v.role === r} onClick={() => setV((x) => ({ ...x, role: r }))}>{roleLabel[r]}</button>)}
      </div>
      <label className="loc-toggle">
        <span><b>Active</b><small>Switch off to stop sign-in. Their hours stay.</small></span>
        <Switch checked={v.active} onChange={(c) => setV((x) => ({ ...x, active: c }))} label="Active" />
      </label>
      <WButton onClick={save} disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save changes'}</WButton>
    </div>
  );
}

function DeductionSheet({ open, userId, onClose, onSaved }: { open: boolean; userId: string; onClose(): void; onSaved(): Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const blank = (): DeductionInput => ({ user_id: userId, name: '', type: 'fixed', amount: 0, recurring: 'once', start_date: today, end_date: null });
  const [v, setV] = useState<DeductionInput>(blank);
  const [everyone, setEveryone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(blank()); setEveryone(false); setBusy(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try { await addDeduction({ ...v, user_id: everyone ? null : userId }); notify.success('Deduction added'); await onSaved(); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not save.'); setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Add deduction" footer={<WButton onClick={save} disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Add deduction'}</WButton>}>
      <div className="grid gap-4">
        <WInput label="Name" placeholder="e.g. Uniform" value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
          <button type="button" role="radio" aria-checked={v.type === 'fixed'} aria-pressed={v.type === 'fixed'} className="sc-preset" onClick={() => setV((x) => ({ ...x, type: 'fixed' }))}>Fixed amount</button>
          <button type="button" role="radio" aria-checked={v.type === 'percent'} aria-pressed={v.type === 'percent'} className="sc-preset" onClick={() => setV((x) => ({ ...x, type: 'percent' }))}>% of gross</button>
        </div>
        <WInput label={v.type === 'percent' ? 'Percent' : 'Amount'} type="number" inputMode="decimal" min={0} step="0.01" value={v.amount || ''} onChange={(e) => setV((x) => ({ ...x, amount: Number(e.target.value) }))} />
        {v.type === 'fixed' && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How often">
            {(['once', 'weekly', 'monthly'] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={v.recurring === r} aria-pressed={v.recurring === r} className="sc-preset" onClick={() => setV((x) => ({ ...x, recurring: r }))}>{r === 'once' ? 'Once' : r === 'weekly' ? 'Every week' : 'Every month'}</button>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <WInput label="From" type="date" value={v.start_date} onChange={(e) => setV((x) => ({ ...x, start_date: e.target.value }))} />
          <WInput label="Until (optional)" type="date" value={v.end_date ?? ''} min={v.start_date} onChange={(e) => setV((x) => ({ ...x, end_date: e.target.value || null }))} />
        </div>
        <label className="loc-toggle">
          <span><b>For everyone</b><small>Applies to every person, e.g. a tax.</small></span>
          <Switch checked={everyone} onChange={setEveryone} label="For everyone" />
        </label>
      </div>
    </BottomSheet>
  );
}

function PasswordSheet({ open, person, onClose }: { open: boolean; person: Profile; onClose(): void }) {
  const [pw, setPw] = useState(suggestPassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) { setPw(suggestPassword()); setBusy(false); setDone(false); } }, [open]);
  const save = async () => {
    setBusy(true);
    try { await setPassword(person.id, pw); setDone(true); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not set the password.'); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <BottomSheet open={open} onClose={onClose} title="New password set" footer={<WButton onClick={onClose}>Done</WButton>}>
        <p className="sheet-sub">Give {person.full_name.split(' ')[0]} these details. The old password no longer works. They can change it under My settings after signing in.</p>
        <dl className="tl-dl">
          <div><dt>Username</dt><dd>{person.username}</dd></div>
          <div><dt>New password</dt><dd className="tnum">{pw}</dd></div>
        </dl>
        <WButton tone="secondary" block className="mt-3" onClick={async () => { if (await copyText(`Username: ${person.username}
Password: ${pw}`)) notify.success('Copied'); }}><Copy size={17} /> Copy login details</WButton>
      </BottomSheet>
    );
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="Reset password" footer={<WButton onClick={save} disabled={busy || pw.length < 8}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Set new password'}</WButton>}>
      <p className="sheet-sub">For {person.full_name} (@{person.username}), when they forgot it. You'll see the new password to pass on.</p>
      <div className="w-field">
        <label className="w-label" htmlFor="pw-new">New password</label>
        <div className="flex gap-2">
          <input id="pw-new" className="w-input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
          <button type="button" className="sc-iconbtn" onClick={() => setPw(suggestPassword())} aria-label="Suggest another password"><RefreshCw size={18} /></button>
        </div>
        <small className="w-hint">At least 8 characters</small>
      </div>
    </BottomSheet>
  );
}

/** Where this person's ShiftClock emails go (logins are not real addresses). */
function EmailField({ person, onSaved }: { person: Profile; onSaved(): Promise<void> }) {
  const [v, setV] = useState(person.notify_email ?? '');
  const [busy, setBusy] = useState(false);
  const changed = v.trim() !== (person.notify_email ?? '');
  const save = async () => {
    const e = v.trim().toLowerCase();
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { notify.error('That is not an email address.'); return; }
    setBusy(true);
    try { await updatePerson(person.id, { notify_email: e || null }); notify.success(e ? 'Email saved' : 'Email removed'); await onSaved(); }
    catch (x) { notify.error(x instanceof PayError ? x.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-4 grid gap-2">
      <WInput label="Email for reports and alerts" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={v} onChange={(e) => setV(e.target.value)} hint="Daily summary, approvals and reminders go here." />
      {changed && <WButton tone="secondary" onClick={save} disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save email'}</WButton>}
    </div>
  );
}
