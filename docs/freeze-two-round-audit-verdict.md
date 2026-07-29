# Post-onboarding freeze — two-round 22-agent audit + adversarial debate

> 2026-07-27. Two independent 11-agent audits (round 2 was not shown round 1), then a structured
> debate between two adversarial analysts, then orchestrator verification of every load-bearing claim.
> No code was changed. Metro was running during the audit, so several numbers below are **measured**,
> not estimated.

> 2026-07-28 follow-up. The original Metro-lazy theory below is now only a historical hypothesis:
> `EXPO_NO_METRO_LAZY=1` did not remove the stall, and three more isolation tests also failed to
> clear it. Keep the writeup below as the audit trail, not as a final root-cause conclusion.

---

## VERDICT

**Original audit verdict:** the dev-build freeze looked like Metro lazy bundling. At the moment onboarding completes,
`AppContent.tsx:1738` fires `import('../services/media/pendingProfileVideoUpload')`. In a dev build
that is not a cache hit — it is an HTTP fetch of a **10.1 MB split bundle** that Metro builds from
scratch, accumulated on the JS thread and then `eval`'d **synchronously**.

Measured three times independently against Ohad's live Metro, on loopback, on a warm Mac:

| measurement | orchestrator | debate agent A | debate agent B |
|---|---|---|---|
| split-bundle bytes | 10,393,243 | 10,105,885 | 10,105,765 |
| cold fetch | 22 s | 3.5–9.0 s per entry | 19.185 s |
| warm fetch | — | 0.08–0.15 s | 0.167 s |

Main dev bundle for scale: **24.3–25.2 MB**. The split bundle is **~41 % of the entire app**.

**And 100 % of it is dead weight.** Module-set intersection, computed from the real payloads:

```
main bundle module ids : 3091
split bundle ids       : 1523
overlap                : 1523
new-to-split           : 0
```

1,513 of 1,524 modules are `node_modules` (`@sentry/react-native` 123, `posthog` 84, `@supabase` 40).
`pendingProfileVideoUpload` is *already* statically imported at `OnboardingVideoUploadScreen.tsx:22`
and `ProfileEditSurfVideoScreen.tsx:23`. Every `__d()` in the payload early-returns at
`metro-runtime/src/polyfills/require.js:31`. The app downloads 10.1 MB and makes Hermes lex it in
order to define **zero** modules.

### Why every previous A/B came back negative

The import is **unconditional**:

```js
useEffect(() => {
  if (!shouldShowConversations) return;
  import('../services/media/pendingProfileVideoUpload')
    .then(({ resumePendingProfileVideoUpload }) => resumePendingProfileVideoUpload());
}, [shouldShowConversations]);
```

`resumePendingProfileVideoUpload()` is what no-ops when nothing is pending — **the module fetch is
not guarded at all**. So "skipped the upload cluster", "hid SurfSkillCard", "disabled the video
player" and "eliminated network latency" (app network, not Metro) *all left the 10 MB fetch running*.
The 8.2 s residual sits inside the measured cold-fetch band.

### The verified chain

| link | evidence |
|---|---|
| dev bundle URL carries `lazy=true` | `@expo/cli ManifestMiddleware.js:209` `lazy: !env.EXPO_NO_METRO_LAZY`; `RCTBundleURLProvider.mm:316` `BOOL lazy = enableDev;`. Confirmed by curling the live manifest. |
| lazy cuts async edges from the main graph | `metro/src/DeltaBundler/Graph.js:30` `asyncType === "weak" \|\| (asyncType != null && options.lazy)` |
| …turning each `import()` into a URL | `metro/src/Server.js:171,304` `includeAsyncPaths: graphOptions.lazy` → `Serializers/helpers/js.js:63-88` writes `paths[id]` |
| runtime fetches it | `expo/src/async-require/asyncRequireModule.ts` `maybeLoadBundle` → `loadBundle(bundlePath)` |
| accumulated ON the JS thread | `expo/src/async-require/fetchAsync.native.ts:58` `responseText += data` |
| then SYNCHRONOUSLY eval'd | `expo/src/async-require/fetchThenEvalJs.ts:26` `return eval(body);` |
| every module is a no-op | `metro-runtime/src/polyfills/require.js:31` |
| cached per path for the process | `expo/src/async-require/buildAsyncRequire.ts:21,30` |
| **absent in release** | `metroOptions.js:70` `lazy: !props.isExporting && lazy`; `:115-116` disables lazy for export |

### First-process asymmetry, with a mechanism

