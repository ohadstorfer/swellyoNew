# Share Group Trip to Instagram Story — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Share to Story" on group trips — render a branded 9:16 story card (hero + trip info), hand it to Instagram Stories, copy the invite link for a manual Link sticker.

**Architecture:** The preview modal IS the image: a normal RN view captured with `react-native-view-shot` at 1080×1920, handed to Instagram via `react-native-share`'s `shareSingle(InstagramStories)`. Clipboard choreography differs per platform (iOS pasteboard clobbering). Spec: `docs/superpowers/specs/2026-07-13-share-trip-instagram-story-design.md`.

**Tech Stack:** react-native-share (new dep), react-native-view-shot (new dep), expo-clipboard / expo-sharing / expo-linear-gradient (already installed), PostHog via `logEvent`.

## Global Constraints

- **DO NOT COMMIT** — Ohad reviews and commits manually. Stage nothing.
- **NATIVE change** — new native deps; never OTA onto existing builds; PRE_BUILD_CHECKLIST.md applies at build time (not now).
- **Expo Go must never require the native modules** — guard with `isExpoGo` from `src/utils/keyboardAvoidingView.ts` and lazy `require()` (pattern: `src/utils/videoThumbnail.ts`).
- Fonts only via `ff()` from `src/theme/fonts.ts` — never bare `fontFamily`.
- User-facing errors only via `showErrorAlert` from `src/utils/friendlyError.ts`.
- Verification is `npx tsc --noEmit` + code review — no simulator/Maestro tests in this repo (Ohad tests on device).
- New env var `EXPO_PUBLIC_META_APP_ID`: missing ⇒ Instagram button hidden, feature degrades to generic share. Never crash on it.

---

### Task 1: Dependencies + native config

**Files:**
- Modify: `package.json` (via npm)
- Modify: `app.json` (plugins array, line ~91)

**Interfaces:**
- Produces: `react-native-share` and `react-native-view-shot` importable; `instagram-stories` scheme queryable on iOS; `com.instagram.android` queryable on Android.

- [ ] **Step 1: Install deps**

Run: `npm install react-native-share react-native-view-shot`
Expected: both land in `dependencies`, no peer errors on RN 0.81 / Expo 54.

- [ ] **Step 2: Add the react-native-share config plugin to `app.json`**

In the `plugins` array (after `"expo-secure-store"`), add:

```json
[
  "react-native-share",
  {
    "ios": ["instagram", "instagram-stories"],
    "android": ["com.instagram.android"]
  }
]
```

This plugin writes `LSApplicationQueriesSchemes` (iOS) and the `<queries>` manifest entry (Android). If the installed version has no config plugin (check `node_modules/react-native-share/app.plugin.js` exists), instead add the schemes manually to `ios.infoPlist.LSApplicationQueriesSchemes: ["instagram", "instagram-stories"]` and write a 10-line local config plugin for the Android `<queries>` entry.

- [ ] **Step 3: Verify config compiles**

Run: `npx expo config --type prebuild 2>&1 | grep -i -A2 LSApplicationQueriesSchemes`
Expected: shows `instagram-stories` in the resolved iOS config. (If the command errors on the plugin, fall back per Step 2.)

---

### Task 2: Share service

**Files:**
- Create: `src/services/share/instagramStoryShare.ts`

**Interfaces:**
- Consumes: `isExpoGo` from `src/utils/keyboardAvoidingView.ts`.
- Produces:
  - `isInstagramStoriesAvailable(): Promise<boolean>`
  - `shareToInstagramStory(opts: { base64Png: string; inviteUrl: string }): Promise<void>` (throws on share failure; caller handles alerts)

- [ ] **Step 1: Write the service**

