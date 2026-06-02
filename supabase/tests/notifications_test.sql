-- ============================================================================
-- Self-checking test harness for the notification center triggers.
--
-- SAFE: everything runs inside one transaction and ROLLs BACK at the end, so it
-- leaves NO data behind — safe to run even against a real DB. It only READS
-- existing users (needs >= 6 rows in public.users); it never mutates them.
--
-- PREREQUISITE: migration 20260601010000_notification_center.sql must be applied
-- first (enum + notifications table + triggers + gear_items.source_gear_request_id).
--
-- DATA MODEL NOTE: group_trip_participants.role is only 'host' | 'member' (no
-- 'admin' role exists for group trips). So the sole admin is the host, and all
-- admin-audience notifications go to the host alone. Counts below reflect that.
--
-- HOW TO RUN:
--   * Supabase SQL editor: paste the whole file and Run. On success the NOTICEs
--     end with "ALL NOTIFICATION TRIGGER TESTS PASSED". Any failure raises an
--     exception (which also aborts/rolls back the transaction).
--   * psql:  psql "$DB_URL" -f supabase/tests/notifications_test.sql
-- ============================================================================

begin;

do $$
declare
  u uuid[];
  v_host uuid; v_alice uuid; v_bob uuid; v_carol uuid; v_dave uuid; v_erin uuid;
  v_trip uuid;
  v_item uuid; v_item2 uuid;
  v_gear_req uuid; v_commit_req uuid; v_commit_req2 uuid; v_join_req uuid;
  n int; n_admin int; n_user int;
