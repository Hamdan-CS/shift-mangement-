-- ShiftClock · Phase 5 fix: deciding a leave request failed with
-- 'record "old" has no field "applied_entry_id"' because the shared after-trigger
-- read a corrections-only column for leave rows too. Same function, nested check.
CREATE OR REPLACE FUNCTION private.requests_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_kind text := CASE WHEN TG_TABLE_NAME = 'corrections' THEN 'correction' ELSE 'leave' END;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object('kind', v_kind, 'request_id', NEW.id, 'employee_name', private.full_name(NEW.user_id));
    PERFORM private.notify_managers(CASE WHEN v_kind = 'correction' THEN 'correction.requested' ELSE 'leave.requested' END, v_payload, NEW.user_id);
    RETURN NEW;
  END IF;
  -- Undo of an approved "missing shift": remove the entry it created
  -- (nested: leave_requests has no applied_entry_id column, so don't touch it there)
  IF v_kind = 'correction' THEN
    IF OLD.status = 'approved' AND NEW.status = 'pending' AND OLD.applied_entry_id IS NOT NULL THEN
      DELETE FROM public.time_entries WHERE id = OLD.applied_entry_id;
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM private.audit(v_kind || '.' || CASE WHEN NEW.status = 'pending' THEN 'reopened' ELSE NEW.status END, v_kind, NEW.id,
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status, 'note', NEW.review_note));
    IF NEW.status IN ('approved', 'declined') THEN
      PERFORM private.notify(NEW.user_id, 'request.' || NEW.status,
        jsonb_build_object('kind', v_kind, 'request_id', NEW.id, 'review_note', NEW.review_note, 'reviewer_name', private.full_name(NEW.reviewed_by)));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.requests_after() FROM public, anon, authenticated;
