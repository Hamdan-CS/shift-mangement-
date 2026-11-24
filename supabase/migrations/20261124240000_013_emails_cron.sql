-- ShiftClock · Phase 8: emails + cron (PLAN.md sections 9, 12).
--
--   * settings: email switches and times (all company time)
--   * notifications.emailed_at: instant emails are sent once
--   * email_log: what was sent / skipped (owner can read it on Settings)
--   * report_views: saved views on Reports (Phase 9), private to each person
--   * private.auto_clock_out(): closes shifts left open > auto_clockout_hours
--   * pg_cron: auto clock-out every 10 min, email tick every 5 min
--     (the tick calls the `cron` Edge Function with a secret kept in Vault)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------- settings ----------
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS emails_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS owner_daily_time time NOT NULL DEFAULT '23:15';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_email_dow smallint NOT NULL DEFAULT 0 CHECK (weekly_email_dow BETWEEN 0 AND 6); -- 0 = Sunday
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_email_time time NOT NULL DEFAULT '23:30';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS reminder_time time NOT NULL DEFAULT '12:00';

-- ---------- notifications: new type + emailed flag ----------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'correction.requested', 'leave.requested', 'request.approved', 'request.declined',
  'schedule.missing', 'schedule.changed', 'shift.auto_closed'));
-- existing rows are not emailed after the fact
UPDATE public.notifications SET emailed_at = created_at WHERE emailed_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_to_email ON public.notifications (created_at) WHERE emailed_at IS NULL;

-- ---------- email log ----------
CREATE TABLE IF NOT EXISTS public.email_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job        text NOT NULL,          -- daily | owner_daily | owner_weekly | reminder | missing | instant
  ref        text NOT NULL,          -- the day / week it is for, or a notification id
  recipient  text NOT NULL,          -- an email address, or '*' for the job claim
  status     text NOT NULL,          -- sent | skipped | failed | claimed
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_log_once UNIQUE (job, ref, recipient)
);
CREATE INDEX IF NOT EXISTS email_log_recent ON public.email_log (created_at DESC);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_log FROM anon, authenticated;
GRANT SELECT ON public.email_log TO authenticated;
DROP POLICY IF EXISTS email_log_owner ON public.email_log;
CREATE POLICY email_log_owner ON public.email_log FOR SELECT TO authenticated USING ((SELECT private.is_owner()));

-- ---------- saved report views ----------
CREATE TABLE IF NOT EXISTS public.report_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  config     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_views_owner ON public.report_views (owner_id, created_at);
ALTER TABLE public.report_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_views FROM anon;
GRANT SELECT, INSERT, DELETE ON public.report_views TO authenticated;
DROP POLICY IF EXISTS report_views_own ON public.report_views;
CREATE POLICY report_views_own ON public.report_views FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND (SELECT private.is_manager()))
  WITH CHECK (owner_id = (SELECT auth.uid()) AND (SELECT private.is_manager()));

-- ---------- auto clock-out ----------
-- A shift still open after settings.auto_clockout_hours is closed at that
-- length, marked edited with a note, and the person is told in the app.
CREATE OR REPLACE FUNCTION private.auto_clock_out()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hours int := coalesce((SELECT s.auto_clockout_hours FROM public.settings s WHERE s.id = 1), 14);
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT te.id, te.user_id, te.clock_in FROM public.time_entries te
    WHERE te.clock_out IS NULL AND te.clock_in < now() - make_interval(hours => v_hours)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.time_entries
       SET clock_out = r.clock_in + make_interval(hours => v_hours),
           edited = true,
           note = left(coalesce(note || ' · ', '') || 'Closed automatically after ' || v_hours || 'h', 500)
     WHERE id = r.id;
    PERFORM private.notify(r.user_id, 'shift.auto_closed', jsonb_build_object('hours', v_hours, 'clock_in', r.clock_in));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION private.auto_clock_out() FROM public, anon, authenticated;

-- ---------- cron secret (Vault) + check for the Edge Function ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'shiftclock_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'shiftclock_cron_secret', 'Shared secret: pg_cron -> cron Edge Function');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_cron_secret(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p_secret = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'shiftclock_cron_secret'), false);
$$;
REVOKE ALL ON FUNCTION public.check_cron_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_cron_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION private.email_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://tpuomdxjvokwdksxzjse.supabase.co/functions/v1/cron',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'shiftclock_cron_secret')),
    body := '{"job":"tick"}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;
REVOKE ALL ON FUNCTION private.email_tick() FROM public, anon, authenticated;

-- ---------- schedules ----------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('shiftclock-auto-clockout', 'shiftclock-email-tick');
END $$;
SELECT cron.schedule('shiftclock-auto-clockout', '*/10 * * * *', 'SELECT private.auto_clock_out()');
SELECT cron.schedule('shiftclock-email-tick', '*/5 * * * *', 'SELECT private.email_tick()');