begin
  -- The "only Ohad" gate (section 7 of the migration) would drop every row that
  -- isn't Ohad's. Disable it here so we can verify the underlying fan-out logic;
  -- the gate itself is tested at the end. The DISABLE is undone by the ROLLBACK.
  execute 'alter table public.notifications disable trigger trg_notifications_only_ohad';

  -- ---- pick 6 distinct real users (read-only) -----------------------------
  select array_agg(id) into u from (select id from public.users order by created_at limit 6) s;
  if array_length(u,1) is null or array_length(u,1) < 6 then
    raise exception 'Need at least 6 users in public.users to run this test';
  end if;
  v_host := u[1]; v_alice := u[2]; v_bob := u[3]; v_carol := u[4]; v_dave := u[5]; v_erin := u[6];

  -- ---- create an isolated test trip (satisfies all NOT NULL + CHECK) ------
  insert into public.group_trips (host_id, hosting_style, title, description, hero_image_url,
                                  age_min, age_max, target_surf_levels, target_surf_styles)
  values (v_host, 'A', 'NOTIF TEST TRIP', 'test', 'http://x',
          18, 40, '{"all"}'::text[], '{"all"}'::text[])
  returning id into v_trip;

  -- base participants: host + 3 members (no 'admin' role exists for group trips)
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_host,  'host')   on conflict do nothing;
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_alice, 'member') on conflict do nothing;
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_bob,   'member') on conflict do nothing;
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_carol, 'member') on conflict do nothing;

  delete from public.notifications where trip_id = v_trip;  -- clear setup noise

  -- =========================================================================
  -- gear_claimed
  -- =========================================================================
  insert into public.group_trip_gear_items (trip_id, name, needed_qty, created_by)
    values (v_trip, 'sunscreen', 10, v_host) returning id into v_item;
  delete from public.notifications where trip_id = v_trip;  -- ignore group_gear_updated from this add

  -- (a) first claim by alice → notify everyone else (host, bob, carol), not alice
  insert into public.group_trip_gear_claims (item_id, user_id, quantity) values (v_item, v_alice, 1);
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_claimed';
  if n <> 3 then raise exception 'gear_claimed insert: expected 3 rows, got %', n; end if;
  if exists (select 1 from public.notifications where trip_id=v_trip and type='gear_claimed' and recipient_id=v_alice)
    then raise exception 'gear_claimed: claimer should NOT be notified'; end if;
  select count(*) filter (where audience='admin'), count(*) filter (where audience='user')
    into n_admin, n_user from public.notifications where trip_id=v_trip and type='gear_claimed';
  if n_admin <> 1 or n_user <> 2 then raise exception 'gear_claimed audience: expected 1 admin/2 user, got %/%', n_admin, n_user; end if;
  if not exists (select 1 from public.notifications where type='gear_claimed' and (data->>'qty')='1' and (data->>'gear_name')='sunscreen')
    then raise exception 'gear_claimed: snapshot data wrong'; end if;
  raise notice 'PASS gear_claimed (first claim)';

  -- (b) quantity change 1 -> 2 fires again
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_claims set quantity = 2 where item_id=v_item and user_id=v_alice;
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_claimed';
  if n <> 3 then raise exception 'gear_claimed qty-change: expected 3 rows, got %', n; end if;
  if not exists (select 1 from public.notifications where type='gear_claimed' and (data->>'qty')='2')
    then raise exception 'gear_claimed qty-change: snapshot should show qty 2'; end if;
  raise notice 'PASS gear_claimed (qty change)';

  -- (c) no-op update (same qty) → nothing
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_claims set quantity = 2 where item_id=v_item and user_id=v_alice;
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_claimed';
  if n <> 0 then raise exception 'gear_claimed no-op: expected 0 rows, got %', n; end if;
  raise notice 'PASS gear_claimed (no-op suppressed)';

  -- =========================================================================
  -- admin_update_posted  → all participants except author
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_admin_updates (trip_id, author_id, body) values (v_trip, v_host, 'Bring cash');
  select count(*) into n from public.notifications where trip_id=v_trip and type='admin_update_posted';
  if n <> 3 then raise exception 'admin_update: expected 3 rows, got %', n; end if;
  if exists (select 1 from public.notifications where type='admin_update_posted' and recipient_id=v_host)
    then raise exception 'admin_update: author should not be notified'; end if;
  raise notice 'PASS admin_update_posted';

  -- =========================================================================
  -- group_gear_updated
  -- =========================================================================
  -- (a) normal add by host → everyone except creator
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_gear_items (trip_id, name, needed_qty, created_by)
    values (v_trip, 'first aid kit', 1, v_host) returning id into v_item2;
  select count(*) into n from public.notifications where trip_id=v_trip and type='group_gear_updated';
  if n <> 3 then raise exception 'group_gear add: expected 3 rows, got %', n; end if;
  raise notice 'PASS group_gear_updated (add)';

  -- (b) no-op update (needed_qty set to same value) → nothing
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_items set needed_qty = 1 where id=v_item2;
  select count(*) into n from public.notifications where trip_id=v_trip and type='group_gear_updated';
  if n <> 0 then raise exception 'group_gear no-op: expected 0 rows, got %', n; end if;
  raise notice 'PASS group_gear_updated (no-op suppressed)';

  -- (c) real qty change → fires
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_items set needed_qty = 5 where id=v_item2;
  select count(*) into n from public.notifications where trip_id=v_trip and type='group_gear_updated';
  if n <> 3 then raise exception 'group_gear qty-change: expected 3 rows, got %', n; end if;
  raise notice 'PASS group_gear_updated (real change)';

  -- (d) item created FROM an approved gear request → requester is skipped
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_gear_requests (trip_id, requester_id, item_name)
    values (v_trip, v_alice, 'wax') returning id into v_gear_req;
  delete from public.notifications where trip_id = v_trip;  -- ignore the gear_request_received here
  insert into public.group_trip_gear_items (trip_id, name, needed_qty, created_by, source_gear_request_id)
    values (v_trip, 'wax', 1, v_host, v_gear_req);
  select count(*) into n from public.notifications where trip_id=v_trip and type='group_gear_updated';
  if n <> 2 then raise exception 'group_gear from-approval: expected 2 rows (requester skipped), got %', n; end if;
  if exists (select 1 from public.notifications where type='group_gear_updated' and recipient_id=v_alice)
    then raise exception 'group_gear from-approval: requester should be skipped (gets gear_request_decided instead)'; end if;
  raise notice 'PASS group_gear_updated (from approval skips requester)';

  -- =========================================================================
  -- personal_gear_updated  → only that participant; only on by_host change
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_participants set personal_gear_by_host = '["leash"]'::jsonb
    where trip_id=v_trip and user_id=v_alice;
  select count(*) into n from public.notifications where trip_id=v_trip and type='personal_gear_updated';
  if n <> 1 then raise exception 'personal_gear: expected 1 row, got %', n; end if;
  if not exists (select 1 from public.notifications where type='personal_gear_updated' and recipient_id=v_alice)
    then raise exception 'personal_gear: wrong recipient'; end if;
  -- editing personal_gear_by_me (the user's own) must NOT fire
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_participants set personal_gear_by_me = '["fins"]'::jsonb
    where trip_id=v_trip and user_id=v_bob;
  select count(*) into n from public.notifications where trip_id=v_trip and type='personal_gear_updated';
  if n <> 0 then raise exception 'personal_gear: by_me change should not fire, got %', n; end if;
  raise notice 'PASS personal_gear_updated';

  -- =========================================================================
  -- gear_request_received  → admins (host only)
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_gear_requests (trip_id, requester_id, item_name)
    values (v_trip, v_bob, 'tent') returning id into v_gear_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_request_received';
  if n <> 1 then raise exception 'gear_request_received: expected 1 (host), got %', n; end if;
  if not exists (select 1 from public.notifications where type='gear_request_received' and recipient_id=v_host and audience='admin')
    then raise exception 'gear_request_received: should reach host with admin audience'; end if;
  raise notice 'PASS gear_request_received';

  -- gear_request_decided (declined) → requester only
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_requests set status='declined', reviewed_by=v_host where id=v_gear_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_request_decided';
  if n <> 1 then raise exception 'gear_request_decided: expected 1 row, got %', n; end if;
  if not exists (select 1 from public.notifications where type='gear_request_decided' and recipient_id=v_bob and (data->>'decision')='declined')
    then raise exception 'gear_request_decided: wrong recipient/decision'; end if;
  raise notice 'PASS gear_request_decided';

  -- withdrawn must NOT notify
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_gear_requests (trip_id, requester_id, item_name)
    values (v_trip, v_bob, 'rope') returning id into v_gear_req;
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_requests set status='withdrawn' where id=v_gear_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='gear_request_decided';
  if n <> 0 then raise exception 'gear_request withdrawn: should not notify, got %', n; end if;
  raise notice 'PASS gear_request (withdrawn suppressed)';

  -- =========================================================================
  -- commitment_request_received  → admins (host only)
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_commitment_requests (trip_id, user_id, status)
    values (v_trip, v_alice, 'pending') returning id into v_commit_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='commitment_request_received';
  if n <> 1 then raise exception 'commitment_request_received: expected 1 (host), got %', n; end if;
  raise notice 'PASS commitment_request_received';

  -- approved → requester gets commitment_decided AND everyone else gets member_committed
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_commitment_requests set status='approved', decided_by=v_host where id=v_commit_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='commitment_decided' and recipient_id=v_alice;
  if n <> 1 then raise exception 'commitment approved: requester should get 1 commitment_decided, got %', n; end if;
  select count(*) into n from public.notifications where trip_id=v_trip and type='member_committed';
  if n <> 3 then raise exception 'commitment approved: expected 3 member_committed (all but requester), got %', n; end if;
  if exists (select 1 from public.notifications where type='member_committed' and recipient_id=v_alice)
    then raise exception 'commitment approved: requester should not get member_committed'; end if;
  raise notice 'PASS commitment_decided + member_committed (approved)';

  -- declined → only commitment_decided to requester, no member_committed
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_commitment_requests (trip_id, user_id, status)
    values (v_trip, v_bob, 'pending') returning id into v_commit_req2;
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_commitment_requests set status='declined', decided_by=v_host where id=v_commit_req2;
  select count(*) into n from public.notifications where trip_id=v_trip and type='commitment_decided' and recipient_id=v_bob;
  if n <> 1 then raise exception 'commitment declined: expected 1 commitment_decided, got %', n; end if;
  select count(*) into n from public.notifications where trip_id=v_trip and type='member_committed';
  if n <> 0 then raise exception 'commitment declined: should not broadcast member_committed, got %', n; end if;
  raise notice 'PASS commitment_decided (declined)';

  -- superseded must NOT notify
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_commitment_requests set status='superseded' where id=v_commit_req2;
  select count(*) into n from public.notifications where trip_id=v_trip;
  if n <> 0 then raise exception 'commitment superseded: should not notify, got %', n; end if;
  raise notice 'PASS commitment (superseded suppressed)';

  -- =========================================================================
  -- member_joined  → add dave as a new member
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_participants (trip_id, user_id, role) values (v_trip, v_dave, 'member');
  select count(*) into n from public.notifications where trip_id=v_trip and type='member_joined';
  if n <> 4 then raise exception 'member_joined: expected 4 rows (host,alice,bob,carol), got %', n; end if;
  if exists (select 1 from public.notifications where type='member_joined' and recipient_id=v_dave)
    then raise exception 'member_joined: joiner should not be notified'; end if;
  select count(*) filter (where audience='admin'), count(*) filter (where audience='user')
    into n_admin, n_user from public.notifications where trip_id=v_trip and type='member_joined';
  if n_admin <> 1 or n_user <> 3 then raise exception 'member_joined audience: expected 1 admin/3 user, got %/%', n_admin, n_user; end if;
  raise notice 'PASS member_joined';

  -- =========================================================================
  -- join request flow (erin): received → decided, no double-notify on approve
  -- =========================================================================
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_join_requests (trip_id, requester_id, status)
    values (v_trip, v_erin, 'pending') returning id into v_join_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='join_request_received';
  if n <> 1 then raise exception 'join_request_received: expected 1 (host), got %', n; end if;
  raise notice 'PASS join_request_received';

  -- approve: existing trigger inserts erin as participant (fires member_joined to
  -- everyone else); erin herself gets join_request_decided and NOT member_joined.
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_join_requests set status='approved', reviewed_by=v_host where id=v_join_req;
  select count(*) into n from public.notifications where trip_id=v_trip and type='join_request_decided' and recipient_id=v_erin;
  if n <> 1 then raise exception 'join_request_decided: erin should get exactly 1, got %', n; end if;
  if exists (select 1 from public.notifications where type='member_joined' and recipient_id=v_erin)
    then raise exception 'join approve: requester must NOT also get member_joined (double-notify)'; end if;
  -- and the other 5 participants DO get member_joined about erin
  select count(*) into n from public.notifications where trip_id=v_trip and type='member_joined';
  if n <> 5 then raise exception 'join approve: expected 5 member_joined (host,alice,bob,carol,dave), got %', n; end if;
  raise notice 'PASS join_request_decided (no double-notify on approve)';

  -- =========================================================================
  -- TEMPORARY "only Ohad" gate (section 7 of the migration)
  -- =========================================================================
  execute 'alter table public.notifications enable trigger trg_notifications_only_ohad';
  update public.users set email = 'ohad.storfer@gmail.com' where id = v_alice;  -- make alice = Ohad

  -- (a) event where Ohad IS a recipient: admin update by host normally hits
  --     alice,bob,carol; with the gate ON, only Ohad (alice) gets a row.
  delete from public.notifications where trip_id = v_trip;
  insert into public.group_trip_admin_updates (trip_id, author_id, body) values (v_trip, v_host, 'Gate test');
  select count(*) into n from public.notifications where trip_id=v_trip;
  if n <> 1 then raise exception 'GATE: expected exactly 1 row (Ohad only), got %', n; end if;
  if not exists (select 1 from public.notifications where trip_id=v_trip and recipient_id=v_alice)
    then raise exception 'GATE: the only delivered row should be Ohad''s'; end if;
  raise notice 'PASS only-Ohad gate (delivers to Ohad)';

  -- (b) event where Ohad is NOT among recipients: Ohad(alice) claims, so the
  --     recipients are host/bob/carol (all non-Ohad) → gate blocks everything.
  delete from public.notifications where trip_id = v_trip;
  update public.group_trip_gear_claims set quantity = 3 where item_id=v_item and user_id=v_alice;
  select count(*) into n from public.notifications where trip_id=v_trip;
  if n <> 0 then raise exception 'GATE: non-Ohad recipients must be blocked, got %', n; end if;
  raise notice 'PASS only-Ohad gate (blocks everyone else)';

  raise notice '====================================================';
  raise notice 'ALL NOTIFICATION TRIGGER TESTS PASSED';
  raise notice '====================================================';
end $$;

rollback;
