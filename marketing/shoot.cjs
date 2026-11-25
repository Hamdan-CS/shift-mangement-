// Marketing guide screenshots (café demo, browser-only demo data).
// Needs the café demo server on port 5176:
//   PowerShell: $env:VITE_DEMO_AUTH='1'; $env:VITE_DEMO_SEED='cookiery'; npx vite --port 5176
// Run: npx playwright-cli open about:blank
//      npx playwright-cli run-code --filename=marketing/shoot.cjs
// Output: marketing/shots/<name>.png — desktop 1440×900 @2x, phones 390×844 @3x, light mode.
// The clock is fixed at 11:20 Warsaw time today so the Today view shows a busy mid-morning.
async page => {
  const base = 'http://localhost:5176';
  const out = 'marketing/shots';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  // Warsaw is UTC+1 in winter, UTC+2 in summer
  const month = Number(today.slice(5, 7));
  const offset = month >= 4 && month <= 10 ? '+02:00' : '+01:00';
  const fixed = Date.parse(`${today}T11:20:00${offset}`);

  const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const shots = [
    // owner / manager
    { name: 'owner-home', user: 'demo-owner', path: '/', open: 'chart-week' },
    { name: 'today-timeline', user: 'demo-owner', path: '/today', full: true },
    { name: 'week-schedule', user: 'demo-manager', path: '/admin/schedule', open: 'week', full: true },
    { name: 'owner-bell', user: 'demo-owner', path: '/admin/approvals', open: 'bell' },
    { name: 'today-list', user: 'demo-owner', path: '/today', open: 'list' },
    { name: 'team-month', user: 'demo-manager', path: '/admin/schedule', open: 'month' },
    { name: 'approvals-drawer', user: 'demo-owner', path: '/admin/approvals', open: 'drawer' },
    { name: 'people', user: 'demo-owner', path: '/admin/people' },
    { name: 'person', user: 'demo-owner', path: '/admin/people/demo-jakub' },
    { name: 'payroll', user: 'demo-owner', path: '/admin/payroll', full: true },
    { name: 'reports', user: 'demo-owner', path: '/admin/reports' },
    { name: 'settings', user: 'demo-owner', path: '/admin/settings' },
    { name: 'locations', user: 'demo-owner', path: '/admin/locations' },
    { name: 'kiosk', user: 'demo-owner', path: '/kiosk/loc-counter' },
    // employee (desktop)
    { name: 'emp-home', user: 'demo-jakub', path: '/', open: 'chart-week' },
    { name: 'emp-week', user: 'demo-jakub', path: '/schedule', open: 'week' },
    { name: 'emp-pay', user: 'demo-jakub', path: '/pay' },
    { name: 'emp-leave', user: 'demo-zofia', path: '/leave' },
    { name: 'emp-correction', user: 'demo-jakub', path: '/history', open: 'fix' },
    // phones
    { name: 'phone-home', user: 'demo-jakub', path: '/', device: phone },
    { name: 'phone-today', user: 'demo-jakub', path: '/today', device: phone, open: 'list' },
  ];

  const browser = page.context().browser();
  const log = [];
  for (const s of shots) {
    const ctx = await browser.newContext({ ...(s.device ?? desk), colorScheme: 'light', locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
    await ctx.clock.install({ time: fixed });
    await ctx.addInitScript((uid) => {
      localStorage.setItem('shiftclock-demo-user', uid);
      localStorage.setItem('shiftclock-theme', 'light');
    }, s.user);
    const p = await ctx.newPage();
    const errors = [];
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(base + s.path);
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(900);
    if (s.open === 'week') { await p.getByRole('button', { name: 'Week', exact: true }).first().click(); await p.waitForTimeout(600); }
    if (s.open === 'drawer') { await p.locator('.ap-open').first().click(); await p.waitForTimeout(700); }
    if (s.open === 'fix') { await p.getByRole('button', { name: /^Request correction for/ }).first().click(); await p.waitForTimeout(700); }
    if (s.open === 'chart-week') { await p.getByRole('button', { name: 'Week', exact: true }).first().click(); await p.waitForTimeout(600); }
    if (s.open === 'bell') { await p.getByRole('button', { name: /Notifications/ }).first().click(); await p.waitForTimeout(600); }
    if (s.open === 'month') { await p.getByRole('button', { name: 'Month', exact: true }).first().click(); await p.waitForTimeout(700); }
    if (s.open === 'list') { await p.getByRole('button', { name: 'List', exact: true }).click(); await p.waitForTimeout(500); }
    // let entry animations finish
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${s.name}.png`, fullPage: Boolean(s.full) });
    log.push(`${s.name}: ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok'}`);
    await ctx.close();
  }
  return log.join('\n');
}
