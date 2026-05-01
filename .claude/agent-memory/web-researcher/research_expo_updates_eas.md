---
name: expo-updates EAS Update Setup — Existing Production App
description: How to add expo-updates to an existing Expo SDK 54 project already on App Store/Play Store; installation, app.json config, eas.json channel fields, runtimeVersion policy comparison, new binary requirement, first publish flow.
type: reference
---

## Topic
Adding expo-updates (EAS Update / OTA) to an existing Expo SDK 54 / RN 0.81 project that has no prior expo-updates installation. Current version 1.0.8.

## Key Findings

### Installation
1. `npx expo install expo-updates`
2. `eas update:configure` — auto-adds `runtimeVersion`, `updates.url` to app.json and `channel` to preview + production build profiles in eas.json

### app.json updates block
- `updates.url` — set by `eas update:configure` automatically (points to expo.dev manifest endpoint)
- `updates.enabled` — default true, no need to set explicitly
- `updates.fallbackToCacheTimeout` — default 0ms (loads cached bundle immediately, checks update in background). Recommended: `0` for fast cold start + `checkAutomatically: ON_LOAD`
- `updates.checkAutomatically` — `ON_LOAD` is default and recommended for most apps
- `runtimeVersion` — set to `{ "policy": "appVersion" }` for a stable production app (simplest; ties to version field; fingerprint = more builds, literal string = manual discipline)

### eas.json
- `eas update:configure` adds `"channel": "preview"` and `"channel": "production"` to matching build profiles
- Swellyo's current eas.json has no channel fields — they will be added by the configure command

### New Binary Required?
YES. expo-updates must be compiled into the native binary. The existing 1.0.8 binary on the stores cannot receive OTA updates — it has no expo-updates native code. Must build and submit a new binary (1.0.9 or 1.1.0) through App Store review + Play Store review.

### Channel → Branch mapping
- Default: channel and branch of the same name auto-link (production channel → production branch)
- Can be manually overridden via EAS dashboard or CLI: `eas channel:edit production --branch some-other-branch`

### First Publish Flow (after new binary is live)
1. `eas update --channel production --message "First OTA update"`
2. App checks for update on next launch (ON_LOAD), downloads in background, applies on next cold start
3. No "first publish" gotcha per se — just ensure runtimeVersion in the update matches the binary

### runtimeVersion Policy Comparison
- `{ "policy": "appVersion" }` — simple, matches version field; risk: if native code changes without bumping version you get mismatch. Recommended for teams that bump version with every release.
- `{ "policy": "fingerprint" }` — automatic, safest, but requires a new build any time native layer changes (even indirect). Best long-term, was beta in SDK 51, stable in SDK 54.
- `{ "policy": "sdkVersion" }` — rarely recommended; ties to Expo SDK version, too coarse.
- Literal string (e.g., `"1.0.0"`) — full manual control; use if you want explicit per-major-version targeting.

## Sources
- https://docs.expo.dev/eas-update/getting-started/
- https://docs.expo.dev/eas-update/runtime-versions/
- https://docs.expo.dev/eas-update/deployment-patterns/
- https://docs.expo.dev/eas-update/how-it-works/
- https://medium.com/@julien_34351/youre-certainly-using-the-wrong-runtimeversion-in-expo-ce3466d4d2fe
</content>
</invoke>