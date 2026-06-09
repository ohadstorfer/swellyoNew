# Group Trip Notifications — Phase 2 (Date Reminders, Nudges, Local Timing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

> ⚠️ **NO GIT IN PHASE 2.** Do **not** `git add`, `commit`, or `push` anything in this plan. Leave every change uncommitted in the working tree for Ohad to review. (There are deliberately no commit steps below.)

**Goal:** Add time-based reminders & nudges (trip in a week / tomorrow / today, commit nudges, gear-unclaimed nudges, trip-ended) via a daily cron, plus the LATER smart rules (batch, frequency cap) and **real per-user quiet hours** driven by the device timezone — all flowing through the Phase-1 queue + dispatcher.

**Architecture (validated against industry practice — see "Research basis"):** This is the **per-user precomputed `send_after`** pattern (what SuprSend/Courier/Customer.io use). The queue + dispatcher from Phase 1 are unchanged in shape. Phase 2 adds:
1. `surfers.timezone` (IANA string, e.g. `America/Sao_Paulo`) captured from the device on boot **and on every foreground**.
2. **Quiet hours computed at ENQUEUE time, in Postgres** (`AT TIME ZONE` uses native IANA tzdata → DST-correct): `tg_enqueue_push` sets a non-urgent push's `send_after` to the recipient's **next 8am local** (urgent P0 bypasses; unknown tz → next 8am UTC). The dispatcher drain is unchanged — it already gates on `send_after <= now()`.
3. A daily `scan-trip-reminders` edge fn that enqueues the date reminders/nudges (idempotent).
4. Two **dispatcher-side** rules only: **SR1 batch** (collapse same-(user,trip) non-urgent rows into one digest — also unlocks 1.4) and **SR2 frequency cap** (≤3 non-urgent/24h, defer over the cap).

**Tech Stack:** Postgres (pg_cron, `AT TIME ZONE`), Supabase Edge Functions (Deno), expo-localization, Expo Push, jest-expo.

