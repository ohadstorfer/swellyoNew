# In-App Banner Overlay (WhatsApp-style) — Design

**Date:** 2026-07-04
**Owner:** Ohad
**Status:** Approved design, pending implementation
**Supersedes (foreground behavior only):** 2026-06-30 in-app message banners, 2026-07-02 bell notification banners. Background/killed-app push behavior is untouched.

## Problem

Foreground notifications currently ride the OS notification pipeline (native heads-up
banners gated by `shouldShowForegroundNotification`). That gives us: up to ~1 min lag
for bell events (push queue cron), dependence on Android channel importance and OS
notification permission, no banners in Expo Go, and no control over look & feel.

## Goal

While the app is foregrounded, show a custom WhatsApp-style banner rendered by the app
itself — instant (realtime-driven, like WhatsApp's socket), fully styled, no OS
dependence. Native pushes remain the background/killed-app path only.

**Approved UX defaults:**
- Slides in from the top (safe-area aware): avatar + title + body preview
- Auto-dismisses after 5 s; swipe-up dismisses immediately
- Tap navigates (same routing as push taps: trip card w/ focus, or conversation)
- A new banner replaces the visible one (no stacking)
- No sound. No haptic in v1: expo-haptics is not installed and adding a native dep
  would break OTA-ability onto runtime 1.3.0 — add it with the next native build
- Instant — triggered by realtime events, not by push arrival

**Scope:** bell notifications + chat messages (DM & group) when the user is not inside
that conversation. Same suppression rules as today: no bell banner while the
notifications screen is focused; no message banner for the currently open conversation.

## Realtime efficiency (core requirement)

The feature must not add realtime load. It ends up REDUCING it:

- **Messages: zero new subscriptions.** `MessagingProvider` already receives every
  incoming message (conversation channels + inbox broadcast). The banner hooks into
  that existing arrival path — a plain function call, no new channel, no extra socket
  traffic.
- **Bell: one shared subscription replaces today's two.** Today `NotificationCenter`
  (badge) holds one session-long `postgres_changes` subscription and
  `NotificationsPanel` holds a second focus-gated one — each `postgres_changes`
  subscriber costs server-side per-change evaluation. New module
  `notificationsRealtimeHub` owns a SINGLE session-long channel
  (`postgres_changes` on `notifications`, `recipient_id=eq.<me>`); badge, panel, and
  the banner source attach as in-memory listeners. Net: 2 subscriptions → 1.
- **Channel stability.** The hub channel is created once per login and lives until
  logout — no focus-gating, no churn (focus-gated channel churn previously heated
  devices; see comment in `NotificationCenter.tsx`). It is unsubscribed in the logout
  choreography. It must never leave the socket at 0 channels while other subsystems
  rely on it (known `removeChannel` socket-death gotcha) — logout tears everything
  down anyway.
- **Render cost.** Module-level event bus (`showInAppBanner(...)`) → only the host
  component re-renders; the app tree never re-renders for a banner. Animation is
  transform-only via `react-native-reanimated` (already a dependency). Avatar uses
  `expo-image` with the existing `getStorageThumbUrl` thumbnails (cached, tiny).
  Bell title/body reuse the module-cached `notification_templates` renderer.

## Architecture

Five small units:

### 1. `src/services/notifications/inAppBannerBus.ts`
Tiny module-level emitter, zero React:
```ts
export type InAppBannerPayload = {
  id: string;                    // dedupe key (notification id / message id)
  avatarUrl?: string;           // falls back to initial/icon in the UI
  title: string;
  body: string;
  onPress?: () => void;
};
export function showInAppBanner(p: InAppBannerPayload): void;
export function subscribeInAppBanner(l: (p: InAppBannerPayload) => void): () => void;
```
Dedupes consecutive same-`id` calls. No queue — last write wins (replace policy).

### 2. `src/components/notifications/InAppBannerHost.tsx`
Mounted ONCE in `AppContent`, absolutely positioned above the navigator. Subscribes to
the bus; owns visible-banner state. Reanimated slide-in/slide-out (translateY only),
5 s auto-dismiss timer (reset on replace), RNGH swipe-up-to-dismiss, `expo-haptics`
soft impact on appear, safe-area top inset. Tap runs `onPress` and dismisses.
Follows BottomSheetShell's role as the single shared surface component (but it is an
overlay, not a sheet — it does NOT use BottomSheetShell).

**Known accepted limitation:** RN `Modal`s (bottom sheets) render in their own native
window — a banner arriving while a sheet is open is covered by it. Accepted for v1;
badge/list still update.

### 3. `src/services/notifications/notificationsRealtimeHub.ts`
Owns the single `postgres_changes` channel (INSERT + UPDATE on `notifications` for the
logged-in user). API:
```ts
export function startNotificationsHub(userId: string): void;   // idempotent
export function stopNotificationsHub(): void;                   // logout hook
export function onNotification(l: {onInsert?, onUpdate?}): () => void; // listener registry
```
`NotificationCenter` (badge) and `NotificationsPanel` switch from
`notificationsService.subscribe(...)` to `onNotification(...)` — their handler bodies
stay identical. `notificationsService.subscribe` stays exported (still used nowhere
else) but the hub is the only live channel. Hub start is wired in `AppContent`
post-auth (alongside `setupNotificationHandlers`); stop joins the logout choreography.

