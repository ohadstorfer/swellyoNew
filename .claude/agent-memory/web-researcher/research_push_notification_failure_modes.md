---
name: Push Notification Failure Modes — Expo + Supabase
description: Comprehensive failure mode map for Expo push notifications (SDK 54, iOS + Android) — token issues, iOS/Android specifics, sending-side errors, DB wiring, lifecycle problems
type: project
---

## Overview
Researched April 2026. Companion to research_push_notifications.md (setup guide). This file covers all the ways a user who GRANTED permission can still silently fail to receive notifications.

## Token Failures
- Missing `projectId` in `getExpoPushTokenAsync({ projectId })` → hangs or throws
- `getDevicePushTokenAsync` never resolves on iOS SDK 53 (Issue #37516) — hangs silently
- Token stale after phone transfer/upgrade (iOS) — old device token stored, new device never registered
- Android reinstall changes token — server still has old token → DeviceNotRegistered
- iOS reinstall: token stays the same (iOS behavior) — less of a problem but surprising
- Token registered against wrong user_id (logout/login race condition)
- Expo Go: push tokens completely broken SDK 53+ — dev build required
- iOS simulator: cannot get push tokens — physical device only
- Dev build vs production build tokens are DIFFERENT — testing dev build pushes that never work on production store builds
- Token not updated on app re-open after re-grant (need to call registerForPushNotificationsAsync again on app focus)

## iOS-Specific Failures
- `aps-environment` entitlement missing → "No valid aps-environment entitlement string found" — fixed by EAS build (Xcode auto-sets production on archive)
- Expired APNs push key → InvalidCredentials error → run `eas credentials` to regenerate
- Token fetch hangs (not an error, but no token returned) — port 5223 blocked by firewall or no SIM card
- Focus Mode / Do Not Disturb silencing — system-level, cannot be detected from app
- iOS 15+ Notification Summary (Scheduled Summary) batches and delays non-time-sensitive notifications
- Per-app notification settings: user can flip "Allow Notifications" OFF in Settings > Apps > [YourApp] independently of the OS-level grant — `getPermissionsAsync()` returns "granted" but user sees nothing
- `setNotificationHandler` not called / returns wrong values → foreground notifications silently suppressed
- Silent push (content-available) broken in SDK 54 + Bridgeless Mode (New Architecture) — Issue #43104, open as of Feb 2026, root cause: legacy RCTEventEmitter not registered in bridgeless
- Background modes not in Info.plist (remote-notification) → background pushes never wake app
- expo-notifications config plugin not added in app.json → push entitlement missing (SDK 53 breaking change, Issue #38893)

## Android-Specific Failures
- No notification channel created → Android 8+ silently drops notification, no error
- Bug #30762: when app is backgrounded, notifications fall into system "Miscellaneous" category (not your custom channel) which has "Pop on screen" OFF by default → appears only in status bar tray, no heads-up
- FCM google-services.json sender ID mismatch with EAS credentials → MismatchSenderId error
- FCM Legacy completely shut down Sept 2024 → must use FCM V1 service account key; old setup = InvalidCredentials
- Doze mode (Android 6+) defers notifications; set priority "high" in payload to use FCM high-priority which wakes device
- OEM battery optimization (Xiaomi, Huawei, OnePlus, Samsung) aggressively kills background processes → FCM delivery receipt says "ok" but device never shows it
- Force-stop behavior: some OEMs force-stop app when swiped away → no FCM delivery until user manually opens app
- `SCHEDULE_EXACT_ALARM` permission missing → exact-time local notifications deferred in Doze (less relevant for push)
- Dev build package name mismatch (e.g., `.dev` suffix) with google-services.json → token generation fails
- Firebase not initialized before `getExpoPushTokenAsync` → "FirebaseApp not initialized" crash (Issue #22674, #33030)

## Expo Push Service / Sending Side
- Push ticket `status: "ok"` only means Expo's server accepted it — does NOT mean APNs/FCM delivered it
- Must check Receipts API (~15 min later) for actual delivery status
- DeviceNotRegistered in receipt → user uninstalled or token dead → must delete token from DB
- MessageTooBig → payload >4096 bytes → notification dropped silently
- MessageRateExceeded → sending too fast to one device → implement exponential backoff
- MismatchSenderId → FCM server key vs google-services.json sender ID mismatch
- InvalidCredentials → expired APNs key or wrong FCM service account
- Rate limit: 600 notifications/second per project → chat bursts can hit this
- Max 100 notifications per request body
- UNAUTHORIZED error if Enhanced Security for Push Notifications is enabled but EXPO_ACCESS_TOKEN not set / wrong
- Receipt IDs sometimes empty even on ok status (~5-10% of cases per community reports, Issue #21859) — receipts unavailable after 24h

## Supabase Edge Function Failures
- Edge Function timeout (150s on Free, 400s on Pro background) — unlikely for single push send, but risky if querying many tokens
- Wrong Supabase key used (anon key instead of service_role_key) → can't read other users' push tokens if RLS is active
- Database Webhook not configured → message inserts never trigger the function
- Webhook payload field name mismatch (e.g., `receiver_id` vs actual column name) → query returns null → no token found → silent fail
- Token column is null because client never saved it (first-time user, slow token registration)
- Web users have no expo_push_token → Edge Function queries it, gets null, POSTs `to: null` → Expo API returns error but Edge Function may not propagate it

## App Lifecycle Issues
- Foreground: iOS hides notification banners by default unless `setNotificationHandler` is set AND returns `shouldShowAlert: true`
- `setNotificationHandler` called too late (after notifications arrive during boot) → first notification missed
- User grants permission AFTER app boot → token registration was skipped at boot → must re-register on `appStateChange` to `active` or on permission grant callback
- Notification opened while app is killed → `Notifications.getLastNotificationResponseAsync()` needed to handle the open — not a "not received" issue but user sees no response

## Database / Wiring Issues
- Token saved to wrong user (race: user logs out mid-registration, new user logs in, token associated to new user)
- Multiple devices per user: only last token stored → previous devices silently dropped
- Column name mismatch (stored as `push_token` but Edge Function queries `expo_push_token`) → always null
- No upsert logic: token insert fails on duplicate → old token remains
- Token stored but profile row doesn't exist yet (onboarding race) → update with eq(id) affects 0 rows
- Web platform: `Platform.OS === 'web'` check omitted → `getExpoPushTokenAsync` throws on web → token never saved → silent fail for all that user's devices if error handling swallows exception

## Receipts Monitoring — Missing Pattern
Most teams never implement receipt polling. Without it:
- You never know if DeviceNotRegistered errors are piling up
- Dead tokens accumulate and inflate send volume
- You can't detect MismatchSenderId or InvalidCredentials at scale

## SDK 54 Specific Known Issues
- Silent push (content-available) broken in Bridgeless Mode — Issue #43104, open Feb 2026
- expo-notifications config plugin must be explicitly listed in app.json plugins (Issue #38893)
- Expo Go: push notifications completely removed — dev build mandatory for any push testing

## Sources
- https://docs.expo.dev/push-notifications/faq/
- https://docs.expo.dev/push-notifications/sending-notifications/
- https://github.com/expo/expo/issues/43104
- https://github.com/expo/expo/issues/30762
- https://github.com/expo/expo/issues/37516
- https://github.com/expo/expo/issues/38893
- https://github.com/expo/expo/issues/21859
- https://medium.com/@gligor99/making-expo-notifications-actually-work-even-on-android-12-and-ios-206ff632a845
- https://github.com/expo/expo/issues/5058 (OEM battery optimization)
- https://expo.dev/blog/expo-adds-support-for-fcm-http-v1-api