Warm serialization + loopback transfer of 10 MB is 0.08–0.15 s. So **the entire 3.5–19 s is Metro's
cold per-entry-point graph build, which is cold exactly once per Metro process.** That is why
kill+relaunch is perfect — and it predicts something testable: *restart Metro between the two app
launches and the "perfect second launch" should freeze again.*

### Honest limits (conceded by the theory's own advocate)

- **Only ONE import is cold at the flip**, not the 5–6 round 2 claimed. `config/supabase`,
  `analyticsService`, `pushNotificationService`, `onboardingService` all warm *during* onboarding.
  `supabaseAuthService`/`supabaseDatabaseService` at `:702,719,759,763,778` are demo-only handlers.
  The 19 `useTripDetail` and 17 `videoUploadService` "sites" both rounds counted are **TypeScript type
  positions** (`import('…').TripCoreData`), erased at compile — not split points at all.
- **During Metro's graph build the JS thread is idle** (awaiting a promise). Only the incremental
  chunk callbacks and the `eval` are JS-thread costs. This buys a several-second *dead-feeling
  window*, not a contiguous 100 s JS block.
- **Honest ceiling for this mechanism alone: ~8–15 s.** The 120 s tail is not explained unless
  Metro's transform cache was also cold (`expo start -c`), which puts 1,523 Babel transforms on the
  critical path.
- **It does not exist in release builds.** If real users report the same freeze, that is a separate
  bug and this dev repro has been misleading.

---

## THE TESTS (in order, ~15 minutes total)

1. **`EXPO_NO_METRO_LAZY=1 npx expo start`** (no `-c`). Confirm the manifest `bundleUrl` now reads
   `lazy=false`. Run one fresh onboarding. **Freeze unchanged in magnitude ⇒ this whole verdict is
   wrong.** Everything else (mount cascade, memory, AsyncStorage, share sweep) is untouched by the flag.
2. Same session, console unfiltered, grep the literal string **`received by JS VM, running a GC`**
   (emitted at `ReactInstance.cpp:652-653`). Zero occurrences in the frozen window ⇒ memory pressure
   is dead outright as a mechanism.
3. Watch Metro for **`[TAB-PERF] <id> <phase> <ms>`** — a `React.Profiler` is **already wired** at
   `RootNavigator.tsx:64-72` for any commit > 30 ms in `__DEV__`. If the branch-swap commit were
   8–120 s it would already be screaming a single enormous number. Free disconfirming evidence that
   has been sitting unused.
4. Bracket `AppContent.tsx:1738` with `Date.now()` — splits the window into "JS idle waiting on
   Metro" vs "JS blocked in `eval`".
5. **Restart Metro between kill and relaunch.** If the perfect second launch now freezes, the cold
   graph build is proven to be the timer.

**Permanent fix:** convert `AppContent.tsx:1738` and the other ~28 local split points to static
imports. Every target is already in the synchronous boot graph, so the dynamic form buys zero bundle
savings, zero deferred evaluation — it only manufactures a dev-only 10 MB split point.

---

## 2026-07-28 follow-up

I ran the isolation steps that were discussed today:

- `EXPO_NO_METRO_LAZY=1` still reproduced the freeze.
- `ProfileScreen`'s `SurfSkillCard` video, preload, and cache path were temporarily disabled.
- The post-onboarding `ProfileScreen` overlay was temporarily skipped.
- PostHog session replay was temporarily disabled.

The freeze still happened on a fresh onboarding run after those changes.

What this means now:

- The video player path is not the sole trigger.
- The post-onboarding profile overlay is not the sole trigger.
- Metro lazy bundling is not sufficient on its own to explain the stall.
- The next focus should be the first-launch startup work that runs after onboarding completes but before the app is stable on relaunch.

---

## RANKED SECONDARY FINDINGS (real bugs, not this freeze)

### 1. `registerForPushNotifications` has no re-entry guard despite its doc comment
`pushNotificationService.ts:63-68` says *"Safe to call multiple times — no-ops if already
registered."* `isRegistered` is written at `:138`/`:307` and **never read**. Callers:
`OnboardingContext.tsx:152`, `:206`, `AppContent.tsx:1727`. Runs the full permission → token →
`saveTokenToSupabase` path ≥2× per fresh signup, and `saveTokenToSupabase` opens with the
no-timeout `supabase.auth.getUser()`.

