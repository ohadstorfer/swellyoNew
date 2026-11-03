-- loadtest/seed.sql
--
-- Fake data for the LOCAL load-test copy. NEVER run this on production.
--
-- What it makes (all fake, all ids are fixed so you can run it again):
--   160 users   (auth.users + public.users + public.surfers)
--               users 1..120   = the "phones" (k6 VUs use these first)
--               users 121..124 = guides (staff on the 4 operator trips)
--               users 125..160 = hosts / members of small Explore trips
--   6 main trips, 20 members each (trips 1..4 = operator trips, style C,
--               managed payments; trips 5..6 = style A, offline)
--   14 small public trips (so explore_feed has rows)
--   join requests, admin updates, gear items, gear requests
--   operator data: requirements, waiver, staff, prices, payment events,
--               refunds, consents, personal info, acknowledgements, documents
--   one group chat per trip + 60 DMs, ~2,500 messages, some reactions
--   8 notifications per user (half unread), user_activity rows
--
-- Production had about 760 surfers, 2,300 messages and 35 trips on
-- 21 Oct 2026, so this is the same order of size.
--
-- Triggers: everything runs with session_replication_role = replica, so NO
-- trigger fires while seeding (no realtime broadcasts, no notification rows,
-- no push queue rows, no pg_net calls). That also means derived data
-- (participant_count, trip chat members) is written here by hand.
--
-- Run it as a superuser (supabase_admin) - load.sh does that.
-- Safe to run again: it deletes its own rows first (by fixed id).

\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;

-- Refuse to run anywhere that looks like the real project.
do $$
begin
  if exists (select 1 from public.users where email not ilike '%@loadtest.invalid' limit 1) then
    raise exception 'seed.sql: this database has non-loadtest users. Run it only on the local copy.';
  end if;
end $$;

-- ---------------------------------------------------------------- ids ----
create temp table lt_users on commit drop as
select i,
       md5('loadtest-user-' || i)::uuid as id,
       format('lt-user-%s@loadtest.invalid', lpad(i::text, 3, '0')) as email
from generate_series(1, 160) i;

-- trips 1..6 = main trips; 7..20 = small Explore trips
create temp table lt_trips on commit drop as
select t,
       md5('loadtest-trip-' || t)::uuid as id,
       case when t <= 6 then md5('loadtest-user-' || ((t - 1) * 20 + 1))::uuid
            else md5('loadtest-user-' || (125 + (t - 7)))::uuid end as host_id,
       (t <= 4) as is_operator,
       (t <= 6) as is_main,
       md5('loadtest-conv-trip-' || t)::uuid as conv_id
from generate_series(1, 20) t;

create temp table lt_members on commit drop as
select tr.id as trip_id, tr.t, u.id as user_id, u.i,
       case when u.id = tr.host_id then 'host' else 'member' end as role
from lt_trips tr
join lt_users u on tr.is_main and u.i between (tr.t - 1) * 20 + 1 and tr.t * 20
union all
select tr.id, tr.t, tr.host_id, 125 + (tr.t - 7), 'host'
from lt_trips tr where not tr.is_main
union all
select tr.id, tr.t, u.id, u.i, 'member'
from lt_trips tr
join lt_users u on not tr.is_main
 and u.i in (139 + ((tr.t - 7) * 2) % 22, 139 + ((tr.t - 7) * 2 + 1) % 22);

-- guides: users 121..124 on trips 1..4 (staff, not travelers)
create temp table lt_guides on commit drop as
select tr.id as trip_id, tr.t, tr.host_id, u.id as user_id
from lt_trips tr join lt_users u on u.i = 120 + tr.t
where tr.is_operator;

-- DMs: pairs (1,2), (3,4) ... (119,120)
create temp table lt_dms on commit drop as
select k,
       md5('loadtest-conv-dm-' || k)::uuid as conv_id,
       a.id as a_id, b.id as b_id
from generate_series(1, 60) k
join lt_users a on a.i = 2 * k - 1
join lt_users b on b.i = 2 * k;

