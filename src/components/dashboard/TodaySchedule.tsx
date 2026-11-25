import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Crosshair, MessageSquare } from 'lucide-react';
import { WAvatar, WButton, WChip, WSegmented } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { useNow } from '@/hooks/useNow';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatHours } from '@/utils/labels';
import { cn } from '@/utils/cn';
import { STATUS_META, hhmm, minutesNowIn, type BoardRow, type BoardStatus } from './statusMeta';

/**
 * Today: who is working, coming in, late, off. Count tiles on top (tap to
 * filter), then either the Timeline (people × hours, scrolls sideways on
 * phones, trimmed to the hours that have shifts, opens on "now") or the List
 * (people grouped by status, one sentence + a bar for their own shift).
 * Tap anyone for details.
 */
export function TodaySchedule({ rows, loading, dayStart = 6 * 60, dayEnd = 24 * 60, timeZone, title = 'Today', subtitle }: {
  rows: BoardRow[];
  loading: boolean;
  dayStart?: number;
  dayEnd?: number;
  timeZone?: string;
  title?: string;
  subtitle?: string;
}) {
  const wide = useMediaQuery('(min-width: 640px)');
  const [view, setView] = useState<View>('timeline');
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [picked, setPicked] = useState<BoardRow | null>(null);
  const now = minutesNowIn(timeZone, useNow(30_000));

  const grouped = useMemo(() => {
    const g: Record<Group, BoardRow[]> = { working: [], late: [], coming: [], done: [], off: [] };
    for (const r of rows) g[groupOf(r.status)].push(r);
    for (const k of Object.keys(g) as Group[]) g[k].sort((a, b) => (a.shiftStart ?? a.clockIn ?? 9999) - (b.shiftStart ?? b.clockIn ?? 9999) || a.person.full_name.localeCompare(b.person.full_name));
    return g;
  }, [rows]);

  const tiles: Group[] = ['working', 'coming', 'late', 'off'];
  const groups = (filter === 'all' ? GROUP_ORDER : [filter]).filter((k) => grouped[k].length > 0 || k === filter);
  const timelineRows = useMemo(
    () => (filter === 'all' ? GROUP_ORDER : [filter]).flatMap((k) => grouped[k]),
    [grouped, filter],
  );

  return (
    <section className="sc-card tb">
      <div className="sc-card-h">
        <div className="min-w-0">
          <h2>{title}</h2>
          {subtitle && <p className="tl-sum">{subtitle}</p>}
        </div>
        <WSegmented<View> ariaLabel="View" value={view} onChange={setView} options={[{ value: 'timeline', label: 'Timeline' }, { value: 'list', label: 'List' }]} />
      </div>

      <div className="tb-tiles" role="group" aria-label="Show">
        {tiles.map((k) => {
          const n = grouped[k].length;
          const on = filter === k;
          return (
            <button key={k} type="button" className={cn('tb-tile', k, on && 'on')} aria-pressed={on} onClick={() => setFilter(on ? 'all' : k)}>
              <b className="tnum">{loading ? '–' : n}</b>
              <small>{GROUPS[k].tile}</small>
            </button>
          );
        })}
      </div>

      {view === 'list' && loading && (
        <ul className="tb-list">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="tb-row"><span className="sc-skel h-9 w-9 rounded-full" /><span className="flex-1"><span className="sc-skel mb-2 block h-3 w-28" /><span className="sc-skel block h-2 w-full" /></span></li>
          ))}
        </ul>
      )}

      {view === 'timeline' && (
        <Timeline rows={timelineRows} loading={loading} dayStart={dayStart} dayEnd={dayEnd} now={now} compact={!wide} onPick={setPicked} />
      )}

      {view === 'list' && !loading && (
        <div className={cn('tb-groups', filter !== 'all' && 'one')}>
          {groups.filter((k) => !(k === 'off' && filter === 'all')).map((k) => {
            const list = grouped[k];
            return (
              <div key={k} className="tb-group">
                <h3 className={cn('tb-gh', k)}><span className="dot" />{GROUPS[k].title}<span className="n tnum">{list.length}</span></h3>
                {list.length === 0
                  ? <p className="tb-empty">{GROUPS[k].empty}</p>
                  : <ul className="tb-list">{list.map((r) => <PersonRow key={r.person.id} r={r} now={now} onPick={setPicked} />)}</ul>}
              </div>
            );
          })}
        </div>
      )}
      {view === 'list' && !loading && filter === 'all' && <OffLine rows={grouped.off} onPick={setPicked} />}

      {!loading && rows.length === 0 && <p className="tb-empty">No team members yet.</p>}

      <ShiftSheet row={picked} now={now} onClose={() => setPicked(null)} />
    </section>
  );
}

