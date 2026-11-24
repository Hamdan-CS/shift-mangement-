import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { WAvatar, WButton, WChip, WSegmented } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { formatHours } from '@/utils/labels';
import { cn } from '@/utils/cn';
import { FILTERS, STATUS_META, hhmm, minutesNowIn, type BoardFilter, type BoardRow } from './statusMeta';

type View = 'timeline' | 'list';

/**
 * Today schedule table (PLAN.md 10b, refs 11–13): rows = people, columns =
 * hours of the working day, a shift bar per row and a live red "now" line.
 * Phones get a sticky ~96px name column with the timeline scrolling sideways
 * inside the card, and a List view (the default under 640px).
 */
export function TodaySchedule({ rows, loading, dayStart, dayEnd, timeZone, title = 'Today', subtitle }: {
  rows: BoardRow[];
  loading: boolean;
  dayStart: number;
  dayEnd: number;
  timeZone?: string;
  title?: string;
  subtitle?: string;
}) {
  const wide = useMediaQuery('(min-width: 640px)');
  const [view, setView] = useState<View>(() => (window.matchMedia('(min-width: 640px)').matches ? 'timeline' : 'list'));
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [picked, setPicked] = useState<BoardRow | null>(null);
  const now = minutesNowIn(timeZone, useNow(30_000));

  const counts = useMemo(() => {
    const c = { working: 0, upcoming: 0, late: 0, off: 0 };
    for (const r of rows) {
      if (r.status === 'working') c.working++;
      else if (r.status === 'upcoming') c.upcoming++;
      else if (r.status === 'late' || r.status === 'absent') c.late++;
      else if (r.status === 'off' || r.status === 'on_leave') c.off++;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    return rows
      .filter((r) => f.match(r.status))
      .sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || (a.shiftStart ?? 9999) - (b.shiftStart ?? 9999) || a.person.full_name.localeCompare(b.person.full_name));
  }, [rows, filter]);

  return (
    <section className="sc-card tl">
      <div className="sc-card-h">
        <div className="min-w-0">
          <h2>{title}</h2>
          <p className="tl-sum">
            {subtitle ?? (
              <>
                <b>{counts.working}</b> working · <b>{counts.upcoming}</b> upcoming · <span className={counts.late ? 'text-danger' : undefined}><b>{counts.late}</b> late</span> · <b>{counts.off}</b> off
              </>
            )}
          </p>
        </div>
        <WSegmented<View> ariaLabel="View" value={view} onChange={setView} options={[{ value: 'timeline', label: 'Timeline' }, { value: 'list', label: 'List' }]} />
      </div>

      <div className="sc-pills mb-3" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <b className="tnum">{rows.filter((r) => f.match(r.status)).length}</b>
          </button>
        ))}
      </div>

      {view === 'timeline'
        ? <Timeline rows={shown} loading={loading} dayStart={dayStart} dayEnd={dayEnd} now={now} compactNames={!wide} onPick={setPicked} />
        : <ListView rows={shown} loading={loading} now={now} onPick={setPicked} />}

      {!loading && shown.length === 0 && <p className="tl-none">Nobody here right now.</p>}

      {view === 'timeline' && (
        <div className="tl-legend" aria-hidden="true">
          <span><i className="lg worked" />Worked</span>
          <span><i className="lg sched" />Scheduled</span>
          <span><i className="lg late" />Late</span>
          <span><i className="lg leave" />On leave</span>
          <span><i className="lg now" />Now</span>
        </div>
      )}

      <ShiftSheet row={picked} now={now} onClose={() => setPicked(null)} />
    </section>
  );
}

/* ---------------- timeline ---------------- */