```ts
import { Platform, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

// Instagram Stories third-party sharing (Meta "Sharing to Stories" spec):
// the image travels via UIPasteboard (iOS) / ACTION_SEND intent (Android),
// and since Jan 2023 Instagram silently rejects shares without a Meta App ID.
const metaAppId = (): string => process.env.EXPO_PUBLIC_META_APP_ID?.trim() || '';

export async function isInstagramStoriesAvailable(): Promise<boolean> {
  if (Platform.OS === 'web' || isExpoGo) return false;
  if (!metaAppId()) {
    console.warn('[instagramStoryShare] EXPO_PUBLIC_META_APP_ID missing — Instagram story share disabled');
    return false;
  }
  try {
    return await Linking.canOpenURL('instagram-stories://share');
  } catch {
    return false;
  }
}

/**
 * Hand a 1080x1920 PNG to Instagram's story composer and put the trip's
 * invite link on the clipboard so the user can paste it as a Link sticker
 * (Instagram dropped programmatic link attachment for third parties —
 * clipboard + manual sticker is the Spotify/Strava pattern).
 */
export async function shareToInstagramStory(opts: { base64Png: string; inviteUrl: string }): Promise<void> {
  // Lazy-required so Expo Go never touches the native module.
  const RNShare = require('react-native-share');
  const Share = RNShare.default ?? RNShare;
  const Social = RNShare.Social ?? Share.Social;

  if (Platform.OS === 'android') {
    // The Android intent doesn't touch the clipboard — safe to copy up front.
    await Clipboard.setStringAsync(opts.inviteUrl);
  }

  await Share.shareSingle({
    social: Social.InstagramStories,
    appId: metaAppId(),
    backgroundImage: `data:image/png;base64,${opts.base64Png}`,
  });

  if (Platform.OS === 'ios') {
    // iOS transports the image THROUGH the pasteboard, so copying the link
    // before sharing gets clobbered. Copy after Instagram has consumed the
    // payload (react-native-share#1388 workaround). Verify on device.
    setTimeout(() => {
      Clipboard.setStringAsync(opts.inviteUrl).catch(() => {});
    }, 2000);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (same error count as before the change, which is zero).

---

### Task 3: ShareTripStorySheet (preview modal + story card + capture)

**Files:**
- Create: `src/components/trips/ShareTripStorySheet.tsx`

**Interfaces:**
- Consumes: `TripDetailVM` + `formatDateRange` from `src/components/trips/TripDetailView.tsx`; `toWidthThumbUrl` from `src/services/media/thumbnails.ts`; `Logo` from `src/components/Logo.tsx`; `ff` from `src/theme/fonts.ts`; `showErrorAlert` from `src/utils/friendlyError.ts`; `logEvent` from `src/services/analytics/eventLogger.ts`; Task 2's service.
- Produces: `<ShareTripStorySheet visible tripId vm onClose />` — self-contained; the screen only toggles `visible`.

**UI notes (follow emilkowalski skill during implementation):**
- Full-screen RN `Modal` (`animationType="slide"`, `statusBarTranslucent`, `navigationBarTranslucent` — standalone-modal edge-to-edge gotcha).
- Card: 9:16, centered, rounded corners in preview (capture is the flat view). Rendered at logical size (screen width minus padding); `captureRef(..., { width: 1080, height: 1920 })` rescales output.
- **Use RN `Image` (not `expo-image`) inside the captured view** — expo-image has known blank-capture issues with view-shot on Android.
- Hero: `toWidthThumbUrl(vm.heroImageUri, 1080)`, full-bleed, `onLoad` gates the share buttons; `onError` falls back to gradient.
- No hero → brand gradient background (`#05BCD3` → `#0A3540` diagonal).
- Bottom scrim: `LinearGradient` transparent → `rgba(0,0,0,0.9)` over lower ~45%.
- Text block (bottom-left): title `ff('Montserrat','700')` 2-line clamp; destination + `formatDateRange(vm)` + `${vm.participantCount}/${vm.maxParticipants} surfers` in `ff('Inter','500')`.
- Branding (top or bottom-right): `<Logo size={40} iconOnly />` + "Swellyo" `ff('Montserrat','600')`.
- Below the card (NOT captured): link-sticker note ("We'll copy the trip link — paste it in Instagram as a Link sticker 🔗"), primary button **Share to Instagram** (only when `isInstagramStoriesAvailable()` resolves true), secondary **Share image…**, close affordance.

- [ ] **Step 1: Implement the component**

Skeleton (real implementation fleshes out styles per UI notes):

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Image, TouchableOpacity, Platform, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { type TripDetailVM, formatDateRange } from './TripDetailView';
import { toWidthThumbUrl } from '../../services/media/thumbnails';
import { Logo } from '../Logo';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import { logEvent } from '../../services/analytics/eventLogger';
import { isInstagramStoriesAvailable, shareToInstagramStory } from '../../services/share/instagramStoryShare';
import { getGroupTripInviteUrl } from '../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  tripId: string;
  vm: TripDetailVM;
  onClose: () => void;
}

