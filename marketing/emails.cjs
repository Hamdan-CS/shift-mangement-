// Renders the automatic emails and the Excel sheets with the café demo data,
// for the marketing guide. Email HTML = the same layout as supabase/functions/cron
// (page(), table() and each job's body), filled with numbers read from the running
// demo app (port 5176, VITE_DEMO_SEED=cookiery). Owner reports get a small mail
// header with the attached Excel file, as they arrive in a mailbox.
// Run: npx playwright-cli run-code --filename=marketing/emails.cjs
async page => {
  const base = 'http://localhost:5176';
  const out = 'marketing/shots';
  const TZ = 'Europe/Warsaw';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const month = Number(today.slice(5, 7));
  const fixed = Date.parse(`${today}T11:20:00${month >= 4 && month <= 10 ? '+02:00' : '+01:00'}`);
  const APP = 'https://shiftclock-web-d448.vercel.app';

  /* ---------- the same helpers as the cron function ---------- */
  const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const mondayOf = (d) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const hm = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '—');
  const hours = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
  const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', useGrouping: 'always' }).format(n);
  function emailPage(title, intro, inner, cta) {
    return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f1115">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #ebecef;border-radius:18px">
<tr><td style="padding:24px 24px 8px"><div style="font-size:13px;font-weight:600;color:#2f5bea">ShiftClock</div>
<h1 style="margin:6px 0 4px;font-size:22px;letter-spacing:-.02em">${esc(title)}</h1>
<p style="margin:0;color:#565c69;font-size:14px;line-height:1.5">${intro}</p></td></tr>
<tr><td style="padding:16px 24px 8px">${inner}</td></tr>
${cta ? `<tr><td style="padding:8px 24px 24px"><a href="${cta.href}" style="display:inline-block;background:#2f5bea;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:10px">${esc(cta.label)}</a></td></tr>` : ''}
</table><p style="color:#8b909b;font-size:12px;margin:14px 0 0">Sent by ShiftClock. Times are in company time. Change which emails you get under My settings.</p></td></tr></table></body></html>`;
  }
  function table(head, rows, right = []) {
    const th = head.map((h, i) => `<th style="text-align:${right.includes(i) ? 'right' : 'left'};font-size:12px;font-weight:500;color:#8b909b;padding:8px 6px;border-bottom:1px solid #ebecef">${esc(h)}</th>`).join('');
    const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${right.includes(i) ? 'right' : 'left'};font-size:13px;padding:8px 6px;border-bottom:1px solid #f1f2f4">${c}</td>`).join('')}</tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }
  /** a mailbox header above the email: from, to, subject, attachment */
  const inbox = (html, { to, subject, file, when }) => html.replace('<body style="margin:0;background:#f4f5f7;', `<body style="margin:0;background:#f4f5f7;`).replace(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">',
    `<div style="max-width:640px;margin:0 auto;padding:22px 12px 0"><div style="background:#fff;border:1px solid #ebecef;border-radius:14px;padding:14px 18px;font-size:13px;color:#565c69;line-height:1.7">
<div style="font-size:16px;font-weight:600;color:#0f1115;margin-bottom:4px">${esc(subject)}</div>
<div><b style="color:#0f1115;font-weight:600">Café</b> · to ${esc(to)}<span style="float:right">${esc(when)}</span></div>
${file ? `<div style="margin-top:10px;display:inline-flex;align-items:center;gap:10px;border:1px solid #ebecef;border-radius:10px;padding:8px 12px"><span style="display:inline-block;width:26px;height:30px;border-radius:5px;background:#1f7a4d;color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:30px">XLS</span><span><b style="color:#0f1115;font-weight:600">${esc(file)}</b><br><span style="font-size:12px">Excel file</span></span></div>` : ''}
</div></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:14px 12px 28px">`);

  /* ---------- read the demo café's numbers from the app ---------- */
  const browser = page.context().browser();
  const ctx = await browser.newContext({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'pl-PL', timezoneId: TZ });
  await ctx.clock.install({ time: fixed });
  await ctx.addInitScript(() => { localStorage.setItem('shiftclock-demo-user', 'demo-owner'); localStorage.setItem('shiftclock-theme', 'light'); });
  const p = await ctx.newPage();
  await p.goto(base + '/');
  await p.waitForLoadState('networkidle');
  const yesterday = addDays(today, -1);
  const lastMon = addDays(mondayOf(today), -7);
  const lastSun = addDays(lastMon, 6);
  const data = await p.evaluate(async ({ d, wf, wt }) => {
    const pay = await import('/src/services/pay.ts');
    const sch = await import('/src/services/schedules.ts');
    const demo = await import('/src/services/demo.ts');
    return {
      dayRep: await pay.fetchPayReport(d, d), dayDays: await pay.fetchPayDays(d, d), dayShifts: await sch.fetchShiftsRange(d, d),
      wkRep: await pay.fetchPayReport(wf, wt), wkDays: await pay.fetchPayDays(wf, wt), wkShifts: await sch.fetchShiftsRange(wf, wt),
      people: demo.DEMO_PROFILES.map((x) => ({ id: x.id, full_name: x.full_name, role: x.role, job_title: x.job_title, hourly_rate: x.hourly_rate })),
    };
  }, { d: yesterday, wf: lastMon, wt: lastSun });
  const person = (id) => data.people.find((x) => x.id === id);

  /* ---------- the emails ---------- */
  const emails = [];
  // 1. staff daily summary (Jakub, yesterday)
  {
    const d = data.dayDays.find((x) => x.user_id === 'demo-jakub');
    const pr = person('demo-jakub');
    const earned = (pr.hourly_rate * d.minutes) / 60;
    const inner = table(['', ''], [['Clock in', hm(d.first_in)], ['Clock out', d.last_out ? hm(d.last_out) : 'still working'], ['Break', `${d.break_minutes} min`], ['Hours', `<b>${hours(d.minutes)}</b>`], ['Earned today', `<b>${money(earned)}</b>`]], [1]);
    emails.push({ name: 'email-staff-daily', html: emailPage(`Your day, ${longDay(yesterday)}`, 'Here is today at Café. Something wrong? Ask for a correction.', inner, { href: `${APP}/history`, label: 'Request a correction' }) });
  }
  // 2. staff weekly summary (Jakub, last week)
  {
    const r = data.wkRep.find((x) => x.user_id === 'demo-jakub');
    const mine = data.wkDays.filter((x) => x.user_id === 'demo-jakub');
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(lastMon, i);
      const d = mine.find((x) => x.day === day);
      const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      rows.push(d ? [label, `${hm(d.first_in)} – ${d.last_out ? hm(d.last_out) : 'now'}`, hours(d.minutes), money((r.rate * d.minutes) / 60)] : [label, '—', '—', '—']);
    }
    rows.push(['<b>Total</b>', '', `<b>${hours(r.worked_minutes)}</b>`, `<b>${money(r.gross)}</b>`]);
    const sumUp = table(['', ''], [...(r.overtime_minutes ? [['Overtime', hours(r.overtime_minutes)]] : []), ['Gross', money(r.gross)], ...(r.deductions ? [['Deductions', `−${money(r.deductions)}`]] : []), ['Net pay', `<b>${money(r.net)}</b>`]], [1]);
    emails.push({ name: 'email-staff-weekly', html: emailPage(`Your week, ${lastMon} to ${lastSun}`, 'Here are your hours at Café. Something wrong? Ask for a correction.', table(['Day', 'In – out', 'Hours', 'Earned'], rows, [2, 3]) + '<div style="height:14px"></div>' + sumUp, { href: `${APP}/pay`, label: 'Open my pay' }) });
  }
  // 3 + 4. owner daily / weekly with the Excel file
  const ownerReport = (from, to, rep, days, shifts) => {
    const single = from === to;
    const rows = rep.filter((r) => r.role !== 'owner' || r.worked_minutes > 0);
    const planned = (uid) => shifts.filter((x) => x.user_id === uid).reduce((m, x) => m + toMin(x.end_time) - toMin(x.start_time), 0);
    const firstIn = (uid) => days.find((d) => d.user_id === uid);
    const head = single ? ['Person', 'Planned', 'In – out', 'Hours', 'Earned', 'Status'] : ['Person', 'Planned', 'Hours', 'Overtime', 'Gross', 'Deductions', 'Net'];
    const body = rows.map((r) => {
      const status = r.late_count ? '<span style="color:#b7791f">Late</span>' : r.absent_count ? '<span style="color:#e0383e">Absent</span>' : r.leave_days ? 'On leave' : r.worked_minutes ? 'OK' : '—';
      const d = firstIn(r.user_id);
      return single
        ? [esc(r.full_name), hours(planned(r.user_id)), d ? `${hm(d.first_in)} – ${d.last_out ? hm(d.last_out) : 'now'}` : '—', hours(r.worked_minutes), money(r.gross), status]
        : [esc(r.full_name), hours(planned(r.user_id)), hours(r.worked_minutes), hours(r.overtime_minutes), money(r.gross), money(r.deductions), `<b>${money(r.net)}</b>`];
    });
    const tot = (k) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    body.push(single ? ['<b>Total</b>', '', '', `<b>${hours(tot('worked_minutes'))}</b>`, `<b>${money(tot('gross'))}</b>`, ''] : ['<b>Total</b>', '', `<b>${hours(tot('worked_minutes'))}</b>`, `<b>${hours(tot('overtime_minutes'))}</b>`, `<b>${money(tot('gross'))}</b>`, `<b>${money(tot('deductions'))}</b>`, `<b>${money(tot('net'))}</b>`]);
    const late = rows.reduce((a, r) => a + r.late_count, 0), absent = rows.reduce((a, r) => a + r.absent_count, 0);
    const intro = `${single ? longDay(from) : `Week ${from} to ${to}`} · Café. ${late} late, ${absent} absent, 2 requests waiting for approval. The Excel file has the full detail.`;
    const subject = single ? `Daily report ${from}: ${hours(tot('worked_minutes'))}, ${money(tot('gross'))}` : `Weekly report ${from} – ${to}: net ${money(tot('net'))}`;
    return { subject, html: emailPage(single ? 'Daily report' : 'Weekly report', intro, table(head, body, single ? [1, 3, 4] : [1, 2, 3, 4, 5, 6]), { href: `${APP}/admin/${single ? 'timesheets' : 'payroll'}`, label: single ? 'Open timesheets' : 'Open payroll' }) };
  };
  {
    const o = ownerReport(yesterday, yesterday, data.dayRep, data.dayDays, data.dayShifts);
    emails.push({ name: 'email-owner-daily', html: inbox(o.html, { to: 'you, your accountant', subject: o.subject, file: `ShiftClock_Cafe_${yesterday}_${yesterday}.xlsx`, when: '23:15' }) });
    const w = ownerReport(lastMon, lastSun, data.wkRep, data.wkDays, data.wkShifts);
    emails.push({ name: 'email-owner-weekly', html: inbox(w.html, { to: 'you, your accountant', subject: w.subject, file: `ShiftClock_Cafe_${lastMon}_${lastSun}.xlsx`, when: 'Sunday 23:30' }) });
  }
  // 5. approval needed (instant)
  emails.push({ name: 'email-approval-needed', html: emailPage('Approval needed: Piotr Wójcik asked to fix a clock time', 'Piotr Wójcik asked to correct a clock time.', '', { href: `${APP}/admin/approvals`, label: 'Review request' }) });
  // 6. request approved (instant, to the employee)
  emails.push({ name: 'email-request-approved', html: emailPage('Your leave request was approved', 'Katarzyna Wiśniewska approved your leave request. Note: Enjoy the wedding!', '', { href: `${APP}/leave`, label: 'Open ShiftClock' }) });
  // 7. schedule reminder (deadline day)
  {
    const next = addDays(mondayOf(today), 7);
    emails.push({ name: 'email-schedule-reminder', html: emailPage("Submit next week's schedule", `Please plan your shifts for the week of ${longDay(next)} before Thursday 18:00 today.`, '', { href: `${APP}/schedule`, label: 'Plan my week' }) });
  }

  await p.setViewportSize({ width: 700, height: 120 });
  for (const e of emails) {
    await p.setContent(e.html, { waitUntil: 'load' });
    await p.screenshot({ path: `${out}/${e.name}.png`, fullPage: true });
  }

  /* ---------- the Excel file, drawn as its two main sheets ---------- */
  const xlMoney = (n) => (n === null ? '' : new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n) + ' zł');
  const hmm = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const sheet = (title, cols, rows, widths, tabs, active) => `<!doctype html><html><head><style>
    body{margin:0;background:#fff;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:13px;color:#111}
    .bar{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#1f7a4d;color:#fff;font:600 13px 'Segoe UI',Arial}
    .bar span{opacity:.85;font-weight:400}
    table{border-collapse:collapse;table-layout:fixed}
    td,th{border:1px solid #d9dce1;padding:4px 7px;height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    th.col{background:#f3f4f6;color:#555;font-weight:400;text-align:center;font-size:12px}
    td.rn{background:#f3f4f6;color:#555;text-align:center;font-size:12px;width:30px}
    tr.h td{background:#efefea;font-weight:700}
    tr.t td{font-weight:700;border-top:2px solid #888}
    td.n{text-align:right}
    .tabs{display:flex;gap:2px;padding:6px 10px;background:#f3f4f6;border-top:1px solid #d9dce1;font:12px 'Segoe UI',Arial}
    .tabs span{padding:4px 12px;color:#555}.tabs span.on{background:#fff;color:#1f7a4d;font-weight:700;border-bottom:2px solid #1f7a4d}
  </style></head><body>
  <div class="bar">ShiftClock_Cafe_${lastMon}_${lastSun}.xlsx <span>· ${title}</span></div>
  <table><colgroup><col style="width:30px">${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>
  <tr><th class="col"></th>${cols.map((_, i) => `<th class="col">${String.fromCharCode(65 + i)}</th>`).join('')}</tr>
  <tr class="h"><td class="rn">1</td>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>
  ${rows.map((r, i) => `<tr class="${r.total ? 't' : ''}"><td class="rn">${i + 2}</td>${r.cells.map((c, j) => `<td class="${r.num?.includes(j) ? 'n' : ''}">${c ?? ''}</td>`).join('')}</tr>`).join('')}
  </table>
  <div class="tabs">${tabs.map((t) => `<span class="${t === active ? 'on' : ''}">${t}</span>`).join('')}</div>
  </body></html>`;
  const tabs = ['Summary', 'Daily detail', 'Deductions', 'Leave', 'Corrections'];
  {
    const rep = data.wkRep.filter((r) => r.role !== 'owner' || r.worked_minutes > 0);
    const NUM = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const rows = rep.map((r) => ({ num: NUM, cells: [r.full_name, r.job_title ?? '', r.days_worked, hmm(r.worked_minutes), hmm(r.regular_minutes), hmm(r.overtime_minutes), xlMoney(r.rate), xlMoney(r.gross), xlMoney(r.deductions), xlMoney(r.net), r.late_count, r.absent_count, r.leave_days] }));
    const sum = (k) => rep.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    rows.push({ total: true, num: NUM, cells: ['Total', '', sum('days_worked'), hmm(sum('worked_minutes')), hmm(sum('regular_minutes')), hmm(sum('overtime_minutes')), '', xlMoney(sum('gross')), xlMoney(sum('deductions')), xlMoney(sum('net')), sum('late_count'), sum('absent_count'), sum('leave_days')] });
    rows.push({ cells: [] });
    rows.push({ cells: [`<i style="color:#777">Café · ${lastMon} to ${lastSun} · times in Europe/Warsaw</i>`] });
    const html = sheet('Summary', ['Employee', 'Job title', 'Days worked', 'Hours', 'Regular', 'Overtime', 'Rate / h', 'Gross', 'Deductions', 'Net', 'Late', 'Absent', 'Leave days'], rows, [170, 90, 82, 62, 62, 66, 80, 96, 86, 96, 44, 52, 72], tabs, 'Summary');
    await p.setViewportSize({ width: 1300, height: 120 });
    await p.setContent(html, { waitUntil: 'load' });
    await p.screenshot({ path: `${out}/excel-summary.png`, fullPage: true });
  }
  {
    const name = (id) => person(id)?.full_name ?? '';
    const days = [...data.wkDays].sort((a, b) => (a.day + name(a.user_id)).localeCompare(b.day + name(b.user_id))).slice(0, 18);
    // planned shift + late, as the database fills them in (demo mode leaves them empty)
    const shiftOf = (d) => data.wkShifts.find((x) => x.user_id === d.user_id && x.date === d.day);
    const inMin = (iso) => { const [h, m] = hm(iso).split(':').map(Number); return h * 60 + m; };
    const rows = days.map((d) => {
      const sh = shiftOf(d);
      const late = sh ? inMin(d.first_in) > toMin(sh.start_time) + 5 : false;
      return { num: [4, 5, 6], cells: [d.day.split('-').reverse().join('.'), name(d.user_id), hm(d.first_in), d.last_out ? hm(d.last_out) : '', d.break_minutes, hmm(d.minutes), (d.minutes / 60).toFixed(2).replace('.', ','), sh ? `${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)}` : '', late ? 'Yes' : '', d.open ? `${d.methods} (open)` : d.methods, d.corrected ? 'Yes' : ''] };
    });
    const html = sheet('Daily detail', ['Date', 'Employee', 'First in', 'Last out', 'Break (min)', 'Worked', 'Hours (decimal)', 'Shift', 'Late', 'How', 'Corrected'], rows, [86, 170, 62, 66, 82, 66, 110, 100, 44, 70, 76], tabs, 'Daily detail');
    await p.setViewportSize({ width: 1100, height: 120 });
    await p.setContent(html, { waitUntil: 'load' });
    await p.screenshot({ path: `${out}/excel-daily.png`, fullPage: true });
  }
  await ctx.close();
  return emails.map((e) => e.name).join(', ') + ', excel-summary, excel-daily';
}
