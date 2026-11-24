import { useLayoutEffect, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatHours } from '@/utils/labels';
import { hm, toMin } from '@/services/schedules';
import type { ScheduleShift } from '@/types';
import { dayMinutes, dayParts } from './days';

const HOUR_PX = 48;
const TARGET_MIN = 8 * 60; // the per-day bar fills at 8 hours

/**
 * Desktop week planner (Vernly ref 14): day columns with planned hours + bar,
 * time down the side, shift blocks, today highlighted, live now line.
 * Click a block to edit, an empty hour to add.
 */
export function WeekGrid({ days, shifts, dayStart, dayEnd, today, nowMin, readOnly, onAdd, onEdit }: {
  days: string[];
  shifts: ScheduleShift[];
  dayStart: number;
  dayEnd: number;
  today: string;
  nowMin: number;
  readOnly: boolean;
  onAdd(date: string, startMin: number): void;
  onEdit(s: ScheduleShift): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hours = Math.max(1, Math.round((dayEnd - dayStart) / 60));
  const height = hours * HOUR_PX;
  const byDay = useMemo(() => new Map(days.map((d) => [d, shifts.filter((s) => s.date === d)])), [days, shifts]);
  const y = (min: number) => ((min - dayStart) / 60) * HOUR_PX;

  // open scrolled to the earliest shift (or 08:00)
  useLayoutEffect(() => {
    const first = shifts.length ? Math.min(...shifts.map((s) => toMin(hm(s.start_time)))) : 8 * 60;
    if (scroller.current) scroller.current.scrollTop = Math.max(0, y(first) - HOUR_PX / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]]);

  return (
    <div className="wg">
      <div className="wg-head">
        <span />
        {days.map((d) => {
          const p = dayParts(d);
          const mins = dayMinutes(byDay.get(d) ?? []);
          return (
            <div key={d} className={cn('wg-dh', d === today && 'today')}>
              <div className="wg-dl"><span>{p.dow}</span><b className="tnum">{p.num}</b></div>
              <div className="wg-bar"><i style={{ width: `${Math.min(100, (mins / TARGET_MIN) * 100)}%` }} /></div>
              <small className="tnum">{mins ? formatHours(mins) : 'Off'}</small>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="wg-body">
        <div className="wg-grid" style={{ height }}>
          <div className="wg-gutter">
            {Array.from({ length: hours }, (_, i) => (
              <span key={i} style={{ top: i * HOUR_PX }} className="tnum">{String(Math.floor((dayStart + i * 60) / 60) % 24).padStart(2, '0')}:00</span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cn('wg-col', d === today && 'today')}>
              {!readOnly && Array.from({ length: hours }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className="wg-slot"
                  style={{ top: i * HOUR_PX, height: HOUR_PX }}
                  onClick={() => onAdd(d, dayStart + i * 60)}
                  aria-label={`Add shift on ${dayParts(d).long} at ${String(Math.floor((dayStart + i * 60) / 60) % 24).padStart(2, '0')}:00`}
                >
                  <Plus size={14} />
                </button>
              ))}
              {(byDay.get(d) ?? []).map((s) => {
                const st = toMin(hm(s.start_time)), en = toMin(hm(s.end_time));
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={cn('wg-block', s.edited_by && 'edited')}
                    style={{ top: y(Math.max(st, dayStart)), height: Math.max(24, y(Math.min(en, dayEnd)) - y(Math.max(st, dayStart))) }}
                    onClick={() => onEdit(s)}
                    aria-label={`${dayParts(d).long}, ${hm(s.start_time)} to ${hm(s.end_time)}${s.note ? `, ${s.note}` : ''}${readOnly ? '' : '. Edit'}`}
                  >
                    <b>{s.note || 'Shift'}</b>
                    <small className="tnum">{hm(s.start_time)}–{hm(s.end_time)}</small>
                  </button>
                );
              })}
              {d === today && nowMin >= dayStart && nowMin <= dayEnd && (
                <div className="wg-now" style={{ top: y(nowMin) }} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
