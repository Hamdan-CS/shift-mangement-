-- ShiftClock · Phase 1: members only.
-- Even if public sign-up is left on in Supabase Auth, a self-made account gets
-- no profile and sees nothing: profiles are only created for users whose
-- app_metadata.role was set by the service role (owner / seed script), and the
-- colleague list and settings need an active profile, not just a session.

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text := NEW.raw_app_meta_data ->> 'role';
  v_username text := lower(coalesce(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)));
BEGIN
  -- No role from the service role = not added by the owner: no profile, no access.
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'employee') THEN
    RETURN NEW;
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
REVOKE ALL ON FUNCTION private.handle_new_user() FROM public, anon, authenticated;

-- Colleague directory: only for people with an active profile.
CREATE OR REPLACE FUNCTION private.team_directory()
RETURNS TABLE (id uuid, username text, full_name text, avatar_url text, role text, job_title text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.role, p.job_title, p.active
  FROM public.profiles p
  WHERE private.current_profile_id() IS NOT NULL;
$$;

-- Settings: only for people with an active profile.
DROP POLICY IF EXISTS settings_select_authenticated ON public.settings;
DROP POLICY IF EXISTS settings_select_members ON public.settings;
CREATE POLICY settings_select_members ON public.settings
  FOR SELECT TO authenticated
  USING ((SELECT private.current_profile_id()) IS NOT NULL);
