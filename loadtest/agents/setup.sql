-- loadtest/agents/setup.sql
--
-- Adds 15 fake travelers ("agents") to the real operator trip "El Salvador 26"
-- in PRODUCTION. Spec: loadtest/AGENTS_TEST_SPEC.md, section A.
--
-- Run it ONCE through the Supabase SQL editor or the MCP (it runs as the
-- service role, so auth.uid() is null and the trip triggers trust it).
-- Running it again is safe: every write is "insert if missing".
--
-- What it does, all in ONE transaction (the DO block):
--   1. refuses to run unless the trip id + title match
--   2. 15 auth.users rows (fixed ids, agentNN@loadtest.invalid, no usable
--      password) -> handle_new_auth_user makes the public.users rows
--   3. 15 surfers rows with is_demo_user = true and no push token
--   4. max_participants -> 25 (old value is printed in the summary)
--   5. 15 group_trip_participants rows, role member, status active, with
--      trg_member_joined OFF so nobody gets "X joined" notifications
--   6. checks all 15 are in the trip chat; calls sync_trip_chat_members once
--      if not; stops if they are still missing
--   7. mutes the trip chat for 24 hours for the people in v_muted (for now:
--      Jake and Moshe, so they get no pushes from the test). Same field the
--      app's "Mute" writes (conversation_members.preferences.muted_until);
--      send-push-notification skips muted members. It ends by itself after
--      24 h. To undo it earlier, run:
--        update public.conversation_members
--           set preferences = preferences - 'muted_until'
--         where conversation_id = '5c88d382-39f9-4515-8c94-67137e722f89'
--           and user_id in ('d64eb3c7-a6d4-4523-91b8-8441fc0d1822',
--                           '58d118be-ca84-452c-8fce-b3c4771427b2');
-- Then a SELECT prints the summary.
--
-- No payments, waivers or personal info are faked (the ledger alarm watches
-- payment events). Nothing is ever deleted.
--
-- The agent ids follow one pattern so run-agents.sh and agents-chat.js can
-- rebuild them: 10ad7e57-0000-4000-8000-0000000000NN, NN = 01..15.
--
-- Note: ALTER TABLE ... DISABLE TRIGGER takes a short exclusive lock on
-- group_trip_participants (milliseconds; the whole block is one statement).

do $$
declare
  -- ===================================================================
  -- AGENT NAMES — still an open question (spec, open question 2).
  -- Change them here only. Order = agent01 .. agent15.
  -- ===================================================================
  v_names text[] := array[
    'Kai', 'Lucía', 'Mateo', 'Inés', 'Noah',
    'Maya', 'Tomás', 'Leilani', 'Finn', 'Sofía',
    'Hugo', 'Ana', 'Jonah', 'Camila', 'Rafa'
  ];
  -- ===================================================================

  -- Real chat members to keep OUT of the test (no pushes). For now: Jake, Moshe.
  v_muted uuid[] := array[
    'd64eb3c7-a6d4-4523-91b8-8441fc0d1822',   -- Jake Glaser (co_operator)
    '58d118be-ca84-452c-8fce-b3c4771427b2'    -- Moshe Benyamin (co_operator)
  ]::uuid[];

  c_trip   constant uuid := '5c042bf4-18af-496c-a3e1-262bfa0a3efc';
  c_title  constant text := 'El Salvador 26';
  c_cap    constant int  := 25;

  v_ages      int[]  := array[27, 31, 24, 29, 35, 26, 33, 28, 30, 25, 38, 27, 32, 23, 34];
  v_countries text[] := array['United States', 'Argentina', 'Spain', 'France', 'Australia',
                              'Israel', 'Argentina', 'United States', 'Ireland', 'Mexico',
                              'Germany', 'Portugal', 'United States', 'Brazil', 'Spain'];
  v_tz        text[] := array['America/Los_Angeles', 'America/Argentina/Buenos_Aires', 'Europe/Madrid',
                              'Europe/Paris', 'Australia/Sydney', 'Asia/Jerusalem',
                              'America/Argentina/Buenos_Aires', 'Pacific/Honolulu', 'Europe/Dublin',
                              'America/Mexico_City', 'Europe/Berlin', 'Europe/Lisbon',
                              'America/New_York', 'America/Sao_Paulo', 'Europe/Madrid'];
  v_boards    text[] := array['shortboard', 'mid_length', 'longboard', 'shortboard', 'soft_top',
                              'mid_length', 'shortboard', 'longboard', 'shortboard', 'mid_length',
                              'shortboard', 'soft_top', 'longboard', 'shortboard', 'mid_length'];
  -- surf_level as the app stores it: 1 beginner, 2 intermediate, 3 advanced, 4 pro
  v_levels    int[]  := array[3, 2, 1, 3, 1, 2, 4, 2, 3, 2, 3, 1, 2, 3, 2];

  v_id       uuid;
  v_email    text;
  v_old_max  int;
  v_title    text;
  v_missing  int;
  i          int;
