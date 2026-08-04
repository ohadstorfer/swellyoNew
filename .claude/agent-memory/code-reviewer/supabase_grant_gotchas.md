---
name: supabase-grant-gotchas
description: Two verified Supabase-default-privilege traps to check on EVERY migration review in this repo — `revoke from public, anon` is not enough, and new columns on users/participants are client-writable.
metadata:
  type: project
---

Verified live against prod on 2026-08-03 (`pg_default_acl`, `pg_class.relacl`, `pg_policies`).

**Trap 1 — `revoke ... from public, anon` leaves `authenticated` holding the grant.**
This project's `pg_default_acl` grants explicitly to `anon`, `authenticated` AND
`service_role` on every new table (`arwdDxtm`) and every new function (`X`) in
schema `public`. So:
- A new table gets `authenticated = arwdDxtm` — INSERT/UPDATE/DELETE **and TRUNCATE**
  (TRUNCATE is not gated by RLS). `revoke all ... from anon, public` does nothing to it.
- A new SECURITY DEFINER function keeps `authenticated = X` after `revoke ... from public, anon`.

House convention (see `supabase/migrations/revoke_security_definer_execute_hardening.sql`
and `20260724000100_operator_requirements.sql`): **revoke from `anon, authenticated`
(and `public` for functions), then grant back narrowly.** Flag any migration that
only names `public, anon`.

**Trap 2 — new columns inherit permissive RLS, so they are client-writable.**
`public.users` has `users_update_own` (`auth.uid() = id`, no column scope) plus a
table-level UPDATE grant, and `users_select_authenticated` is `using (true)`.
`public.group_trip_participants` has `user updates self` (`auth.uid() = user_id`,
checks only that `role` is unchanged) plus a table-level grant.
RLS policies **cannot** restrict columns — only grants can. So any money/trust
column added to those tables (price, commission, `*_enabled` flags, provider account
ids) is readable and writable by the end user unless the migration also does
`revoke update on <table> from authenticated; grant update (<explicit column list>) ...`
or blocks it with a trigger. Always ask "who can write this new column?" before
approving a schema addition. See [[payments_migration_review]].

**How to apply:** run these two checks on every `supabase/migrations/*.sql` review.
Both are one live query away:
`select relacl from pg_class where relname = '<t>';` and
`select cmd, qual, with_check from pg_policies where tablename = '<t>';`
The CLI works read-only without extra setup: `supabase db query --linked "<sql>"`.
