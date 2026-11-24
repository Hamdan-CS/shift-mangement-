import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Inbox, Loader2, Play, QrCode, Square, Wallet } from 'lucide-react';
import { WAvatar, WButton, WChip, WKpis } from '@/components/app/ui';
import { fetchTeam, subscribeNotifications } from '@/services/api';
import { fetchApprovals, LEAVE_LABEL } from '@/services/requests';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { useClock } from '@/contexts/ClockContext';
import { useAuth } from '@/contexts/AuthContext';
import { dayIndex, fetchMyShifts, hm, shiftDate, subscribeBoard, toMin } from '@/services/schedules';
import { dayParts } from '@/components/schedule/days';
import type { ScheduleShift } from '@/types';
import { useNow } from '@/hooks/useNow';
import { ClockError } from '@/services/api';
import { formatHours, formatMoney as money, relativeDate } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { totalMinutes, weekGross } from '@/utils/pay';
import { addDays, clockTime, dayKey, minutesOfDay } from '@/utils/tz';

/* ---------- employee: shift timer (Grovia ring) + big clock button ---------- */

export function ShiftRing({ seconds = 0, target = 8 * 3600, label, live }: { seconds?: number; target?: number; label: string; live?: boolean }) {
  const ticks = 60;
  const r = 86;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, seconds / target);
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  const a = p * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 220 220" className="h-[200px] w-[200px] lg:h-[208px] lg:w-[208px]" role="img" aria-label={`${label}: ${Number(hh)} hours ${Number(mm)} minutes`}>
      {Array.from({ length: ticks }, (_, i) => {
        const ang = (i / ticks) * 2 * Math.PI - Math.PI / 2;
        const long = i % 5 === 0;
        const r1 = 104, r2 = long ? 96 : 99;
        const lit = live && i / ticks <= p;
        return <line key={i} x1={110 + r1 * Math.cos(ang)} y1={110 + r1 * Math.sin(ang)} x2={110 + r2 * Math.cos(ang)} y2={110 + r2 * Math.sin(ang)} stroke={lit ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={long ? 1.6 : 1} strokeLinecap="round" />;
      })}
      <circle cx="110" cy="110" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
      {p > 0 && (
        <>
          <circle cx="110" cy="110" r={r} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 110 110)" />
          {live && <circle cx={110 + r * Math.cos(a)} cy={110 + r * Math.sin(a)} r="4" fill="var(--text)" />}
        </>
      )}
      <circle cx="110" cy="110" r="68" fill="var(--surface-2)" />
      <text x="110" y="114" textAnchor="middle" fontSize="36" fontWeight="600" fill="var(--text)" style={{ letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{hh}:{mm}</text>
      <text x="110" y="138" textAnchor="middle" fontSize="13" fill={live ? 'var(--accent)' : 'var(--text-3)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{live ? `${label} · ${ss}s` : label}</text>
    </svg>
  );
}

/** Clock card: live timer ring (Grovia), today / week / earned, big Start / Finish button (PLAN.md 7, 10c). */
export function MyShiftCard({ currency, rate, overtimeAfterHours, overtimeMultiplier, buttonAllowed = true }: { currency: string; rate: number | null; overtimeAfterHours: number; overtimeMultiplier: number; /** false = staff must scan the QR code at work */ buttonAllowed?: boolean }) {
  const clock = useClock();
  const now = useNow(clock.open ? 1000 : 30_000);
  const [confirm, setConfirm] = useState(false);
  const tz = clock.timeZone;
  const todayEnd = addDays(clock.todayStart, 1, tz);
  const weekEnd = addDays(clock.weekStart, 7, tz);
  const today = totalMinutes(clock.week, clock.todayStart, todayEnd, now);
  const week = totalMinutes(clock.week, clock.weekStart, weekEnd, now);
  const pay = weekGross(week, rate, overtimeAfterHours, overtimeMultiplier);
  const shiftSecs = clock.open ? Math.max(0, (now.getTime() - new Date(clock.open.clock_in).getTime()) / 1000) : 0;
  const finishedToday = !clock.open && clock.week.find((e) => e.clock_out && new Date(e.clock_out) >= clock.todayStart);

  const start = async () => {
    try {
      const e = await clock.start();
      navigator.vibrate?.(30);
      notify.success(`Clocked in at ${clockTime(e.clock_in, tz)}`);
    } catch (err) {
      notify.error(err instanceof ClockError ? err.message : 'Could not clock in. Try again.');
    }
  };
  const finish = async () => {
    try {
      const e = await clock.finish();
      setConfirm(false);
      navigator.vibrate?.([30, 60, 30]);
      notify.success(`Clocked out at ${clockTime(e.clock_out!, tz)} · ${formatHours((new Date(e.clock_out!).getTime() - new Date(e.clock_in).getTime()) / 60000)}`);
    } catch (err) {
      setConfirm(false);
      notify.error(err instanceof ClockError ? err.message : 'Could not clock out. Try again.');
    }
  };

  const status = clock.open
    ? { chip: <WChip tone="ok">Working</WChip>, line: `On shift since ${clockTime(clock.open.clock_in, tz)}` }
    : finishedToday
      ? { chip: <WChip tone="default">Finished</WChip>, line: `Finished at ${clockTime(finishedToday.clock_out!, tz)}` }
      : { chip: <WChip tone="default">Off</WChip>, line: 'Not clocked in' };

  return (
    <section className="sc-card flex flex-col" aria-busy={clock.loading}>
      <div className="sc-card-h">
        <div>
          <h2>My shift</h2>
          <small>{clock.loading ? 'Loading…' : status.line}</small>
        </div>
        {!clock.loading && status.chip}
      </div>
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 md:order-1">
          <div className="sc-big tnum">{formatHours(week)}<small>this week</small></div>
          <WKpis items={[
            { label: 'Today', value: formatHours(today) },
            { label: 'Earned', value: money(pay.gross, currency) },
            { label: 'Overtime', value: formatHours(pay.overtime * 60) },
          ]} />
        </div>
        <div className="flex justify-center md:order-2">
          <ShiftRing seconds={clock.open ? shiftSecs : today * 60} label={clock.open ? 'On shift' : finishedToday ? 'Worked today' : 'Not clocked in'} live={Boolean(clock.open)} />
        </div>
      </div>

      {/* Clock button: big, full width, thumb-reachable (PLAN.md 10c). */}
      {!buttonAllowed ? (
        <div className="sc-inset mt-5 flex items-center gap-3 lg:mt-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-surface text-accent"><QrCode size={22} /></span>
          <div className="min-w-0">
            <b className="block text-[16px] font-semibold lg:text-[13.5px]">Scan the code at work</b>
            <small className="block text-[14px] text-ink-3 lg:text-[12px]">Point your phone camera at the QR code by the door to clock {clock.open ? 'out' : 'in'}.</small>
          </div>
        </div>
      ) : clock.open ? (
        <WButton tone="solid" size="lg" block className="mt-5 lg:mt-6" disabled={clock.busy} onClick={() => setConfirm(true)}>
          <Square size={16} fill="currentColor" /> Finish shift
        </WButton>
      ) : (
        <WButton size="lg" block className="mt-5 lg:mt-6" disabled={clock.loading || clock.busy} onClick={start}>
          {clock.busy ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />} Start shift
        </WButton>
      )}
      <p className="mt-2 text-center text-[13px] text-ink-3 lg:text-[12px]">Times are set by the server clock, not your phone.</p>

      <BottomSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Finish your shift?"
        footer={(
          <>
            <WButton tone="secondary" onClick={() => setConfirm(false)}>Keep working</WButton>
            <WButton tone="solid" disabled={clock.busy} onClick={finish}>{clock.busy ? <Loader2 size={18} className="animate-spin" /> : 'Finish shift'}</WButton>
          </>
        )}
      >
        <dl className="tl-dl">
          <div><dt>Started</dt><dd className="tnum">{clock.open ? clockTime(clock.open.clock_in, tz) : '—'}</dd></div>
          <div><dt>This shift</dt><dd className="tnum">{formatHours(shiftSecs / 60)}</dd></div>
          <div><dt>Today</dt><dd className="tnum">{formatHours(today)}</dd></div>
          <div><dt>This week</dt><dd className="tnum">{formatHours(week)}</dd></div>
        </dl>
        <p className="mt-3 text-[14px] text-ink-3 lg:text-[12px]">Wrong time later? Ask your manager for a correction.</p>
      </BottomSheet>
    </section>
  );
}

/* ---------- employee: "Next shift" (Vernly "Up next", ref 15) ---------- */

export function NextShiftCard({ deadline }: { deadline: string }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const clock = useClock();
  const now = useNow(30_000);
  const [shifts, setShifts] = useState<ScheduleShift[] | null>(null);
  const tz = clock.timeZone;
  const today = dayKey(now, tz);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const load = () => fetchMyShifts(profile.id, today, shiftDate(today, 14))
      .then((l) => { if (alive) setShifts(l); })
      .catch(() => { if (alive) setShifts([]); });
    void load();
    const off = subscribeBoard(() => { void load(); });
    return () => { alive = false; off(); };
  }, [profile, today]);

  // the first shift that hasn't ended yet
  const nowMin = minutesOfDay(now, tz);
  const next = (shifts ?? []).find((s) => s.date > today || toMin(hm(s.end_time)) > nowMin) ?? null;
  const startsIn = next ? dayIndex(today, next.date) * 1440 + toMin(hm(next.start_time)) - nowMin : 0;
  const length = next ? toMin(hm(next.end_time)) - toMin(hm(next.start_time)) : 0;
  const when = next ? (next.date === today ? 'Today' : next.date === shiftDate(today, 1) ? 'Tomorrow' : dayParts(next.date).long) : '';
  const inText = startsIn <= 0 ? 'Now' : startsIn < 60 ? `in ${Math.round(startsIn)} min` : startsIn < 1440 ? `in ${formatHours(startsIn).replace(' 00m', 'h')}` : `in ${Math.round(startsIn / 1440)} ${Math.round(startsIn / 1440) === 1 ? 'day' : 'days'}`;
  const chip = !next ? <WChip tone="warn">Not planned</WChip> : startsIn <= 0 ? <WChip tone="ok">On now</WChip> : startsIn < 120 ? <WChip tone="accent">Soon</WChip> : <WChip tone="default">Planned</WChip>;

  return (
    <section className="sc-card" aria-busy={shifts === null}>
      <div className="sc-card-h" style={{ marginBottom: 10 }}>
        <div>
          <h2>Next shift</h2>
          <small>{shifts === null ? 'Loading…' : next ? `${when} · ${hm(next.start_time)}–${hm(next.end_time)}` : 'Nothing planned in the next two weeks'}</small>
        </div>
        {shifts !== null && chip}
      </div>
      <div className="mb-4 border-l-[3px] pl-3" style={{ borderColor: 'var(--accent)' }}>
        <b className="block text-[17px] font-semibold tracking-[-0.01em] lg:text-[15px]">{next ? (next.note || (profile?.job_title ?? 'Shift')) : 'Plan next week'}</b>
        <small className="block text-[14px] text-ink-3 lg:text-[12px]">{next ? `${when}, ${hm(next.start_time)} to ${hm(next.end_time)}` : `Submit your days by ${deadline}`}</small>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="sc-inset"><small className="block text-[13px] text-ink-3 lg:text-[12px]">Starts</small><b className="block text-[22px] font-semibold tracking-[-0.02em] tnum">{next ? inText : '—'}</b></div>
        <div className="sc-inset"><small className="block text-[13px] text-ink-3 lg:text-[12px]">Shift length</small><b className="block text-[22px] font-semibold tracking-[-0.02em] tnum">{next ? formatHours(length) : '—'}</b></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <WButton tone="secondary" onClick={() => navigate('/today')}>Team today</WButton>
        <WButton onClick={() => navigate('/schedule')}><CalendarPlus size={17} /> {next ? 'My week' : 'Plan week'}</WButton>
      </div>
    </section>
  );
}

