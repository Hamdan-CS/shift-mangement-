# ShiftClock — Employee Time & Pay Tracker

Plan and build spec for Claude Code. Put this file in the project root, copy the Webloop pieces listed in section 3, then tell Claude Code: "Read PLAN.md and build Phase 1."

---

## 1. What it does

**Employee**
- Logs in with username + password
- Clocks in and out with a button, or by scanning a QR code at the workplace with their phone
- **Makes their own weekly schedule** (which days, start and end times) and submits it
- Sees **today's schedule for the whole team**: who is working, who is off, who is on shift right now
- Sees today's hours, the week's hours, earnings, and deductions
- Requests a correction for a wrong clock time (needs approval)
- Requests leave (needs approval)
- Messages the manager or team (reused from Webloop)
- **Copies** their hours and pay with one tap (for their own notes), per day, week, or pay period
- Gets an email at the end of each day with the hours they worked

**Manager** (the "authorized person", set by the owner)
- Sees the **daily schedule**, built automatically from everyone's weekly schedules
- Can edit or lock schedules, and gets told when someone hasn't submitted next week
- Approves or declines corrections and leave requests
- Sees the team's live status and hours

**Owner**
- Everything the manager can do, plus:
- Adds and removes employees, sets their hourly rate, deductions, and role
- Sees all hours, earnings, and deductions for any period
- Gets a daily email (who worked how long) and a weekly email (totals and pay), **each with an Excel file attached**
- **Downloads an Excel file** for any date range (managers can too)

---

## 2. Tech stack (matches Webloop so code can be reused)

