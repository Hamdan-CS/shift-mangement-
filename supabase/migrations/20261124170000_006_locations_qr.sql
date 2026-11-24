-- ShiftClock · Phase 4: locations + QR clock-in (PLAN.md section 7).
--   * locations: name, optional GPS circle, whether a printed (static) QR is
--     allowed. Each has a qr_secret that NO app user can read (column grants);
--     only the `clock` Edge Function (service role) uses it to make and check codes.
--   * QR entries (method 'qr') can only be written by the service role, so a
--     phone can't fake a scan through the API.
--   * settings.allow_button_clock: when false, staff must scan the QR to clock
--     in or out (managers can still fix entries).

CREATE TABLE IF NOT EXISTS public.locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  qr_secret    text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  lat          double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng          double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  radius_m     integer CHECK (radius_m IS NULL OR radius_m BETWEEN 20 AND 5000),
  allow_static boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_lat_lng_together CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT locations_radius_needs_point CHECK (radius_m IS NULL OR lat IS NOT NULL)
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locations FROM anon, authenticated;
-- every column except qr_secret
GRANT SELECT (id, name, lat, lng, radius_m, allow_static, active, created_at) ON public.locations TO authenticated;
GRANT INSERT (name, lat, lng, radius_m, allow_static, active) ON public.locations TO authenticated;
GRANT UPDATE (name, lat, lng, radius_m, allow_static, active) ON public.locations TO authenticated;
GRANT DELETE ON public.locations TO authenticated;

DROP POLICY IF EXISTS locations_select ON public.locations;
CREATE POLICY locations_select ON public.locations FOR SELECT TO authenticated
  USING ((SELECT private.current_profile_id()) IS NOT NULL);
DROP POLICY IF EXISTS locations_insert ON public.locations;
CREATE POLICY locations_insert ON public.locations FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_owner()));
DROP POLICY IF EXISTS locations_update ON public.locations;
CREATE POLICY locations_update ON public.locations FOR UPDATE TO authenticated
  USING ((SELECT private.is_owner())) WITH CHECK ((SELECT private.is_owner()));
DROP POLICY IF EXISTS locations_delete ON public.locations;
CREATE POLICY locations_delete ON public.locations FOR DELETE TO authenticated
  USING ((SELECT private.is_owner()));

-- time_entries.location_id now points at a location
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entries_location_id_fkey;
ALTER TABLE public.time_entries ADD CONSTRAINT time_entries_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES public.locations (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS time_entries_location ON public.time_entries (location_id);

-- "Clock in only at the workplace?" (PLAN.md 13, question 6)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS allow_button_clock boolean NOT NULL DEFAULT true;

-- Clock guard, updated: button clocking can be switched off for staff.
CREATE OR REPLACE FUNCTION private.time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mgr boolean;
  v_is_clock_out boolean;
  v_button_ok boolean;
BEGIN
  -- Service role (QR Edge Function, cron auto clock-out, seed): trusted as sent.
  IF v_uid IS NULL THEN
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
      RETURN NEW;
    END IF;
    IF v_mgr THEN
      NEW.method := 'manual';
      NEW.edited := true;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You can only start your own shift' USING ERRCODE = '42501';
  END IF;

  -- UPDATE
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
    RETURN NEW;
  END IF;

  IF v_mgr THEN
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    NEW.edited := true;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a manager can change clock times. Ask for a correction instead.' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.time_entries_guard() FROM public, anon, authenticated;
