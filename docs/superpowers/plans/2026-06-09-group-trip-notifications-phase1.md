# Group Trip Notifications — Phase 1 (Push Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the push outbox queue + cron dispatcher, and turn every push-channel feed event from the plan into a queued, deduped, mute-aware phone alert — without touching the bell UI or its realtime.

**Architecture:** Every trip event already writes a row to `public.notifications` (the bell). We add **one** `AFTER INSERT` trigger on that table which, for push-channel types, drops a row into a new `public.notification_queue`. A cron edge function (`dispatch-notification-queue`, ~every minute) drains the queue, applies the NOW smart rules (priority, dedup-vs-feed, mute, collapse), and sends to Expo. Because the existing only-Ohad `BEFORE INSERT` gate drops non-Ohad feed rows before our `AFTER INSERT` enqueue runs, the push queue is automatically Ohad-only during rollout — no separate push gate needed. New events that have no clean DB signal (member left vs removed — both are identical `DELETE`s) are driven from the app layer where the distinction is known.

**Tech Stack:** Postgres (SECURITY DEFINER triggers, pg_cron, pg_net, Vault), Supabase Edge Functions (Deno + supabase-js v2), Expo Push API, jest-expo for pure-logic unit tests.

**References (read before starting):**
- Spec: `docs/superpowers/specs/2026-06-09-group-trip-notifications-revised-design.md`
- Plan source of truth: `group-trip-notifications-plan.html`
- Existing triggers + only-Ohad gate: `supabase/migrations/20260601010000_notification_center.sql`
- Existing push fn pattern (Expo send, mute check, token cleanup): `supabase/functions/send-trip-request-notification/index.ts`
- Existing cron pattern (pg_net + Vault + anon JWT): `supabase/migrations/20260606_secure_onboarding_cron.sql`
- Client notif types/renderer: `src/services/notifications/notificationsService.ts`
- Leave/remove/cancel call sites: `src/services/trips/groupTripsService.ts` (`leaveTrip` ~1185, `removeParticipant` ~1244, `cancelTrip` ~696)

**Project constants (this Supabase project):**
- Ref / functions base URL: `https://rfdhtvcmagsbxqntnepv.supabase.co`
- Anon JWT (public, satisfies the gateway `verify_jwt`): reuse the literal in `20260606_secure_onboarding_cron.sql:32`.
- Vault secret `admin_function_secret` already exists (= `ADMIN_FUNCTION_SECRET` edge secret).

**⚠️ Project conventions:**
- Migrations are **applied by hand in the SQL editor**, never `supabase db push`. Each migration file is also a reference copy. (memory: `project_migrations_applied_manually`)
- Edge functions are deployed by **copy-paste** into the Supabase dashboard; the repo file is a reference copy. Live may be ahead of repo — download + diff before pasting. (memory: `project_swelly_trip_planning_copy_drift`)
- Public RPCs are PostgREST-callable by anon/authenticated — `REVOKE EXECUTE` or verify the caller inside. (memory: `project_rpc_execute_revoke`)
- Ohad reviews & commits manually — **do not `git commit`** unless asked. (The commit steps below are written for completeness; in practice, stop and let Ohad commit.)
- No smoke tests that fire real pushes to real users. (memory: `feedback_smoke_tests_real_users`)

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `supabase/migrations/20260609000000_notification_queue.sql` | new | Queue table, RLS, indexes |
| `supabase/migrations/20260609000100_notification_push_mapping.sql` | new | `notification_push_priority()` mapping fn + enqueue `AFTER INSERT` trigger |
| `supabase/migrations/20260609000050_notification_new_event_triggers.sql` | new | enum additions (`member_left`,`trip_cancelled`,`member_removed`), `trip_cancelled` trigger, shared personal-gear trigger, `fn_notify_member_left` RPC |
| `supabase/migrations/20260609000300_schedule_notification_dispatcher.sql` | new | pg_cron job (~1 min) → dispatcher |
| `supabase/functions/dispatch-notification-queue/index.ts` | new | Cron-driven dispatcher: drain, rules, send |
| `supabase/functions/dispatch-notification-queue/render.ts` | new | Pure `renderPush(type, data, tripTitle)` → {title, body}; unit-tested |
| `supabase/functions/send-trip-removed-notification/index.ts` | modify | Insert a `member_removed` feed row (folds removal into the queue); keep direct push until cutover |
| `src/services/trips/groupTripsService.ts` | modify | `leaveTrip` calls `fn_notify_member_left` RPC |
| `src/services/notifications/notificationsService.ts` | modify | Add new types to `NotificationType` union + renderer entries |
| `supabase/functions/dispatch-notification-queue/__tests__/render.test.ts` | new | jest unit tests for `renderPush` |
| `supabase/tests/notifications_phase1_queue.sql` | new | SQL regression: mapping fn + enqueue trigger + new triggers |

---

## Task 1: `notification_queue` table

