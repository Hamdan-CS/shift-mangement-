import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Settings2, TrendingDown, TrendingUp } from 'lucide-react';
import { WKpis, WSegmented } from '@/components/app/ui';
import { useClock } from '@/contexts/ClockContext';
import { useCountUp } from '@/hooks/useCountUp';
import { fetchPayDays, fetchPayReport, type PayDay, type PayRow } from '@/services/pay';
import { formatHours, formatMoney } from '@/utils/labels';
import { cn } from '@/utils/cn';
import { addDays, dayKey, startOfWeek } from '@/utils/tz';

/* ============================================================
 * Labour cost (Amplo ref 02): week cost, today, per day, days left
 * + an interactive donut of regular / overtime / leave / breaks.
 * Numbers come from pay_report / pay_days (same as Payroll).
 * ============================================================ */

const SEG = [
  { key: 'regular', label: 'Regular', color: 'var(--accent)' },
  { key: 'overtime', label: 'Overtime', color: 'var(--amber)' },
  { key: 'leave', label: 'Leave', color: 'var(--green)' },
  { key: 'breaks', label: 'Breaks', color: 'var(--red)' },
] as const;
type SegKey = (typeof SEG)[number]['key'];

function useWeekPay() {
  const { timeZone: tz, version } = useClock();
  const [state, setState] = useState<{ week: PayRow[]; today: PayRow[]; days: PayDay[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const now = new Date();
    const from = dayKey(startOfWeek(now, tz), tz);
    const to = dayKey(addDays(startOfWeek(now, tz), 6, tz), tz);
    const today = dayKey(now, tz);
    const load = () => Promise.all([fetchPayReport(from, to), fetchPayReport(today, today), fetchPayDays(from, to)])
      .then(([week, t, days]) => { if (alive) setState({ week, today: t, days }); })
      .catch(() => { if (alive) setState({ week: [], today: [], days: [] }); });
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [tz, version]);
  return state;
}

export function LabourCostCard({ currency, canEdit }: { currency: string; canEdit: boolean }) {
  const navigate = useNavigate();
  const { timeZone: tz } = useClock();
  const data = useWeekPay();
  const money = (n: number) => formatMoney(n, currency);
  const sum = (rows: PayRow[] | undefined, k: keyof PayRow) => (rows ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0);

  const weekGross = sum(data?.week, 'gross');
  const weekNet = sum(data?.week, 'net');
  const todayGross = sum(data?.today, 'gross');
  const now = new Date();
  const dayNo = Math.round((Date.parse(dayKey(now, tz)) - Date.parse(dayKey(startOfWeek(now, tz), tz))) / 86_400_000) + 1; // Mon = 1
  const perDay = weekGross / Math.max(1, dayNo);
  const split: Record<SegKey, number> = {
    regular: sum(data?.week, 'regular_minutes'),
    overtime: sum(data?.week, 'overtime_minutes'),
    leave: sum(data?.week, 'leave_days') * 8 * 60,
    breaks: (data?.days ?? []).reduce((s, d) => s + d.break_minutes, 0),
  };
  const shown = useCountUp(weekGross);

  return (
    <section className="sc-card sc-hover grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" aria-busy={!data}>
      <div className="flex min-w-0 flex-col">
        <div className="sc-card-h">
          <div>
            <h2>Labour cost</h2>
            <small>This week, everyone on the team</small>
          </div>
          {canEdit && <button type="button" className="sc-iconbtn" aria-label="Pay rates" title="Pay rates" onClick={() => navigate('/admin/people')}><Settings2 size={16} /></button>}
        </div>
        <div className="sc-big tnum">{data ? money(shown) : <span className="sc-skel inline-block h-10 w-40 align-middle" />}</div>
        <WKpis items={[
          { label: 'Today', value: data ? money(todayGross) : '…' },
          { label: 'Per day', value: data ? money(perDay) : '…' },
          { label: 'Days left', value: `${Math.max(0, 7 - dayNo)} days` },
        ]} />
        <button type="button" className="sc-cta mt-5" onClick={() => navigate('/admin/payroll')}>
          <span className="sc-cta-ic" aria-hidden="true"><ArrowUpRight size={18} /></span>
          <span className="min-w-0 flex-1 text-left">
            <b>Net to pay this week</b>
            <small className="tnum">{data ? money(weekNet) : '…'} · open Payroll</small>
          </span>
        </button>
      </div>
      <HoursDonut split={split} loading={!data} />
    </section>
  );
}

/** Donut with solid segments that draw in; hover / tap a segment or legend row to focus it. */
export function HoursDonut({ split, loading }: { split: Record<SegKey, number>; loading?: boolean }) {
  const [focus, setFocus] = useState<SegKey | null>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setDrawn(true)); return () => cancelAnimationFrame(t); }, []);
  const total = SEG.reduce((s, x) => s + split[x.key], 0);
  const r = 78, c = 2 * Math.PI * r, gap = total ? 4 : 0;
  let offset = 0;
  const arcs = SEG.map((s) => {
    const frac = total ? split[s.key] / total : 0;
    const len = Math.max(0, frac * c - (frac > 0 ? gap : 0));
    const a = { ...s, frac, len, offset };
    offset += frac * c;
    return a;
  });
  const f = focus ? arcs.find((a) => a.key === focus)! : null;

  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 200" className="donut h-[196px] w-[196px] lg:h-[216px] lg:w-[216px]" role="img" aria-label={`Hours split: ${arcs.map((a) => `${a.label} ${Math.round(a.frac * 100)}%`).join(', ')}`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
        {arcs.map((a) => a.len > 0 && (
          <circle
            key={a.key} cx="100" cy="100" r={r} fill="none" stroke={a.color} strokeLinecap="round"
            strokeWidth={focus === a.key ? 24 : 18}
            strokeDasharray={`${drawn ? a.len : 0} ${c}`} strokeDashoffset={-a.offset}
            transform="rotate(-90 100 100)"
            className={cn('donut-seg', focus && focus !== a.key && 'dim')}
            onMouseEnter={() => setFocus(a.key)} onMouseLeave={() => setFocus(null)} onClick={() => setFocus(focus === a.key ? null : a.key)}
          />
        ))}
        <circle cx="100" cy="100" r="62" fill="var(--surface-2)" />
        <text x="100" y="98" textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--text)" style={{ letterSpacing: '-0.03em' }}>
          {loading ? '…' : f ? `${Math.round(f.frac * 100)}%` : formatHours(total)}
        </text>
        <text x="100" y="120" textAnchor="middle" fontSize="13" fill="var(--text-3)">{f ? f.label.toLowerCase() : 'this week'}</text>
      </svg>
      <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-[14px] lg:text-[12.5px]">
        {arcs.map((a) => (
          <li key={a.key}>
            <button type="button" className={cn('donut-key', focus === a.key && 'on')} onMouseEnter={() => setFocus(a.key)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(a.key)} onBlur={() => setFocus(null)}>
              <i style={{ background: a.color }} />
              {a.label}
              <b className="tnum">{Math.round(a.frac * 100)}%</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================
 * Hours worked, this period vs last (Amplo "Fans gained" card).
 * Real pay_days data; hover / drag across the chart for a tooltip.
 * ============================================================ */

type Range = 'week' | 'month' | 'year';
interface Bucket { label: string; long: string; cur: number; prev: number }

function buckets(days: PayDay[], range: Range, tz: string): Bucket[] {
  const byDay = new Map<string, number>();
  for (const d of days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.minutes);
  const now = new Date();
  const fmt = (k: string, o: Intl.DateTimeFormatOptions) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
  if (range === 'year') {
    const out: Bucket[] = [];
    const base = new Date(`${dayKey(now, tz).slice(0, 7)}-01T12:00:00Z`);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(base); m.setUTCMonth(m.getUTCMonth() - i);
      const p = new Date(m); p.setUTCFullYear(p.getUTCFullYear() - 1);
      const mk = m.toISOString().slice(0, 7), pk = p.toISOString().slice(0, 7);
      let cur = 0, prev = 0;
      for (const [k, v] of byDay) { if (k.startsWith(mk)) cur += v; else if (k.startsWith(pk)) prev += v; }
      out.push({ label: fmt(`${mk}-01`, { month: 'short' }), long: fmt(`${mk}-01`, { month: 'long', year: 'numeric' }), cur, prev });
    }
    return out;
  }
  const n = range === 'week' ? 7 : 30;
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(now, -(n - 1 - i), tz);
    const k = dayKey(d, tz), pk = dayKey(addDays(d, -n, tz), tz);
    return { label: fmt(k, range === 'week' ? { weekday: 'short' } : { day: 'numeric', month: 'short' }), long: fmt(k, { weekday: 'long', day: 'numeric', month: 'short' }), cur: byDay.get(k) ?? 0, prev: byDay.get(pk) ?? 0 };
  });
}

