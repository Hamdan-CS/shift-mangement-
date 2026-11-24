-- ShiftClock · Phase 2: clock in / out (PLAN.md sections 5 and 7).
-- Rules enforced here, not just in the UI:
--   * one open time entry per person (partial unique index)
--   * clock-in and clock-out times come from the server clock, never the phone
--   * employees can only start their own shift and finish their own open shift;
--     any other change is a manager's (and is marked `edited`); corrections
--     from employees come in Phase 5
--   * everyone can see who is working today (team_today), never pay

CREATE TABLE IF NOT EXISTS public.time_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  clock_in      timestamptz NOT NULL DEFAULT now(),
  clock_out     timestamptz,                       -- null = still working
  method        text NOT NULL DEFAULT 'button' CHECK (method IN ('button', 'qr', 'manual', 'auto')),
  location_id   uuid,                              -- FK to locations arrives with QR (Phase 4)
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 600),
  note          text CHECK (note IS NULL OR length(note) <= 500),
  edited        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_out_after_in CHECK (clock_out IS NULL OR clock_out > clock_in)
);

-- Only one open entry per person.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open ON public.time_entries (user_id) WHERE clock_out IS NULL;
CREATE INDEX IF NOT EXISTS time_entries_user_clock_in ON public.time_entries (user_id, clock_in DESC);
CREATE INDEX IF NOT EXISTS time_entries_clock_in ON public.time_entries (clock_in);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;

-- Read: your own entries (active members only), or everyone's as manager / owner.
DROP POLICY IF EXISTS time_entries_select ON public.time_entries;
CREATE POLICY time_entries_select ON public.time_entries
  FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL)
    OR (SELECT private.is_manager())
  );

-- Insert: clock yourself in, or a manager adds an entry for anyone.
DROP POLICY IF EXISTS time_entries_insert ON public.time_entries;
CREATE POLICY time_entries_insert ON public.time_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL)
    OR (SELECT private.is_manager())
  );

-- Update: only your own OPEN entry (to clock out), or anything as manager.
DROP POLICY IF EXISTS time_entries_update ON public.time_entries;
CREATE POLICY time_entries_update ON public.time_entries
  FOR UPDATE TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND clock_out IS NULL AND (SELECT private.current_profile_id()) IS NOT NULL)
    OR (SELECT private.is_manager())
  )
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT private.is_manager()));

-- Delete: managers / owner only.
DROP POLICY IF EXISTS time_entries_delete ON public.time_entries;
CREATE POLICY time_entries_delete ON public.time_entries
  FOR DELETE TO authenticated
  USING ((SELECT private.is_manager()));

-- Server-side clock: overrides whatever the phone sent.
CREATE OR REPLACE FUNCTION private.time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_clock_out boolean;
BEGIN
  -- Service role (QR edge function, cron auto clock-out, seed): trusted as sent.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id = v_uid AND NEW.method = 'button' THEN
      -- Start shift: server time, nothing else from the client.
      NEW.clock_in := now();
      NEW.clock_out := NULL;
      NEW.break_minutes := 0;
      NEW.edited := false;
      NEW.location_id := NULL;
      RETURN NEW;
    END IF;
    IF private.is_manager() THEN
      -- A manager typing in an entry (for anyone): manual, marked as edited.
      NEW.method := 'manual';
      NEW.edited := true;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You can only start your own shift' USING ERRCODE = '42501';
  END IF;

  -- UPDATE
  v_is_clock_out := OLD.clock_out IS NULL
    AND NEW.clock_out IS NOT NULL
    AND NEW.user_id = OLD.user_id
    AND NEW.clock_in = OLD.clock_in
    AND NEW.method = OLD.method
    AND NEW.break_minutes = OLD.break_minutes
    AND NEW.note IS NOT DISTINCT FROM OLD.note
    AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id;

  IF OLD.user_id = v_uid AND v_is_clock_out THEN
    -- Finish shift: server time.
    NEW.clock_out := greatest(now(), OLD.clock_in + interval '1 second');
    NEW.edited := OLD.edited;
    RETURN NEW;
  END IF;

  IF private.is_manager() THEN
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    NEW.edited := true;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a manager can change clock times. Ask for a correction instead.' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.time_entries_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS time_entries_guard ON public.time_entries;
CREATE TRIGGER time_entries_guard
  BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION private.time_entries_guard();

-- ---------- who is working today (no pay), for every member ----------
-- One row per active person who clocked time today (company timezone).
-- Phase 3 folds this into v_today_board together with schedule_shifts.
CREATE OR REPLACE FUNCTION private.team_today()
RETURNS TABLE (user_id uuid, first_in timestamptz, last_out timestamptz, is_open boolean, worked_minutes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), day AS (
    SELECT (date_trunc('day', now() AT TIME ZONE tz.name)) AT TIME ZONE tz.name AS d0,
           (date_trunc('day', now() AT TIME ZONE tz.name) + interval '1 day') AT TIME ZONE tz.name AS d1
    FROM tz
  )
  SELECT e.user_id,
         min(e.clock_in) AS first_in,
         CASE WHEN bool_or(e.clock_out IS NULL) THEN NULL ELSE max(e.clock_out) END AS last_out,
         bool_or(e.clock_out IS NULL) AS is_open,
         (sum(extract(epoch FROM (least(coalesce(e.clock_out, now()), day.d1) - greatest(e.clock_in, day.d0)))) / 60)::int
           - coalesce(sum(e.break_minutes), 0)::int AS worked_minutes
  FROM public.time_entries e
  JOIN public.profiles p ON p.id = e.user_id AND p.active
  CROSS JOIN day
  WHERE private.current_profile_id() IS NOT NULL
    AND e.clock_in < day.d1
    AND coalesce(e.clock_out, now()) > day.d0
  GROUP BY e.user_id;
$$;
REVOKE ALL ON FUNCTION private.team_today() FROM public, anon;
GRANT EXECUTE ON FUNCTION private.team_today() TO authenticated;

DROP VIEW IF EXISTS public.team_today;
CREATE VIEW public.team_today
WITH (security_invoker = true)
AS
  SELECT * FROM private.team_today();

REVOKE ALL ON public.team_today FROM public, anon;
GRANT SELECT ON public.team_today TO authenticated;
