-- ShiftClock · each person's preferred schedule view (Day / Week / Month).
-- Set in My settings, and remembered when they switch on the schedule page.
-- Not a guarded field (profiles_guard_update), so everyone can change their own.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS schedule_view text NOT NULL DEFAULT 'week'
  CHECK (schedule_view IN ('day', 'week', 'month'));
