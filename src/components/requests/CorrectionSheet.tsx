import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { WButton, WInput, WTextarea } from '@/components/app/ui';
import { createCorrection, RequestError } from '@/services/requests';
import { formatHours } from '@/utils/labels';
import { clockTime, dayKey, zoned } from '@/utils/tz';
import type { TimeEntry } from '@/types';

/**
 * Fix a clock time, or add a shift you forgot to clock (entry = null).
 * `direct` (owner setting): the change is saved at once and managers are told;
 * otherwise it is a request a manager decides. A shift that is still running
 * can have its clock-in changed (you keep working).
 * Sheet on phones, dialog on desktop; native date / time pickers, one column.
 */
export function CorrectionSheet({ open, entry, userId, tz, direct = false, onClose, onSent }: {
  open: boolean; entry: TimeEntry | null; userId: string; tz: string; direct?: boolean; onClose(): void; onSent(applied: boolean): void;
}) {
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = Boolean(entry && !entry.clock_out);

  useEffect(() => {
    if (!open) return;
    setError(null); setBusy(false); setReason('');
    if (entry) {
      setDate(dayKey(new Date(entry.clock_in), tz));
      setStart(clockTime(entry.clock_in, tz));
      setEnd(entry.clock_out ? clockTime(entry.clock_out, tz) : clockTime(new Date(), tz));
    } else {
      setDate(dayKey(new Date(Date.now() - 86_400_000), tz)); // a forgotten shift is usually yesterday
      setStart('09:00'); setEnd('17:00');
    }
  }, [open, entry, tz]);

  const valid = /^\d{4}-\d\d-\d\d$/.test(date) && /^\d\d:\d\d/.test(start) && (running || /^\d\d:\d\d/.test(end));
  // a running shift that started before midnight: a clock-in later than now is yesterday
  let inAt = valid ? zoned(date, start, tz) : null;
  if (inAt && running && inAt.getTime() > Date.now() + 60_000) inAt = new Date(inAt.getTime() - 86_400_000);
  // an end earlier than the start means the shift ran past midnight
  const overnight = valid && !running && end <= start;
  const outAt = valid && !running ? new Date(zoned(date, end, tz).getTime() + (overnight ? 86_400_000 : 0)) : null;
  const minutes = inAt ? ((outAt ?? new Date()).getTime() - inAt.getTime()) / 60_000 : 0;
  const today = dayKey(new Date(), tz);
  const reasonOk = direct || reason.trim().length >= 3;

  const send = async () => {
    if (!inAt || (!running && !outAt)) { setError('Pick a day and both times.'); return; }
    setBusy(true); setError(null);
    try {
      const row = await createCorrection(userId, { entryId: entry?.id ?? null, newIn: inAt, newOut: outAt, reason: reason.trim() || 'Changed by employee' });
      onSent(row.status === 'approved');
    } catch (e) {
      setError(e instanceof RequestError ? e.message : 'Could not save. Try again.');
      setBusy(false);
    }
  };

  const title = direct ? (entry ? 'Edit your times' : 'Add a missing shift') : (entry ? 'Request a correction' : 'Add a missing shift');
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={<WButton onClick={send} disabled={busy || !valid || !reasonOk}>{busy ? <Loader2 size={18} className="animate-spin" /> : direct ? 'Save' : 'Send to manager'}</WButton>}
    >
      <p className="sheet-sub">
        {entry
          ? <>Now: <b className="tnum">{clockTime(entry.clock_in, tz)} – {entry.clock_out ? clockTime(entry.clock_out, tz) : 'still working'}</b>. {direct ? 'Saved at once. Your manager is told and sees "Edited by employee".' : 'Your manager sees both and decides.'}</>
          : direct ? 'For a day you worked but forgot to clock in. Saved at once; your manager is told.' : 'For a day you worked but forgot to clock in. Your manager checks it first.'}
      </p>
      <div className="grid gap-4">
        <WInput label="Day" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={Boolean(entry)} required />
        <div className="grid grid-cols-2 gap-3">
          <WInput label="Clock in" type="time" step={60} value={start} onChange={(e) => setStart(e.target.value)} required />
          {running
            ? <WInput label="Clock out" value="Still working" disabled hint="Clock out as usual when you finish" />
            : <WInput label="Clock out" type="time" step={60} value={end} onChange={(e) => setEnd(e.target.value)} required />}
        </div>
        <p className="m-0 text-[14px] text-ink-2 lg:text-[12.5px]">
          {valid ? <>{running ? 'Worked so far' : 'Shift'} <b className="tnum">{formatHours(minutes)}</b>{overnight ? ' · ends the next day' : ''}</> : ' '}
        </p>
        <WTextarea
          label={direct ? 'Why? (optional)' : 'Why?'}
          placeholder={entry ? (running ? 'e.g. I started at 08:00 but forgot to clock in' : 'e.g. I forgot to clock out, I left at 17:30') : 'e.g. My phone was dead'}
          maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required={!direct}
        />
        {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      </div>
    </BottomSheet>
  );
}
