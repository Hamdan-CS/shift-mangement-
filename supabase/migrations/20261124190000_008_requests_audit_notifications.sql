-- ShiftClock · Phase 5: corrections + leave + approvals, audit log, notifications
-- (PLAN.md sections 5, 9, 10). Rules enforced here:
--   * employees ask, managers decide. A correction is applied to time_entries
--     the moment it's approved and reverted exactly on Undo (back to pending).
--   * a manager can't decide their own request (the owner can).
--   * approved leave shows as on_leave on the Today board and hides that shift.
--   * every decision, manager edit of time / schedules, and pay or role change
--     is written to audit_log (managers can read it, nobody can write it directly).
--   * notifications are created by the database only, and each one pings the
--     person's private Realtime channel "user:<id>" so the bell updates live.

-- ============================================================
-- helpers: audit + notify (definer, private, not callable from the API)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target ON public.audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_actor ON public.audit_log (actor_id);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated USING ((SELECT private.is_manager()));

CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('correction.requested', 'leave.requested', 'request.approved', 'request.declined', 'schedule.missing', 'schedule.changed')),
  payload      jsonb NOT NULL DEFAULT '{}',
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON public.notifications (recipient_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (recipient_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = (SELECT auth.uid())) WITH CHECK (recipient_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated USING (recipient_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.audit(p_action text, p_type text, p_target uuid, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, before, after)
  VALUES (auth.uid(), p_action, p_type, p_target, p_before, p_after);
$$;

CREATE OR REPLACE FUNCTION private.notify(p_recipient uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (recipient_id, type, payload) VALUES (p_recipient, p_type, p_payload);
  BEGIN
    PERFORM realtime.send(jsonb_build_object('type', p_type), 'notification', 'user:' || p_recipient::text, true);
  EXCEPTION WHEN OTHERS THEN NULL; -- a missed ping never blocks the change
  END;
END;
$$;

-- every active manager / owner except one person
CREATE OR REPLACE FUNCTION private.notify_managers(p_type text, p_payload jsonb, p_except uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.id FROM public.profiles p WHERE p.active AND p.role IN ('owner', 'manager') AND p.id IS DISTINCT FROM p_except LOOP
    PERFORM private.notify(r.id, p_type, p_payload);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.full_name(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = p_id), 'Someone');
$$;

REVOKE ALL ON FUNCTION private.audit(text, text, uuid, jsonb, jsonb), private.notify(uuid, text, jsonb), private.notify_managers(text, jsonb, uuid), private.full_name(uuid) FROM public, anon, authenticated;

-- live bell: each person may listen on "user:<their id>" only
DROP POLICY IF EXISTS user_topic_listen ON realtime.messages;
CREATE POLICY user_topic_listen ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.topic() = 'user:' || (SELECT auth.uid())::text);

-- ============================================================
-- corrections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  entry_id         uuid REFERENCES public.time_entries (id) ON DELETE SET NULL,  -- null = a shift that was never clocked
  old_clock_in     timestamptz,
  old_clock_out    timestamptz,
  new_clock_in     timestamptz NOT NULL,
  new_clock_out    timestamptz NOT NULL,
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  review_note      text CHECK (review_note IS NULL OR length(review_note) <= 500),
  applied_entry_id uuid REFERENCES public.time_entries (id) ON DELETE SET NULL,  -- entry created for a missing shift
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrections_out_after_in CHECK (new_clock_out > new_clock_in),
  CONSTRAINT corrections_max_length CHECK (new_clock_out - new_clock_in <= interval '20 hours')
);
CREATE INDEX IF NOT EXISTS corrections_user ON public.corrections (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS corrections_status ON public.corrections (status, created_at);
CREATE INDEX IF NOT EXISTS corrections_entry ON public.corrections (entry_id);
CREATE INDEX IF NOT EXISTS corrections_applied ON public.corrections (applied_entry_id);
CREATE INDEX IF NOT EXISTS corrections_reviewed_by ON public.corrections (reviewed_by);
-- one open request per entry
CREATE UNIQUE INDEX IF NOT EXISTS corrections_one_pending ON public.corrections (entry_id) WHERE status = 'pending' AND entry_id IS NOT NULL;

ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corrections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corrections TO authenticated;
DROP POLICY IF EXISTS corrections_select ON public.corrections;
CREATE POLICY corrections_select ON public.corrections FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS corrections_insert ON public.corrections;
CREATE POLICY corrections_insert ON public.corrections FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL);
DROP POLICY IF EXISTS corrections_update ON public.corrections;
CREATE POLICY corrections_update ON public.corrections FOR UPDATE TO authenticated
  USING ((SELECT private.is_manager())) WITH CHECK ((SELECT private.is_manager()));
-- employees may withdraw their own pending request
DROP POLICY IF EXISTS corrections_delete ON public.corrections;
CREATE POLICY corrections_delete ON public.corrections FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'pending');

CREATE OR REPLACE FUNCTION private.corrections_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.time_entries%ROWTYPE;
  v_new uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    NEW.applied_entry_id := NULL;
    NEW.created_at := now();
    NEW.reason := btrim(NEW.reason);
    IF NEW.new_clock_out > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'The new times can''t be in the future' USING ERRCODE = '23514';
    END IF;
    IF NEW.entry_id IS NOT NULL THEN
      SELECT * INTO v_entry FROM public.time_entries e WHERE e.id = NEW.entry_id;
      IF NOT FOUND OR v_entry.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'You can only correct your own clock times' USING ERRCODE = '42501';
      END IF;
      NEW.old_clock_in := v_entry.clock_in;
      NEW.old_clock_out := v_entry.clock_out;
    ELSE
      NEW.old_clock_in := NULL; NEW.old_clock_out := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only a decision (status + note) can change
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
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;   -- Undo
  ELSE
    RAISE EXCEPTION 'Undo the decision first, then decide again' USING ERRCODE = '23514';
  END IF;

  -- apply on approve
  IF NEW.status = 'approved' THEN
    IF OLD.entry_id IS NOT NULL THEN
      UPDATE public.time_entries SET clock_in = OLD.new_clock_in, clock_out = OLD.new_clock_out WHERE id = OLD.entry_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That clock entry no longer exists' USING ERRCODE = '23503';
      END IF;
    ELSE
      INSERT INTO public.time_entries (user_id, clock_in, clock_out, method, note)
      VALUES (OLD.user_id, OLD.new_clock_in, OLD.new_clock_out, 'manual', 'Added by correction')
      RETURNING id INTO v_new;
      NEW.applied_entry_id := v_new;
    END IF;
  END IF;

  -- revert on Undo of an approval
  IF OLD.status = 'approved' AND NEW.status = 'pending' THEN
    IF OLD.entry_id IS NOT NULL THEN
      UPDATE public.time_entries SET clock_in = OLD.old_clock_in, clock_out = OLD.old_clock_out WHERE id = OLD.entry_id;
    END IF;
    -- the entry this request created is deleted in requests_after (after this row
    -- no longer points at it), otherwise the foreign key would touch this same row
    NEW.applied_entry_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- leave_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('annual', 'sick', 'unpaid', 'other')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text CHECK (reason IS NULL OR length(reason) <= 500),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_end_after_start CHECK (end_date >= start_date),
  CONSTRAINT leave_max_length CHECK (end_date - start_date <= 90)
);
CREATE INDEX IF NOT EXISTS leave_user ON public.leave_requests (user_id, start_date);
CREATE INDEX IF NOT EXISTS leave_status ON public.leave_requests (status, created_at);
CREATE INDEX IF NOT EXISTS leave_dates ON public.leave_requests (start_date, end_date) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS leave_reviewed_by ON public.leave_requests (reviewed_by);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leave_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
DROP POLICY IF EXISTS leave_select ON public.leave_requests;
CREATE POLICY leave_select ON public.leave_requests FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS leave_insert ON public.leave_requests;
CREATE POLICY leave_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL);
DROP POLICY IF EXISTS leave_update ON public.leave_requests;
CREATE POLICY leave_update ON public.leave_requests FOR UPDATE TO authenticated
  USING ((SELECT private.is_manager())) WITH CHECK ((SELECT private.is_manager()));