create temp table lt_reqs on commit drop as
select tr.id as trip_id, tr.t, r.*,
       md5('loadtest-req-' || tr.t || '-' || r.kind || '-' || r.audience)::uuid as id
from lt_trips tr
cross join (values
  ('deposit',   'pay',         'must_have', null::int, 'Deposit',          'traveler', 1),
  ('balance',   'pay',         'skippable', 30,        'Balance',          'traveler', 2),
  ('passport',  'upload',      'skippable', 45,        'Passport',         'traveler', 3),
  ('insurance', 'upload',      'skippable', 14,        'Travel insurance', 'traveler', 4),
  ('waiver',    'acknowledge', 'must_have', null::int, 'Waiver',           'traveler', 5),
  ('medical',   'upload',      'skippable', 7,         'Medical form',     'staff',    6)
) as r(kind, req_type, skip_at_onboarding, deadline_days_before, title, audience, sort_order)
where tr.is_operator;

-- ------------------------------------------------------------ cleanup ----
-- Replica mode turns off FK cascades too, so every table is cleaned by hand.
create temp table lt_all_convs on commit drop as
select id from public.conversations
where created_by in (select id from lt_users)
union select conv_id from lt_trips
union select conv_id from lt_dms;

delete from public.message_reactions
 where user_id in (select id from lt_users)
    or message_id in (select id from public.messages where conversation_id in (select id from lt_all_convs));
delete from public.messages where conversation_id in (select id from lt_all_convs)
    or sender_id in (select id from lt_users);
delete from public.conversation_members where conversation_id in (select id from lt_all_convs)
    or user_id in (select id from lt_users);
delete from public.conversations where id in (select id from lt_all_convs);

delete from public.group_trip_acknowledgements    where trip_id in (select id from lt_trips);
delete from public.organized_trip_travelers_documents where trip_id in (select id from lt_trips);
delete from public.organized_trip_personal_info   where trip_id in (select id from lt_trips);
delete from public.organized_trip_policy_consents where trip_id in (select id from lt_trips);
delete from public.organized_trip_refunds        where trip_id in (select id from lt_trips);
delete from public.organized_trip_payment_events where trip_id in (select id from lt_trips);
delete from public.organized_trip_operator_documents where trip_id in (select id from lt_trips);
delete from public.organized_trip_requirements   where trip_id in (select id from lt_trips);
delete from public.organized_trip_staff          where trip_id in (select id from lt_trips);
delete from public.group_trip_gear_items         where trip_id in (select id from lt_trips);
delete from public.group_trip_gear_requests      where trip_id in (select id from lt_trips);
delete from public.group_trip_admin_updates      where trip_id in (select id from lt_trips);
delete from public.group_trip_join_requests      where trip_id in (select id from lt_trips);
delete from public.group_trip_participants       where trip_id in (select id from lt_trips);
delete from public.group_trip_destinations       where trip_id in (select id from lt_trips);
delete from public.notifications where recipient_id in (select id from lt_users)
                                    or trip_id in (select id from lt_trips);
delete from public.group_trips where id in (select id from lt_trips);

delete from public.analytics_events where user_id in (select id from lt_users);
delete from public.user_activity    where user_id in (select id from lt_users);
delete from public.surfers          where user_id in (select id from lt_users);
delete from public.users            where id in (select id from lt_users);
delete from auth.identities         where user_id in (select id from lt_users);
delete from auth.sessions           where user_id in (select id from lt_users);
delete from auth.users              where id in (select id from lt_users);

-- -------------------------------------------------------------- users ----
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue fails on NULL in these text columns, so set them to ''
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now() - interval '30 days', now(),
       '', '', '', ''
from lt_users;

insert into public.users (id, email, role, created_at, updated_at)
select id, email, 'traveler', now() - interval '30 days', now() from lt_users;

