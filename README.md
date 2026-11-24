# ShiftClock

Employee time & pay tracker. Spec: [PLAN.md](PLAN.md). **Done:** Phase 1 (base app, roles, username login, Amplo theme mobile first, profiles + settings, PWA), Phase 2 (clock in/out with a live timer, server-side clock rules, History) Phase 3 (weekly schedules: build, submit, lock; manager Day and Week views; live Today board with Realtime), Phase 4 (QR clock-in: locations, rotating kiosk code, `/clock` scan page, `clock` Edge Function, optional GPS, "QR only" mode) Phase 5 (corrections, missing shifts and leave; Approvals with drawer and Undo; audit log; live notifications), Phase 6 (messages: automatic Team chat, direct messages, live unread badges) Phase 7 (pay with weekly overtime and deductions, Pay page with Copy, Payroll, People, Person month calendar, Timesheets, Excel export), Phase 8 (emails + cron: auto clock-out, daily / weekly reports with Excel, schedule reminders, instant emails), Phase 9 (live dashboard charts, Reports with saved views, Settings, motion, end-to-end tests) and Phase 10 (Vercel deploy, [HANDOVER.md](HANDOVER.md)).

## Run it

```powershell
npm install
copy .env.example .env      # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:5173
```

**Without a Supabase project** (dev only): put `VITE_DEMO_AUTH=1` in `.env.local`, then sign in as `owner`, `manager`, `ali`, `lina` or `yusuf` with any password. Demo mode is ignored in production builds.

## Supabase setup

**Already done for this repo:** project `shiftclock` (ref `tpuomdxjvokwdksxzjse`, Frankfurt `eu-central-1`, free plan), migrations 001–013 applied, Edge Functions `clock`, `staff`, `export-xlsx` and `cron` deployed, pg_cron jobs scheduled, security advisor clean apart from the expected notes below, 5 users seeded (logins in `scripts/seed-credentials.local.md`, gitignored), `.env` filled, demo mode off in `.env.local`. Currency PLN, timezone Europe/Warsaw.

