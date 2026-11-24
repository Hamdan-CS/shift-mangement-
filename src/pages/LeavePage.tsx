import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plane, Send, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { createLeave, fetchMyLeave, LEAVE_LABEL, leaveDays, RequestError, withdrawLeave } from '@/services/requests';
import { WBox, WButton, WChip, WInput, WPageHeader, WTextarea } from '@/components/app/ui';
import { STATUS_CHIP } from '@/components/requests/status';
import { notify } from '@/utils/notify';
import { dayKey } from '@/utils/tz';
import type { LeaveRequest, LeaveType } from '@/types';

const TYPES: LeaveType[] = ['annual', 'sick', 'unpaid', 'other'];
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "/leave": request time off and follow its status (PLAN.md section 10). Phone first. */
export function LeavePage() {
  const { profile } = useAuth();
  const { timeZone } = useClock();
  const today = dayKey(new Date(), timeZone);
  const [type, setType] = useState<LeaveType>('annual');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<LeaveRequest[] | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try { setList(await fetchMyLeave(profile.id)); } catch { setList([]); }
  }, [profile]);
  useEffect(() => { void load(); }, [load]);

  const days = end >= start ? leaveDays({ start_date: start, end_date: end }) : 0;

  const send = async () => {
    if (!profile) return;
    setBusy(true); setError(null);
    try {
      await createLeave(profile.id, { type, start, end, reason });
      notify.success('Leave request sent to your manager');
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof RequestError ? e.message : 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (l: LeaveRequest) => {
    setWithdrawing(l.id);
    try { await withdrawLeave(l.id); notify.success('Request withdrawn'); await load(); }
    catch (e) { notify.error(e instanceof RequestError ? e.message : 'Could not withdraw.'); }
    finally { setWithdrawing(null); }
  };

  return (
    <>
      <WPageHeader title="Leave" subtitle="Ask for time off. Your manager approves it, and the days show as on leave." />
      <div className="sc-grid lv-grid">
        <WBox title="New request">
          <div className="grid gap-4">
            <div className="w-field">
              <span className="w-label">Type</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of leave">
                {TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={type === t} className="sc-preset" aria-pressed={type === t} onClick={() => setType(t)}>{LEAVE_LABEL[t]}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <WInput label="First day" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} required />
              <WInput label="Last day" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
            </div>
            <p className="m-0 text-[15px] text-ink-2 lg:text-[13px]">{days > 0 ? <><b className="tnum">{days}</b> {days === 1 ? 'day' : 'days'} · {fmtDay(start)}{days > 1 ? ` – ${fmtDay(end)}` : ''}</> : 'The last day must be on or after the first day.'}</p>
            <WTextarea label="Note for your manager (optional)" placeholder={type === 'sick' ? 'e.g. Flu, doctor’s note to follow' : 'e.g. Family wedding'} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            <div className="sc-sticky-submit">
              <WButton size="lg" block onClick={send} disabled={busy || days === 0 || !profile}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Send request
              </WButton>
            </div>
          </div>
        </WBox>

        <WBox title="My requests" meta="Pending requests can be withdrawn.">
          {list === null && <span className="sc-skel block h-20 w-full" />}
          {list !== null && list.length === 0 && (
            <div className="sc-empty" style={{ padding: '20px 0' }}>
              <span className="ic"><Plane size={20} /></span>
              <span>No leave requests yet.</span>
            </div>
          )}
          <ul className="rq-list">
            {(list ?? []).map((l) => {
              const st = STATUS_CHIP[l.status];
              const n = leaveDays(l);
              return (
                <li key={l.id} className="rq-item">
                  <div className="rq-main">
                    <b>{LEAVE_LABEL[l.type]}</b>
                    <small className="tnum">{fmtDay(l.start_date)}{n > 1 ? ` – ${fmtDay(l.end_date)}` : ''} · {n} {n === 1 ? 'day' : 'days'}</small>
                    {l.reason && <small>“{l.reason}”</small>}
                    {l.review_note && <small className="rq-note">Manager: “{l.review_note}”</small>}
                  </div>
                  <div className="rq-side">
                    <WChip tone={st.tone}>{st.label}</WChip>
                    {l.status === 'pending' && (
                      <WButton tone="ghost" size="sm" onClick={() => void withdraw(l)} disabled={withdrawing === l.id} aria-label={`Withdraw ${LEAVE_LABEL[l.type].toLowerCase()} from ${fmtDay(l.start_date)}`}>
                        {withdrawing === l.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Withdraw
                      </WButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </WBox>
      </div>
    </>
  );
}
