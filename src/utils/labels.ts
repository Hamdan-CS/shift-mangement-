/** "Good morning" / "Good afternoon" / "Good evening" for the dashboard greeting. */
export function greeting(date = new Date(), timeZone?: string): string {
  let h = date.getHours();
  if (timeZone) {
    try { h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date)); } catch { /* keep local */ }
  }
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'there';
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

/** Locale used to write money for a currency: PLN as Poles write it ("1 212,00 zł"). */
const MONEY_LOCALE: Record<string, string> = { PLN: 'pl-PL', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' };

/** Money in the company currency, e.g. formatMoney(1212, 'PLN') → "1 212,00 zł". */
export function formatMoney(amount: number, currency = 'PLN'): string {
  try {
    // Polish style "1 234,50 zł": pl-PL leaves 4-digit amounts ungrouped by default, so group always
    const opts = { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
    return new Intl.NumberFormat(MONEY_LOCALE[currency] ?? 'en-US', opts).format(amount).replace(/\u202f/g, '\u00a0');
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Hours shown as `7h 32m` (PLAN.md section 8). */
export function formatHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
