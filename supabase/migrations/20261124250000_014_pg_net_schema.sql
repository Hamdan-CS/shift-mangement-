-- ShiftClock · keep pg_net out of the public schema (security advisor 0014).
-- Its functions stay in the `net` schema, so private.email_tick() is unchanged.
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
