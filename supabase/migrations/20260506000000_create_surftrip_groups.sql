-- Surftrip Groups
-- A surftrip is a group chat with metadata: name, description, hero image,
-- a host, members with roles (host/admin/member), and a join-request workflow.
-- Every non-direct conversation is now backed by a surftrip_groups row that
-- holds the group's metadata. The conversation row stays the source of truth
-- for the chat itself (messages, realtime, members).

-- ============================================================================
-- Table: surftrip_groups
-- ============================================================================
create table if not exists public.surftrip_groups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  hero_image_url text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surftrip_groups_host_id_idx
  on public.surftrip_groups(host_id);
create index if not exists surftrip_groups_conversation_id_idx
  on public.surftrip_groups(conversation_id);
create index if not exists surftrip_groups_status_created_at_idx
  on public.surftrip_groups(status, created_at desc);

-- ============================================================================
-- Table: surftrip_group_members
-- ============================================================================
create table if not exists public.surftrip_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.surftrip_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('host','admin','member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists surftrip_group_members_group_id_idx
  on public.surftrip_group_members(group_id);
create index if not exists surftrip_group_members_user_id_idx
  on public.surftrip_group_members(user_id);

-- ============================================================================
-- Table: surftrip_join_requests
-- ============================================================================
create table if not exists public.surftrip_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.surftrip_groups(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','withdrawn')),
  request_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

-- Allow re-request after decline/withdraw, but block two simultaneous pending rows.
create unique index if not exists surftrip_join_requests_one_pending
  on public.surftrip_join_requests(group_id, requester_id)
  where status = 'pending';

create index if not exists surftrip_join_requests_group_id_idx
  on public.surftrip_join_requests(group_id);
create index if not exists surftrip_join_requests_requester_id_idx
  on public.surftrip_join_requests(requester_id);
create index if not exists surftrip_join_requests_status_idx
  on public.surftrip_join_requests(status);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function public.set_updated_at_surftrip_groups()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_surftrip_groups_set_updated_at on public.surftrip_groups;
create trigger trg_surftrip_groups_set_updated_at
  before update on public.surftrip_groups
  for each row execute function public.set_updated_at_surftrip_groups();

create or replace function public.set_updated_at_surftrip_join_requests()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_surftrip_join_requests_set_updated_at on public.surftrip_join_requests;
create trigger trg_surftrip_join_requests_set_updated_at
  before update on public.surftrip_join_requests
  for each row execute function public.set_updated_at_surftrip_join_requests();

-- ============================================================================
-- Approval trigger: when status flips to 'approved', add the requester to the
-- surftrip_group_members table AND to conversation_members so they land in the
-- chat automatically.
-- ============================================================================
create or replace function public.handle_surftrip_join_request_approval()
returns trigger
language plpgsql
security definer
as $$
declare
  v_conversation_id uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select conversation_id into v_conversation_id
    from public.surftrip_groups where id = new.group_id;

    insert into public.surftrip_group_members (group_id, user_id, role)
    values (new.group_id, new.requester_id, 'member')
    on conflict (group_id, user_id) do nothing;

    if v_conversation_id is not null then
      insert into public.conversation_members (conversation_id, user_id, role)
      values (v_conversation_id, new.requester_id, 'member')
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_surftrip_join_requests_on_approve on public.surftrip_join_requests;
create trigger trg_surftrip_join_requests_on_approve
  after update of status on public.surftrip_join_requests
  for each row execute function public.handle_surftrip_join_request_approval();

-- ============================================================================
-- RLS: surftrip_groups
-- ============================================================================
alter table public.surftrip_groups enable row level security;

drop policy if exists "surftrip_groups readable by authenticated" on public.surftrip_groups;
create policy "surftrip_groups readable by authenticated"
  on public.surftrip_groups for select
  to authenticated
  using (true);

-- Insert is restricted to the security-definer RPC; no direct inserts from clients
-- are needed because create_surftrip_group does the conversation + group +
-- host membership in a single transaction.
drop policy if exists "surftrip_groups host can insert" on public.surftrip_groups;
create policy "surftrip_groups host can insert"
  on public.surftrip_groups for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "surftrip_groups host can update" on public.surftrip_groups;
create policy "surftrip_groups host can update"
  on public.surftrip_groups for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

drop policy if exists "surftrip_groups host can delete" on public.surftrip_groups;
create policy "surftrip_groups host can delete"
  on public.surftrip_groups for delete
  to authenticated
  using (auth.uid() = host_id);

-- ============================================================================
-- RLS: surftrip_group_members
-- ============================================================================
alter table public.surftrip_group_members enable row level security;

drop policy if exists "surftrip_group_members readable by authenticated" on public.surftrip_group_members;
create policy "surftrip_group_members readable by authenticated"
  on public.surftrip_group_members for select
  to authenticated
  using (true);

-- Direct inserts: only the host can self-add as 'host' on group creation.
-- All other inserts (members, on approval) flow through the security-definer trigger.
drop policy if exists "surftrip_group_members host can insert host row" on public.surftrip_group_members;
create policy "surftrip_group_members host can insert host row"
  on public.surftrip_group_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and role = 'host'
    and auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
  );

-- Update: host can change any role; admins can promote member->admin only.
drop policy if exists "surftrip_group_members host can update role" on public.surftrip_group_members;
create policy "surftrip_group_members host can update role"
  on public.surftrip_group_members for update
  to authenticated
  using (
    auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
  )
  with check (
    auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
  );

-- Delete: self-leave OR host removes anyone OR admin removes a member (not host/admin).
drop policy if exists "surftrip_group_members self or host or admin can delete" on public.surftrip_group_members;
create policy "surftrip_group_members self or host or admin can delete"
  on public.surftrip_group_members for delete
  to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
    or (
      role = 'member'
      and exists (
        select 1 from public.surftrip_group_members m
        where m.group_id = surftrip_group_members.group_id
          and m.user_id = auth.uid()
          and m.role = 'admin'
      )
    )
  );

