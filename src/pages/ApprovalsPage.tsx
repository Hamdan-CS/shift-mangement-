import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Clock3, Inbox, Loader2, Plane, Undo2, Wallet, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useMediaQuery, DESKTOP } from '@/hooks/useMediaQuery';
import { useSettings } from '@/hooks/useSettings';
import { fetchTeam, subscribeNotifications } from '@/services/api';
import { decide, fetchApprovals, LEAVE_LABEL, leaveDays, RequestError, type RequestKind } from '@/services/requests';
import { WAvatar, WButton, WChip, WPageHeader, WTextarea } from '@/components/app/ui';
import { Tabs } from '@/components/shared/ui/Tabs';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { STATUS_CHIP } from '@/components/requests/status';
import { formatHours, formatMoney, relativeDate } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { cn } from '@/utils/cn';
import { clockTime, shortDay } from '@/utils/tz';
import type { Correction, LeaveRequest, PayRequest, PublicProfile, RequestStatus } from '@/types';

type Item =
  | { kind: 'correction'; id: string; userId: string; status: RequestStatus; created: string; decided: string | null; note: string | null; c: Correction }
  | { kind: 'leave'; id: string; userId: string; status: RequestStatus; created: string; decided: string | null; note: string | null; l: LeaveRequest }
  | { kind: 'pay'; id: string; userId: string; status: RequestStatus; created: string; decided: string | null; note: string | null; p: PayRequest };
type Filter = 'all' | RequestKind;

