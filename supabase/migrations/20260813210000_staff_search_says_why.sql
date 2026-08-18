-- "Nobody found" when the person is right there on the trip.
--
-- ── What happened ──────────────────────────────────────────────────────────
-- Ohad searched his own crew list for "Sababa", who is an active traveler on
-- that trip, and got "Nobody found. They may not be on Swellyo, or they're
-- already on this trip." Both halves of that sentence are guesses, and the
-- operator has no way to tell which one applied — so a working exclusion reads
-- as a broken search.
--
-- The exclusion itself is right: staff and travelers are exclusive (invariant
-- I3, enforced by trg_staff_not_traveler), so offering them would produce a
-- trigger error at insert time.
--
-- ── What changes ───────────────────────────────────────────────────────────
-- Three of the four exclusions are things the operator ALREADY KNOWS — they can
-- open the roster, the crew list and the pending invites and read all of them.
-- Hiding those is not protecting anything; it is withholding the answer from
-- the one person entitled to it. Those rows now come back with a `state`
-- saying why, for the UI to show greyed out and unpickable.
--
-- The fourth stays hidden and always will: a BLOCK. Whether someone blocked you
-- is exactly the thing a search endpoint must never confirm, and unlike the
-- other three the operator has no legitimate view of it.
--
-- The enumeration guards are untouched — operator of a 'C' trip only, two
-- characters minimum, 20 rows, no email, no demo accounts.
--
-- DROPPED first: the return type gains a column, and `create or replace` cannot
-- change one. The grant is re-issued below, because a dropped function loses it
-- and a recreated one comes back executable by PUBLIC.
drop function if exists public.search_users_for_staff(uuid, text);
create function public.search_users_for_staff(
  p_trip_id uuid,
  p_query   text
)
returns table(
  user_id           uuid,
  name              text,
  profile_image_url text,
  -- 'available' · 'traveler' · 'crew' · 'invited'. Never a reason the caller
  -- cannot already see for themselves.
  state             text
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  -- Two characters minimum. A one-character query returns a slice of the whole
  -- user table, which is the enumeration this guard exists to prevent.
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id,
         s.name::text,
         s.profile_image_url::text,
         case
           when exists (
             select 1 from public.organized_trip_staff st
              where st.trip_id = p_trip_id and st.user_id = s.user_id
                and st.revoked_at is null
           ) then 'crew'
           when exists (
             select 1 from public.group_trip_participants p
              where p.trip_id = p_trip_id and p.user_id = s.user_id
           ) then 'traveler'
           when exists (
             select 1 from public.organized_trip_staff_invites i
              where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
                and i.accepted_at is null and i.revoked_at is null
                and i.expires_at > now()
           ) then 'invited'
           else 'available'
         end as state
    from public.surfers s
         -- Written as `= false`, not `not s.is_demo_user`, so it matches the
         -- partial index predicate verbatim and the planner can use the index.
   where s.is_demo_user = false
     and s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     -- Blocks, both directions. The ONE exclusion that stays silent.
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     -- Pickable people first: an operator scanning the list should not have to
     -- read past four greyed-out rows to reach the one they can tap.
     case
       when not exists (
         select 1 from public.organized_trip_staff st
          where st.trip_id = p_trip_id and st.user_id = s.user_id and st.revoked_at is null)
        and not exists (
         select 1 from public.group_trip_participants p
          where p.trip_id = p_trip_id and p.user_id = s.user_id)
        and not exists (
         select 1 from public.organized_trip_staff_invites i
          where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
       then 0 else 1
     end,
     -- Prefix matches first: typing "mar" should surface Marta before Omar.
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end $$;

revoke execute on function public.search_users_for_staff(uuid, text) from public, anon;
grant  execute on function public.search_users_for_staff(uuid, text) to authenticated;
