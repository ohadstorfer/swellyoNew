---
name: reference_add_notification_type_checklist
description: Full file:line checklist for adding one new group-trip notification type (enum, trigger, push render, client render) — verified 2026-08-18 by tracing trip_cancelled + the Aug 18-19 Connect-status/payment-stuck migrations
metadata:
  type: reference
---

Traced by adding a hypothetical "operator moved the trip dates" traveler-facing,
trip-scoped notification. Closest analogues: `trip_cancelled` (trigger-fired,
trip-scoped, excludes host) and the Aug 18-19 pair `notify_connect_status` /
`operator_payment_stuck` (freshest precedent for the exact CASE-statement style
and the "rebuild the whole function, don't ALTER" discipline).

## 1. The enum
`public.notification_type` in `supabase/migrations/20260601010000_notification_center.sql:11-28`
is a plain Postgres **ENUM**, not a text CHECK constraint. NO double-constraint
trap like `messages` has ([[reference_messages_two_type_constraints]]) —
the enum is the single source of truth.

Extend it in **its own migration file**, alone:
```sql
alter type public.notification_type add value if not exists 'my_new_type';
```
Postgres will not let a new enum value be USED (referenced in a function body)
in the same transaction that adds it — every precedent (20260609000050,
20260713000000, 20260724000000, 20260805000000, 20260818000500,
20260819000000) splits enum-add into its own file, applied/committed before
the file that references it in `notification_push_priority`.

## 2. Push priority — a rebuilt-whole SQL function, not an ALTER
`public.notification_push_priority(p_type notification_type, p_data jsonb)`
is a plain `CREATE OR REPLACE FUNCTION ... AS $$ SELECT CASE p_type ... END $$`.
Every migration that adds a type **copies the entire live CASE list** from the
prior migration and adds ONE line — see 20260819000100 for the freshest full
list (join_request_received through operator_onboarding_stalled). This means:
- You must know the CURRENT full case list before writing the migration (grep
  the latest-dated migration file that touches this function — do not trust
  an older one, live can drift ahead of the repo,
  [[reference_db_functions_repo_drifts_from_live.md]] equivalent).
- `CREATE OR REPLACE` resets the function's grants to the owner + PUBLIC unless
  you re-run the REVOKE/GRANT immediately after (see 20260724000500's tail:
  revoke from public/anon/authenticated, grant to service_role only — this
  function is only ever called by `tg_enqueue_push`).

Priority values: 0 = urgent (bypasses quiet hours), 1 = normal (honors 8am-9pm
local via `next_quiet_window`), -1 = feed only, never pushes.

## 3. The trigger — `trg_trip_cancelled` is the model
Full pattern, `supabase/migrations/20260609000050_notification_new_event_triggers.sql:14-40`:
```sql
create or replace function public.tg_notify_trip_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if new.status = 'cancelled' and new.status is distinct from old.status then
    ...
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', v_title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id;
    ...
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_cancelled on public.group_trips;
create trigger trg_trip_cancelled after update of status on public.group_trips
for each row execute function public.tg_notify_trip_cancelled();
```
Key shape: `security definer set search_path = public`, `after update of <col>`
(column-level trigger — fires whenever that column is in the UPDATE's SET
list, REGARDLESS of whether the value actually changed), so the function body
re-checks `new.X is distinct from old.X` itself. `member_removed` is the
exception — it's written from an edge function
(`supabase/functions/send-trip-removed-notification/index.ts`), not a
trigger, because "someone left" vs "host removed them" are both plain DELETEs
on `group_trip_participants` and indistinguishable at the row level.

Recipient selection for a traveler-facing/trip-scoped type: query
`group_trip_participants where trip_id = new.id and user_id <> new.host_id`
(no `status` filter — `group_trip_participants.status` is only
`'onboarding'`|`'active'`, added 2026-08-10 for a different purpose; ANY row
in this table is a joined member regardless of that status —
[[project_traveler_onboarding]]).

**Known gap to flag, don't silently copy**: since 2026-07-08
([[project_group_trips_host_model_and_surftrip_precedent]] /
`20260708000000_group_trip_multiple_hosts.sql`), `group_trips.host_id` is only
the "primary host" — trips can have co-hosts via
`group_trip_participants.role = 'host'`. `trg_notify_trip_cancelled` predates
that migration and only excludes `new.host_id`, so a co-host today WOULD get
notified about their own trip's cancellation. A new trigger should exclude
`p.role <> 'host'` (all hosts), or use `auth.uid()` as the true actor, not
blindly copy `<> new.host_id`.

