---
name: research-rich-push-notifications-whatsapp-parity
description: iOS/Android/Expo requirements to replicate WhatsApp's 3 rich-notification behaviors (long text expand, image preview, inline audio) — what's free vs needs native extension vs impossible without one
metadata:
  type: reference
---

Researched 2026-07-08 for a potential WhatsApp-parity rich-notification feature (long text / photo / voice DM pushes).

## Behavior 1 — Long text expansion (FREE, no native work, works today)
- iOS: plain remote push, full `body` text, long-press/haptic-touch on banner auto-expands to full text. No `UNNotificationServiceExtension` or `UNNotificationContentExtension` needed. ~80 chars visible in banner, ~178 chars on lock screen before scroll.
- Android: FCM/Expo notifications already get progressive-disclosure expansion (`BigTextStyle`-equivalent) out of the box. Stock limits ~65 char title / ~240 char body in expanded view, less collapsed. Manufacturer skins (MIUI, OneUI) vary this.
- Action: no code change needed in Swellyo — just don't truncate the body ourselves.

## Behavior 2 — Photo preview
- Android: Expo's `richContent: { image: url }` in the push payload renders full image "out of the box" — confirmed in Expo docs. No native build needed.
- iOS: `richContent.image` is silently ignored unless the app ships a `UNNotificationServiceExtension` target. The extension intercepts the push post-delivery, downloads the image (must be off the 4KB push payload — pass a URL, not base64), wraps it in `UNNotificationAttachment`, re-presents notification.
- Expo path: NOT supported by managed `expo-notifications` alone. Needs `expo prebuild`/EAS Build + a community config plugin (e.g. `expo-notification-service-extension-plugin`, github.com/d4works/expo-notification-service-extension-plugin) that adds a real Xcode NSE target, PLUS registering it in `app.config.js` via `appExtensions` so EAS signs/bundles it. This is a NATIVE BUILD change, not OTA-able.
- Gotcha found in community threads: Expo push API silently drops `richContent` if you send a single bare object instead of an array of messages — always send as array even for 1 recipient.
- `expo-notifications` local-notification `attachments` field (NotificationContentAttachmentIos) works without any extension, but only for on-device-scheduled local notifications, not remote pushes — irrelevant to the DM-push use case.

## Behavior 3 — Inline voice playback (HARDEST, most expensive)
- Android: There is no such thing as an audio-playing notification shell. Best achievable = `NotificationCompat.MediaStyle` with up to 5 transport-control action buttons (play/pause icon) wired via `PendingIntent` to a foreground service (`mediaPlayback` type, declared since Android 10) that does the real decoding/playback. MediaSession token can show album-art-style visuals on lock screen. Android 12+ restricts *background-started* foreground services but user-tap-from-notification is exempt.
- iOS: Requires a SECOND, separate extension type from the NSE: `UNNotificationContentExtension` (Content Extension, not Service Extension) — a full custom `UIViewController` replacing the expanded notification UI. Only ONE genuinely interactive control is offered by the OS: implement `mediaPlayPauseButtonType` (.overlay/.default) + `mediaPlayPauseButtonFrame`; system draws the button, calls your `mediaPlay()`/`mediaPause()`. No arbitrary custom scrubber/waveform interaction — everything else in the view is static.
- This needs a brand-new Xcode target (own bundle ID, own entitlements/provisioning, own EAS credentials setup) — meaningfully bigger lift than the NSE for images. Recommend scoping as separate/later phase from photo rich-push.

## Platform gate
- None of image-attachment, MediaStyle, or Content Extension work in Expo Go — all three require a dev client / EAS build with the relevant native extension target compiled in.
- Android 13+ `POST_NOTIFICATIONS` runtime permission is unrelated to rich content — it's just the on/off switch for notifications at all; auto-granted on upgrade, must runtime-request on fresh installs.

## Applies to Swellyo
- Push sending lives in `supabase/functions/send-push-notification/index.ts` (Edge Function → Expo push API). Adding `richContent.image` there is a one-line-ish change that gets Android photo-DM rich push for free; iOS needs the NSE native-build project (flag for PRE_BUILD_CHECKLIST.md — native change, not OTA-able).
- `src/components/AudioMessageBubble.tsx` is the in-app voice player; a notification-level player (Behavior 3) would be an entirely separate native subsystem, not a reuse of that component.
