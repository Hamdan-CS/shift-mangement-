# ShiftClock: handover guide

A short guide for whoever runs ShiftClock day to day. Everything technical lives in
[README.md](README.md); the original spec is [PLAN.md](PLAN.md).

## Where it runs

| What | Where |
|---|---|
| Website | https://shiftclock-web-d448.vercel.app (Vercel project `shiftclock`, team `web`) |
| Database, logins, files | Supabase project `shiftclock` (ref `tpuomdxjvokwdksxzjse`, Frankfurt) |
| Server code | Supabase Edge Functions: `clock` (QR), `staff` (add people, passwords), `export-xlsx` (Excel), `cron` (emails) |
| Timed jobs | Supabase `pg_cron`: auto clock-out every 10 min, email check every 5 min |

## First-day checklist (owner)

1. **Change the test passwords.** Every seeded account still has an easy password. As the owner, open
   **People → a person → Set a new password** for each one, or run `npm run seed -- --reset`.
2. **Turn off public sign-up** in Supabase: Authentication → Sign In / Providers → "Allow new users to sign up" → off.
3. **Settings** (`/admin/settings`): company name, currency, timezone, working day, schedule deadline,
   auto clock-out hours, Start/Finish button on or off, email times.
4. **People**: add the real staff (owner only) and set each person's hourly rate and overtime rule.
5. **Emails per person**: everyone opens **My settings** (account menu, top right / bottom sheet) and adds
   their own email, and picks the daily and/or weekly hours summary. Logins like `ali@shiftclock.local`
   are not real mailboxes. The owner can also fill it in on the person's page.
6. **Locations & QR**: add the workplace, open the kiosk screen on a tablet by the door, or print the code.

## People, passwords and approvals

