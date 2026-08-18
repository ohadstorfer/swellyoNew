# Operator Trips — Staff & Permissions

Ohad + Eyal, 2026-08-07. Not built yet. Nothing applied to the DB.

## What this is

An operator trip is run by more than one person. Today only the trip owner can
do anything. We want to add staff — a guide, a manager, a photographer — each
with a different level of access.

We have **not** decided the exact permissions yet. So the permissions must be
**data in the database**, not rules written in code. Changing "can a Guide see
medical status?" must be one `UPDATE`, not a migration plus an app release.

## Decisions already made

| # | Question | Answer |
|---|---|---|
| 1 | Fixed roles, or operators invent their own? | **Fixed 5 tiers.** Their permission sets are editable. |
| 2 | Per trip, or saved per operator? | **Per trip.** Saved team comes later — see [Phase 3](#phase-3--nice-to-have). |
| 3 | Can staff also be a traveler on the same trip? | **No.** Enforced by a trigger. |
| 4 | Can money-edit be given away? | **Operator only by default.** Editable, but only the Operator can edit it. |

## What already exists

Two facts from the current DB. They matter, because tiers 4 and 5 are already
half-built.

| Thing | Gate today | Matches |
|---|---|---|
| Documents, medical, requirements, edit trip | `is_trip_host()` → `group_trip_participants.role = 'host'` | Manager |
| Money: prices, refunds, Stripe, payouts | `group_trips.host_id` (one person) | Operator |

The money split was on purpose. `20260803000000_operator_trip_payments.sql:46-62`
says a promoted host is an **untrusted** set for money, so money was moved off
`is_trip_host()` onto `host_id` alone. This spec must not undo that.

Other facts we build on:

- An operator trip is `group_trips.hosting_style = 'C'`.
- `group_trip_participants` means **traveler**. Capacity, payments and
  requirements all hang off it. Staff must not go in there — see
  [Why a separate table](#why-a-separate-table).
- `is_trip_host()` is also used by normal group trips (social multi-host, live).
  We do not touch that. This spec only changes operator trips.

## Tables

### `organized_trip_staff`

One row per person per trip.

| Column | Notes |
|---|---|
| `id` | pk |
| `trip_id` | fk `group_trips`, must be `hosting_style = 'C'` |
| `user_id` | **nullable** — a Tier 1 "Listed" person has no account |
| `operator_id` | copy of the trip's `host_id` at insert time (see Phase 3) |
| `role_key` | `'listed' \| 'crew' \| 'guide' \| 'manager' \| 'operator'` |
| `display_name` | for Listed people, who have no profile to read from |
| `photo_url` | same |
| `title` | free text shown to travelers, e.g. "Head Guide" |
| `invited_at`, `accepted_at`, `revoked_at` | revoked rows stay for history |

Unique on `(trip_id, user_id)` where `user_id is not null`.

### `organized_trip_staff_roles`

The permission sets. This is the table you edit when you change your mind.

| Column | Notes |
|---|---|
| `role_key` | one of the 5 |
| `operator_id` | **nullable.** `null` = the global default. Non-null = that operator's own version. |
| `capabilities` | `text[]` of capability keys |
| `tier` | int 1–5, for sorting in the UI only — never for permission checks |

Lookup is: the operator's row if there is one, otherwise the global row. Phase 1
only ever writes global rows. The nullable column costs nothing now and means
Phase 3 needs no migration.

### Why a separate table

Staff cannot go in `group_trip_participants`, even though it already has a
`role` column.

That table means traveler everywhere. The capacity trigger counts its rows.
Payment rows point at it. Requirements attach to it. There is already a hack for
this — `20260724000400_operator_requirement_reads.sql:250` notes host rows "are
NOT travelers" and excludes them by hand. Add 5 staff there and every traveler
count, every payment total and every export goes wrong.

## The one gate

Every permission check goes through one function. This is the whole point of the
design — if a check is written anywhere else, permissions stop being editable.

**It must also handle normal group trips.** `is_trip_host()` is shared: 14 RLS
policies on gear, join requests, admin updates and commitments use it, and those
tables serve both trip kinds. If the function falls back to `is_trip_host()` on
non-operator trips, then every one of those policies can be rewritten to call
`trip_staff_can()` with **zero behaviour change** on group trips. That is much
safer than keeping two parallel sets of policies.

```sql
create or replace function public.trip_staff_can(p_trip_id uuid, p_cap text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    -- Not an operator trip: old rules, untouched.
    when not exists (
      select 1 from public.group_trips
      where id = p_trip_id and hosting_style = 'C'
    ) then public.is_trip_host(p_trip_id)
    else
    -- Operator of record: everything, always. Cannot be revoked.
    exists (
      select 1 from public.group_trips
      where id = p_trip_id and host_id = auth.uid()
    )
    or exists (
      select 1
      from public.organized_trip_staff s
      join public.organized_trip_staff_roles r
        on r.role_key = s.role_key
       and (r.operator_id = s.operator_id or r.operator_id is null)
      where s.trip_id = p_trip_id
        and s.user_id = auth.uid()
        and s.accepted_at is not null
        and s.revoked_at is null
        and p_cap = any(r.capabilities)
      order by r.operator_id nulls last
      limit 1
    )
  end;
$$;

revoke execute on function public.trip_staff_can(uuid, text) from public, anon;
grant  execute on function public.trip_staff_can(uuid, text) to authenticated;
```

The `revoke`/`grant` is not optional — see the SECDEF hardening migration. New
functions without an explicit grant return 403.

The client gets one RPC, `my_trip_capabilities(trip_id) returns text[]`, cached
with react-query. The UI hides things from that array. **The array is UX only.**
Every capability must also be enforced by RLS or an RPC check, or a Crew can
just call the API directly and read passports.

## Capability keys

One key per thing. The image groups some of these on one line for display — we
split them, because they are different powers.

| Key | What it means |
|---|---|
| `profile.shown_to_travelers` | name and photo appear on the trip page |
| `roster.view` | can open the trip in the app and see who is on it |
| `travelers.view_profiles` | full profile + emergency contact |
| `travelers.view_stats` | surf and travel stats |
| `chat.participate` | group chat, updates, 1:1 with a traveler |
| `payments.view_status` | who paid, who did not — read only |
| `docs.view` | documents, flights, passports |
| `medical.view` | medical status |
| `trip.edit` | edit trip, gear, required docs |
| `docs.approve` | approve or reject a document |
| `travelers.remove` | remove a traveler from the trip |
| `data.export` | export traveler data |
| `money.manage` | amounts, refunds, cost, deposit, finance export |
| `staff.manage` | invite / edit / remove staff, and edit permission sets |
| `trip.cancel` | cancel the trip |

Once a key is in the DB it is never renamed.

## Default permission sets

Straight from the matrix. These are the seed values — the whole point is that
they can change later without a release.

| | Listed | Crew | Guide | Manager | Operator |
|---|:-:|:-:|:-:|:-:|:-:|
| `profile.shown_to_travelers` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `roster.view` | – | ✓ | ✓ | ✓ | ✓ |
| `travelers.view_profiles` | – | ✓ | ✓ | ✓ | ✓ |
| `travelers.view_stats` | – | – | ✓ | ✓ | ✓ |
| `chat.participate` | – | – | ✓ | ✓ | ✓ |
| `payments.view_status` | – | – | – | ✓ | ✓ |
| `docs.view` | – | – | – | ✓ | ✓ |
| `medical.view` | – | – | – | ✓ | ✓ |
| `trip.edit` | – | – | – | ✓ | ✓ |
| `docs.approve` | – | – | – | ✓ | ✓ |
| `travelers.remove` | – | – | – | ✓ | ✓ |
| `data.export` | – | – | – | ✓ | ✓ |
| `money.manage` | – | – | – | – | ✓ |
| `staff.manage` | – | – | – | – | ✓ |
| `trip.cancel` | – | – | – | – | ✓ |

Note the sets are nested today — each tier has everything the one below has.
**Do not rely on that.** Do not check `tier >= 4`. The permissions are not
decided yet and the nesting will break the first time a Guide needs medical.

## Invariants

- **I1 — The Operator of record cannot be locked out.** `group_trips.host_id`
  gets every capability, from the function itself, not from a row. No config
  mistake can lock an owner out of their own trip.
- **I2 — Only the Operator can write staff or permissions.** `staff.manage` is
  hard-locked to `host_id` and is not readable from an editable set. This is
  what makes decision 4 safe: `money.manage` is editable, but a Manager can
  never grant it to themselves, because they cannot edit anything. No
  self-escalation.
- **I3 — Staff and traveler are exclusive.** A trigger on both tables rejects a
  user who is already on the other side. Decision 3.
- **I4 — Operator trips only.** `trip_staff_can()` is for `hosting_style = 'C'`.
  Normal group trips keep `is_trip_host()` exactly as it is.
- **I5 — Listed is not an account.** `user_id is null` means the row is a credit
  only: a name and a photo shown to travelers. It can never grant access, so
  `trip_staff_can()` never matches it (it joins on `user_id = auth.uid()`).
- **I6 — Staff are invisible to money and capacity.** Different table, so this
  is free — as long as no one adds staff to `group_trip_participants`.
- **I7 — A row-level policy cannot express a column-level rule.**
  `group_trips` UPDATE is `trip_staff_can(id, 'trip.edit')`, which a Manager
  holds — and `cost_per_person`, `deposit_amount`, `payment_mode`, the
  cancellation terms and `status` all live on that row. RLS has no way to say
  "this row, except those columns", so from Phase 2 until 13 August every one of
  them was reachable by anyone who could edit anything. No screen ever did it;
  a direct PostgREST call would have.

  `trg_guard_operator_trip_money` (migration `20260813200000`) closes it. It
  asks the same question every other gate asks — `money.manage` for price,
  payment and refund terms, `trip.cancel` for cancelling — rather than
  hardcoding `host_id`, so the sets stay editable and I1 still means the
  operator always passes. It fires only on a real change (`is distinct from`),
  so an editor that PATCHes the whole row on a title edit is unaffected, and it
  skips writes with no JWT, which are the Stripe webhook and the payments
  functions.

  **The lesson generalises:** when a capability names a *field* rather than a
  table, RLS is not enough on its own. Check for this before granting a tier
  `trip.edit` on anything that also carries money.

## Rollout

### Phase 0 — schema, nothing reads it

Two tables, the function, the seed. Zero behaviour change. Safe to apply alone.

### Phase 1 — move the existing checks onto the gate

Every operator-trip RLS policy and RPC gets rewritten to call
`trip_staff_can()`. Behaviour must come out **identical**:

- everything gated on `host_id` today → `trip_staff_can(id, 'money.manage')`
- everything gated on `is_trip_host()` today → the matching Manager capability

This is the risky phase. It needs a written list of every policy and RPC that
touches an operator trip, checked one by one. Nothing new is granted here.

**Checked on prod, 2026-08-07: zero operator trips have more than one
`role = 'host'` participant.** So on every live operator trip, `host_id` and
`is_trip_host()` are the same single person, and Phase 1 takes nothing away from
anyone. Re-run before applying, in case that changes:

```sql
select t.id, count(*) from group_trips t
join group_trip_participants p on p.trip_id = t.id and p.role = 'host'
where t.hosting_style = 'C' group by t.id having count(*) > 1;
```

### Phase 2 — the feature — BUILT 2026-08-07

`20260807000200_operator_trip_staff_invites.sql` + client. Not applied.

**How someone joins the crew.** Two doors, and the operator picks one up front:

- **They have an account** → a single-use invite link, sent over WhatsApp.
- **They don't** → a Listed credit: a name and a title on the trip page,
  no login, sees nothing. Always tier 1, forced in code.

There is deliberately **no user search**. A search box is an endpoint that
answers "does an account exist for this person?" against a table of real names,
countries and photos — account enumeration. A link asks nobody: the recipient
identifies themselves by signing in.

Invites are **single use**. A reusable "join as Guide" link is one forward away
from four people becoming Guides, and a Guide reads every traveler's profile and
emergency contact. One link, one seat, 14-day expiry, and the operator can see
it was taken. `accept_staff_invite` takes `FOR UPDATE` on the row so two taps
cannot both win.

`peek_staff_invite` returns zero rows for wrong / spent / revoked / expired
alike — all four look identical, so a stale link cannot be used to probe which
tokens once existed.

**What shipped:**

| Piece | File |
|---|---|
| Invites table + 3 RPCs | `20260807000200_operator_trip_staff_invites.sql` |
| Service | `src/services/trips/tripStaffService.ts` |
| Operator's crew sheet | `src/components/trips/TripStaffSheet.tsx` |
| Accept screen | `src/components/trips/StaffInviteAcceptSheet.tsx` |
| Deep link `?staff=<token>` | `src/components/AppContent.tsx` |
| Crew section on Overview | `TripDetailViewRedesigned.tsx` (`crew` prop) |
| Entry point | `TripDetailScreen.tsx` — "Crew" in the ⋮ menu |

The tier picker renders `role.capabilities` **from the database**, never a
hardcoded list — that is what makes the permissions editable. The client owns
only the English for each key (`CAPABILITY_LABELS`).

### Still open after Phase 2

**Staff in the group chat.** `chat.participate` is granted but wired to nothing.
A Guide needs a conversation membership, and that is a separate permission
system from this one. Not started.

**Notifications.** Staff get none. The fan-out uses `trip_admin_ids`, built from
`participants.role = 'host'` — it does not know the staff table exists. So an
invited guide is never told they were invited; the operator has to send them the
link themselves, which is the flow anyway, but a Manager will also miss every
document and payment notification.

### Phase 3 — nice to have

- Per-operator permission sets (`staff_roles.operator_id` is already there).
- Saved team — "my staff" across trips. Because `organized_trip_staff` carries
  `operator_id` from day one, this is a `select distinct` over rows that already
  exist. No migration, no backfill. That is why the column is in Phase 0.

## Open questions

1. **Chat scope for a Guide.** `chat.participate` is one key today. Is group
   chat the same permission as 1:1 with a traveler, or two keys?
2. **Push notifications.** Does a staff member get pushes for their trip? Which
   ones? Right now the notification fan-out uses `trip_admin_ids`, which is
   built from `role = 'host'` — it will not know about staff.
3. **Listed photos.** No account means no profile picture. Does the operator
   upload one? Which bucket?
4. **Top role name.** `Operator` or `Owner`? Affects `role_key`, which is
   painful to change later.
5. **Does a Crew see the roster before the trip starts, or only during?** Time
   windows are not in this model at all. If they are needed, that is a column on
   `organized_trip_staff`, not a capability.

---

# Appendix — the Phase 1 inventory

Read from the **live database** on 2026-08-07, not from the repo. This is the
complete list of what Phase 1 rewrites. Re-run the queries at the bottom before
starting, in case something moved.

## A. Operator-trip tables — these get real capabilities

| Table | Policy | Cmd | Today | Becomes |
|---|---|---|---|---|
| `organized_trip_requirements` | `organized_trip_req_select` | SELECT | `is_trip_host or is_trip_participant` | `trip_staff_can(…,'roster.view') or is_trip_participant` |
| `organized_trip_requirements` | `organized_trip_req_write` | ALL | `is_trip_host` | `'trip.edit'` |
| `organized_trip_travelers_documents` | `otd_select` | SELECT | `own or is_trip_host` | `own or 'docs.view'` |
| `organized_trip_travelers_documents` | `otd_delete` | DELETE | `own or is_trip_host` | `own or 'docs.approve'` |
| `organized_trip_operator_documents` | `otod_select` | SELECT | `is_trip_host or is_trip_participant` | `'roster.view' or is_trip_participant` |
| `organized_trip_operator_documents` | `otod_insert` | INSERT | `is_trip_host` | `'trip.edit'` |
| `organized_trip_medical_forms` | `medical_operator_select` | SELECT | `is_trip_host` | `'medical.view'` |
| `organized_trip_payment_events` | `otpe_read_own` | SELECT | `own or is_trip_host` | `own or 'payments.view_status'` |
| `group_trip_acknowledgements` | `ack_select` | SELECT | `own or is_trip_host` | `own or 'roster.view'` |

## B. Shared tables — mechanical swap, no behaviour change

These serve both trip kinds. Because `trip_staff_can()` falls back to
`is_trip_host()` on non-operator trips, each one becomes a find-and-replace and
group trips are unaffected. Capability for all of them: `trip.edit`, except
`group_trip_participants` DELETE → `travelers.remove`.

`group_trip_admin_updates` (insert/update/delete) · `group_trip_gear_items`
(insert/update/delete) · `group_trip_gear_requests` (update) ·
`group_trip_join_requests` (select/insert/update/delete) ·
`group_trip_commitment_requests` (select/update) · `group_trip_participants`
(delete) · `group_trips` (update)

## C. Functions

**Gated on `host_id` today → `money.manage`.** These are the C3 money set. They
keep working identically because the Operator branch of `trip_staff_can()` is
`host_id` itself.

`operator_set_traveler_price` · `operator_freeze_trip_prices` ·
`freeze_traveler_price` (trigger)

**Gated on `is_trip_host()` today → a real capability:**

| Function | Becomes |
|---|---|
| `operator_approve_documents` | `docs.approve` |
| `operator_reject_document` | `docs.approve` |
| `operator_mark_document_file_deleted` | `docs.approve` |
| `organized_trip_document_counts` | `docs.view` |
| `operator_remind_requirement` | `docs.view` |
| `can_access_group_document` | `docs.view` — **storage gate, see D** |
| `promote_trip_host` / `demote_trip_host` | leave alone — group-trip only |

> `operator_remind_requirement` was going to be `roster.view`. Changed to
> `docs.view`: the Remind button lives on the Dashboard, which is Manager and up
> today, and Phase 1's rule is that behaviour must not change. A Guide sending
> reminders is a Phase 2 decision, and by then it is one `UPDATE`.

### The repo lies about these functions — read the live definition

The repo migration files have drifted from the database. Found while writing
Phase 1, on 2026-08-07:

| | repo (`20260724000400`) | live |
|---|---|---|
| `operator_approve_documents` | `(uuid[])` → `void` | `(uuid[], text)` → `integer` |

Hand-writing a `create or replace` from the repo version would have created a
**second, one-argument overload**, left the real function still gated on
`is_trip_host()`, and broken the client — which passes two arguments and reads
the returned count. Nothing would have errored.

So Phase 1 does not retype any function body. It reads `pg_get_functiondef()`
from the live database, replaces only the gate call, and runs it back, with an
assertion that raises if the expected text is not found. Always
`pg_get_functiondef` before rewriting a function — never the repo file.

## D. Storage — easy to miss

Three policies on `storage.objects` for the `group-trip-documents` bucket. If
these are not moved, a Crew blocked in the table can still pull the file:

- `group docs: traveler or host reads` (SELECT) → via `can_access_group_document(name)`
- `group docs: host uploads operator materials` (INSERT) → `is_trip_host(folder[1])`
- `group docs: traveler or host deletes` (DELETE) → `is_trip_host(folder[1])`

## E. Client

- `src/utils/tripRole.ts` — `isTripHost()` is the single client helper. It ORs
  `trip.host_id === userId` with `participants.role === 'host'`. This becomes
  "read the capability array", not a role guess.
- `src/screens/trips/TripDetailScreen.tsx` — `isHostDerived` (line ~430),
  `isTripOwner` (~700), `canSeeDashboard` (~875). Note the comment at ~694
  already explains why `isTripOwner` is separate from `isHost` — that split is
  exactly Manager vs Operator, done by hand.
- Add `useTripCapabilities(tripId)` on react-query, feed every gate from it.

## F. Not affected

`payments-checkout/index.ts:187-234` reads `trip.host_id` to find the payout
account. That is `host_id` as **payee**, not as permission. Staff never change
who gets paid. Leave it.

## Re-run before starting

```sql
-- policies still gated on is_trip_host
select tablename, policyname, cmd from pg_policies
where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%is_trip_host%';

-- functions still gated on is_trip_host or host_id
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (prosrc ilike '%is_trip_host%' or prosrc ~* 'host_id\s*=\s*auth\.uid');
```
