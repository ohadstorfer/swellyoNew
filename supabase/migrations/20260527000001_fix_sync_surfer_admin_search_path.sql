-- HOTFIX: sign-in broken — "Database error saving new user" (GoTrue 500 on /token).
--
-- Root cause: sync_surfer_admin_flag() (AFTER INSERT OR UPDATE OF role ON
-- public.users) was SECURITY DEFINER but had NO fixed search_path. It referenced
-- the `surfers` table UNQUALIFIED. The role GoTrue uses (supabase_auth_admin) has
-- search_path=auth, so during signup the trigger resolved `surfers` as
-- `auth.surfers` → "relation surfers does not exist" → the auth.users insert
-- transaction aborted → every new signup failed.
--
-- Fix: pin search_path=public AND schema-qualify the table.

create or replace function public.sync_surfer_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.surfers set is_admin = (new.role = 'admin') where user_id = new.id;
  return new;
end;
$$;

-- Belt-and-suspenders: pin search_path on the other signup-chain trigger fn too.
-- (Its body already fully-qualifies public.users, so this is purely defensive —
-- done via ALTER so we don't risk altering its UUID-validation regex.)
alter function public.handle_new_auth_user() set search_path = public;
