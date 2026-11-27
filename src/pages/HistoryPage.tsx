import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, CalendarX2, Clock3, PenLine } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { fetchEntries } from '@/services/api';
import { fetchMyCorrections } from '@/services/requests';
import { CorrectionSheet } from '@/components/requests/CorrectionSheet';
import { notify } from '@/utils/notify';
import { WBox, WButton, WChip, WKpis, WPageHeader, WSegmented } from '@/components/app/ui';
import { formatHours } from '@/utils/labels';
import { entryMinutes } from '@/utils/pay';
import { addDays, clockTime, dayKey, shortDay, startOfMonth, startOfWeek } from '@/utils/tz';
import type { Correction, TimeEntry } from '@/types';

type Range = 'week' | 'last' | 'month';

const METHOD: Record<TimeEntry['method'], string> = { button: 'App', qr: 'QR', manual: 'Manual', auto: 'Auto' };

/** "/history": your past days and clock times (PLAN.md section 10). Phone first. */
export function HistoryPage() {
  const { profile } = useAuth();
  const clock = useClock();
  const navigate = useNavigate();
  const now = useNow(clock.open ? 30_000 : 120_000);
  const tz = clock.timeZone;
  const direct = Boolean(useSettings(Boolean(profile))?.staff_edit_times);
  const [range, setRange] = useState<Range>('week');
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [fixing, setFixing] = useState<{ entry: TimeEntry | null } | null>(null);
  const [reload, setReload] = useState(0);

  const [from, to] = useMemo(() => {
    const base = new Date();
    if (range === 'month') { const m = startOfMonth(base, tz); return [m, startOfMonth(addDays(m, 32, tz), tz)]; }
    const w = startOfWeek(base, tz);
    return range === 'week' ? [w, addDays(w, 7, tz)] : [addDays(w, -7, tz), w];
  }, [range, tz]);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    setEntries(null);
    setFailed(false);
    fetchEntries(profile.id, from, to)
      .then((list) => { if (alive) setEntries(list); })
      .catch(() => { if (alive) { setEntries([]); setFailed(true); } });
    fetchMyCorrections(profile.id).then((c) => { if (alive) setCorrections(c); }).catch(() => {});
    return () => { alive = false; };
  }, [profile, from, to, clock.version, reload]);

  // latest request per entry, for the "Fix pending / Fixed / Declined" tags
  const fixOf = useMemo(() => {
    const m = new Map<string, Correction>();
    for (const c of corrections) if (c.entry_id && !m.has(c.entry_id)) m.set(c.entry_id, c);
    return m;
  }, [corrections]);
  const openMissing = corrections.filter((c) => !c.entry_id && c.status === 'pending');

  // Group by the company-time day each shift started on.
  const days = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of entries ?? []) {
      const k = dayKey(new Date(e.clock_in), tz);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    const keys: string[] = [];
    if (range !== 'month') {
      // a week shows all 7 days, including days off (newest first)
      for (let i = 6; i >= 0; i--) {
        const d = addDays(from, i, tz);
        if (d <= now) keys.push(dayKey(d, tz));
      }
    } else {
      keys.push(...[...map.keys()].sort().reverse());
    }
    return keys.map((k) => {
      const list = (map.get(k) ?? []).slice().sort((a, b) => a.clock_in.localeCompare(b.clock_in));
      const minutes = list.reduce((s, e) => s + entryMinutes(e, new Date(0), new Date(8.64e15), now), 0);
      return { key: k, date: new Date(`${k}T12:00:00Z`), list, minutes };
    });
  }, [entries, range, from, tz, now]);

  const total = days.reduce((s, d) => s + d.minutes, 0);
  const worked = days.filter((d) => d.list.length > 0).length;
  const rangeLabel = range === 'month' ? shortDay(from, tz, { month: 'long', year: 'numeric' }) : `${shortDay(from, tz, { day: 'numeric', month: 'short' })} – ${shortDay(addDays(from, 6, tz), tz, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <>
      <WPageHeader
        title="History"
        subtitle={direct ? 'Your days and clock times. Wrong time? Edit it.' : 'Your days and clock times. Wrong time? Ask for a correction.'}
        actions={<WButton tone="secondary" onClick={() => setFixing({ entry: null })}><CalendarPlus size={17} /> Add a missing shift</WButton>}
      />

      <div className="mb-4">
        <WSegmented<Range>
          ariaLabel="Range"
          value={range}
          onChange={setRange}
          options={[{ value: 'week', label: 'This week' }, { value: 'last', label: 'Last week' }, { value: 'month', label: 'This month' }]}
        />
      </div>

      <div className="sc-grid">
        <WBox title={rangeLabel} meta={failed ? 'Could not load. Pull down or try again.' : 'Total worked, breaks taken off'}>
          <div className="sc-big tnum">{entries === null ? '…' : formatHours(total)}</div>
          <WKpis items={[
            { label: 'Days worked', value: entries === null ? '…' : String(worked) },
            { label: 'Per day', value: entries === null || !worked ? '—' : formatHours(total / worked) },
            { label: 'Shifts', value: entries === null ? '…' : String(entries.length) },
          ]} />
        </WBox>

        {openMissing.length > 0 && (
          <div className="sc-alert info" role="status">
            <CalendarPlus size={16} className="mt-0.5 shrink-0" />
            <span>{openMissing.length === 1 ? 'A missing shift you added is' : `${openMissing.length} missing shifts you added are`} waiting for your manager.</span>
          </div>
        )}

        {entries === null && (
          <div className="grid gap-3" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="sc-card"><span className="sc-skel mb-3 block h-4 w-32" /><span className="sc-skel block h-12 w-full" /></div>)}
          </div>
        )}

        {entries !== null && days.length === 0 && (
          <WBox>
            <div className="sc-empty">
              <span className="ic"><CalendarX2 size={20} /></span>
              <b>No shifts in this range</b>
              <span>Start a shift on Home and it shows up here.</span>
              <WButton tone="secondary" onClick={() => navigate('/')}>Go to Home</WButton>
            </div>
          </WBox>
        )}

        {entries !== null && days.map((d) => (
          <section key={d.key} className="sc-card hx-day">
            <header className="hx-day-h">
              <div>
                <h2>{shortDay(d.date, 'UTC', { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
                <small>{d.list.length ? `${d.list.length} ${d.list.length === 1 ? 'shift' : 'shifts'}` : 'Off'}</small>
              </div>
              <b className="tnum">{d.list.length ? formatHours(d.minutes) : '—'}</b>
            </header>
            {d.list.length > 0 && (
              <ul className="hx-list">
                {d.list.map((e) => (
                  <li key={e.id} className="hx-row">
                    <span className="hx-time tnum">
                      <Clock3 size={16} aria-hidden="true" />
                      {clockTime(e.clock_in, tz)} – {e.clock_out ? clockTime(e.clock_out, tz) : 'now'}
                    </span>
                    <span className="hx-dur tnum">{formatHours(entryMinutes(e, new Date(0), new Date(8.64e15), now))}{e.break_minutes ? <small> · break {e.break_minutes}m</small> : null}</span>
                    <span className="hx-tags">
                      {!e.clock_out && <WChip tone="ok">Working</WChip>}
                      <WChip tone="default" dot={false}>{METHOD[e.method]}</WChip>
                      {e.edited && <WChip tone="warn" dot={false}>{e.edited_by && e.edited_by === e.user_id ? 'Edited by you' : e.edited_by_name ? `Approved by ${e.edited_by_name}` : 'Edited'}</WChip>}
                      {fixOf.get(e.id)?.status === 'pending' && <WChip tone="accent">Fix pending</WChip>}
                      {fixOf.get(e.id)?.status === 'approved' && fixOf.get(e.id)?.reviewed_by !== e.user_id && <WChip tone="ok">Fixed</WChip>}
                      {fixOf.get(e.id)?.status === 'declined' && <WChip tone="danger">Fix declined</WChip>}
                    </span>
                    <WButton
                      tone="ghost"
                      size="sm"
                      className="hx-fix"
                      disabled={fixOf.get(e.id)?.status === 'pending'}
                      onClick={() => setFixing({ entry: e })}
                      aria-label={`${direct ? (e.clock_out ? 'Edit times of' : 'Edit clock-in of') : 'Request correction for'} the ${clockTime(e.clock_in, tz)} shift`}
                    >
                      <PenLine size={16} /> {fixOf.get(e.id)?.status === 'pending' ? 'Waiting' : direct ? (e.clock_out ? 'Edit times' : 'Edit clock-in') : 'Request correction'}
                    </WButton>
                    {fixOf.get(e.id)?.status === 'declined' && fixOf.get(e.id)?.review_note && (
                      <p className="hx-note">Manager: “{fixOf.get(e.id)!.review_note}”</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {profile && (
        <CorrectionSheet
          open={fixing !== null}
          entry={fixing?.entry ?? null}
          userId={profile.id}
          tz={tz}
          direct={direct}
          onClose={() => setFixing(null)}
          onSent={(applied) => {
            setFixing(null); setReload((n) => n + 1); void clock.refresh();
            notify.success(applied ? 'Saved. Your manager has been told.' : 'Sent to your manager. You get a notification when they decide.');
          }}
        />
      )}
    </>
  );
}
