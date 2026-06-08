# Group Trip Notifications — Implementation Design

**Date:** 2026-06-08
**Scope:** `group_trips` notifications only
**Goal:** Deliver the notification plan (see `group-trip-notifications-plan.html`) with good UX and "push to action", **without massive/costly realtime usage**.
**Status:** Design approved, pending spec review.

---

## 1. Context & constraints

The app already has a **dual notification system**:

- **Push** — Expo Push via Supabase Edge Functions, triggered by DB webhooks. Token stored in `surfers.expo_push_token`. Mute-aware, stale-token cleanup. (HTTP — cheap.)
- **In-app feed** — `public.notifications` table + a per-user `postgres_changes` realtime subscription (`notifications:${userId}`), surfaced by the existing `NotificationCenter.tsx` (bell + drawer). ~11 Postgres triggers already fan trip events into this table.

**Hard constraint — keep realtime cost low (target: medium scale).**
The cost driver of `postgres_changes` is `change_rate × concurrent_subscribers` (every table change is evaluated against every subscription's RLS). Connections are paid regardless of transport. Therefore:

> **The real saving is in notification *volume*, not transport.** Keep the `notifications` insert rate low (batch, dedup, collapse) and `postgres_changes` stays cheap at medium scale. Broadcast is the documented escape hatch when we outgrow medium (already being built for messaging).

### Decisions locked during brainstorming

- **Feed transport:** keep the **existing** `postgres_changes` subscription. No new realtime. *Fine for medium scale.*
- **Existing notification page is NOT touched.** `NotificationCenter.tsx`, the `notifications` table, the feed subscription, the Approve/Decline cards — all unchanged. New notification types simply land in the same table and appear in the same page.
- **Push dispatch:** **outbox + cron dispatcher with a priority column** (industry best practice adapted to Supabase, which has no always-on worker). One queue; urgent items skip the batching window.
- **Dispatcher cadence:** pg_cron every **~1 minute** (max 1-min push latency — irrelevant for trips).
- **Preferences UI:** **yes**, but deferred to **Phase 3** (option B).

### Non-goals

- No change to the feed UI or the feed realtime transport.
- No Broadcast migration in this project (escape hatch only, future).
- `surftrips` (the other entity) is out of scope.

---

## 2. Architecture

### 2.1 Components

| Component | New? | Purpose |
|---|---|---|
| `notifications` table | exists | Feed + history. Source of truth for in-app. **Unchanged.** |
| `NotificationCenter.tsx` + feed subscription | exists | The only feed UI. **Unchanged.** |
| `notification_queue` table | **new** | Outbox of pending **push** intents. Affects push only, not the feed. |
| Postgres triggers | mostly exist | Write the feed row **and** enqueue a push intent. |
| pg_cron schedulers | **new** | Date reminders (T-7 / T-1 / day-of) and re-engagement scans. |
| Dispatcher edge function | **new** | Invoked by pg_cron ~1 min. Drains the queue, applies smart rules, sends to Expo. Replaces the N per-event push edge functions with one generic dispatcher. |
| `notification_preferences` | **new (Phase 3)** | Per-category toggles + per-trip mute. |
| Preferences screen | **new (Phase 3)** | UI for the toggles. |

### 2.2 Data flow

```
Event (join, gear, update, …)
   └─ Postgres trigger
        ├─ ① INSERT into notifications        → feed, instant via the EXISTING realtime sub
        └─ ② INSERT into notification_queue   → push intent (priority, dedup_key, send_after)

pg_cron (~every 1 min)
   └─ Dispatcher edge function
        reads "due" queue rows (send_after <= now, status = pending)
        → groups/batches by (recipient_id, trip_id, type)
        → checks: preferences · quiet hours · frequency cap · dedup-vs-read
        → sends to Expo Push (with collapse id)
        → marks rows sent / skipped

pg_cron (daily)
   ├─ Date reminders: find trips at T-7 / T-1 / today → enqueue reminder intents
   └─ Re-engagement: scan dormant-but-eligible users → enqueue intents
        (both write to notifications too, so they also appear in the feed)
```

### 2.3 `notification_queue` schema (sketch)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `recipient_id` | uuid | target user |
| `trip_id` | uuid | for grouping / collapse / mute |
| `type` | text | mirrors the notification type enum |
| `priority` | smallint | 0 = urgent (skip batch), 1 = normal, 2 = low/re-engagement |
| `dedup_key` | text | `(recipient, type, entity)` — drop duplicates |
| `notification_id` | uuid | FK to the feed row (for dedup-vs-read check) |
| `send_after` | timestamptz | quiet-hours / batching window release time |
| `status` | text | pending / sent / skipped |
| `payload` | jsonb | title/body/deeplink snapshot |
| `created_at` | timestamptz | |

RLS: service-role only (the queue is server-internal; clients never read it).

---

## 3. The smart engine (lives in the dispatcher)

All cross-cutting logic is centralized in the dispatcher, **not** duplicated across triggers.

- **Quiet hours** — if "now" is outside 8am–9pm local for the recipient, set `send_after` to next 8am local. (Requires a user timezone; default to a sensible TZ if unknown.)
- **Batching** — low-priority rows with the same `(recipient_id, trip_id)` inside a window collapse into one digest push ("3 updates in Costa Rica camp").
- **Frequency cap** — count pushes sent to a user in the last 24h; drop/defer low-priority over the cap (~3/day).
- **Dedup vs feed** — if the linked `notifications.read_at` is already set when the dispatcher runs, skip the push (they saw it in the feed).
- **Collapse** — one live push per trip via Expo `collapseId` / Android thread id; newest replaces older.
- **Priority lane** — priority 0 (you're approved, trip cancelled, removed) → `send_after = now`, bypasses batching and quiet hours.

### Re-engagement guardrails (enforced in dispatcher)

- Never if the user was active in the last 24h.
- Max **1** re-engagement push per user per 3 days.
- Back off after 2 consecutive ignored re-engagement pushes.
- Never during quiet hours; never if the trip is muted or the category is off.

---

## 4. Notification catalog (source of truth: the HTML plan)

The full when/who/channel matrix lives in `group-trip-notifications-plan.html`. Mapping to this architecture:

- **Existing trigger-based notifications** (member joined, gear claimed, requests + decisions, admin update, group/personal gear) → keep their feed triggers; add the `notification_queue` enqueue with the right `priority` and channel decision from the plan.
- **New date-based** (trip in 1 week / tomorrow / today) → Phase 2 pg_cron.
- **New nudges** (haven't committed, last spots, gear gaps) → trigger or cron depending on source; Phase 2.
- **Re-engagement** (trip starts soon & away, missed activity digest, friend started a trip, spot opened) → Phase 3 pg_cron.

Channel rule (push vs feed) per the plan's "golden rule": push only if it needs a decision, is time-sensitive, or is about them directly; everything else is feed-only (no queue row).

---

## 5. Cost posture

- **No new realtime.** Feed transport unchanged.
- Push = HTTP via Expo, **batched → fewer sends**.
- Dispatcher = **one cron edge function** instead of N webhooks.
- **Dedup + collapse keep the `notifications` insert rate low** → keeps the existing `postgres_changes` cheap. This is the primary lever.
- pg_cron jobs are batch DB work — cheap, no realtime.

---

## 6. Rollout (phased, flag-gated)

**Phase 1 — Backbone (no new notifications, no UI)**
- Create `notification_queue`.
- Build the generic dispatcher edge function + pg_cron (~1 min).
- Change existing push paths to **enqueue** instead of sending directly; feed triggers unchanged.
- Run in **shadow** against the legacy push path (flag-gated) until verified, then cut over and retire the per-event push edge functions.

**Phase 2 — Date reminders & nudges**
- Daily pg_cron for T-7 / T-1 / day-of reminders.
- "Haven't committed", "last spots", "gear gaps" nudges.

**Phase 3 — Re-engagement & preferences**
- Daily pg_cron re-engagement scan with the guardrails.
- `notification_preferences` table + the preferences screen (per-category toggles + per-trip mute).

---

## 7. Open questions / risks

- **User timezone** — quiet hours need a per-user TZ. Confirm where it lives (device, profile) or pick a default.
- **Dormancy definition** — "dormant" for re-engagement needs a concrete signal (last_seen / last push token activity). Define in Phase 3.
- **Frequency-cap source** — counting sent pushes requires a `sent` log; the `notification_queue` with `status=sent` can serve as that log.
- **Legacy edge functions** — `send-trip-request-notification` et al. get folded into the dispatcher in Phase 1; keep them until shadow proves the new path.
