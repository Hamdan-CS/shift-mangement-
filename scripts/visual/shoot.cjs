// Screenshots + mobile checks for every Phase 1 screen (PLAN.md 10c test sizes).
// Needs a demo-mode dev server on port 5174 (your .env.local can stay on the real database):
//   PowerShell: $env:VITE_DEMO_AUTH='1'; npx vite --port 5174
// Run: npx playwright-cli open about:blank
//      npx playwright-cli run-code --filename=scripts/visual/shoot.cjs
// Output: screenshots/<page>-<width>-<theme>.png (+ landscape as <page>-844x390-<theme>.png)
// Returns a report: horizontal scroll, tap targets under 44px (touch sizes), text under 12px, console errors.
async page => {
  const base = 'http://localhost:5174';
  const screens = [
    { name: 'login', path: '/login', user: null },
    { name: 'home-employee', path: '/', user: 'demo-ali' },
    { name: 'home-owner', path: '/', user: 'demo-owner' },
    { name: 'today', path: '/today', user: 'demo-ali' },
    { name: 'schedule', path: '/schedule', user: 'demo-ali' },
    { name: 'schedule-team', path: '/schedule', user: 'demo-ali', open: 'team' },
    { name: 'shift-edit', path: '/schedule', user: 'demo-ali', open: 'edit' },
    { name: 'admin-day', path: '/admin/schedule', user: 'demo-manager' },
    { name: 'admin-week', path: '/admin/schedule', user: 'demo-manager', open: 'week' },
    { name: 'today-timeline', path: '/today', user: 'demo-manager', open: 'timeline' },
    { name: 'shift-sheet', path: '/today', user: 'demo-ali', open: 'row' },
    { name: 'history', path: '/history', user: 'demo-ali' },
    { name: 'finish-sheet', path: '/', user: 'demo-ali', open: 'finish' },
    { name: 'locations', path: '/admin/locations', user: 'demo-owner' },
    { name: 'leave', path: '/leave', user: 'demo-ali' },
    { name: 'correction-sheet', path: '/history', user: 'demo-ali', open: 'fix' },
    { name: 'approvals', path: '/admin/approvals', user: 'demo-manager' },
    { name: 'approval-drawer', path: '/admin/approvals', user: 'demo-manager', open: 'drawer' },
    { name: 'bell', path: '/', user: 'demo-manager', open: 'bell' },
    { name: 'kiosk', path: '/kiosk/00000000-0000-4000-8000-00000000d001', user: 'demo-manager' },
    { name: 'scan-in', path: '/clock?loc=00000000-0000-4000-8000-00000000d001&t=demo-1', user: 'demo-lina' },
    { name: 'scan-expired', path: '/clock?loc=00000000-0000-4000-8000-00000000d001&t=old', user: 'demo-lina' },
    { name: 'more-sheet', path: '/', user: 'demo-ali', open: 'more' },
    { name: 'messages', path: '/messages', user: 'demo-ali' },
    { name: 'thread', path: '/messages/demo-team-chat', user: 'demo-ali' },
    { name: 'pay', path: '/pay', user: 'demo-ali' },
    { name: 'payroll', path: '/admin/payroll', user: 'demo-manager' },
    { name: 'people', path: '/admin/people', user: 'demo-owner' },
    { name: 'add-person', path: '/admin/people', user: 'demo-owner', open: 'add-person' },
    { name: 'person', path: '/admin/people/demo-ali', user: 'demo-owner' },
    { name: 'timesheets', path: '/admin/timesheets', user: 'demo-manager' },
    { name: 'entry-sheet', path: '/admin/timesheets', user: 'demo-manager', open: 'entry' },
    { name: 'settings', path: '/admin/settings', user: 'demo-owner' },
    { name: 'reports', path: '/admin/reports', user: 'demo-manager' },
  ];
  const sizes = [
    { id: '360', w: 360, h: 740 },
    { id: '390', w: 390, h: 844 },
    { id: '430', w: 430, h: 932 },
    { id: '768', w: 768, h: 1024 },
    { id: '1440', w: 1440, h: 900 },
    { id: '844x390', w: 844, h: 390 },
  ];
  const ONLY = []; // e.g. ['pay', 'payroll'] to shoot a few screens
  if (ONLY.length) screens.splice(0, screens.length, ...screens.filter((x) => ONLY.includes(x.name)));
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // Pin the clock to 13:20 company time (Europe/Warsaw, UTC+1 in November) so the red "now" line is on screen, like refs 11–12.
  await page.clock.setFixedTime(new Date('2026-11-24T12:20:00Z'));
  const issues = [];
  for (const theme of ['light', 'dark']) {
    for (const s of screens) {
      await page.goto(base + '/login');
      await page.evaluate(([u, t]) => {
        const e = (id, user, inn, out, method = 'button', edited = false) => ({ id, user_id: user, clock_in: inn, clock_out: out, method, location_id: null, break_minutes: 0, note: null, edited, created_at: inn });
        localStorage.setItem('shiftclock-demo-entries', JSON.stringify([
          e('t1', 'demo-ali', '2026-11-24T08:02:00Z', null),
          e('t2', 'demo-lina', '2026-11-24T05:30:00Z', '2026-11-24T11:05:00Z'),
          e('t3', 'demo-manager', '2026-11-24T07:00:00Z', null),
          e('h1', 'demo-ali', '2026-11-23T07:58:00Z', '2026-11-23T16:31:00Z'),
          e('h2', 'demo-ali', '2026-11-21T09:00:00Z', '2026-11-21T13:00:00Z', 'manual', true),
          e('p1', 'demo-ali', '2026-11-16T07:00:00Z', '2026-11-16T16:00:00Z'), e('p2', 'demo-ali', '2026-11-17T07:00:00Z', '2026-11-17T16:00:00Z'),
          e('p3', 'demo-ali', '2026-11-18T07:00:00Z', '2026-11-18T16:00:00Z'), e('p4', 'demo-ali', '2026-11-19T07:00:00Z', '2026-11-19T16:00:00Z', 'qr'),
          e('p5', 'demo-ali', '2026-11-20T07:00:00Z', '2026-11-20T16:00:00Z'), e('p6', 'demo-ali', '2026-11-10T08:00:00Z', '2026-11-10T14:30:00Z'),
          e('p7', 'demo-ali', '2026-11-12T08:00:00Z', '2026-11-12T16:00:00Z'), e('p8', 'demo-lina', '2026-11-23T05:30:00Z', '2026-11-23T11:00:00Z'),
          e('p9', 'demo-yusuf', '2026-11-23T12:00:00Z', '2026-11-23T20:00:00Z'), e('p10', 'demo-lina', '2026-11-20T05:30:00Z', '2026-11-20T12:30:00Z'),
        ]));
        // schedules: this week (Mon 23 Nov) + next week (Mon 30 Nov), Warsaw = UTC+1
        const wk = (id, user, start, status) => ({ id, user_id: user, week_start: start, status, submitted_at: status === 'draft' ? null : '2026-11-19T17:00:00Z', locked_by: null, locked_at: null });
        const sh = (id, week, user, date, a, b, note = null, edited = null) => ({ id, week_id: week, user_id: user, date, start_time: a, end_time: b, note, edited_by: edited });
        localStorage.setItem('shiftclock-demo-weeks', JSON.stringify([
          wk('w-ali', 'demo-ali', '2026-11-23', 'submitted'), wk('w-lina', 'demo-lina', '2026-11-23', 'submitted'),
          wk('w-yusuf', 'demo-yusuf', '2026-11-23', 'draft'), wk('w-mgr', 'demo-manager', '2026-11-23', 'locked'),
          wk('n-ali', 'demo-ali', '2026-11-30', 'draft'),
        ]));
        localStorage.setItem('shiftclock-demo-shifts', JSON.stringify([
          sh('s1', 'w-ali', 'demo-ali', '2026-11-23', '09:00', '17:00', 'Front till'), sh('s2', 'w-ali', 'demo-ali', '2026-11-24', '09:00', '17:00', 'Front till'),
          sh('s3', 'w-ali', 'demo-ali', '2026-11-26', '12:00', '20:00'), sh('s4', 'w-ali', 'demo-ali', '2026-11-27', '09:00', '15:00', null, 'demo-manager'),
          sh('s5', 'w-lina', 'demo-lina', '2026-11-24', '06:30', '12:00', 'Breakfast'), sh('s6', 'w-lina', 'demo-lina', '2026-11-25', '06:30', '14:30'),
          sh('s7', 'w-yusuf', 'demo-yusuf', '2026-11-24', '13:00', '21:00', 'Front desk'), sh('s8', 'w-yusuf', 'demo-yusuf', '2026-11-28', '10:00', '18:00'),
          sh('s9', 'w-mgr', 'demo-manager', '2026-11-24', '08:00', '16:00'), sh('s10', 'w-mgr', 'demo-manager', '2026-11-25', '08:00', '16:00'),
          sh('n1', 'n-ali', 'demo-ali', '2026-11-30', '09:00', '17:00'), sh('n2', 'n-ali', 'demo-ali', '2026-12-01', '09:00', '17:00'), sh('n3', 'n-ali', 'demo-ali', '2026-12-03', '14:00', '22:00', 'Closing'),
        ]));
        localStorage.removeItem('shiftclock-demo-locations');
        // requests + notifications (Phase 5)
        const rq = (o) => ({ reviewed_by: null, reviewed_at: null, review_note: null, applied_entry_id: null, ...o });
        localStorage.setItem('shiftclock-demo-corrections', JSON.stringify([
          rq({ id: 'c1', user_id: 'demo-ali', entry_id: 'h1', old_clock_in: '2026-11-23T07:58:00Z', old_clock_out: '2026-11-23T16:31:00Z', new_clock_in: '2026-11-23T06:30:00Z', new_clock_out: '2026-11-23T16:31:00Z', reason: 'I opened the shop early, forgot to clock in at 07:30', status: 'pending', created_at: '2026-11-24T07:10:00Z' }),
          rq({ id: 'c2', user_id: 'demo-lina', entry_id: null, old_clock_in: null, old_clock_out: null, new_clock_in: '2026-11-22T05:30:00Z', new_clock_out: '2026-11-22T11:00:00Z', reason: 'My phone was dead on Sunday', status: 'pending', created_at: '2026-11-23T19:40:00Z' }),
          rq({ id: 'c3', user_id: 'demo-yusuf', entry_id: null, old_clock_in: null, old_clock_out: null, new_clock_in: '2026-11-20T09:00:00Z', new_clock_out: '2026-11-20T17:00:00Z', reason: 'Forgot', status: 'declined', reviewed_by: 'demo-manager', reviewed_at: '2026-11-21T08:00:00Z', review_note: 'You were not on the rota that day', created_at: '2026-11-20T20:00:00Z' }),
        ]));
        localStorage.setItem('shiftclock-demo-leave', JSON.stringify([
          rq({ id: 'l1', user_id: 'demo-yusuf', type: 'annual', start_date: '2026-12-02', end_date: '2026-12-04', reason: 'Family wedding', status: 'pending', created_at: '2026-11-24T09:05:00Z' }),
          rq({ id: 'l2', user_id: 'demo-ali', type: 'sick', start_date: '2026-11-17', end_date: '2026-11-18', reason: 'Flu', status: 'approved', reviewed_by: 'demo-manager', reviewed_at: '2026-11-17T08:00:00Z', created_at: '2026-11-17T06:30:00Z' }),
        ]));
        const nt = (id, to, type, payload, read) => ({ id, recipient_id: to, type, payload, read_at: read ? '2026-11-24T10:00:00Z' : null, created_at: '2026-11-24T09:05:00Z' });
        localStorage.setItem('shiftclock-demo-notifications', JSON.stringify([
          nt('n1', 'demo-manager', 'leave.requested', { kind: 'leave', employee_name: 'Yusuf Karim' }, false),
          nt('n2', 'demo-manager', 'correction.requested', { kind: 'correction', employee_name: 'Ali Hassan' }, false),
          nt('n3', 'demo-ali', 'request.approved', { kind: 'leave', reviewer_name: 'Omar Haddad' }, true),
          nt('n4', 'demo-ali', 'schedule.changed', { editor_name: 'Omar Haddad', date: '2026-11-27', start: '09:00', end: '15:00', change: 'update' }, false),
        ]));
        // messages + deductions (Phases 6, 7)
        const ms = (id, who, body, at) => ({ id, conversation_id: 'demo-team-chat', sender_id: who, body, created_at: at });
        localStorage.setItem('shiftclock-demo-messages', JSON.stringify([
          ms('m1', 'demo-manager', 'Morning all. Delivery comes at 10 today, Lina can you take it?', '2026-11-24T07:05:00Z'),
          ms('m2', 'demo-lina', 'Yes, I will be at the back door.', '2026-11-24T07:09:00Z'),
          ms('m3', 'demo-ali', 'I can cover the till while you do it.', '2026-11-24T07:12:00Z'),
          ms('m4', 'demo-manager', 'Thanks both 👍', '2026-11-24T07:15:00Z'),
        ]));
        localStorage.removeItem('shiftclock-demo-reads');
        localStorage.setItem('shiftclock-demo-deductions', JSON.stringify([
          { id: 'd1', user_id: null, name: 'Income tax', type: 'percent', amount: 12, recurring: 'once', start_date: '2026-01-01', end_date: null, created_at: '2026-01-01T00:00:00Z' },
          { id: 'd2', user_id: 'demo-ali', name: 'Uniform', type: 'fixed', amount: 40, recurring: 'once', start_date: '2026-11-17', end_date: null, created_at: '2026-11-17T00:00:00Z' },
        ]));
        localStorage.setItem('shiftclock-theme', t);
        if (u) localStorage.setItem('shiftclock-demo-user', u); else localStorage.removeItem('shiftclock-demo-user');
      }, [s.user, theme]);
      for (const z of sizes) {
        if (s.open === 'more' && z.w >= 1024) continue; // the More sheet only exists under 1024px
        await page.setViewportSize({ width: z.w, height: z.h });
        // each scan screenshot starts from the same state (undo the previous size's QR scan)
        if (s.path.startsWith('/clock')) await page.evaluate(() => {
          const l = JSON.parse(localStorage.getItem('shiftclock-demo-entries') || '[]').filter((e) => e.method !== 'qr');
          localStorage.setItem('shiftclock-demo-entries', JSON.stringify(l));
        });
        await page.goto(base + s.path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(350);
        if (s.open === 'add-person') { await page.getByRole('button', { name: 'Add person' }).first().click(); await page.waitForTimeout(450); }
        if (s.open === 'entry') { await page.getByRole('button', { name: /^Edit / }).first().click(); await page.waitForTimeout(450); }
        if (s.open === 'more') { await page.getByRole('button', { name: 'More' }).click(); await page.waitForTimeout(450); }
        if (s.open === 'timeline') { await page.getByRole('button', { name: 'Timeline' }).click(); await page.waitForTimeout(300); }
        if (s.open === 'team') { await page.getByRole('button', { name: 'Team today' }).click(); await page.waitForTimeout(350); }
        if (s.open === 'week') { await page.getByRole('button', { name: 'Week', exact: true }).click(); await page.waitForTimeout(450); }
        if (s.open === 'edit') { await page.locator('.wk-pill, .wg-block').first().click(); await page.waitForTimeout(450); }
        if (s.open === 'fix') { await page.getByRole('button', { name: /Add a missing shift/ }).first().click(); await page.waitForTimeout(450); }
        if (s.open === 'drawer') { await page.locator('.ap-open').first().click(); await page.waitForTimeout(450); }
        if (s.open === 'bell') { await page.getByRole('button', { name: 'Notifications' }).first().click(); await page.waitForTimeout(450); }
        if (s.open === 'finish') { await page.getByRole('button', { name: 'Finish shift' }).first().click(); await page.waitForTimeout(450); }
        if (s.open === 'row') { await page.getByRole('button', { name: 'List' }).click(); await page.locator('.tl-li').first().click(); await page.waitForTimeout(450); }

        const r = await page.evaluate((touch) => {
          const out = { hscroll: 0, small: [], tiny: [] };
          out.hscroll = document.documentElement.scrollWidth - window.innerWidth;
          const vis = (el) => { const b = el.getBoundingClientRect(); const st = getComputedStyle(el); return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[aria-hidden="true"]'); };
          if (touch) {
            for (const el of document.querySelectorAll('button, a[href], input:not([type=checkbox]):not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
              if (!vis(el) || el.disabled) continue;
              // a switch inside a full-width label row: the row is the touch target
              const row = el.closest('label');
              if (row && row.getBoundingClientRect().height >= 43.5) continue;
              const b = el.getBoundingClientRect();
              if (b.width < 43.5 || b.height < 43.5) out.small.push(`${el.tagName.toLowerCase()}"${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
            }
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const seen = new Set();
          while (walker.nextNode()) {
            const t = walker.currentNode; const el = t.parentElement;
            if (!el || !t.textContent.trim() || seen.has(el) || el.closest('svg')) continue;
            seen.add(el);
            if (!vis(el)) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 12) out.tiny.push(`"${t.textContent.trim().slice(0, 20)}" ${fs}px`);
          }
          return out;
        }, z.w < 1024);
        const tag = `${s.name}@${z.id}/${theme}`;
        if (r.hscroll > 0) issues.push(`${tag}: horizontal scroll ${r.hscroll}px`);
        if (r.small.length) issues.push(`${tag}: small targets ${[...new Set(r.small)].join(', ')}`);
        if (r.tiny.length) issues.push(`${tag}: text <12px ${[...new Set(r.tiny)].join(', ')}`);
        await page.screenshot({ path: `screenshots/${s.name}-${z.id}-${theme}.png`, fullPage: z.w < 1024 && z.h > z.w && !s.open });
      }
    }
  }
  const uniqErr = [...new Set(consoleErrors)];
  return [`issues: ${issues.length}`, ...issues, `console: ${uniqErr.length ? uniqErr.join(' | ') : 'no errors or warnings'}`].join('\n');
}