### 2. `TravelExperienceSlider` — per-frame `runOnJS` with no dedupe
`TravelExperienceSlider.tsx:129-136` fires every pan frame; `updateTrips` (`:260-284`) has no
early-return on unchanged value. Per frame: `setCurrentTrips` + `onValueChange` → `updateFormData`
(22-consumer context fan-out) + an un-awaited AsyncStorage write + **4× `Animated.timing` with
`useNativeDriver: false`**. A 10 s drag at 120 Hz = up to 1,200 writes, ≥95 % byte-identical
(the slider has 21 distinct values). Also `useEffect` at `:119-121` writes `thumbX.value` from JS
every render, fighting the worklet that owns it.
*Not the freeze* — `RNCAsyncStorage.mm:210-218,456` runs `multiSet` on a serial **native** queue,
never the JS thread, so a backlog leaves JS idle. Real perf/battery bug regardless.

### 3. `Sentry.wrap`'s touch instrumentation runs even with `enabled: false`
`sdk.js:140-152` installs `TouchEventBoundary` **unconditionally** — no `enabled` check — and
`@sentry/core/breadcrumbs.js:17` only bails on `!client` (a client always exists). Per touch:
walk ≤20 fiber ancestors, DFS text extraction per ancestor, 2× `JSON.stringify` per ancestor for
dedupe, plus a native bridge call. Directly taxes the observed symptom ("taps are dead") and
compounds under rage-tapping. Fix: `Sentry.wrap(App, { touchEventBoundaryProps: {
extractTextFromChildren: false, maxComponentTreeSize: 3 } })`.

### 4. `sessionValidationRef` is read during render — latent tree-teardown landmine
`AppContent.tsx:1710-1712` reads a mutable ref to decide the app's top-level branch. Set true at
`:430`, cleared in `finally` at `:491` — **after two more awaits** — while `setHasValidatedSession(true)`
at `:463` schedules a render that lands *while the ref is still true*. Clearing a ref schedules
nothing, so the tree would stay torn down until an unrelated render.
**Not firing today** (no `setUser` on the completion path; all `setUser` calls gated on
`user === null`), but any new dep churn on that effect turns it into a multi-second freeze.
One-line fix: make it state, or drop it — `hasValidatedSession` already covers the case.

### 5. Oversized bundled assets (release-build concern)
Measured with `sips`: `who-is-it-for/age-range.jpg` and `levels/intermediate.jpg` are **4000×6000
(~91.6 MB decoded RGBA)**; `levels/advanced.jpg` 4000×3000 (45.8 MB). Sibling `levels/beginner.png`
is 336×280 — proof the big ones are un-resized originals. `RCTImageCache.mm:21-22` refuses to cache
anything over 2 MB decoded, so these re-decode on every mount; `RCTLocalAssetImageLoader.mm:44-64`
ignores the requested `size`/`scale`/`resizeMode` entirely.
**Timing caveat:** these are *lazy* — `TripsScreen.tsx:1342-1346` has `visited.my = false`, so
`age-range.jpg` renders on the user's first *tap* of My Trips, not at the branch switch.
**Dev caveat:** in Debug builds assets aren't embedded (`AssetSourceResolver.js:100-114`) — they're
HTTP-fetched from Metro, so `RCTLocalAssetImageLoader` never sees them. The "permanent UIKit
`imageNamed:` cache" story is release-only.
Fix: `sips -Z 1200` on the three 4000px JPEGs. ~229 MB of potential decode removed in ten seconds.
Also unreferenced dead weight: `create-trip/sitting.png` (3.86 MB), `create-trip/create-trip-bg.png`.

### 6. `enableLogs: true` is free in dev but expensive in release
`App.tsx:38`. On a **dev** build `enabled` is false → `Client.init()` never calls
`_setupIntegrations()` (`@sentry/core/client.js:432-443`, `_isEnabled()` at `:711-712`) → console is
never patched. On **release** `enabled` is true → `consoleLoggingIntegration` + `breadcrumbsIntegration`
install, and each of **1,839** `console.*` sites (867 `console.log`, only 41 `__DEV__`-wrapped, no
`transform-remove-console`) pays a double `JSON.stringify` + scope merge + 100-entry buffer copy.
Fix: `enableLogs: false` + `babel-plugin-transform-remove-console` +
`Sentry.breadcrumbsIntegration({ console: false, xhr: false, fetch: false })`.

