# Group Trip Notifications — Revised Design

**Date:** 2026-06-09
**Scope:** `group_trips` notifications (feed + push).
**Supersedes:** `2026-06-08-group-trip-notifications-implementation-design.md` (architecture unchanged; this adds the full per-row catalog reconciled with the revised plan HTML and the Section-5 triage).
**Source of truth:** `group-trip-notifications-plan.html`. Every channel / recipient / delete / change / new / priority decision is read from that file. We only deviate where the HTML is silent (noted explicitly).
**Status:** Draft for review.

---

## 1. Goal & constraints

Deliver the revised plan with good "push-to-action" UX, **without expensive realtime**.

- **Feed transport unchanged.** Keep the existing `public.notifications` table and its per-user `postgres_changes` subscription. No new realtime. The bell UI (`NotificationCenter.tsx`) is untouched — new types just land in the same table and render with the same cards.
- **Push via an outbox queue + cron dispatcher** (decision locked with Ohad, 2026-06-09). Events enqueue a push intent; one cron edge function (~1 min) drains the queue, applies the NOW smart rules, and sends to Expo. This replaces the scattered per-event push edge functions.
- **Cost lever = volume, not transport.** Keep the `notifications` insert rate low (dedup, collapse, later batching) so `postgres_changes` stays cheap at medium scale.

### Non-goals

- No feed UI / feed transport change.
- No Broadcast migration here.
- `surftrips` is out of scope.
- LATER and SKIP items (see triage) are not built in this round — they are sequenced into Phase 2/3.

---

## 2. Core rule (derived from the plan's P5 + SR4)

> **Every notification writes a feed row. A row whose Channel is `Push` *additionally* enqueues a push intent that links back to that feed row.**

This linkage is what makes **SR4 dedup** and **P5 "never repeat"** possible: when the dispatcher runs, if the linked feed row is already read, the push is dropped. The only push-with-no-feed-row exceptions are **chat messages and reactions** (they live in the chat, not the bell) — these keep their own instant path and never touch the queue.

`Channel = Feed` in the plan → feed row only, **no** queue row.
`Channel = Push` in the plan → feed row **and** a queue row.

---

## 3. Data model

### 3.1 `public.notifications` — the bell feed (EXISTS, unchanged)

One row per recipient. Key columns: `recipient_id`, `trip_id`, `type` (enum), `audience` (`user`/`admin`), `actor_id`, `entity_type`, `entity_id`, `data` (jsonb render snapshot), `read_at`, `handled_at`, `created_at`. Written only by SECURITY DEFINER triggers; RLS lets a user read their own rows and update only `read_at`/`handled_at`.

New `type` enum values added this round: `member_left`, `trip_cancelled`, `member_removed`, `trip_ended` (Phase 2), `trip_reminder` (Phase 2, with a `data.stage` of `week`/`tomorrow`/`today`). The TS `NotificationType` union mirrors these.

### 3.2 `public.notification_queue` — the push outbox (NEW)

Server-internal. One row = one intended push. RLS: **service-role only** (clients never read it).

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `recipient_id` | uuid | who to alert |
| `trip_id` | uuid null | trip — used for mute + collapse |
| `type` | text | mirrors the notification type |
| `priority` | smallint | `0` = urgent (send now, bypass hold) · `1` = normal (held for the dedup window) · `2` = reserved for re-engagement (Phase 3) |
| `dedup_key` | text | `recipient_id : type : entity_id` — drop duplicates within the window |
| `notification_id` | uuid null | FK → `notifications` (the linked feed row, for the read-check) |
| `send_after` | timestamptz | don't send before this; `now()` for P0, `now()+~60s` for P1 |
| `status` | text | `pending` → `sent` / `skipped` |
| `skip_reason` | text null | `read_in_feed` / `muted` / `no_token` / `device_unregistered` |
| `payload` | jsonb | `{ title, body, deeplink, collapse_id }` |
| `created_at` | timestamptz | |
| `sent_at` | timestamptz null | doubles as the "sent log" for the LATER frequency cap |

Indexes: `(status, send_after)` for the drain query; `(recipient_id, sent_at)` for the future cap.

### 3.3 Reused, not new

- **Push token:** `surfers.expo_push_token` (exists).
- **Mute:** the existing `conversation_members.preferences.muted_until` mechanism; SR6 adds a per-trip toggle on top (read by the dispatcher).

---

## 4. Notification catalog (reconciled with the HTML)

