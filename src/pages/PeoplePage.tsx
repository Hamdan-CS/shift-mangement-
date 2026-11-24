import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/hooks/useSettings';
import { addPerson, fetchPeople, PayError, suggestPassword, type NewPerson } from '@/services/pay';
import { WAvatar, WButton, WChip, WInput, WPageHeader } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { copyText } from '@/utils/summary';
import { formatMoney } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { roleLabel } from '@/utils/roles';
import type { Profile, Role } from '@/types';

/** "/admin/people": staff, roles and rates (PLAN.md 10). The owner adds people here. */
export function PeoplePage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const settings = useSettings();
  const navigate = useNavigate();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setPeople(await fetchPeople()); } catch { setPeople([]); notify.error('Could not load people.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const active = (people ?? []).filter((p) => p.active);
  const off = (people ?? []).filter((p) => !p.active);

  const card = (p: Profile) => (
    <li key={p.id}>
      <button type="button" className="pp-card" onClick={() => navigate(`/admin/people/${p.id}`)}>
        <WAvatar name={p.full_name} src={p.avatar_url} size={48} />
        <span className="min-w-0 flex-1">
          <b className="truncate">{p.full_name}</b>
          <small className="truncate">@{p.username} · {p.job_title || roleLabel[p.role]}</small>
        </span>
        <span className="pp-side">
          <WChip tone={p.role === 'employee' ? 'default' : 'accent'} dot={false}>{roleLabel[p.role]}</WChip>
          <small className="tnum">{p.hourly_rate !== null ? `${formatMoney(p.hourly_rate, settings?.currency ?? 'PLN')}/h` : 'No rate'}</small>
        </span>
      </button>
    </li>
  );

  return (
    <>
      <WPageHeader
        title="People"
        subtitle={`${active.length} active${off.length ? ` · ${off.length} switched off` : ''}. Open someone for their hours, rate and deductions.`}
        actions={isOwner ? <WButton onClick={() => setAdding(true)}><UserPlus size={17} /> Add person</WButton> : undefined}
      />
      {people === null && <section className="sc-card"><span className="sc-skel block h-32 w-full" /></section>}
      <ul className="pp-grid">{active.map(card)}</ul>
      {off.length > 0 && (
        <>
          <p className="sheet-label mt-6">Switched off</p>
          <ul className="pp-grid muted">{off.map(card)}</ul>
        </>
      )}
      {isOwner && <AddPersonSheet open={adding} onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); await load(); }} />}
    </>
  );
}

function AddPersonSheet({ open, onClose, onAdded }: { open: boolean; onClose(): void; onAdded(): Promise<void> }) {
  const empty = (): NewPerson => ({ full_name: '', username: '', password: suggestPassword(), role: 'employee', job_title: '', hourly_rate: null });
  const [v, setV] = useState<NewPerson>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<NewPerson | null>(null);
  useEffect(() => { if (open) { setV(empty()); setError(null); setBusy(false); setDone(null); } }, [open]);

  const save = async () => {
    setBusy(true); setError(null);
    try { await addPerson({ ...v, username: v.username.trim().toLowerCase(), full_name: v.full_name.trim() }); setDone(v); }
    catch (e) { setError(e instanceof PayError ? e.message : 'Could not add the person.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <BottomSheet open={open} onClose={() => void onAdded()} title="Person added" footer={<WButton onClick={() => void onAdded()}>Done</WButton>}>
        <p className="sheet-sub">Give {done.full_name.split(' ')[0]} these details. They can change the password after signing in.</p>
        <dl className="tl-dl">
          <div><dt>Username</dt><dd>{done.username}</dd></div>
          <div><dt>Password</dt><dd className="tnum">{done.password}</dd></div>
        </dl>
        <WButton tone="secondary" block className="mt-3" onClick={async () => { if (await copyText(`Username: ${done.username}\nPassword: ${done.password}`)) notify.success('Copied'); }}>Copy login details</WButton>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add a person" footer={<WButton onClick={save} disabled={busy || !v.full_name.trim() || !v.username.trim()}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Add person'}</WButton>}>
      <div className="grid gap-4">
        <WInput label="Full name" autoComplete="off" value={v.full_name} onChange={(e) => setV((x) => ({ ...x, full_name: e.target.value, username: x.username || e.target.value.split(' ')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} required />
        <WInput label="Username (for signing in)" autoCapitalize="none" spellCheck={false} value={v.username} onChange={(e) => setV((x) => ({ ...x, username: e.target.value.toLowerCase() }))} hint="3–32 small letters, numbers, dot, dash or underscore" required />
        <div className="w-field">
          <label className="w-label" htmlFor="np-pw">Password</label>
          <div className="flex gap-2">
            <input id="np-pw" className="w-input" value={v.password} onChange={(e) => setV((x) => ({ ...x, password: e.target.value }))} autoComplete="off" />
            <button type="button" className="sc-iconbtn" onClick={() => setV((x) => ({ ...x, password: suggestPassword() }))} aria-label="Suggest another password"><RefreshCw size={18} /></button>
          </div>
        </div>
        <div className="w-field">
          <span className="w-label">Role</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Role">
            {(['employee', 'manager'] as Role[]).map((r) => <button key={r} type="button" role="radio" aria-checked={v.role === r} className="sc-preset" aria-pressed={v.role === r} onClick={() => setV((x) => ({ ...x, role: r }))}>{roleLabel[r]}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <WInput label="Job title" placeholder="e.g. Cashier" value={v.job_title} onChange={(e) => setV((x) => ({ ...x, job_title: e.target.value }))} />
          <WInput label="Hourly rate" type="number" inputMode="decimal" min={0} step="0.01" value={v.hourly_rate ?? ''} onChange={(e) => setV((x) => ({ ...x, hourly_rate: e.target.value === '' ? null : Number(e.target.value) }))} />
        </div>
        {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      </div>
    </BottomSheet>
  );
}
