-- Allow admins (in addition to the host) to edit surftrip group info.
-- The original migration restricted UPDATE to the host. With the admin role
-- promoted via the kebab menu, admins should be able to update name,
-- description, and hero image too.

drop policy if exists "surftrip_groups host can update" on public.surftrip_groups;
drop policy if exists "surftrip_groups host or admin can update" on public.surftrip_groups;

create policy "surftrip_groups host or admin can update"
  on public.surftrip_groups for update
  to authenticated
  using (
    auth.uid() = host_id
    or exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_groups.id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  )
  with check (
    auth.uid() = host_id
    or exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_groups.id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  );