**Files:**
- Create: `supabase/migrations/20260609000000_notification_queue.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- notification_queue — push outbox. One row = one intended push.
-- Server-internal: written by the enqueue trigger (SECURITY DEFINER), read &
-- updated only by the dispatcher (service role). NO client access.
-- ============================================================================
create table if not exists public.notification_queue (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.users(id) on delete cascade,
  trip_id         uuid references public.group_trips(id) on delete cascade,
  type            public.notification_type not null,
  priority        smallint not null default 1,        -- 0 = urgent (send now) · 1 = normal (held) · 2 = re-engagement (Phase 3)
  dedup_key       text not null,
  notification_id uuid references public.notifications(id) on delete cascade,
  send_after      timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending','sent','skipped')),
  skip_reason     text,                                -- read_in_feed | muted | no_token | device_unregistered | shadow
  payload         jsonb not null default '{}'::jsonb,  -- {title, body} actually sent (audit)
  created_at      timestamptz not null default now(),
  sent_at         timestamptz                          -- also the "sent log" for the LATER frequency cap
);

-- Drain query: pending + due, urgent first.
create index if not exists idx_notification_queue_due
  on public.notification_queue (status, send_after, priority);
-- Future frequency cap (Phase 2): count recent sends per user.
create index if not exists idx_notification_queue_sentlog
  on public.notification_queue (recipient_id, sent_at) where status = 'sent';
-- Dedup: at most one PENDING push per (recipient, type, entity) at a time.
create unique index if not exists uq_notification_queue_pending_dedup
  on public.notification_queue (dedup_key) where status = 'pending';

-- RLS: service-role only. Clients never touch this table.
alter table public.notification_queue enable row level security;
revoke all on public.notification_queue from anon, authenticated;
-- (no policies → authenticated/anon get nothing; service role bypasses RLS)
```

- [ ] **Step 2: Apply by hand in the Supabase SQL editor**

Paste the file into the SQL editor and run. Expected: `CREATE TABLE` / `CREATE INDEX` succeed, no errors.

- [ ] **Step 3: Verify the table + RLS exist**

Run in SQL editor:
```sql
select count(*) from public.notification_queue;                       -- 0
select relrowsecurity from pg_class where relname = 'notification_queue'; -- t
```
Expected: `0` rows, RLS = `t`.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add supabase/migrations/20260609000000_notification_queue.sql
git commit -m "feat(notifications): add notification_queue push outbox table"
```

---

## Task 2: push-priority mapping function

This single function is the source of truth for "does this type push, and how urgently" — read straight from the plan's Channel column + the NOW priority triage. Returns `-1` = no push (feed only), `0` = urgent, `1` = normal.

**Files:**
- Create: `supabase/migrations/20260609000100_notification_push_mapping.sql` (mapping fn part)
- Test: `supabase/tests/notifications_phase1_queue.sql` (mapping assertions)

- [ ] **Step 1: Write the failing SQL test (mapping)**

Create `supabase/tests/notifications_phase1_queue.sql` with:
```sql
-- Phase 1 queue regression. Run in SQL editor against a DB with the migrations applied.
-- Each block raises an exception if the expectation fails.
do $$
begin
  -- urgent (decisions / about-them)
  assert public.notification_push_priority('join_request_received', '{}'::jsonb) = 0, 'join_request_received should be P0';
  assert public.notification_push_priority('join_request_decided', '{"decision":"approved"}'::jsonb) = 0, 'approved join should be P0';
  assert public.notification_push_priority('join_request_decided', '{"decision":"declined"}'::jsonb) = 1, 'declined join should be P1';
  assert public.notification_push_priority('commitment_request_received', '{}'::jsonb) = 0, 'commit request P0';
  assert public.notification_push_priority('commitment_decided', '{"decision":"approved"}'::jsonb) = 0, 'commit approved P0';
  assert public.notification_push_priority('commitment_decided', '{"decision":"declined"}'::jsonb) = -1, 'commit declined is FEED ONLY (2.9)';
  assert public.notification_push_priority('gear_request_received', '{}'::jsonb) = 0, 'gear request P0';
  assert public.notification_push_priority('trip_cancelled', '{}'::jsonb) = 0, 'cancelled P0';
  assert public.notification_push_priority('member_removed', '{}'::jsonb) = 0, 'removed P0';
  -- normal
  assert public.notification_push_priority('member_committed', '{}'::jsonb) = 1, 'member_committed P1';
  assert public.notification_push_priority('gear_request_decided', '{}'::jsonb) = 1, 'gear decided P1';
  assert public.notification_push_priority('admin_update_posted', '{}'::jsonb) = 1, 'admin update P1';
  assert public.notification_push_priority('group_gear_updated', '{}'::jsonb) = 1, 'group gear P1';
  assert public.notification_push_priority('personal_gear_updated', '{}'::jsonb) = 1, 'personal gear P1';
  assert public.notification_push_priority('member_left', '{}'::jsonb) = 1, 'member_left P1';
  -- feed only (no push in Phase 1)
  assert public.notification_push_priority('member_joined', '{}'::jsonb) = -1, 'member_joined push is LATER (batched)';
  assert public.notification_push_priority('gear_claimed', '{}'::jsonb) = -1, 'gear_claimed is feed only';
  raise notice 'notification_push_priority: all assertions passed';