const mins = (a: string, b: string | null) => ((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60_000;
/** The person changed their own times (owner setting "Staff can edit their own times"): no approval, managers are told. */
const selfEdit = (i: Item | null) => i?.kind === 'correction' && i.c.status === 'approved' && i.c.reviewed_by === i.c.user_id;
const outText = (iso: string | null, tz: string) => (iso ? clockTime(iso, tz) : 'still working');
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * "/admin/approvals": corrections + leave waiting for a decision (PLAN.md 10,
 * Veyla refs 09–10). Oldest first; right-side drawer on desktop, bottom sheet
 * on phones; every decision gets an Undo toast.
 */
export function ApprovalsPage() {
  const { profile } = useAuth();
  const { timeZone: tz } = useClock();
  const desktop = useMediaQuery(DESKTOP);
  const settings = useSettings();
  const money = (n: number | null) => (n === null ? 'No rate' : `${formatMoney(n, settings?.currency ?? 'PLN')}/h`);
  const [tab, setTab] = useState<RequestStatus>('pending');
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [people, setPeople] = useState<Map<string, PublicProfile>>(new Map());
  const [open, setOpen] = useState<Item | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ corrections, leave, pay }, team] = await Promise.all([fetchApprovals(), fetchTeam()]);
      setPeople(new Map(team.map((p) => [p.id, p])));
      setItems([
        ...corrections.map<Item>((c) => ({ kind: 'correction', id: c.id, userId: c.user_id, status: c.status, created: c.created_at, decided: c.reviewed_at, note: c.review_note, c })),
        ...leave.map<Item>((l) => ({ kind: 'leave', id: l.id, userId: l.user_id, status: l.status, created: l.created_at, decided: l.reviewed_at, note: l.review_note, l })),
        ...pay.map<Item>((p) => ({ kind: 'pay', id: p.id, userId: p.user_id, status: p.status, created: p.created_at, decided: p.reviewed_at, note: p.review_note, p })),
      ]);
    } catch {
      setItems((x) => x ?? []);
      notify.error('Could not load requests. Check your connection.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // a new request arrives as a notification for every manager: reload
  useEffect(() => (profile ? subscribeNotifications(profile.id, () => { void load(); }) : undefined), [profile, load]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, declined: 0 };
    for (const i of items ?? []) if (filter === 'all' || i.kind === filter) c[i.status]++;
    return c;
  }, [items, filter]);

  const shown = useMemo(() => (items ?? [])
    .filter((i) => i.status === tab && (filter === 'all' || i.kind === filter))
    // waiting: oldest first, so nobody waits twice. decided: newest first.
    .sort((a, b) => (tab === 'pending' ? a.created.localeCompare(b.created) : (b.decided ?? '').localeCompare(a.decided ?? ''))), [items, tab, filter]);

  const nameOf = (id: string) => people.get(id)?.full_name ?? 'Someone';
  // pay rates are owner-only; everything else: anyone but the person asking (unless they're the owner)
  const ownBlocked = (i: Item) => (i.kind === 'pay' ? profile?.role !== 'owner' || i.userId === profile?.id : i.userId === profile?.id && profile?.role !== 'owner');

  const act = async (i: Item, status: RequestStatus, note?: string) => {
    setBusy(i.id);
    try {
      await decide(i.kind, i.id, status, note);
      setOpen(null);
      await load();
      if (status === 'pending') { notify.success('Decision undone. The request is waiting again.'); return; }
      const what = i.kind === 'correction' ? (i.c.entry_id ? 'time fix' : 'missing shift') : i.kind === 'pay' ? 'pay rate change' : 'leave';
      notify.undoable(`${nameOf(i.userId).split(' ')[0]}'s ${what} ${status}`, () => { void act({ ...i, status }, 'pending'); });
    } catch (e) {
      notify.error(e instanceof RequestError ? e.message : 'Could not save the decision. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const summary = (i: Item) => {
    if (i.kind === 'pay') return { icon: <Wallet size={16} />, title: 'Pay rate change', detail: `${money(i.p.old_rate)} → ${money(i.p.new_rate)}` };
    if (i.kind === 'leave') {
      const n = leaveDays(i.l);
      return { icon: <Plane size={16} />, title: LEAVE_LABEL[i.l.type], detail: `${fmtDay(i.l.start_date)}${n > 1 ? ` – ${fmtDay(i.l.end_date)}` : ''} · ${n} ${n === 1 ? 'day' : 'days'}` };
    }
    const c = i.c;
    return {
      icon: <Clock3 size={16} />,
      title: selfEdit(i) ? 'Edited by employee' : c.entry_id ? 'Time fix' : 'Missing shift',
      detail: `${shortDay(c.new_clock_in, tz)} · ${clockTime(c.new_clock_in, tz)}–${outText(c.new_clock_out, tz)}`,
    };
  };

  return (
    <>
      <WPageHeader
        title="Approvals"
        subtitle={items === null ? 'Loading…' : counts.pending ? `${counts.pending} waiting for a decision. Oldest first, so nobody waits twice.` : 'Nothing waiting. Nice.'}
      />

      <div className="ap-bar">
        <Tabs
          ariaLabel="Status"
          value={tab}
          onChange={(v) => setTab(v as RequestStatus)}
          items={[{ id: 'pending', label: 'Needs review', count: counts.pending }, { id: 'approved', label: 'Approved', count: counts.approved }, { id: 'declined', label: 'Declined', count: counts.declined }]}
        />
        <div className="sc-pills" role="group" aria-label="Type">
          {(['all', 'correction', 'leave', 'pay'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'correction' ? 'Time fixes' : f === 'leave' ? 'Leave' : 'Pay rate'}</button>
          ))}
        </div>
      </div>

      <section className="sc-card ap-card" aria-busy={items === null}>
        {items === null && <span className="sc-skel block h-40 w-full" />}
        {items !== null && shown.length === 0 && (
          <div className="sc-empty">
            <span className="ic"><Inbox size={20} /></span>
            <b>{tab === 'pending' ? 'Nothing waiting for you' : `No ${tab} requests in the last 60 days`}</b>
          </div>
        )}
        {items !== null && shown.length > 0 && (
          <ul className="ap-list">
            {shown.map((i) => {
              const p = people.get(i.userId);
              const s = summary(i);
              return (
                <li key={`${i.kind}-${i.id}`} className={cn('ap-row', open?.id === i.id && 'on')}>
                  <button type="button" className="ap-open" onClick={() => setOpen(i)} aria-label={`${nameOf(i.userId)}: ${s.title}, ${s.detail}. Open details`}>
                    <span className="sc-person">
                      <WAvatar name={nameOf(i.userId)} src={p?.avatar_url} size={38} />
                      <span className="min-w-0"><b>{nameOf(i.userId)}</b><small>{p?.job_title ?? 'Team member'}</small></span>
                    </span>
                    <span className="ap-what"><span className="ap-ic">{s.icon}</span><span className="min-w-0"><b>{s.title}</b><small className="tnum">{s.detail}</small></span></span>
                    <span className="ap-when">{tab === 'pending' ? relativeDate(i.created) : selfEdit(i) ? <WChip tone="warn">Edited by employee</WChip> : <WChip tone={STATUS_CHIP[i.status].tone}>{STATUS_CHIP[i.status].label}</WChip>}</span>
                  </button>
                  {tab === 'pending' && desktop && !ownBlocked(i) && (
                    <span className="ap-quick">
                      <button type="button" className="ap-q no" onClick={() => void act(i, 'declined')} disabled={busy === i.id} aria-label={`Decline ${nameOf(i.userId)}'s ${s.title.toLowerCase()}`} title="Decline"><X size={16} /></button>
                      <button type="button" className="ap-q yes" onClick={() => void act(i, 'approved')} disabled={busy === i.id} aria-label={`Approve ${nameOf(i.userId)}'s ${s.title.toLowerCase()}`} title="Approve">{busy === i.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RequestDrawer
        item={open}
        tz={tz}
        name={open ? nameOf(open.userId) : ''}
        person={open ? people.get(open.userId) : undefined}
        reviewer={open?.kind === 'correction' ? (open.c.reviewed_by ? nameOf(open.c.reviewed_by) : null) : open?.kind === 'leave' ? (open.l.reviewed_by ? nameOf(open.l.reviewed_by) : null) : open?.kind === 'pay' ? open.p.reviewed_by_name : null}
        money={money}
        blocked={open ? ownBlocked(open) : false}
        busy={busy === open?.id}
        onClose={() => setOpen(null)}
        onDecide={(status, note) => open && void act(open, status, note)}
      />
    </>
  );
}

function RequestDrawer({ item, tz, name, person, reviewer, money, blocked, busy, onClose, onDecide }: {
  item: Item | null; tz: string; name: string; person?: PublicProfile; reviewer: string | null; money(n: number | null): string; blocked: boolean; busy: boolean;
  onClose(): void; onDecide(status: RequestStatus, note?: string): void;
}) {
  const [note, setNote] = useState('');
  const [last, setLast] = useState<Item | null>(item);
  useEffect(() => { if (item) { setLast(item); setNote(''); } }, [item]);
  const i = item ?? last;
  if (!i) return null;
  const self = selfEdit(i);
  const st = self ? { tone: 'warn' as const, label: 'Edited by employee' } : STATUS_CHIP[i.status];

  const footer = i.status === 'pending'
    ? (blocked
      ? <p className="m-0 text-[14px] text-ink-3">{i.kind === 'pay' ? 'Only the owner can change pay rates.' : 'This is your own request. The owner decides it.'}</p>
      : (
        <>
          <WButton tone="secondary" onClick={() => onDecide('declined', note)} disabled={busy}><X size={18} /> Decline</WButton>
          <WButton onClick={() => onDecide('approved', note)} disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Approve</WButton>
        </>
      ))
    : (blocked ? undefined : <WButton tone="secondary" onClick={() => onDecide('pending')} disabled={busy}><Undo2 size={18} /> {self ? 'Undo the change' : 'Undo decision'}</WButton>);

  return (
    <BottomSheet open={item !== null} onClose={onClose} title={name} side="right" footer={footer}>
      <div className="mb-4 flex items-center gap-3">
        <WAvatar name={name} src={person?.avatar_url} size={44} />
        <p className="m-0 flex-1 text-[15px] text-ink-2 lg:text-[13px]">{person?.job_title ?? 'Team member'} · asked {relativeDate(i.created)}</p>
        <WChip tone={st.tone}>{st.label}</WChip>
      </div>

      {i.kind === 'pay' ? (
        <>
          <p className="sheet-label">Hourly rate</p>
          <div className="ap-compare">
            <div className="ap-tile"><small>Now</small><b className="tnum">{money(i.p.old_rate)}</b><small> </small></div>
            <ArrowRight size={18} className="text-ink-3" aria-hidden="true" />
            <div className="ap-tile new"><small>Asks for</small><b className="tnum">{money(i.p.new_rate)}</b><small className="tnum">{i.p.old_rate !== null ? `${i.p.new_rate >= i.p.old_rate ? '+' : '−'}${money(Math.abs(i.p.new_rate - i.p.old_rate))}` : ' '}</small></div>
          </div>
        </>
      ) : i.kind === 'correction' ? (
        <>
          <p className="sheet-label">{i.c.entry_id ? 'Fix a clock time' : 'Add a shift that was never clocked'} · {shortDay(i.c.new_clock_in, tz, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
          <div className="ap-compare">
            <div className="ap-tile">
              <small>{i.c.entry_id ? 'Clocked' : 'On record'}</small>
              <b className="tnum">{i.c.old_clock_in ? `${clockTime(i.c.old_clock_in, tz)} – ${i.c.old_clock_out ? clockTime(i.c.old_clock_out, tz) : 'open'}` : 'Nothing'}</b>
              <small className="tnum">{i.c.old_clock_in && i.c.old_clock_out ? formatHours(mins(i.c.old_clock_in, i.c.old_clock_out)) : ' '}</small>
            </div>
            <ArrowRight size={18} className="text-ink-3" aria-hidden="true" />
            <div className="ap-tile new">
              <small>{self ? 'Changed to' : 'Asks for'}</small>
              <b className="tnum">{clockTime(i.c.new_clock_in, tz)} – {outText(i.c.new_clock_out, tz)}</b>
              <small className="tnum">{formatHours(mins(i.c.new_clock_in, i.c.new_clock_out))}
                {i.c.old_clock_in && i.c.old_clock_out ? ` (${mins(i.c.new_clock_in, i.c.new_clock_out) >= mins(i.c.old_clock_in, i.c.old_clock_out) ? '+' : '−'}${formatHours(Math.abs(mins(i.c.new_clock_in, i.c.new_clock_out) - mins(i.c.old_clock_in, i.c.old_clock_out)))})` : ''}
              </small>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="sheet-label">{LEAVE_LABEL[i.l.type]}</p>
          <dl className="tl-dl">
            <div><dt>From</dt><dd>{fmtDay(i.l.start_date)}</dd></div>
            <div><dt>To</dt><dd>{fmtDay(i.l.end_date)}</dd></div>
            <div><dt>Days</dt><dd className="tnum">{leaveDays(i.l)}</dd></div>
            <div><dt>Type</dt><dd>{LEAVE_LABEL[i.l.type].replace(' leave', '')}</dd></div>
          </dl>
        </>
      )}

      {(i.kind === 'correction' ? i.c.reason : i.kind === 'pay' ? i.p.reason : i.l.reason) && (
        <>
          <p className="sheet-label">Reason</p>
          <p className="ap-reason">“{i.kind === 'correction' ? i.c.reason : i.kind === 'pay' ? i.p.reason : i.l.reason}”</p>
        </>
      )}

      <p className="sheet-label">Timeline</p>
      <ol className="ap-timeline">
        <li><b>{self ? 'Changed by the employee' : 'Requested'}</b><small>{shortDay(i.created, tz, { weekday: 'short', day: 'numeric', month: 'short' })}, {clockTime(i.created, tz)}</small></li>
        {i.status === 'pending'
          ? <li className="now"><b>{i.kind === 'pay' ? 'Waiting for the owner' : 'Waiting for a manager'}</b><small>{relativeDate(i.created)}</small></li>
          : self ? <li className="approved"><b>Saved at once, no approval needed</b><small>Undo puts the old times back.</small></li>
          : <li className={i.status}><b>{i.status === 'approved' ? 'Approved' : 'Declined'}{reviewer ? ` by ${reviewer}` : ''}</b><small>{i.decided ? `${shortDay(i.decided, tz, { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockTime(i.decided, tz)}` : ''}{i.note ? ` · “${i.note}”` : ''}</small></li>}
      </ol>

      {i.status === 'pending' && !blocked && (
        <WTextarea className="mt-4" label="Note (optional, the employee sees it)" placeholder="e.g. Approved, thanks for telling me" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      )}
    </BottomSheet>
  );
}
