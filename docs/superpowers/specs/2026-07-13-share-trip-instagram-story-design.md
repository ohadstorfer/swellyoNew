# Share Group Trip to Instagram Story — Design

**Date:** 2026-07-13
**Status:** Approved by Ohad (brainstorming session)
**Type:** NATIVE change (new native deps) — ships with the next native rebuild, NOT OTA-able onto existing builds. Card design itself is JS and OTA-iterable afterwards.

## Goal

From a group trip's detail screen, a user can share a pre-generated branded story image (trip hero image + trip info + Swellyo branding) to Instagram Stories, with the trip invite link copied to the clipboard so the user can paste it as a Link sticker.

## Hard constraint discovered in research

**Instagram does not allow third-party apps to attach a tappable link to a shared story.** The legacy `contentURL`/`attributionURL` pasteboard keys appear to work in Instagram's compose screen but are silently dropped when the story is published (confirmed 2024+: react-native-share#1265, absent from Meta's current spec). Spotify and Strava don't have it either. The standard pattern — which this feature adopts — is: share the image + copy the deep link to the clipboard + tell the user to paste it as a Link sticker (2 manual taps inside Instagram).

## UX flow

1. Trip Detail → action menu → new entry **"Share to Story"** (next to the existing "Share Trip" entry, same visibility: anyone viewing the trip). Hidden on web and in Expo Go.
2. Tapping opens a full-screen preview modal (`ShareTripStorySheet`) showing the story card exactly as it will be published.
3. Buttons:
   - **"Share to Instagram"** (primary) — only shown if Instagram is installed (`Linking.canOpenURL('instagram-stories://')`).
   - **"Share image…"** (secondary) — generic native share sheet via `expo-sharing` (fallback for no-Instagram, also useful for WhatsApp status etc.).
4. Visible note on the preview: *"We'll copy the trip link — paste it in Instagram as a Link sticker 🔗"*.
5. On "Share to Instagram": capture card → copy invite link → hand off to Instagram, which opens directly in "Add to story" with the image placed. User adds the Link sticker manually.

## Story card (the preview IS the image)

Rendered as a normal React Native view at 9:16, captured with `react-native-view-shot`'s `captureRef` at 1080×1920 PNG. What you see is literally what gets published.

Layout (full-screen `backgroundImage` variant):
- Hero image full-bleed — large S3 width-variant via the existing thumbnail helpers (`src/services/media/thumbnails.ts`), rendered with `expo-image`. Trips **without** a hero image get a brand-gradient background instead.
- Dark gradient scrim at the bottom (`expo-linear-gradient`).
- Trip title (2-line clamp), destination label, dates, participant count (`X/Y surfers`), Swellyo logo/wordmark.
- All text uses `ff()` from `src/theme/fonts.ts` (never bare fontFamily).
- Share buttons stay disabled until the hero image fires `onLoad` (so the capture never contains a half-loaded image).

## Share mechanics

- `react-native-share` → `Share.shareSingle({ social: Social.InstagramStories, backgroundImage: <file/base64>, appId: META_APP_ID })`.
- **Meta App ID is mandatory** (since Jan 2023 Instagram silently rejects shares without it). Free dashboard-only registration at developers.facebook.com — no App Review. New env var: `EXPO_PUBLIC_META_APP_ID`. **Manual step for Ohad: register the app and set the var (EAS + .env).**
- **Clipboard ordering gotcha (iOS):** the iOS share mechanism transports the image via `UIPasteboard`, so copying the link *before* sharing gets clobbered. Behavior:
  - Android: copy invite link immediately, then fire the intent (intent doesn't touch the clipboard).
  - iOS: fire the share first, then copy the link after a ~2s delay (known workaround, react-native-share#1388). **Must be verified on-device** — if the delayed background write fails, fallback is re-copying on `AppState` → active plus keeping the note visible in the preview.
- Invite link: existing `getGroupTripInviteUrl(tripId)` → `https://swellyo-invite.netlify.app/?grouptrip=<id>` (OG preview already works via the Netlify edge function).

## Native/config changes

- New deps: `react-native-share`, `react-native-view-shot`.
- `app.json`: iOS `LSApplicationQueriesSchemes` += `instagram-stories` (and `instagram`); Android `<queries>` entry for `com.instagram.android` (via react-native-share config plugin or manual manifest config).
- Rides the already-pending native rebuild (Share-to-Swellyo etc.). Follow PRE_BUILD_CHECKLIST.md at build time.
- Both native modules are lazily required behind the Expo Go guard so Expo Go sessions never touch them (guard pattern: `isExpoGo` check before `require()`, module-level, same as `videoThumbnail.ts`).

## Error handling

- All user-facing errors via `showErrorAlert`/`friendlyErrorMessage` (`src/utils/friendlyError.ts`) — never raw `e.message`.
- Capture failure or share failure → friendly alert, modal stays open so the user can retry or use the generic share.
- Missing `EXPO_PUBLIC_META_APP_ID` → treat as "Instagram unavailable" (hide primary button, log a warning) rather than a broken share.

## Analytics (PostHog)

- `trip_story_share_opened` — preview modal opened.
- `trip_story_shared` — `{ target: 'instagram' | 'sheet', platform }`.
- `trip_story_share_failed` — `{ stage: 'capture' | 'share', platform }`.

## Files

- **NEW** `src/components/trips/ShareTripStorySheet.tsx` — preview modal + story card + buttons.
- **NEW** `src/services/share/instagramStoryShare.ts` — availability check, capture-agnostic share wrapper, clipboard choreography, Expo Go guard.
- **EDIT** `src/screens/trips/TripDetailScreen.tsx` — menu entry + modal state.
- **EDIT** `app.json`, `package.json`.

## Out of scope

- Surftrips (only group trips for now; the sheet takes a small VM so extending later is cheap).
- Sticker-image variant, video stories, Facebook stories.
- Automated link sticker (impossible — see constraint above).

## Acceptance criteria

- On a dev build with Instagram installed: "Share to Story" → preview renders hero + correct trip data → "Share to Instagram" opens Instagram with the image as story background → link is in the clipboard (Android immediately; iOS after returning ~2s delay) → pasting into a Link sticker yields the working invite URL.
- Without Instagram: primary button hidden, generic share sheet works.
- In Expo Go / web: menu entry absent, no crash on trip detail.
- Trip without hero image: gradient card, no broken image.
- `npx tsc --noEmit` clean.