/* ---------- manager: link to own history ---------- */

export function HistoryLinkCard() {
  const navigate = useNavigate();
  const clock = useClock();
  const now = useNow(60_000);
  const week = totalMinutes(clock.week, clock.weekStart, addDays(clock.weekStart, 7, clock.timeZone), now);
  return (
    <section className="sc-card flex flex-col">
      <div className="sc-card-h">
        <div>
          <h2>My hours</h2>
          <small>Your own shifts this week</small>
        </div>
      </div>
      <div className="sc-big tnum">{formatHours(week)}</div>
      <p className="mt-2 text-[14px] text-ink-3 lg:text-[12px]">{clock.week.length} {clock.week.length === 1 ? 'shift' : 'shifts'} since Monday</p>
      <WButton tone="secondary" block className="mt-auto" onClick={() => navigate('/history')}>Open my history</WButton>
    </section>
  );
}

/* ---------- manager / owner: approvals waiting ---------- */

export function PendingApprovalsCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [rows, setRows] = useState<{ id: string; who: string; what: string; when: string }[] | null>(null);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const load = async () => {
      try {
        const [{ corrections, leave, pay }, team] = await Promise.all([fetchApprovals(), fetchTeam()]);
        const name = (id: string) => team.find((p) => p.id === id)?.full_name ?? 'Someone';
        const list = [
          ...corrections.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, who: name(c.user_id), what: c.entry_id ? 'Time fix' : 'Missing shift', when: c.created_at })),
          ...leave.filter((l) => l.status === 'pending').map((l) => ({ id: l.id, who: name(l.user_id), what: LEAVE_LABEL[l.type], when: l.created_at })),
          // pay rates are the owner's call, so only the owner counts them as waiting
          ...(profile.role === 'owner' ? pay.filter((x) => x.status === 'pending').map((x) => ({ id: x.id, who: name(x.user_id), what: 'Pay rate change', when: x.created_at })) : []),
        ].sort((x, y) => x.when.localeCompare(y.when));
        if (alive) setRows(list);
      } catch { if (alive) setRows([]); }
    };
    void load();
    const off = subscribeNotifications(profile.id, () => { void load(); });
    return () => { alive = false; off(); };
  }, [profile]);

  return (
    <section className="sc-card sc-hover flex flex-col">
      <div className="sc-card-h">
        <div>
          <h2>Pending approvals</h2>
          <small>Corrections and leave requests</small>
        </div>
        <span className={rows?.length ? 'ap-count on' : 'ap-count'} aria-label={`${rows?.length ?? 0} waiting`}>{rows === null ? '…' : rows.length}</span>
      </div>
      {rows !== null && rows.length === 0 && (
        <div className="sc-empty" style={{ padding: '12px 0 4px' }}>
          <span className="ic"><Inbox size={20} /></span>
          <span>Nothing waiting for you.</span>
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="rq-list">
          {rows.slice(0, 3).map((r) => (
            <li key={r.id} className="rq-item" style={{ alignItems: 'center' }}>
              <span className="sc-person min-w-0">
                <WAvatar name={r.who} size={34} />
                <span className="min-w-0"><b>{r.who}</b><small>{r.what}</small></span>
              </span>
              <small className="shrink-0 text-[13px] text-ink-3 lg:text-[12px]">{relativeDate(r.when)}</small>
            </li>
          ))}
        </ul>
      )}
      <WButton tone={rows?.length ? 'primary' : 'secondary'} block className="mt-auto" style={{ marginTop: 12 }} onClick={() => navigate('/admin/approvals')}>
        {rows?.length ? `Review ${rows.length} ${rows.length === 1 ? 'request' : 'requests'}` : 'Open approvals'}
      </WButton>
    </section>
  );
}