end $$;
```

- [ ] **Step 2: Run it to confirm it fails**

Paste the test block into the SQL editor (the new enum values from Task 7 must exist first — if running tests before Task 7, comment out the `trip_cancelled`/`member_removed`/`member_left` lines). Expected: ERROR `function public.notification_push_priority(...) does not exist`.

- [ ] **Step 3: Write the mapping function**

Add to `supabase/migrations/20260609000100_notification_push_mapping.sql`:
```sql
-- ============================================================================
-- Push channel + priority, read from group-trip-notifications-plan.html.
--   returns -1 = feed only (no push) · 0 = urgent (send now) · 1 = normal (held)
-- Phase 1 = event-driven only. Time-based types (trip_ended/trip_reminder) and
-- batched member_joined push arrive in Phase 2 — they return -1 here for now.
-- ============================================================================
create or replace function public.notification_push_priority(
  p_type public.notification_type,
  p_data jsonb
) returns smallint
language sql immutable as $$
  select case p_type
    when 'join_request_received'        then 0      -- 1.1 host decision
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end  -- 1.2 / 1.3
    when 'commitment_request_received'  then 0      -- 2.7 host decision
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end -- 2.8 push / 2.9 feed-only
    when 'member_committed'             then 1      -- 2.8 momentum to others
    when 'gear_request_received'        then 0      -- 2.10 host decision
    when 'gear_request_decided'         then 1      -- 2.11
    when 'admin_update_posted'          then 1      -- 2.1
    when 'group_gear_updated'           then 1      -- 2.5
    when 'personal_gear_updated'        then 1      -- 2.2
    when 'member_left'                  then 1      -- 1.6
    when 'trip_cancelled'               then 0      -- 5.2
    when 'member_removed'               then 0      -- 5.3
    -- feed only in Phase 1:
    when 'member_joined'                then -1     -- 1.4 push is LATER (batched)
    when 'gear_claimed'                 then -1     -- 2.4 feed only
    else -1
  end::smallint;
$$;
```
Note: `member_left`/`trip_cancelled`/`member_removed` are enum values created in Task 7. Apply Task 7's enum block before this if running standalone (Postgres validates the `when` labels against the enum at function creation? No — they are string literals cast to the enum at call time, so creation succeeds, but calls with a missing label error. Apply Task 7 enum additions first to be safe.)

- [ ] **Step 4: Apply the migration by hand, then re-run the test block**

Expected: `NOTICE: notification_push_priority: all assertions passed`, no exception.

- [ ] **Step 5: Commit** *(or hand to Ohad)*

```bash
git add supabase/migrations/20260609000100_notification_push_mapping.sql supabase/tests/notifications_phase1_queue.sql
git commit -m "feat(notifications): push channel+priority mapping fn (+SQL test)"
```

---

## Task 3: enqueue trigger on `notifications`

One `AFTER INSERT` trigger mirrors every push-worthy feed row into the queue. Runs after the only-Ohad `BEFORE INSERT` gate, so non-Ohad rows are already filtered out.

**Files:**
- Modify: `supabase/migrations/20260609000100_notification_push_mapping.sql` (append trigger)
- Test: `supabase/tests/notifications_phase1_queue.sql` (append enqueue assertions)

- [ ] **Step 1: Write the failing SQL test (enqueue)**

Append to `supabase/tests/notifications_phase1_queue.sql`:
```sql
-- Enqueue trigger: inserting a push-channel feed row for Ohad creates exactly one
-- pending queue row; a feed-only type creates none. Uses Ohad's id (the only-Ohad
-- gate lets only his rows through, which is also what we want to assert on).
do $$
declare v_ohad uuid; v_trip uuid; v_before int; v_after int; v_qrow public.notification_queue%rowtype;
begin
  select id into v_ohad from public.users where lower(email)='ohad.storfer@gmail.com' limit 1;
  select id into v_trip from public.group_trips limit 1;  -- any trip for FK
  assert v_ohad is not null, 'Ohad user missing';

  -- push-channel type → 1 queue row, priority 0, pending, linked
  select count(*) into v_before from public.notification_queue;
  insert into public.notifications (recipient_id, trip_id, type, audience, data)
  values (v_ohad, v_trip, 'commitment_request_received', 'admin', '{}'::jsonb)
  returning id into v_qrow.notification_id;  -- reuse var to capture the feed id
  select count(*) into v_after from public.notification_queue;
  assert v_after = v_before + 1, 'push-channel insert should enqueue exactly 1 row';
  select * into v_qrow from public.notification_queue where notification_id = v_qrow.notification_id;
  assert v_qrow.priority = 0 and v_qrow.status = 'pending', 'queued row should be P0 pending';

  -- feed-only type → 0 queue rows
  select count(*) into v_before from public.notification_queue;
  insert into public.notifications (recipient_id, trip_id, type, audience, data)
  values (v_ohad, v_trip, 'gear_claimed', 'user', '{}'::jsonb);
  select count(*) into v_after from public.notification_queue;
  assert v_after = v_before, 'feed-only insert should NOT enqueue';

  raise notice 'enqueue trigger: all assertions passed';
  rollback;  -- keep prod clean
