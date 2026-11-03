-- loadtest/export-fixtures.sql
--
-- Prints ONE line of JSON: the seeded fake users with the ids each one
-- needs during the test (their trips, chats, trip-mates). mint-tokens.js
-- reads it and adds a token to each user.
--
-- Run as supabase_admin with psql -At (load.sh does it).

select coalesce(json_agg(x order by x.email), '[]'::json)
from (
  select
    u.id as user_id,
    u.email,
    coalesce(s.operator, false) as is_operator,
    coalesce((select json_agg(p.trip_id order by g.created_at)
              from public.group_trip_participants p
              join public.group_trips g on g.id = p.trip_id
              where p.user_id = u.id and p.status = 'active'), '[]') as trip_ids,
    coalesce((select json_agg(st.trip_id)
              from public.organized_trip_staff st
              where st.user_id = u.id and st.revoked_at is null
                and st.role_key <> 'operator'), '[]') as staff_trip_ids,
    coalesce((select json_agg(c.id)
              from public.conversation_members cm
              join public.conversations c on c.id = cm.conversation_id
              where cm.user_id = u.id and not c.is_direct), '[]') as trip_conversation_ids,
    coalesce((select json_agg(c.id)
              from public.conversation_members cm
              join public.conversations c on c.id = cm.conversation_id
              where cm.user_id = u.id and c.is_direct), '[]') as dm_conversation_ids,
    -- people in my first trip (or the trip I staff), not me, max 30
    coalesce((select json_agg(q.user_id) from (
                select p2.user_id
                from public.group_trip_participants p2
                where p2.status = 'active' and p2.user_id <> u.id
                  and p2.trip_id = coalesce(
                    (select p.trip_id from public.group_trip_participants p
                      join public.group_trips g on g.id = p.trip_id
                      where p.user_id = u.id and p.status = 'active'
                      order by g.created_at limit 1),
                    (select st.trip_id from public.organized_trip_staff st
                      where st.user_id = u.id and st.revoked_at is null limit 1))
                order by p2.user_id limit 30) q), '[]') as trip_member_ids
  from public.users u
  left join public.surfers s on s.user_id = u.id
  where u.email like '%@loadtest.invalid'
) x;