### 7. `useAuthGuard` re-runs a 2-call network auth check on every step change
`useAuthGuard.ts:245` — `checkAuthState`'s deps include `currentStep`; the effect at `:355-376`
depends on `checkAuthState` and calls it. ~8 uncancelled overlapping runs across onboarding, each
doing `getSession()` + `getUser()`. Also `:350` has `[]` deps with a comment claiming "use latest
context values" — **the comment is wrong**; both are captured at first mount, and that staleness is
accidentally *preventing* a worse bug (an awaited retry loop inside an auth subscriber, `:282-317`,
which per `GoTrueClient.js:4257-4262,4183-4188` would stall every concurrent auth caller app-wide).
**Fix the staleness without fixing the awaited-network-call-in-a-subscriber and you create an
app-wide auth stall.**

### 8. Smaller items
- `OnboardingContentHost.tsx:73-98` — a step change mid-slide leaves the incoming `withTiming`
  running with a stale closure target; fast double-taps on Next can render the wrong step.
- `ConversationsScreen.tsx:414-436` — the only permanent JS-thread 60 fps animation in the app
  (`Animated.loop(Animated.sequence([...useNativeDriver:false...]))`, verified against
  `AnimatedImplementation.js:483-491` + `sequenceImpl:355-357`). Unconditional, no visibility guard,
  never unmounts (`RootNavigator.tsx:52`). Symmetric across relaunch, so not the freeze — but it is a
  permanent starvation floor, worst precisely for a 0-conversation account.
- `Shimmer.tsx:28-55` — effect returns no cleanup; orphaned infinite *native* animations (0 JS cost).
- `ProfileScreen.tsx:1882-1922` — 7-minute 2 s poll, `clearInterval` only inside the callback.
- `saveStepToSupabase` deps `[formData, isDemoUser]` (`OnboardingContext.tsx:431`) is in the context
  value memo's dep list (`:530`) — **the memoization fix is incomplete**; the value still changes
  every keystroke.
- `barSuppressed` includes `showProfile` (`:1837-1841`) → `RootNavigator.tsx:642`
  `tabBarHidden={barSuppressed}`, so **at the branch switch the native tab bar is hidden**. Any
  "native tab bar keeps working" observation is from *after* the profile overlay closes — a different
  moment from the freeze. Two symptoms have been conflated throughout this investigation.

---

## CORRECTIONS TO EXISTING DOCS

`docs/js-thread-performance-verdict.md`:
- `:112` "PostHog session replay … per-second JS touch for coordination/flush" — **wrong**.
  `posthog-react-native-session-replay@1.6.0/src/index.tsx` is 7 promise-returning `NativeModules`
  methods. No `NativeEventEmitter`, no timer, no per-frame callback. Zero periodic JS.
- `:111` "`swellyService.ts:108,335` stringifies the full Swelly conversation during onboarding" —
  no longer applies. `AppContent.tsx:1042-1043` skips Swelly chat entirely for a fresh user.
- `:107` "on web the base64 profile picture makes every keystroke stringify megabytes" — overstated
  even on web. `canvas.toDataURL` lands in local state; `profilePicture` enters `formData` at
  `OnboardingStep4Screen.tsx:1000` with the uploaded URL. A `data:` URI reaches the blob only in the
  upload-failure fallback (`:966/971/977/982`).

Stale code comments found: `ProfileScreen.tsx:396` ("Profile tab is preloaded at startup and kept
mounted") — tabs are lazy, it is not. `pushNotificationService.ts:65` ("no-ops if already
registered") — it does not. `useAuthGuard.ts:350` ("use latest context values") — it does not.

---

## THINGS BOTH ROUNDS AGREE ARE CLEAR

`inlineRequires: false` (proven from the on-disk Metro transform artifact) · tabs are genuinely lazy,
only `TripsScreen` mounts · onboarding and main-app trees are strict either/or, never both mounted ·
no `isComplete`/`currentStep` ping-pong (three writers, each self-extinguishing) · no infinite
render↔effect loop (450 `useEffect` scanned; 5 with no dep array, 33 self-referential, all guarded) ·
no leaked repeating work that survives onboarding and exists only in the first process · no base64 on
native · no large static data (`src/data/` ≈ 9.7 KB) · no react-query/redux/zustand persistence, no
MMKV, no SQLite · barrels have zero importers · thumbnails genuinely wired on every hot path ·
`sweepStagedShare` runs on **every** launch (dep array includes `isComplete`, already true at boot on
relaunch) so it cannot be the first-process differentiator · image decode runs on a background serial
queue (`RCTImageManager.mm:33/66`), so a decode stall would freeze native scrolling too — which the
symptom rules out.
