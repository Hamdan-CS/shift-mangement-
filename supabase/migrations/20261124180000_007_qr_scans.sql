-- ShiftClock · Phase 4: remember recent QR scans so a camera that opens the
-- link twice doesn't clock someone in and straight back out.
-- Only the `clock` Edge Function (service role) reads or writes this table:
-- RLS is on with no policies, and app roles have no grants.

CREATE TABLE IF NOT EXISTS public.qr_scans (
  user_id    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  token      text NOT NULL,
  location_id uuid REFERENCES public.locations (id) ON DELETE CASCADE,
  result     text NOT NULL CHECK (result IN ('pending', 'in', 'out')),  -- 'pending' = claimed, being handled
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);
CREATE INDEX IF NOT EXISTS qr_scans_at ON public.qr_scans (at);
CREATE INDEX IF NOT EXISTS qr_scans_location ON public.qr_scans (location_id);

ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qr_scans FROM public, anon, authenticated;