insert into public.surfers (
  user_id, name, age, pronoun, country_from, surfboard_type, surf_level,
  surf_level_category, travel_experience, bio, profile_image_url,
  destinations_array, lifestyle_keywords, wave_type_keywords, travel_type,
  travel_buddies, finished_onboarding, onboarding_completed_at,
  welcome_guide_seen_at, timezone, operator, created_at, updated_at
)
select u.id,
       format('Load Tester %s', lpad(u.i::text, 3, '0')),
       20 + (u.i % 25),
       null,
       (array['Portugal','Spain','France','Australia','Brazil','USA','Israel','Mexico'])[1 + u.i % 8],
       (array['shortboard','mid_length','longboard','soft_top'])[1 + u.i % 4]::surfboard_type,
       1 + u.i % 5,
       (array['beginner','intermediate','advanced','pro'])[1 + u.i % 4],
       u.i % 10,
       'Fake profile made for load testing.',
       format('https://example.invalid/avatars/%s.jpg', u.i),
       '[]'::jsonb,
       array['yoga','hiking'],
       array['reef','beach'],
       (array['budget','mid','high','premium'])[1 + u.i % 4],
       (array['solo','2','crew'])[1 + u.i % 3],
       true, now() - interval '20 days', now() - interval '20 days', 'UTC',
       exists (select 1 from lt_trips tr where tr.is_operator and tr.host_id = u.id),
       now() - interval '30 days', now()
from lt_users u;

insert into public.user_activity (user_id, last_seen_at)
select id, now() - (random() * interval '2 days') from lt_users;

-- -------------------------------------------------------------- trips ----
insert into public.group_trips (
  id, host_id, hosting_style, title, description, hero_image_url,
  start_date, end_date, dates_set_in_stone, age_min, age_max,
  target_surf_levels, target_surf_styles, status, visibility,
  cost_per_person, deposit_amount, payment_mode, cancellation_preset,
  max_participants, participant_count, budget_currency, created_at, updated_at
)
select tr.id, tr.host_id,
       case when tr.is_operator then 'C' else 'A' end,
       format('Load test trip %s', tr.t),
       'Fake trip made for load testing.',
       format('https://example.invalid/trips/%s.jpg', tr.t),
       current_date + 30 + tr.t, current_date + 37 + tr.t, true,
       18, 45,
       array['intermediate','advanced'], array['shortboard','mid_length'],
       'active', 'public',
       case when tr.is_operator then 1500 else 900 end,
       case when tr.is_operator then 300 else null end,
       case when tr.is_operator then 'managed' else 'offline' end,
       case when tr.is_operator then 'standard' else null end,
       30,
       (select count(*) from lt_members m where m.trip_id = tr.id),
       'USD',
       now() - (tr.t || ' days')::interval, now()
from lt_trips tr;

insert into public.group_trip_destinations (trip_id, place_id, name, short_label, country, admin_level_1, lat, lng)
select id, 'loadtest-place-' || t, format('Fake Beach %s', t), format('Beach %s', t),
       (array['Portugal','Indonesia','Costa Rica','Morocco'])[1 + t % 4], 'Region', 10 + t, -20 - t
from lt_trips;

insert into public.group_trip_participants (
  trip_id, user_id, role, status, joined_at, price_total_usd, deposit_usd,
  price_set_by, price_set_at
)
select m.trip_id, m.user_id, m.role, 'active',
       now() - interval '10 days' + (m.i % 20) * interval '1 hour',
       case when tr.is_operator and m.role = 'member' then 1500 end,
       case when tr.is_operator and m.role = 'member' then 300 end,
       case when tr.is_operator and m.role = 'member' then tr.host_id end,
       case when tr.is_operator and m.role = 'member' then now() - interval '10 days' end
from lt_members m join lt_trips tr on tr.id = m.trip_id;

-- join requests: every member has an approved one; plus 5 pending and
-- 3 declined from people in the next trip's block
insert into public.group_trip_join_requests (trip_id, requester_id, status, created_at, reviewed_at, reviewed_by, seen_decision_at)
select m.trip_id, m.user_id, 'approved', now() - interval '12 days', now() - interval '11 days',
       tr.host_id, now() - interval '11 days'
from lt_members m join lt_trips tr on tr.id = m.trip_id
where m.role = 'member' and tr.is_main;