/* ---------------- groups ---------------- */

type View = 'timeline' | 'list';
type Group = 'working' | 'late' | 'coming' | 'done' | 'off';
const GROUP_ORDER: Group[] = ['working', 'late', 'coming', 'done', 'off'];
const GROUPS: Record<Group, { title: string; tile: string; empty: string }> = {
  working: { title: 'Working now', tile: 'Working', empty: 'Nobody is clocked in.' },
  late: { title: 'Late or missing', tile: 'Late', empty: 'Nobody is late.' },
  coming: { title: 'Coming in later', tile: 'Coming in', empty: 'Nobody else is due today.' },
  done: { title: 'Finished today', tile: 'Finished', empty: 'Nobody has finished yet.' },
  off: { title: 'Off today', tile: 'Off', empty: 'Everyone is in today.' },
};
const groupOf = (s: BoardStatus): Group =>
  s === 'working' ? 'working' : s === 'late' || s === 'absent' ? 'late' : s === 'upcoming' ? 'coming' : s === 'finished' ? 'done' : 'off';

const dur = (m: number) => {
  const v = Math.max(0, Math.round(m));
  const h = Math.floor(v / 60);
  return h ? `${h}h ${String(v % 60).padStart(2, '0')}m` : `${v} min`;
};

/** One plain sentence about where this person is today. */
function describe(r: BoardRow, now: number): { line: string; side: string; sideTone?: 'ok' | 'bad' | 'muted' } {
  const shift = r.shiftStart !== null ? `${hhmm(r.shiftStart)}–${hhmm(r.shiftEnd)}` : null;
  const worked = workedSoFar(r, now);
  switch (r.status) {
    case 'working':
      return { line: `In since ${hhmm(r.clockIn)}${r.shiftEnd !== null ? ` · until ${hhmm(r.shiftEnd)}` : ''}`, side: dur(worked), sideTone: 'ok' };
    case 'upcoming':
      return { line: `Starts ${hhmm(r.shiftStart)}${r.shiftStart !== null && r.shiftStart > now ? ` · in ${dur(r.shiftStart - now)}` : ''}`, side: shift ?? '' };
    case 'late':
      return { line: `Due at ${hhmm(r.shiftStart)} · not clocked in`, side: r.shiftStart !== null ? `+${dur(now - r.shiftStart)}` : 'Late', sideTone: 'bad' };
    case 'absent':
      return { line: `Missed ${shift ?? 'shift'}`, side: 'Absent', sideTone: 'bad' };
    case 'finished':
      return { line: r.clockIn !== null ? `${hhmm(r.clockIn)}–${hhmm(r.clockOut)}${shift ? ` · planned ${shift}` : ''}` : `Planned ${shift ?? ''}`, side: dur(worked), sideTone: 'muted' };
    case 'on_leave':
      return { line: 'On leave', side: '' };
    default:
      return { line: 'No shift today', side: '' };
  }
}

