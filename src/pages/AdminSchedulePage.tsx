import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Lock, LockOpen, Plus, UserX } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { useTodayBoard } from '@/hooks/useTodayBoard';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { fetchTeam } from '@/services/api';
import { deleteShift, ensureWeek, fetchTeamWeek, hm, saveShift, ScheduleError, setWeekStatus, shiftDate, subscribeBoard, toMin } from '@/services/schedules';
import { TeamMonth } from '@/components/calendar/MonthCalendar';
import { useScheduleView, type ScheduleView } from '@/hooks/useScheduleView';
import { WAvatar, WBox, WButton, WChip, WPageHeader, WSegmented, type WChipTone } from '@/components/app/ui';
import { ShiftEditSheet, type ShiftDraft } from '@/components/schedule/ShiftEditSheet';
import { dayMinutes, dayParts } from '@/components/schedule/days';
import { timeToMin } from '@/components/dashboard/statusMeta';
import { formatHours } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { cn } from '@/utils/cn';
import { dayKey, minutesOfDay, startOfWeek } from '@/utils/tz';
import type { PublicProfile, ScheduleShift, ScheduleWeek, WeekStatus } from '@/types';

const WEEK_STATUS: Record<WeekStatus | 'none', { label: string; tone: WChipTone }> = {
  none: { label: 'Not started', tone: 'danger' },
  draft: { label: 'Draft', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'ok' },
  locked: { label: 'Locked', tone: 'accent' },
};

type Editing = { person: PublicProfile; date: string; shift: ScheduleShift | null; initial: ShiftDraft } | null;
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * "/admin/schedule" (manager / owner): Day view (default, auto-filled from
 * everyone's weeks + live status, Mendo ref 13) and Week view (edit any shift,
 * gaps, not-submitted list, lock the week). PLAN.md sections 6 and 10.
 */
