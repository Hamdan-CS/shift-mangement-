-- ShiftClock · who added / approved each worked shift, and pay-rate requests.
--
--   * time_entries.edited_by / edited_by_name: set by the guard whenever a
--     manager or owner adds or changes an entry (directly in Timesheets, or by
--     approving a correction / missing shift). pay_days returns the names as
--     approved_by, so Pay, Payroll, History, Timesheets and Excel can show it.
--   * profile_requests: an employee or manager asks for a new hourly rate; the
--     owner approves or declines; approval writes the new rate. Undo restores it.

-- ---------- who added / approved ----------
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edited_by_name text;

CREATE OR REPLACE FUNCTION private.time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mgr boolean;
  v_is_clock_out boolean;
  v_button_ok boolean;
BEGIN
  -- Service role (QR Edge Function, cron auto clock-out, seed): trusted as sent.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  v_mgr := private.is_manager();
  v_button_ok := v_mgr OR coalesce((SELECT s.allow_button_clock FROM public.settings s WHERE s.id = 1), true);

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id = v_uid AND NEW.method = 'button' THEN
      IF NOT v_button_ok THEN
        RAISE EXCEPTION 'Scan the QR code at work to clock in.' USING ERRCODE = '42501';
      END IF;
      NEW.clock_in := now();
      NEW.clock_out := NULL;
      NEW.break_minutes := 0;
      NEW.edited := false;
      NEW.location_id := NULL;
      NEW.edited_by := NULL;
      NEW.edited_by_name := NULL;
      RETURN NEW;
    END IF;
    IF v_mgr THEN
      -- a manager typing in a worked shift, or approving a missing shift
      NEW.method := 'manual';
      NEW.edited := true;
      NEW.edited_by := v_uid;
      NEW.edited_by_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid);
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
    IF NOT v_button_ok THEN
      RAISE EXCEPTION 'Scan the QR code at work to clock out.' USING ERRCODE = '42501';
    END IF;
    NEW.clock_out := greatest(now(), OLD.clock_in + interval '1 second');
    NEW.edited := OLD.edited;
    NEW.edited_by := OLD.edited_by;
    NEW.edited_by_name := OLD.edited_by_name;
    RETURN NEW;
  END IF;

  IF v_mgr THEN
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    NEW.edited := true;
    NEW.edited_by := v_uid;
    NEW.edited_by_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a manager can change clock times. Ask for a correction instead.' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.time_entries_guard() FROM public, anon, authenticated;

-- auto clock-out names itself
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
           edited_by = NULL,
           edited_by_name = 'Auto clock-out',
           note = left(coalesce(note || ' · ', '') || 'Closed automatically after ' || v_hours || 'h', 500)
     WHERE id = r.id;
    PERFORM private.notify(r.user_id, 'shift.auto_closed', jsonb_build_object('hours', v_hours, 'clock_in', r.clock_in));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION private.auto_clock_out() FROM public, anon, authenticated;

-- pay_days gains approved_by (names, comma separated)
DROP FUNCTION IF EXISTS public.pay_days(date, date);
CREATE FUNCTION public.pay_days(p_from date, p_to date)
RETURNS TABLE (
  user_id uuid, day date, first_in timestamptz, last_out timestamptz, minutes integer, break_minutes integer,
  entries integer, methods text, corrected boolean, open boolean, shift_start time, shift_end time, late boolean,
  approved_by text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), e AS (
    SELECT te.user_id, (te.clock_in AT TIME ZONE tz.name)::date AS day, te.clock_in, te.clock_out, te.break_minutes, te.method, te.edited, te.edited_by_name
    FROM public.time_entries te CROSS JOIN tz
    WHERE te.clock_in >= (p_from::timestamp AT TIME ZONE tz.name)
      AND te.clock_in < ((p_to + 1)::timestamp AT TIME ZONE tz.name)
  ), agg AS (
    SELECT e.user_id, e.day,
           min(e.clock_in) AS fi,
           CASE WHEN bool_or(e.clock_out IS NULL) THEN NULL ELSE max(e.clock_out) END AS lo,
           greatest(0, round(sum(extract(epoch FROM coalesce(e.clock_out, now()) - e.clock_in) / 60 - e.break_minutes)))::int AS mins,
           sum(e.break_minutes)::int AS brk,
           count(*)::int AS n,
           string_agg(DISTINCT e.method, ',') AS methods,
           bool_or(e.edited) AS corrected,
           bool_or(e.clock_out IS NULL) AS open,
           string_agg(DISTINCT e.edited_by_name, ', ') AS approved
    FROM e GROUP BY e.user_id, e.day
  ), sh AS (
    SELECT s.user_id, s.date, min(s.start_time) AS st, max(s.end_time) AS en
    FROM public.schedule_shifts s WHERE s.date BETWEEN p_from AND p_to
    GROUP BY s.user_id, s.date
  )
  SELECT a.user_id, a.day, a.fi, a.lo, a.mins, a.brk, a.n, a.methods, a.corrected, a.open, sh.st, sh.en,
         CASE WHEN sh.st IS NULL THEN false ELSE (a.fi AT TIME ZONE tz.name)::time > sh.st + interval '10 minutes' END,
         a.approved
  FROM agg a CROSS JOIN tz
  LEFT JOIN sh ON sh.user_id = a.user_id AND sh.date = a.day
  ORDER BY a.user_id, a.day;
