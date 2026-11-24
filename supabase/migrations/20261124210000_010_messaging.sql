-- ShiftClock · Phase 6: messaging (PLAN.md sections 1, 3, 12). Same model as
-- Webloop's conversations / conversation_members / messages (migrations 004,
-- 028), cut down to two kinds:
--   * team:   one "Team" group chat; every active person is a member automatically
--   * direct: a 1-to-1 chat between two active people (e.g. DM the manager)
-- Rules: only members read or write a conversation; you can only send as
-- yourself; a new message pings each other member's private channel
-- "user:<id>" (event 'message', no content) so lists and badges update live.

CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('team', 'direct')),
  title           text,
  direct_key      text UNIQUE,                   -- "<smaller uuid>:<larger uuid>" for direct chats
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_team ON public.conversations (kind) WHERE kind = 'team';

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  muted           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user ON public.conversation_members (user_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender ON public.messages (sender_id);

-- ---------- membership helper ----------
CREATE OR REPLACE FUNCTION private.is_member(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = p_conversation AND m.user_id = auth.uid()
  ) AND private.current_profile_id() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.is_member(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_member(uuid) TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations, public.conversation_members, public.messages FROM anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT ON public.conversation_members TO authenticated;
GRANT UPDATE (last_read_at, muted) ON public.conversation_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT TO authenticated USING ((SELECT private.is_member(id)));
DROP POLICY IF EXISTS members_select ON public.conversation_members;
CREATE POLICY members_select ON public.conversation_members FOR SELECT TO authenticated USING ((SELECT private.is_member(conversation_id)));
DROP POLICY IF EXISTS members_update_own ON public.conversation_members;
CREATE POLICY members_update_own ON public.conversation_members FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING ((SELECT private.is_member(conversation_id)));
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND (SELECT private.is_member(conversation_id)));
DROP POLICY IF EXISTS messages_delete_own ON public.messages;
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO authenticated USING (sender_id = (SELECT auth.uid()));

-- ---------- new message: stamp time, bump conversation, ping members ----------
CREATE OR REPLACE FUNCTION private.messages_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.created_at := now();
  NEW.body := btrim(NEW.body);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.messages_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  -- the sender has read their own message
  UPDATE public.conversation_members SET last_read_at = NEW.created_at
  WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;
  FOR r IN SELECT m.user_id FROM public.conversation_members m
           WHERE m.conversation_id = NEW.conversation_id AND m.user_id IS DISTINCT FROM NEW.sender_id LOOP
    BEGIN
      PERFORM realtime.send(jsonb_build_object('conversation_id', NEW.conversation_id), 'message', 'user:' || r.user_id::text, true);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.messages_before(), private.messages_after() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS messages_before ON public.messages;
CREATE TRIGGER messages_before BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.messages_before();
DROP TRIGGER IF EXISTS messages_after ON public.messages;
CREATE TRIGGER messages_after AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.messages_after();

-- ---------- the Team chat: everyone active is in it ----------
INSERT INTO public.conversations (kind, title) SELECT 'team', 'Team'
WHERE NOT EXISTS (SELECT 1 FROM public.conversations WHERE kind = 'team');
INSERT INTO public.conversation_members (conversation_id, user_id)
SELECT c.id, p.id FROM public.conversations c CROSS JOIN public.profiles p
WHERE c.kind = 'team' AND p.active
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.team_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_team uuid := (SELECT c.id FROM public.conversations c WHERE c.kind = 'team' LIMIT 1);
BEGIN
  IF v_team IS NULL THEN RETURN NULL; END IF;
  IF NEW.active THEN
    INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (v_team, NEW.id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.conversation_members WHERE conversation_id = v_team AND user_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.team_membership() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS team_membership ON public.profiles;
CREATE TRIGGER team_membership AFTER INSERT OR UPDATE OF active ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.team_membership();

-- ---------- start (or reopen) a 1-to-1 chat ----------
-- The one function the app calls directly: it needs to add the other person.
CREATE OR REPLACE FUNCTION public.start_direct_chat(p_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
BEGIN
  IF v_me IS NULL OR private.current_profile_id() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_me OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_other AND p.active) THEN
    RAISE EXCEPTION 'Pick someone on the team' USING ERRCODE = '22023';
  END IF;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  SELECT c.id INTO v_id FROM public.conversations c WHERE c.direct_key = v_key;
  IF v_id IS NULL THEN
    INSERT INTO public.conversations (kind, direct_key) VALUES ('direct', v_key)
    ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (v_id, v_me), (v_id, p_other) ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_direct_chat(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_direct_chat(uuid) TO authenticated;

-- ---------- my conversations: last message + unread count ----------
CREATE OR REPLACE FUNCTION private.my_conversations()
RETURNS TABLE (
  conversation_id uuid, kind text, title text, other_id uuid, member_count integer,
  last_body text, last_sender_id uuid, last_at timestamptz, unread integer, muted boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.kind, c.title,
         (SELECT m2.user_id FROM public.conversation_members m2 WHERE m2.conversation_id = c.id AND m2.user_id <> auth.uid() AND c.kind = 'direct' LIMIT 1),
         (SELECT count(*)::int FROM public.conversation_members m3 WHERE m3.conversation_id = c.id),
         lm.body, lm.sender_id, lm.created_at,
         (SELECT count(*)::int FROM public.messages x WHERE x.conversation_id = c.id AND x.created_at > me.last_read_at AND x.sender_id IS DISTINCT FROM auth.uid()),
         me.muted
  FROM public.conversation_members me
  JOIN public.conversations c ON c.id = me.conversation_id
  LEFT JOIN LATERAL (
    SELECT x.body, x.sender_id, x.created_at FROM public.messages x
    WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1
  ) lm ON true
  WHERE me.user_id = auth.uid() AND private.current_profile_id() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.my_conversations() FROM public, anon;
GRANT EXECUTE ON FUNCTION private.my_conversations() TO authenticated;

DROP VIEW IF EXISTS public.my_conversations;
CREATE VIEW public.my_conversations WITH (security_invoker = true) AS SELECT * FROM private.my_conversations();
REVOKE ALL ON public.my_conversations FROM public, anon;
GRANT SELECT ON public.my_conversations TO authenticated;