Channel + Who are read verbatim from the plan. "Feed today?" = whether a feed trigger already exists. "Work" = what Phase 1 must build.

### Stage ① Planning

| Ref | Event | Channel | Who | Feed today? | Work | Prio | Phase |
|---|---|---|---|---|---|---|---|
| 1.1 | Someone requests to join | Push | Host | yes (`join_request_received`) | migrate existing push (`send-trip-request-notification`) → queue | 0 | 1 |
| 1.2 | Request approved | Push | Requester | yes (`join_request_decided`) | add push lane | 0 | 1 |
| 1.3 | Request declined *(changed feed→push)* | Push | Requester | yes (`join_request_decided`) | add push lane | 1 | 1 |
| 1.4 | New member joined *(changed feed→push, batched)* | Push | Members + host | yes (`member_joined`) | feed already live; **push waits for SR1 batch** | 1 | 2 |
| 1.5 | Last spots left *(deleted)* | — | — | — | none | — | — |
| 1.6 | A member left *(new)* | Push | Host | **no** | new feed type + trigger + push | 1 | 1 |

### Stage ② Upcoming

| Ref | Event | Channel | Who | Feed today? | Work | Prio | Phase |
|---|---|---|---|---|---|---|---|
| 2.1 | Host posts an update | Push | All members | yes (`admin_update_posted`) | add push lane | 1 | 1 |
| 2.2 | Host edits the personal-gear checklist *(changed)* | Push | All members | partial — existing trigger is per-participant | new trigger on `group_trips.personal_gear_host_suggestion` fan-out + push | 1 | 1 |
| 2.3 | You haven't committed yet *(changed: 30/15/10/5d)* | Push | Uncommitted members | no | cron + push | 1 | 2 |
| 2.4 | Member claims gear | Feed (daily batch) | Host + members | yes (`gear_claimed`) | none now; batch in P2 | — | 2 |
| 2.5 | Host edits the group gear list *(changed feed→push)* | Push | Members | yes (`group_gear_updated`) | add push lane | 1 | 1 |
| 2.6 | Gear still unclaimed *(changed: 10/5/3/1d)* | Push | Members | no | cron + push | 1 | 2 |
| 2.7 | Member requests to commit *(new)* | Push | Host | yes (`commitment_request_received`) | add push lane | 0 | 1 |
| 2.8 | Commit approved by host *(new)* | Push | The member + all other members | yes (`commitment_decided` + `member_committed`) | add push lane (member=0, others=1) | 0/1 | 1 |
| 2.9 | Commit declined by host *(new)* | Feed | The member | yes (`commitment_decided`) | none (already feed-only) | — | done |
| 2.10 | Member proposes a group-gear item *(new)* | Push | Host | yes (`gear_request_received`) | add push lane | 0 | 1 |
| 2.11 | Decision on a proposed gear item *(new)* | Push | The proposer | yes (`gear_request_decided`) | add push lane | 1 | 1 |

### Stage ③ About to start (all new, time-based)

| Ref | Event | Channel | Who | Feed today? | Work | Prio | Phase |
|---|---|---|---|---|---|---|---|
| 3.1 | Trip starts in 1 week | Push | All members (not declined/left) | no | feed type + cron | 1 | 2 |
| 3.2 | Trip starts tomorrow | Push | All members | no | cron | 1 | 2 |
| 3.3 | It's today | Push | All members | no | cron | 1 | 2 |

### Stage ④ Active

| Ref | Event | Channel | Who | Feed today? | Work | Prio | Phase |
|---|---|---|---|---|---|---|---|
| 4.1 | New message in any chat — DMs & group trip chats *(changed scope)* | Push | Chat participants (not sender / muted) | n/a (lives in chat) | **keep existing instant path** (`send-push-notification`); not routed through the queue (latency). HTML is silent on routing — design call. | 0 | live |

### Stage ⑤ Past & cancelled

| Ref | Event | Channel | Who | Feed today? | Work | Prio | Phase |
|---|---|---|---|---|---|---|---|
| 5.1 | Trip ended *(changed feed→push)* | Push | All members | no feed type today | feed type + cron (end date) + push | 1 | 2 |
| 5.2 | Trip cancelled | Push | Members + pending requesters (not host) | **no** | new feed type + trigger (status→cancelled) + push | 0 | 1 |
| 5.3 | You were removed | Push | Removed user | no (push-only today) | add feed type (`member_removed`) + migrate existing push (`send-trip-removed-notification`) → queue | 0 | 1 |

