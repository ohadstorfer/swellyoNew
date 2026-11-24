# OTA gate and critical updates

Code: `src/ota/otaGate.ts` (logic), `src/ota/criticalIndex.ts`. Wired in
`App.tsx` (starts the gate at module load, holds the ATT prompt),
`src/components/AppContent.tsx` (keeps the loading video up while the gate is
not idle) and `src/screens/WelcomeScreen.tsx` (the "Updating…" line).
Images: `assets/ota/`.

Remote value: Supabase `public.app_config`, key `ota_critical`
(migration `supabase/migrations/20261119000000_app_config_ota_critical.sql`, applied 19 Nov 2026).

## What people see

A normal launch whose loading video lasts longer. There is one loading screen,
the real one: `WelcomeScreen` with `isCheckingAuth` (video + spinning logo).
`AppContent` shows it while the session restores **or** while the gate is
`checking` / `waiting`, and `WelcomeScreen` adds "Updating…" while it
downloads.

When the download is in, `reloadAsync()` restarts JS. That destroys the video
with everything else, so for about a second native shows its reload screen:
`assets/ota/reload-screen.jpg`, a still of the loading screen on the video's
first frame. The new `WelcomeScreen` draws that same first frame
(`assets/ota/loading-first-frame.jpg`) under the video until it plays, so it
reads as the video pausing for a moment.

## What the gate does

Release builds only (off in `__DEV__`, on web, and in Expo Go).

A launch **waits** when it runs the store build's embedded JS
(`Updates.isEmbeddedLaunch`: a fresh install, or the first launch after a store
update), or when `ota_critical` > `CRITICAL_INDEX`. Every other launch is never
held.

While waiting, the gate **follows the native updater** (`Updates.latestContext`
+ state-change events) instead of calling `checkForUpdateAsync()`: native
already checks and downloads at launch (`CHECK_ON_LAUNCH=ALWAYS`), and a JS
check is queued behind that whole startup procedure, download included.

| Native state | Gate |
| --- | --- |
| checking | loading video held (no label) |
| downloading | "Updating…" |
| update downloaded (`isUpdatePending`) | reload into it |
| done, checked, nothing newer | carry on (`idle`) |
| done with an error, or never checked | one check + fetch of its own |
| nothing downloading after 8 s, or 25 s in total | carry on on the current code; the download lands next launch |

| Launch | What people see |
| --- | --- |
| Fresh install / first launch after a store update | Loading video. If an OTA is newer: "Updating…", reload, loading video, app. |
| Normal launch | Exactly as before. Background: read `ota_critical` (3 s cap). |
| `ota_critical` > `CRITICAL_INDEX` | Loading video held (brought back if the app had already opened) with "Updating…" while it downloads, then reload. |
| Emergency launch (an OTA kept crashing) | Never waits, never reloads. |
| Non-critical update | Nothing in JS. Native downloads it; it runs on the next cold start. |

Tests: `src/ota/__tests__/otaGate.test.ts` drives the native state by hand.

## Regenerating the images

If the background video or `WelcomeScreen`'s loading layout changes, the two
images in `assets/ota/` go stale (the reload still would no longer match).
Regenerate them from frame 0 of `assets/videos/swellyo169welcome.mp4`:

- `loading-first-frame.jpg`: the frame as is.
- `reload-screen.jpg`: 393×852 pt @3x. Video frame drawn with "cover", the
  `WelcomeScreen` gradient (transparent → transparent at 0.187 →
  rgba(0,0,0,0.29) at 0.755), and the column centred in y 80…852: logo icon
  112, gap 24, wordmark 245×37, gap 10, tagline bold 16 / line 24 (system
  font: `WelcomeScreen` uses the unregistered bare `'Montserrat'`).

## Publishing a CRITICAL OTA

Order matters. Raising the server value first makes every launch look for an
update that isn't there yet (harmless, but it checks for nothing).

1. Walk `PRE_BUILD_CHECKLIST.md` as for any OTA.
2. In the commit you publish, bump `CRITICAL_INDEX` in `src/ota/criticalIndex.ts`
   by 1 (e.g. `0` → `1`). Never lower it.
3. Publish for both platforms:
   ```bash
   eas update --branch production --environment production --platform all --message "CRITICAL: <summary>"
   ```
4. Wait until it shows on expo.dev for iOS and Android.
5. Then, in the Supabase SQL editor of the **Swellyo** project:
   ```sql
   update public.app_config set value = '1'::jsonb, updated_at = now()
   where key = 'ota_critical';
   ```
   (same number as the new `CRITICAL_INDEX`).

The next OTA after that does not need to touch anything: its bundle carries
the new `CRITICAL_INDEX`, so `server == bundle` and launches stop waiting.

## Limits

- Fresh installs only benefit once a **store build** contains the gate (the
  first launch runs the embedded JS). Existing users get the critical path as
  soon as they receive the OTA that contains the gate.
- The critical path can send someone back to the loading video if the
  `ota_critical` read comes back after the session was restored. Use it for
  real emergencies only.
- A launch that waits boots the app once before the reload (analytics may log
  one extra "app opened"). The ATT prompt waits until the gate is idle.
- `addUpdatesStateChangeListener` / `latestContext` are what `useUpdates()`
  uses inside, but marked `@hidden` in expo-updates. Re-check them when
  upgrading expo-updates (the tests will catch a removed export).
- During the reload second the logo doesn't spin, and on screens with other
  proportions the still can sit slightly off the live layout.
- Can't be tested in dev / Expo Go. Test with a `preview` build + an
  `eas update --branch preview`.

## Runtime version

Nothing here touches `app.json` or native files. Our `runtimeVersion` is a
fixed string (`2.0.8`), not the `fingerprint` policy, so JS changes can't move
it anyway. Still, don't put this config in `app.json` (`updates.*` / `extra`):
those end up in native config and require a store build.
