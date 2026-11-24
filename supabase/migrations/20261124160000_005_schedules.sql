-- ShiftClock · Phase 3: schedules + Today board (PLAN.md sections 5, 6, 10b).
-- Rules enforced here:
--   * one schedule week per person per Monday; shifts belong to that week
--   * employees build and submit their own week; once a manager locks it,
--     only managers can change it (their edits are stamped `edited_by`)
--   * shifts can't overlap for the same person and must fall inside their week
--   * v_today_board: one row per active person for today (company timezone),
--     status from shifts + clock data; everyone can read it, never pay
--   * any change pings a private Realtime channel "board" (no data in the
--     ping) so open boards reload; only active members may listen

-- ============================================================
-- schedule_weeks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.schedule_weeks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  week_start   date NOT NULL CHECK (extract(isodow FROM week_start) = 1),   -- Monday
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'locked')),
  submitted_at timestamptz,
  locked_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS schedule_weeks_week_start ON public.schedule_weeks (week_start);
CREATE INDEX IF NOT EXISTS schedule_weeks_locked_by ON public.schedule_weeks (locked_by);

-- ============================================================
-- schedule_shifts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.schedule_shifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id    uuid NOT NULL REFERENCES public.schedule_weeks (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  date       date NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  note       text CHECK (note IS NULL OR length(note) <= 120),
  edited_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_shifts_end_after_start CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS schedule_shifts_date ON public.schedule_shifts (date);
CREATE INDEX IF NOT EXISTS schedule_shifts_user_date ON public.schedule_shifts (user_id, date);
CREATE INDEX IF NOT EXISTS schedule_shifts_week ON public.schedule_shifts (week_id);
CREATE INDEX IF NOT EXISTS schedule_shifts_edited_by ON public.schedule_shifts (edited_by);

-- ============================================================
-- RLS: your own weeks / shifts, or everyone's as manager / owner
-- ============================================================
ALTER TABLE public.schedule_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_weeks, public.schedule_shifts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_weeks, public.schedule_shifts TO authenticated;

DROP POLICY IF EXISTS schedule_weeks_select ON public.schedule_weeks;
CREATE POLICY schedule_weeks_select ON public.schedule_weeks FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_weeks_insert ON public.schedule_weeks;
CREATE POLICY schedule_weeks_insert ON public.schedule_weeks FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_weeks_update ON public.schedule_weeks;
CREATE POLICY schedule_weeks_update ON public.schedule_weeks FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_weeks_delete ON public.schedule_weeks;
CREATE POLICY schedule_weeks_delete ON public.schedule_weeks FOR DELETE TO authenticated
  USING ((SELECT private.is_manager()));

DROP POLICY IF EXISTS schedule_shifts_select ON public.schedule_shifts;
CREATE POLICY schedule_shifts_select ON public.schedule_shifts FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_shifts_insert ON public.schedule_shifts;
CREATE POLICY schedule_shifts_insert ON public.schedule_shifts FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_shifts_update ON public.schedule_shifts;
CREATE POLICY schedule_shifts_update ON public.schedule_shifts FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS schedule_shifts_delete ON public.schedule_shifts;
CREATE POLICY schedule_shifts_delete ON public.schedule_shifts FOR DELETE TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));

-- ============================================================
-- Guards
-- ============================================================
CREATE OR REPLACE FUNCTION private.schedule_weeks_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mgr boolean := v_uid IS NOT NULL AND private.is_manager();
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    IF v_uid IS NOT NULL AND NOT v_mgr THEN
      IF NEW.status = 'locked' THEN NEW.status := 'draft'; END IF;
      NEW.locked_by := NULL; NEW.locked_at := NULL;
    END IF;
    IF NEW.status = 'submitted' THEN NEW.submitted_at := now(); ELSE NEW.submitted_at := NULL; END IF;
    IF NEW.status = 'locked' THEN NEW.locked_by := coalesce(v_uid, NEW.locked_by); NEW.locked_at := now(); END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.week_start := OLD.week_start; NEW.created_at := OLD.created_at;
  IF v_uid IS NOT NULL AND NOT v_mgr THEN
    IF OLD.status = 'locked' THEN
      RAISE EXCEPTION 'This week is locked. Ask your manager to change it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'locked' THEN
      RAISE EXCEPTION 'Only a manager can lock a week' USING ERRCODE = '42501';
    END IF;
    NEW.locked_by := NULL; NEW.locked_at := NULL;
  END IF;
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' THEN NEW.submitted_at := now(); END IF;
  IF NEW.status = 'draft' THEN NEW.submitted_at := NULL; END IF;
  IF NEW.status = 'locked' AND OLD.status <> 'locked' THEN
    NEW.locked_by := coalesce(v_uid, NEW.locked_by); NEW.locked_at := now();
  ELSIF NEW.status <> 'locked' THEN
    NEW.locked_by := NULL; NEW.locked_at := NULL;
  ELSE
    NEW.locked_by := OLD.locked_by; NEW.locked_at := OLD.locked_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.schedule_shifts_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mgr boolean := v_uid IS NOT NULL AND private.is_manager();
  v_week public.schedule_weeks%ROWTYPE;
