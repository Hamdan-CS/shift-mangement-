-- ShiftClock · Phase 1 hardening (Supabase security advisor).
-- RLS helpers, trigger functions and the colleague directory move to a
-- `private` schema that the REST API does not expose, so none of them are
-- callable as /rest/v1/rpc/*. `profiles_public` becomes a SECURITY INVOKER view
-- over a private definer function. Same rules as 001: colleagues see names,
-- roles and job titles, never pay.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid() AND p.active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id FROM public.profiles p WHERE p.id = auth.uid() AND p.active LIMIT 1;
$$;

-- Owner only.
CREATE OR REPLACE FUNCTION private.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(private.current_app_role() = 'owner', false);
$$;

-- Manager or owner (PLAN.md section 4).
CREATE OR REPLACE FUNCTION private.is_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(private.current_app_role() IN ('owner', 'manager'), false);
$$;

-- Webloop's name, kept for the copied messaging / notification policies.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.is_manager();
$$;

-- Colleague directory: safe columns only, signed-in users only.
CREATE OR REPLACE FUNCTION private.team_directory()
RETURNS TABLE (id uuid, username text, full_name text, avatar_url text, role text, job_title text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.role, p.job_title, p.active
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM public, anon;
GRANT EXECUTE ON FUNCTION private.current_app_role(), private.current_profile_id(), private.is_owner(), private.is_manager(), private.is_admin(), private.team_directory() TO authenticated;

-- ---------- policies now use the private helpers ----------
DROP POLICY IF EXISTS profiles_select_own_or_manager ON public.profiles;
CREATE POLICY profiles_select_own_or_manager ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_manager()));

DROP POLICY IF EXISTS profiles_update_own_or_owner ON public.profiles;
CREATE POLICY profiles_update_own_or_owner ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_owner()))
  WITH CHECK (id = (SELECT auth.uid()) OR (SELECT private.is_owner()));

DROP POLICY IF EXISTS profiles_insert_owner ON public.profiles;
CREATE POLICY profiles_insert_owner ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_owner()));

DROP POLICY IF EXISTS profiles_delete_owner ON public.profiles;
CREATE POLICY profiles_delete_owner ON public.profiles
  FOR DELETE TO authenticated
  USING ((SELECT private.is_owner()) AND id <> (SELECT auth.uid()));

DROP POLICY IF EXISTS settings_update_owner ON public.settings;
CREATE POLICY settings_update_owner ON public.settings
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_owner()))
  WITH CHECK ((SELECT private.is_owner()));

-- ---------- trigger functions (not callable by anyone, only fired) ----------
CREATE OR REPLACE FUNCTION private.profiles_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Non-owners may only change their name, avatar and notification email.
  IF auth.uid() IS NOT NULL AND NOT private.is_owner() THEN
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
  FOR EACH ROW EXECUTE FUNCTION private.profiles_guard_update();

-- New auth user -> profile. Role comes from app_metadata (service role only).
CREATE OR REPLACE FUNCTION private.handle_new_user()
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
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_touch ON public.settings;
CREATE TRIGGER settings_touch
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

REVOKE ALL ON FUNCTION private.profiles_guard_update(), private.handle_new_user(), private.touch_updated_at() FROM public, anon, authenticated;

-- ---------- colleague view: SECURITY INVOKER over the private directory ----------
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public
WITH (security_invoker = true)
AS
  SELECT * FROM private.team_directory();

REVOKE ALL ON public.profiles_public FROM public, anon;
GRANT SELECT ON public.profiles_public TO authenticated;

-- ---------- drop the old public-schema copies ----------
DROP FUNCTION IF EXISTS public.profiles_guard_update();
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.touch_updated_at();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_manager();
DROP FUNCTION IF EXISTS public.is_owner();
DROP FUNCTION IF EXISTS public.current_profile_id();
DROP FUNCTION IF EXISTS public.current_app_role();