insert into public.group_trip_join_requests (trip_id, requester_id, status, created_at, reviewed_at, reviewed_by)
select tr.id, u.id,
       case when s.n <= 5 then 'pending' else 'declined' end,
       now() - (s.n || ' hours')::interval,
       case when s.n > 5 then now() - interval '1 hour' end,
       case when s.n > 5 then tr.host_id end
from lt_trips tr
cross join generate_series(1, 8) s(n)
join lt_users u on u.i = ((tr.t % 6) * 20) + 1 + s.n   -- next block, never the host
where tr.is_main;

insert into public.group_trip_admin_updates (trip_id, author_id, title, body, created_at)
select tr.id, tr.host_id, format('Update %s', n), 'Fake trip update for load testing.',
       now() - (n || ' days')::interval
from lt_trips tr cross join generate_series(1, 8) n
where tr.is_main;

insert into public.group_trip_gear_items (trip_id, name, needed_qty, created_by, sort_order)
select tr.id, g.name, g.qty, tr.host_id, g.ord
from lt_trips tr
cross join (values ('Wax', 4, 1), ('Leash', 6, 2), ('First aid kit', 1, 3),
                   ('Board bag', 3, 4), ('Sunscreen', 8, 5), ('Speaker', 1, 6)) g(name, qty, ord)
where tr.is_main;

insert into public.group_trip_gear_requests (trip_id, requester_id, item_name, status, needed_qty)
select m.trip_id, m.user_id, format('Extra item %s', m.i), 'pending', 1
from lt_members m join lt_trips tr on tr.id = m.trip_id
where tr.is_main and m.role = 'member' and m.i % 20 in (2, 3, 4);

-- ---------------------------------------------------- operator trips ----
insert into public.organized_trip_staff_roles (role_key, operator_id, tier, label, blurb, capabilities)
select v.role_key, null, v.tier, v.label, v.blurb, v.caps
from (values
  ('listed', 1, 'Listed', 'A credit, no login. Shown to travelers only.',
     array['profile.shown_to_travelers']),
  ('crew', 2, 'Crew', 'Present but silent. Sees roster + profiles, no chat.',
     array['profile.shown_to_travelers','roster.view','travelers.view_profiles']),
  ('guide', 3, 'Guide', 'Active crew. Adds chat, updates, stats.',
     array['profile.shown_to_travelers','roster.view','travelers.view_profiles','travelers.view_stats','chat.participate','updates.send']),
  ('manager', 4, 'Manager', 'Runs the trip. Docs, payments, roster - not medical.',
     array['profile.shown_to_travelers','roster.view','travelers.view_profiles','travelers.view_stats','chat.participate','payments.view_status','docs.view','trip.edit','docs.approve','travelers.remove','data.export']),
  ('co_operator', 5, 'Co-operator', 'Runs the trip with you. Everything except cancelling it.',
     array['profile.shown_to_travelers','roster.view','travelers.view_profiles','travelers.view_stats','chat.participate','payments.view_status','docs.view','medical.view','trip.edit','docs.approve','travelers.remove','data.export','money.manage','staff.manage']),
  ('operator', 6, 'Operator', 'Owner. Everything - money, staff, cancel.',
     array['profile.shown_to_travelers','roster.view','travelers.view_profiles','travelers.view_stats','chat.participate','payments.view_status','docs.view','medical.view','trip.edit','docs.approve','travelers.remove','data.export','money.manage','staff.manage','trip.cancel'])
) v(role_key, tier, label, blurb, caps)
where not exists (select 1 from public.organized_trip_staff_roles r
                  where r.role_key = v.role_key and r.operator_id is null);

insert into public.organized_trip_staff (trip_id, user_id, operator_id, role_key, title, accepted_at)
select id, host_id, host_id, 'operator', 'Operator', now() - interval '20 days'
from lt_trips where is_operator
union all
select trip_id, user_id, host_id, 'guide', 'Guide', now() - interval '15 days'
from lt_guides;

insert into public.organized_trip_requirements (
  id, trip_id, kind, req_type, skip_at_onboarding, title, deadline_days_before, sort_order, audience
)
select id, trip_id, kind, req_type, skip_at_onboarding, title, deadline_days_before, sort_order, audience
from lt_reqs;