| Part | Choice | Why |
|---|---|---|
| App | Vite + React 18 + TypeScript + React Router 7 | Same as Webloop |
| UI | Tailwind 3 + Webloop's design tokens and `W*` components, restyled to Amplo | Already built |
| Toasts | `sonner` | Already in Webloop |
| Icons | `lucide-react` | Already in Webloop |
| Database + login | Supabase (Postgres, Auth, RLS, Realtime) | Same as Webloop |
| Server logic | Supabase Edge Functions | Vite has no server: QR check, emails, payroll export |
| Scheduled jobs | Supabase `pg_cron` calling Edge Functions | Daily/weekly emails, auto clock-out, schedule reminders |
| Email | Resend + React Email (inside Edge Functions) | Webloop has no email sending yet |
| Charts | Recharts | Hours chart, donut, report bars |
| Excel | ExcelJS (in an Edge Function) | Same .xlsx for downloads and email attachments |
| QR | `qrcode` (generate), phone camera (scan) | No app install needed |
| Hosting | Vercel (reuse Webloop's `vercel.json` SPA rewrite) | Same as Webloop |
| Phone | PWA (`vite-plugin-pwa`) | Installable from the browser |
| Tests | Playwright (reuse Webloop's setup) | Already configured |

Usernames: Supabase Auth needs an email, so store `username` in `profiles` and map it to an internal email (`username@shiftclock.local`) at login. Real email is kept separately for notifications.

---

## 3. Reuse from Webloop (github.com/Hamdan-CS/Webloop)

Start a **new repo** and copy these over. Don't fork the whole project: the marketing pages, 3D scenes, feed, and contribution grid aren't needed.

| Copy | From Webloop | Change needed |
|---|---|---|
| Supabase client | `src/integrations/supabase/client.ts` | New project URL/key |
| Auth | `src/contexts/AuthContext.tsx`, `components/auth/RoleRoute.tsx`, `GuestOnlyRoute.tsx`, `pages/ResetPasswordPage.tsx`, `utils/authRedirect.ts` | Roles become `owner / manager / employee`; add username login |
| Roles | `src/utils/roles.ts` | Replace creator types with the three roles; dashboard paths `/` and `/admin` |
| Messaging (1-to-1 + group) | `src/components/messaging/*`, `hooks/useMessages.ts` + migrations `004`, `014`, `018`, `028` | Drop project/task links (`AddTaskFromChatModal`); auto-create a "Team" group chat |
| Notifications bell | `components/app/NotificationsMenu.tsx`, `components/notifications/notificationMeta.tsx`, `utils/notify.ts` + `notifications` table from `021` | New types: `correction.requested`, `leave.requested`, `request.approved`, `request.declined`, `schedule.missing`, `schedule.changed` |
| App shell + nav | `components/app/AppShell.tsx`, `CommandPalette.tsx`, `ui/index.tsx` (`WButton`, `WBox`, `WKpis`, `WPageHeader`, `WAvatar`, `WInput`, `WSelect`) | Restyle to Amplo: top pill nav, blue accent |
| Shared UI | `components/shared/ui/` (`Avatar`, `AvatarStack`, `Badge`, `Button`, `Tabs`, `Select`, `Switch`, `KpiTile`, `LoopLoader`) | Keep |
| Theme | `design-system/` tokens + `components/theme/ThemeToggle.tsx` | New colour tokens (section 9) |
| Admin pattern | `pages/AdminModerationPage.tsx`, `components/companies/ApplicantsInbox.tsx` | Template for the approvals queue |
| Data layer pattern | `services/api.ts` style (pages never call Supabase directly) | Same rule |
| RLS helpers | `current_profile_id()`, `is_admin()` from `021` | Add `is_manager()` |
| Config | `vercel.json`, `tailwind.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig*` | Keep |

Tell Claude Code: "Copy these files from ../webloop, remove everything related to projects, tasks, feed, teams, companies, and universities, and make it compile."

---

## 4. Roles and access

| Role | Own data | Team data | Approve | Schedules | Rates/payroll | Manage staff |
|---|---|---|---|---|---|---|
| employee | read | today's schedule + who's on shift (no pay) | – | **create/edit own** | read own | – |
| manager | read | read | yes | edit anyone's, lock week | read | – |
| owner | read | read | yes | edit anyone's, lock week | edit | yes |

Enforce with Supabase Row Level Security, not just in the UI. Employees can see each other's names, shifts, and status, never pay.

---

## 5. Database tables

```sql
profiles
  id uuid pk (= auth.users.id)
  username text unique
  full_name text
  avatar_url text
  notify_email text
  role text check (role in ('owner','manager','employee'))
  job_title text                                -- "Cashier", "Kitchen"
  hourly_rate numeric(10,2)
  overtime_after_hours numeric default 40
  overtime_multiplier numeric default 1.5
  active boolean default true
  created_at timestamptz

time_entries
  id uuid pk
  user_id uuid fk profiles
  clock_in timestamptz
  clock_out timestamptz null                    -- null = still working
  method text check (method in ('button','qr','manual','auto'))
  location_id uuid null
  break_minutes int default 0
  note text
  edited boolean default false

schedule_weeks                                  -- one row per employee per week
  id uuid pk
  user_id uuid fk profiles
  week_start date                               -- Monday
  status text check (status in ('draft','submitted','locked'))
  submitted_at timestamptz null
  locked_by uuid null
  unique (user_id, week_start)

schedule_shifts                                 -- the actual days/times
  id uuid pk
  week_id uuid fk schedule_weeks on delete cascade
  user_id uuid fk profiles
  date date
  start_time time
  end_time time
  note text                                     -- "Front desk"
  edited_by uuid null                           -- set when a manager changes it

corrections
  id uuid pk
  entry_id uuid fk time_entries null
  user_id uuid fk profiles
  new_clock_in timestamptz
  new_clock_out timestamptz
  reason text
  status text check (status in ('pending','approved','declined'))
  reviewed_by uuid null
  reviewed_at timestamptz null
  review_note text

leave_requests
  id uuid pk
  user_id uuid fk profiles
  type text check (type in ('annual','sick','unpaid','other'))
  start_date date
  end_date date
  reason text
  status text check (status in ('pending','approved','declined'))
  reviewed_by uuid null
  reviewed_at timestamptz null

deductions
  id uuid pk
  user_id uuid fk profiles null                 -- null = everyone
  name text
  type text check (type in ('fixed','percent'))
  amount numeric(10,2)
  recurring text check (recurring in ('once','weekly','monthly'))
  start_date date
  end_date date null

locations
  id uuid pk
  name text
  qr_secret text
  lat numeric null, lng numeric null, radius_m int null

settings                                        -- single row
  company_name text, currency text, timezone text default 'Asia/Dubai',
  schedule_deadline_dow int default 4,          -- Thursday
  schedule_deadline_time time default '18:00',
  daily_email_time time default '23:00',
  auto_clockout_hours int default 14,
  report_recipients text[]                      -- who gets daily/weekly Excel emails

audit_log
  id uuid pk, actor_id uuid, action text, target_id uuid,
  before jsonb, after jsonb, created_at timestamptz

-- reused from Webloop: conversations, conversation_members, messages, notifications
```

**Key view: `v_today_board`**, one row per active employee for today (company timezone):

| Column | From |
|---|---|
| user, avatar, job_title | profiles |
| scheduled_start, scheduled_end | schedule_shifts for today (null = off) |
| clock_in, clock_out | today's time_entries |
| status | computed (below) |

Status rules:
- `on_leave`: approved leave covers today
- `off`: no shift today
- `working`: open time entry
- `finished`: clocked in and out today
- `late`: shift started 10+ min ago, not clocked in
- `upcoming`: shift later today, not clocked in yet
- `absent`: shift ended, never clocked in

Because the view reads straight from `schedule_shifts` and `time_entries`, the daily schedule **updates itself**: no one builds it by hand. Turn on Supabase Realtime for `time_entries` and `schedule_shifts` so the board refreshes live.

Other rules:
- Only one open time entry per user (partial unique index).
- Employees can never update `time_entries` directly. Changes go through `corrections`.
- Employees can edit their own `schedule_shifts` only while the week is `draft` or `submitted`, not `locked`.
- Every approval, rate change, schedule edit by a manager, and manual time edit writes to `audit_log`.

---

## 6. Schedule flow

1. **Employee builds next week** on `/schedule`: a 7-day grid, tap a day → pick start/end, "Copy last week" button, "Same every day" shortcut.
2. Taps **Submit**. Week status becomes `submitted`. Manager gets a notification.
3. **Deadline** (default Thursday 18:00): cron reminds anyone still on `draft` or missing, and tells the manager who hasn't submitted.
4. **Manager** sees the week for everyone on `/admin/schedule`: can edit any shift (employee is notified), see gaps (days with too few people), and **Lock** the week.
5. **Every day**, the dashboard's "Today" board and the manager's daily view are filled from that day's shifts plus live clock data. Nothing to publish.
6. Approved leave automatically marks those days as `on_leave` and hides the shifts.
7. Schedule vs reality feeds the owner email: late arrivals, no-shows, unscheduled shifts.

Optional (setting): employees can see others' weekly schedules, or only today's.

---

## 7. Clock in/out

**Button**: big "Start shift" → live timer + "Finish shift".

**QR scan**
1. Rotating QR on a tablet at the door (`/kiosk/:locationId`, full screen), or a printed static QR.
2. QR URL: `https://app.com/clock?loc=<id>&t=<token>`.
3. Employee scans with the phone camera → app opens → toggles clock in/out.
4. Edge Function `clock` checks the token:
   - Static: `HMAC(loc_id, secret)`. A photo of it works from home.
   - Rotating (recommended): `HMAC(loc_id + 30-second window, secret)`, valid 60 s.
   - Optional GPS radius check.

**Forgot to clock out**: cron every 30 min closes entries open longer than `auto_clockout_hours` at the scheduled end time (or +8 h), marks them `auto`, and notifies the employee and manager.

---

## 8. Pay calculation

```
worked_hours   = sum(clock_out - clock_in) - breaks
regular_hours  = min(worked_hours_week, overtime_after_hours)
overtime_hours = max(0, worked_hours_week - overtime_after_hours)
gross          = regular_hours * rate + overtime_hours * rate * overtime_multiplier
deductions     = fixed amounts + (percent * gross)
net            = gross - deductions
```

Money as `numeric`, never floats. Hours shown as `7h 32m`. Optional `rate_history` table if rates change mid-period.

---

## 8b. Copy and Excel export

**Employee: Copy button**
On `/history`, `/pay`, and the dashboard hours card. Choose Today / This week / This pay period / Custom. Copies plain text to the clipboard (`navigator.clipboard.writeText`), then a toast "Copied". Example:

```
Ali Hassan — Week 24–30 Nov 2026
Mon 24 Nov  09:02 – 17:31  8h 29m  AED 254.50
Tue 25 Nov  08:58 – 17:05  8h 07m  AED 243.50
Wed 26 Nov  Off
...
Total: 40h 12m (overtime 0h 12m)
Gross: AED 1,212.00
Deductions: Uniform –50.00
Net: AED 1,162.00
```

Same text is shared by the Copy button and the employee daily email, built by one function: `formatHoursSummary(entries, range)`.

**Manager/owner: Download Excel (.xlsx)**
On `/admin/timesheets`, `/admin/payroll`, `/admin/people/:id`, and `/admin/reports`. Pick a date range and employees (all or some) → Download. Generated by an Edge Function `export-xlsx` using **ExcelJS**, so the browser and the emails produce the same file.

Workbook layout:

| Sheet | Columns |
|---|---|
| **Summary** | Employee, job title, days worked, total hours, regular hours, overtime hours, rate, gross, deductions, net, late count, absent count, leave days |
| **Daily detail** | Date, day, employee, scheduled start, scheduled end, clock in, clock out, method (button/QR/auto), break, hours, overtime, earned, status (on time/late/absent/leave), corrected (yes/no), note |
| **Deductions** | Date, employee, name, type, amount |
| **Leave** | Employee, type, from, to, days, status, approved by |
| **Corrections** | Date, employee, old in/out, new in/out, reason, status, approved by |

Formatting: bold frozen header row, autofilter, column widths set, real Excel dates and times (not text), hours as decimals with `[h]:mm` display, money in the company currency format, a totals row at the bottom of Summary and Daily detail. File name: `ShiftClock_<Company>_<from>_<to>.xlsx`.

---

## 9. Emails (Edge Functions + pg_cron + Resend)

| Email | To | When | Content |
|---|---|---|---|
| Daily summary | each employee who worked | 23:00 | In/out times, hours, earned today, link to request a correction |
| Owner daily | owner + managers | 23:15 | Per employee: scheduled vs actual, hours, earned. Late, absent, pending approvals. **Excel attached** (that day, full detail) |
| Owner weekly | owner + managers | Sunday 23:30 | Hours, overtime, gross, deductions, net per employee + totals. **Excel attached** (the full week, all sheets) |
| Schedule reminder | employees not submitted | deadline day, 12:00 | "Submit next week's schedule" |
| Schedule missing | manager | after deadline | List of who hasn't submitted |
| Approval needed | managers + owner | instantly | Correction / leave request with link |
| Request result | employee | instantly | Approved / declined + note |
| Shift changed | employee | instantly | Manager edited your shift |

Excel attachments come from the same `export-xlsx` function, sent as a Resend attachment (base64). Who receives the daily/weekly emails is a list in `settings` (`report_recipients`), so the owner can add an accountant. All times use the company timezone from `settings`. In-app notifications use Webloop's bell for the same events.

---

## 10. Screens

**Everyone: Dashboard `/`**
- Greeting + status line ("5 working now · 2 off today · 1 late")
- **Today schedule table** (main card): see section 10b. Status chips: Working · Upcoming · Late · Finished · Off · On leave · Absent.
- Employee also sees: own shift timer + Start/Finish, own hours this week, earnings
- Manager/owner also sees: labour cost today, hours chart, pending approvals

**Employee (mobile first)**
- `/schedule`: My week (build + submit) and Team today
- `/history`: past days → "Request correction"
- `/pay`: hours, gross, deductions, net
- `/leave`: request + status
- `/messages`: reused from Webloop

**Owner / Manager (desktop first)**
- `/admin/schedule`: **Day view** (default, auto-filled: who works when, gaps, live status) and **Week view** (everyone's submitted weeks, edit, lock, "not submitted" list)
- `/admin/timesheets`: all entries, filter, manual edit (logged)
- `/admin/approvals`: corrections + leave board, side drawer to approve/decline, Undo toast
- `/admin/people` and `/admin/people/:id`: staff, rates, deductions, month calendar of hours
- `/admin/payroll`: period totals, CSV export
- `/admin/reports`: saved views, hours/cost charts
- `/admin/settings`: company, currency, timezone, overtime, schedule deadline, locations + QR codes, email times

---

## 10b. Today schedule table (refs 11–13, Mendo)

A timeline table, like Mendo's "Ward round":
- **Rows** = every active employee (avatar, name, job title, status chip)
- **Columns** = hours of the working day (e.g. 06:00–24:00, from settings)
- **Shift bar** per row from scheduled start to end; the filled part shows actual clocked time (blue = worked, light = still scheduled, red outline = late, grey striped = on leave, empty row = off)
- **Red "now" line** with a time label, moving live
- Tap a bar → small popover: scheduled time, clocked in/out, status, "Message"
- Header line: "6 working · 2 upcoming · 1 late · 3 off"
- Filters: All / Working now / Off / Late
- Sorted: working → late → upcoming → finished → off/leave
- Live updates via Supabase Realtime

Manager also gets the **Day view** (ref 13): one column per location/role, shifts as blocks, red now line, break band.
Employee's own week builder follows **Vernly's planner** (ref 14): day columns with hours total + progress bar, drag blocks to move.
Employee home shows **"Next shift — starts in 2h 10m"** like Vernly's "Up next" card (ref 15).

**On mobile** the table keeps the same idea:
- Sticky name column (avatar + first name, ~96px), timeline scrolls sideways
- On open, auto-scrolls so "now" is in view
- Toggle **Timeline / List**. List view = one card per person: name, shift `09:00–17:00`, status chip, worked so far. List is the default under 640px.

---

## 10c. Mobile first (employees only use phones)

Design and build for 390×844 first, then scale up to tablet and desktop.

- **Navigation**: bottom tab bar on mobile (Home · Today · Schedule · Pay · More), top pill nav only from 1024px. Reuse Webloop's `MobileTabBar`.
- **Clock button**: big, thumb-reachable, bottom half of the screen, min 56px tall, full width. Haptic (`navigator.vibrate`) + toast on success.
- **Touch targets** ≥ 44×44px, 8px gaps between tappable things.
- **Text**: body 16px (stops iOS zooming into inputs), no text under 12px.
- **Safe areas**: `env(safe-area-inset-*)` padding for the notch and home bar; use `100dvh` not `100vh`.
- **No horizontal page scroll** at 360px wide. Only the timeline table scrolls sideways, inside its card.
- **Forms**: native `type="time"`, `type="date"`, `inputmode="numeric"`, labels above fields, one column, sticky bottom Submit button.
- **Sheets, not modals**: drawers, popovers and confirmations open as bottom sheets on mobile.
- **Tables become cards** under 640px (history, approvals, payroll).
- **Copy button** and important actions visible without scrolling.
- **QR**: `/clock` opens straight to a big result screen ("Clocked in 09:02 ✓"), works after login redirect.
- **PWA**: installable, app icon, splash, standalone display, theme colour; last data cached so Home opens instantly on bad signal.
- **Performance**: first load under 2.5 s on 4G; lazy-load admin pages, charts and ExcelJS; skeleton loaders.
- **Accessibility**: contrast AA, visible focus, labels on icon buttons, respects reduced motion.
- **Test sizes**: 360×740 (small Android), 390×844 (iPhone), 430×932 (large phone), 768×1024 (tablet), 1440×900 (desktop). Light + dark. Also landscape on phone.

---

## 11. Design direction (main reference: Amplo)

**Base style**
- Light grey page (`#F4F5F7`), white cards, 16–20px radius, thin borders, soft shadow
- One accent: royal blue (`#2F5BEA`)
- Top nav with pill tabs (Overview · Schedule · Timesheets · Approvals · People · Payroll · Reports · Messages), search, ⌘K (Webloop's CommandPalette), light/dark toggle, bell, blue "+ New", user chip
- Big greeting with a status line underneath, actions on the right
- Full dark mode, same layout
- Font: Geist (already in Webloop), tabular numbers for hours and money

**How Amplo screens map to this app**

| Amplo | ShiftClock |
|---|---|
| Ad wallet card | Labour cost card: this week, per day, days left in pay period |
| Vinyl donut | Hours split: regular / overtime / leave / breaks |
| Fans gained area chart + previous period dashed line | Hours worked, this period vs last |
| Campaigns on air table | **Today board**: who's working, shift, status chip |
| Countdown tiles | Live shift timer; "Payroll closes in" |
| Campaign kanban | Approvals board: Pending → Approved → Declined |
| Reports with saved views + bars + Export CSV | Reports and payroll |
| Toast with Undo | After approve / decline / schedule edit |

Also from the earlier references: Veyla's right-side drawer for request details, Grovia's week calendar with shift pills for the schedule.

Rules: no gradients except the faint chart fill, no emoji, numbers big and bold, labels small and grey.

---

## 12. Build phases (one Claude Code session each)

1. **Base from Webloop**: new Vite repo, copy the files in section 3, strip unused parts, new Supabase project, `profiles` with 3 roles, username login, role routes, Amplo theme tokens, seed owner + manager + 3 employees.
2. **Clock in/out**: `time_entries`, Start/Finish with live timer, history, one-open-entry rule, RLS.
3. **Schedules + Today board**: `schedule_weeks`, `schedule_shifts`, employee week builder + submit, `v_today_board`, dashboard Today board with Realtime, manager day/week view, lock week.
4. **QR**: `locations`, kiosk page with rotating QR, `/clock` handler, `clock` Edge Function, optional GPS.
5. **Corrections + leave + approvals**: forms, approvals board + drawer, apply on approve, leave hides shifts, audit log, Webloop notifications.
6. **Messaging**: wire in Webloop messaging, auto "Team" group chat, DM manager.
7. **Pay + deductions + export**: rates, overtime, deductions, employee pay page with Copy button, payroll page, `export-xlsx` Edge Function (ExcelJS) + Download Excel buttons.
8. **Emails + cron**: Resend templates, daily/weekly emails with the Excel attached, schedule reminders, auto clock-out, all via `pg_cron` → Edge Functions.
9. **Dashboard polish + PWA**: KPIs, charts, dark mode check, PWA install, mobile testing, empty/loading states, Playwright tests.
10. **Deploy + handover**: Vercel, domain, Resend domain verification, Edge Function secrets, short guide for the client.

---

## 13. Ask the client first

1. How many employees, and one location or several?
2. Pay period: weekly, every two weeks, or monthly?
3. Overtime rule and multiplier
4. Which deductions exist?
5. Paid or unpaid breaks?
6. Clock in only at the workplace (QR/GPS) or from anywhere?
7. Tablet at the door for a rotating QR, or a printed one?
8. Currency, timezone, email language (English / Arabic)?
9. Who besides the owner can approve?
10. Leave types and yearly allowance?
11. **Schedule deadline**: which day and time must next week be submitted?
12. **Can employees change their schedule after submitting**, or only the manager once it's locked?
13. **Minimum staff per day/shift**, so the manager sees gaps?
14. Should employees see only today's team schedule, or the whole week?

---

## 14. Costs (small team)

Vercel Hobby, Supabase Free, Resend Free: **$0** to start. For a paying client: Vercel Pro ($20) + Supabase Pro ($25) for backups and no pausing. Check current pricing before quoting. Domain ~$10–15/year.

---

## 15. Env vars

```
# Frontend (.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_URL=

# Edge Function secrets (supabase secrets set)
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
EMAIL_FROM=
QR_SIGNING_SECRET=
CRON_SECRET=
APP_URL=
```