### Re-engagement & guardrails — Phase 3

RE1–RE4 (dormant pulls) + guardrails G1–G5 + SR7 preferences UI. Deferred; depend on a dormancy signal that doesn't exist yet.

---

## 5. Section-5 smart engine (triage from the HTML)

### NOW — built in Phase 1, inside the dispatcher

- **SR8 Priority order** — the `priority` column. `0` urgent → `send_after = now()`, bypasses the hold; `1` normal → held for the dedup window.
- **SR4 Dedup vs feed** — the ~60s hold on P1 rows *is* the dedup window. Before sending, re-read the linked `notifications.read_at`; if set → `skipped: read_in_feed`.
- **SR6 Mute per trip** — before sending, check the trip mute for the recipient; if muted → `skipped: muted`. Adds a per-trip toggle reusing the existing mute storage.
- **SR5 Collapse** — send with Expo `collapseId = trip_id` (+ Android thread id), so one trip shows one live push, newest replaces older.

### LATER — Phase 2

- **SR1 Batch** — collapse same-`(recipient, trip)` pending rows in the window into one digest push. Unlocks 1.4's batched push.
- **SR3 Quiet hours** — push `send_after` to next 8am local; needs a per-user timezone (see open questions).
- **SR2 Frequency cap** — count `sent_at` rows in last 24h; defer/drop low-priority over ~3/day.

### SKIP this round

- **SR7 Granular opt-out** — per-category switches; needs the Phase-3 preferences screen.

---

## 6. Data flow

```
Trip event (join / approve / gear edit / member leaves / cancel …)
  └─ Postgres trigger (SECURITY DEFINER)
       ├─ INSERT notifications (one per recipient)          → bell, instant via existing realtime
       └─ if plan Channel = Push:
            INSERT notification_queue (priority, dedup_key,  → push intent linked to the feed row
                    notification_id, send_after, payload)

pg_cron (~1 min)
  └─ Dispatcher edge function
       SELECT pending rows WHERE send_after <= now()
       for each (or batched group in P2):
         • muted?            → skip(muted)
         • linked feed read? → skip(read_in_feed)        [SR4]
         • no token?         → skip(no_token)
         • [rollout gate: recipient is Ohad?]            [Phase-1 safety]
         • send to Expo with collapseId=trip_id          [SR5]
         • mark sent / on DeviceNotRegistered: null token + skip
```

Time-based rows (Phase 2) are a separate daily cron that writes the feed row **and** enqueues a queue row, then flows through the same dispatcher.

---

## 7. Rollout & safety

- **Push has no only-ohad gate today** (the existing feed gate `trg_notifications_only_ohad` covers feed only). The dispatcher therefore enforces its **own recipient gate** (Ohad only) for the entire Phase-1 shadow period, before any real sends. See `project_notifications_testing_safety`.
- **Shadow first:** run the queue+dispatcher alongside the legacy push functions, flag-gated, comparing what each would send. Cut over only after parity is confirmed, then retire `send-trip-request-notification` and `send-trip-removed-notification`.
- **Migrations applied manually** via the SQL editor (never `supabase db push`); the new table/triggers follow that convention.
- Idempotent dispatcher: a crash mid-batch must not double-send — mark `sent` before/transactionally with the Expo call, and rely on `collapseId` to dedup on-device.

---

## 8. Testing

- Unit (jest-expo, existing infra): payload builders, priority assignment, dedup decision (read vs unread), mute decision, skip-reason mapping.
- SQL regression: each new/changed trigger writes the right feed rows to the right recipients (extend the `supabase/tests/notifications_*` pattern).
- Dispatcher integration: seed queue rows in each state → assert sent/skipped + skip_reason, with the Expo call mocked.
- No "smoke tests" that fire real pushes to real users — see `feedback_smoke_tests_real_users`.

---

## 9. Open questions (HTML is silent — confirm at implementation)

1. **User timezone** for SR3 quiet hours (Phase 2) — where does it live, or pick a default?
2. **Dormancy signal** for RE1–4 (Phase 3) — `last_seen`? define before Phase 3.
3. **2.2 personal gear** — the existing per-participant `personal_gear_updated` trigger may be redundant once the shared-list fan-out exists; verify whether the per-participant event still occurs before removing it.
4. **"A member left" (1.6) source event** — confirm the leave mechanism (participant row delete vs a status flag) so the trigger fires on the right change.