end $$;
```
(The trailing `rollback` inside a `do` block is illegal; instead wrap the whole block in an explicit transaction in the editor: `begin;` … run the `do $$ … $$;` without the rollback … then `rollback;`. Adjust when running.)

- [ ] **Step 2: Run it to confirm it fails**

In the SQL editor: `begin;` then the `do` block (without `rollback`), then check. Expected: assertion fails / no enqueue happens because the trigger doesn't exist yet. `rollback;` after.

- [ ] **Step 3: Write the enqueue trigger**

Append to `supabase/migrations/20260609000100_notification_push_mapping.sql`:
```sql
-- ============================================================================
-- Enqueue a push intent for every push-channel feed row.
-- Runs AFTER INSERT, so it only sees rows that survived the only-Ohad gate.
-- send_after: now() for urgent (P0), now()+60s for normal (P1 dedup window).
-- dedup_key: one pending push per (recipient, type, entity).
-- ============================================================================
create or replace function public.tg_enqueue_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prio smallint;
begin
  v_prio := public.notification_push_priority(new.type, new.data);
  if v_prio < 0 then
    return new;  -- feed-only
  end if;
  insert into public.notification_queue
    (recipient_id, trip_id, type, priority, dedup_key, notification_id, send_after)
  values (
    new.recipient_id, new.trip_id, new.type, v_prio,
    new.recipient_id::text || ':' || new.type::text || ':' || coalesce(new.entity_id::text, new.id::text),
    new.id,
    case when v_prio = 0 then now() else now() + interval '60 seconds' end
  )
  on conflict (dedup_key) where status = 'pending' do nothing;  -- collapse duplicate pending pushes
  return new;
end $$;
drop trigger if exists trg_enqueue_push on public.notifications;
create trigger trg_enqueue_push after insert on public.notifications
for each row execute function public.tg_enqueue_push();
```

- [ ] **Step 4: Apply by hand, re-run the test transaction**

Expected: `NOTICE: enqueue trigger: all assertions passed`, then you `rollback;`.

- [ ] **Step 5: Commit** *(or hand to Ohad)*

```bash
git add supabase/migrations/20260609000100_notification_push_mapping.sql supabase/tests/notifications_phase1_queue.sql
git commit -m "feat(notifications): enqueue-push AFTER INSERT trigger on notifications"
```

---

## Task 4: dispatcher render module (pure, unit-tested)

Push title/body live in one pure function so they're testable without a DB or network.

**Files:**
- Create: `supabase/functions/dispatch-notification-queue/render.ts`
- Test: `supabase/functions/dispatch-notification-queue/__tests__/render.test.ts`

- [ ] **Step 1: Write the failing jest test**

```ts
import { renderPush } from '../render';

