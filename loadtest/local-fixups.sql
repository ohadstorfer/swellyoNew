-- loadtest/local-fixups.sql
--
-- Run on the LOCAL copy right after the schema is loaded (load.sh does it),
-- as supabase_admin. It does three things:
--   1. Makes sure nothing in the local DB can call the real project.
--   2. Adds what a schema-only dump of `public` leaves out but the app needs
--      (Realtime Authorization policies, role timeouts).
--   3. Stops if any trace of the production URL is still there.

\set ON_ERROR_STOP on

-- 1a. Drop every database webhook trigger (supabase_functions.http_request).
--     In production these POST to edge functions with a secret header.
--     prepare-schema.sh already strips them; this is the second lock.
do $$
declare r record;
begin
  for r in
    select t.tgname, c.oid::regclass as tbl
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal and n.nspname = 'supabase_functions'
  loop
    execute format('drop trigger %I on %s', r.tgname, r.tbl);
    raise notice 'dropped webhook trigger % on %', r.tgname, r.tbl;
  end loop;
end $$;

-- 1b. No cron jobs locally (prod crons call edge functions through pg_net).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job;
  end if;
end $$;

-- 2a. Realtime Authorization policies (copied from production, read-only,
--     21 Oct 2026). A dump of `public` does not include them, and without
--     them private-topic broadcasts get 403 locally.
--     Created only when missing, so running this file again does not undo
--     the RLS rollback (these 4 are part of the 81 policies it changes).
do $$
declare
  member_check constant text :=
    'exists (select 1 from public.conversation_members cm
       where cm.conversation_id = (nullif(split_part(realtime.topic(), '':'', 2), ''''))::uuid
         and cm.user_id = (select auth.uid()) and cm.left_at is null)';
begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'messaging: read conversation topic') then
    execute format($p$create policy "messaging: read conversation topic" on realtime.messages
      for select to authenticated
      using (((realtime.topic() ~~ 'messages:%%') and %s)
             or (realtime.topic() = ('user-inbox:' || ((select auth.uid()))::text)))$p$, member_check);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'messaging: write conversation topic') then
    execute format($p$create policy "messaging: write conversation topic" on realtime.messages
      for insert to authenticated
      with check ((realtime.topic() ~~ 'messages:%%') and %s)$p$, member_check);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'reactions: read conversation topic') then
    execute format($p$create policy "reactions: read conversation topic" on realtime.messages
      for select to authenticated
      using ((realtime.topic() ~~ 'reactions:%%') and %s)$p$, member_check);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'trips: read trip topics') then
    create policy "trips: read trip topics" on realtime.messages
      for select to authenticated
      using (
        realtime.topic() = 'trips-list'
        or realtime.topic() ~~ 'trip:%'
        or realtime.topic() = ('user-trips:' || ((select auth.uid()))::text)
        or realtime.topic() = ('trips-mine:' || ((select auth.uid()))::text)
      );
  end if;
end $$;

-- 2b. Role timeouts, same as production (read from pg_roles on 21 Oct 2026).
alter role authenticated set statement_timeout = '8s';
alter role anon          set statement_timeout = '3s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';

-- 3. Hard stop if the production project is still referenced anywhere.
do $$
declare n int;
begin
  select count(*) into n from pg_proc
   where prosrc ilike '%rfdhtvcmagsbxqntnepv%';
  select n + count(*) into n from pg_trigger
   where encode(tgargs, 'escape') ilike '%rfdhtvcmagsbxqntnepv%';
  if n > 0 then
    raise exception 'local-fixups: % objects still point at the production project. Do not run the load test.', n;
  end if;
  raise notice 'local-fixups: OK - no reference to the production project left.';
end $$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