Realtime already fires on ANY `group_trips` UPDATE via a separate,
type-agnostic broadcast trigger (`trg_broadcast_trip_change`,
`20260610000001_group_trips_broadcast_trigger.sql:106`) — that's unrelated to
the notification-center row and needs no changes.

## 4. Push rendering — `supabase/functions/dispatch-notification-queue/render.ts`
One `switch (type)` (starts line 57) inside `renderPush()`. Add one `case`,
e.g. modeled on `trip_cancelled` (line 84-85):
```ts
case 'trip_cancelled':
  return { title: 'Your trip was cancelled', body: `${trip} was cancelled by the admin — see why` };
```
`templateKey()` (line 12) and the template-map check (line 44) run BEFORE the
switch — if a `notification_templates` row exists for the type's key, it wins
and the switch case is never reached. **This function is a manually
copy-pasted-to-dashboard Edge Function whose LIVE copy lags the repo**
([[project_dispatch_queue_live_is_behind_repo]]) — the established workaround
(used by `operator_payment_stuck`, `operator_requirement_due_soon`) is to ship
an `insert into public.notification_templates (key, push_title, push_body)
values (...) on conflict (key) do nothing;` in the SAME migration, so push
copy goes live immediately with NO edge-function deploy, and the render.ts
`case` becomes just a documented fallback for if the row is ever deleted.
`notification_templates` currently has very few rows on prod — do NOT apply
the old 24-row seed migration `20260611000200` ([[project_notification_templates_table.md]]).
Bell templates (`bell_title`/`bell_body`) must stay NULL in that insert — a
non-null bell template flattens the client's bold `bodyParts` layout.

## 5. Client rendering — two files, both currently mid-edit on `ohad` (adding
`operator_payment_stuck`), which is the exact same 4-touch shape a new type needs:

`src/services/notifications/notificationsService.ts`:
- `NotificationType` union (starts line 14) — add the string.
- `BELL_TYPE_FLAGS: Record<NotificationType, true>` (line 89) — MUST list it
  or TypeScript's exhaustiveness check fails to compile (this is the
  intentional forcing function per the comment at line 86-88).
- `tripFocusForNotification()` switch (line 178) — if the type should open a
  specific Plan-tab section, add a case; otherwise it silently falls into the
  `default: return 'overview'` (line 234-236) which is correct for a plain
  "something changed" notice like dates moving.
- `renderNotificationDefault()` switch (line 495) — the bell title/body/icon.
  For editable copy, also add the `bellTemplateKey()` variant if the type
  needs a decision/stage split (line 288) — a plain type does not.

`src/components/notifications/NotificationCenter.tsx`:
- **Verified: needs ZERO changes for a plain informational trip-scoped
  type.** It has no per-type icon/avatar switch — icon comes from
  `renderNotification()`'s return value. Its only `n.type ===` branches (lines
  331-370) are for ACTIONABLE types that open a special sheet instead of the
  trip (join/commit/gear requests, trip/staff invites, operator setup/Stripe
  screens) or for `TRIPLESS_PRESSABLE` types with no `trip_id` (line 166). A
  trip-scoped type with a real `trip_id` and no special sheet falls straight
  through to the generic `onOpenTrip(n.trip_id, tripFocusForNotification(...))`
  at line 372 — confirmed by grepping the whole file for `trip_cancelled` /
  `member_removed`: zero matches.

## Grep sweep for stragglers (part 5 of the original ask)
`trip_cancelled`/`member_removed` also appear in: pgTAP-style manual test
`supabase/tests/notifications_phase1_queue.sql` (not CI-run, SQL-editor only —
good precedent to add a same-shaped block, not required), Jest unit test
`supabase/functions/dispatch-notification-queue/__tests__/render.test.ts`
(DOES matter if you want render.ts covered), and several `docs/superpowers/`
planning docs (historical, not load-bearing). NOT found anywhere in
`src/components/notifications/NotificationCenter.tsx` or any deep-link
resolver outside `tripFocusForNotification` — there is no second navigation
map to update.

Related: [[project_notification_templates_table.md]]. Cross-references above
to project/-prefixed slugs (e.g. `project_traveler_onboarding`,
`project_dispatch_queue_live_is_behind_repo`) live in the user's global
auto-memory at `~/.claude/projects/-Users-ohadstorfer-swellyoNative/memory/`,
not in this agent's own memory dir — read them from that absolute path if
needed again.
