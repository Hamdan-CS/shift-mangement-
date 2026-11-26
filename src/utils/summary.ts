import { dayEarned } from '@/utils/pay';
import type { PayDay, PayRow, Deduction } from '@/services/pay';
import { deductionAmount } from '@/services/pay';
import { formatHours, formatMoney } from './labels';

/**
 * Copy-to-chat text (PLAN.md 8b). *bold* and _italic_ use WhatsApp / Messenger
 * formatting, so the message looks right when pasted:
 *
 *   *Name:* Ali Hassan
 *
 *   *My Weekly Work Availability*
 *   _Week of 30 Nov – 6 Dec 2026_
 *
 *   - *Monday:* 9:00 AM – 5:00 PM
 *   - *Tuesday:* Not available
 */

const WEEKDAY = (d: string, long = true) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', long ? { weekday: 'long', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const span = (from: string, to: string) => {
  const a = new Date(`${from}T12:00:00Z`), b = new Date(`${to}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const f = a.toLocaleDateString('en-GB', { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }), timeZone: 'UTC' });
  return `${f} – ${b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
};

/** '13:30' or '13:30:00' → '1:30 PM' */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h % 24 >= 12 ? 'PM' : 'AM'}`;
}
/** An instant → '1:30 PM' in company time. */
export function clock12(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** Upcoming week from the schedule: one line per day, "Not available" when free. */
export function formatAvailability(opts: { name: string; weekStart: string; shifts: { date: string; start_time: string; end_time: string }[] }): string {
  const { name, weekStart, shifts } = opts;
  const lines = [`*Name:* ${name}`, '', '*My Weekly Work Availability*', `_Week of ${span(weekStart, addDays(weekStart, 6))}_`, ''];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const mine = shifts.filter((s) => s.date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (const s of mine) { const [sh, sm] = s.start_time.split(':').map(Number); const [eh, em] = s.end_time.split(':').map(Number); total += eh * 60 + em - (sh * 60 + sm); }
    lines.push(`- *${WEEKDAY(d)}:* ${mine.length ? mine.map((s) => `${time12(s.start_time)} – ${time12(s.end_time)}`).join(', ') : 'Not available'}`);
  }
  lines.push('', `*Total:* ${formatHours(total)}`);
  return lines.join('\n');
}

/** Hours actually worked in a period, with pay. A week lists every day; longer periods list worked days only. */
export function formatWorked(opts: {
  name: string; from: string; to: string; days: PayDay[]; pay: PayRow | null;
  deductions: Deduction[]; currency: string; timeZone: string;
}): string {
  const { name, from, to, days, pay, deductions, currency, timeZone } = opts;
  const money = (n: number) => formatMoney(n, currency);
  const rate = pay?.rate ?? 0;
  const count = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const week = count <= 7;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const lines = [`*Name:* ${name}`, '', '*My Work Hours*', `_${week ? 'Week of ' : ''}${span(from, to)}_`, ''];
  for (let i = 0; i < count; i++) {
    const d = addDays(from, i);
    const w = byDay.get(d);
    const label = week ? WEEKDAY(d) : WEEKDAY(d, false);
    if (w) lines.push(`- *${label}:* ${clock12(w.first_in, timeZone)} – ${w.last_out ? clock12(w.last_out, timeZone) : 'now'} · ${formatHours(w.minutes)}${w.overtime_minutes ? ` (overtime ${formatHours(w.overtime_minutes)})` : ''} · ${money(dayEarned(w, rate, pay?.overtime_multiplier ?? 1.5))}`);
    else if (week) lines.push(`- *${label}:* Not worked`);
  }
  if (!week && days.length === 0) lines.push('No hours in this period.');
  lines.push('');
  lines.push(`*Total hours:* ${formatHours(pay?.worked_minutes ?? 0)}`);
  if (pay?.overtime_minutes) lines.push(`*Overtime:* ${formatHours(pay.overtime_minutes)} (×${pay.overtime_multiplier})`);
  if (rate) lines.push(`*Rate:* ${money(rate)}/h`);
  lines.push(`*Gross:* ${money(pay?.gross ?? 0)}`);
  const ded = deductions.map((x) => ({ x, amt: deductionAmount(x, pay?.gross ?? 0, from, to) })).filter((d) => d.amt > 0);
  if ((pay?.deductions ?? 0) > 0) lines.push(`*Deductions:* −${money(pay!.deductions)}${ded.length ? ` (${ded.map((d) => d.x.name).join(', ')})` : ''}`);
  lines.push(`*Net pay:* ${money(pay?.net ?? 0)}`);
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