insert into public.organized_trip_operator_documents (id, trip_id, created_by, kind, version, body_text, document_hash)
select md5('loadtest-waiver-' || t)::uuid, id, host_id, 'waiver', 1,
       'Fake waiver text for load testing.', 'loadtest-hash'
from lt_trips where is_operator;

-- 12 of 19 members paid the deposit; 2 more are "processing"
insert into public.organized_trip_payment_events (
  trip_id, user_id, requirement_id, provider_event_id, provider_object_id,
  event_type, amount_usd, amount_charged, currency_charged, is_livemode, created_at
)
select m.trip_id, m.user_id, r.id,
       format('evt_loadtest_%s_%s', m.t, m.i), format('pi_loadtest_%s_%s', m.t, m.i),
       case when m.i % 20 between 2 and 13 then 'paid' else 'processing' end,
       case when m.i % 20 between 2 and 13 then 300 else 0 end,
       300, 'usd', false, now() - interval '5 days'
from lt_members m
join lt_trips tr on tr.id = m.trip_id and tr.is_operator
join lt_reqs r on r.trip_id = m.trip_id and r.kind = 'deposit'
where m.role = 'member' and m.i % 20 between 2 and 15;

insert into public.organized_trip_refunds (
  trip_id, user_id, requested_by, provider_object_id, amount_usd, reason, status, is_livemode
)
select m.trip_id, m.user_id, tr.host_id, format('pi_loadtest_%s_%s', m.t, m.i), 50,
       'Fake refund', 'succeeded', false
from lt_members m join lt_trips tr on tr.id = m.trip_id and tr.is_operator
where m.role = 'member' and m.i % 20 in (2, 3);

insert into public.organized_trip_policy_consents (trip_id, user_id, policy_snapshot, shown_text, document_hash)
select m.trip_id, m.user_id, '{"preset":"standard"}'::jsonb, 'Fake cancellation policy.', 'loadtest-hash'
from lt_members m join lt_trips tr on tr.id = m.trip_id and tr.is_operator
where m.role = 'member';

insert into public.organized_trip_personal_info (
  trip_id, user_id, allergies_none, dietary_none, injuries_none, medications_none,
  emergency_name, emergency_phone, emergency_relation, completed_at
)
select m.trip_id, m.user_id, true, true, true, true,
       'Fake Contact', '+000000000', 'friend', now() - interval '3 days'
from lt_members m join lt_trips tr on tr.id = m.trip_id and tr.is_operator
where m.role = 'member' and m.i % 20 between 2 and 11;

insert into public.group_trip_acknowledgements (
  requirement_id, trip_id, user_id, agreed_name, operator_document_id, agreed_version, consent_electronic
)
select r.id, m.trip_id, m.user_id, 'Load Tester', md5('loadtest-waiver-' || m.t)::uuid, 1, true
from lt_members m
join lt_trips tr on tr.id = m.trip_id and tr.is_operator
join lt_reqs r on r.trip_id = m.trip_id and r.kind = 'waiver'
where m.role = 'member' and m.i % 20 between 2 and 11;

insert into public.organized_trip_travelers_documents (
  trip_id, user_id, requirement_id, storage_path, mime_type, byte_size, approved_at, approved_by
)
select m.trip_id, m.user_id, r.id, format('loadtest/%s/passport.pdf', m.i), 'application/pdf', 1000,
       case when m.i % 2 = 0 then now() - interval '1 day' end,
       case when m.i % 2 = 0 then tr.host_id end
from lt_members m
join lt_trips tr on tr.id = m.trip_id and tr.is_operator
join lt_reqs r on r.trip_id = m.trip_id and r.kind = 'passport'
where m.role = 'member' and m.i % 20 between 2 and 9;

-- -------------------------------------------------------------- chats ----
insert into public.conversations (id, title, is_direct, metadata, created_by, created_at, updated_at)
select conv_id, format('Load test trip %s', t), false,
       jsonb_build_object('trip_id', id), host_id,
       now() - interval '20 days', now() - interval '1 hour'
from lt_trips;

