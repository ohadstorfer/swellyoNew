---
name: reference-ios-notification-service-extension-exists
description: An iOS Notification Service Extension (Communication Notifications, big avatar) already ships in prod — relevant to any "rich push notification" feature request
metadata:
  type: reference
---

Swellyo already has a working iOS Notification Service Extension (NSE) for chat message pushes — not a hypothetical, it's built and wired into the native project.

- `targets/notify-service/NotificationService.swift` — the extension. Rebuilds each incoming message push into an iOS Communication Notification (`INSendMessageIntent`) with a big round avatar (DM: sender photo, group: group hero image), fetched via a plain `URLSession.shared.dataTask` (no auth headers) from the `avatarUrl` in the push `data` payload.
- `targets/notify-service/expo-target.config.js` — config for the `@bacons/apple-targets` Expo plugin that generates/embeds the Xcode target at prebuild. `deploymentTarget: '15.1'` (must match main app or the extension silently fails to load below that OS version — comment calls this out explicitly).
- `targets/notify-service/Info.plist` — `NSExtensionPointIdentifier: com.apple.usernotifications.service`, principal class `NotificationService`, supports `INSendMessageIntent`.
- `app.json` — `ios.entitlements.com.apple.developer.usernotifications.communication: true` (required on BOTH app target and extension target) + plugin list includes `@bacons/apple-targets`.
- `ios/Swellyo.xcodeproj/project.pbxproj` — confirms 2 native targets exist: main app (`com.apple.product-type.application`) and `com.swellyo.app.notification-service` (`com.apple.product-type.app-extension`), around pbxproj:202-243, bundle id lines 780/822.

Trigger side: `supabase/functions/send-push-notification/index.ts` sets `mutableContent: true` on every Expo push send, which is what invokes the NSE. It also sends `richContent: { image: avatarUrl }` for the Android large-icon equivalent (Android has no custom extension — just relies on expo-notifications' default FCM handling + `richContent.image` → `setLargeIcon`).

Android has **no** equivalent extension — no custom `FirebaseMessagingService` override in `android/app/src/main/AndroidManifest.xml`, just the stock expo-notifications library service (implicit via manifest merger) plus the `default` notification channel created client-side in `pushNotificationService.ts`.

**Why this matters for future "rich notification" asks (expandable text, image preview, inline audio):** the plumbing (NSE target, entitlements, prebuild config, mutable-content flag, data payload with URLs) already exists for the avatar use case — extending it to also attach a full image/audio (`UNNotificationAttachment`) is an incremental change to `NotificationService.swift`, not a from-scratch feature. See also [[project_chat_media_url_shapes_for_notifications]] for which chat media URLs are public vs private (an NSE download has no auth headers, so private/presigned URLs are a blocker).