export function HoursChart({ subtitle }: { subtitle: string }) {
  const { timeZone: tz, version } = useClock();
  const [range, setRange] = useState<Range>('month');
  const [days, setDays] = useState<PayDay[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const span = range === 'week' ? 14 : range === 'month' ? 60 : 730;
    setDays(null);
    fetchPayDays(dayKey(addDays(now, -span - 31, tz), tz), dayKey(now, tz))
      .then((d) => { if (alive) setDays(d); })
      .catch(() => { if (alive) setDays([]); });
    return () => { alive = false; };
  }, [range, tz, version]);

  const data = useMemo(() => buckets(days ?? [], range, tz), [days, range, tz]);
  const cur = data.reduce((s, b) => s + b.cur, 0);
  const prev = data.reduce((s, b) => s + b.prev, 0);
  const delta = prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0;
  const peak = data.reduce((best, b, i) => (b.cur > (data[best]?.cur ?? 0) ? i : best), 0);
  const max = Math.max(60, ...data.map((b) => Math.max(b.cur, b.prev)));
  const stepH = niceStep(max / 60 / 4);
  const top = stepH * 4 * 60;
  const shown = useCountUp(cur);

  const W = 600, H = 200;
  const x = (i: number) => (data.length > 1 ? (i / (data.length - 1)) * W : W / 2);
  const y = (m: number) => H - (m / top) * H;
  const line = (k: 'cur' | 'prev') => data.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b[k]).toFixed(1)}`).join(' ');
  const area = `${line('cur')} L${W},${H} L0,${H} Z`;
  const empty = days !== null && cur === 0 && prev === 0;

  const move = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r || !data.length) return;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(((clientX - r.left) / r.width) * (data.length - 1)))));
  };
  const h = hover !== null ? data[hover] : null;
  const tick = range === 'month' ? 5 : 1;

  return (
    <section className="sc-card sc-hover flex flex-col">
      <div className="sc-card-h">
        <div>
          <h2>Hours worked</h2>
          <small>{subtitle}</small>
        </div>
        <WSegmented<Range> ariaLabel="Range" value={range} onChange={setRange} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="sc-big tnum">{days === null ? '…' : formatHours(Math.round(shown))}</span>
        <span className={cn('sc-delta', delta < 0 && 'down')}>{delta < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{Math.abs(delta)}%</span>
        <span className="text-[13px] text-ink-3">vs the previous {range === 'week' ? '7 days' : range === 'month' ? '30 days' : 'year'}</span>
        {cur > 0 && <span className="ml-auto sc-chip accent nodot"><TrendingUp size={12} /> Peak · {data[peak].label}</span>}
      </div>

      <div className="hc-wrap mt-5">
        <div className="hc-y" aria-hidden="true">{[4, 3, 2, 1, 0].map((i) => <span key={i}>{i * stepH}h</span>)}</div>
        <div
          ref={plot}
          className="hc-plot"
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Hours worked: ${formatHours(cur)} this period, ${formatHours(prev)} the one before`}
        >
          {[0, 1, 2, 3, 4].map((i) => <i key={i} className="hc-grid" style={{ top: `${i * 25}%` }} />)}
          {days !== null && !empty && (
            <svg key={range} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="hc-svg" aria-hidden="true">
              <defs>
                <linearGradient id="hc-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#hc-fill)" className="hc-area" />
              <path d={line('prev')} fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
              <path d={line('cur')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="hc-line" pathLength={1} />
            </svg>
          )}
          {h && hover !== null && (
            <>
              <i className="hc-cursor" style={{ left: `${(x(hover) / W) * 100}%` }} />
              <i className="hc-dot" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.cur) / H) * 100}%` }} />
              <div className={cn('hc-tip', hover > data.length / 2 && 'left')} style={{ left: `${(x(hover) / W) * 100}%` }}>
                <b>{h.long}</b>
                <span><i style={{ background: 'var(--accent)' }} />{formatHours(h.cur)}</span>
                <span><i className="dash" />{formatHours(h.prev)} before</span>
              </div>
            </>
          )}
          {days === null && <span className="sc-skel absolute inset-0" />}
          {empty && <span className="hc-empty">No hours logged yet</span>}
        </div>
        <div className="hc-x" aria-hidden="true">
          {data.map((b, i) => (i % tick === 0 || i === data.length - 1) && (data.length - 1 - i >= tick || i === data.length - 1) ? <span key={i} style={{ left: `${(x(i) / W) * 100}%` }} className={cn(range === 'year' && i % 2 === 1 && 'max-sm:hidden', range === 'month' && i % (tick * 2) !== 0 && i !== data.length - 1 && 'max-sm:hidden')}>{b.label}</span> : null)}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-5 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--accent)' }} />This period</span>
        <span className="inline-flex items-center gap-2"><i className="h-px w-3" style={{ borderTop: '1.5px dashed var(--text-2)' }} />The one before</span>
      </div>
    </section>
  );
}

function niceStep(v: number) {
  for (const s of [1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200, 250, 500, 1000]) if (s >= v) return s;
  return Math.ceil(v / 1000) * 1000;
}
