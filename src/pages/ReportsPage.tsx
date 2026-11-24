import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bookmark, Download, FileSpreadsheet, Loader2, Plus, X } from 'lucide-react';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { useCountUp } from '@/hooks/useCountUp';
import { downloadExcel, fetchPayDays, fetchPayReport, fetchPeople, PayError, type PayDay, type PayRow } from '@/services/pay';
import { AdminError, deleteView, fetchViews, saveView, type ReportConfig, type ReportView } from '@/services/admin';
import { WButton, WInput, WKpis, WPageHeader, WSegmented, WSelect } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { usePeriod, type PeriodKind } from '@/components/pay/PeriodPicker';
import { formatHours, formatMoney } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { cn } from '@/utils/cn';
import type { Profile } from '@/types';

type Group = ReportConfig['group'];
type Metric = ReportConfig['metric'];
interface Bar { key: string; label: string; long: string; minutes: number; cost: number }

const monday = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });

/** "/admin/reports" (Amplo ref 04): saved views, hours / cost bars, CSV + Excel export. */
export function ReportsPage() {
  const { timeZone: tz } = useClock();
  const settings = useSettings();
  const currency = settings?.currency ?? 'PLN';
  const money = (n: number) => formatMoney(n, currency);
  const { period, picker, setKind, setCustom } = usePeriod(tz, 'month');
  const [group, setGroup] = useState<Group>('person');
  const [metric, setMetric] = useState<Metric>('hours');
  const [who, setWho] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [report, setReport] = useState<PayRow[] | null>(null);
  const [days, setDays] = useState<PayDay[]>([]);
  const [views, setViews] = useState<ReportView[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPeople().then(setPeople).catch(() => setPeople([])); fetchViews().then(setViews).catch(() => setViews([])); }, []);
  useEffect(() => {
    let alive = true;
    setReport(null);
    Promise.all([fetchPayReport(period.from, period.to), fetchPayDays(period.from, period.to)])
      .then(([r, d]) => { if (alive) { setReport(r); setDays(d); } })
      .catch(() => { if (alive) { setReport([]); setDays([]); notify.error('Could not load the report.'); } });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const rate = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const bars: Bar[] = useMemo(() => {
    const rows = (report ?? []).filter((r) => (!who || r.user_id === who) && (r.role !== 'owner' || r.worked_minutes > 0));
    if (group === 'person') {
      return rows.map((r) => ({ key: r.user_id, label: r.full_name.split(' ')[0], long: r.full_name, minutes: r.worked_minutes, cost: r.gross })).sort((a, b) => b.minutes - a.minutes);
    }
    const mine = days.filter((d) => !who || d.user_id === who);
    const map = new Map<string, Bar>();
    const keyOf = (day: string) => (group === 'day' ? day : monday(day));
    // every day / week of the period gets a bar, even with nothing in it
    for (let d = period.from; d <= period.to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      const k = keyOf(d);
      if (!map.has(k)) map.set(k, { key: k, label: group === 'day' ? fmtDay(k, { day: 'numeric' }) : fmtDay(k, { day: 'numeric', month: 'short' }), long: group === 'day' ? fmtDay(k, { weekday: 'long', day: 'numeric', month: 'long' }) : `Week of ${fmtDay(k, { day: 'numeric', month: 'long' })}`, minutes: 0, cost: 0 });
    }
    for (const d of mine) {
      const b = map.get(keyOf(d.day));
      if (!b) continue;
      b.minutes += d.minutes;
      b.cost += ((rate.get(d.user_id)?.hourly_rate ?? 0) * d.minutes) / 60;
    }
    return [...map.values()];
  }, [report, days, group, who, period.from, period.to, rate]);

  const value = (b: Bar) => (metric === 'hours' ? b.minutes : b.cost);
  const max = Math.max(1, ...bars.map(value));
  const totalMin = bars.reduce((s, b) => s + b.minutes, 0);
  const totalCost = group === 'person' ? bars.reduce((s, b) => s + b.cost, 0) : (report ?? []).filter((r) => !who || r.user_id === who).reduce((s, r) => s + r.gross, 0);
  const shownTotal = useCountUp(metric === 'hours' ? totalMin : totalCost);
  const show = (n: number) => (metric === 'hours' ? formatHours(Math.round(n)) : money(n));

  const config = (): ReportConfig => ({ period: period.kind, from: period.from, to: period.to, group, metric, people: who ? [who] : [] });
  const apply = (v: ReportView) => {
    setActive(v.id);
    setKind(v.config.period as PeriodKind);
    if (v.config.period === 'custom' && v.config.from && v.config.to) setCustom({ from: v.config.from, to: v.config.to });
    setGroup(v.config.group); setMetric(v.config.metric); setWho(v.config.people[0] ?? '');
  };
  const csv = () => {
    const head = [group === 'person' ? 'Person' : group === 'day' ? 'Day' : 'Week', 'Hours', `Cost (${currency})`];
    const lines = bars.map((b) => [b.long, (b.minutes / 60).toFixed(2), b.cost.toFixed(2)].map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','));
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `ShiftClock_report_${group}_${period.from}_${period.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const excel = async () => {
    setBusy(true);
    try { await downloadExcel(period.from, period.to, who ? [who] : undefined); notify.success('Excel file downloaded'); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not make the Excel file.'); }
    finally { setBusy(false); }
  };
  const h = hover !== null ? bars[hover] : null;

  return (
    <>
      <WPageHeader
        title="Reports"
        subtitle="Hours and labour cost by person, day or week. Save the views you use often."
        actions={(
          <>
            <WButton tone="secondary" onClick={csv} disabled={!report}><FileSpreadsheet size={17} /> Export CSV</WButton>
            <WButton onClick={excel} disabled={busy || !report}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download Excel</WButton>
          </>
        )}
      />

      <div className="rp-views" role="list" aria-label="Saved views">
        {views.map((v) => (
          <span key={v.id} role="listitem" className={cn('rp-view', active === v.id && 'on')}>
            <button type="button" onClick={() => apply(v)}><Bookmark size={14} />{v.name}</button>
            <button type="button" className="x" aria-label={`Delete view ${v.name}`} onClick={async () => { try { await deleteView(v.id); setViews((x) => x.filter((y) => y.id !== v.id)); if (active === v.id) setActive(null); } catch { notify.error('Could not delete.'); } }}><X size={14} /></button>
          </span>
        ))}
        <button type="button" className="rp-view add" onClick={() => setNaming(true)}><Plus size={15} /> Save this view</button>
      </div>

      <div className="rp-controls">
        {picker}
        <div className="rp-row">
          <WSegmented<Group> ariaLabel="Group by" value={group} onChange={(g) => { setGroup(g); setActive(null); }} options={[{ value: 'person', label: 'By person' }, { value: 'day', label: 'By day' }, { value: 'week', label: 'By week' }]} />
          <WSegmented<Metric> ariaLabel="Show" value={metric} onChange={(m) => { setMetric(m); setActive(null); }} options={[{ value: 'hours', label: 'Hours' }, { value: 'cost', label: 'Cost' }]} />
          <WSelect label="Person" value={who} onChange={(e) => { setWho(e.target.value); setActive(null); }} className="rp-who">
            <option value="">Everyone</option>
            {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </WSelect>
        </div>
      </div>

      <section className="sc-card sc-hover mt-4" aria-busy={!report}>
        <div className="sc-card-h">
          <div>
            <h2>{metric === 'hours' ? 'Hours worked' : 'Labour cost'}</h2>
            <small>{period.label}{metric === 'cost' && group !== 'person' ? ' · bars are hours × rate; the total includes overtime' : ''}</small>
          </div>
          <span className="sc-big tnum">{report ? show(shownTotal) : '…'}</span>
        </div>
        <WKpis items={[
          { label: 'Hours', value: report ? formatHours(totalMin) : '…' },
          { label: 'Cost', value: report ? money(totalCost) : '…' },
          { label: group === 'person' ? 'People' : group === 'day' ? 'Days' : 'Weeks', value: String(bars.length) },
        ]} />

        <div className="rp-chart" onPointerLeave={() => setHover(null)}>
          {!report && <span className="sc-skel absolute inset-0" />}
          {report && bars.length === 0 && <div className="sc-empty" style={{ padding: '40px 0' }}><span className="ic"><BarChart3 size={20} /></span><span>No hours in this period.</span></div>}
          {report && bars.length > 0 && (
            <div key={`${group}-${metric}-${period.from}`} className={cn('rp-bars', bars.length > 16 && 'dense')} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(${bars.length > 16 ? 14 : 28}px, ${bars.length > 16 ? '1fr' : '140px'}))` }}>
              {bars.map((b, i) => (
                <button key={b.key} type="button" className={cn('rp-bar', hover === i && 'on')} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${b.long}: ${formatHours(b.minutes)}, ${money(b.cost)}`}>
                  <span className="rp-col"><i style={{ height: `${(value(b) / max) * 100}%`, animationDelay: `${Math.min(i, 20) * 25}ms` }} /></span>
                  <small>{b.label}</small>
                </button>
              ))}
            </div>
          )}
          {h && <div className="rp-tip"><b>{h.long}</b><span>{formatHours(h.minutes)} · {money(h.cost)}</span></div>}
        </div>
      </section>

      <section className="sc-card mt-4">
        <div className="overflow-x-auto">
          <table className="sc-table pr-table">
            <thead><tr><th>{group === 'person' ? 'Person' : group === 'day' ? 'Day' : 'Week'}</th><th className="num">Hours</th><th className="num">Cost</th><th className="num">Share</th></tr></thead>
            <tbody>
              {bars.filter((b) => b.minutes > 0 || group === 'person').map((b) => (
                <tr key={b.key}><td>{b.long}</td><td className="num tnum">{formatHours(b.minutes)}</td><td className="num tnum">{money(b.cost)}</td><td className="num tnum">{totalMin ? Math.round((b.minutes / totalMin) * 100) : 0}%</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num tnum">{formatHours(totalMin)}</td><td className="num tnum">{money(totalCost)}</td><td /></tr></tfoot>
          </table>
        </div>
      </section>

      <SaveViewSheet open={naming} onClose={() => setNaming(false)} onSave={async (name) => {
        try { const v = await saveView(name, config()); setViews((x) => [...x, v]); setActive(v.id); setNaming(false); notify.success('View saved'); }
        catch (e) { notify.error(e instanceof AdminError ? e.message : 'Could not save the view.'); }
      }} />
    </>
  );
}

function SaveViewSheet({ open, onClose, onSave }: { open: boolean; onClose(): void; onSave(name: string): Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(''); setBusy(false); } }, [open]);
  return (
    <BottomSheet open={open} onClose={onClose} title="Save this view" footer={<WButton onClick={async () => { setBusy(true); await onSave(name); setBusy(false); }} disabled={busy || !name.trim()}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Save view'}</WButton>}>
      <p className="sheet-sub">Keeps the period, grouping, hours or cost, and person, so you can open it in one tap.</p>
      <WInput label="Name" placeholder="e.g. Monthly cost by person" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
    </BottomSheet>
  );
}