### 4. `src/services/notifications/bellBannerSource.ts`
A hub listener started with the hub. On INSERT: skip if `isNotificationsScreenOpen()`;
skip own-actor rows (`actor_id === userId`); render title/body with the same
template machinery the bell list uses (`bellTemplateKey` + cached templates + `data`
snapshot); `showInAppBanner({ id: row.id, avatarUrl: thumb(row.data.actor_avatar_url),
title, body, onPress: () => openTripCard(row.trip_id, tripFocusForNotification(row.type,
row.data)) })`. Rows without `trip_id` show with no-op press.

### 5. Message hook (inside `MessagingProvider`)
In the live Broadcast mode there is no raw message at arrival — the inbox delivers a
touch signal and `handleInboxChange` re-fetches enriched `Conversation[]` before
dispatching `SYNC_FROM_SERVER`. The banner hook runs right after that dispatch:
compare each updated conversation's `last_message.id` against the previously held one
(`conversationsRef`) to detect a genuinely new message; skip when the previous
snapshot is absent (initial sync / reconnect — prevents a banner storm on login), when
`last_message.sender_id === currentUserIdRef`, or when the conversation is the open
one (`currentConversationIdRef`). Sender name/avatar come from the enriched
conversation (`other_user` for DMs, `members` lookup for groups). Preview text uses a
new shared pure helper (`messagePreviewText(last_message)`) extracted from the
duplicated inline logic in `ConversationsScreen` ("Image" / "Video" / "Voice message"
/ commitment strings / body) — both callers use it. `onPress` opens the chat via
`pushRootCard('ChatCard', {...})` from `navigationRef` — callable from anywhere, with
double-push debounce; it is the same mechanism the bell already uses to open chats.
No new subscription, no new effect — one function call in the existing arrival path.

### 6. Native foreground gate — revert to suppress-all
`shouldShowForegroundNotification` returns to the legacy rule: suppress EVERYTHING
while foregrounded (messages included), show when backgrounded. The
`{show, sound}` shape and the notifications-screen/conversation params remain (harmless),
but every foregrounded case is `{show:false, sound:false}`. Gate unit tests updated
accordingly. Background pushes — including the `channelId: 'default'` heads-up fix —
are untouched.

## Data flow (bell example)

DB trigger inserts `notifications` row → hub channel receives INSERT (instant) →
bellBannerSource filters + renders text → bus → host animates banner in → user taps →
`openTripCard(tripId, focus)`. The push queue still sends the native push ~1 min later;
the foreground gate suppresses it if the app is still open (no double-notify), or the
OS shows it if the app went to background (correct).

## Error handling

- Hub channel resilience matches today's badge subscription exactly (a single stable
  channel; no rejoin logic exists today and adding it is out of scope) — the hub must
  not be LESS resilient than the status quo, and the banner feature degrades silently.
- Template cache miss → fallback default strings (existing behavior).
- Malformed `data` → skip banner (log in dev).
- Logout: `stopNotificationsHub()` registered as one more line in
  `src/utils/registerLogoutHandlers.ts` (the module-level `logoutRegistry`, same as
  `messagingService.resetAll()`); bus listeners are module-level and survive, host
  unmounts with AppContent's authed tree.

## Non-goals

- No stacking/queueing of multiple banners (replace policy).
- No banner over open RN Modal sheets (accepted v1 limitation).
- No server/DB/edge-function changes of any kind.
- No changes to background push behavior, quiet hours, or the push queue.
- Web: no-op (hub + host gated to native; web has its own patterns).

## Ship path

Pure JS → OTA-able onto runtime 1.3.0 once device-verified (per PRE_BUILD_CHECKLIST).

## Testing

- Unit: gate revert (all foreground cases suppressed; background unchanged);
  `inAppBannerBus` (dedupe, replace, unsubscribe); `bellBannerSource` filtering
  (own-actor skip, bell-screen skip, template fallback).
- Manual device (Ohad): bell event from second account → banner appears instantly
  (< 1 s, vs ~1 min before); tap navigates to trip section; on bell screen → no banner,
  row appears live; DM from other chat → banner; DM in open chat → no banner; app
  backgrounded → native push with sound (unchanged); logout/login → banners still work
  (hub restarted). ⚠️ Only trigger on all-dev-member trips.

## Files touched

- New: `inAppBannerBus.ts`, `notificationsRealtimeHub.ts`, `bellBannerSource.ts`,
  `InAppBannerHost.tsx`, `messagePreviewText` helper (in `src/services/messaging/`)
- Modified: `AppContent.tsx` (mount host after `activeOverlay` so the banner sits on
  top; start hub post-auth), `MessagingProvider.tsx` (banner call after
  `SYNC_FROM_SERVER` in `handleInboxChange`), `NotificationCenter.tsx` (badge + panel
  switch to hub listeners), `ConversationsScreen.tsx` (use shared preview helper),
  `registerLogoutHandlers.ts` (stop hub), `pushNotificationService.ts` (+ gate tests)
