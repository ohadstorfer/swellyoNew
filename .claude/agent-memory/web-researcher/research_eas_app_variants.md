---
name: EAS App Variants — app.json vs app.config.js + APP_VARIANT pattern
description: How app.json and app.config.js interact in EAS builds; correct approach for dev vs prod package IDs using APP_VARIANT
type: reference
---

## Key facts

### File precedence (when both app.json and app.config.js exist)

- app.config.js ALWAYS wins as the final config — its return value is what EAS uses
- BUT: whether app.json values are available depends on HOW app.config.js exports

**Plain object export** (`module.exports = { expo: {...} }`):
- app.json is silently IGNORED — not merged, not passed through
- Confirmed by expo/expo#22706 (Expo team + Brent Vatne)
- `npx expo-doctor` will warn about this

**Function export** (`module.exports = ({ config }) => ({...config, ...overrides})`):
- app.json is read first, normalized, then passed as `config` argument
- Function return value = final config
- This is the "middleware" pattern — the CORRECT way to use both files together

### APP_VARIANT in eas.json — the official approach

Official Expo tutorial "Configure multiple app variants" confirms:
- Set `env: { APP_VARIANT: "development" }` in eas.json build profile
- Read `process.env.APP_VARIANT` in app.config.js to branch package IDs
- Each variant must have a UNIQUE package ID to allow side-by-side installation

### Should app.json be deleted?

NO — keep both. app.json holds static config (plugins, permissions, versionCode, splash, etc.)
app.config.js function form receives it and can selectively override (package, bundleIdentifier, name).

### Verifying locally

`npx expo config --type public` — evaluates config exactly as EAS Build does, shows final merged output.

## Current Swellyo state (as of 2026-04-13)

app.config.js uses `module.exports = { expo: {...} }` — plain object form.
This means app.json is currently SILENTLY IGNORED during EAS builds.
The IS_DEV logic is correct but the config is self-contained (duplicates app.json content).
This works because app.config.js has all fields — but is fragile (divergence risk).

The recommended fix: convert to function form so app.json stays the single source of truth for static values,
and app.config.js only overrides the variant-specific fields (package, bundleIdentifier, name).

## Does System.getenv() in build.gradle work with eas.json env vars?

**Yes — the env field variables are set as actual system environment variables on the EAS build machine.** The official eas.json docs state: "These environment variables will be used to evaluate app.config.js locally when you run eas build, and they will also be set on the EAS Build builder."

"Set on the EAS Build builder" means they are real OS-level env vars on the Linux build server — which means `System.getenv("APP_VARIANT")` in build.gradle WILL work.

**However: EAS CLI has a separate auto-detection concern.** EAS CLI needs to detect the applicationId for its own metadata. If you use `System.getenv()` in a bare `applicationId` assignment (not inside a productFlavor block), EAS CLI's static analysis may fail to autodetect the applicationId. This causes a different, non-fatal CLI warning, but the build itself proceeds fine.

**What the community actually does (confirmed by official Expo docs):**
- Official docs (`/build-reference/variants/`) recommend Android **product flavors** with hardcoded applicationIds, NOT System.getenv().
- Use `gradleCommand` in eas.json (e.g. `:app:assembleDevelopmentDebug`) to select the flavor — no env vars needed in build.gradle.
- This is the only approach that EAS CLI can statically analyze for applicationId autodetection.

**The System.getenv() approach technically works** (env vars ARE available during Gradle), but:
1. No official Expo example uses it for applicationId.
2. EAS CLI cannot statically detect the resulting applicationId.
3. Product flavors + gradleCommand is the officially supported and safer pattern.

## Sources
- https://docs.expo.dev/workflow/configuration/ — official resolution order docs
- https://docs.expo.dev/tutorial/eas/multiple-app-variants/ — official APP_VARIANT tutorial
- https://github.com/expo/expo/issues/22706 — confirmed: plain object silently ignores app.json
- https://github.com/expo/expo-cli/issues/4100 — merge behavior confirmed by Brent Vatne
- https://docs.expo.dev/build-reference/variants/ — official product flavors approach (no System.getenv)
- https://docs.expo.dev/build/eas-json/ — "will also be set on the EAS Build builder" (confirms OS-level env)
- https://github.com/expo/eas-cli/issues/2133 — applicationId autodetect fails with dynamic gradle values
