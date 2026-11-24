import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { WButton, WInput, WTextarea } from '@/components/app/ui';
import { createCorrection, RequestError } from '@/services/requests';
import { formatHours } from '@/utils/labels';
import { clockTime, dayKey, zoned } from '@/utils/tz';
import type { TimeEntry } from '@/types';

/**
 * Ask to fix a clock time, or to add a shift you forgot to clock (entry = null).
 * Sheet on phones, dialog on desktop; native date / time pickers, one column.
 */
export function CorrectionSheet({ open, entry, userId, tz, onClose, onSent }: {
  open: boolean; entry: TimeEntry | null; userId: string; tz: string; onClose(): void; onSent(): void;
}) {
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const valid = /^\d{4}-\d\d-\d\d$/.test(date) && /^\d\d:\d\d/.test(start) && /^\d\d:\d\d/.test(end);
  const inAt = valid ? zoned(date, start, tz) : null;
  // an end earlier than the start means the shift ran past midnight
  const overnight = valid && end <= start;
  const outAt = valid ? new Date(zoned(date, end, tz).getTime() + (overnight ? 86_400_000 : 0)) : null;
  const minutes = inAt && outAt ? (outAt.getTime() - inAt.getTime()) / 60_000 : 0;
  const today = dayKey(new Date(), tz);

  const send = async () => {
    if (!inAt || !outAt) { setError('Pick a day and both times.'); return; }
    setBusy(true); setError(null);
    try {
      await createCorrection(userId, { entryId: entry?.id ?? null, newIn: inAt, newOut: outAt, reason });
      onSent();
    } catch (e) {
      setError(e instanceof RequestError ? e.message : 'Could not send. Try again.');
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={entry ? 'Request a correction' : 'Add a missing shift'}
      footer={<WButton onClick={send} disabled={busy || !valid || reason.trim().length < 3}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Send to manager'}</WButton>}
    >
      <p className="sheet-sub">
        {entry
          ? <>Now: <b className="tnum">{clockTime(entry.clock_in, tz)} – {entry.clock_out ? clockTime(entry.clock_out, tz) : 'still working'}</b>. Your manager sees both and decides.</>
          : 'For a day you worked but forgot to clock in. Your manager checks it first.'}
      </p>
      <div className="grid gap-4">
        <WInput label="Day" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={Boolean(entry)} required />
        <div className="grid grid-cols-2 gap-3">
          <WInput label="Clock in" type="time" step={60} value={start} onChange={(e) => setStart(e.target.value)} required />
          <WInput label="Clock out" type="time" step={60} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <p className="m-0 text-[14px] text-ink-2 lg:text-[12.5px]">
          {valid ? <>Shift <b className="tnum">{formatHours(minutes)}</b>{overnight ? ' · ends the next day' : ''}</> : ' '}
        </p>
        <WTextarea label="Why?" placeholder={entry ? 'e.g. I forgot to clock out, I left at 17:30' : 'e.g. My phone was dead'} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
        {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      </div>
    </BottomSheet>
  );
}