$$;
REVOKE ALL ON FUNCTION public.pay_days(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_days(date, date) TO authenticated;

-- ---------- pay-rate requests ----------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'correction.requested', 'leave.requested', 'request.approved', 'request.declined',
  'schedule.missing', 'schedule.changed', 'shift.auto_closed', 'pay.requested'));

CREATE TABLE IF NOT EXISTS public.profile_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE CASCADE,
  old_rate    numeric(10, 2),
  new_rate    numeric(10, 2) NOT NULL CHECK (new_rate >= 0 AND new_rate <= 10000),
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_requests_user ON public.profile_requests (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS profile_requests_one_pending ON public.profile_requests (user_id) WHERE status = 'pending';
ALTER TABLE public.profile_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_requests TO authenticated;

DROP POLICY IF EXISTS profile_requests_select ON public.profile_requests;
CREATE POLICY profile_requests_select ON public.profile_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS profile_requests_insert ON public.profile_requests;
CREATE POLICY profile_requests_insert ON public.profile_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL);
-- only the owner decides (rates are owner-only, same as profiles_guard_update)
DROP POLICY IF EXISTS profile_requests_update ON public.profile_requests;
CREATE POLICY profile_requests_update ON public.profile_requests FOR UPDATE TO authenticated
  USING ((SELECT private.is_owner())) WITH CHECK ((SELECT private.is_owner()));
-- withdraw your own pending request
DROP POLICY IF EXISTS profile_requests_delete ON public.profile_requests;
CREATE POLICY profile_requests_delete ON public.profile_requests FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'pending');

CREATE OR REPLACE FUNCTION private.profile_requests_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := coalesce(v_uid, NEW.user_id);
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_by_name := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    NEW.old_rate := (SELECT p.hourly_rate FROM public.profiles p WHERE p.id = NEW.user_id);
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: only the decision fields change
  NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.old_rate := OLD.old_rate;
  NEW.new_rate := OLD.new_rate; NEW.reason := OLD.reason; NEW.created_at := OLD.created_at;
  IF NEW.status = OLD.status THEN
    NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_by_name := OLD.reviewed_by_name; NEW.reviewed_at := OLD.reviewed_at;
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'declined') THEN
    NEW.reviewed_by := v_uid;
    NEW.reviewed_by_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid);
    NEW.reviewed_at := now();
    IF NEW.status = 'approved' THEN
      UPDATE public.profiles SET hourly_rate = OLD.new_rate WHERE id = OLD.user_id;
    END IF;
  ELSIF OLD.status IN ('approved', 'declined') AND NEW.status = 'pending' THEN
    IF OLD.status = 'approved' THEN
      UPDATE public.profiles SET hourly_rate = OLD.old_rate WHERE id = OLD.user_id;   -- Undo
    END IF;
    NEW.reviewed_by := NULL; NEW.reviewed_by_name := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
  ELSE
    RAISE EXCEPTION 'Undo the decision first, then decide again' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.profile_requests_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o record;
  v_name text := private.full_name(NEW.user_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR o IN SELECT p.id FROM public.profiles p WHERE p.role = 'owner' AND p.active AND p.id <> NEW.user_id LOOP
      PERFORM private.notify(o.id, 'pay.requested', jsonb_build_object('kind', 'pay', 'request_id', NEW.id, 'employee_name', v_name, 'new_rate', NEW.new_rate, 'old_rate', NEW.old_rate));
    END LOOP;
    PERFORM private.audit('pay_request.created', 'profile_request', NEW.id, NULL, to_jsonb(NEW));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('approved', 'declined') THEN
      PERFORM private.notify(NEW.user_id, CASE WHEN NEW.status = 'approved' THEN 'request.approved' ELSE 'request.declined' END,
        jsonb_build_object('kind', 'pay', 'request_id', NEW.id, 'reviewer_name', NEW.reviewed_by_name, 'review_note', NEW.review_note, 'new_rate', NEW.new_rate));
    END IF;
    PERFORM private.audit('pay_request.' || CASE WHEN NEW.status = 'pending' THEN 'reopened' ELSE NEW.status END, 'profile_request', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.profile_requests_before(), private.profile_requests_after() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS profile_requests_before ON public.profile_requests;
CREATE TRIGGER profile_requests_before BEFORE INSERT OR UPDATE ON public.profile_requests FOR EACH ROW EXECUTE FUNCTION private.profile_requests_before();
DROP TRIGGER IF EXISTS profile_requests_after ON public.profile_requests;
CREATE TRIGGER profile_requests_after AFTER INSERT OR UPDATE ON public.profile_requests FOR EACH ROW EXECUTE FUNCTION private.profile_requests_after();
