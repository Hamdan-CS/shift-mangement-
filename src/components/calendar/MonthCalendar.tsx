import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { useAuth } from '@/contexts/AuthContext';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { fetchPayDays, fetchPayReport, type PayDay, type PayRow } from '@/services/pay';
import { fetchShiftsRange, hm, toMin } from '@/services/schedules';
import { fetchLeaveFor } from '@/services/requests';
import { formatHours, formatMoney } from '@/utils/labels';
import { cn } from '@/utils/cn';
import { dayEarned } from '@/utils/pay';
import { clockTime, dayKey } from '@/utils/tz';
import type { LeaveRequest, ScheduleShift } from '@/types';

/**
 * One month calendar for the whole app (shift-calendar style): the person view
 * is used on My schedule and on a person's page, the team view on the manager
 * schedule. Monday first. Worked days are solid, planned shifts outlined, leave
 * striped, planned-but-not-worked past days marked "Missed".
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthBounds = (month: string) => {
  const from = `${month}-01`;
  const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return { from, to: d.toISOString().slice(0, 10), days: d.getUTCDate(), lead: (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7 };
};
const shiftMonth = (month: string, n: number) => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const h1 = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, '')}h`;
const planned = (list: ScheduleShift[]) => list.reduce((s, x) => s + toMin(x.end_time) - toMin(x.start_time), 0);

/** The grid itself. `render` draws what goes inside each day. */
function Grid({ month, onMonth, today, render, onPick, label }: { month: string; onMonth(m: string): void; today: string; render(d: string): React.ReactNode; onPick(d: string): void; label: string }) {
  const b = monthBounds(month);
  const cells = [...Array.from({ length: b.lead }, () => null), ...Array.from({ length: b.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <div className="mc">
      <div className="mc-nav">
        <button type="button" className="sc-iconbtn" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <b>{monthLabel(month)}</b>
        <button type="button" className="sc-iconbtn" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>
      <div className="mc-grid" role="grid" aria-label={label}>
        {DOW.map((d, i) => <span key={d} className={cn('mc-h', i >= 5 && 'we')}>{d}</span>)}
        {cells.map((d, i) => d === null ? <span key={`e${i}`} /> : (
          <button key={d} type="button" role="gridcell" className={cn('mc-d', d === today && 'today', i % 7 >= 5 && 'we', d < today && 'past')} onClick={() => onPick(d)} aria-label={new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}>
            <span className="mc-n tnum">{Number(d.slice(8))}</span>
            {render(d)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- one person ---------------- */

export function PersonMonth({ userId, rate, initialMonth, onMonth }: { userId: string; rate: number | null; initialMonth?: string; onMonth?(month: string): void }) {
  const { timeZone: tz, version } = useClock();
  const settings = useSettings();
  const money = (n: number) => formatMoney(n, settings?.currency ?? 'PLN');
  const today = dayKey(new Date(), tz);
  const [month, setMonthState] = useState(initialMonth ?? today.slice(0, 7));
  const setMonth = (m: string) => { setMonthState(m); onMonth?.(m); };
  const [data, setData] = useState<{ days: PayDay[]; shifts: ScheduleShift[]; leave: LeaveRequest[]; pay: PayRow | null } | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const { from, to } = monthBounds(month);
    setData(null);
    Promise.all([fetchPayDays(from, to), fetchShiftsRange(from, to, userId), fetchLeaveFor(userId, from, to), fetchPayReport(from, to)])
      .then(([d, s, l, r]) => { if (alive) setData({ days: d.filter((x) => x.user_id === userId), shifts: s, leave: l.filter((x) => x.status === 'approved'), pay: r.find((x) => x.user_id === userId) ?? null }); })
      .catch(() => { if (alive) setData({ days: [], shifts: [], leave: [], pay: null }); });
    return () => { alive = false; };
  }, [month, userId, version]);

  const byDay = useMemo(() => new Map((data?.days ?? []).map((d) => [d.day, d])), [data]);
  const shiftsOn = (d: string) => (data?.shifts ?? []).filter((s) => s.date === d);
  const leaveOn = (d: string) => (data?.leave ?? []).some((l) => d >= l.start_date && d <= l.end_date);
  const worked = (data?.days ?? []).reduce((s, d) => s + d.minutes, 0);
  const plannedMin = planned(data?.shifts ?? []);

  const render = (d: string) => {
    if (!data) return null;
    const w = byDay.get(d); const s = shiftsOn(d);
    if (w) return <i className={cn('mc-chip work', w.approved_by && 'appr')}>{h1(w.minutes)}</i>;
    if (leaveOn(d)) return <i className="mc-chip leave">Leave</i>;
    if (s.length && d < today) return <i className="mc-chip miss">Missed</i>;
    if (s.length) return <i className="mc-chip plan">{hm(s[0].start_time)}</i>;
    return null;
  };

  const p = pick ? byDay.get(pick) : undefined;
  const ps = pick ? shiftsOn(pick) : [];
  return (
    <>
      <div className="mc-sum">
        <div><small>Days worked</small><b className="tnum">{data ? data.days.length : '…'}</b></div>
        <div><small>Hours · {data ? formatHours(plannedMin) : '…'} planned</small><b className="tnum">{data ? formatHours(worked) : '…'}</b></div>
        <div><small>Gross{data?.pay?.overtime_minutes ? ` · OT ${formatHours(data.pay.overtime_minutes)}` : ''}</small><b className="tnum">{data ? money(data.pay?.gross ?? 0) : '…'}</b></div>
        <div><small>Net pay</small><b className="tnum">{data ? money(data.pay?.net ?? 0) : '…'}</b></div>
      </div>
      <Grid month={month} onMonth={setMonth} today={today} render={render} onPick={setPick} label="Your month" />
      <div className="mc-legend" aria-hidden="true">
        <span><i className="mc-chip work">8h</i>Worked</span>
        <span><i className="mc-chip plan">09:00</i>Planned</span>
        <span><i className="mc-chip leave">Leave</i>Leave</span>
        <span><i className="mc-chip miss">Missed</i>Not clocked</span>
      </div>
      <BottomSheet open={pick !== null} onClose={() => setPick(null)} title={pick ? new Date(`${pick}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : ''}>
        {pick && (
          <dl className="tl-dl">
            <div><dt>Planned</dt><dd className="tnum">{ps.length ? ps.map((s) => `${hm(s.start_time)}–${hm(s.end_time)}`).join(', ') : leaveOn(pick) ? 'On leave' : 'Off'}</dd></div>
            <div><dt>Clocked</dt><dd className="tnum">{p ? `${clockTime(p.first_in, tz)}–${p.last_out ? clockTime(p.last_out, tz) : 'now'}` : '—'}</dd></div>
            <div><dt>Hours</dt><dd className="tnum">{p ? formatHours(p.minutes) : '0h 00m'}</dd></div>
            <div><dt>Earned</dt><dd className="tnum">{money(p ? dayEarned(p, rate, data?.pay?.overtime_multiplier ?? 1.5) : 0)}</dd></div>
            {p?.overtime_minutes ? <div><dt>Overtime</dt><dd className="tnum">{formatHours(p.overtime_minutes)}</dd></div> : null}
            {p?.grace_minutes ? <div><dt>Late, still paid</dt><dd className="tnum">{p.grace_minutes} min</dd></div> : null}
            {p?.break_minutes ? <div><dt>Break</dt><dd className="tnum">{p.break_minutes} min</dd></div> : null}
            {p?.approved_by ? <div><dt>{p.approved_by === 'employee' ? 'Edited by' : 'Approved by'}</dt><dd>{p.approved_by === 'employee' ? 'Employee' : p.approved_by}</dd></div> : null}
          </dl>
        )}
      </BottomSheet>
    </>
  );
}

/* ---------------- the whole team (managers) ---------------- */

export function TeamMonth({ onDay }: { onDay(date: string): void }) {
  const { timeZone: tz, version } = useClock();
  const { profile } = useAuth();
  const today = dayKey(new Date(), tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<{ days: PayDay[]; shifts: ScheduleShift[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const { from, to } = monthBounds(month);
    setData(null);
    Promise.all([fetchPayDays(from, to), fetchShiftsRange(from, to)])
      .then(([d, s]) => { if (alive) setData({ days: d, shifts: s }); })
      .catch(() => { if (alive) setData({ days: [], shifts: [] }); });
    return () => { alive = false; };
  }, [month, version, profile?.id]);

  const worked = (d: string) => (data?.days ?? []).filter((x) => x.day === d);
  const plannedPeople = (d: string) => new Set((data?.shifts ?? []).filter((s) => s.date === d).map((s) => s.user_id)).size;
  const totalMin = (data?.days ?? []).reduce((s, x) => s + x.minutes, 0);
  const daysCovered = new Set((data?.days ?? []).map((x) => x.day)).size;
  const gaps = useMemo(() => {
    if (!data) return 0;
    const { from, to } = monthBounds(month);
    let n = 0;
    for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) if (d >= today && !data.shifts.some((s) => s.date === d)) n++;
    return n;
  }, [data, month, today]);

  const render = (d: string) => {
    if (!data) return null;
    const w = worked(d); const pp = plannedPeople(d);
    if (w.length) {
      const m = w.reduce((s, x) => s + x.minutes, 0);
      return <><i className="mc-chip work" title={`${w.length} worked · ${formatHours(m)}`}>{Math.round(m / 60)}h</i><i className="mc-count"><User size={11} aria-hidden="true" />{w.length}</i></>;
    }
    if (pp) return <i className="mc-chip plan" title={`${pp} planned`}><User size={11} aria-hidden="true" />{pp}</i>;
    if (d >= today) return <i className="mc-chip gap">None</i>;
    return null;
  };

  return (
    <>
      <div className="mc-sum">
        <div><small>Hours worked</small><b className="tnum">{data ? formatHours(totalMin) : '…'}</b></div>
        <div><small>Days with staff</small><b className="tnum">{data ? daysCovered : '…'}</b></div>
        <div><small>Planned shifts</small><b className="tnum">{data ? data.shifts.length : '…'}</b></div>
        <div><small>Days with nobody</small><b className={cn('tnum', gaps > 0 && 'bad')}>{data ? gaps : '…'}</b></div>
      </div>
      <Grid month={month} onMonth={setMonth} today={today} render={render} onPick={onDay} label="Team month" />
      <div className="mc-legend" aria-hidden="true">
        <span><i className="mc-chip work">24h</i>Hours worked</span>
        <span><i className="mc-chip plan"><User size={11} />2</i>People planned</span>
        <span><i className="mc-chip gap">None</i>Nobody planned</span>
      </div>
    </>
  );
}