DROP POLICY IF EXISTS leave_delete ON public.leave_requests;
CREATE POLICY leave_delete ON public.leave_requests FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'pending');

CREATE OR REPLACE FUNCTION private.leave_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    NEW.created_at := now();
    NEW.reason := nullif(btrim(NEW.reason), '');
    IF EXISTS (
      SELECT 1 FROM public.leave_requests l
      WHERE l.user_id = NEW.user_id AND l.status IN ('pending', 'approved')
        AND l.start_date <= NEW.end_date AND l.end_date >= NEW.start_date
    ) THEN
      RAISE EXCEPTION 'You already asked for leave on some of these days' USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL AND NOT private.is_manager() THEN
    RAISE EXCEPTION 'Only a manager can decide requests' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NOT NULL AND OLD.user_id = v_uid AND private.current_app_role() <> 'owner' THEN
    RAISE EXCEPTION 'You can''t decide your own request. Ask the owner.' USING ERRCODE = '42501';
  END IF;
  NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.type := OLD.type;
  NEW.start_date := OLD.start_date; NEW.end_date := OLD.end_date;
  NEW.reason := OLD.reason; NEW.created_at := OLD.created_at;
  IF NEW.status = OLD.status THEN
    NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
  ELSIF OLD.status = 'pending' AND NEW.status IN ('approved', 'declined') THEN
    NEW.reviewed_by := v_uid; NEW.reviewed_at := now();
  ELSIF OLD.status IN ('approved', 'declined') AND NEW.status = 'pending' THEN
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
  ELSE
    RAISE EXCEPTION 'Undo the decision first, then decide again' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.corrections_guard(), private.leave_guard() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS corrections_guard ON public.corrections;
