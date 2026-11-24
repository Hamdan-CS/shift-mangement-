import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { WButton, WInput } from '@/components/app/ui';
import { formatHours } from '@/utils/labels';
import { toMin } from '@/services/schedules';

const PRESETS = [
  { label: 'Morning', start: '06:00', end: '14:00' },
  { label: 'Day', start: '09:00', end: '17:00' },
  { label: 'Evening', start: '14:00', end: '22:00' },
];

export interface ShiftDraft { start: string; end: string; note: string }

/**
 * Add / edit one shift (PLAN.md 6 + 10c): bottom sheet on phones, dialog on
 * desktop; native time pickers, labels above fields, sticky Save.
 */
export function ShiftEditSheet({ open, title, subtitle, initial, isNew, onClose, onSave, onDelete }: {
  open: boolean;
  title: string;
  subtitle?: string;
  initial: ShiftDraft;
  isNew: boolean;
  onClose(): void;
  onSave(d: ShiftDraft): Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [d, setD] = useState<ShiftDraft>(initial);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setD(initial); setError(null); setBusy(null); } }, [open, initial]);

  const valid = /^\d\d:\d\d/.test(d.start) && /^\d\d:\d\d/.test(d.end) && toMin(d.end) > toMin(d.start);
  const length = valid ? toMin(d.end) - toMin(d.start) : 0;

  const save = async () => {
    if (!valid) { setError('The end time must be after the start time.'); return; }
    setBusy('save'); setError(null);
    try { await onSave(d); } catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const del = async () => {
    if (!onDelete) return;
    setBusy('delete'); setError(null);
    try { await onDelete(); } catch (e) { setError((e as Error).message); setBusy(null); }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={(
        <>
          {!isNew && onDelete && (
            <WButton tone="danger" onClick={del} disabled={busy !== null} aria-label="Remove this shift">
              {busy === 'delete' ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />} Remove
            </WButton>
          )}
          <WButton onClick={save} disabled={busy !== null || !valid}>
            {busy === 'save' ? <Loader2 size={18} className="animate-spin" /> : isNew ? 'Add shift' : 'Save'}
          </WButton>
        </>
      )}
    >
      {subtitle && <p className="sheet-sub">{subtitle}</p>}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Quick times">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="sc-preset"
            aria-pressed={d.start === p.start && d.end === p.end}
            onClick={() => setD((x) => ({ ...x, start: p.start, end: p.end }))}
          >
            <b>{p.label}</b> <span className="tnum">{p.start}–{p.end}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <WInput label="Start" type="time" step={900} value={d.start} onChange={(e) => setD((x) => ({ ...x, start: e.target.value }))} required />
        <WInput label="End" type="time" step={900} value={d.end} onChange={(e) => setD((x) => ({ ...x, end: e.target.value }))} required />
      </div>
      <WInput className="mt-3" label="Note (optional)" placeholder="e.g. Front desk" maxLength={120} value={d.note} onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))} />
      <p className="mt-3 text-[14px] text-ink-2 lg:text-[12.5px]">{valid ? <>Shift length <b className="tnum">{formatHours(length)}</b></> : 'Pick a start and an end time on the same day.'}</p>
      {error && <div className="sc-alert danger mt-3" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    </BottomSheet>
  );
}
