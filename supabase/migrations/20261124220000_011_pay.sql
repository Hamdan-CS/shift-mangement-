-- ShiftClock · Phase 7: pay + deductions (PLAN.md sections 8, 8b).
-- Money is numeric, never float. Pay is worked out here, once, so the Pay
-- page, Payroll, the Copy text and the Excel export all agree:
--   worked   = sum(clock_out - clock_in) - breaks          (open shifts count until now)
--   regular  = per ISO week, up to the person's overtime_after_hours
--   overtime = per ISO week, the rest, paid at overtime_multiplier
--   gross    = regular * rate + overtime * rate * multiplier
--   deductions: fixed (once / weekly / monthly) or percent of gross; never more than gross
--   net      = gross - deductions
-- pay_days / pay_report are SECURITY INVOKER: they read through RLS, so an
-- employee only ever gets their own rows and a manager gets everyone's.

CREATE TABLE IF NOT EXISTS public.deductions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES public.profiles (id) ON DELETE CASCADE,   -- null = everyone
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  type       text NOT NULL CHECK (type IN ('fixed', 'percent')),
  amount     numeric(10, 2) NOT NULL CHECK (amount > 0),
  recurring  text NOT NULL DEFAULT 'once' CHECK (recurring IN ('once', 'weekly', 'monthly')),
  start_date date NOT NULL,
  end_date   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deductions_percent_max CHECK (type <> 'percent' OR amount <= 100),
  CONSTRAINT deductions_dates CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS deductions_user ON public.deductions (user_id);

ALTER TABLE public.deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deductions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deductions TO authenticated;
DROP POLICY IF EXISTS deductions_select ON public.deductions;
CREATE POLICY deductions_select ON public.deductions FOR SELECT TO authenticated
  USING (((user_id = (SELECT auth.uid()) OR user_id IS NULL) AND (SELECT private.current_profile_id()) IS NOT NULL) OR (SELECT private.is_manager()));
DROP POLICY IF EXISTS deductions_insert ON public.deductions;
CREATE POLICY deductions_insert ON public.deductions FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_owner()));
DROP POLICY IF EXISTS deductions_update ON public.deductions;
CREATE POLICY deductions_update ON public.deductions FOR UPDATE TO authenticated USING ((SELECT private.is_owner())) WITH CHECK ((SELECT private.is_owner()));
DROP POLICY IF EXISTS deductions_delete ON public.deductions;
CREATE POLICY deductions_delete ON public.deductions FOR DELETE TO authenticated USING ((SELECT private.is_owner()));