export const ShareTripStorySheet: React.FC<Props> = ({ visible, tripId, vm, onClose }) => {
  const cardRef = useRef<View>(null);
  const [heroReady, setHeroReady] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [igAvailable, setIgAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (visible) isInstagramStoriesAvailable().then(setIgAvailable);
  }, [visible]);

  const heroUri = vm.heroImageUri ? toWidthThumbUrl(vm.heroImageUri, 1080) : null;
  const showHero = !!heroUri && !heroFailed;
  const canShare = !busy && (!showHero || heroReady);

  const capture = async (result: 'base64' | 'tmpfile'): Promise<string> => {
    // Lazy require — native module, absent in Expo Go (sheet is unreachable there).
    const { captureRef } = require('react-native-view-shot');
    return captureRef(cardRef, { format: 'png', quality: 1, result, width: 1080, height: 1920 });
  };

  const handleInstagram = async () => {
    setBusy(true);
    try {
      const base64Png = await capture('base64');
      await shareToInstagramStory({ base64Png, inviteUrl: getGroupTripInviteUrl(tripId) });
      logEvent('trip_story_shared', { tripId, target: 'instagram', platform: Platform.OS });
    } catch (e) {
      logEvent('trip_story_share_failed', { tripId, platform: Platform.OS });
      showErrorAlert('Share failed', e, "Couldn't open Instagram. Try 'Share image…' instead.");
    } finally {
      setBusy(false);
    }
  };

  const handleGenericShare = async () => {
    setBusy(true);
    try {
      const fileUri = await capture('tmpfile');
      await Sharing.shareAsync(fileUri, { mimeType: 'image/png' });
      logEvent('trip_story_shared', { tripId, target: 'sheet', platform: Platform.OS });
    } catch (e) {
      logEvent('trip_story_share_failed', { tripId, platform: Platform.OS });
      showErrorAlert('Share failed', e, "Couldn't share the image. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // render: Modal > backdrop > card (ref=cardRef, collapsable={false}) > controls
  // card children: hero Image OR gradient, scrim, text block, branding
  // IMPORTANT: cardRef view needs collapsable={false} or Android captures fail.
  /* ... styles per UI notes ... */
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

---

### Task 4: Wire into TripDetailScreen

**Files:**
- Modify: `src/screens/trips/TripDetailScreen.tsx` — imports (~line 92), state (near `reportSheetVisible`), `menuItems` (~line 1285), render (next to `<ReportTripSheet …/>`)

**Interfaces:**
- Consumes: `ShareTripStorySheet` (Task 3), `isExpoGo`.
- Produces: menu entry "Share to Story" in group 1, hidden on web/Expo Go.

- [ ] **Step 1: Add imports, state, menu entry, render**

```tsx
import { ShareTripStorySheet } from '../../components/trips/ShareTripStorySheet';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
```

State (next to the other sheet flags):
```tsx
const [storySheetVisible, setStorySheetVisible] = useState(false);
```

Menu entry, group 1, directly after the existing `share` entry (line ~1285). Entry appears whenever the share stack can exist (native, not Expo Go) — the sheet itself handles no-Instagram via the generic share button:
```tsx
(Platform.OS !== 'web' && !isExpoGo) && {
  key: 'shareStory',
  icon: 'logo-instagram' as const,
  label: 'Share to Story',
  group: 1,
  onPress: () => {
    setStorySheetVisible(true);
    logEvent('trip_story_share_opened', { tripId: trip.id });
  },
},
```

Render (find the `vm` variable passed to `TripDetailViewRedesigned`; reuse it):
```tsx
{storySheetVisible && trip && (
  <ShareTripStorySheet
    visible={storySheetVisible}
    tripId={trip.id}
    vm={vm}
    onClose={() => setStorySheetVisible(false)}
  />
)}
```

- [ ] **Step 2: Typecheck + self-review**

Run: `npx tsc --noEmit`
Expected: clean. Re-read the diff: menu entry is a conditional array element matching the existing `(cond) && { … }` pattern; `trip.id` non-null inside the handler.

---

### Task 5: Final verification + manual steps handoff

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Grep the guards**

Run: `grep -rn "require('react-native-share')\|require('react-native-view-shot')" src/`
Expected: only inside lazy functions, never top-level imports.

- [ ] **Step 3: Report manual steps to Ohad (do NOT do them)**

1. Register a (free) Meta app at developers.facebook.com → copy the App ID.
2. Add `EXPO_PUBLIC_META_APP_ID` to `.env` and to EAS env for all build profiles.
3. Next native rebuild picks up the new modules (rides with Share-to-Swellyo rebuild); PRE_BUILD_CHECKLIST.md at build time.
4. On-device verification: iOS clipboard-after-2s workaround; Android immediate copy; no-Instagram fallback; trip without hero image.
