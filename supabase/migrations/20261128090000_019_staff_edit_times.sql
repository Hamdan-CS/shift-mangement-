-- 019 · Staff can edit their own clock times (owner's choice)
--   * settings.staff_edit_times (off by default). When on, a correction a person
--     sends for their own times is applied at once (no approval). The entry is
--     marked edited_by = the person, so the app shows "Edited by employee", and
--     every manager / the owner gets a 'time.self_edited' notification. They can
--     still Undo it in Approvals (same as an approved correction).
--   * A shift that is still running can be corrected too: new_clock_out NULL =
--     change only the clock-in time, keep working.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS staff_edit_times boolean NOT NULL DEFAULT false;
ALTER TABLE public.corrections ALTER COLUMN new_clock_out DROP NOT NULL;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'correction.requested', 'leave.requested', 'request.approved', 'request.declined',
  'schedule.missing', 'schedule.changed', 'shift.auto_closed', 'pay.requested', 'time.self_edited'));

-- apply a correction to time_entries (shared by "approve" and "self edit")
CREATE OR REPLACE FUNCTION private.apply_correction(p_user uuid, p_entry uuid, p_in timestamptz, p_out timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_new uuid;
BEGIN
  IF p_entry IS NOT NULL THEN
    -- p_out NULL = only the clock-in changes (the shift may still be running, or ended since)
    UPDATE public.time_entries SET clock_in = p_in, clock_out = CASE WHEN p_out IS NULL THEN clock_out ELSE p_out END
    WHERE id = p_entry;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That clock entry no longer exists' USING ERRCODE = '23503';
    END IF;
    RETURN NULL;
  END IF;
  INSERT INTO public.time_entries (user_id, clock_in, clock_out, method, note)
  VALUES (p_user, p_in, p_out, 'manual', 'Added by correction')
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION private.corrections_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.time_entries%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    NEW.applied_entry_id := NULL;
    NEW.created_at := now();
    NEW.reason := btrim(NEW.reason);
    IF coalesce(NEW.new_clock_out, NEW.new_clock_in) > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'The new times can''t be in the future' USING ERRCODE = '23514';
    END IF;
    IF NEW.entry_id IS NOT NULL THEN
      SELECT * INTO v_entry FROM public.time_entries e WHERE e.id = NEW.entry_id;
      IF NOT FOUND OR v_entry.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'You can only correct your own clock times' USING ERRCODE = '42501';
      END IF;
      NEW.old_clock_in := v_entry.clock_in;
      NEW.old_clock_out := v_entry.clock_out;
      IF NEW.new_clock_out IS NULL AND v_entry.clock_out IS NOT NULL THEN
        RAISE EXCEPTION 'Pick a clock-out time too' USING ERRCODE = '23514';
      END IF;
      IF NEW.new_clock_out IS NULL AND now() - NEW.new_clock_in > interval '20 hours' THEN
        RAISE EXCEPTION 'max_length' USING ERRCODE = '23514';
      END IF;
    ELSE
      NEW.old_clock_in := NULL; NEW.old_clock_out := NULL;
      IF NEW.new_clock_out IS NULL THEN
        RAISE EXCEPTION 'Pick a clock-out time too' USING ERRCODE = '23514';
      END IF;
    END IF;

    -- the owner lets staff edit their own times: apply now, no approval
    IF v_uid IS NOT NULL AND v_uid = NEW.user_id
       AND coalesce((SELECT s.staff_edit_times FROM public.settings s WHERE s.id = 1), false) THEN
      PERFORM set_config('shiftclock.self_edit', NEW.user_id::text, true);
      NEW.applied_entry_id := private.apply_correction(NEW.user_id, NEW.entry_id, NEW.new_clock_in, NEW.new_clock_out);
      PERFORM set_config('shiftclock.self_edit', '', true);
      NEW.status := 'approved';
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL AND NOT private.is_manager() THEN
    RAISE EXCEPTION 'Only a manager can decide requests' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NOT NULL AND OLD.user_id = v_uid AND private.current_app_role() <> 'owner' THEN
    RAISE EXCEPTION 'You can''t decide your own request. Ask the owner.' USING ERRCODE = '42501';
  END IF;
  NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.entry_id := OLD.entry_id;
  NEW.old_clock_in := OLD.old_clock_in; NEW.old_clock_out := OLD.old_clock_out;
  NEW.new_clock_in := OLD.new_clock_in; NEW.new_clock_out := OLD.new_clock_out;
  NEW.reason := OLD.reason; NEW.created_at := OLD.created_at;
  NEW.applied_entry_id := OLD.applied_entry_id;

  IF NEW.status = OLD.status THEN
    NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'declined') THEN
    NEW.reviewed_by := v_uid; NEW.reviewed_at := now();
  ELSIF OLD.status IN ('approved', 'declined') AND NEW.status = 'pending' THEN
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
  ELSE
    RAISE EXCEPTION 'Undo the decision first, then decide again' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'approved' THEN
    NEW.applied_entry_id := coalesce(private.apply_correction(OLD.user_id, OLD.entry_id, OLD.new_clock_in, OLD.new_clock_out), OLD.applied_entry_id);
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'pending' THEN
    IF OLD.entry_id IS NOT NULL THEN
      -- old_clock_out NULL (it was running) and only the clock-in changed: keep today's clock-out
      UPDATE public.time_entries
      SET clock_in = OLD.old_clock_in,
          clock_out = CASE WHEN OLD.old_clock_out IS NULL AND OLD.new_clock_out IS NULL THEN clock_out ELSE OLD.old_clock_out END
      WHERE id = OLD.entry_id;
    END IF;
    NEW.applied_entry_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- time_entries: a self edit (set by corrections_guard above) may change the person's own entry
