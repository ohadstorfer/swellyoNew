# In-App Banners for Bell Notifications — Design

**Date:** 2026-07-02
**Owner:** Ohad
**Status:** Approved design, pending implementation

## Problem

Bell notifications (join requests, commitments, gear, member events, reminders) already
arrive on the device as real Expo pushes — `dispatch-notification-queue` (live on prod)
sends one push per `notifications` row with `data.type` set to the real
`NotificationType` (e.g. `join_request_received`). But the client foreground gate
(`shouldShowForegroundNotification()` in `src/services/notifications/pushNotificationService.ts`)
only special-cases `type === 'message'`; every other type falls into the legacy branch
and is **suppressed whenever the app is foregrounded**. Users inside the app get no
banner for bell events — only the badge count changes.

## Goal

When the user is inside the app but **not** looking at the notifications screen, show a
native heads-up banner for every bell notification type — the same pattern as the
existing in-app message banners (2026-06-30 design). Scope decision: **all** bell types
(option A) — the server-side queue already applies priorities and quiet hours, so
whatever reaches the device has passed that filter.

Out-of-app behavior must not change: `setNotificationHandler` only runs while the app is
foregrounded; background/killed pushes are rendered by the OS and never touch this code.

## Design

### 1. Bell-type set (`src/services/notifications/notificationsService.ts`)

Export a runtime `BELL_NOTIFICATION_TYPES: ReadonlySet<string>` built from a
`NotificationType[]` literal (typed against the existing union so TS errors if the union
grows without updating the set). Unknown/missing `data.type` values are NOT bell types —
they keep the legacy suppress-in-foreground behavior so nothing new leaks in by accident.

### 2. Foreground gate (`src/services/notifications/pushNotificationService.ts`)

`shouldShowForegroundNotification()` gains one input and one branch, and its return type
changes from `boolean` to `{ show: boolean; sound: boolean }` so bell banners can be
silent:

- `type === 'message'` → unchanged: show (with sound) unless the push's
  `conversationId` equals the currently-open conversation.
- `type ∈ BELL_NOTIFICATION_TYPES` → show unless the notifications screen is open
  (`isNotificationsScreenOpen`). **Foreground sound: off** — in-app banners should be
  quiet (the user is already in the app; sound is for pulling them in from outside).
  Background sound is untouched (OS renders it, not this handler).
- anything else → legacy: suppress while foregrounded.

`setNotificationHandler` maps the result: `shouldShowBanner/shouldShowList/
shouldShowAlert/shouldSetBadge = show`, `shouldPlaySound = show && sound`.

`setupNotificationHandlers(...)` gains a third getter parameter
`getIsNotificationsScreenOpen: () => boolean`, mirroring `getCurrentConversationId`.

### 3. Notifications-screen awareness (`src/components/notifications/NotificationCenter.tsx`)

Same manual-ref pattern as `currentConversationIdRef` (no generic route tracking):

- A module-level `notificationsScreenOpenRef` (exported getter/setter — a tiny module or
  exported from `notificationsService.ts`).
- `NotificationsPanel` sets it `true` on focus and `false` on blur/unmount
  (`useFocusEffect`, matching its existing focus-gated subscription).

Suppressing there loses nothing: the panel's realtime subscription inserts the new row
live while the user is watching.

### 4. Wiring (`src/components/AppContent.tsx`)

Pass the new getter into `pushNotificationService.setupNotificationHandlers(...)`
(~line 384).

### 5. Tap routing — no changes

The existing response listener already routes any push with `tripId` to
`openTripCard(tripId, tripFocusForNotification(type, {stage, decision}))`. Works
identically for foreground banner taps.

## Non-goals

- No suppression when viewing the trip the notification is about (decided against — v1
  keeps only the notifications-screen gate; the ~1 min queue cron delay makes the
  overlap rare).
- No server/DB changes. No changes to message-banner behavior.
- Web: untouched (`setupNotificationHandlers` no-ops on web).

## Known caveat

`dispatch-notification-queue` is cron-driven (~1 min), so banners can lag the event by
up to a minute — identical to today's background pushes.

## Testing

- Unit: extend the existing `shouldShowForegroundNotification` tests (pure function) —
  message unchanged; each bell type shows when screen closed, suppressed when open;
  bell sound is false in foreground; unknown type suppressed in foreground.
- Device (Ohad, manual): trigger a bell event from a second account with the app
  foregrounded — banner appears (silent), tap navigates to the trip; open the
  notifications screen and repeat — no banner, row appears live; background the app —
  push arrives with sound as before.

## Files touched

- `src/services/notifications/pushNotificationService.ts`
- `src/services/notifications/notificationsService.ts`
- `src/components/notifications/NotificationCenter.tsx`
- `src/components/AppContent.tsx`