function Timeline({ rows, loading, dayStart, dayEnd, now, compactNames, onPick }: {
  rows: BoardRow[]; loading: boolean; dayStart: number; dayEnd: number; now: number; compactNames: boolean; onPick(r: BoardRow): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const span = Math.max(60, dayEnd - dayStart);
  const hours = Math.round(span / 60);
  const pct = (m: number) => `${((Math.min(Math.max(m, dayStart), dayEnd) - dayStart) / span) * 100}%`;
  const nowIn = now >= dayStart && now <= dayEnd;
  const labels = useMemo(() => Array.from({ length: hours + 1 }, (_, i) => dayStart + i * 60), [dayStart, hours]);

  // On open, scroll so "now" is in view (10b).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !nowIn) return;
    const nameW = (el.querySelector('.tl-name') as HTMLElement | null)?.offsetWidth ?? 96;
    const trackW = el.scrollWidth - nameW;
    el.scrollLeft = Math.max(0, nameW + ((now - dayStart) / span) * trackW - el.clientWidth / 2 - nameW / 2);
    // only on mount / layout change, not every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, compactNames, dayStart, dayEnd]);

  return (
    <div ref={scroller} className="tl-scroll" tabIndex={0} aria-label="Today timeline, scrolls sideways">
      <div className="tl-grid" style={{ ['--hours' as string]: hours }}>
        <div className="tl-name tl-corner">{rows.length} {rows.length === 1 ? 'person' : 'people'}</div>
        <div className="tl-hours" aria-hidden="true">
          {labels.map((m, i) => (i === 0 || i === hours ? null : (
            <span key={m} style={{ left: `${(i / hours) * 100}%` }}>{hhmm(m)}</span>
          )))}
        </div>

        {loading && Array.from({ length: 4 }, (_, i) => (
          <div key={`sk${i}`} className="contents">
            <div className="tl-name"><span className="sc-skel block h-9 w-9 rounded-full" /><span className="sc-skel block h-3 w-14" /></div>
            <div className="tl-track"><span className="sc-skel absolute top-1/2 h-7 -translate-y-1/2 rounded-full" style={{ left: `${10 + i * 12}%`, width: '30%' }} /></div>
          </div>
        ))}

        {!loading && rows.map((r) => {
          const s = STATUS_META[r.status];
          const has = r.shiftStart !== null && r.shiftEnd !== null;
          const workedEnd = r.clockIn !== null ? (r.clockOut ?? now) : null;
          return (
            <div key={r.person.id} className="contents">
              <div className="tl-name">
                <WAvatar name={r.person.full_name} src={r.person.avatar_url} size={compactNames ? 34 : 36} />
                <div className="min-w-0">
                  <b>{compactNames ? r.person.full_name.split(' ')[0] : r.person.full_name}</b>
                  {!compactNames && <small>{r.person.job_title || s.label}</small>}
                </div>
                {!compactNames && <WChip tone={s.tone} className="ml-auto">{s.label}</WChip>}
              </div>
              <div className={cn('tl-track', r.status === 'off' && 'off')}>
                {r.status === 'on_leave' && <span className="tl-bar leave" style={{ left: 0, right: 0 }} />}
                {!has && r.clockIn !== null && (
                  <button
                    type="button"
                    className={cn('tl-bar worked-only', r.status === 'finished' && 'done')}
                    style={{ left: pct(r.clockIn), width: `max(44px, calc(${pct(workedEnd ?? now)} - ${pct(r.clockIn)}))` }}
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
                    style={{ left: pct(r.shiftStart!), width: `calc(${pct(r.shiftEnd!)} - ${pct(r.shiftStart!)})` }}
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
  );
}

/* ---------------- list (default on phones) ---------------- */

function ListView({ rows, loading, now, onPick }: { rows: BoardRow[]; loading: boolean; now: number; onPick(r: BoardRow): void }) {
  if (loading) {
    return (
      <ul className="tl-list">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="tl-li"><span className="sc-skel h-10 w-10 rounded-full" /><span className="flex-1"><span className="sc-skel mb-2 block h-3 w-24" /><span className="sc-skel block h-3 w-16" /></span></li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="tl-list">
      {rows.map((r) => {
        const s = STATUS_META[r.status];
        const worked = workedSoFar(r, now);
        return (
          <li key={r.person.id}>
            <button type="button" className="tl-li" onClick={() => onPick(r)}>
              <WAvatar name={r.person.full_name} src={r.person.avatar_url} size={42} />
              <span className="min-w-0 flex-1">
                <b>{r.person.full_name}</b>
                <small className="tnum">{r.shiftStart !== null ? `${hhmm(r.shiftStart)}–${hhmm(r.shiftEnd)}` : r.clockIn !== null ? `In ${hhmm(r.clockIn)}${r.clockOut !== null ? ` · out ${hhmm(r.clockOut)}` : ''}` : r.status === 'on_leave' ? 'On leave' : 'No shift today'}{r.person.job_title ? ` · ${r.person.job_title}` : ''}</small>
              </span>
              <span className="tl-li-end">
                <WChip tone={s.tone}>{s.label}</WChip>
                <small className="tnum">{worked > 0 ? `${formatHours(worked)} so far` : ' '}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- tap a row / bar: details (sheet on phones, dialog on desktop) ---------------- */

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

/** Worked part of a shift bar, clamped to the bar (early starts / late finishes). */
function fillStyle(inMin: number, outMin: number, start: number, end: number) {
  const len = Math.max(1, end - start);
  const a = Math.min(Math.max(inMin, start), end);
  const b = Math.min(Math.max(outMin, start), end);
  return { left: `${((a - start) / len) * 100}%`, width: `${(Math.max(0, b - a) / len) * 100}%` };
}
