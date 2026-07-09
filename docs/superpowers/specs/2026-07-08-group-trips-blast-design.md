# One-time group-trips announcement blast

**Date:** 2026-07-08
**Status:** implemented, not deployed, not sent
**Function:** `supabase/functions/notify-group-trips-blast/index.ts`

## Goal

Send a single push notification announcing group trips to every device with an
Expo push token.

```
Group trips are here 🌊
Find a trip to join, or create your own.
```

## Audience

Every surfer row with `expo_push_token is not null`, collapsed to one send per
**distinct token**.

| | count |
|---|---|
| surfer rows with a token | 129 |
| distinct tokens (devices) | 76 |
| duplicates collapsed | 53 |
| — of which malformed (raw APNs, undeliverable) | 17 |
| **actually reachable** | **59** |

Two facts about the data drove the design:

1. **A push token is attached to many surfer rows.** Logout/login and demo
   accounts re-bind the same device token to a new row. Sending per-row would
   deliver the notification 2–3× to 53 devices. The function collapses by token
   (`Map<token, row>`, first row wins) before sending.

2. **17 tokens are 64-char hex, not `ExponentPushToken[...]`.** These are raw
   APNs device tokens written by older client code. Expo rejects them. They are
   skipped from the send and cleared, rather than posted so Expo can tell us
   what we already know. See "Pre-existing bug" below.

Includes the 14 devices that never finished onboarding (they land on the
onboarding flow) and the 21 demo-linked devices (mostly Ohad's and Eyal's
phones). Both accepted deliberately.

## Behavior

Cloned from `notify-onboarding-blast`, which set the precedent for a manual
one-shot blast:

- Auth: `x-internal-secret` header vs `ADMIN_FUNCTION_SECRET`. Fails closed if
  the secret is unset.
- Expo bulk POST in ≤100-message chunks, tickets read index-aligned.
- `DeviceNotRegistered` → `expo_push_token = null` (self-heal).
- Payload carries `data: { type: 'announcement', source: 'group_trips_blast' }`
  and **no** `tripId` / `conversationId`, so `AppContent`'s tap router falls
  through both branches and the app simply opens.

### Safety: the send is opt-in

`dry_run` defaults to **`true`**. An empty POST body resolves the audience,
renders the message, and returns counts + a 5-token sample **without calling
Expo**. Only `{"dry_run": false}` reaches real devices. An accidental re-run of
a shell command therefore sends nothing.

`only_user_id` restricts the send to one surfer, for a self-test.

### Rollout

1. `{}` → dry run. Expect `devices_to_notify: 59`, `malformed_tokens_skipped: 17`.
2. `{"dry_run": false, "only_user_id": "<ohad>"}` → one real push. **Background
   the app first** (see below).
3. `{"dry_run": false}` → live to 59 devices.

## Deliberately not done

- **No idempotency table.** 59 sends complete in well under a second, so a
  timeout-then-retry double-send is unlikely. The `dry_run: true` default is the
  real protection. A migration to guard one invocation isn't worth it.
- **No `notification_queue` integration.** The queue exists for per-user,
  per-trip, rule-governed notifications (24h cap, mute, SR1 collapse). A
  broadcast has no trip and no recipient rules, and SR1 would mangle it.
  Blasting direct is what `notify-onboarding-blast` already does.
- **No 24h cap check.** Broadcast bypasses SR2. Everyone gets one extra push.

## Known holes, accepted

- **A foregrounded app shows nothing.** `shouldShowForegroundNotification`
  (`pushNotificationService.ts:37`) is `show = !isForeground`, for every type.
  Not even a notification-list entry. Users with the app open at send time miss
  it entirely. Matters for the self-test: background the app or it looks broken.
- **Tap does nothing but open the app.** Deep-linking to Explore would need a
  client change (`payload.type === 'announcement'` → `requestTab('explore')`)
  plus an OTA that lands *before* the blast. Deferred.
- **The live send clears 17 tokens.** A side effect beyond sending: the
  malformed tokens are nulled. This is a net improvement — the client only
  re-registers a push token when it finds none, so a dead token is worse than no
  token — but it is a prod data write.

## Pre-existing bug (out of scope, worth fixing)

17 finished-onboarding users hold raw APNs tokens instead of Expo tokens, last
written between 2026-04-15 and 2026-06-28. **They have received zero pushes for
months.** `dispatch-notification-queue/batching.ts:103` skips any token not
prefixed `ExponentPushToken` and nulls it — so these rows survived only because
those users never had a queue row (never touched a group-trip notification).

The current client only calls `getExpoPushTokenAsync`, so nothing writes raw
tokens today. Running this blast clears all 17, and each affected client will
re-register a proper Expo token on next launch. That incidentally fixes them.
