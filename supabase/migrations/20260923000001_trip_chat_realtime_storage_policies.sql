-- Part 2 of the trip chat membership sync (see 20260923000000). Realtime topics
-- and chat media uploads: active members only. Kept apart because these tables
-- are not owned by postgres.

-- Realtime topics (realtime.messages): active members only. The user-inbox
-- branch is unchanged.
alter policy "messaging: read conversation topic" on realtime.messages
  using (((realtime.topic() ~~ 'messages:%'::text) and (exists (
            select 1 from public.conversation_members cm
            where cm.conversation_id = (nullif(split_part(realtime.topic(), ':'::text, 2), ''::text))::uuid
              and cm.user_id = auth.uid()
              and cm.left_at is null)))
         or (realtime.topic() = ('user-inbox:'::text || (auth.uid())::text)));

alter policy "messaging: write conversation topic" on realtime.messages
  with check ((realtime.topic() ~~ 'messages:%'::text) and (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = (nullif(split_part(realtime.topic(), ':'::text, 2), ''::text))::uuid
      and cm.user_id = auth.uid()
      and cm.left_at is null)));

alter policy "reactions: read conversation topic" on realtime.messages
  using ((realtime.topic() ~~ 'reactions:%'::text) and (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = (nullif(split_part(realtime.topic(), ':'::text, 2), ''::text))::uuid
      and cm.user_id = auth.uid()
      and cm.left_at is null)));

-- Storage: departed members cannot upload chat media any more. READ of
-- old media is unchanged on purpose (spec open question 2).
alter policy "Users can upload message images" on storage.objects
  with check ((bucket_id = 'message-images'::text) and (split_part(name, '/'::text, 1) in (
    select (conversation_members.conversation_id)::text as conversation_id
    from public.conversation_members
    where conversation_members.user_id = auth.uid()
      and conversation_members.left_at is null)));
