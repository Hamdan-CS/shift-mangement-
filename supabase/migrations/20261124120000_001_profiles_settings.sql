-- ShiftClock · Phase 1: profiles (3 roles, username login) + single-row settings.
-- RLS is the real gate (PLAN.md section 4): employees see each other's names,
-- roles and job titles, never pay; managers read everyone; only the owner edits
-- roles, rates and settings.

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                   uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username             text NOT NULL,
  full_name            text NOT NULL DEFAULT '',
  avatar_url           text,
  notify_email         text,
  role                 text NOT NULL DEFAULT 'employee' CHECK (role IN ('owner', 'manager', 'employee')),
  job_title            text,
  hourly_rate          numeric(10, 2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  overtime_after_hours numeric NOT NULL DEFAULT 40 CHECK (overtime_after_hours >= 0),
  overtime_multiplier  numeric NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier >= 1),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (lower(username));
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role) WHERE active;

-- ============================================================
-- RLS helpers (pattern from Webloop migration 021; profiles.id = auth.uid())
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id FROM public.profiles p WHERE p.id = auth.uid() AND p.active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid() AND p.active LIMIT 1;
$$;

-- Owner only.
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.current_app_role() = 'owner', false);
$$;

-- Manager or owner: approves, edits schedules, reads team data (PLAN.md section 4).
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.current_app_role() IN ('owner', 'manager'), false);
$$;

-- Webloop name kept so copied policies keep working.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_manager();
$$;

REVOKE ALL ON FUNCTION public.current_profile_id(), public.current_app_role(), public.is_owner(), public.is_manager(), public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_id(), public.current_app_role(), public.is_owner(), public.is_manager(), public.is_admin() TO authenticated;

-- ============================================================
-- profiles: policies
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

-- Full rows (with pay): your own, or anyone's if you are a manager / owner.
DROP POLICY IF EXISTS profiles_select_own_or_manager ON public.profiles;
CREATE POLICY profiles_select_own_or_manager ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_manager());

-- Update your own row (limited by the guard trigger below), or any row as owner.
DROP POLICY IF EXISTS profiles_update_own_or_owner ON public.profiles;
CREATE POLICY profiles_update_own_or_owner ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_owner())
  WITH CHECK (id = auth.uid() OR public.is_owner());

-- Only the owner adds or removes people (normally via the admin API / seed).
DROP POLICY IF EXISTS profiles_insert_owner ON public.profiles;
CREATE POLICY profiles_insert_owner ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS profiles_delete_owner ON public.profiles;
CREATE POLICY profiles_delete_owner ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_owner() AND id <> auth.uid());

-- Non-owners may only change their name, avatar and notification email.
-- Role, username, pay and active can only be changed by the owner (or the service role).
CREATE OR REPLACE FUNCTION public.profiles_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate
       OR NEW.overtime_after_hours IS DISTINCT FROM OLD.overtime_after_hours
       OR NEW.overtime_multiplier IS DISTINCT FROM OLD.overtime_multiplier
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.job_title IS DISTINCT FROM OLD.job_title THEN
      RAISE EXCEPTION 'Only the owner can change role, username, job title, pay or active status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Never leave the company without an active owner.
  IF OLD.role = 'owner' AND OLD.active AND (NEW.role <> 'owner' OR NOT NEW.active) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.role = 'owner' AND p.active AND p.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'There must always be at least one active owner' USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_update ON public.profiles;
CREATE TRIGGER profiles_guard_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_update();

-- ============================================================
-- profiles_public: what every signed-in person may see about colleagues.
-- A definer view (runs as its owner, so it skips the row policy above) that
-- only exposes safe columns: no rate, overtime or notify email.
-- ============================================================
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = false, security_barrier = true)
AS
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.role, p.job_title, p.active
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL;

REVOKE ALL ON public.profiles_public FROM public, anon;
GRANT SELECT ON public.profiles_public TO authenticated;

-- ============================================================
-- New auth user -> profile.
-- Role comes from app_metadata, which only the service role can set
-- (user_metadata is writable by the user, so it is never trusted for role).
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text := coalesce(NEW.raw_app_meta_data ->> 'role', 'employee');
  v_username text := lower(coalesce(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)));
BEGIN
  IF v_role NOT IN ('owner', 'manager', 'employee') THEN
    v_role := 'employee';
  END IF;

  INSERT INTO public.profiles (id, username, full_name, role, job_title, notify_email)
  VALUES (
    NEW.id,
    v_username,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', v_username),
    v_role,
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'notify_email'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- settings (single row, id = 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name           text NOT NULL DEFAULT 'My company',
  currency               text NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone               text NOT NULL DEFAULT 'Europe/Warsaw',
  schedule_deadline_dow  smallint NOT NULL DEFAULT 4 CHECK (schedule_deadline_dow BETWEEN 0 AND 6), -- 4 = Thursday
  schedule_deadline_time time NOT NULL DEFAULT '18:00',
  daily_email_time       time NOT NULL DEFAULT '23:00',
  auto_clockout_hours    smallint NOT NULL DEFAULT 14 CHECK (auto_clockout_hours BETWEEN 1 AND 24),
  report_recipients      text[] NOT NULL DEFAULT '{}',
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settings FROM anon;
GRANT SELECT, UPDATE ON public.settings TO authenticated;

-- Everyone signed in reads company name, currency, timezone.
DROP POLICY IF EXISTS settings_select_authenticated ON public.settings;
CREATE POLICY settings_select_authenticated ON public.settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS settings_update_owner ON public.settings;
CREATE POLICY settings_update_owner ON public.settings
  FOR UPDATE TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_touch ON public.settings;
CREATE TRIGGER settings_touch
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Working day shown on the Today timeline (PLAN.md 10b). '24:00' is a valid time in Postgres.
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS day_start time NOT NULL DEFAULT '06:00';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS day_end time NOT NULL DEFAULT '24:00';
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_day_range;
ALTER TABLE public.settings ADD CONSTRAINT settings_day_range CHECK (day_end > day_start);
