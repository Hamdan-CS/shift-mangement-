import type { PayDay, PayRow, Deduction } from '@/services/pay';
import { formatHours, formatMoney } from './labels';
import { clockTime } from './tz';

/**
 * Plain-text hours + pay summary (PLAN.md 8b). One function, used by every
 * Copy button and (Phase 8) the daily email, so they always match:
 *
 *   Ali Hassan — Week 24–30 Nov 2026
 *   Mon 24 Nov  09:02 – 17:31  8h 29m  254,50 zł
 *   Wed 26 Nov  Off
 *   Total: 40h 12m (overtime 0h 12m)
 *   Gross: 1212,00 zł
 *   Deductions: Uniform –50,00 zł
 *   Net: 1162,00 zł
 */
export function formatHoursSummary(opts: {
  name: string; label: string; from: string; to: string; days: PayDay[]; pay: PayRow | null;
  deductions: Deduction[]; currency: string; timeZone: string; showOffDays?: boolean;
}): string {
  const { name, label, from, to, days, pay, deductions, currency, timeZone } = opts;
  const lines = [`${name} — ${label}`];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const rate = pay?.rate ?? 0;
  const dayCount = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const showOff = opts.showOffDays ?? dayCount <= 14;
  for (let i = 0; i < dayCount; i++) {
    const dt = new Date(`${from}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + i);
    const key = dt.toISOString().slice(0, 10);
    const label2 = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const d = byDay.get(key);
    if (d) {
      const span = `${clockTime(d.first_in, timeZone)} – ${d.last_out ? clockTime(d.last_out, timeZone) : 'now'}`;
      lines.push(`${label2.padEnd(10)}  ${span}  ${formatHours(d.minutes)}  ${formatMoney((rate * d.minutes) / 60, currency)}`);
    } else if (showOff) {
      lines.push(`${label2.padEnd(10)}  Off`);
    }
  }
  if (pay) {
    lines.push(`Total: ${formatHours(pay.worked_minutes)}${pay.overtime_minutes ? ` (overtime ${formatHours(pay.overtime_minutes)})` : ''}`);
    lines.push(`Gross: ${formatMoney(pay.gross, currency)}`);
    if (pay.deductions > 0) {
      const names = deductions.map((x) => x.name).join(', ');
      lines.push(`Deductions${names ? `: ${names}` : ''} –${formatMoney(pay.deductions, currency)}`);
    }
    lines.push(`Net: ${formatMoney(pay.net, currency)}`);
  }
  return lines.join('\n');
}

/** Copy text to the clipboard (with a fallback for older phones). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
