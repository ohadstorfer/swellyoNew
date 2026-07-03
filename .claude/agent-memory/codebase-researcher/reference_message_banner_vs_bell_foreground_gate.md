---
name: message-banner-vs-bell-foreground-gate
description: How the in-app message banner foreground gate works vs. bell/notification_center pushes, and why bell pushes are still suppressed in foreground
metadata:
  type: reference
---

The in-app message banner feature (shipped ~2026-06-30, [[project_in_app_message_banners]]) is a REMOTE-push foreground-suppression toggle, not a locally-generated banner. It all lives in one function: `shouldShowForegroundNotification()` in `src/services/notifications/pushNotificationService.ts:30-44`, wired into `Notifications.setNotificationHandler` at line 218 inside `setupNotificationHandlers()` (called from `src/components/AppContent.tsx:386-407`).

Gate logic: if `data.type === 'message'` → show unless `data.conversationId` equals the currently-open conversation (checked via `getCurrentConversationId()`, backed by a plain ref `currentConversationIdRef` in `src/context/MessagingProvider.tsx:1398-1404`, NOT generic route tracking). All OTHER notification types keep the legacy rule: suppressed whenever the app is foregrounded, shown only when backgrounded.

**Why bell notifications don't banner today:** `supabase/functions/dispatch-notification-queue/batching.ts:141-147` builds the Expo push payload for every `notifications` table row (join_request_received, commitment_decided, gear_claimed, trip_reminder, etc.) with `data.type = row.type` (the real NotificationType) and `data.tripId` — never `'message'`. So these always fall into the "suppressed in foreground" branch of the gate. Extending banners to bell notifications means broadening the `isMessage` branch (or adding a parallel branch) to cover these types too.

**No generic "current screen" tracker exists.** `src/navigation/navigationRef.ts` exports `navigationRef` (react-navigation ref, has `.getCurrentRoute()` available) and `pushRootCard()`, but nothing in the app currently calls `getCurrentRoute()` or listens to nav state changes for suppression purposes — the only "am I looking at X" signal is the explicit conversationId ref pattern (set on mount/before-push, cleared on unmount, in `DirectMessageScreen.tsx`, `DirectGroupChat.tsx`, `RootNavigator.tsx:227-235/253`, `ConversationsScreen.tsx:207`). The bell screen (`NotificationsPanel` in `src/components/notifications/NotificationCenter.tsx`) sets no equivalent ref today — one would need to be added (or use `navigationRef.getCurrentRoute()?.name === 'NotificationsPanel'`) to suppress a bell banner while the user is already looking at the bell.

**Tap routing today:** `onNotificationTap` callback (registered in `AppContent.tsx:386-407`) branches on `payload.tripId` → `openTripCard(tripId, tripFocusForNotification(...))` (trip/bell-type pushes) vs `payload.conversationId` → `setPendingNotificationConversationId(...)` (message pushes). Bell pushes already carry enough data (`tripId`, `type`, `stage`, `decision`, `notificationId`) to deep-link correctly if shown as a banner — no payload changes needed for tap-to-open.

**Bell data model:** `notifications` table + `notificationsService.ts` (fetch/unreadCount/markAllRead/markRead/markHandled/subscribe via Supabase Realtime `postgres_changes` filtered by `recipient_id`). `NotificationCenter` bell badge keeps ONE stable realtime channel for its lifetime (not focus-gated, see comment at NotificationCenter.tsx:112-117 — focus-gating churned the channel and heated devices). The `NotificationsPanel` itself IS focus-gated (separate `useFocusEffect` subscription at line 186-205) since it's a single screen.
