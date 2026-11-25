import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCopy, Copy, Lock, Plus, Repeat, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { useTodayBoard } from '@/hooks/useTodayBoard';
import { useMediaQuery, DESKTOP } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { WButton, WChip, WPageHeader, WSegmented, type WChipTone } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { TodaySchedule } from '@/components/dashboard/TodaySchedule';
import { PersonMonth } from '@/components/calendar/MonthCalendar';
import { useScheduleView, type ScheduleView } from '@/hooks/useScheduleView';
import { timeToMin } from '@/components/dashboard/statusMeta';
import { ShiftEditSheet, type ShiftDraft } from '@/components/schedule/ShiftEditSheet';
import { WeekGrid } from '@/components/schedule/WeekGrid';
import { dayMinutes, dayParts } from '@/components/schedule/days';
import { copyWeek, deleteShift, ensureWeek, fetchWeek, hm, saveShift, ScheduleError, setWeekStatus, shiftDate, toMin } from '@/services/schedules';
import { formatHours } from '@/utils/labels';
import { copyText, formatAvailability } from '@/utils/summary';
import { notify } from '@/utils/notify';
import { EmailMeButton } from '@/components/shared/EmailMeButton';
import { dayKey, minutesOfDay, startOfWeek } from '@/utils/tz';
import type { ScheduleShift, ScheduleWeek, WeekStatus } from '@/types';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS: Record<WeekStatus | 'none', { label: string; tone: WChipTone }> = {
  none: { label: 'Not started', tone: 'default' },
  draft: { label: 'Draft', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'ok' },
  locked: { label: 'Locked', tone: 'accent' },
};

type Editing = { date: string; shift: ScheduleShift | null; initial: ShiftDraft } | null;

/**
 * "/schedule" (employee): build next week and submit it (PLAN.md section 6,
 * Vernly planner ref 14), plus "Team today". Phone first.
 */
