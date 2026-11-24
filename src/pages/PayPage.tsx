import { useEffect, useState } from 'react';
import { Copy, Receipt } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { deductionAmount, fetchDeductions, fetchPayDays, fetchPayReport, type Deduction, type PayDay, type PayRow } from '@/services/pay';
import { WBox, WButton, WKpis, WPageHeader } from '@/components/app/ui';
import { usePeriod } from '@/components/pay/PeriodPicker';
import { copyText, formatWorked } from '@/utils/summary';
import { formatHours, formatMoney } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { clockTime } from '@/utils/tz';

/**
 * "/pay": hours, gross, deductions and net for a period, plus a Copy button
 * (PLAN.md 8, 8b). Numbers come from the database (pay_report / pay_days).
 */
export function PayPage() {
  const { profile } = useAuth();
  const { timeZone: tz, version } = useClock();
  const settings = useSettings();
  const currency = settings?.currency ?? 'PLN';
  const { period, picker } = usePeriod(tz);
  const [pay, setPay] = useState<PayRow | null>(null);
  const [days, setDays] = useState<PayDay[] | null>(null);
  const [deds, setDeds] = useState<Deduction[]>([]);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    setDays(null);
    Promise.all([fetchPayReport(period.from, period.to), fetchPayDays(period.from, period.to), fetchDeductions(profile.id)])
      .then(([r, d, x]) => {
        if (!alive) return;
        setPay(r.find((row) => row.user_id === profile.id) ?? null);
        setDays(d.filter((row) => row.user_id === profile.id));
        setDeds(x.filter((y) => y.start_date <= period.to && (!y.end_date || y.end_date >= period.from)));
      })
      .catch(() => { if (alive) { setDays([]); notify.error('Could not load your pay. Check your connection.'); } });
    return () => { alive = false; };
  }, [profile, period.from, period.to, version]);

  const copy = async () => {
    if (!profile || !days) return;
    const text = formatWorked({ name: profile.full_name, from: period.from, to: period.to, days, pay, deductions: deds, currency, timeZone: tz });
    if (await copyText(text)) { navigator.vibrate?.(20); notify.success('Copied'); } else notify.error('Could not copy. Select the text and copy it by hand.');
  };

  const money = (n: number) => formatMoney(n, currency);
  const loading = days === null;

  return (
    <>
      <WPageHeader
        title="Pay"
        subtitle="Your hours, gross, deductions and net. Copy sends it ready to paste in a chat."
        actions={<WButton onClick={copy} disabled={loading}><Copy size={17} /> Copy hours &amp; pay</WButton>}
      />
      <div className="mb-4">{picker}</div>
      <div className="sc-grid pay-grid">
        <WBox title={period.label} meta={pay?.rate ? `${money(pay.rate)} an hour · overtime after ${pay.overtime_after_hours}h a week at ×${pay.overtime_multiplier}` : 'No hourly rate set yet. Ask the owner.'}>
          <small className="block text-[14px] text-ink-3 lg:text-[12px]">Net pay</small>
          <div className="sc-big tnum">{loading ? '…' : money(pay?.net ?? 0)}</div>
          <WKpis items={[
            { label: 'Hours', value: loading ? '…' : formatHours(pay?.worked_minutes ?? 0) },
            { label: 'Overtime', value: loading ? '…' : formatHours(pay?.overtime_minutes ?? 0) },
            { label: 'Gross', value: loading ? '…' : money(pay?.gross ?? 0) },
          ]} />
          <ul className="pay-lines">
            <li><span>Regular {formatHours(pay?.regular_minutes ?? 0)}</span><b className="tnum">{money(((pay?.rate ?? 0) * (pay?.regular_minutes ?? 0)) / 60)}</b></li>
            {(pay?.overtime_minutes ?? 0) > 0 && <li><span>Overtime {formatHours(pay!.overtime_minutes)} × {pay!.overtime_multiplier}</span><b className="tnum">{money(((pay!.rate ?? 0) * pay!.overtime_multiplier * pay!.overtime_minutes) / 60)}</b></li>}
            {deds.filter((x) => deductionAmount(x, pay?.gross ?? 0, period.from, period.to) > 0).map((x) => <li key={x.id} className="ded"><span>{x.name} ({x.type === 'percent' ? `${x.amount}%` : `${money(x.amount)} ${x.recurring === 'once' ? 'once' : x.recurring === 'weekly' ? 'a week' : 'a month'}`})</span><b className="tnum">−{money(deductionAmount(x, pay?.gross ?? 0, period.from, period.to))}</b></li>)}
            <li className="total"><span>Deductions</span><b className="tnum">−{money(pay?.deductions ?? 0)}</b></li>
            <li className="total"><span>Net</span><b className="tnum">{money(pay?.net ?? 0)}</b></li>
          </ul>
        </WBox>

        <WBox title="Days" meta={`${pay?.days_worked ?? 0} worked${pay?.leave_days ? ` · ${pay.leave_days} on leave` : ''}`}>
          {loading && <span className="sc-skel block h-24 w-full" />}
          {!loading && days!.length === 0 && (
            <div className="sc-empty" style={{ padding: '18px 0' }}><span className="ic"><Receipt size={20} /></span><span>No hours in this period.</span></div>
          )}
          <ul className="rq-list">
            {(days ?? []).map((d) => (
              <li key={d.day} className="rq-item">
                <div className="rq-main">
                  <b>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>
                  <small className="tnum">{clockTime(d.first_in, tz)} – {d.last_out ? clockTime(d.last_out, tz) : 'now'}{d.break_minutes ? ` · break ${d.break_minutes}m` : ''}{d.corrected ? ' · corrected' : ''}</small>
                </div>
                <div className="rq-side">
                  <b className="tnum text-[16px] lg:text-[13.5px]">{formatHours(d.minutes)}</b>
                  <small className="tnum text-[13px] text-ink-3 lg:text-[12px]">{money(((pay?.rate ?? 0) * d.minutes) / 60)}</small>
                </div>
              </li>
            ))}
          </ul>
        </WBox>
      </div>
    </>
  );
}
