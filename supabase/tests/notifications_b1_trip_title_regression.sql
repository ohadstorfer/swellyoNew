-- ============================================================================
-- B1 REGRESSION TEST — notification snapshots must include `trip_title`.
--
-- STATUS: EXPECTED TO FAIL (RED) until the triggers are fixed. This is a
-- deliberate regression test for bug B1 found in the 2026-06-08 review
-- (docs/superpowers/specs/2026-06-08-notifications-review-findings.md).
--
-- WHY: the client render (notificationsService.renderNotification) shows the
-- generic "the trip" whenever `data.trip_title` is absent. Several triggers
-- (`join_request_received`, `join_request_decided`, `gear_request_received`,
-- `commitment_request_received`) build their snapshot WITHOUT `trip_title`, so
-- users never see the real trip name. This test pins that contract: once the
-- triggers snapshot `trip_title`, this test goes GREEN.
--
-- SAFE: one transaction, ROLLBACK at the end. Reads users read-only, fires NO
-- push (push edge functions are webhook-wired to other tables, not these
-- triggers, and the txn rolls back regardless). Gate disable is undone by ROLLBACK.
--
-- HOW TO RUN (needs a DB — local stack or prod; both safe due to ROLLBACK):
--   psql "$DB_URL" -f supabase/tests/notifications_b1_trip_title_regression.sql
--   …or paste into the Supabase SQL editor and Run.
-- ============================================================================

begin;

do $$
declare
  u uuid[];
  v_host uuid; v_alice uuid; v_bob uuid;
  v_trip uuid;
  v_join_req uuid; v_gear_req uuid; v_commit_req uuid;
  v_title text;
begin
  execute 'alter table public.notifications disable trigger trg_notifications_only_ohad';

  select array_agg(id) into u from (select id from public.users order by created_at limit 3) s;
  if array_length(u,1) is null or array_length(u,1) < 3 then
    raise exception 'Need at least 3 users in public.users to run this test';
  end if;
  v_host := u[1]; v_alice := u[2]; v_bob := u[3];

  insert into public.group_trips (host_id, hosting_style, title, description, hero_image_url,
                                  age_min, age_max, target_surf_levels, target_surf_styles)
  values (v_host, 'A', 'B1 REGRESSION TRIP', 'test', 'http://x',
          18, 40, '{"all"}'::text[], '{"all"}'::text[])
  returning id into v_trip;
  select title into v_title from public.group_trips where id = v_trip;

  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_host,  'host')   on conflict do nothing;
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_alice, 'member') on conflict do nothing;
  delete from public.notifications where trip_id = v_trip;

  -- ---- join_request_received (host) must carry trip_title ------------------
  insert into public.group_trip_join_requests (trip_id, requester_id, status)
    values (v_trip, v_bob, 'pending') returning id into v_join_req;
  if (select data->>'trip_title' from public.notifications
        where trip_id=v_trip and type='join_request_received' limit 1) is distinct from v_title then
    raise exception 'B1: join_request_received snapshot is missing trip_title (got %)',
      (select data->>'trip_title' from public.notifications where trip_id=v_trip and type='join_request_received' limit 1);
  end if;
  raise notice 'PASS B1 join_request_received has trip_title';

  -- ---- join_request_decided (requester) must carry trip_title --------------
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_join_requests set status='declined', reviewed_by=v_host where id=v_join_req;
  if (select data->>'trip_title' from public.notifications
        where trip_id=v_trip and type='join_request_decided' and recipient_id=v_bob limit 1) is distinct from v_title then
    raise exception 'B1: join_request_decided snapshot is missing trip_title';
  end if;
  raise notice 'PASS B1 join_request_decided has trip_title';

  -- ---- gear_request_received (host) must carry trip_title ------------------
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_gear_requests (trip_id, requester_id, item_name)
    values (v_trip, v_bob, 'tent') returning id into v_gear_req;
  if (select data->>'trip_title' from public.notifications
        where trip_id=v_trip and type='gear_request_received' limit 1) is distinct from v_title then
    raise exception 'B1: gear_request_received snapshot is missing trip_title';
  end if;
  raise notice 'PASS B1 gear_request_received has trip_title';

  -- ---- commitment_request_received (host) must carry trip_title ------------
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_commitment_requests (trip_id, user_id, status)
    values (v_trip, v_alice, 'pending') returning id into v_commit_req;
  if (select data->>'trip_title' from public.notifications
        where trip_id=v_trip and type='commitment_request_received' limit 1) is distinct from v_title then
    raise exception 'B1: commitment_request_received snapshot is missing trip_title';
  end if;
  raise notice 'PASS B1 commitment_request_received has trip_title';

  raise notice 'ALL B1 TRIP_TITLE REGRESSION CHECKS PASSED (bug is fixed)';
end $$;

rollback;
