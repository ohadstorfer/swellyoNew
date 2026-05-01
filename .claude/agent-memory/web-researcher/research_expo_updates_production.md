---
name: expo-updates Production Setup — Pitfalls and Best Practices
description: Runtime version policies, OTA silent failures, env vars in eas update, rollback, Apple 4.7 compliance, channel/branch isolation, first-install behavior
type: reference
---

## Runtime Version Policy

- **appVersion** (default from `eas update:configure`): ties runtimeVersion to the `version` field in app.json. Safe, predictable. If you forget to bump `version` when adding a native module, the OTA reaches binaries that can't run it — crashes. Manual discipline required.
- **fingerprint**: automatically detects any native change and increments runtime version. Prevents all crashes but causes more builds — and has a known bug in SDK 54 where AAB builds may not sync the fingerprint correctly (issue #41694), causing `updateRejectedBySelectionPolicy` silently on Google Play users.
- **nativePolicyVersion / sdkVersion**: generally discouraged; sdkVersion is coarse and breaks too broadly.
- **literal**: static string — completely manual, footgun territory.

**Recommendation for small teams (Swellyo)**: `appVersion` policy. Bump `version` in app.json for every store build. Never skip it. This is what Expo's own `eas update:configure` sets by default.

## Env Vars in `eas update`

- **SDK 54 and earlier**: `eas update` runs `npx expo export` locally. It reads `EXPO_PUBLIC_*` from local `.env` files the same way Metro does. If local `.env` has dev/staging values, the OTA bundle is baked with wrong values.
- **SDK 55+**: `--environment` flag required. Only EAS dashboard env vars are used — local `.env` is ignored.
- **`EXPO_PUBLIC_*` vars are inlined at bundle time** — they are not runtime-readable from EAS servers. Changing them requires a new `eas update`.
- **Known issue**: `expo-updates` does not refresh `.env` values between OTA updates (issue #39832). Once baked, they are frozen.
- **Safe workflow for Swellyo (SDK 54)**: before running `eas update`, confirm local shell has production env values loaded, or switch to EAS environment variables on the dashboard and use `--environment production`.

## First Install / First Launch Behavior

- On first launch after App Store install, the **embedded bundle** (the one baked into the binary) runs — not an OTA.
- The update check happens in the background. If download completes within `fallbackToCacheTimeout`, the new update runs immediately. If not, it runs on the **next launch**.
- There is no race condition per se — users just run embedded code on launch 1, then get the OTA on launch 2.
- Consequence: the embedded bundle in every new store build should be production-ready, not a stale dev bundle.

## Bundle Compatibility — What Breaks

- If JS code in an OTA references a native module not in the installed binary, the app crashes on load.
- This is the #1 footgun: adding a native library (e.g., a new Expo module), forgetting to bump `runtimeVersion`, shipping an OTA → crash for users who haven't updated the binary.
- **Rule**: any time you add/remove/upgrade a native module or touch `app.json` plugins, you MUST ship a new native build AND bump `runtimeVersion` before publishing an OTA.

## Rollback

- `eas update:rollback` — interactive; offers two options:
  1. Republish a previous OTA update (users get that older JS bundle)
  2. Roll back to embedded bundle (users run what was baked into their binary)
- Can also `eas update:republish --destination-channel production` to promote a tested staging bundle directly to production (no re-bundling, same hash).
- Gradual rollout: `eas update --rollout-percentage 10` to canary before full push.

## Channel / Branch Strategy

- Channels are defined per build profile in `eas.json`. Simplest: match channel name to profile name.
- `production` build profile → `channel: "production"` → only receive `eas update --channel production` pushes.
- `preview` build profile → `channel: "preview"` → staging OTA stream.
- Never publish to `production` channel without first testing same bundle on `preview` channel build.
- Use `eas update:republish --destination-channel production` to promote from preview → production.

## Apple Guideline Compliance

- Relevant rule: **DPLA Section 3.3(b)**, not 4.7 (4.7 is specifically about HTML5 mini-apps, tightened November 2025).
- Section 3.3(b) allows interpreted/JS code via OTA if: (a) does not change primary app purpose, (b) does not create a storefront, (c) does not bypass security features.
- **Safe via OTA**: bug fixes, copy/text changes, layout tweaks, color changes, logic fixes, feature improvements to existing flows.
- **Risky via OTA**: adding entirely new top-level features or screens that fundamentally change what the app does. In practice, Expo apps are very rarely rejected for this — but don't use OTA to ship a payment screen that wasn't in the reviewed binary.
- Google Play has no equivalent restriction — Play policy allows JS OTA freely.

## Native Setup — Config Plugin Required?

- For **managed workflow** (Swellyo's case): NO config plugin needed. `eas update:configure` modifies `app.json` only (adds `updates.url`, `runtimeVersion`, confirms `extra.eas.projectId`). EAS handles native file patching at build time.
- For **bare workflow**: native files (AndroidManifest.xml, Expo.plist) must be modified, which `eas update:configure` also handles.

## Known Bugs to Watch (SDK 54)

- **AAB + runtimeVersion mismatch**: After SDK 54 upgrade, AAB builds may embed old runtimeVersion in strings.xml while APK builds are correct. Affects Google Play OTA delivery — users get `updateRejectedBySelectionPolicy` silently. Issue #41694 open as of early 2026. Workaround: verify runtimeVersion in built AAB before publishing OTA.

## Sources
- https://docs.expo.dev/eas-update/runtime-versions/
- https://docs.expo.dev/eas-update/rollbacks/
- https://docs.expo.dev/eas-update/deployment/
- https://docs.expo.dev/eas-update/how-it-works/
- https://docs.expo.dev/eas/environment-variables/
- https://github.com/expo/expo/issues/41694 (AAB runtimeVersion bug SDK 54)
- https://github.com/expo/expo/issues/39832 (env vars not refreshed in OTA)
- https://github.com/expo/eas-cli/issues/2847 (eas update env var cache)
- https://github.com/expo/expo/discussions/16286 (Apple/Google policy discussion)
- https://dev.to/nour_abdou/react-native-ota-updates-with-expo-eas-step-by-step-guide-best-practices-1idk
