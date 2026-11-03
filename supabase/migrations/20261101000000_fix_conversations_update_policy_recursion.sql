-- Fix: every client UPDATE on public.conversations fails with
--   42P17 infinite recursion detected in policy for relation "conversations"
--
-- Seen in prod on 2026-10-28 and 2026-10-30 (PATCH /rest/v1/conversations ->
-- 500, 64 of 64 in one 30-minute window). The EXPLAIN at the bottom of this
-- file reproduced 42P17 on the live database on 2026-11-01.
--
-- The loop (live definitions read on 2026-11-01, unchanged since 10-28):
--   conversations_update_admin_or_creator (USING + WITH CHECK)
--     -> EXISTS (select from conversation_members ...)
--        -> conversation_members_select
--           -> EXISTS (select from conversations c where c.created_by = auth.uid())
--              -> conversations again
-- Postgres expands RLS per relation, not per command, so it sees
-- conversations inside its own policy and stops at rewrite time. That is
-- why it fails for EVERY caller, the creator and owners included (so group
-- renames from the app fail too, not only the updated_at touch).
--
-- Fix: move the owner/admin check into a SECURITY DEFINER helper. The
-- planner does not look inside a function, so the loop is gone. Same pattern
-- as was_conversation_member() / is_conversation_member().
--
-- Access does not change: the helper has exactly the old EXISTS rule (active
-- 'owner'/'admin' row of the caller). It only answers for auth.uid(), so it
-- cannot be used to ask about another user's role.

begin;

create or replace function public.is_conversation_admin(conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv
      and cm.user_id = (select auth.uid())
      and cm.role = any (array['owner'::text, 'admin'::text])
      and cm.left_at is null
  );
$function$;

-- Creating a function grants EXECUTE to PUBLIC. Lock it to the roles that
-- need it (same ACL as the other conversation helpers). RLS helpers must keep
-- an explicit grant to authenticated, or the policy fails with 42501.
revoke execute on function public.is_conversation_admin(uuid) from public, anon;
grant execute on function public.is_conversation_admin(uuid) to authenticated, service_role;

-- live:
--   ((created_by = (select auth.uid())) or (exists (select 1 from conversation_members cm
--     where cm.conversation_id = conversations.id and cm.user_id = (select auth.uid())
--       and cm.role = any (array['owner','admin']) and cm.left_at is null)))
alter policy conversations_update_admin_or_creator on public.conversations
  using ((created_by = (select auth.uid())) or public.is_conversation_admin(id))
  with check ((created_by = (select auth.uid())) or public.is_conversation_admin(id));

commit;

-- Verify (read-only, run after applying). Before the fix this raised 42P17;
-- after it, it prints a plan:
--
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
--   explain update public.conversations set updated_at = now()
--     where id = '00000000-0000-0000-0000-000000000000';
--   rollback;
--
--   select proacl from pg_proc where proname = 'is_conversation_admin';
--   -- expect: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