**Depends on:** Phase 1 applied & live in shadow. Spec: `docs/superpowers/specs/2026-06-09-group-trip-notifications-revised-design.md` (resolves open-Q#1: timezone = device IANA string).

**Grounded schema facts (verified):**
- `group_trips.start_date`, `end_date` (date), `dates_set_in_stone`, `status` (`active`/`cancelled`/`completed`). Reminders apply only to `status='active'` trips with `start_date IS NOT NULL` (loose `date_months`-only trips skipped).
- `group_trip_participants.commitment_status` (`none`/`pending`/`approved`) → uncommitted = `<> 'approved'`.
- Gear unclaimed = `needed_qty > COALESCE(sum(claims.quantity),0)`.
- `surfers.expo_push_token` exists; **no** timezone column yet (added Task 1).

**⚠️ Project conventions:** migrations applied by hand (SQL editor, never `db push`); edge fns deploy via CLI/copy-paste (download+diff live first); **no git commits in this plan**; no smoke tests at real users. Everything stays **Ohad-only + shadow** until launch, so reminders are safe to soak.

---

## Research basis (why this design)

From a survey of Braze, OneSignal, Customer.io, SuprSend, Iterable, Headspace, Duolingo (full sourced report in this session):
- **Store IANA tz strings, never fixed UTC offsets** — offsets break at DST/region rule changes; IANA is the universal consensus for *future scheduled* delivery. (Store UTC for past events, IANA for future local-time delivery.)
- **Two valid scheduling patterns:** (A) hourly per-timezone bucket scan, or (C) per-user precomputed `send_after` UTC. **Our queue is already pattern C** — recommended for our scale; pattern A adds an hourly cron + tz-indexed scan + local-date dedup we don't need.
- **Quiet hours = 8am–9pm local; defer (not drop)** non-urgent to next morning. Transactional/urgent bypass. (TCPA/industry standard window.)
- **Unknown tz → sensible default, not UTC-send-now.** We use next-8am-**UTC** so quiet hours hold even without a real tz.
- **Skip Send-Time-Optimization / ML now** — needs months of per-user engagement history; "fixed local hour + quiet hours" is the 80/20. (Duolingo's bandit optimizes *which message*, not the hour.)
- **Pitfalls handled:** DST (Postgres `AT TIME ZONE` applies current rules at eval time); Hermes caches `Intl.DateTimeFormat().resolvedOptions().timeZone` → use `expo-localization.getCalendars()[0].timeZone` and refresh on foreground; idempotency via feed-row-existence per (recipient,trip,type,stage) + stage-aware `dedup_key`.

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `supabase/migrations/20260610000000_phase2_tz_enum.sql` | new | `surfers.timezone` col + `trip_reminder`/`trip_ended` enum (separate file so the enum commits before use) |
| `supabase/migrations/20260610000050_phase2_quiethours_enqueue.sql` | new | `next_quiet_window()`; quiet-hours + stage-aware `tg_enqueue_push`; extend `notification_push_priority` |
| `supabase/migrations/20260610000100_schedule_trip_reminders.sql` | new | pg_cron → `scan-trip-reminders` (daily) |
| `supabase/functions/scan-trip-reminders/index.ts` | new | Daily scan: enqueue reminders/nudges (idempotent) |
| `supabase/functions/scan-trip-reminders/reminders.ts` | new | Pure stage logic (unit-tested) |
| `supabase/functions/dispatch-notification-queue/index.ts` | modify | Add SR1 batch + SR2 freq cap (quiet hours already handled at enqueue) |
| `supabase/functions/dispatch-notification-queue/render.ts` | modify | `trip_reminder` (per stage), `trip_ended`, commit/gear copy |
| `src/services/notifications/deviceTimezone.ts` | new | Read device IANA tz; upsert to `surfers.timezone`; foreground refresh |
| `src/components/AppContent.tsx` (boot path) | modify | Call `syncDeviceTimezone()` on authed boot + on AppState `active` |
| `src/services/notifications/notificationsService.ts` | modify | Union + bell rendering for `trip_reminder`,`trip_ended` |
| `supabase/functions/scan-trip-reminders/__tests__/reminders.test.ts` | new | Stage logic tests |
| `supabase/tests/notifications_phase2.sql` | new | SQL checks: tz col, enum, `next_quiet_window`, stage-aware dedup, gear-unclaimed |

---

## Task 1: schema — timezone, enum, quiet-hours enqueue

**Files:** Create `supabase/migrations/20260610000000_phase2_tz_enum_quiethours.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 1) Per-user IANA timezone, captured from the device. Null until first app open post-deploy.
alter table public.surfers add column if not exists timezone text;

-- 2) New notification types.
alter type public.notification_type add value if not exists 'trip_reminder';
alter type public.notification_type add value if not exists 'trip_ended';

-- 3) Next allowed send instant for a NON-URGENT push, honoring 8am–9pm local quiet hours.
--    Uses Postgres native IANA tzdata (DST-correct). Unknown/invalid tz → next 8am UTC.
create or replace function public.next_quiet_window(p_tz text)
returns timestamptz language plpgsql stable as $$
declare v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
        v_local timestamp; v_hour int; v_target timestamp;
begin
  begin
    v_local := now() at time zone v_tz;          -- wall-clock in their zone
  exception when others then                      -- bad/renamed zone → UTC
    v_tz := 'UTC'; v_local := now() at time zone 'UTC';
  end;
  v_hour := extract(hour from v_local)::int;
  if v_hour >= 8 and v_hour < 21 then
    return now();                                 -- inside window → send now
  end if;
  v_target := date_trunc('day', v_local) + interval '8 hours'
            + case when v_hour >= 21 then interval '1 day' else interval '0' end;
  return v_target at time zone v_tz;              -- wall-clock → timestamptz
end $$;

-- 4) Enqueue: quiet-hours-aware send_after for non-urgent; stage-aware dedup_key.
create or replace function public.tg_enqueue_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prio smallint; v_tz text; v_send_after timestamptz;
begin
  v_prio := public.notification_push_priority(new.type, new.data);
  if v_prio < 0 then
    return new;                                   -- feed-only
  end if;
  if v_prio = 0 then
    v_send_after := now();                        -- urgent: bypass quiet hours
  else
    select timezone into v_tz from public.surfers where user_id = new.recipient_id;
    v_send_after := public.next_quiet_window(v_tz);
  end if;
  insert into public.notification_queue
    (recipient_id, trip_id, type, priority, dedup_key, notification_id, send_after)
  values (
    new.recipient_id, new.trip_id, new.type, v_prio,
    new.recipient_id::text || ':' || new.type::text || ':'
      || coalesce(new.entity_id::text, new.id::text)
      || coalesce(':' || (new.data->>'stage'), ''),   -- stage-aware (week vs tomorrow vs ...)
    new.id, v_send_after
  )
  on conflict (dedup_key) where status = 'pending' do nothing;
  return new;
end $$;

-- 5) Priorities for the new types (normal → obey quiet hours / batch / cap).
create or replace function public.notification_push_priority(
  p_type public.notification_type, p_data jsonb
) returns smallint language sql immutable as $$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end
    when 'member_committed'             then 1
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 1
    when 'admin_update_posted'          then 1
    when 'group_gear_updated'           then 1
    when 'personal_gear_updated'        then 1
    when 'member_left'                  then 1
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_reminder'                then 1
    when 'trip_ended'                   then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;
```

- [ ] **Step 2: Apply by hand (SQL editor).** Run the file (alter-type add-value is fine — nothing here uses the new value as data).

- [ ] **Step 3: Verify** (SQL editor)
```sql
select column_name from information_schema.columns where table_name='surfers' and column_name='timezone';  -- 1 row
-- quiet-window sanity: a São Paulo (UTC-3) user at night gets a future 8am-local; a null tz gets next 8am UTC
select public.next_quiet_window('America/Sao_Paulo') >= now() as ok_tz,
       public.next_quiet_window(null) >= now() as ok_null;   -- both t (or now() if currently daytime)
```

---

## Task 2: capture device timezone → `surfers.timezone` (boot + foreground)

**Files:** Create `src/services/notifications/deviceTimezone.ts`; wire into boot + AppState.

- [ ] **Step 1: Write the helper**
```ts
import * as Localization from 'expo-localization';
import { supabase } from '../../config/supabase';

/** Best-effort: write the device's IANA timezone to surfers.timezone. Cheap, idempotent, never throws.
 *  Use expo-localization (native) — NOT Intl, which Hermes caches stale after a tz change. */
export async function syncDeviceTimezone(userId: string): Promise<void> {
  try {
    const tz = Localization.getCalendars?.()[0]?.timeZone || null; // IANA string or null (web)
    if (!tz) return;
    const { data } = await supabase.from('surfers').select('timezone').eq('user_id', userId).maybeSingle();
    if (data?.timezone === tz) return;
    await supabase.from('surfers').update({ timezone: tz }).eq('user_id', userId);
  } catch (e) {
    console.warn('[deviceTimezone] sync failed (non-fatal):', e);
  }
}
```

- [ ] **Step 2: Call on authed boot AND foreground.** Where the app has the signed-in user id at startup (next to `registerForPushNotifications()`), add a fire-and-forget call, plus an `AppState` listener so it refreshes if the user travels:
```ts
import { AppState } from 'react-native';
import { syncDeviceTimezone } from '../services/notifications/deviceTimezone';
// ...once we have the authenticated userId:
syncDeviceTimezone(userId);
const sub = AppState.addEventListener('change', (s) => { if (s === 'active') syncDeviceTimezone(userId); });
// clean up `sub.remove()` on unmount / logout, mirroring nearby listeners.
```

- [ ] **Step 3: Type-check** `npx tsc --noEmit` (no new errors). Confirm `expo-localization` is installed (`npx expo install expo-localization` if not).

---

## Task 3: reminder stage logic (pure, unit-tested)

**Files:** Create `supabase/functions/scan-trip-reminders/reminders.ts` + `__tests__/reminders.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { reminderStagesForTrip } from '../reminders';
describe('reminderStagesForTrip', () => {
  it('week at 7, tomorrow at 1, today at 0', () => {
    expect(reminderStagesForTrip(7, null, true)).toContain('week');
    expect(reminderStagesForTrip(1, null, false)).toContain('tomorrow');
    expect(reminderStagesForTrip(0, null, false)).toContain('today');
  });
  it('commit nudge at 30/15/10/5 only when uncommitted', () => {
    expect(reminderStagesForTrip(15, null, true)).toContain('commit_15');
    expect(reminderStagesForTrip(15, null, false)).not.toContain('commit_15');
  });
  it('gear nudge at 10/5/3/1 only when unclaimed', () => {
    expect(reminderStagesForTrip(3, true, false)).toContain('gear_3');
    expect(reminderStagesForTrip(3, false, false)).not.toContain('gear_3');
  });
  it('ended when end was today', () => {
    expect(reminderStagesForTrip(99, null, false, 0)).toContain('ended');
  });
  it('[] on a non-milestone day', () => {
    expect(reminderStagesForTrip(9, true, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fails.** `npx jest supabase/functions/scan-trip-reminders/__tests__/reminders.test.ts`

- [ ] **Step 3: Implement `reminders.ts`**
```ts
// Pure milestone logic. Caller computes the day deltas (UTC date math).
//   daysToStart: start_date - today (>=0 before trip); gearUnclaimed: bool|null;
//   uncommitted: is THIS recipient uncommitted; daysSinceEnd: today - end_date (0 = ended today; omit to skip).
export function reminderStagesForTrip(
  daysToStart: number, gearUnclaimed: boolean | null, uncommitted: boolean, daysSinceEnd?: number,
): string[] {
  const s: string[] = [];
  if (daysToStart === 7) s.push('week');
  if (daysToStart === 1) s.push('tomorrow');
  if (daysToStart === 0) s.push('today');
  if (uncommitted && [30, 15, 10, 5].includes(daysToStart)) s.push(`commit_${daysToStart}`);
  if (gearUnclaimed === true && [10, 5, 3, 1].includes(daysToStart)) s.push(`gear_${daysToStart}`);
  if (daysSinceEnd === 0) s.push('ended');
  return s;
}
```

- [ ] **Step 4: Run → passes.**

---

## Task 4: `scan-trip-reminders` edge function (daily)

Enqueues by inserting `notifications` feed rows (the Phase-1 trigger turns push-channel ones into queue rows with quiet-hours `send_after`). **Idempotent:** skip if a feed row for (recipient, trip, type, stage) already exists.

**Files:** Create `supabase/functions/scan-trip-reminders/index.ts`

- [ ] **Step 1: Write the function**
```ts
// ⚠️ MANUAL DEPLOY (CLI). Daily cron. Enqueues reminders/nudges as trip_reminder/trip_ended feed rows.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reminderStagesForTrip } from "./reminders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function daysBetweenUTC(dateStr: string, b: Date): number {
  const da = new Date(dateStr + "T00:00:00Z").getTime();
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((da - db) / 86400000);
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SERVICE.length > 0 && authHeader === `Bearer ${SERVICE}`;
  if (!(expected.length > 0 && provided === expected) && !bearerOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date();

  const { data: trips } = await supabase
    .from("group_trips").select("id, title, start_date, end_date, status")
    .eq("status", "active").not("start_date", "is", null);

  let inserted = 0;
  for (const trip of trips ?? []) {
    const daysToStart = daysBetweenUTC(trip.start_date, now);
    const daysSinceEnd = trip.end_date ? -daysBetweenUTC(trip.end_date, now) : undefined;

    const { data: items } = await supabase
      .from("group_trip_gear_items").select("id, needed_qty").eq("trip_id", trip.id);
    let gearUnclaimed: boolean | null = null;
    if (items && items.length) {
      const ids = items.map((i: any) => i.id);
      const { data: claims } = await supabase
        .from("group_trip_gear_claims").select("item_id, quantity").in("item_id", ids);
      const claimed: Record<string, number> = {};
      for (const c of claims ?? []) claimed[c.item_id] = (claimed[c.item_id] || 0) + (c.quantity || 0);
      gearUnclaimed = items.some((i: any) => (i.needed_qty || 0) > (claimed[i.id] || 0));
    }

    const { data: parts } = await supabase
      .from("group_trip_participants").select("user_id, role, commitment_status").eq("trip_id", trip.id);

    for (const p of parts ?? []) {
      const stages = reminderStagesForTrip(daysToStart, gearUnclaimed, p.commitment_status !== "approved", daysSinceEnd);
      for (const stage of stages) {
        const type = stage === "ended" ? "trip_ended" : "trip_reminder";
        const { data: existing } = await supabase
          .from("notifications").select("id")
          .eq("recipient_id", p.user_id).eq("trip_id", trip.id).eq("type", type)
          .eq("data->>stage", stage).limit(1).maybeSingle();
        if (existing) continue;
        await supabase.from("notifications").insert({
          recipient_id: p.user_id, trip_id: trip.id, type,
          audience: (p.role === "host" || p.role === "admin") ? "admin" : "user",
          entity_type: "group_trip", entity_id: trip.id,
          data: { trip_title: trip.title, stage },
        });
        inserted++;
      }
    }
  }
  console.log(`[scan-reminders ${reqId}] inserted=${inserted}`);
  return new Response(JSON.stringify({ inserted, request_id: reqId }), { status: 200, headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Deploy via CLI.** `supabase functions deploy scan-trip-reminders --project-ref rfdhtvcmagsbxqntnepv`. (New fn; inert until Task 5's cron. Dispatcher still shadow → no real sends.)

- [ ] **Step 3: Manual smoke (safe).** Invoke with the internal secret → `{inserted: N}`; only Ohad rows persist (gate). Re-invoke → already-sent stages return 0 (idempotent).

---

## Task 5: schedule the scan (pg_cron, daily)

**Files:** Create `supabase/migrations/20260610000100_schedule_trip_reminders.sql`

- [ ] **Step 1: Write the schedule** (mirrors the onboarding cron; off-minute, daily)
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-trip-reminders-daily') THEN
    PERFORM cron.unschedule('scan-trip-reminders-daily');
  END IF;
END $$;
SELECT cron.schedule(
  'scan-trip-reminders-daily',
  '7 6 * * *',  -- 06:07 UTC daily; per-user local timing is set at enqueue via next_quiet_window
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/scan-trip-reminders',
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

- [ ] **Step 2: Apply by hand.** **Step 3: Verify:** `select jobname, schedule from cron.job where jobname='scan-trip-reminders-daily';`

---

## Task 6: dispatcher — SR1 batch + SR2 frequency cap (quiet hours already handled at enqueue)

**Files:** Modify `supabase/functions/dispatch-notification-queue/index.ts`. (No quiet-hours code here — `send_after` already carries it.)

- [ ] **Step 1: SR2 frequency cap.** In the per-row loop, after the mute check and before the token fetch, for `priority > 0`:
```ts
// SR2: ≤3 non-urgent pushes sent per recipient per rolling 24h; defer the rest 6h.
if (row.priority > 0) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await supabase.from("notification_queue")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", row.recipient_id).eq("status", "sent").gte("sent_at", since);
  if ((count ?? 0) >= 3) {
    await supabase.from("notification_queue")
      .update({ send_after: new Date(Date.now() + 6 * 3600000).toISOString() }).eq("id", row.id);
    skipped++; continue;
  }
}
```

- [ ] **Step 2: SR1 batch (collapse).** Before the per-row loop, partition the drained `rows`: group `priority === 1` rows by `(recipient_id, trip_id)`. For any group with ≥2 rows, send **one** push (title = trip, body = `"{N} updates in {trip}"`), reusing the same mute + token + DeviceNotRegistered handling; mark the first `sent`, the rest `skipped:'batched'`. Urgent (priority 0) and singleton groups go through the existing per-row path unchanged.
  - Acceptance: 3 non-urgent rows for one user+trip in a tick → exactly one push; queue shows 1 `sent` + 2 `skipped:batched`.

- [ ] **Step 3: Deploy** the dispatcher (CLI) — still shadow, so behavior is observable via `status`/`skip_reason`/`send_after` without sending.

> Note: `member_joined` push (plan row 1.4) turns on by flipping its mapping-fn priority from `-1` to `1` once batching is verified — a deliberate one-line follow-up, not in this task.

---

## Task 7: render copy for the new types + bell

**Files:** Modify `render.ts` and `notificationsService.ts`.

- [ ] **Step 1: Push cases in `render.ts`** (before `default`)
```ts
case 'trip_reminder': {
  const s = data?.stage || '';
  if (s === 'week')     return { title: `${trip} — 1 week to go`, body: 'Get ready — packing list inside' };
  if (s === 'tomorrow') return { title: `${trip} is tomorrow!`, body: 'Final details + meeting point inside' };
  if (s === 'today')    return { title: `${trip} starts today`, body: 'Have a great trip' };
  if (s.startsWith('commit_')) return { title: `Lock your spot in ${trip}`, body: `${s.split('_')[1]} days out — commit now` };
  if (s.startsWith('gear_'))   return { title: `${trip}: gear still needed`, body: 'Some items still need an owner' };
  return { title: trip, body: 'Trip update' };
}
case 'trip_ended':
  return { title: `${trip} — that's a wrap`, body: 'Share your photos & memories' };
```

- [ ] **Step 2: Union + bell in `notificationsService.ts`.** Add `'trip_reminder' | 'trip_ended'` to `NotificationType`; add bell `case`s (icons e.g. `'time-outline'` / `'images-outline'`), using `d.stage` for the reminder body.

- [ ] **Step 3:** `npx tsc --noEmit` clean.

---

## Task 8: SQL checks + soak

**Files:** Create `supabase/tests/notifications_phase2.sql`

- [ ] **Step 1: Write checks** — `surfers.timezone` exists; `trip_reminder`/`trip_ended` in enum; `next_quiet_window('America/Sao_Paulo')` and `next_quiet_window(null)` both return `>= now()`; stage-aware dedup (insert two `trip_reminder` rows for Ohad with stages `week` and `tomorrow` → **two** pending queue rows, not collapsed); the gear-unclaimed query returns expected for a known trip. (Mutating blocks wrapped in `begin;`/`rollback;`.)

- [ ] **Step 2: Shadow soak.** After the daily scan runs (or a manual invoke), inspect:
```sql
select n.type, n.data->>'stage' stage, q.status, q.skip_reason, q.send_after
from public.notification_queue q join public.notifications n on n.id = q.notification_id
where n.type in ('trip_reminder','trip_ended') order by q.created_at desc limit 20;
```
Confirm: reminders enqueue at the right stages; `send_after` is the recipient's next-8am-local (or `now()` if currently daytime); `skip_reason='shadow'` once drained; no stage duplicates on re-run.

---

## Out of scope (Phase 3)

Re-engagement RE1–4 + guardrails G1–G5, SR7 preferences UI. Dropping the only-Ohad feed gate = the separate go-live step (with the Phase-1 cutover: flip `NOTIFICATIONS_QUEUE_SHADOW=false` + redeploy; retire legacy push).

## Self-review notes

- Spec coverage: 3.1/3.2/3.3 (`week`/`tomorrow`/`today`), 2.3 (`commit_*`), 2.6 (`gear_*`), 5.1 (`trip_ended`); SR3 quiet hours (Task 1 `next_quiet_window`, enqueue-time, per-user IANA), SR1 batch + SR2 cap (Task 6). 1.4 = one-line mapping flip after batch is proven.
- Timing lives in **two** clear places: device→`surfers.timezone` (client) and `next_quiet_window` at enqueue (SQL). Dispatcher drain unchanged. Fallback: unknown tz → next 8am UTC.
- Idempotency: feed-row-existence per (recipient,trip,type,stage) + stage-aware `dedup_key`.
- Gate interaction: enqueue runs after the only-Ohad BEFORE INSERT gate → reminders stay Ohad-only until launch. Safe to soak.
- Matches industry practice (pattern C, IANA, defer-not-drop, no STO) per the Research basis section.
