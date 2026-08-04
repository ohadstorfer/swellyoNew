---
name: is-trip-host-vs-host-id-split
description: is_trip_host() means "any promoted admin"; group_trips.host_id means "the one primary host". Any money/liability check must use host_id, not is_trip_host.
metadata:
  type: project
---

Swellyo has TWO different "host" identities and they are not interchangeable:

- `public.is_trip_host(trip_id)` = `exists (select 1 from group_trip_participants
  where trip_id = ? and user_id = auth.uid() and role = 'host')`. That is the
  PRIMARY host **plus every traveler the host promoted via TripMemberSheet's
  "Set as admin"** (flat multi-host, `20260708000000`, LIVE).
- `group_trips.host_id` = the single primary host. This is who
  `stripe-connect-onboard` lets connect a payout account and who
  `payments-checkout` pays (`operator_payout_accounts` keyed on `trip.host_id`).

**Why:** the Stripe work authorised price writes (`operator_set_traveler_price`,
`freeze_traveler_price`) on `is_trip_host`, so any promoted admin can set their
own `price_total_usd = 0` and pass every pay requirement — while the person
actually out of pocket is the `host_id` operator, who gets no notification and
has no audit trail (prices are not versioned or logged). "Set as admin" is
presented to operators as a co-leader role, not as financial authority.

**How to apply:** on any check that decides who owes money, who is paid, or who
may change an amount, ask which of the two identities is meant. Default to
`host_id` for anything financial and to `is_trip_host` only for operational
permissions (reviewing documents, editing requirements, removing members).
See [[payments-migration-review]] and [[supabase-grant-gotchas]].

## Two traps when "fix it by using host_id" is the answer (found 2026-08-03)

1. **`host_id` is itself seizable by the untrusted set.** The `group_trips host
   can update` policy is `using (is_trip_host(id)) with check (is_trip_host(id))`
   and `guard_primary_trip_host` only requires the NEW `host_id` to be *a*
   current host. So a promoted admin can `PATCH group_trips?id=eq.X
   {"host_id": "<self>"}` and become the operator of record — after which
   `payments-checkout` routes every traveler payment to their own
   `operator_payout_accounts` row. Authorising on `host_id` is only as strong as
   the write path to that column.
2. **A trigger that pins columns "unless you are a host" is a hole, not a
   guard.** `freeze_traveler_price` pins `price_total_usd` / `deposit_usd` /
   `price_set_by` only on the `not is_trip_host(...)` branch, and returns `new`
   untouched for hosts. Since `authenticated` holds default ALL on
   `group_trip_participants` and its UPDATE policy is self-only with a WITH CHECK
   that pins only `role`, a promoted admin can PATCH their OWN row to
   `price_total_usd = 0`. Hardening the RPC does nothing about the direct
   PostgREST route — always ask "what else can write this column?" before
   calling an RPC-level check a fix.
3. **`host_id` moves on its own — blocking the direct PATCH is not enough.**
   `sync_primary_trip_host` (AFTER UPDATE OR DELETE on `group_trip_participants`,
   `20260708000000`) reassigns `host_id` to the longest-tenured remaining
   `role = 'host'` participant the moment the current holder stops being one. Two
   client-reachable ways for a promoted admin to make that happen, both wired to
   buttons in `TripMemberSheet` (`canManage = viewerIsHost && !isSelf`):
   `demote_trip_host(trip, operator)` (SECURITY DEFINER, gated only on
   `is_trip_host`) and a plain DELETE of the operator's participant row (the
   DELETE policy is `auth.uid() = user_id or is_trip_host(trip_id)`). Both leave
   the attacker as the sole host, so `host_id` becomes theirs.
   A `pg_trigger_depth() <= 1` guard on `guard_primary_trip_host` does NOT stop
   this — the internal reassignment is exactly the depth-2 path it whitelists.
   The guard has to live on `group_trip_participants` (refuse to demote/remove the
   `host_id` participant unless `auth.uid()` is null or is that participant), not
   on `group_trips`.