begin
  if array_length(v_names, 1) <> 15 then
    raise exception 'v_names must have exactly 15 names, has %', array_length(v_names, 1);
  end if;

  -- 1. The right trip, or nothing.
  select title, max_participants into v_title, v_old_max
    from public.group_trips where id = c_trip;
  if v_title is distinct from c_title then
    raise exception 'REFUSED: trip % is titled %, expected %', c_trip, coalesce(v_title, '<missing>'), c_title;
  end if;

  drop table if exists pg_temp._agents_setup;
  create temp table _agents_setup (k text primary key, v text);
  insert into _agents_setup values ('old_max_participants', coalesce(v_old_max::text, 'null'));

  for i in 1..15 loop
    v_id    := ('10ad7e57-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    v_email := 'agent' || lpad(i::text, 2, '0') || '@loadtest.invalid';

    -- 2. Auth user. Empty strings (not NULL) in the token columns: GoTrue
    --    fails to list users when they are NULL.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    if not exists (select 1 from public.users where id = v_id) then
      raise exception 'public.users row missing for % (%): handle_new_auth_user did not create it', v_id, v_email;
    end if;

    -- 3. Surfer profile. Hidden from matching, search, Swelly and analytics.
    insert into public.surfers (
      user_id, name, age, country_from, surfboard_type, surf_level, surf_level_category,
      finished_onboarding, onboarding_completed_at, timezone, is_demo_user, expo_push_token
    ) values (
      v_id, v_names[i], v_ages[i], v_countries[i],
      v_boards[i]::public.surfboard_type, v_levels[i],
      (array['beginner', 'intermediate', 'advanced', 'pro'])[v_levels[i]],
      true, now(), v_tz[i], true, null
    )
    on conflict (user_id) do update set
      name = excluded.name,
      is_demo_user = true,
      expo_push_token = null,
      finished_onboarding = true;
  end loop;

  -- 4. Room for 15 more (never lowers a bigger cap).
  update public.group_trips
     set max_participants = greatest(coalesce(max_participants, 0), c_cap)
   where id = c_trip;

  -- 5. Join them silently. If the insert raises, the whole block rolls back,
  --    so the trigger can never be left disabled.
  alter table public.group_trip_participants disable trigger trg_member_joined;
  insert into public.group_trip_participants (trip_id, user_id, role, status)
  select c_trip, ('10ad7e57-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'member', 'active'
    from generate_series(1, 15) g
  on conflict (trip_id, user_id) do nothing;
  alter table public.group_trip_participants enable trigger trg_member_joined;

  -- 6. Trip chat membership (trg_sync_trip_chat_member should have done it).
  select 15 - count(*) into v_missing
    from public.conversation_members cm
   where cm.conversation_id = public.trip_conversation_id(c_trip)
     and cm.user_id::text like '10ad7e57-0000-4000-8000-%'
     and cm.left_at is null;
  if v_missing > 0 then
    perform public.sync_trip_chat_members(c_trip);
    select 15 - count(*) into v_missing
      from public.conversation_members cm
     where cm.conversation_id = public.trip_conversation_id(c_trip)
       and cm.user_id::text like '10ad7e57-0000-4000-8000-%'
       and cm.left_at is null;
    if v_missing > 0 then
      raise exception '% agents are still not in the trip chat after sync_trip_chat_members', v_missing;
    end if;
  end if;

  -- 7. Mute the trip chat for the people kept out of the test (24 h, ISO
  --    string like the app's toISOString()).
  update public.conversation_members
     set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object(
           'muted_until',
           to_char((now() + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   where conversation_id = public.trip_conversation_id(c_trip)
     and user_id = any (v_muted);
end $$;

-- Summary. Expect 15 / 15 / 15 / 15, trigger_enabled = O, muted_watchers = 2.
select
  (select v from pg_temp._agents_setup where k = 'old_max_participants')            as old_max_participants,
  (select max_participants from public.group_trips
    where id = '5c042bf4-18af-496c-a3e1-262bfa0a3efc')                               as max_participants,
  (select participant_count from public.group_trips
    where id = '5c042bf4-18af-496c-a3e1-262bfa0a3efc')                               as participant_count,
  (select count(*) from auth.users  where id::text like '10ad7e57-0000-4000-8000-%')  as auth_users,
  (select count(*) from public.users where id::text like '10ad7e57-0000-4000-8000-%') as public_users,
  (select count(*) from public.surfers
    where user_id::text like '10ad7e57-0000-4000-8000-%' and is_demo_user
      and expo_push_token is null)                                                   as hidden_surfers,
  (select count(*) from public.group_trip_participants
    where trip_id = '5c042bf4-18af-496c-a3e1-262bfa0a3efc'
      and user_id::text like '10ad7e57-0000-4000-8000-%' and status = 'active')     as active_agents,
  (select count(*) from public.conversation_members
    where conversation_id = public.trip_conversation_id('5c042bf4-18af-496c-a3e1-262bfa0a3efc')
      and user_id::text like '10ad7e57-0000-4000-8000-%' and left_at is null)        as agents_in_chat,
  (select count(*) from public.conversation_members
    where conversation_id = public.trip_conversation_id('5c042bf4-18af-496c-a3e1-262bfa0a3efc')
      and left_at is null)                                                           as chat_members,
  (select tgenabled::text from pg_trigger
    where tgrelid = 'public.group_trip_participants'::regclass
      and tgname = 'trg_member_joined')                                              as trigger_enabled,
  (select count(*) from public.notifications
    where created_at > now() - interval '5 minutes'
      and actor_id::text like '10ad7e57-0000-4000-8000-%')                           as notifications_from_agents_5min,
  (select string_agg(coalesce(s.name, cm.user_id::text) || ' until ' || (cm.preferences->>'muted_until'), ', ')
     from public.conversation_members cm left join public.surfers s on s.user_id = cm.user_id
    where cm.conversation_id = public.trip_conversation_id('5c042bf4-18af-496c-a3e1-262bfa0a3efc')
      and cm.left_at is null and not cm.user_id::text like '10ad7e57-0000-4000-8000-%'
      and (cm.preferences->>'muted_until')::timestamptz > now())                     as muted_watchers;