insert into public.conversations (id, title, is_direct, metadata, created_by, created_at, updated_at, direct_pair_key)
select conv_id, null, true, '{}'::jsonb, a_id, now() - interval '15 days', now() - interval '2 hours',
       least(a_id::text, b_id::text) || ':' || greatest(a_id::text, b_id::text)
from lt_dms;

insert into public.conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
select tr.conv_id, m.user_id, case when m.role = 'host' then 'owner' else 'member' end,
       now() - interval '10 days', now() - (m.i % 48) * interval '1 hour'
from lt_members m join lt_trips tr on tr.id = m.trip_id
union all
select tr.conv_id, g.user_id, 'member', now() - interval '10 days', now() - interval '5 hours'
from lt_guides g join lt_trips tr on tr.id = g.trip_id
union all
select conv_id, a_id, 'member', now() - interval '15 days', now() - interval '3 hours' from lt_dms
union all
select conv_id, b_id, 'member', now() - interval '15 days', now() - interval '6 hours' from lt_dms;

-- 300 messages per main trip chat, 10 per small trip chat, 10 per DM,
-- spread over the last 7 days
insert into public.messages (conversation_id, sender_id, body, type, client_id, created_at, updated_at)
select tr.conv_id,
       s.ids[1 + g.n % array_length(s.ids, 1)],
       format('Fake message %s', g.n), 'text',
       md5('loadtest-msg-trip-' || tr.t || '-' || g.n)::uuid,
       now() - (7 * 24 * 60 - g.n * 33) * interval '1 minute',
       now() - (7 * 24 * 60 - g.n * 33) * interval '1 minute'
from lt_trips tr
cross join lateral (
  select array_agg(mm.user_id order by mm.i) as ids from lt_members mm where mm.trip_id = tr.id
) s
cross join lateral generate_series(1, case when tr.is_main then 300 else 10 end) as g(n);

insert into public.messages (conversation_id, sender_id, body, type, client_id, created_at, updated_at)
select d.conv_id, case when n % 2 = 0 then d.a_id else d.b_id end,
       format('Fake DM %s', n), 'text',
       md5('loadtest-msg-dm-' || d.k || '-' || n)::uuid,
       now() - (n * 7) * interval '1 hour', now() - (n * 7) * interval '1 hour'
from lt_dms d cross join generate_series(1, 10) n;

-- a reaction on every 10th trip-chat message
insert into public.message_reactions (message_id, user_id, reaction)
select msg.id, cm.user_id, '🤙'
from public.messages msg
join lt_trips tr on tr.conv_id = msg.conversation_id and tr.is_main
join lateral (
  select c.user_id from public.conversation_members c
  where c.conversation_id = msg.conversation_id and c.user_id <> msg.sender_id
  order by c.user_id limit 2
) cm on true
where (extract(epoch from msg.created_at)::bigint / 60) % 10 = 0;

-- ------------------------------------------------------ notifications ----
insert into public.notifications (recipient_id, trip_id, type, actor_id, entity_type, entity_id, data, read_at, created_at)
select m.user_id, m.trip_id,
       (array['member_joined','admin_update_posted','join_request_received','trip_reminder'])[1 + n % 4]::notification_type,
       tr.host_id, 'trip', m.trip_id,
       jsonb_build_object('trip_title', format('Load test trip %s', tr.t)),
       case when n % 2 = 0 then now() - interval '1 hour' end,
       now() - (n * 5) * interval '1 hour'
from lt_members m join lt_trips tr on tr.id = m.trip_id and tr.is_main
cross join generate_series(1, 8) n;

commit;

-- Fresh stats so the planner sees the real row counts.
analyze;

select
  (select count(*) from public.users    where email like '%@loadtest.invalid') as users,
  (select count(*) from public.group_trips where title like 'Load test trip %') as trips,
  (select count(*) from public.group_trip_participants p join public.group_trips g on g.id = p.trip_id where g.title like 'Load test trip %') as participants,
  (select count(*) from public.messages where body like 'Fake %') as messages,
  (select count(*) from public.notifications n join public.users u on u.id = n.recipient_id where u.email like '%@loadtest.invalid') as notifications;