CREATE OR REPLACE FUNCTION private.deductions_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.audit('deduction.' || lower(TG_OP), 'deduction', coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.deductions_audit() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS deductions_audit ON public.deductions;
CREATE TRIGGER deductions_audit AFTER INSERT OR UPDATE OR DELETE ON public.deductions FOR EACH ROW EXECUTE FUNCTION private.deductions_audit();

-- ============================================================
-- pay_days: one row per person per worked day (company timezone)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pay_days(p_from date, p_to date)
RETURNS TABLE (
  user_id uuid, day date, first_in timestamptz, last_out timestamptz, minutes integer, break_minutes integer,
  entries integer, methods text, corrected boolean, open boolean, shift_start time, shift_end time, late boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), e AS (
    SELECT te.user_id, (te.clock_in AT TIME ZONE tz.name)::date AS day, te.clock_in, te.clock_out, te.break_minutes, te.method, te.edited
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
           bool_or(e.clock_out IS NULL) AS open
    FROM e GROUP BY e.user_id, e.day
  ), sh AS (
    SELECT s.user_id, s.date, min(s.start_time) AS st, max(s.end_time) AS en
    FROM public.schedule_shifts s WHERE s.date BETWEEN p_from AND p_to
    GROUP BY s.user_id, s.date
  )
  SELECT a.user_id, a.day, a.fi, a.lo, a.mins, a.brk, a.n, a.methods, a.corrected, a.open, sh.st, sh.en,
         CASE WHEN sh.st IS NULL THEN false ELSE (a.fi AT TIME ZONE tz.name)::time > sh.st + interval '10 minutes' END
  FROM agg a CROSS JOIN tz
  LEFT JOIN sh ON sh.user_id = a.user_id AND sh.date = a.day
  ORDER BY a.user_id, a.day;
$$;
REVOKE ALL ON FUNCTION public.pay_days(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_days(date, date) TO authenticated;

-- ============================================================
-- pay_report: one row per (visible) active person for a period
-- ============================================================
CREATE OR REPLACE FUNCTION public.pay_report(p_from date, p_to date)
RETURNS TABLE (
  user_id uuid, full_name text, job_title text, role text, rate numeric, overtime_after_hours numeric, overtime_multiplier numeric,
  days_worked integer, worked_minutes integer, regular_minutes integer, overtime_minutes integer,
  gross numeric, deductions numeric, net numeric, late_count integer, absent_count integer, leave_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), d AS (
    SELECT * FROM public.pay_days(p_from, p_to)
  ), pp AS (
    SELECT p.id, p.full_name, p.job_title, p.role, p.hourly_rate, p.overtime_after_hours, p.overtime_multiplier
    FROM public.profiles p WHERE p.active
  ), wk AS (
    SELECT d.user_id, date_trunc('week', d.day::timestamp)::date AS w, sum(d.minutes)::numeric AS m
    FROM d GROUP BY d.user_id, date_trunc('week', d.day::timestamp)
  ), pay AS (
    SELECT pp.id,
           coalesce(sum(least(wk.m, pp.overtime_after_hours * 60)), 0) AS reg,
           coalesce(sum(greatest(0, wk.m - pp.overtime_after_hours * 60)), 0) AS ot
    FROM pp LEFT JOIN wk ON wk.user_id = pp.id GROUP BY pp.id
  ), g AS (
    SELECT pp.*, pay.reg, pay.ot,
           round(coalesce(pp.hourly_rate, 0) * pay.reg / 60 + coalesce(pp.hourly_rate, 0) * pp.overtime_multiplier * pay.ot / 60, 2) AS gross
    FROM pp JOIN pay ON pay.id = pp.id
  ), ded AS (
    SELECT g.id, coalesce(sum(
      CASE
        WHEN x.id IS NULL THEN 0
        WHEN x.type = 'percent' THEN round(g.gross * x.amount / 100, 2)
        WHEN x.recurring = 'once' THEN CASE WHEN x.start_date BETWEEN p_from AND p_to THEN x.amount ELSE 0 END
        WHEN x.recurring = 'weekly' THEN x.amount * (
          SELECT count(*) FROM generate_series(date_trunc('week', greatest(p_from, x.start_date)::timestamp),
                                               least(p_to, coalesce(x.end_date, p_to))::timestamp, interval '1 week'))
        ELSE x.amount * (
          SELECT count(*) FROM generate_series(date_trunc('month', greatest(p_from, x.start_date)::timestamp),
                                               least(p_to, coalesce(x.end_date, p_to))::timestamp, interval '1 month'))
      END), 0) AS amt
    FROM g
    LEFT JOIN public.deductions x ON (x.user_id = g.id OR x.user_id IS NULL)
      AND x.start_date <= p_to AND (x.end_date IS NULL OR x.end_date >= p_from)
    GROUP BY g.id
  ), lv AS (
    SELECT l.user_id, sum(least(l.end_date, p_to) - greatest(l.start_date, p_from) + 1)::int AS days
    FROM public.leave_requests l
    WHERE l.status = 'approved' AND l.start_date <= p_to AND l.end_date >= p_from
    GROUP BY l.user_id
  ), ab AS (
    -- planned days that are over, with no clock entry and no approved leave
    SELECT s.user_id, count(DISTINCT s.date)::int AS n
    FROM public.schedule_shifts s CROSS JOIN tz
    WHERE s.date BETWEEN p_from AND p_to AND s.date < (now() AT TIME ZONE tz.name)::date
      AND NOT EXISTS (SELECT 1 FROM d WHERE d.user_id = s.user_id AND d.day = s.date)
      AND NOT EXISTS (SELECT 1 FROM public.leave_requests l WHERE l.user_id = s.user_id AND l.status = 'approved' AND s.date BETWEEN l.start_date AND l.end_date)
    GROUP BY s.user_id
  )
  SELECT g.id, g.full_name, g.job_title, g.role, g.hourly_rate, g.overtime_after_hours, g.overtime_multiplier,
         coalesce((SELECT count(*) FROM d WHERE d.user_id = g.id), 0)::int,
         (g.reg + g.ot)::int, g.reg::int, g.ot::int,
         g.gross,
         CASE WHEN g.gross > 0 THEN least(ded.amt, g.gross) ELSE 0 END,
         g.gross - CASE WHEN g.gross > 0 THEN least(ded.amt, g.gross) ELSE 0 END,
         coalesce((SELECT count(*) FROM d WHERE d.user_id = g.id AND d.late), 0)::int,
         coalesce(ab.n, 0), coalesce(lv.days, 0)
  FROM g
  JOIN ded ON ded.id = g.id
  LEFT JOIN lv ON lv.user_id = g.id
  LEFT JOIN ab ON ab.user_id = g.id
  ORDER BY g.full_name;
$$;
REVOKE ALL ON FUNCTION public.pay_report(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_report(date, date) TO authenticated;