describe('renderPush', () => {
  it('approved join request is celebratory and names the trip', () => {
    const r = renderPush('join_request_decided', { decision: 'approved' }, 'Costa Rica Camp');
    expect(r.title).toMatch(/in/i);
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('new join request names the requester and trip', () => {
    const r = renderPush('join_request_received', { actor_name: 'Johnny' }, 'Costa Rica Camp');
    expect(r.body).toContain('Johnny');
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('cancelled trip is clear', () => {
    const r = renderPush('trip_cancelled', {}, 'Costa Rica Camp');
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('unknown type falls back without throwing', () => {
    const r = renderPush('member_joined', {}, 'X');
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest supabase/functions/dispatch-notification-queue/__tests__/render.test.ts`
Expected: FAIL — cannot find module `../render`.

- [ ] **Step 3: Write `render.ts`**

```ts
// Pure push-text renderer. No DB/network — easy to unit test.
// `data` is the frozen notifications.data snapshot; `tripTitle` is fetched by the
// dispatcher (some triggers don't store the title in data).
type PushText = { title: string; body: string };

export function renderPush(type: string, data: Record<string, any>, tripTitle: string): PushText {
  const trip = tripTitle || 'your trip';
  const actor = data?.actor_name || 'Someone';
  const item = data?.item_name || data?.gear_name || 'an item';
  const decision = data?.decision;

  switch (type) {
    case 'join_request_received':
      return { title: 'New trip request', body: `${actor} wants to join ${trip}` };
    case 'join_request_decided':
      return decision === 'approved'
        ? { title: "You're in! 🌊", body: `Your request to join ${trip} was approved` }
        : { title: 'Trip request update', body: `Your request for ${trip} wasn't accepted this time` };
    case 'commitment_request_received':
      return { title: 'Commit request', body: `${actor} wants to commit to ${trip}` };
    case 'commitment_decided': // only the approved path reaches push (see mapping)
      return { title: "You're locked in 🤙", body: `Your commitment to ${trip} was approved` };
    case 'member_committed':
      return { title: `${trip}`, body: `${actor} just committed — the group is filling up` };
    case 'gear_request_received':
      return { title: 'Gear request', body: `${actor} proposed "${item}" for ${trip}` };
    case 'gear_request_decided':
      return decision === 'approved'
        ? { title: 'Gear approved', body: `"${item}" was added — claim it in ${trip}` }
        : { title: 'Gear update', body: `"${item}" wasn't added to ${trip}` };
    case 'admin_update_posted':
      return { title: `Update in ${trip}`, body: data?.preview || 'The host posted an update' };
    case 'group_gear_updated':
      return { title: 'Gear list updated', body: `The group gear list changed in ${trip}` };
    case 'personal_gear_updated':
      return { title: 'Your packing list', body: `Your packing list for ${trip} was updated` };
    case 'member_left':
      return { title: 'A spot opened', body: `${actor} left ${trip} — invite or refill` };
    case 'trip_cancelled':
      return { title: 'Trip cancelled', body: `${trip} was cancelled — see why` };
    case 'member_removed':
      return { title: 'Trip update', body: `You're no longer part of ${trip}` };
    default:
      return { title: trip, body: 'You have a new trip update' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest supabase/functions/dispatch-notification-queue/__tests__/render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** *(or hand to Ohad)*

```bash
git add supabase/functions/dispatch-notification-queue/render.ts supabase/functions/dispatch-notification-queue/__tests__/render.test.ts
git commit -m "feat(notifications): pure push renderer + unit tests"
```

---

## Task 5: dispatcher edge function (drain + rules + send)

**Files:**
- Create: `supabase/functions/dispatch-notification-queue/index.ts`

- [ ] **Step 1: Write the dispatcher**

```ts
// ⚠️ MANUAL DEPLOY: copy-paste into the Supabase dashboard. Download + diff first.
// Cron-driven (~1 min). Drains notification_queue, applies the NOW smart rules
// (SR8 priority via send_after, SR4 dedup-vs-feed, SR6 mute, SR5 collapse), sends to Expo.
// SHADOW MODE: if env NOTIFICATIONS_QUEUE_SHADOW='true', renders + marks rows
// skipped:'shadow' WITHOUT calling Expo (legacy push path still serves users).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderPush } from "./render.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");
const SHADOW = (Deno.env.get("NOTIFICATIONS_QUEUE_SHADOW") || "").toLowerCase() === "true";
const BATCH = 100;

async function isTripMuted(supabase: any, tripId: string | null, userId: string): Promise<boolean> {
  if (!tripId) return false;
  const { data: conv } = await supabase
    .from("conversations").select("id").eq("metadata->>trip_id", tripId).maybeSingle();
  if (!conv?.id) return false; // no conversation → nothing muted → send
  const { data: member } = await supabase
    .from("conversation_members").select("preferences")
    .eq("conversation_id", conv.id).eq("user_id", userId).maybeSingle();
  const raw = member?.preferences?.muted_until;
  if (!raw) return false;
  const ms = Date.parse(raw);
  return !isNaN(ms) && ms > Date.now();
}

async function mark(supabase: any, id: string, status: string, skip_reason: string | null, payload?: any) {
  await supabase.from("notification_queue").update({
    status, skip_reason,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    payload: payload ?? {},
  }).eq("id", id);
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  // Auth: accept service-role bearer OR x-internal-secret == ADMIN_FUNCTION_SECRET. Fails closed.
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SUPABASE_SERVICE_ROLE_KEY.length > 0 && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const secretOk = expected.length > 0 && provided === expected;
  if (!bearerOk && !secretOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Drain: pending + due, urgent first.
  const { data: rows, error } = await supabase
    .from("notification_queue")
    .select("id, recipient_id, trip_id, type, priority, notification_id")
    .eq("status", "pending")
    .lte("send_after", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let sent = 0, skipped = 0;
  for (const row of rows ?? []) {
    // SR4 dedup-vs-feed: if they already read the linked feed row, drop the push.
    let feedData: Record<string, any> = {};
    if (row.notification_id) {
      const { data: notif } = await supabase
        .from("notifications").select("read_at, data").eq("id", row.notification_id).maybeSingle();
      if (notif?.read_at) { await mark(supabase, row.id, "skipped", "read_in_feed"); skipped++; continue; }
      feedData = notif?.data ?? {};
    }
    // SR6 mute
    if (await isTripMuted(supabase, row.trip_id, row.recipient_id)) {
      await mark(supabase, row.id, "skipped", "muted"); skipped++; continue;
    }
    // Trip title for the render (some triggers don't store it in data)
    let tripTitle = feedData.trip_title || "";
    if (!tripTitle && row.trip_id) {
      const { data: trip } = await supabase.from("group_trips").select("title").eq("id", row.trip_id).maybeSingle();
      tripTitle = trip?.title || "";
    }
    const text = renderPush(row.type, feedData, tripTitle);

    if (SHADOW) { await mark(supabase, row.id, "skipped", "shadow", text); skipped++; continue; }

    // Token
    const { data: surfer } = await supabase
      .from("surfers").select("expo_push_token").eq("user_id", row.recipient_id).maybeSingle();
    const token = surfer?.expo_push_token;
    if (!token) { await mark(supabase, row.id, "skipped", "no_token"); skipped++; continue; }

    // SR5 collapse: one live push per trip.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers,
      body: JSON.stringify({
        to: token, title: text.title, body: text.body, sound: "default",
        collapseId: row.trip_id || undefined,
        data: { type: row.type, tripId: row.trip_id, notificationId: row.notification_id },
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (result?.data?.status === "error" && result?.data?.details?.error === "DeviceNotRegistered") {
      await supabase.from("surfers").update({ expo_push_token: null }).eq("user_id", row.recipient_id);
      await mark(supabase, row.id, "skipped", "device_unregistered"); skipped++; continue;
    }
    await mark(supabase, row.id, "sent", null, text); sent++;
  }

  console.log(`[dispatch ${reqId}] sent=${sent} skipped=${skipped} shadow=${SHADOW}`);
  return new Response(JSON.stringify({ sent, skipped, shadow: SHADOW, request_id: reqId }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy in SHADOW mode**

In the Supabase dashboard: create function `dispatch-notification-queue`, paste both `render.ts` and `index.ts`. Set edge-function secret `NOTIFICATIONS_QUEUE_SHADOW=true`. (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_FUNCTION_SECRET`, `EXPO_ACCESS_TOKEN` already exist.)

- [ ] **Step 3: Manually invoke once and verify it drains without sending**

First seed one queued row for Ohad (SQL editor):
```sql
insert into public.notifications (recipient_id, trip_id, type, audience, data)
select id, (select id from public.group_trips limit 1), 'commitment_request_received', 'admin', '{"actor_name":"Test"}'::jsonb
from public.users where lower(email)='ohad.storfer@gmail.com';
```
Then invoke (replace `<secret>` with ADMIN_FUNCTION_SECRET):
```bash
curl -s -X POST https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/dispatch-notification-queue \
  -H "x-internal-secret: <secret>" -H "Content-Type: application/json" -d '{}'
```
Expected JSON: `{"sent":0,"skipped":1,"shadow":true,...}`. Verify the queue row is now `status='skipped', skip_reason='shadow'` with a rendered `payload`. **No phone alert fires** (shadow).

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add supabase/functions/dispatch-notification-queue/index.ts
git commit -m "feat(notifications): queue dispatcher edge function (shadow-capable)"
```

---

## Task 6: schedule the dispatcher (pg_cron, ~1 min)

**Files:**
- Create: `supabase/migrations/20260609000300_schedule_notification_dispatcher.sql`

- [ ] **Step 1: Write the schedule migration** (mirrors `20260606_secure_onboarding_cron.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-notification-queue-1min') THEN
    PERFORM cron.unschedule('dispatch-notification-queue-1min');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-notification-queue-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/dispatch-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Apply by hand in the SQL editor**

Expected: one row from `cron.schedule` (the job id).

- [ ] **Step 3: Verify it runs (shadow)**

Seed one Ohad row as in Task 5 Step 3, wait ~70s, then:
```sql
select status, skip_reason from public.notification_queue order by created_at desc limit 1;  -- skipped / shadow
select status, return_message from net._http_response order by created at desc limit 1;       -- 200
```
Expected: the row flips to `skipped/shadow` automatically (cron drove it), no phone alert.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add supabase/migrations/20260609000300_schedule_notification_dispatcher.sql
git commit -m "feat(notifications): pg_cron schedule for queue dispatcher"
```

---

## Task 7: enum additions + clean new-event triggers (cancelled, shared personal gear)

**Files:**
- Create: `supabase/migrations/20260609000050_notification_new_event_triggers.sql`
- Test: append to `supabase/tests/notifications_phase1_queue.sql`

- [ ] **Step 1: Write enum additions + triggers**

```sql
-- New notification types for Phase 1.
alter type public.notification_type add value if not exists 'member_left';
alter type public.notification_type add value if not exists 'trip_cancelled';
alter type public.notification_type add value if not exists 'member_removed';

-- 5.2 trip_cancelled — host sets group_trips.status='cancelled'.
--   Recipients per plan: members + pending requesters, NOT the host.
create or replace function public.tg_notify_trip_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if new.status = 'cancelled' and new.status is distinct from old.status then
    v_title := new.title;
    -- members (excluding host)
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', v_title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id;
    -- pending requesters (excluding anyone already a participant, and the host)
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select jr.requester_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', v_title)
    from public.group_trip_join_requests jr
    where jr.trip_id = new.id and jr.status = 'pending'
      and jr.requester_id <> new.host_id
      and not exists (select 1 from public.group_trip_participants p
                      where p.trip_id = new.id and p.user_id = jr.requester_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_cancelled on public.group_trips;
create trigger trg_trip_cancelled after update of status on public.group_trips
for each row execute function public.tg_notify_trip_cancelled();

-- 2.2 personal gear — host edits the SHARED personal-gear checklist
--   (group_trips.personal_gear_host_suggestion). Fan out to all members (not host).
--   Reuses the personal_gear_updated type (push P1).
create or replace function public.tg_notify_shared_personal_gear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.personal_gear_host_suggestion is distinct from old.personal_gear_host_suggestion then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'personal_gear_updated', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', new.title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_shared_personal_gear on public.group_trips;
create trigger trg_shared_personal_gear after update of personal_gear_host_suggestion on public.group_trips
for each row execute function public.tg_notify_shared_personal_gear();

-- 1.6 member_left — driven from the app (leaveTrip), since a DELETE on
--   group_trip_participants is indistinguishable from a host removal.
--   SECURITY DEFINER + caller check: only a current participant of p_trip_id may
--   announce their own departure; notifies the host.
create or replace function public.fn_notify_member_left(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  if not exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid()
  ) then
    raise exception 'not a participant of this trip';
  end if;
  select host_id, title into v_host, v_title from public.group_trips where id = p_trip_id;
  if v_host is null or v_host = auth.uid() then
    return;  -- host leaving is not a "member left" event
  end if;
  v_name := public.user_display_name(auth.uid());
  -- entity_id = the leaver, so the enqueue dedup_key (recipient:type:entity) is stable
  -- (a null entity_id would fall back to the unique feed-row id and defeat dedup).
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (v_host, p_trip_id, 'member_left', 'admin', auth.uid(), 'participant', auth.uid(),
          jsonb_build_object('actor_name', v_name, 'trip_title', v_title));
end $$;
revoke all on function public.fn_notify_member_left(uuid) from public;
grant execute on function public.fn_notify_member_left(uuid) to authenticated;
```

- [ ] **Step 2: Append the failing SQL test**

Append to `supabase/tests/notifications_phase1_queue.sql`:
```sql
-- trip_cancelled fans out to members + pending requesters, not the host.
-- (Run inside begin;/rollback; — mutates data. Pick a trip you own as host=Ohad
--  or substitute ids. Asserts at least the host gets NO row.)
do $$
declare v_ohad uuid; v_trip uuid; v_host_rows int;
begin
  select id into v_ohad from public.users where lower(email)='ohad.storfer@gmail.com' limit 1;
  select id into v_trip from public.group_trips where host_id = v_ohad limit 1;
  if v_trip is null then raise notice 'skip trip_cancelled test: Ohad hosts no trip'; return; end if;
  update public.group_trips set status='cancelled' where id = v_trip;
  select count(*) into v_host_rows from public.notifications
   where trip_id = v_trip and type='trip_cancelled' and recipient_id = v_ohad;
  assert v_host_rows = 0, 'host should NOT get trip_cancelled';
  raise notice 'trip_cancelled trigger: host correctly excluded';
end $$;
```

- [ ] **Step 3: Apply by hand; run the test transaction**

`begin;` → run both `do` blocks → expect notices, no assertion error → `rollback;`.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add supabase/migrations/20260609000050_notification_new_event_triggers.sql supabase/tests/notifications_phase1_queue.sql
git commit -m "feat(notifications): cancelled + shared-personal-gear triggers + member_left RPC"
```

---

## Task 8: wire `leaveTrip` → `fn_notify_member_left`

**Files:**
- Modify: `src/services/trips/groupTripsService.ts` (`leaveTrip`, ~1185-1236)

- [ ] **Step 1: Add the RPC call BEFORE the participant delete**

In `leaveTrip`, immediately before the `group_trip_participants` delete (line ~1203), add:
```ts
// Notify the host that a member left (opens a spot). Best-effort: never block leaving.
// Must run BEFORE the delete — fn_notify_member_left verifies the caller is still a participant.
try {
  await supabase.rpc('fn_notify_member_left', { p_trip_id: tripId });
} catch (e) {
  console.warn('[leaveTrip] member_left notify failed (non-fatal):', e);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verify (shadow)**

As Ohad, join a trip Ohad hosts with a second test account, then have the member leave. In SQL editor:
```sql
select type, recipient_id from public.notifications where type='member_left' order by created_at desc limit 1;
```
Expected: one `member_left` row to the host (only persists if host = Ohad due to the gate). The queue row is `skipped/shadow`.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add src/services/trips/groupTripsService.ts
git commit -m "feat(notifications): leaveTrip notifies host (member_left)"
```

---

## Task 9: fold `member_removed` feed row into the removal edge function

Removal is known only at the app layer; the existing `send-trip-removed-notification` already runs there. Add a `member_removed` feed insert (which auto-enqueues the push). Keep the existing direct push until cutover so users aren't left without the alert during shadow.

**Files:**
- Modify: `supabase/functions/send-trip-removed-notification/index.ts`

- [ ] **Step 1: Insert the feed row (service role bypasses RLS; only-Ohad gate still applies)**

After the function verifies the caller is the host and has resolved `trip_id` + `removed_user_id`, and before/after the existing direct push, add:
```ts
// Feed row for the removed user (5.3). The AFTER INSERT enqueue trigger turns this
// into a queued push (P0). The only-Ohad gate still filters during rollout.
{
  const { data: trip } = await supabase
    .from('group_trips').select('title').eq('id', trip_id).maybeSingle();
  await supabase.from('notifications').insert({
    recipient_id: removed_user_id,
    trip_id,
    type: 'member_removed',
    audience: 'user',
    entity_type: 'group_trip',
    entity_id: trip_id,
    data: { trip_title: trip?.title ?? null },
  });
}
```

- [ ] **Step 2: Deploy (copy-paste) — download + diff the live version first**

Live may be ahead of repo. Diff, merge, paste.

- [ ] **Step 3: Manual verify**

As host (Ohad), remove a test member (the removed user must be Ohad to survive the gate during shadow — i.e., test with Ohad as the removed user on a trip Ohad doesn't host, or temporarily verify the insert path via SQL). Confirm a `member_removed` row appears and a `skipped/shadow` queue row is created.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add supabase/functions/send-trip-removed-notification/index.ts
git commit -m "feat(notifications): removal writes member_removed feed row (enqueues push)"
```

---

## Task 10: client types + renderer entries for the new feed types

So the new types render correctly in the bell (not just push).

**Files:**
- Modify: `src/services/notifications/notificationsService.ts` (union ~14-26 + the render map)

- [ ] **Step 1: Extend the union**

```ts
export type NotificationType =
  | 'member_joined'
  | 'member_committed'
  | 'gear_claimed'
  | 'admin_update_posted'
  | 'group_gear_updated'
  | 'personal_gear_updated'
  | 'gear_request_decided'
  | 'commitment_decided'
  | 'join_request_decided'
  | 'join_request_received'
  | 'gear_request_received'
  | 'commitment_request_received'
  | 'member_left'
  | 'trip_cancelled'
  | 'member_removed';
```

- [ ] **Step 2: Add bell render cases**

Find the function that maps a `NotificationRow` to `RenderedNotification` (the `render`/`renderNotification` switch in this file). Add cases consistent with the existing ones:
```ts
case 'member_left':
  return { title: 'A member left', body: `${actor} left ${trip}`, icon: 'exit-outline' };
case 'trip_cancelled':
  return { title: 'Trip cancelled', body: `${trip} was cancelled`, icon: 'close-circle-outline' };
case 'member_removed':
  return { title: 'Removed from trip', body: `You're no longer part of ${trip}`, icon: 'remove-circle-outline' };
```
(Match the exact variable names used by the surrounding cases for actor/trip — adapt `actor`/`trip` to whatever the existing switch destructures from `row.data`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors; the `NotificationType` switch is now exhaustive again.

- [ ] **Step 4: Commit** *(or hand to Ohad)*

```bash
git add src/services/notifications/notificationsService.ts
git commit -m "feat(notifications): bell rendering for member_left/trip_cancelled/member_removed"
```

---

## Task 11: shadow soak, then cutover to live

**Files:**
- Modify (cutover): edge secret `NOTIFICATIONS_QUEUE_SHADOW`; Supabase DB webhooks for `send-trip-request-notification` + the direct push in `send-trip-removed-notification`.

- [ ] **Step 1: Soak in shadow (no code change)**

For ~1–2 days, exercise events as Ohad. Query parity:
```sql
select type, status, skip_reason, count(*)
from public.notification_queue
group by 1,2,3 order by 1;
```
Expected: push-channel events all show up as `skipped/shadow` (would-send), with sane rendered `payload`. Confirm dedup (no duplicate pending), and that read-in-bell rows show `skipped/read_in_feed` when you open the bell within the 60s window.

- [ ] **Step 2: Flip to live**

Set edge secret `NOTIFICATIONS_QUEUE_SHADOW=false`. Re-run Task 5 Step 3 seed → invoke → expect a **real** phone alert to Ohad and `status='sent'`.

- [ ] **Step 3: Retire the overlapping legacy push paths (avoid double-send)**

- In the Supabase dashboard, **disable the DB webhook** that calls `send-trip-request-notification` (1.1 now flows through the queue via `join_request_received`).
- In `send-trip-removed-notification/index.ts`, **remove the direct Expo `fetch` send** (the `member_removed` feed row now drives the push); keep only the feed insert. Re-deploy.
- Leave `send-push-notification` (chat) and `send-reaction-notification` untouched — they intentionally stay on their own instant path (spec §4 / row 4.1).

- [ ] **Step 4: Verify no duplicate pushes**

Trigger a join request and a removal as Ohad. Expect exactly **one** phone alert each (from the dispatcher, not the retired functions).

- [ ] **Step 5: Commit** *(or hand to Ohad)*

```bash
git add supabase/functions/send-trip-removed-notification/index.ts
git commit -m "chore(notifications): cutover to queue dispatcher; retire overlapping legacy push"
```

---

## Out of scope (later plans)

- **Phase 2:** date-based cron (2.3 commit nudges, 2.6 unclaimed gear, 3.1/3.2/3.3 reminders, 5.1 trip ended), SR1 batch (unlocks 1.4 push), SR3 quiet hours, SR2 frequency cap.
- **Phase 3:** re-engagement RE1–4 + guardrails G1–G5, SR7 preferences UI + per-category opt-out.
- **Going live for everyone:** removing `trg_notifications_only_ohad` (feed gate) — a separate, deliberate launch step (memory: `project_notifications_testing_safety`). Until then both feed and queue stay Ohad-only.

---

## Self-review notes (done during authoring)

- **Spec coverage:** every Phase-1 row in the spec catalog maps to a task — existing push-channel types via Tasks 2–3 (mapping + enqueue), 5.2/2.2 via Task 7, 1.6 via Tasks 7–8, 5.3 via Task 9, dispatcher/rules via Tasks 4–6, cutover via Task 11. Phase-2/3 rows explicitly deferred above.
- **Smart rules:** SR8 (priority/send_after) Task 3; SR4 (dedup-vs-feed) Task 5; SR6 (mute) Task 5; SR5 (collapse) Task 5. SR1/2/3/7 deferred per triage.
- **Type consistency:** `notification_push_priority(type, data)`, `tg_enqueue_push`, `renderPush(type, data, tripTitle)`, queue columns, and the new enum values are referenced identically across tasks.
- **Open items carried from spec §9:** (3) the legacy per-participant `personal_gear_updated` trigger is left in place alongside the new shared-list trigger — verify during Task 7 whether the per-participant event still fires before considering its removal (out of scope here). (1)/(2) timezone + dormancy are Phase 2/3.
```