CREATE OR REPLACE FUNCTION private.time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mgr boolean;
  v_is_clock_out boolean;
  v_button_ok boolean;
  v_self text := current_setting('shiftclock.self_edit', true);
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_self IS NOT NULL AND v_self <> '' AND v_self = v_uid::text
     AND NEW.user_id = v_uid AND (TG_OP = 'INSERT' OR OLD.user_id = v_uid) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.method := 'manual';
    ELSE
      NEW.id := OLD.id; NEW.created_at := OLD.created_at; NEW.method := OLD.method;
      NEW.location_id := OLD.location_id; NEW.break_minutes := OLD.break_minutes;
    END IF;
    NEW.edited := true;
    NEW.edited_by := v_uid;
    NEW.edited_by_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid);
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
      NEW.method := 'manual';
      NEW.edited := true;
      NEW.edited_by := v_uid;
      NEW.edited_by_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid);
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You can only start your own shift' USING ERRCODE = '42501';
  END IF;

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
$function$;

-- notifications: a self edit tells every manager and the owner, with the old and new times
CREATE OR REPLACE FUNCTION private.requests_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_kind text := CASE WHEN TG_TABLE_NAME = 'corrections' THEN 'correction' ELSE 'leave' END;
  v_payload jsonb;
  v_tz text := coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC');
  v_was text; v_now text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object('kind', v_kind, 'request_id', NEW.id, 'employee_name', private.full_name(NEW.user_id));
    IF v_kind = 'correction' AND NEW.status = 'approved' THEN
      v_now := to_char(NEW.new_clock_in AT TIME ZONE v_tz, 'DD.MM HH24:MI') || '–' || coalesce(to_char(NEW.new_clock_out AT TIME ZONE v_tz, 'HH24:MI'), 'still working');
      v_was := CASE WHEN NEW.old_clock_in IS NULL THEN 'a missing shift'
                    ELSE to_char(NEW.old_clock_in AT TIME ZONE v_tz, 'HH24:MI') || '–' || coalesce(to_char(NEW.old_clock_out AT TIME ZONE v_tz, 'HH24:MI'), 'still working') END;
      PERFORM private.notify_managers('time.self_edited', v_payload || jsonb_build_object('was', v_was, 'now', v_now, 'reason', NEW.reason), NEW.user_id);
      PERFORM private.audit('correction.self_edited', 'correction', NEW.id, jsonb_build_object('clock_in', NEW.old_clock_in, 'clock_out', NEW.old_clock_out), jsonb_build_object('clock_in', NEW.new_clock_in, 'clock_out', NEW.new_clock_out));
      RETURN NEW;
    END IF;
    PERFORM private.notify_managers(CASE WHEN v_kind = 'correction' THEN 'correction.requested' ELSE 'leave.requested' END, v_payload, NEW.user_id);
    RETURN NEW;
  END IF;
  IF v_kind = 'correction' THEN
    IF OLD.status = 'approved' AND NEW.status = 'pending' AND OLD.applied_entry_id IS NOT NULL THEN
      DELETE FROM public.time_entries WHERE id = OLD.applied_entry_id;
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM private.audit(v_kind || '.' || CASE WHEN NEW.status = 'pending' THEN 'reopened' ELSE NEW.status END, v_kind, NEW.id,
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status, 'note', NEW.review_note));
    IF NEW.status IN ('approved', 'declined') THEN
      PERFORM private.notify(NEW.user_id, 'request.' || NEW.status,
        jsonb_build_object('kind', v_kind, 'request_id', NEW.id, 'review_note', NEW.review_note, 'reviewer_name', private.full_name(NEW.reviewed_by)));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_correction(uuid, uuid, timestamptz, timestamptz), private.corrections_guard(), private.time_entries_guard(), private.requests_after() FROM public, anon, authenticated;