export function SchedulePage() {
  const { profile } = useAuth();
  const view = useScheduleView();
  const settings = useSettings();
  const { timeZone } = useClock();
  const desktop = useMediaQuery(DESKTOP);
  const now = useNow(60_000);
  const thisWeek = dayKey(startOfWeek(new Date(), timeZone), timeZone);
  const [weekStart, setWeekStart] = useState(() => shiftDate(dayKey(startOfWeek(new Date(), timeZone), timeZone), 7)); // next week
  const [week, setWeek] = useState<ScheduleWeek | null>(null);
  const [shifts, setShifts] = useState<ScheduleShift[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const board = useTodayBoard();

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)), [weekStart]);
  const today = dayKey(now, timeZone);
  const dayStart = timeToMin(settings?.day_start, 6 * 60);
  const dayEnd = timeToMin(settings?.day_end, 24 * 60);
  const locked = week?.status === 'locked';
  const total = dayMinutes(shifts ?? []);
  const status = STATUS[week?.status ?? 'none'];

  const deadlineDow = settings?.schedule_deadline_dow ?? 4;
  // "Copy schedule": the week on screen, ready to paste in a chat
  const shareWeek = async () => {
    if (!profile || !shifts) return;
    const text = formatAvailability({ name: profile.full_name, weekStart, shifts });
    if (await copyText(text)) notify.success('Schedule copied. Paste it in your chat.'); else notify.error('Could not copy.');
  };
  const deadlineDate = shiftDate(weekStart, -7 + ((deadlineDow + 6) % 7));
  const deadline = `${DOW[deadlineDow]} ${dayParts(deadlineDate).num} ${new Date(`${deadlineDate}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}, ${(settings?.schedule_deadline_time ?? '18:00').slice(0, 5)}`;
  const weekLabel = weekStart === thisWeek ? 'This week' : weekStart === shiftDate(thisWeek, 7) ? 'Next week' : weekStart < thisWeek ? 'Past week' : 'Later';
  const range = `${dayParts(days[0]).num} ${new Date(`${days[0]}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} – ${dayParts(days[6]).num} ${new Date(`${days[6]}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;

  const load = useCallback(async () => {
    if (!profile) return;
    setShifts(null);
    try {
      const r = await fetchWeek(profile.id, weekStart);
      setWeek(r.week);
      setShifts(r.shifts);
    } catch {
      setShifts([]);
      notify.error('Could not load your week. Check your connection.');
    }
  }, [profile, weekStart]);
  useEffect(() => { void load(); }, [load]);

  const fail = (e: unknown) => notify.error(e instanceof ScheduleError ? e.message : 'Could not save. Try again.');

  const openAdd = (date: string, startMin = 9 * 60) => {
    if (locked) return;
    const s = Math.min(startMin, 23 * 60);
    const e = Math.min(s + 8 * 60, 24 * 60 - 1);
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    setEditing({ date, shift: null, initial: { start: fmt(s), end: fmt(e), note: '' } });
  };
  const openEdit = (s: ScheduleShift) => setEditing({ date: s.date, shift: s, initial: { start: hm(s.start_time), end: hm(s.end_time), note: s.note ?? '' } });

  const onSave = async (d: ShiftDraft) => {
    if (!profile || !editing) return;
    const w = week ?? (await ensureWeek(profile.id, weekStart));
    setWeek(w);
    await saveShift({ id: editing.shift?.id, week: w, date: editing.date, start: d.start, end: d.end, note: d.note });
    setEditing(null);
    notify.success(editing.shift ? 'Shift updated' : 'Shift added');
    await load();
  };
  const onDelete = async () => {
    if (!editing?.shift || !week) return;
    await deleteShift(editing.shift, week);
    setEditing(null);
    notify.success('Shift removed');
    await load();
  };

  const copyLast = async () => {
    if (!profile) return;
    setBusy('copy');
    try {
      const w = week ?? (await ensureWeek(profile.id, weekStart));
      const n = await copyWeek(profile.id, shiftDate(weekStart, -7), w);
      notify.success(n ? `Copied ${n} ${n === 1 ? 'shift' : 'shifts'} from last week` : 'Nothing to copy: last week was empty or these days are already planned');
      await load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const submit = async () => {
    if (!profile) return;
    setBusy('submit');
    try {
      const w = week ?? (await ensureWeek(profile.id, weekStart));
      const next = await setWeekStatus(w, 'submitted');
      setWeek(next);
      navigator.vibrate?.(30);
      notify.success(`${weekLabel} submitted · ${formatHours(total)} planned`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const shiftsOf = (d: string) => (shifts ?? []).filter((s) => s.date === d);

  return (
    <>
      <WPageHeader title="My schedule" subtitle="Plan your week, see your month, see who is in today." />

      <div className="sc-viewbar">
        <WSegmented<ScheduleView> ariaLabel="View" value={view.value} onChange={view.set} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>

      {view.value === 'day' ? (
        <TodaySchedule rows={board.rows} loading={board.loading} dayStart={dayStart} dayEnd={dayEnd} timeZone={timeZone} title="Team today" />
      ) : view.value === 'month' ? (
        <section className="sc-card">{profile && <PersonMonth userId={profile.id} rate={profile.hourly_rate} />}</section>
      ) : (
        <div className="sc-grid">
          {/* week switcher + status */}
          <section className="sc-card">
            <div className="wk-nav">
              <button type="button" className="sc-iconbtn" aria-label="Previous week" disabled={weekStart <= thisWeek} onClick={() => setWeekStart((w) => shiftDate(w, -7))}><ChevronLeft size={18} /></button>
              <div className="min-w-0 text-center">
                <b>{weekLabel}</b>
                <small className="tnum">{range}</small>
              </div>
              <button type="button" className="sc-iconbtn" aria-label="Next week" disabled={weekStart >= shiftDate(thisWeek, 28)} onClick={() => setWeekStart((w) => shiftDate(w, 7))}><ChevronRight size={18} /></button>
            </div>
            <div className="wk-sum">
              <div>
                <div className="sc-big tnum">{shifts === null ? '…' : formatHours(total)}<small>planned</small></div>
                <p className="mt-1 text-[14px] text-ink-3 lg:text-[12.5px]">{locked ? 'Locked by your manager. Ask them for changes.' : `Submit by ${deadline}`}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <WChip tone={status.tone}>{status.label}</WChip>
                <EmailMeButton icon disabled={shifts === null} request={() => ({ kind: 'schedule', week: weekStart })} />
              </div>
            </div>
            {!locked && (
              <WButton block className="mt-3" onClick={submit} disabled={busy !== null || shifts === null || total === 0}>
                <Send size={17} /> {week?.status === 'submitted' ? 'Submit changes' : `Submit ${weekLabel.toLowerCase()}`}
              </WButton>
            )}
            <div className="wk-acts">
              <WButton tone="secondary" onClick={shareWeek} disabled={shifts === null}><ClipboardCopy size={16} /> Copy</WButton>
              {!locked && <WButton tone="secondary" onClick={copyLast} disabled={busy !== null || shifts === null}><Copy size={16} /> Last week</WButton>}
              {!locked && <WButton tone="secondary" onClick={() => setRepeatOpen(true)} disabled={busy !== null || shifts === null}><Repeat size={16} /> Every day</WButton>}
            </div>
            {locked && <div className="sc-alert info mt-4"><Lock size={16} className="mt-0.5 shrink-0" /><span>This week is locked. Your manager can still change it.</span></div>}
          </section>

          {/* the week */}
          {desktop ? (
            <section className="sc-card" aria-busy={shifts === null}>
              <WeekGrid days={days} shifts={shifts ?? []} dayStart={dayStart} dayEnd={dayEnd} today={today} nowMin={minutesOfDay(now, timeZone)} readOnly={locked} onAdd={openAdd} onEdit={(s) => (locked ? undefined : openEdit(s))} />
            </section>
          ) : (
            <ul className="wk-days" aria-busy={shifts === null}>
              {days.map((d) => {
                const p = dayParts(d);
                const list = shiftsOf(d);
                const mins = dayMinutes(list);
                return (
                  <li key={d} className={d === today ? 'wk-day today' : 'wk-day'}>
                    <div className="wk-day-h">
                      <div className="wk-date"><span>{p.dow}</span><b className="tnum">{p.num}</b></div>
                      <div className="min-w-0 flex-1">
                        <div className="wg-bar"><i style={{ width: `${Math.min(100, (mins / 480) * 100)}%` }} /></div>
                        {(shifts === null || !mins) && <small className="tnum">{shifts === null ? '…' : 'Off'}</small>}
                      </div>
                      {!locked && (
                        <button type="button" className="sc-iconbtn" aria-label={`Add shift on ${p.long}`} onClick={() => openAdd(d)}><Plus size={18} /></button>
                      )}
                    </div>
                    {list.length > 0 && (
                      <div className="wk-pills">
                        {list.map((s) => (
                          <button key={s.id} type="button" className="wk-pill" disabled={locked} onClick={() => openEdit(s)} aria-label={`${p.long} ${hm(s.start_time)} to ${hm(s.end_time)}${locked ? '' : ', edit'}`}>
                            <b className="tnum">{hm(s.start_time)}–{hm(s.end_time)}</b>
                            <small>{s.note || formatHours(toMin(hm(s.end_time)) - toMin(hm(s.start_time)))}</small>
                            {s.edited_by && <WChip tone="accent" dot={false}>Changed by manager</WChip>}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

        </div>
      )}

      <ShiftEditSheet
        open={editing !== null}
        title={editing ? (editing.shift ? 'Edit shift' : 'Add shift') : ''}
        subtitle={editing ? dayParts(editing.date).long : undefined}
        initial={editing?.initial ?? { start: '09:00', end: '17:00', note: '' }}
        isNew={!editing?.shift}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onDelete={editing?.shift ? onDelete : undefined}
      />

      <SameEveryDaySheet
        open={repeatOpen}
        days={days}
        taken={new Set((shifts ?? []).map((s) => s.date))}
        onClose={() => setRepeatOpen(false)}
        onApply={async (picked, d) => {
          if (!profile) return;
          const w = week ?? (await ensureWeek(profile.id, weekStart));
          let n = 0;
          for (const date of picked) { await saveShift({ week: w, date, start: d.start, end: d.end, note: d.note }); n++; }
          setRepeatOpen(false);
          notify.success(`Added ${n} ${n === 1 ? 'shift' : 'shifts'}`);
          await load();
        }}
      />
    </>
  );
}

/** "Same every day": one time range on the days you tick (skips days already planned). */
function SameEveryDaySheet({ open, days, taken, onClose, onApply }: {
  open: boolean; days: string[]; taken: Set<string>; onClose(): void; onApply(days: string[], d: ShiftDraft): Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [d, setD] = useState<ShiftDraft>({ start: '09:00', end: '17:00', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setPicked(days.slice(0, 5).filter((x) => !taken.has(x))); setError(null); setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = picked.length > 0 && toMin(d.end) > toMin(d.start);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Same every day"
      footer={<WButton disabled={!ok || busy} onClick={async () => { setBusy(true); setError(null); try { await onApply(picked, d); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{`Add to ${picked.length} ${picked.length === 1 ? 'day' : 'days'}`}</WButton>}
    >
      <p className="sheet-sub">One shift on every day you pick. Days that already have a shift are skipped.</p>
      <div className="wk-dayboxes" role="group" aria-label="Days">
        {days.map((x) => {
          const p = dayParts(x);
          const has = taken.has(x);
          const on = picked.includes(x);
          return (
            <button key={x} type="button" aria-pressed={on} disabled={has} onClick={() => setPicked((ps) => (on ? ps.filter((y) => y !== x) : [...ps, x]))}>
              <span>{p.dow}</span><b className="tnum">{p.num}</b>
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="w-field"><span className="w-label">Start</span><input className="w-input" type="time" step={900} value={d.start} onChange={(e) => setD((v) => ({ ...v, start: e.target.value }))} /></label>
        <label className="w-field"><span className="w-label">End</span><input className="w-input" type="time" step={900} value={d.end} onChange={(e) => setD((v) => ({ ...v, end: e.target.value }))} /></label>
      </div>
      {error && <div className="sc-alert danger mt-3" role="alert"><span>{error}</span></div>}
      {!ok && picked.length > 0 && <p className="mt-3 text-[14px] text-danger">The end time must be after the start time.</p>}
    </BottomSheet>
  );
}

