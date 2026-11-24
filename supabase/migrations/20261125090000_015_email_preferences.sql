-- ShiftClock · each person picks their own hours emails (My settings page).
-- notify_email already exists and people can change it for themselves
-- (profiles_guard_update only locks role, username, job title, pay, active).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_daily boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_weekly boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_notify_email_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_notify_email_format
  CHECK (notify_email IS NULL OR (length(notify_email) <= 254 AND notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
