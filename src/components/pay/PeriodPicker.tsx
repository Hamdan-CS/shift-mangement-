import { useMemo, useState } from 'react';
import { WInput, WSegmented } from '@/components/app/ui';
import { addDays, dayKey, startOfMonth, startOfWeek } from '@/utils/tz';

export type PeriodKind = 'week' | 'last' | 'month' | 'lastmonth' | 'custom';
export interface Period { kind: PeriodKind; from: string; to: string; label: string }

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });

/** Works out from / to (company timezone) for a period choice. */
export function periodFor(kind: PeriodKind, tz: string, custom?: { from: string; to: string }): Period {
  const now = new Date();
  let from: string, to: string;
  if (kind === 'week' || kind === 'last') {
    const w = startOfWeek(now, tz);
    const s = kind === 'week' ? w : addDays(w, -7, tz);
    from = dayKey(s, tz); to = dayKey(addDays(s, 6, tz), tz);
  } else if (kind === 'month' || kind === 'lastmonth') {
    const m = startOfMonth(now, tz);
    const s = kind === 'month' ? m : startOfMonth(addDays(m, -1, tz), tz);
    const next = startOfMonth(addDays(s, 32, tz), tz);
    from = dayKey(s, tz); to = dayKey(addDays(next, -1, tz), tz);
  } else {
    from = custom?.from ?? dayKey(now, tz); to = custom?.to ?? from;
  }
  const label = kind === 'month' || kind === 'lastmonth'
    ? fmt(from, { month: 'long', year: 'numeric' })
    : `${kind === 'custom' ? '' : 'Week '}${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return { kind, from, to, label };
}

/** This week / Last week / This month / Last month / Custom (native date pickers). */
export function usePeriod(tz: string, initial: PeriodKind = 'week') {
  const [kind, setKind] = useState<PeriodKind>(initial);
  const today = dayKey(new Date(), tz);
  const [custom, setCustom] = useState({ from: today, to: today });
  const period = useMemo(() => periodFor(kind, tz, custom), [kind, tz, custom]);
  const picker = (
    <div className="grid gap-3">
      <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <WSegmented<PeriodKind>
          ariaLabel="Period"
          value={kind}
          onChange={setKind}
          options={[{ value: 'week', label: 'This week' }, { value: 'last', label: 'Last week' }, { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'custom', label: 'Custom' }]}
        />
      </div>
      {kind === 'custom' && (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <WInput label="From" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <WInput label="To" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}
    </div>
  );
  return { period, picker, setKind, setCustom };
}
