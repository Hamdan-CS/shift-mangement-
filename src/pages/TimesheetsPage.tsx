import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useClock } from '@/contexts/ClockContext';
import { downloadExcel, fetchPeople, PayError } from '@/services/pay';
import { deleteEntry, fetchAllEntries, saveEntry, SheetError } from '@/services/timesheets';
import { WAvatar, WButton, WChip, WInput, WPageHeader, WSelect, WTextarea } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { usePeriod } from '@/components/pay/PeriodPicker';
import { formatHours } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { addDays, clockTime, dayKey, shortDay, zoned } from '@/utils/tz';
import type { Profile, TimeEntry } from '@/types';

const mins = (e: TimeEntry) => Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : Date.now()) - Date.parse(e.clock_in)) / 60000) - e.break_minutes);

/** "/admin/timesheets": all entries for a period; managers fix, add or remove them (PLAN.md 10). */
export function TimesheetsPage() {
  const { timeZone: tz } = useClock();
  const { period, picker } = usePeriod(tz);
  const [people, setPeople] = useState<Profile[]>([]);
  const [params, setParams] = useSearchParams();
  const [who, setWho] = useState(() => params.get('person') ?? '');
  const [rows, setRows] = useState<TimeEntry[] | null>(null);
  const [edit, setEdit] = useState<TimeEntry | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPeople().then(setPeople).catch(() => setPeople([])); }, []);
  // "Add worked hours" from a person's page: open the form for them once
  useEffect(() => {
    if (params.get('add') === '1' && people.length) { setEdit('new'); setParams({}, { replace: true }); }
  }, [params, people, setParams]);
  const load = useCallback(async () => {
    setRows(null);
    const from = zoned(period.from, '00:00', tz);
    const to = addDays(zoned(period.to, '00:00', tz), 1, tz);
    try { setRows(await fetchAllEntries(from, to, who || undefined)); } catch { setRows([]); notify.error('Could not load timesheets.'); }
  }, [period.from, period.to, tz, who]);
  useEffect(() => { void load(); }, [load]);

  const name = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const groups = useMemo(() => {
    const g = new Map<string, TimeEntry[]>();
    for (const e of rows ?? []) { const k = dayKey(new Date(e.clock_in), tz); g.set(k, [...(g.get(k) ?? []), e]); }
    return [...g.entries()];
  }, [rows, tz]);
  const total = (rows ?? []).reduce((s, e) => s + mins(e), 0);

  const excel = async () => {
    setBusy(true);
    try { await downloadExcel(period.from, period.to, who ? [who] : undefined); notify.success('Excel file downloaded'); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not make the Excel file.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <WPageHeader
        title="Timesheets"
        subtitle="Every clock entry. Add a shift someone forgot to clock, fix a time or remove a mistake. It counts in pay straight away, with your name as approver."
        actions={(
          <>
            <WButton tone="secondary" onClick={() => setEdit('new')}><Plus size={17} /> Add entry</WButton>
            <WButton onClick={excel} disabled={busy || !rows?.length}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download Excel</WButton>
          </>
        )}
      />
      <div className="ts-filters">
        {picker}
        <WSelect label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </WSelect>
      </div>

      <section className="sc-card mt-4" aria-busy={rows === null}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <b className="text-[17px] lg:text-[15px]">{period.label}</b>
          <small className="tnum text-[14px] text-ink-3 lg:text-[12.5px]">{rows?.length ?? '…'} entries · {formatHours(total)}</small>
        </div>
        {rows === null && <span className="sc-skel block h-32 w-full" />}
        {rows !== null && rows.length === 0 && <p className="m-0 py-6 text-center text-ink-3">No entries in this period.</p>}
        {groups.map(([day, list]) => (
          <div key={day} className="ts-day">
            <p className="sheet-label">{shortDay(new Date(`${day}T12:00:00Z`), 'UTC', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
            <ul className="rq-list">
              {list.map((e) => {
                const p = name.get(e.user_id);
                return (
                  <li key={e.id} className="rq-item">
                    <WAvatar name={p?.full_name ?? '?'} src={p?.avatar_url} size={36} />
                    <div className="rq-main">
                      <b>{p?.full_name ?? 'Unknown'}</b>
                      <small className="tnum">{clockTime(e.clock_in, tz)} – {e.clock_out ? clockTime(e.clock_out, tz) : 'now'}{e.break_minutes ? ` · break ${e.break_minutes}m` : ''}{e.note ? ` · ${e.note}` : ''}{e.edited_by_name ? ` · by ${e.edited_by_name}` : ''}</small>
                    </div>
                    <div className="rq-side">
                      <b className="tnum text-[16px] lg:text-[13.5px]">{formatHours(mins(e))}</b>
                      <span className="flex gap-1">
                        {e.edited && <WChip tone="warn" dot={false}>Edited</WChip>}
                        {!e.clock_out && <WChip tone="ok">Working</WChip>}
                        {e.method === 'qr' && <WChip dot={false}>QR</WChip>}
                      </span>
                    </div>
                    <button type="button" className="sc-iconbtn" onClick={() => setEdit(e)} aria-label={`Edit ${p?.full_name ?? ''} ${clockTime(e.clock_in, tz)}`}><Pencil size={17} /></button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <EntrySheet entry={edit} people={people.filter((p) => p.active)} tz={tz} defaultUser={who} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} />
    </>
  );
}

function EntrySheet({ entry, people, tz, defaultUser, onClose, onSaved }: { entry: TimeEntry | 'new' | null; people: Profile[]; tz: string; defaultUser: string; onClose(): void; onSaved(): Promise<void> }) {
  const open = entry !== null;
  const e = entry === 'new' ? null : entry;
  const [v, setV] = useState({ user: '', day: '', start: '09:00', end: '17:00', open: false, brk: 0, note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setBusy(false); setConfirmDel(false);
    if (e) setV({ user: e.user_id, day: dayKey(new Date(e.clock_in), tz), start: clockTime(e.clock_in, tz), end: e.clock_out ? clockTime(e.clock_out, tz) : '', open: !e.clock_out, brk: e.break_minutes, note: e.note ?? '' });
    else setV({ user: defaultUser || people[0]?.id || '', day: dayKey(new Date(), tz), start: '09:00', end: '17:00', open: false, brk: 0, note: '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const inAt = zoned(v.day, v.start, tz);
      let outAt: Date | null = null;
      if (!v.open) { outAt = zoned(v.day, v.end, tz); if (outAt <= inAt) outAt = addDays(outAt, 1, tz); } // past midnight
      await saveEntry(e?.id ?? null, { user_id: v.user, clock_in: inAt.toISOString(), clock_out: outAt?.toISOString() ?? null, break_minutes: Number(v.brk) || 0, note: v.note.trim() || null });
      notify.success(e ? 'Entry saved' : 'Entry added');
      await onSaved();
    } catch (x) { setError(x instanceof SheetError ? x.message : 'Could not save.'); setBusy(false); }
  };
  const remove = async () => {
    if (!e) return;
    setBusy(true);
    try { await deleteEntry(e.id); notify.success('Entry removed'); await onSaved(); }
    catch (x) { setError(x instanceof SheetError ? x.message : 'Could not remove.'); setBusy(false); }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={e ? 'Edit entry' : 'Add entry'}
      footer={(
        <div className="grid gap-2">
          <WButton onClick={save} disabled={busy || !v.user || !v.day || (!v.open && !v.end)}>{busy ? <Loader2 size={18} className="animate-spin" /> : e ? 'Save changes' : 'Add entry'}</WButton>
          {e && !confirmDel && <WButton tone="ghost" onClick={() => setConfirmDel(true)} disabled={busy}><Trash2 size={17} /> Remove entry</WButton>}
          {e && confirmDel && <WButton tone="danger" onClick={remove} disabled={busy}><Trash2 size={17} /> Yes, remove it for good</WButton>}
        </div>
      )}
    >
      <div className="grid gap-4">
        <WSelect label="Person" value={v.user} onChange={(x) => setV((s) => ({ ...s, user: x.target.value }))} disabled={!!e}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </WSelect>
        <WInput label="Day" type="date" value={v.day} onChange={(x) => setV((s) => ({ ...s, day: x.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <WInput label="Start" type="time" value={v.start} onChange={(x) => setV((s) => ({ ...s, start: x.target.value }))} />
          <WInput label="End" type="time" value={v.end} disabled={v.open} onChange={(x) => setV((s) => ({ ...s, end: x.target.value }))} hint={v.open ? 'Still working' : 'Earlier than start = next day'} />
        </div>
        <WInput label="Break (minutes)" type="number" inputMode="numeric" min={0} max={600} value={v.brk} onChange={(x) => setV((s) => ({ ...s, brk: Number(x.target.value) }))} />
        <WTextarea label="Note (optional)" rows={2} value={v.note} onChange={(x) => setV((s) => ({ ...s, note: x.target.value }))} placeholder="Why it was changed" />
        {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      </div>
    </BottomSheet>
  );
}
