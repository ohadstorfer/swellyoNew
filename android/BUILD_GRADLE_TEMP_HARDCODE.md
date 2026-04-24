# ⚠️ android/app/build.gradle — TEMP HARDCODE

**Status:** `android/app/build.gradle` currently has the `applicationId` temporarily hardcoded.

## Current state (in repo)

```gradle
// TEMP HARDCODE — revert before committing
applicationId 'com.swellyo.app'
```

## What it MUST be before any commit / push / PR

```gradle
applicationId System.getenv("APP_VARIANT") == "development" ? 'com.swellyo.app.dev' : 'com.swellyo.app'
```

## Why the hardcode exists

Running `npm run android` / `npx expo start --dev-client` fails with:

```
CommandError: Failed to locate the android application identifier in the "android/" folder.
```

Expo CLI parses `build.gradle` statically and cannot resolve the `System.getenv(...)` ternary, so local Android dev runs break. Hardcoding the value to `'com.swellyo.app'` unblocks local dev against the emulator.

## Rules for Claude agents working on this repo

1. **NEVER commit the hardcoded version.** Before any `git commit`, `git push`, or `gh pr create` that touches `android/app/build.gradle`, run:
   ```
   git checkout android/app/build.gradle
   ```
   to restore the env-var ternary.

2. **If you see the ternary restored and Ohad reports the Expo CLI error**, re-apply the hardcode (it was reverted after the last commit and now local Android dev is broken again).

3. **Do not "fix" this file by picking one form or the other permanently** — both forms are needed: ternary for EAS / CI builds (so the `.dev` variant is produced), hardcode for local Expo CLI runs.

4. **Remind Ohad about this every session** where Android work or committing is happening. He has explicitly asked for frequent reminders.

5. Until reverted, the `com.swellyo.app.dev` variant is NOT produced, which may conflict with EAS dev builds or split install of prod + dev on the same device.