-- pay_days: same as 018, but a person's own edit shows as 'employee' instead of their name
CREATE OR REPLACE FUNCTION public.pay_days(p_from date, p_to date)
RETURNS TABLE(user_id uuid, day date, first_in timestamptz, last_out timestamptz, minutes integer, break_minutes integer,
              entries integer, methods text, corrected boolean, open boolean, shift_start time, shift_end time, late boolean,
              approved_by text, grace_minutes integer, overtime_minutes integer)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), e AS (
    SELECT te.user_id, (te.clock_in AT TIME ZONE tz.name)::date AS day, te.clock_in, te.clock_out, te.break_minutes, te.method, te.edited,
           -- a person's own edit reads 'employee' (the app shows "Edited by employee")
           CASE WHEN te.edited_by IS NOT NULL AND te.edited_by = te.user_id THEN 'employee' ELSE te.edited_by_name END AS edited_by_name
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
  ), x AS (
    SELECT a.*, sh.st, sh.en, tz.name AS tzn,
           CASE WHEN sh.st IS NULL THEN NULL ELSE ((a.day + sh.st)::timestamp AT TIME ZONE tz.name) END AS start_ts,
           -- a shift ending at or before its start (e.g. 18:00–00:00) ends the next day
           CASE WHEN sh.en IS NULL THEN NULL
                ELSE ((a.day + sh.en + CASE WHEN sh.en <= sh.st THEN interval '1 day' ELSE interval '0' END)::timestamp AT TIME ZONE tz.name) END AS end_ts
    FROM agg a CROSS JOIN tz
    LEFT JOIN sh ON sh.user_id = a.user_id AND sh.date = a.day
  ), y AS (
    SELECT x.*,
           CASE WHEN x.start_ts IS NOT NULL AND x.fi > x.start_ts AND x.fi <= x.start_ts + interval '30 minutes'
                THEN round(extract(epoch FROM x.fi - x.start_ts) / 60)::int ELSE 0 END AS grace,
           CASE WHEN x.end_ts IS NULL THEN 0
                ELSE greatest(0, round(extract(epoch FROM coalesce(x.lo, now()) - greatest(x.end_ts, x.fi)) / 60))::int END AS ot_raw
    FROM x
  )
  SELECT y.user_id, y.day, y.fi, y.lo, (y.mins + y.grace)::int, y.brk, y.n, y.methods, y.corrected, y.open, y.st, y.en,
         CASE WHEN y.st IS NULL THEN false ELSE (y.fi AT TIME ZONE y.tzn)::time > y.st + interval '10 minutes' END,
         y.approved,
         y.grace,
         least(y.ot_raw, y.mins + y.grace)::int
  FROM y
  ORDER BY y.user_id, y.day;
$function$;

