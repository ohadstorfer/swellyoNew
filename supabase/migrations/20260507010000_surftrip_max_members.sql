-- Surftrip group max-member cap.
-- Admin sets a per-group limit at creation (default 50). Hard ceiling at 200.
-- A BEFORE INSERT trigger on surftrip_group_members rejects new memberships
-- once the group has reached its cap.

-- ============================================================================
-- Column: surftrip_groups.max_members
-- ============================================================================
alter table public.surftrip_groups
  add column if not exists max_members integer not null default 50;

alter table public.surftrip_groups
  drop constraint if exists surftrip_groups_max_members_range;
alter table public.surftrip_groups
  add constraint surftrip_groups_max_members_range
  check (max_members between 2 and 200);

-- ============================================================================
-- Trigger: enforce max_members on insert into surftrip_group_members
-- ============================================================================
create or replace function public.enforce_surftrip_max_members()
returns trigger
language plpgsql
security definer
as $$
declare
  v_max integer;
  v_count integer;
begin
  select max_members into v_max
    from public.surftrip_groups
    where id = new.group_id;

  if v_max is null then
    return new; -- no limit (shouldn't happen with NOT NULL column, but safe)
  end if;

  select count(*) into v_count
    from public.surftrip_group_members
    where group_id = new.group_id;

  if v_count >= v_max then
    raise exception 'group has reached its member limit (%)', v_max
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

drop trigger if exists trg_surftrip_enforce_max_members on public.surftrip_group_members;
create trigger trg_surftrip_enforce_max_members
  before insert on public.surftrip_group_members
  for each row execute function public.enforce_surftrip_max_members();

-- ============================================================================
-- Update RPC: create_surftrip_group accepts max_members
-- ============================================================================
create or replace function public.create_surftrip_group(
  p_name text,
  p_description text default null,
  p_hero_image_url text default null,
  p_max_members integer default 50
)
returns public.surftrip_groups
language plpgsql
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_conversation_id uuid;
  v_group public.surftrip_groups;
  v_max integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  -- Clamp max_members into the allowed [2, 200] range, defaulting to 50.
  v_max := coalesce(p_max_members, 50);
  if v_max < 2 then v_max := 2; end if;
  if v_max > 200 then v_max := 200; end if;

  insert into public.conversations (is_direct, title, created_by, metadata)
  values (false, trim(p_name), v_user, jsonb_build_object('surftrip', true))
  returning id into v_conversation_id;

  insert into public.surftrip_groups (conversation_id, host_id, name, description, hero_image_url, max_members)
  values (v_conversation_id, v_user, trim(p_name), p_description, p_hero_image_url, v_max)
  returning * into v_group;

  update public.conversations
  set metadata = metadata || jsonb_build_object('surftrip_id', v_group.id)
  where id = v_conversation_id;

  insert into public.surftrip_group_members (group_id, user_id, role)
  values (v_group.id, v_user, 'host');

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conversation_id, v_user, 'owner')
  on conflict (conversation_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.create_surftrip_group(text, text, text, integer) to authenticated;
-- Drop the old 3-arg version if it still exists from the original migration.
drop function if exists public.create_surftrip_group(text, text, text);

-- ============================================================================
-- Update RPC: get_surftrips_for_user — return max_members too
-- ============================================================================
drop function if exists public.get_surftrips_for_user(uuid);

create or replace function public.get_surftrips_for_user(p_user uuid)
returns table (
  id uuid,
  conversation_id uuid,
  host_id uuid,
  name text,
  description text,
  hero_image_url text,
  status text,
  max_members integer,
  created_at timestamptz,
  updated_at timestamptz,
  is_member boolean,
  member_count integer,
  my_role text
)
language sql
stable
as $$
  select
    g.id,
    g.conversation_id,
    g.host_id,
    g.name,
    g.description,
    g.hero_image_url,
    g.status,
    g.max_members,
    g.created_at,
    g.updated_at,
    exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = g.id and m.user_id = p_user
    ) as is_member,
    (select count(*)::int from public.surftrip_group_members m where m.group_id = g.id) as member_count,
    (select role from public.surftrip_group_members m where m.group_id = g.id and m.user_id = p_user) as my_role
  from public.surftrip_groups g
  where g.status = 'active'
  order by
    exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = g.id and m.user_id = p_user
    ) desc,
    g.created_at desc;
$$;

grant execute on function public.get_surftrips_for_user(uuid) to authenticated;