CREATE TRIGGER corrections_guard BEFORE INSERT OR UPDATE ON public.corrections FOR EACH ROW EXECUTE FUNCTION private.corrections_guard();
DROP TRIGGER IF EXISTS leave_guard ON public.leave_requests;
CREATE TRIGGER leave_guard BEFORE INSERT OR UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION private.leave_guard();

-- ============================================================
-- notify + audit on requests
-- ============================================================
CREATE OR REPLACE FUNCTION private.requests_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_kind text := CASE WHEN TG_TABLE_NAME = 'corrections' THEN 'correction' ELSE 'leave' END;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object('kind', v_kind, 'request_id', NEW.id, 'employee_name', private.full_name(NEW.user_id));
    PERFORM private.notify_managers(CASE WHEN v_kind = 'correction' THEN 'correction.requested' ELSE 'leave.requested' END, v_payload, NEW.user_id);
    RETURN NEW;
  END IF;
  -- Undo of an approved "missing shift": remove the entry it created
  -- (nested: leave_requests has no applied_entry_id column, so don't touch it there)
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
$$;
REVOKE ALL ON FUNCTION private.requests_after() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS corrections_after ON public.corrections;
CREATE TRIGGER corrections_after AFTER INSERT OR UPDATE ON public.corrections FOR EACH ROW EXECUTE FUNCTION private.requests_after();
DROP TRIGGER IF EXISTS leave_after ON public.leave_requests;
CREATE TRIGGER leave_after AFTER INSERT OR UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION private.requests_after();

-- leave changes the board
DROP TRIGGER IF EXISTS board_ping ON public.leave_requests;
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests FOR EACH STATEMENT EXECUTE FUNCTION private.board_ping();

-- ============================================================
-- audit: manager edits of time entries, schedules; pay / role changes
-- ============================================================
CREATE OR REPLACE FUNCTION private.time_entries_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT private.is_manager() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.method = 'manual' THEN
    PERFORM private.audit('time_entry.added', 'time_entry', NEW.id, NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' AND NEW.edited AND (NEW.user_id <> v_uid OR OLD.clock_in IS DISTINCT FROM NEW.clock_in OR (OLD.clock_out IS NOT NULL AND OLD.clock_out IS DISTINCT FROM NEW.clock_out)) THEN
    PERFORM private.audit('time_entry.edited', 'time_entry', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.audit('time_entry.deleted', 'time_entry', OLD.id, to_jsonb(OLD), NULL);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.schedule_shifts_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.schedule_shifts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  IF v_uid IS NULL OR v_row.user_id = v_uid OR NOT private.is_manager() THEN RETURN NULL; END IF;
  PERFORM private.audit('schedule.' || lower(TG_OP), 'schedule_shift', v_row.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  PERFORM private.notify(v_row.user_id, 'schedule.changed', jsonb_build_object(
    'editor_name', private.full_name(v_uid), 'date', v_row.date,
    'start', to_char(v_row.start_time, 'HH24:MI'), 'end', to_char(v_row.end_time, 'HH24:MI'),
    'change', lower(TG_OP)));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.profiles_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate
     OR NEW.overtime_after_hours IS DISTINCT FROM OLD.overtime_after_hours OR NEW.overtime_multiplier IS DISTINCT FROM OLD.overtime_multiplier
     OR NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM private.audit('profile.updated', 'profile', NEW.id,
      jsonb_build_object('role', OLD.role, 'hourly_rate', OLD.hourly_rate, 'overtime_after_hours', OLD.overtime_after_hours, 'overtime_multiplier', OLD.overtime_multiplier, 'active', OLD.active),
      jsonb_build_object('role', NEW.role, 'hourly_rate', NEW.hourly_rate, 'overtime_after_hours', NEW.overtime_after_hours, 'overtime_multiplier', NEW.overtime_multiplier, 'active', NEW.active));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.time_entries_audit(), private.schedule_shifts_after(), private.profiles_audit() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS time_entries_audit ON public.time_entries;
CREATE TRIGGER time_entries_audit AFTER INSERT OR UPDATE OR DELETE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION private.time_entries_audit();
DROP TRIGGER IF EXISTS schedule_shifts_after ON public.schedule_shifts;
CREATE TRIGGER schedule_shifts_after AFTER INSERT OR UPDATE OR DELETE ON public.schedule_shifts FOR EACH ROW EXECUTE FUNCTION private.schedule_shifts_after();
DROP TRIGGER IF EXISTS profiles_audit ON public.profiles;
CREATE TRIGGER profiles_audit AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.profiles_audit();

-- ============================================================
-- Today board: approved leave → on_leave, shift hidden
-- ============================================================
CREATE OR REPLACE FUNCTION private.today_board()
RETURNS TABLE (
  user_id uuid, shift_start time, shift_end time, shift_note text,
  first_in timestamptz, last_out timestamptz, is_open boolean, worked_minutes integer, status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), day AS (
    SELECT (now() AT TIME ZONE tz.name)::date AS today,
           extract(epoch FROM (now() AT TIME ZONE tz.name)::time) / 60 AS now_min,
           (date_trunc('day', now() AT TIME ZONE tz.name)) AT TIME ZONE tz.name AS d0,
           (date_trunc('day', now() AT TIME ZONE tz.name) + interval '1 day') AT TIME ZONE tz.name AS d1
    FROM tz
  ), lv AS (
    SELECT DISTINCT l.user_id FROM public.leave_requests l CROSS JOIN day
    WHERE l.status = 'approved' AND day.today BETWEEN l.start_date AND l.end_date
  ), sh AS (
    SELECT s.user_id, min(s.start_time) AS st, max(s.end_time) AS en,
           string_agg(s.note, ', ' ORDER BY s.start_time) FILTER (WHERE s.note IS NOT NULL) AS note
    FROM public.schedule_shifts s CROSS JOIN day
    WHERE s.date = day.today AND s.user_id NOT IN (SELECT lv.user_id FROM lv)   -- leave hides the shift
    GROUP BY s.user_id
  ), cl AS (
    SELECT e.user_id,
           min(e.clock_in) AS first_in,
           CASE WHEN bool_or(e.clock_out IS NULL) THEN NULL ELSE max(e.clock_out) END AS last_out,
           bool_or(e.clock_out IS NULL) AS is_open,
           greatest(0, (sum(extract(epoch FROM (least(coalesce(e.clock_out, now()), day.d1) - greatest(e.clock_in, day.d0)))) / 60)::int
             - coalesce(sum(e.break_minutes), 0)::int) AS worked_minutes
    FROM public.time_entries e CROSS JOIN day
    WHERE e.clock_in < day.d1 AND coalesce(e.clock_out, now()) > day.d0
    GROUP BY e.user_id
  )
  SELECT p.id, sh.st, sh.en, sh.note, cl.first_in, cl.last_out,
         coalesce(cl.is_open, false), coalesce(cl.worked_minutes, 0),
         CASE
           WHEN cl.is_open THEN 'working'
           WHEN p.id IN (SELECT lv.user_id FROM lv) THEN 'on_leave'
           WHEN cl.user_id IS NOT NULL THEN 'finished'
           WHEN sh.user_id IS NULL THEN 'off'
           WHEN day.now_min < extract(epoch FROM sh.st) / 60 + 10 THEN 'upcoming'
           WHEN day.now_min < extract(epoch FROM sh.en) / 60 THEN 'late'
           ELSE 'absent'
         END
  FROM public.profiles p
  CROSS JOIN day
  LEFT JOIN sh ON sh.user_id = p.id
  LEFT JOIN cl ON cl.user_id = p.id
  WHERE p.active AND private.current_profile_id() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.today_board() FROM public, anon;
GRANT EXECUTE ON FUNCTION private.today_board() TO authenticated;
