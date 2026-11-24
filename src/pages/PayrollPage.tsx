import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useClock } from '@/contexts/ClockContext';
import { useSettings } from '@/hooks/useSettings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { downloadExcel, fetchPayReport, PayError, payrollCsv, type PayRow } from '@/services/pay';
import { WAvatar, WBox, WButton, WKpis, WPageHeader } from '@/components/app/ui';
import { usePeriod } from '@/components/pay/PeriodPicker';
import { formatHours, formatMoney } from '@/utils/labels';
import { notify } from '@/utils/notify';

/** "/admin/payroll": period totals for everyone, CSV + Excel export (PLAN.md 8, 8b, 10). */
export function PayrollPage() {
  const { timeZone: tz } = useClock();
  const settings = useSettings();
  const navigate = useNavigate();
  const currency = settings?.currency ?? 'PLN';
  const wide = useMediaQuery('(min-width: 640px)');
  const { period, picker } = usePeriod(tz);
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetchPayReport(period.from, period.to)
      .then((r) => { if (alive) setRows(r.filter((x) => x.role !== 'owner' || x.worked_minutes > 0)); })
      .catch(() => { if (alive) { setRows([]); notify.error('Could not load payroll.'); } });
    return () => { alive = false; };
  }, [period.from, period.to]);

  const money = (n: number) => formatMoney(n, currency);
  const sum = (k: 'worked_minutes' | 'overtime_minutes' | 'gross' | 'deductions' | 'net') => (rows ?? []).reduce((s, r) => s + r[k], 0);

  const csv = () => {
    if (!rows) return;
    const blob = new Blob(['﻿' + payrollCsv(rows, currency)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ShiftClock_payroll_${period.from}_${period.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const excel = async () => {
    setBusy(true);
    try { await downloadExcel(period.from, period.to); notify.success('Excel file downloaded'); }
    catch (e) { notify.error(e instanceof PayError ? e.message : 'Could not make the Excel file.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <WPageHeader
        title="Payroll"
        subtitle="Hours, overtime, gross, deductions and net for everyone. Same numbers as each person's Pay page."
        actions={(
          <>
            <WButton tone="secondary" onClick={csv} disabled={!rows?.length}><FileSpreadsheet size={17} /> Export CSV</WButton>
            <WButton onClick={excel} disabled={busy || !rows?.length}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download Excel</WButton>
          </>
        )}
      />
      <div className="mb-4">{picker}</div>
      <div className="sc-grid">
        <WBox title={period.label} meta={`${rows?.length ?? '…'} people`}>
          <small className="block text-[14px] text-ink-3 lg:text-[12px]">Net to pay</small>
          <div className="sc-big tnum">{rows === null ? '…' : money(sum('net'))}</div>
          <WKpis items={[
            { label: 'Hours', value: rows === null ? '…' : formatHours(sum('worked_minutes')) },
            { label: 'Gross', value: rows === null ? '…' : money(sum('gross')) },
            { label: 'Deductions', value: rows === null ? '…' : money(sum('deductions')) },
          ]} />
        </WBox>

        <section className="sc-card" aria-busy={rows === null}>
          {rows === null && <span className="sc-skel block h-32 w-full" />}
          {rows !== null && wide && (
            <div className="overflow-x-auto">
              <table className="sc-table pr-table">
                <thead><tr><th>Person</th><th className="num">Hours</th><th className="num">Overtime</th><th className="num">Rate</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th className="num">Late</th><th className="num">Leave</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} onClick={() => navigate(`/admin/people/${r.user_id}`)} style={{ cursor: 'pointer' }}>
                      <td><span className="sc-person"><WAvatar name={r.full_name} size={32} /><span className="min-w-0"><b>{r.full_name}</b><small>{r.job_title ?? '—'}</small></span></span></td>
                      <td className="num tnum">{formatHours(r.worked_minutes)}</td>
                      <td className="num tnum">{r.overtime_minutes ? formatHours(r.overtime_minutes) : '—'}</td>
                      <td className="num tnum">{r.rate === null ? '—' : money(r.rate)}</td>
                      <td className="num tnum">{money(r.gross)}</td>
                      <td className="num tnum">{r.deductions ? `−${money(r.deductions)}` : '—'}</td>
                      <td className="num tnum"><b>{money(r.net)}</b></td>
                      <td className="num tnum">{r.late_count || '—'}</td>
                      <td className="num tnum">{r.leave_days || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td><b>Total</b></td><td className="num tnum">{formatHours(sum('worked_minutes'))}</td><td className="num tnum">{formatHours(sum('overtime_minutes'))}</td><td /><td className="num tnum">{money(sum('gross'))}</td><td className="num tnum">−{money(sum('deductions'))}</td><td className="num tnum"><b>{money(sum('net'))}</b></td><td /><td /></tr></tfoot>
              </table>
            </div>
          )}
          {rows !== null && !wide && (
            <ul className="rq-list">
              {rows.map((r) => (
                <li key={r.user_id}>
                  <button type="button" className="pr-card" onClick={() => navigate(`/admin/people/${r.user_id}`)}>
                    <span className="sc-person"><WAvatar name={r.full_name} size={40} /><span className="min-w-0"><b>{r.full_name}</b><small className="tnum">{formatHours(r.worked_minutes)}{r.overtime_minutes ? ` · OT ${formatHours(r.overtime_minutes)}` : ''}</small></span></span>
                    <span className="text-right"><b className="tnum block text-[17px]">{money(r.net)}</b><small className="tnum block text-[13px] text-ink-3">gross {money(r.gross)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
