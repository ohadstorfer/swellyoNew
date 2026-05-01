# Pre-Build Checklist

Run through this **before any `eas build` or `eas update`**. Anything missed here is something users in production will see.

This file is also referenced from `.claude/CLAUDE.md` so any Claude session that detects a build/ship/release intent walks the list automatically.

---

## TL;DR — the two-minute scan

1. Local `.env` flags are **off** OR EAS production env vars are wired (`environment: "production"` in `eas.json`)
2. All **5 version spots** match (see below) — only matters when bumping for a native build
3. Any new DB migrations have been applied to Supabase **manually** in the SQL editor
4. `git status` is clean and on the right branch
5. For OTA: the in-store binary you're targeting was built with `expo-updates` enabled (true for `1.1.0+`, false for anything older)

---

## 1. Version sync — five spots that must match

`eas.json` uses `cli.appVersionSource: "local"`, so EAS reads the version from the native files, **not from `app.json`**. Because the project is in **bare workflow** (committed `ios/` and `android/` folders), runtime-version POLICIES (e.g. `{ policy: "appVersion" }`) are **not supported** — EAS will refuse to start with: `"runtime version policies are not supported"`. We use a **literal string** for `runtimeVersion` instead, which means all five values must be kept in lockstep manually.

When bumping the app version (e.g. `1.1.0 → 1.2.0`), update **all** of these:

