-- ============================================================================
-- Give "your document was sent back" something readable to say.
--
-- Most of this notification already worked before this migration:
--   • the `operator_document_rejected` enum value exists
--   • `operator_reject_document` already inserts the notifications row
--   • `notification_push_priority` already returns 0 for it (push, urgent)
--
-- The one gap: the row's `data` carried only `requirement_id` and `note`, so
-- neither the bell nor the push had a name to show. `requirement_id` is a uuid,
-- and nobody can read "your 3f2a-… was sent back". This adds
-- `requirement_title` and `trip_title`.
--
-- ⚠️ DO NOT "restore" notification_push_priority from the repo. The live
-- function is AHEAD of every migration file here: it carries trip_invite_*,
-- operator_requirement_* and operator_document_rejected cases that exist in no
-- repo migration, and it is NOT the flattened all-urgent shape that
-- 20260611000000 last wrote. A create-or-replace from any repo copy silently
-- demotes five live types to feed-only. Verified against prod 2026-07-30.
--
-- Deliberately NOT added: a notification when a document is APPROVED. The
-- approve RPC writes no row and stays that way — an operator clearing a queue
-- of eight passports would otherwise fire eight pushes (Ohad, 30 Jul).
-- ============================================================================

-- Byte-identical to the live body (verified 2026-07-30) apart from the two
-- lookups and the two new `data` keys.
create or replace function public.operator_reject_document(
  p_document_id uuid,
  p_note        text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  d           record;
  v_req_title text;
  v_trip      text;
begin
  select * into d from public.organized_trip_travelers_documents where id = p_document_id;
  if d is null then raise exception 'document not found'; end if;
  if not public.is_trip_host(d.trip_id) then raise exception 'not your trip'; end if;

  update public.organized_trip_travelers_documents
     set rejected_at      = now(),
         approved_at      = null,
         approved_by      = null,
         approbation_note = nullif(p_note, '')
   where id = p_document_id;

  select r.title into v_req_title
    from public.organized_trip_requirements r
   where r.id = d.requirement_id;

  select t.title into v_trip
    from public.group_trips t
   where t.id = d.trip_id;

  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (d.user_id, d.trip_id, 'operator_document_rejected', 'user', auth.uid(),
          'organized_trip_travelers_document', d.id,
          jsonb_build_object('requirement_id',    d.requirement_id,
                             'requirement_title', v_req_title,
                             'trip_title',        v_trip,
                             'note',              nullif(p_note, '')));
end $$;

-- CREATE OR REPLACE preserves the existing ACL (only DROP + CREATE resets it to
-- PUBLIC EXECUTE), so this is belt-and-braces rather than a fix. Stated
-- explicitly so the next person does not have to go and check.
-- Live ACL before this migration: postgres, authenticated, service_role.
revoke execute on function public.operator_reject_document(uuid, text) from public, anon;
grant  execute on function public.operator_reject_document(uuid, text) to authenticated;