export function AdminSchedulePage() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { timeZone } = useClock();
  const now = useNow(30_000);
  const wide = useMediaQuery('(min-width: 640px)');
  const { value: view, set: setView } = useScheduleView('day');
  const today = dayKey(now, timeZone);
  const [date, setDate] = useState(today);
  const thisWeek = dayKey(startOfWeek(new Date(), timeZone), timeZone);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [team, setTeam] = useState<PublicProfile[] | null>(null);
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([]);
  const [shifts, setShifts] = useState<ScheduleShift[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [locking, setLocking] = useState(false);
  const board = useTodayBoard();

  // Day view reads the week the chosen day is in.
  const activeWeek = view === 'day' ? dayKey(startOfWeek(new Date(`${date}T12:00:00Z`), 'UTC'), 'UTC') : weekStart;
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(activeWeek, i)), [activeWeek]);
  const dayStart = timeToMin(settings?.day_start, 6 * 60);
  const dayEnd = timeToMin(settings?.day_end, 24 * 60);

  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([fetchTeam(), fetchTeamWeek(activeWeek)]);
      setTeam(t.filter((p) => p.role !== 'owner'));
      setWeeks(w.weeks);
      setShifts(w.shifts);
    } catch {
      setShifts([]);
      notify.error('Could not load the schedule. Check your connection.');
    }
  }, [activeWeek]);
  useEffect(() => { setShifts(null); void load(); }, [load]);
  useEffect(() => subscribeBoard(() => { void load(); }), [load]);

  const people = team ?? [];
  const weekOf = (uid: string) => weeks.find((w) => w.user_id === uid) ?? null;
  const shiftsOf = (uid: string, d: string) => (shifts ?? []).filter((s) => s.user_id === uid && s.date === d);
  const statusOf = (uid: string) => board.rows.find((r) => r.person.id === uid)?.status;

  const openAdd = (person: PublicProfile, d: string) => setEditing({ person, date: d, shift: null, initial: { start: '09:00', end: '17:00', note: '' } });
  const openEdit = (person: PublicProfile, s: ScheduleShift) => setEditing({ person, date: s.date, shift: s, initial: { start: hm(s.start_time), end: hm(s.end_time), note: s.note ?? '' } });

  const onSave = async (d: ShiftDraft) => {
    if (!editing) return;
    const w = await ensureWeek(editing.person.id, dayKey(startOfWeek(new Date(`${editing.date}T12:00:00Z`), 'UTC'), 'UTC'));
    await saveShift({ id: editing.shift?.id, week: w, date: editing.date, start: d.start, end: d.end, note: d.note }, true);
    const who = editing.person.full_name.split(' ')[0];
    setEditing(null);
    notify.success(editing.shift ? `${who}'s shift updated` : `Shift added for ${who}`);
    await load();
  };
  const onDelete = async () => {
    if (!editing?.shift) return;
    const w = weekOf(editing.person.id);
    if (!w) return;
    await deleteShift(editing.shift, w, true);
    setEditing(null);
    notify.success('Shift removed');
    await load();
  };

  const allLocked = people.length > 0 && people.every((p) => weekOf(p.id)?.status === 'locked');
  const toggleLock = async () => {
    setLocking(true);
    try {
      for (const p of people) {
        const w = weekOf(p.id) ?? (await ensureWeek(p.id, weekStart));
        if (allLocked) await setWeekStatus(w, w.submitted_at ? 'submitted' : 'draft', true);
        else if (w.status !== 'locked') await setWeekStatus(w, 'locked', true);
      }
      notify.success(allLocked ? 'Week unlocked: people can edit again' : 'Week locked: only managers can change it now');
      await load();
    } catch (e) {
      notify.error(e instanceof ScheduleError ? e.message : 'Could not change the lock. Try again.');
    } finally {
      setLocking(false);
    }
  };

  const notSubmitted = people.filter((p) => { const s = weekOf(p.id)?.status; return !s || s === 'draft'; });
  const range = `${dayParts(days[0]).num} – ${dayParts(days[6]).num} ${new Date(`${days[6]}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;

  return (
    <>
      <WPageHeader
        title="Schedule"
        subtitle="Day: who works when. Week: edit and lock. Month: the whole team at a glance."
        actions={view === 'week' ? (
          <WButton tone={allLocked ? 'secondary' : 'primary'} onClick={toggleLock} disabled={locking || shifts === null || !profile}>
            {locking ? <Loader2 size={17} className="animate-spin" /> : allLocked ? <LockOpen size={17} /> : <Lock size={17} />} {allLocked ? 'Unlock week' : 'Lock week'}
          </WButton>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WSegmented<ScheduleView> ariaLabel="View" value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        {view !== 'month' && <div className="wk-nav" style={{ minWidth: 260 }}>
          <button type="button" className="sc-iconbtn" aria-label={view === 'day' ? 'Previous day' : 'Previous week'} onClick={() => (view === 'day' ? setDate((d) => shiftDate(d, -1)) : setWeekStart((w) => shiftDate(w, -7)))}><ChevronLeft size={18} /></button>
          <div className="min-w-0 text-center">
            <b>{view === 'day' ? (date === today ? 'Today' : dayParts(date).long) : weekStart === thisWeek ? 'This week' : weekStart === shiftDate(thisWeek, 7) ? 'Next week' : 'Week'}</b>
            <small className="tnum">{view === 'day' ? dayParts(date).long : range}</small>
          </div>
          <button type="button" className="sc-iconbtn" aria-label={view === 'day' ? 'Next day' : 'Next week'} onClick={() => (view === 'day' ? setDate((d) => shiftDate(d, 1)) : setWeekStart((w) => shiftDate(w, 7)))}><ChevronRight size={18} /></button>
        </div>}
      </div>

      {view === 'month' ? (
        <section className="sc-card"><TeamMonth onDay={(d) => { setDate(d); setView('day'); }} /></section>
      ) : view === 'day' ? (
        <DayView
          people={people}
          shifts={(shifts ?? []).filter((s) => s.date === date)}
          loading={shifts === null}
          dayStart={dayStart}
          dayEnd={dayEnd}
          nowMin={date === today ? minutesOfDay(now, timeZone) : null}
          statusOf={date === today ? statusOf : () => undefined}
          onEdit={openEdit}
          onWeek={() => { setWeekStart(activeWeek); setView('week'); }}
        />
      ) : (
        <div className="sc-grid">
          {notSubmitted.length > 0 && shifts !== null && (
            <WBox title={`Not submitted (${notSubmitted.length})`} meta={`Deadline ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings?.schedule_deadline_dow ?? 4]} ${(settings?.schedule_deadline_time ?? '18:00').slice(0, 5)} the week before`}>
              <div className="flex flex-wrap gap-2">
                {notSubmitted.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-1 pr-3 text-[14px] lg:text-[13px]">
                    <WAvatar name={p.full_name} src={p.avatar_url} size={28} />{p.full_name}
                    <WChip tone={WEEK_STATUS[weekOf(p.id)?.status ?? 'none'].tone} dot={false}>{WEEK_STATUS[weekOf(p.id)?.status ?? 'none'].label}</WChip>
                  </span>
                ))}
              </div>
            </WBox>
          )}

          <section className="sc-card" aria-busy={shifts === null}>
            {wide ? (
              <div className="overflow-x-auto">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      {days.map((d) => <th key={d} className={d === today ? 'today' : undefined}>{dayParts(d).dow} {dayParts(d).num}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => {
                      const st = WEEK_STATUS[weekOf(p.id)?.status ?? 'none'];
                      return (
                        <tr key={p.id}>
                          <td>
                            <div className="sc-person">
                              <WAvatar name={p.full_name} src={p.avatar_url} size={32} />
                              <div className="min-w-0"><b>{p.full_name}</b><small><WChip tone={st.tone} dot={false}>{st.label}</WChip></small></div>
                            </div>
                          </td>
                          {days.map((d) => (
                            <td key={d}>
                              <div className="mw-cell">
                                {shiftsOf(p.id, d).map((s) => (
                                  <button key={s.id} type="button" className={cn('mw-shift', s.edited_by && 'edited')} onClick={() => openEdit(p, s)} aria-label={`${p.full_name}, ${dayParts(d).long}, ${hm(s.start_time)} to ${hm(s.end_time)}. Edit`}>
                                    {hm(s.start_time)}–{hm(s.end_time)}
                                  </button>
                                ))}
                                <button type="button" className="mw-add" onClick={() => openAdd(p, d)} aria-label={`Add shift for ${p.full_name} on ${dayParts(d).long}`}><Plus size={14} /></button>
                              </div>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>People per day</td>
                      {days.map((d) => {
                        const n = people.filter((p) => shiftsOf(p.id, d).length > 0).length;
                        const mins = dayMinutes((shifts ?? []).filter((s) => s.date === d));
                        return <td key={d} className={n === 0 && shifts !== null ? 'gap' : undefined}>{n === 0 ? 'Nobody' : `${n} · ${formatHours(mins)}`}</td>;
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="mw-cards">
                {people.map((p) => {
                  const st = WEEK_STATUS[weekOf(p.id)?.status ?? 'none'];
                  return (
                    <div key={p.id} className="border-b pb-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                      <div className="sc-person">
                        <WAvatar name={p.full_name} src={p.avatar_url} size={40} />
                        <div className="min-w-0 flex-1"><b>{p.full_name}</b><small>{formatHours(dayMinutes((shifts ?? []).filter((s) => s.user_id === p.id)))} planned</small></div>
                        <WChip tone={st.tone} dot={false}>{st.label}</WChip>
                      </div>
                      <div className="mw-card-days">
                        {days.map((d) => {
                          const list = shiftsOf(p.id, d);
                          return (
                            <button key={d} type="button" className={cn('mw-card-day', list.length > 0 && 'on', d === today && 'today')} onClick={() => (list[0] ? openEdit(p, list[0]) : openAdd(p, d))} aria-label={`${p.full_name}, ${dayParts(d).long}: ${list.length ? list.map((s) => `${hm(s.start_time)} to ${hm(s.end_time)}`).join(', ') : 'off'}. ${list.length ? 'Edit' : 'Add shift'}`}>
                              <span className="dow">{dayParts(d).dow.slice(0, 2)}</span>
                              <span className="num tnum">{dayParts(d).num}</span>
                              {list.length ? <b className="tnum">{hm(list[0].start_time)}<br />{hm(list[0].end_time)}</b> : <small aria-hidden="true">+</small>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <ShiftEditSheet
        open={editing !== null}
        title={editing ? `${editing.shift ? 'Edit' : 'Add'} shift · ${editing.person.full_name.split(' ')[0]}` : ''}
        subtitle={editing ? `${dayParts(editing.date).long}. ${editing.person.full_name.split(' ')[0]} will see this change.` : undefined}
        initial={editing?.initial ?? { start: '09:00', end: '17:00', note: '' }}
        isNew={!editing?.shift}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onDelete={editing?.shift ? onDelete : undefined}
      />
    </>
  );
}

/* ---------------- Day view: one column per job, shifts as blocks ---------------- */

function DayView({ people, shifts, loading, dayStart, dayEnd, nowMin, statusOf, onEdit, onWeek }: {
  people: PublicProfile[];
  shifts: ScheduleShift[];
  loading: boolean;
  dayStart: number;
  dayEnd: number;
  nowMin: number | null;
  statusOf(uid: string): string | undefined;
  onEdit(p: PublicProfile, s: ScheduleShift): void;
  onWeek(): void;
}) {
  const HOUR = 64;
  const byId = new Map(people.map((p) => [p.id, p]));
  const cols = useMemo(() => {
    const map = new Map<string, ScheduleShift[]>();
    for (const s of shifts) {
      const job = byId.get(s.user_id)?.job_title || 'Team';
      map.set(job, [...(map.get(job) ?? []), s]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, people]);
  const hours = Math.max(1, Math.round((dayEnd - dayStart) / 60));
  const y = (m: number) => ((m - dayStart) / 60) * HOUR;
  const showNow = nowMin !== null && nowMin >= dayStart && nowMin <= dayEnd;

  if (loading) return <section className="sc-card"><span className="sc-skel block h-[320px] w-full" /></section>;
  if (!cols.length) {
    return (
      <WBox>
        <div className="sc-empty">
          <span className="ic"><UserX size={20} /></span>
          <b>Nobody is scheduled on this day</b>
          <span>Add shifts in the Week view, or wait for people to submit their weeks.</span>
          <WButton tone="secondary" onClick={onWeek}>Open Week view</WButton>
        </div>
      </WBox>
    );
  }

  return (
    <section className="sc-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="dv" style={{ maxHeight: '72dvh' }}>
        <div className="dv-inner" style={{ ['--cols' as string]: cols.length, position: 'relative' }}>
          <div className="dv-corner" />
          {cols.map(([job, list]) => (
            <div key={job} className="dv-head">
              <b>{job}</b>
              <small>{new Set(list.map((s) => s.user_id)).size} {new Set(list.map((s) => s.user_id)).size === 1 ? 'person' : 'people'} · {formatHours(dayMinutes(list))}</small>
            </div>
          ))}
          <div className="dv-gutter" style={{ height: hours * HOUR, position: 'relative' }}>
            {Array.from({ length: hours }, (_, i) => <span key={i} style={{ top: i * HOUR + (i === 0 ? 8 : 0) }} className="tnum">{fmt((dayStart + i * 60) % 1440)}</span>)}
            {showNow && <b className="dv-now-label tnum" style={{ top: y(nowMin!) }} aria-hidden="true">{fmt(Math.floor(nowMin!))}</b>}
          </div>
          {cols.map(([job, list]) => (
            <div key={job} className="dv-col" style={{ height: hours * HOUR }}>
              {list.map((s) => {
                const p = byId.get(s.user_id);
                const st = toMin(hm(s.start_time)), en = toMin(hm(s.end_time));
                const status = statusOf(s.user_id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={cn('dv-block', status)}
                    style={{ top: y(Math.max(st, dayStart)) + 2, height: Math.max(30, y(Math.min(en, dayEnd)) - y(Math.max(st, dayStart)) - 4) }}
                    onClick={() => p && onEdit(p, s)}
                    aria-label={`${p?.full_name ?? 'Someone'}, ${hm(s.start_time)} to ${hm(s.end_time)}${status ? `, ${status}` : ''}. Edit`}
                  >
                    <span className="t">{hm(s.start_time)}</span>
                    <b>{p?.full_name.split(' ')[0] ?? '—'}</b>
                    <span className="t">{s.note || `until ${hm(s.end_time)}`}</span>
                    {status && <i className="dot" aria-hidden="true" />}
                  </button>
                );
              })}
              {showNow && <div className="dv-now" style={{ top: y(nowMin!) }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