| File | Field | Notes |
|---|---|---|
| `app.json` | `expo.version` | Displayed app version. Must match `runtimeVersion` below since policies aren't supported in bare workflow. |
| `app.json` | `expo.runtimeVersion` (literal string) | What `eas update` tags new bundles with. **Must match the string below.** |
| `ios/swellyo/Supporting/Expo.plist` | `EXUpdatesRuntimeVersion` (string) | Native iOS reads this on launch to know which OTA channel runtime applies |
| `android/app/src/main/AndroidManifest.xml` | `expo.modules.updates.EXPO_RUNTIME_VERSION` | Same for Android |
| `android/app/build.gradle` | `versionName` | The displayed app version on Android |
| `ios/swellyo.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (×2 occurrences) | The displayed app version on iOS |

### Verify with one command

```bash
node -e "
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('app.json','utf8')).expo.version;
const plist = (fs.readFileSync('ios/swellyo/Supporting/Expo.plist','utf8').match(/EXUpdatesRuntimeVersion[^]*?<string>([^<]+)<\/string>/) || [])[1];
const manifest = (fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8').match(/EXPO_RUNTIME_VERSION\" android:value=\"([^\"]+)\"/) || [])[1];
const gradle = (fs.readFileSync('android/app/build.gradle','utf8').match(/versionName \"([^\"]+)\"/) || [])[1];
const pbxAll = [...fs.readFileSync('ios/swellyo.xcodeproj/project.pbxproj','utf8').matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map(m=>m[1]);
const all = [app, plist, manifest, gradle, ...pbxAll];
console.log('app.json:', app);
console.log('Expo.plist:', plist);
console.log('AndroidManifest:', manifest);
console.log('build.gradle:', gradle);
console.log('project.pbxproj:', pbxAll.join(', '));
console.log(new Set(all).size === 1 ? '✅ All match' : '❌ DRIFT — values differ');
"
```

`buildNumber` (iOS) and `versionCode` (Android) auto-increment on the EAS build server (per `eas.json` `production.ios.autoIncrement` / `android.autoIncrement`). Don't bump those manually unless you have a reason.

---

## 2. Environment variables

The bundle that ships **bakes in** all `EXPO_PUBLIC_*` variables at build time. Wrong values → wrong behavior in production for the lifetime of that bundle.

### What's currently wired

- EAS env vars are configured in the **production** environment on Expo's dashboard (Supabase, Google×4, PostHog, Pexels, Google Places, mode flags all `false`)
- `eas.json` `production` profile has `"environment": "production"` so builds pull from EAS
- `eas.json` `preview` profile has `"environment": "preview"` (set up the preview env if not already)

### Before pressing build

- [ ] **EAS Build** — relies on EAS env vars automatically. **No action needed** as long as the `environment` field is on the profile.
- [ ] **EAS Update** — always pass `--environment production`. Without it, behavior depends on CLI version and may fall back to local `.env`:
  ```
  eas update --branch production --environment production --message "..."
  ```
- [ ] **Local `.env`** — even though EAS uses its own env, double-check local doesn't have `LOCAL_MODE=true` / `DEV_MODE=true` / `MVP_MODE=true` if you ever build locally with `eas build --local` or run `eas export`.

### What each mode flag does in production

| Flag | Production value | Effect if accidentally `true` in prod bundle |
|---|---|---|
| `EXPO_PUBLIC_LOCAL_MODE` | `false` | Demo button visible, debug panel shown, uses `swelly-chat` (correct) |
| `EXPO_PUBLIC_DEV_MODE` | `false` | Demo button visible, uses demo Edge Function |
| `EXPO_PUBLIC_MVP_MODE` | `false` | Replaces main app with thank-you screen — total breakage |

---

## 3. Database migrations

Supabase migrations are NOT auto-applied. Files in `supabase/migrations/` are **reference copies** — they have to be copy-pasted into the Supabase SQL editor.

### Before any build that depends on schema

- [ ] List unapplied migration files: `ls supabase/migrations/ | sort | tail -10`
- [ ] For each one created since last ship, verify it was actually run on production Supabase
- [ ] Cross-check by running the verify query from the migration's comments (e.g. `SELECT column_name FROM information_schema.columns WHERE ...`)

If migrations aren't applied and the new bundle ships, every screen using the new column fails silently or crashes.

---

## 4. Supabase Edge Functions

Edge Functions are deployed by **copy-pasting** from the repo to the Supabase dashboard.

- [ ] If any file under `supabase/functions/` was modified, manually deploy the matching function in Supabase
- [ ] Ignore files with `-copy` or `-copy-copy` in the name — those are experimental
- [ ] If a new function was added, create it in Supabase first

---

## 5. Native vs JS-only — pick the right command

Decide what kind of release you have:

### A. JS-only change → `eas update` (OTA, no review)

Conditions:
- No new package added that has native code
- No `app.json` plugin changes
- No `ios/` or `android/` file changes
- No new permissions

Command:
```
eas update --branch production --environment production --message "concise summary"
```

What happens: bundle uploads to Expo's servers. Devices on the matching `runtimeVersion` (currently `1.1.0`) pull it in background on next launch and apply on the launch after.

### B. Native change → `eas build` (App Store / Play Store review required)

Conditions: any of the negatives above.

Steps:
1. Bump version in all 5 spots (see section 1)
2. `eas build --platform all --profile production`
3. Submit to stores: `eas submit --platform all --profile production`
4. Wait for review approval
5. Once live, future JS-only changes can OTA again (until next native bump)

---

## 6. Branch / git hygiene

- [ ] On the right branch (usually `eyal`)
- [ ] Up to date with `origin/main` (merge if behind so you don't ship without Ohad's latest)
- [ ] `git status` clean
- [ ] After shipping, push to SwellyoLove: `git push love main --force` (per `.claude/CLAUDE.md`)

---

## 7. OTA-specific gotchas

- **The 1.0.8 binaries already in the wild will never receive OTAs.** The first OTA-capable build is `1.1.0`. Don't expect anyone on older binaries to get JS updates.
- **Don't `eas update` until the new native binary is approved and live.** Updates accumulate but go nowhere. Harmless but confusing in the dashboard.
- **First launch always runs the embedded bundle.** OTA download happens in background; new bundle applies on the *second* cold launch after publish.
- **Test on `preview` channel first.** Build a preview binary, push to preview channel (`eas update --branch preview --environment preview ...`), verify, then `eas update:republish --destination-channel production` to promote.
- **Channel name MUST match between build and update command.** Our build profile says `channel: "production"` → `eas update --branch production` matches automatically.

---

## 8. Apple / Google review concerns for OTA

- Apple **DPLA §3.3(b)** (not Guideline 4.7 — that's for HTML5) permits JS OTA as long as it doesn't change the app's primary purpose, create a storefront, or bypass security
- Safe via OTA: bug fixes, copy changes, layout tweaks, logic improvements to existing flows, new fields in existing screens
- Risky via OTA: a fundamentally new feature category that wasn't reviewed
- Practically: very rarely flagged, but don't ship a payments screen via OTA that didn't exist in the reviewed binary

---

# Claude's checklist

When the user says any of: "build", "ship", "release", "OTA", "update", "submit", "deploy", "publish", "push to stores", "TestFlight" — **walk this list before agreeing to anything**.

### Run automatically

1. **Read this file** if not already in context
2. **Check version drift**:
   ```bash
   node -e "
   const fs=require('fs');
   const app=JSON.parse(fs.readFileSync('app.json','utf8')).expo.version;
   const plist=(fs.readFileSync('ios/swellyo/Supporting/Expo.plist','utf8').match(/EXUpdatesRuntimeVersion[^]*?<string>([^<]+)<\/string>/)||[])[1];
   const manifest=(fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8').match(/EXPO_RUNTIME_VERSION\" android:value=\"([^\"]+)\"/)||[])[1];
   const gradle=(fs.readFileSync('android/app/build.gradle','utf8').match(/versionName \"([^\"]+)\"/)||[])[1];
   const pbx=[...fs.readFileSync('ios/swellyo.xcodeproj/project.pbxproj','utf8').matchAll(/MARKETING_VERSION = ([\\d.]+);/g)].map(m=>m[1]);
   console.log({app,plist,manifest,gradle,pbx});
   console.log(new Set([app,plist,manifest,gradle,...pbx]).size===1?'OK':'DRIFT');
   "
   ```
3. **Inspect `.env`** for `LOCAL_MODE=true` / `DEV_MODE=true` / `MVP_MODE=true` and warn if any are set
4. **Check `eas.json`** has `environment` and `channel` on the target profile
5. **Check `git status`** for uncommitted changes
6. **Check `git log origin/main..HEAD`** to confirm what's about to ship
7. **List recent migrations**: `ls -lt supabase/migrations/ | head -5` and ASK the user if each was applied to Supabase
8. **Determine native vs JS-only** by checking if recent commits touched `package.json`, `app.json` plugins, `ios/`, `android/` — and tell the user which command path applies (`eas update` vs `eas build`)

### Always confirm with the user before running

- `eas build` (slow, costly, irreversible)
- `eas update` (visible to all production users immediately)
- `eas submit` (sends binaries to Apple / Google)
- `git push love main --force` (force-pushes to a public repo)

### Never do without explicit instruction

- Bump `version` (it controls a lot)
- Edit `eas.json` env-var wiring
- Edit native `Expo.plist` / `AndroidManifest.xml` outside of a coordinated version bump
- Run `npx expo prebuild` (will overwrite committed native folders)

---

## Appendix — quick references

### Expo project ID
`c14ee9e6-bad8-43e2-b37a-d196b49f638f`

### EAS update URL
`https://u.expo.dev/c14ee9e6-bad8-43e2-b37a-d196b49f638f`

### Channel ↔ branch mapping
| Build channel (eas.json) | Update branch (eas update) |
|---|---|
| `production` | `production` |
| `preview` | `preview` |

### Common commands

```bash
# Verify everything matches before build
node -e "..." # see Section 1

# Build production binary
eas build --platform all --profile production

# Submit to stores after build completes
eas submit --platform all --profile production

# Push OTA after stores have the new binary live
eas update --branch production --environment production --message "..."

# Promote a tested preview update to production
eas update:republish --destination-channel production --message "..."

# Roll back a bad update
eas update:rollback --branch production
```
