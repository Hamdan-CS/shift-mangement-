-- ShiftClock · fix pay_report for people with no hours in the period.
-- least()/greatest() skip NULLs in Postgres, so least(NULL, 2400) gave 40 h to
-- someone who did not work. The week sum is now coalesced to 0 first.
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
           coalesce(sum(least(coalesce(wk.m, 0), pp.overtime_after_hours * 60)), 0) AS reg,
           coalesce(sum(greatest(0, coalesce(wk.m, 0) - pp.overtime_after_hours * 60)), 0) AS ot
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
