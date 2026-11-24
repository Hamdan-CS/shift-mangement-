// ShiftClock · shared Excel builder (PLAN.md 8b). Used by `export-xlsx`
// (Download Excel button) and `cron` (files attached to the owner emails).
//
// `db` decides what is in the file: the caller's JWT client in export-xlsx
// (RLS applies), the service-role client in cron (everyone).
import ExcelJS from 'npm:exceljs@4.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** An instant shown as company wall-clock time (Excel has no timezones). */
function wall(iso: string | null, tz: string): Date | null {
  if (!iso) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}
const dateOnly = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const dur = (minutes: number) => minutes / 1440; // Excel days, shown as [h]:mm
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export interface WorkbookOptions { from: string; to: string; users?: string[] }

/** Builds the workbook; returns the file bytes and its file name. */
export async function buildWorkbook(db: SupabaseClient, opts: WorkbookOptions): Promise<{ bytes: Uint8Array; filename: string }> {
  const { from, to } = opts;
  const users = opts.users ?? [];
  const pick = (r: Row) => users.length === 0 || users.includes(r.user_id);

  const [settingsQ, reportQ, daysQ, dedQ, leaveQ, corrQ, peopleQ] = await Promise.all([
    db.from('settings').select('company_name, currency, timezone').eq('id', 1).maybeSingle(),
    db.rpc('pay_report', { p_from: from, p_to: to }),
    db.rpc('pay_days', { p_from: from, p_to: to }),
    db.from('deductions').select('*').lte('start_date', to).or(`end_date.is.null,end_date.gte.${from}`),
    db.from('leave_requests').select('*').lte('start_date', to).gte('end_date', from).order('start_date'),
    db.from('corrections').select('*').gte('new_clock_in', `${from}T00:00:00Z`).lte('new_clock_in', `${to}T23:59:59Z`).order('created_at'),
    db.from('profiles').select('id, full_name'),
  ]);
  if (reportQ.error || daysQ.error) throw new Error('Could not read the hours.');
  const company = settingsQ.data?.company_name ?? 'Company';
  const currency = settingsQ.data?.currency ?? 'PLN';
  const tz = settingsQ.data?.timezone ?? 'Europe/Warsaw';
  const names = new Map<string, string>((peopleQ.data ?? []).map((p: Row) => [p.id, p.full_name]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? '—' : 'Everyone');
  const money = `#,##0.00 "${currency === 'PLN' ? 'zł' : currency}"`;

  const report = ((reportQ.data ?? []) as Row[]).filter(pick).filter((r) => r.role !== 'owner' || n(r.worked_minutes) > 0);
  const days = ((daysQ.data ?? []) as Row[]).filter(pick);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ShiftClock';
  wb.created = new Date();

  const sheet = (name: string, cols: { header: string; key: string; width: number; fmt?: string }[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEA' } };
    head.alignment = { vertical: 'middle' };
    head.height = 22;
    return ws;
  };
  const finish = (ws: ExcelJS.Worksheet, cols: number) => {
    if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: cols } };
  };

  // ---------- Summary ----------
  const sum = sheet('Summary', [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Job title', key: 'job', width: 16 },
    { header: 'Days worked', key: 'days', width: 12, fmt: '0' },
    { header: 'Hours', key: 'hours', width: 10, fmt: '[h]:mm' },
    { header: 'Regular', key: 'reg', width: 10, fmt: '[h]:mm' },
    { header: 'Overtime', key: 'ot', width: 10, fmt: '[h]:mm' },
    { header: 'Rate / h', key: 'rate', width: 12, fmt: money },
    { header: 'Gross', key: 'gross', width: 14, fmt: money },
    { header: 'Deductions', key: 'ded', width: 14, fmt: money },
    { header: 'Net', key: 'net', width: 14, fmt: money },
    { header: 'Late', key: 'late', width: 8, fmt: '0' },
    { header: 'Absent', key: 'absent', width: 8, fmt: '0' },
    { header: 'Leave days', key: 'leave', width: 11, fmt: '0' },
  ]);
  for (const r of report) {
    sum.addRow({ name: r.full_name, job: r.job_title ?? '', days: n(r.days_worked), hours: dur(n(r.worked_minutes)), reg: dur(n(r.regular_minutes)), ot: dur(n(r.overtime_minutes)), rate: r.rate === null ? null : n(r.rate), gross: n(r.gross), ded: n(r.deductions), net: n(r.net), late: n(r.late_count), absent: n(r.absent_count), leave: n(r.leave_days) });
  }
  const last = sum.rowCount;
  finish(sum, 13);
  if (report.length) {
    const t = sum.addRow({ name: 'Total' });
    for (const c of ['C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M']) t.getCell(c).value = { formula: `SUM(${c}2:${c}${last})` };
    t.font = { bold: true };
    t.border = { top: { style: 'thin' } };
  }
  sum.addRow({});
  sum.addRow({ name: `${company} · ${from} to ${to} · times in ${tz}` }).font = { italic: true, color: { argb: 'FF777777' } };

  // ---------- Daily detail ----------
  const det = sheet('Daily detail', [
    { header: 'Date', key: 'day', width: 12, fmt: 'yyyy-mm-dd' },
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'First in', key: 'in', width: 9, fmt: 'hh:mm' },
    { header: 'Last out', key: 'out', width: 9, fmt: 'hh:mm' },
    { header: 'Break (min)', key: 'brk', width: 11, fmt: '0' },
    { header: 'Worked', key: 'worked', width: 10, fmt: '[h]:mm' },
    { header: 'Hours (decimal)', key: 'dec', width: 15, fmt: '0.00' },
    { header: 'Shift', key: 'shift', width: 13 },
    { header: 'Late', key: 'late', width: 7 },
    { header: 'How', key: 'how', width: 12 },
    { header: 'Corrected', key: 'corr', width: 10 },
  ]);
  for (const d of days) {
    det.addRow({
      day: dateOnly(d.day), name: nameOf(d.user_id), in: wall(d.first_in, tz), out: wall(d.last_out, tz), brk: n(d.break_minutes),
      worked: dur(n(d.minutes)), dec: n(d.minutes) / 60,
      shift: d.shift_start ? `${String(d.shift_start).slice(0, 5)}–${String(d.shift_end ?? '').slice(0, 5)}` : '',
      late: d.late ? 'Yes' : '', how: d.open ? `${d.methods} (open)` : d.methods, corr: d.corrected ? 'Yes' : '',
    });
  }
  const dl = det.rowCount;
  finish(det, 11);
  if (days.length) {
    const t = det.addRow({ name: 'Total' });
    t.getCell('F').value = { formula: `SUM(F2:F${dl})` };
    t.getCell('G').value = { formula: `SUM(G2:G${dl})` };
    t.font = { bold: true };
    t.border = { top: { style: 'thin' } };
  }

  // ---------- Deductions ----------
  const ded = sheet('Deductions', [
    { header: 'For', key: 'who', width: 24 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'How often', key: 'often', width: 13 },
    { header: 'From', key: 'from', width: 12, fmt: 'yyyy-mm-dd' },
    { header: 'Until', key: 'until', width: 12, fmt: 'yyyy-mm-dd' },
  ]);
  for (const x of ((dedQ.data ?? []) as Row[]).filter((x) => x.user_id === null || pick(x))) {
    const row = ded.addRow({ who: nameOf(x.user_id), name: x.name, type: x.type === 'percent' ? '% of gross' : 'Fixed', amount: x.type === 'percent' ? n(x.amount) / 100 : n(x.amount), often: x.type === 'percent' ? 'Each period' : x.recurring === 'once' ? 'Once' : x.recurring === 'weekly' ? 'Every week' : 'Every month', from: dateOnly(x.start_date), until: dateOnly(x.end_date) });
    row.getCell('amount').numFmt = x.type === 'percent' ? '0.0%' : money;
  }
  finish(ded, 7);

  // ---------- Leave ----------
  const lv = sheet('Leave', [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'From', key: 'from', width: 12, fmt: 'yyyy-mm-dd' },
    { header: 'To', key: 'to', width: 12, fmt: 'yyyy-mm-dd' },
    { header: 'Days', key: 'days', width: 7, fmt: '0' },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Note', key: 'note', width: 32 },
  ]);
  const LEAVE: Record<string, string> = { annual: 'Holiday', sick: 'Sick', unpaid: 'Unpaid', other: 'Other' };
  for (const l of ((leaveQ.data ?? []) as Row[]).filter(pick)) {
    lv.addRow({ name: nameOf(l.user_id), type: LEAVE[l.type] ?? l.type, from: dateOnly(l.start_date), to: dateOnly(l.end_date), days: Math.round((Date.parse(l.end_date) - Date.parse(l.start_date)) / 86400000) + 1, status: l.status[0].toUpperCase() + l.status.slice(1), note: l.reason ?? l.note ?? '' });
  }
  finish(lv, 7);

  // ---------- Corrections ----------
  const co = sheet('Corrections', [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Asked on', key: 'asked', width: 17, fmt: 'yyyy-mm-dd hh:mm' },
    { header: 'Old in', key: 'oi', width: 17, fmt: 'yyyy-mm-dd hh:mm' },
    { header: 'Old out', key: 'oo', width: 17, fmt: 'yyyy-mm-dd hh:mm' },
    { header: 'New in', key: 'ni', width: 17, fmt: 'yyyy-mm-dd hh:mm' },
    { header: 'New out', key: 'no', width: 17, fmt: 'yyyy-mm-dd hh:mm' },
    { header: 'Reason', key: 'reason', width: 34 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Decided by', key: 'by', width: 20 },
  ]);
  for (const c of ((corrQ.data ?? []) as Row[]).filter(pick)) {
    co.addRow({ name: nameOf(c.user_id), asked: wall(c.created_at, tz), oi: wall(c.old_clock_in, tz), oo: wall(c.old_clock_out, tz), ni: wall(c.new_clock_in, tz), no: wall(c.new_clock_out, tz), reason: c.reason, status: c.status[0].toUpperCase() + c.status.slice(1), by: c.reviewed_by ? nameOf(c.reviewed_by) : '' });
  }
  finish(co, 9);

  const buf = await wb.xlsx.writeBuffer();
  const safe = company.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Company';
  return { bytes: new Uint8Array(buf as ArrayBuffer), filename: `ShiftClock_${safe}_${from}_${to}.xlsx` };
}