Still to do by hand in the Supabase dashboard: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**. (Migration 003 already makes self-made accounts see nothing, but there's no reason to let them exist.)

To set up a fresh project instead:

1. Create a project. In **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up" (the owner adds people; logins are `username@shiftclock.local`). Email confirmation is not needed.
2. Apply the migrations in `supabase/migrations/` in order: `supabase db push`, or paste each file into the SQL editor.
3. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, then `npm run seed`. It creates 1 owner, 1 manager and 3 employees with random passwords, written to `scripts/seed-credentials.local.md` (gitignored). `npm run seed -- --reset` gives them new passwords.

## Checks

```powershell
npm run build
npm run lint
npm run typecheck
npm run test:e2e
```

`test:e2e` starts its own demo-mode server on port 5175 and runs 11 Playwright tests (desktop + phone): sign in, start/finish a shift, role guards, dashboard, People, Timesheets, Messages, Settings, Reports, phone tab bar and sheets.

Screenshots + mobile checks use a second dev server in demo mode (sample shifts are loaded by the script), so your real `.env.local` can stay on the database:

```powershell
$env:VITE_DEMO_AUTH='1'; npx vite --port 5174
```


```powershell
npx playwright-cli open about:blank
```
```powershell
npx playwright-cli run-code --filename=scripts/visual/shoot.cjs
```

It saves `screenshots/<page>-<width>-<theme>.png` at 360, 390, 430, 768, 1440 and 844x390 (phone landscape), light and dark, and reports horizontal scroll, tap targets under 44px, text under 12px and console errors. PWA icons are rendered from `public/icons/*.svg` by `scripts/visual/icons.cjs`.

## Emails and cron (migration 013, Edge Function `cron`)

- `pg_cron` runs `private.auto_clock_out()` every 10 minutes (closes shifts open longer than Settings → auto clock-out hours, tells the person) and calls the `cron` Edge Function every 5 minutes with a secret kept in Supabase Vault.
- Each tick sends instant emails for new notifications, and once a day / week (claimed in `email_log`, so never twice): staff daily summary, owner daily and weekly reports with the Excel file attached, schedule reminder and "schedule missing".
- Needs the `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` Edge Function secrets (see HANDOVER.md). Without them emails are logged as skipped; in-app notifications still work.

## Pay, people and Excel (migrations 011–012, Edge Functions `staff`, `export-xlsx`)

- Pay is worked out in the database: `pay_days(from, to)` and `pay_report(from, to)` (SECURITY INVOKER, so RLS limits an employee to their own row). Every screen, the Copy text and the Excel file use the same numbers.
- Overtime is weekly (Mon–Sun, company timezone): minutes over each person's "overtime after" hours are paid at their multiplier.
- Deductions (owner only): fixed once / every week / every month, or a percent of gross; one person or everyone; never more than gross.
- `/pay` (employees, managers): period picker, regular / overtime / deductions / net, days list, **Copy** button.
- `/admin/payroll`: everyone's totals, CSV and **Download Excel**. `/admin/people` and `/admin/people/:id`: staff list, month calendar of hours, rate and overtime, deductions, new password, Excel for one person. `/admin/timesheets`: every entry, managers add / edit / remove (marked as edited).
- `staff` (owner only): adds a person (login `username@shiftclock.local`, role set server-side) or sets a new password. Written to the audit log.
- `export-xlsx` (managers / owner): `ShiftClock_<Company>_<from>_<to>.xlsx` with Summary, Daily detail, Deductions, Leave and Corrections; bold frozen headers, filters, real dates and times, `[h]:mm` hours, zł amounts and SUM totals. It reads as the caller, so RLS decides what is in it.

## Messages (migration 010)

- One **Team** chat everyone joins automatically (and leaves when switched off), plus direct chats started with `start_direct_chat` (the one SECURITY DEFINER RPC, flagged by the advisor on purpose).
- RLS: you only read and post in chats you belong to, only as yourself. New messages ping members over Realtime; unread counts show on the nav.

## Mobile rules (PLAN.md 10c)

- Under 1024px: bottom tab bar (Home · Today · Schedule · Pay/Approvals · More), menus open as bottom sheets.
- From 1024px: Amplo top pill nav, ⌘K, dropdowns.
- 16px body text on phones, nothing under 12px, ≥44px tap targets, safe-area padding, `100dvh`.

## Layout

- `src/design-system/tokens/tokens.css`: Amplo colour, radius and shadow tokens, light + dark
- `src/design-system/styles/amplo.css`: component styles (top pill nav, cards, chips, tables, tiles)
- `src/components/app/`: shell, ⌘K palette, bell, `W*` primitives (from Webloop, restyled)
- `src/services/api.ts`: the only place that talks to Supabase
- `src/routes.ts`: every route from PLAN.md section 10 (plus `/today`)
- `src/components/navigation/MobileTabBar.tsx`, `src/components/shared/sheet/BottomSheet.tsx`: phone navigation
- `src/components/dashboard/TodaySchedule.tsx`: Today schedule table (PLAN.md 10b)
- `src/contexts/ClockContext.tsx`: your open shift + this week, Start / Finish
- `src/services/schedules.ts`: weeks, shifts, Today board, Realtime subscription
- `src/pages/SchedulePage.tsx`, `src/pages/AdminSchedulePage.tsx`: week planner, manager Day / Week views
- `src/utils/tz.ts`: days and weeks in the company timezone (DST-safe)
- `src/services/messages.ts`, `src/services/userChannel.ts`, `src/pages/MessagesPage.tsx`: chats + live pings
- `src/services/pay.ts`, `src/services/timesheets.ts`, `src/utils/summary.ts`, `src/components/pay/PeriodPicker.tsx`: pay, staff, Excel, Copy text
- `src/pages/PayPage.tsx`, `PayrollPage.tsx`, `PeoplePage.tsx`, `PersonPage.tsx`, `TimesheetsPage.tsx`
- `src/pages/ReportsPage.tsx`, `SettingsPage.tsx`, `src/services/admin.ts`: reports, saved views, settings, email log
- `src/components/dashboard/Insights.tsx`: live labour-cost card, donut and hours chart
- `src/design-system/styles/motion.css`: page, card, list, sheet and drawer animations (off with reduced motion)

## Requests, audit, notifications (migrations 008–009, enforced in the database)

- Employees ask (fix a clock time, add a shift they forgot to clock, leave); managers decide. A manager can't decide their own request; the owner can.
- Approving a correction changes the time entry at once; Undo (back to pending) restores the exact old times, or removes a shift the request had added.
- Approved leave shows as **On leave** on the Today board and hides that day's shift.
- `audit_log`: every decision, manager edit of time or schedules, and pay / role change. Managers can read it; nobody can write to it directly.
- `notifications`: created only by the database; each one pings the person's private Realtime channel `user:<id>`, so the bell updates live.

## QR clock-in (migrations 006–007, Edge Function `clock`)

- A location's secret is never readable by the app; the function makes a new code every 30 s (valid 60 s) and checks scans, GPS (if the location has a circle) and who is signed in.
- Only the function can write QR entries. A camera opening the link twice counts as one scan.
- Set `VITE_APP_URL` to an address phones can reach, so the codes don't point at `localhost`.

## Schedule rules (migration 005, enforced in the database)

- One week per person per Monday. Employees build and submit their own week; only managers can lock it.
- Once locked, only managers can change it; a manager's change to someone's shift is stamped `edited_by`.
- Shifts must fall inside their week, end after they start, and can't overlap on the same day.
- `v_today_board`: one row per active person for today (company timezone) with status Working / Upcoming / Late (10 min grace) / Finished / Absent / Off. Everyone can read it; it has no pay columns.
- Any clock or schedule change sends a data-free ping on the private Realtime channel `board`; only active members can listen. Open boards reload on the ping.

## Clock rules (migration 004, enforced in the database)

- One open shift per person.
- Clock-in and clock-out times are stamped by the server, whatever the phone sends.
- Employees can start their own shift and finish their own open shift, nothing else. Managers can add, change or delete entries; their changes are marked **Edited**.
- Everyone sees who is working today (`team_today`), never pay.
- `reference/webloop/`: Webloop messaging, API and migrations kept for Phases 5–6 (not compiled)