-- ============================================================================
-- RLS: surftrip_join_requests
-- ============================================================================
alter table public.surftrip_join_requests enable row level security;

drop policy if exists "surftrip_join_requests readable by requester host or admin" on public.surftrip_join_requests;
create policy "surftrip_join_requests readable by requester host or admin"
  on public.surftrip_join_requests for select
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
    or exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_join_requests.group_id
        and m.user_id = auth.uid()
        and m.role in ('host','admin')
    )
  );

drop policy if exists "surftrip_join_requests requester can insert pending" on public.surftrip_join_requests;
create policy "surftrip_join_requests requester can insert pending"
  on public.surftrip_join_requests for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    and auth.uid() <> (select host_id from public.surftrip_groups where id = group_id)
    and not exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_join_requests.group_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "surftrip_join_requests host or admin can review" on public.surftrip_join_requests;
create policy "surftrip_join_requests host or admin can review"
  on public.surftrip_join_requests for update
  to authenticated
  using (
    auth.uid() = (select host_id from public.surftrip_groups where id = group_id)
    or exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_join_requests.group_id
        and m.user_id = auth.uid()
        and m.role in ('host','admin')
    )
  )
  with check (
    status in ('approved','declined')
  );

drop policy if exists "surftrip_join_requests requester can withdraw" on public.surftrip_join_requests;
create policy "surftrip_join_requests requester can withdraw"
  on public.surftrip_join_requests for update
  to authenticated
  using (auth.uid() = requester_id)
  with check (auth.uid() = requester_id and status = 'withdrawn');

-- ============================================================================
-- RPC: create_surftrip_group
-- Creates the conversation row, the surftrip_groups row, the host membership
-- in both surftrip_group_members and conversation_members — all atomically.
-- Returns the new group row.
-- ============================================================================
create or replace function public.create_surftrip_group(
  p_name text,
  p_description text default null,
  p_hero_image_url text default null
)
returns public.surftrip_groups
language plpgsql
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_conversation_id uuid;
  v_group public.surftrip_groups;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  insert into public.conversations (is_direct, title, created_by, metadata)
  values (false, trim(p_name), v_user, jsonb_build_object('surftrip', true))
  returning id into v_conversation_id;

  insert into public.surftrip_groups (conversation_id, host_id, name, description, hero_image_url)
  values (v_conversation_id, v_user, trim(p_name), p_description, p_hero_image_url)
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

grant execute on function public.create_surftrip_group(text, text, text) to authenticated;

-- ============================================================================
-- RPC: get_surftrips_for_user
-- Returns every active surftrip + computed is_member flag and member_count.
-- Used to populate the surftrips tab with My / Browse sections in one query.
-- ============================================================================
create or replace function public.get_surftrips_for_user(p_user uuid)
returns table (
  id uuid,
  conversation_id uuid,
  host_id uuid,
  name text,
  description text,
  hero_image_url text,
  status text,
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

-- ============================================================================
-- Storage bucket: surftrip-images
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('surftrip-images', 'surftrip-images', true)
on conflict (id) do nothing;

drop policy if exists "surftrip-images authenticated can upload" on storage.objects;
create policy "surftrip-images authenticated can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'surftrip-images');

drop policy if exists "surftrip-images authenticated can update own" on storage.objects;
create policy "surftrip-images authenticated can update own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'surftrip-images' and owner = auth.uid());

drop policy if exists "surftrip-images authenticated can delete own" on storage.objects;
create policy "surftrip-images authenticated can delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'surftrip-images' and owner = auth.uid());

drop policy if exists "surftrip-images public read" on storage.objects;
create policy "surftrip-images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'surftrip-images');