| Task | Who | Where |
|---|---|---|
| Add an employee | owner or manager | People → Add person (a manager's new person gets a rate from the owner) |
| Add a manager or **another owner** | owner | People → Add person → role Manager / Owner |
| Someone forgot their password | owner (anyone), manager (employees) | People → the person → **Reset password**, then pass on the new one shown |
| Someone forgot to clock in or out | manager / owner | People → the person → **Add worked hours** (or Timesheets → Add entry). Counts in pay at once, saved with your name as approver |
| Employee fixes their own clock times | employee asks, manager / owner approves | History → Request correction / Add a missing shift → Approvals |
| Employee changes their name | the employee | My settings → Your name (straight away) |
| Employee asks for a new pay rate | employee asks, **owner** approves | My settings → Pay rate → Ask for a new rate → Approvals (owner) |

Every hour a manager adds or approves shows "approved by <name>" on Pay, History, Timesheets, the
person's page and the copied text. Accounts made in the app are real Supabase logins
(Authentication → Users) with a profile row; nothing else to do in Supabase.

## Turn on emails (Resend)

Emails are built and scheduled already. Until an email service is added they are logged as "skipped" on the
Settings page and only in-app notifications are sent.

**Gmail (free, no domain needed — what we use):**

1. In your Google account turn on **2-Step Verification** (myaccount.google.com → Security).
2. Open myaccount.google.com/apppasswords, create one called "ShiftClock" and copy the 16 letters.
3. In Supabase → Edge Functions → **Secrets**, add:

   | Name | Value |
   |---|---|
   | `GMAIL_USER` | the Gmail address that sends, e.g. `you@gmail.com` |
   | `GMAIL_APP_PASSWORD` | the 16-letter app password (not your normal password) |
   | `APP_URL` | `https://shiftclock-web-d448.vercel.app` (optional, this is the default) |

   Emails show the café name from Settings as the sender name. Gmail allows about 500 a day.
   Sent through port 465 (Supabase blocks 25 and 587).

**Resend instead** (only if you buy a domain): verify the domain at resend.com/domains, then set
`RESEND_API_KEY` and `EMAIL_FROM` (`Cookiery PL <hours@yourdomain.com>`). Without a verified domain
Resend only delivers to your own Resend sign-up address. When the Gmail secrets are set, Gmail is used.

4. Settings → **Send me a test email**. If it arrives, the daily and weekly emails will too.

What gets sent (all in company time, times set on Settings):

| Email | To | When |
|---|---|---|
| Daily summary | each person who worked (if they turned it on) | Staff daily summary time (23:00) |
| Weekly summary: hours per day, total, gross, net | each person who worked that week (if on) | Weekly day + time (Sunday 23:30) |
| Owner daily + Excel | owner, managers, extra recipients | Owner daily time (23:15) |
| Owner weekly + Excel | owner, managers, extra recipients | Weekly day + time (Sunday 23:30) |
| Schedule reminder | people who haven't submitted next week | Deadline day, reminder time (12:00) |
| Schedule missing | managers | Deadline day, after the deadline |
| Approval needed / result / shift changed / shift auto-closed | the person concerned | Within 5 minutes |

**Email me buttons (everyone):** the Pay page has **Email me** (hours, pay and each worked day for the
period on screen) and My schedule has a mail icon (that week's shifts). They go to the email saved in
My settings, at most 3 a minute per person. If no email is saved, the app asks you to add one.

## Schedule views

Both schedule pages have **Day / Week / Month**:
- **My schedule** (staff): Day = who is in today, Week = plan and submit, Month = a calendar of the
  month with worked hours (solid), planned shifts (outlined), leave and missed days, plus days worked,
  hours, gross and net at the top. Tap a day for clock-in/out, hours, pay and who approved it.
- **Schedule** (managers): Day = timeline, Week = edit and lock, Month = the team calendar (hours and
  people per day, red "None" on days nobody is planned). Tap a day to open it in Day view.

The same month calendar is on each person's page. Each person's default view is under
**My settings → Schedule view**, and it also remembers the last view they picked.

## Copy to chat

- **Schedule → Week → Copy**: the week on screen, one line per day ("Not available" on free days).
- **Pay → Copy hours & pay**: hours per day with clock-in/out and pay, then total, overtime, gross,
  deductions and net.

Both use *bold* chat formatting, so they look right pasted into WhatsApp or Messenger.

## Own domain (optional)

Vercel → project `shiftclock` → Settings → Domains → add e.g. `shifts.yourcompany.com` and set the DNS
record it shows. Then:

- Vercel → Settings → Environment Variables → set `VITE_APP_URL` to the new address and redeploy
  (QR codes use it). Print or show new QR codes afterwards.
- Supabase Edge Function secret `APP_URL` → the new address (links in emails).

## Deploying changes

The Vercel project is connected to GitHub (`Hamdan-CS/shift-mangement-`): every push to `main`
deploys the site automatically, and every other branch gets its own preview link.

```powershell
git add -A
git commit -m "Describe the change"
git push
```

A manual deploy still works if you ever need one: `npx vercel deploy --prod`.

Database changes go in `supabase/migrations/` (one new file per change) and are applied in order.
Edge Functions are in `supabase/functions/`; `_shared/workbook.ts` is used by both `export-xlsx` and `cron`.

## Checks before a release

```powershell
npm run typecheck
npm run lint
npm run test:e2e
```

`test:e2e` runs 11 browser tests (desktop + phone) against a demo-mode copy of the app, so it never
touches real data. The screenshot checker is described in README.md.

## Costs

Vercel Hobby, Supabase Free and Resend Free cost nothing for a small team. Supabase Free pauses a
project after a week without use, so for a business that relies on it, plan on Supabase Pro ($25/month)
for backups and no pausing, and Vercel Pro ($20/month) for commercial use. Check current prices.

## Security notes

- Every table has row-level security: staff only see their own hours and pay; managers see everyone;
  only the owner changes rates, deductions, people and settings.
- The service-role key is only inside Supabase (Edge Functions). Never put it in Vercel or the website.
- Supabase's security advisor lists three expected notes: `qr_scans` has no policies on purpose (server
  only), `start_direct_chat` is a deliberate function for starting chats, and leaked-password protection
  is a paid-plan switch.