/* ---------- "Payroll closes in" / "Payday in" countdown tiles ---------- */

function endOfWeek(now: Date) {
  const d = new Date(now);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  d.setHours(23, 59, 59, 999);
  return d;
}

export function PayrollCountdown({ title, label }: { title: string; label: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const end = endOfWeek(now);
  const left = Math.max(0, end.getTime() - now.getTime());
  const parts = [
    { v: Math.floor(left / 86_400_000), l: 'Days' },
    { v: Math.floor(left / 3_600_000) % 24, l: 'Hrs' },
    { v: Math.floor(left / 60_000) % 60, l: 'Min' },
    { v: Math.floor(left / 1000) % 60, l: 'Sec' },
  ];
  const dayOfPeriod = ((now.getDay() + 6) % 7) + 1; // Mon = 1

  return (
    <section className="sc-card flex flex-col">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px]" style={{ background: 'var(--tint-1)', color: 'var(--tint-1-ink)' }}><Wallet size={20} /></span>
        <div className="min-w-0">
          <small className="block text-[13px] text-ink-3 lg:text-[12px]">{label}</small>
          <b className="block text-[18px] font-semibold tracking-[-0.01em] lg:text-[17px]">{title}</b>
          <small className="block text-[13px] text-ink-3 lg:text-[12px]">{end.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · 23:59</small>
        </div>
      </div>
      <div className="sc-tiles" role="timer" aria-label={`${parts[0].v} days ${parts[1].v} hours ${parts[2].v} minutes left`}>
        {parts.map((p, i) => (
          <div key={p.l} className={i === 3 ? 'sc-tile accent' : 'sc-tile'} aria-hidden="true">
            <b>{String(p.v).padStart(2, '0')}</b>
            <small>{p.l}</small>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between text-[14px] lg:text-[12px]">
        <span className="text-ink-2">Pay period</span>
        <b className="font-semibold tnum">{dayOfPeriod}/7</b>
      </div>
      <div className="sc-bar mt-2"><i style={{ width: `${(dayOfPeriod / 7) * 100}%` }} /></div>
    </section>
  );
}
