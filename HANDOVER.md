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
4. **People**: add the real staff (owner only), set each person's hourly rate, overtime rule, and an
   **Email for reports and alerts** (logins like `ali@shiftclock.local` are not real mailboxes).
5. **Locations & QR**: add the workplace, open the kiosk screen on a tablet by the door, or print the code.

## Turn on emails (Resend)

Emails are built and scheduled already. Until a key is added they are logged as "skipped" on the
Settings page and only in-app notifications are sent.

1. Create a free account at resend.com and **verify your domain** (Resend → Domains → add the DNS records it shows).
2. Create an API key (Resend → API Keys).
3. In Supabase → Edge Functions → **Secrets**, add:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | the key from step 2 |
   | `EMAIL_FROM` | e.g. `ShiftClock <shifts@yourdomain.com>` (must be on the verified domain) |
   | `APP_URL` | `https://shiftclock-web-d448.vercel.app` (or your own domain) |

4. Settings → **Send me a test email**. If it arrives, the daily and weekly emails will too.

What gets sent (all in company time, times set on Settings):

| Email | To | When |
|---|---|---|
| Daily summary | each person who worked | Staff daily summary time (23:00) |
| Owner daily + Excel | owner, managers, extra recipients | Owner daily time (23:15) |
| Owner weekly + Excel | owner, managers, extra recipients | Weekly day + time (Sunday 23:30) |
| Schedule reminder | people who haven't submitted next week | Deadline day, reminder time (12:00) |
| Schedule missing | managers | Deadline day, after the deadline |
| Approval needed / result / shift changed / shift auto-closed | the person concerned | Within 5 minutes |

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