function PersonRow({ r, now, onPick }: { r: BoardRow; now: number; onPick(r: BoardRow): void }) {
  const d = describe(r, now);
  const bar = shiftBar(r, now);
  return (
    <li>
      <button type="button" className={cn('tb-row', r.status)} onClick={() => onPick(r)}>
        <WAvatar name={r.person.full_name} src={r.person.avatar_url} size={38} />
        <span className="tb-main">
          <span className="tb-top">
            <b>{r.person.full_name}</b>
            {d.side && <em className={cn('tnum', d.sideTone)}>{d.side}</em>}
          </span>
          <small className="tnum">{d.line}{r.person.job_title ? <span className="role"> · {r.person.job_title}</span> : null}</small>
          {bar && (
            <span className={cn('tb-bar', r.status)} aria-hidden="true">
              <i className="fill" style={{ width: `${bar.fill}%` }} />
              {bar.now !== null && <i className="now" style={{ left: `${bar.now}%` }} />}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** Off and on-leave people in one short line of avatars, so they don't take a row each. */
function OffLine({ rows, onPick }: { rows: BoardRow[]; onPick(r: BoardRow): void }) {
  if (!rows.length) return null;
  return (
    <div className="tb-off">
      <span className="tb-off-h">Off today <span className="tnum">{rows.length}</span></span>
      <div className="tb-off-list">
        {rows.map((r) => (
          <button key={r.person.id} type="button" className="tb-chip" onClick={() => onPick(r)} aria-label={`${r.person.full_name}: ${STATUS_META[r.status].label}`}>
            <WAvatar name={r.person.full_name} src={r.person.avatar_url} size={24} />
            <span>{r.person.full_name.split(' ')[0]}</span>
            {r.status === 'on_leave' && <i>leave</i>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Progress through this person's own shift: filled part = worked, tick = now. */
function shiftBar(r: BoardRow, now: number): { fill: number; now: number | null } | null {
  if (r.shiftStart === null || r.shiftEnd === null || r.status === 'on_leave' || r.status === 'off') return null;
  const len = Math.max(1, r.shiftEnd - r.shiftStart);
  const pct = (m: number) => Math.min(100, Math.max(0, ((m - r.shiftStart!) / len) * 100));
  const worked = workedSoFar(r, now);
  const fill = r.clockIn === null ? 0 : Math.min(100, (worked / len) * 100);
  const inShift = now > r.shiftStart && now < r.shiftEnd;
  return { fill, now: inShift ? pct(now) : null };
}

/* ---------------- timeline ---------------- */

/**
 * People × hours. Only the hours that matter are drawn (an hour before the
 * first shift to an hour after the last, and "now"), so phones scroll less.
 * One full-width row per person: their name sits inside the row (and stays
 * in view while you swipe), the shift bar under it. Phones: 76px an hour,
 * swipe sideways; "Now" jumps back to the red line; edge fades show more.
 */
function Timeline({ rows, loading, dayStart, dayEnd, now, compact, onPick }: {
  rows: BoardRow[]; loading: boolean; dayStart: number; dayEnd: number; now: number; compact: boolean; onPick(r: BoardRow): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // visible range: whole hours around the shifts / clock times / now, at least 6 hours
  const [from, to] = useMemo(() => {
    const pts: number[] = [now];
    for (const r of rows) for (const m of [r.shiftStart, r.shiftEnd, r.clockIn, r.clockOut]) if (m !== null) pts.push(m);
    let a = Math.floor((Math.min(...pts) - 60) / 60) * 60;
    let b = Math.ceil((Math.max(...pts) + 60) / 60) * 60;
    if (pts.length === 1) { a = Math.max(dayStart, a); b = Math.min(dayEnd, Math.max(b, a + 360)); }
    a = Math.max(0, a);
    b = Math.min(24 * 60, Math.max(b, a + 360));
    a = Math.max(0, Math.min(a, b - 360));
    return [a, b];
  }, [rows, now, dayStart, dayEnd]);
  const span = Math.max(60, to - from);
  const hours = Math.round(span / 60);
  const pct = (m: number) => `${((Math.min(Math.max(m, from), to) - from) / span) * 100}%`;
  const nowIn = now >= from && now <= to;
  const labels = useMemo(() => Array.from({ length: hours + 1 }, (_, i) => from + i * 60), [from, hours]);

  const updateEdges = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  const scrollToNow = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    const target = ((Math.min(Math.max(now, from), to) - from) / span) * el.scrollWidth - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  };
  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.6, behavior: 'smooth' });

  // open on "now" (only on load / layout change, not every tick)
  useLayoutEffect(() => {
    scrollToNow(false);
    updateEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, compact, from, to]);

  return (
    <>
      <div className="tl-tools">
        <span className="tl-range tnum">{hhmm(from)} – {hhmm(to)}</span>
        <div className="tl-tools-btns">
          <button type="button" className="sc-iconbtn" onClick={() => nudge(-1)} disabled={!edges.left} aria-label="Earlier hours"><ChevronLeft size={18} /></button>
          {nowIn && <button type="button" className="tl-nowbtn" onClick={() => scrollToNow(true)}><Crosshair size={15} /> Now</button>}
          <button type="button" className="sc-iconbtn" onClick={() => nudge(1)} disabled={!edges.right} aria-label="Later hours"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className={cn('tl-wrap', edges.left && 'fade-l', edges.right && 'fade-r')}>
        <div ref={scroller} className="tl-scroll" tabIndex={0} aria-label="Today timeline, scrolls sideways" onScroll={updateEdges}>
          <div className="tl-grid" style={{ ['--hours' as string]: hours }}>
            <div className="tl-hours" aria-hidden="true">
              {labels.map((m, i) => (i === 0 || i === hours || (nowIn && Math.abs(m - now) < 28) ? null : (
                <span key={m} style={{ left: `${(i / hours) * 100}%` }}>{hhmm(m)}</span>
              )))}
            </div>

            {loading && Array.from({ length: 4 }, (_, i) => (
              <div key={`sk${i}`} className="tl-row">
                <span className="tl-who"><span className="sc-skel block h-3 w-24" /></span>
                <span className="sc-skel tl-skelbar" style={{ left: `${10 + i * 12}%`, width: '30%' }} />
              </div>
            ))}

            {!loading && rows.map((r) => {
              const s = STATUS_META[r.status];
              const has = r.shiftStart !== null && r.shiftEnd !== null;
              const workedEnd = r.clockIn !== null ? (r.clockOut ?? now) : null;
              return (
                <div key={r.person.id} className={cn('tl-row', r.status === 'off' && 'off')}>
                  <button type="button" className="tl-who" onClick={() => onPick(r)}>
                    <span className={cn('tl-av', r.status)}><WAvatar name={r.person.full_name} src={r.person.avatar_url} size={22} /></span>
                    <b>{compact ? r.person.full_name.split(' ')[0] : r.person.full_name}</b>
                    <small className={cn('tl-st', r.status)}>{s.label}{whenText(r) ? ` ${whenText(r)}` : ''}{!compact && r.person.job_title ? ` · ${r.person.job_title}` : ''}</small>
                  </button>
                  {r.status === 'on_leave' && <span className="tl-bar leave" style={{ left: 0, right: 0 }}><span>On leave</span></span>}
                  {!has && r.clockIn !== null && (
                    <button
                      type="button"
                      className={cn('tl-bar worked-only', r.status === 'finished' && 'done')}
                      style={{ left: pct(r.clockIn), width: `max(56px, calc(${pct(workedEnd ?? now)} - ${pct(r.clockIn)}))` }}
                      onClick={() => onPick(r)}
                      aria-label={`${r.person.full_name}: clocked in ${hhmm(r.clockIn)}${r.clockOut !== null ? `, out ${hhmm(r.clockOut)}` : ', still working'}`}
                    >
                      <span>{hhmm(r.clockIn)}–{r.clockOut !== null ? hhmm(r.clockOut) : 'now'}</span>
                    </button>
                  )}
                  {has && r.status !== 'on_leave' && (
                    <button
                      type="button"
                      className={cn('tl-bar', r.status === 'late' && 'late', r.status === 'absent' && 'absent', r.status === 'finished' && 'done')}
                      style={{ left: pct(r.shiftStart!), width: `max(56px, calc(${pct(r.shiftEnd!)} - ${pct(r.shiftStart!)}))` }}
                      onClick={() => onPick(r)}
                      aria-label={`${r.person.full_name}: ${hhmm(r.shiftStart)} to ${hhmm(r.shiftEnd)}, ${s.label}`}
                    >
                      {workedEnd !== null && r.clockIn !== null && (
                        <i className="fill" style={fillStyle(r.clockIn, workedEnd, r.shiftStart!, r.shiftEnd!)} />
                      )}
                      <span>{hhmm(r.shiftStart)}–{hhmm(r.shiftEnd)}</span>
                    </button>
                  )}
                </div>
              );
            })}

            {nowIn && (
              <div className="tl-nowlayer" aria-hidden="true">
                <div className="tl-now" style={{ left: pct(now) }}><span>{hhmm(now)}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>
      {!loading && rows.length === 0 && <p className="tl-none">Nobody here.</p>}
      <div className="tl-legend" aria-hidden="true">
        <span><i className="lg worked" />Worked</span>
        <span><i className="lg sched" />Planned</span>
        <span><i className="lg late" />Late</span>
        <span><i className="lg leave" />Leave</span>
        <span><i className="lg now" />Now</span>
      </div>
    </>
  );
}

/** The one time that matters next to a name: since / due / at / until. */
function whenText(r: BoardRow): string {
  switch (r.status) {
    case 'working': return r.clockIn !== null ? `since ${hhmm(r.clockIn)}` : '';
    case 'late': return r.shiftStart !== null ? `· due ${hhmm(r.shiftStart)}` : '';
    case 'upcoming': return r.shiftStart !== null ? `at ${hhmm(r.shiftStart)}` : '';
    case 'finished': return r.clockOut !== null ? `at ${hhmm(r.clockOut)}` : '';
    case 'absent': return r.shiftStart !== null ? `· ${hhmm(r.shiftStart)}–${hhmm(r.shiftEnd)}` : '';
    default: return '';
  }
}

/** Worked part of a shift bar, clamped to the bar (early starts / late finishes). */
function fillStyle(inMin: number, outMin: number, start: number, end: number) {
  const len = Math.max(1, end - start);
  const a = Math.min(Math.max(inMin, start), end);
  const b = Math.min(Math.max(outMin, start), end);
  return { left: `${((a - start) / len) * 100}%`, width: `${(Math.max(0, b - a) / len) * 100}%` };
}

/* ---------------- tap a person: details (sheet on phones, dialog on desktop) ---------------- */

function ShiftSheet({ row, now, onClose }: { row: BoardRow | null; now: number; onClose(): void }) {
  const navigate = useNavigate();
  const [last, setLast] = useState<BoardRow | null>(row);
  useEffect(() => { if (row) setLast(row); }, [row]);
  const r = row ?? last;
  if (!r) return null;
  const s = STATUS_META[r.status];
  const worked = workedSoFar(r, now);
  return (
    <BottomSheet
      open={Boolean(row)}
      onClose={onClose}
      title={r.person.full_name}
      footer={<WButton tone="secondary" onClick={() => { onClose(); navigate('/messages'); }}><MessageSquare size={18} /> Message</WButton>}
    >
      <div className="mb-4 flex items-center gap-3">
        <WAvatar name={r.person.full_name} src={r.person.avatar_url} size={44} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] text-ink-2">{r.person.job_title || 'Team member'}</p>
          <p className="m-0 text-[13px] text-ink-3">{describe(r, now).line}</p>
        </div>
        <WChip tone={s.tone}>{s.label}</WChip>
      </div>
      <dl className="tl-dl">
        <div><dt>Scheduled</dt><dd className="tnum">{r.shiftStart !== null ? `${hhmm(r.shiftStart)} – ${hhmm(r.shiftEnd)}` : 'No shift today'}</dd></div>
        <div><dt>Clocked in</dt><dd className="tnum">{hhmm(r.clockIn)}</dd></div>
        <div><dt>Clocked out</dt><dd className="tnum">{r.clockIn !== null && r.clockOut === null ? 'Still working' : hhmm(r.clockOut)}</dd></div>
        <div><dt>Worked</dt><dd className="tnum">{formatHours(worked)}</dd></div>
      </dl>
    </BottomSheet>
  );
}

/** Worked today: the server's figure, plus the minutes since it was fetched for people still on shift. */
function workedSoFar(r: BoardRow, now: number): number {
  if (r.workedMinutes !== undefined && r.status !== 'working') return r.workedMinutes;
  if (r.clockIn === null) return 0;
  return Math.max(r.workedMinutes ?? 0, now - r.clockIn);
}