BEGIN
  SELECT * INTO v_week FROM public.schedule_weeks w
  WHERE w.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.week_id ELSE NEW.week_id END;
  IF NOT FOUND THEN
    -- the week itself is being deleted (cascade): let its shifts go
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Schedule week not found' USING ERRCODE = '23503';
  END IF;

  -- Employees can't touch a locked week (theirs before or after the change).
  IF v_uid IS NOT NULL AND NOT v_mgr THEN
    IF v_week.status = 'locked' THEN
      RAISE EXCEPTION 'This week is locked. Ask your manager to change it.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.week_id <> NEW.week_id
       AND (SELECT w.status FROM public.schedule_weeks w WHERE w.id = OLD.week_id) = 'locked' THEN
      RAISE EXCEPTION 'This week is locked. Ask your manager to change it.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.user_id := v_week.user_id;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); ELSE NEW.id := OLD.id; NEW.created_at := OLD.created_at; END IF;

  IF NEW.date < v_week.week_start OR NEW.date > v_week.week_start + 6 THEN
    RAISE EXCEPTION 'That day is not in this week' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedule_shifts s
    WHERE s.user_id = NEW.user_id AND s.date = NEW.date AND s.id <> NEW.id
      AND s.start_time < NEW.end_time AND s.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'This overlaps another shift on the same day' USING ERRCODE = '23P01';
  END IF;

  -- A manager changing someone else's shift is stamped (the employee is told in Phase 5).
  IF v_mgr AND v_week.user_id <> v_uid THEN
    NEW.edited_by := v_uid;
  ELSIF v_uid IS NOT NULL THEN
    NEW.edited_by := CASE WHEN TG_OP = 'UPDATE' THEN OLD.edited_by ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.schedule_weeks_guard(), private.schedule_shifts_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS schedule_weeks_guard ON public.schedule_weeks;
CREATE TRIGGER schedule_weeks_guard BEFORE INSERT OR UPDATE ON public.schedule_weeks
  FOR EACH ROW EXECUTE FUNCTION private.schedule_weeks_guard();
DROP TRIGGER IF EXISTS schedule_shifts_guard ON public.schedule_shifts;
CREATE TRIGGER schedule_shifts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_shifts
  FOR EACH ROW EXECUTE FUNCTION private.schedule_shifts_guard();

-- ============================================================
-- v_today_board (replaces Phase 2's team_today)
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
  ), sh AS (
    SELECT s.user_id, min(s.start_time) AS st, max(s.end_time) AS en,
           string_agg(s.note, ', ' ORDER BY s.start_time) FILTER (WHERE s.note IS NOT NULL) AS note
    FROM public.schedule_shifts s CROSS JOIN day
    WHERE s.date = day.today
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
           WHEN cl.user_id IS NOT NULL THEN 'finished'
           WHEN sh.user_id IS NULL THEN 'off'
           WHEN day.now_min < extract(epoch FROM sh.st) / 60 + 10 THEN 'upcoming'   -- includes a 10-minute grace
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

DROP VIEW IF EXISTS public.v_today_board;
CREATE VIEW public.v_today_board WITH (security_invoker = true) AS SELECT * FROM private.today_board();
REVOKE ALL ON public.v_today_board FROM public, anon;
GRANT SELECT ON public.v_today_board TO authenticated;

DROP VIEW IF EXISTS public.team_today;
DROP FUNCTION IF EXISTS private.team_today();

-- ============================================================
-- Live board: a data-free ping on the private Realtime channel "board"
-- ============================================================
CREATE OR REPLACE FUNCTION private.board_ping()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME), 'changed', 'board', true);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a missed ping must never block a clock-in or a schedule edit
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.board_ping() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS board_ping ON public.time_entries;
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH STATEMENT EXECUTE FUNCTION private.board_ping();
DROP TRIGGER IF EXISTS board_ping ON public.schedule_shifts;
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.schedule_shifts
  FOR EACH STATEMENT EXECUTE FUNCTION private.board_ping();
DROP TRIGGER IF EXISTS board_ping ON public.schedule_weeks;
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.schedule_weeks
  FOR EACH STATEMENT EXECUTE FUNCTION private.board_ping();

-- Only active members may listen on "board".
DROP POLICY IF EXISTS board_members_listen ON realtime.messages;
CREATE POLICY board_members_listen ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.topic() = 'board' AND (SELECT private.current_profile_id()) IS NOT NULL);
