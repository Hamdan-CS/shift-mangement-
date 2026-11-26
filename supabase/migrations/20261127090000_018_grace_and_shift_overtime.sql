-- 018 · Pay rules from the café owner:
--   1. Late by 30 minutes or less → paid from the shift start (the late minutes are forgiven).
--      Later than that → paid from the real clock-in.
--   2. Time worked after the planned shift end is overtime (paid at the person's overtime rate),
--      on top of the existing weekly rule (hours over overtime_after_hours a week).
-- pay_days gets two new columns (grace_minutes, overtime_minutes); `minutes` is now the paid
-- minutes (worked + grace). pay_report uses both. Days without a planned shift work as before.

DROP FUNCTION IF EXISTS public.pay_report(date, date);
DROP FUNCTION IF EXISTS public.pay_days(date, date);

CREATE FUNCTION public.pay_days(p_from date, p_to date)
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

REVOKE ALL ON FUNCTION public.pay_days(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_days(date, date) TO authenticated, service_role;

CREATE FUNCTION public.pay_report(p_from date, p_to date)
RETURNS TABLE(user_id uuid, full_name text, job_title text, role text, rate numeric, overtime_after_hours numeric, overtime_multiplier numeric,
              days_worked integer, worked_minutes integer, regular_minutes integer, overtime_minutes integer, gross numeric, deductions numeric,
              net numeric, late_count integer, absent_count integer, leave_days integer)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH tz AS (
    SELECT coalesce((SELECT s.timezone FROM public.settings s WHERE s.id = 1), 'UTC') AS name
  ), d AS (
    SELECT * FROM public.pay_days(p_from, p_to)
  ), pp AS (
    SELECT p.id, p.full_name, p.job_title, p.role, p.hourly_rate, p.overtime_after_hours, p.overtime_multiplier
    FROM public.profiles p WHERE p.active
  ), wk AS (
    -- per week: minutes inside the planned shifts (m) and minutes after the shift end (dot)
    SELECT d.user_id, date_trunc('week', d.day::timestamp)::date AS w,
           sum(d.minutes - d.overtime_minutes)::numeric AS m, sum(d.overtime_minutes)::numeric AS dot
    FROM d GROUP BY d.user_id, date_trunc('week', d.day::timestamp)
  ), pay AS (
    SELECT pp.id,
           coalesce(sum(least(coalesce(wk.m, 0), pp.overtime_after_hours * 60)), 0) AS reg,
           coalesce(sum(greatest(0, coalesce(wk.m, 0) - pp.overtime_after_hours * 60) + coalesce(wk.dot, 0)), 0) AS ot
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
$function$;

REVOKE ALL ON FUNCTION public.pay_report(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_report(date, date) TO authenticated, service_role;
