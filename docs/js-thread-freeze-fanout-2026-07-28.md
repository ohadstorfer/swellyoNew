# JS thread freeze — 13-agent audit, July 28 2026

Two fan-outs, run back to back. No code was changed.

1. **General sweep** (6 agents) — where does the app block the JS thread?
2. **Purple/orange differential** (7 agents) — why does real onboarding starve the JS thread
   when "Skip Demo" does not?

Every load-bearing claim below was grep- or read-verified against the real code. Where two
agents disagreed, the conflict was resolved by hand and the winner is named.

---

## THE HEADLINE — the session replay test never ran

`docs/status-updates/2026-07-28-onboarding-freeze.md` item 4 says
"Temporarily disabled PostHog session replay." **That did not happen.**

| File | Setting | Status |
|---|---|---|
| `src/services/analytics/posthogService.ts:22` | `enableSessionReplay: false` | **DEAD FILE.** `initializePostHog()` has zero callers. |
| `src/services/analytics/analyticsService.ts:49` | `enableSessionReplay: true` | **LIVE.** `App.tsx:129` `getClient()` → `PostHogProvider` at `:152`. |

The `false` went on the dead service. The live one was changed from
`Platform.OS !== 'web'` to `true`. On a phone that is a no-op — replay stayed on. On web it
turned replay **on**.

So the isolate did the opposite of what it claims, and the doc's conclusion
("the video player and session replay are not enough to explain it") is not supported by any
test that actually ran.

**To really run it:** set `enableSessionReplay: false` in `analyticsService.ts`.

Replay config today: `maskAllTextInputs`, `maskAllImages`, `maskAllSandboxedViews` all `false`,
`throttleDelayMs: 1000`. That is a full unmasked snapshot of the whole view tree, once a second,
on the native main thread.

---

## Isolate flags still ON in the working tree

Any A/B you run right now has these active. They hide suspects on **both** arms.

| Flag | File | Value |
|---|---|---|
| `TEMP_SKIP_POST_ONBOARDING_PROFILE` | `AppContent.tsx:64` | `true` |
| `TEMP_DISABLE_SURF_SKILL_VIDEO` | `ProfileScreen.tsx:74` | `true` |
| `enableSessionReplay` | `analyticsService.ts:49` | `true` (comment says "disable") |

Because of flag 1, the post-onboarding ProfileScreen overlay is skipped on **both** paths
(`:818` orange, `:1052` purple). It cannot be the difference.

---

## PART 1 — The purple/orange differential

### The two paths

- **Purple `#8B5CF6` "Demo"** — `handleDemoChat`, `AppContent.tsx:703`. Makes a demo user, then
  `setCurrentStep(0)`, and the user walks the real onboarding screens. **JS starves after.**
- **Orange `#F59E0B` "Skip Demo"** — `handleSkipDemo`, `AppContent.tsx:760`. Makes the same demo
  user, writes the same rows straight to the DB, completes. **Never mounts an onboarding screen.
  App is fine after.**

Both set `isDemoUser: true` and both end with the same flip code. The whole handler-level
difference is **one line**: `setCurrentStep(0)` at `:753`.

**Key constraint this gives us:** both arms are demo users, so anything gated on `!isDemoUser`
is automatically NOT the difference. This is what kills the `useAuthGuard` overlapping-auth-check
theory for this A/B.

### Stale facts we were working from — corrected

- Onboarding is steps **0 → 7**, not 0 → 5.
- **Step 5 is a budget screen.**
- **The Swelly chat is not in onboarding at all.** It is a card in `RootNavigator`, reachable only
  by tapping inside the main app. `CLAUDE.md` is stale on this.

### What purple does that orange never does

**Screens mounted.** Welcome, then steps 1–7 inside `OnboardingScaffold`: board carousel,
surf-level video carousel, video upload, travel slider, destinations, budget, lifestyle, profile.
Orange mounts none of them.

**The heaviest thing purple builds.** `VideoCarousel` mounts **4 expo-video players at once on
iOS** — one per surf-level video, all `loop = true`. The hidden ones use `opacity: 0` but stay
loaded and buffering. Each carousel move fires **16 JS-driven `Animated.timing`**, two of which
animate `width`/`height` (layout props). `OnboardingVideoUploadScreen` adds a 5th player with
`staysActiveInBackground = true` — the only place in the app that sets it.

**Work that keeps running after onboarding unmounts:**

1. `startProfileVideoUpload` (`OnboardingVideoUploadScreen.tsx:438`, fire and forget) → native
   transcode → durable file copy → S3 PUT. The code's own comment records a 22.7 MB clip taking
   **115 seconds**. No abort.
2. `pollForProcessedVideo` (`storageService.ts:558`) — 28 loops × 15 s ≈ **7 minutes** of `fetch`.
   **No cancel path at all.**
3. `refreshUserProfile()` (`AppContent.tsx:1065`) — fires at the exact moment the main app mounts.
4. `syncUserDestinations` edge-function call.
5. Some orphaned one-shot `setTimeout`s from unmounted screens. All bounded.

**Analytics.** Purple fires 8 `logEvent` Supabase INSERTs plus several PostHog captures.
Orange fires **zero**.

**Different data in the main app.** Purple lands with `profile_image_url`,
`lifestyle_image_urls`, `home_break_*`, `date_of_birth` and maybe `profile_video_url` all filled.
Orange lands with all of them NULL. So purple's landing screen loads remote images that orange
never asks for.

**Things orange does that purple does not:**

- Writes `travel_buddies = 'solo'` — the only write of that column anywhere in the app.
- Writes `finished_onboarding` twice.
- **Bug:** `:784` and `:810` make two different random nicknames, so the DB row and the local
  form data permanently disagree.

### Ruled out — with proof

| Theory | Verdict |
|---|---|
| Onboarding tree stays mounted | **No.** `AppContent.tsx:2182` early-returns before both step branches. `styles.hidden` is now dead code. Onboarding is not a nav route. |
| Orphaned `Animated.loop` or interval in onboarding | **None.** Zero `Animated.loop` hits in the whole onboarding component set on native. |
| Leaked `expo-video` players | **No.** `useVideoPlayer` → `useReleasingSharedObject` releases on unmount. No `createVideoPlayer` anywhere. |
| Swelly chat leftovers | **Not in the path.** |
| Stacked auth subscribers | **No.** 1× on both paths. |
| Push listener build-up | **No.** `if (!this.tokenSubscription)` guard holds. |
| Realtime channel build-up | **No.** ~2 channels on both paths. |
| Render ↔ effect loop | **Definitively none.** `shouldShowConversations` reduces to `isComplete && user !== null` on both arms and is monotonic after the flip. All six effects keyed on it fire exactly once. |
| Huge image decode pressure | **No.** `levels/`, `who-is-it-for/`, `wave-shapes/` are all **trip** flows, not onboarding. `levels/` means trip difficulty, not surf level. |
| `ProfileScreen.tsx:1886` 7-minute poll | **Unreachable dead code.** Its only caller chain starts at `handleVideoUpload` (`:1676`), which is defined and **never referenced**. Earlier docs call this a live leak. It is not. |
| `LoadingScreen.tsx` | Dead file, never imported. |

### Two agent conflicts, resolved by hand

- **`waitForVideoReady`** (`videoPreloadService.ts:471`) — one agent called it an endless poll.
  **Wrong.** It is hard-bounded: `if (Date.now() - startTime >= timeout) { clearInterval(...) }`,
  5 s default. Outlives unmount by 5 s at most, then stops.
- **`OnboardingVideoUploadScreen` Hook B** (`:177`) — one agent said cleanup exists.
  **Wrong.** The effect ends at `}, [userVideoUri, defaultVideoUrl, previewPlayer]);` with no
  `return`. But it registers no subscription, so the worst case is one orphaned 200 ms timeout
  calling `play()` on a released player. Bounded.

### Ranked suspects

1. **Session replay.** Purple records minutes of 4-player video screens; orange records seconds.
   The recorder keeps going into the main app on both. This explains why six leak audits came back
   clean — it is native, so no JS-side audit could ever see it.
   *Weakness:* this is a difference of **degree**, not a switch. The symptom sounds binary.
2. **The profile-video pipeline.** The only truly **binary** purple-only difference. Heavy native
   CPU and upload, straddling the flip. In shipped builds 45/46 it runs **twice at once**
   (the `uploadInFlight` guard is uncommitted).
3. **`refreshUserProfile()`.** Real but one-shot. Weak.

### Test order

1. Set `analyticsService.ts:49` → `enableSessionReplay: false`. Re-run purple. 30 seconds.
2. Re-run purple but tap **Skip** on the video step. That removes suspect 2 and leaves replay
   length as the only variable.
3. If it still freezes, check Metro for `[TAB-PERF]`. A `React.Profiler` at
   `RootNavigator.tsx:64-72` already logs any commit over 30 ms in `__DEV__`. Free evidence before
   reaching for Instruments.

---

## PART 2 — General JS-thread findings (separate from the freeze)

These are real costs. They are **not** the purple/orange difference, but they raise the floor
under everything.

### Worst: the chat cache sweeps itself twice on every save

`chatHistoryCache.evictOldConversations` (`:84-234`):

- Lines **111-150** loop every cached conversation doing `getItem` + `JSON.parse`.
- Lines **156-170** are the **same loop again**.
- The "are we over budget?" check is at line **173** — *after both*. There is no early exit.

Called unconditionally at line **479**, on ~75-90 `saveMessages` sites, including inside the
`setMessages` updater on **every realtime message**.

It also **thrashes**: `ESTIMATED_BYTES_PER_MESSAGE = 2000` (about 4× a real text row) against
`MAX_TOTAL_CACHE_SIZE_MB = 5` means the estimator hits budget at roughly **25 conversations**.
Past that, eviction fires on nearly every save → evicts → next open is a cache miss → refetch →
save → sweep again.

And it runs on **every foreground**: `ConversationsScreen.tsx:332-339` calls
`refreshConversations()` on every `AppState → 'active'`, which re-triggers the 10-conversation
prefetch, each ending in a full double sweep.

**Fix:** delete the second loop, use one `multiGet`, keep an in-memory size tally with an early
return, move eviction off the save path, and fix the byte estimate.

### The app root re-renders on every incoming message

`conversationReducer.ts:374-434` — `SYNC_FROM_SERVER` always returns
`state.map(...).concat(...).sort(...)`. Every other action in that file has a bail-out that keeps
the old array identity (`SET_UNREAD_COUNTS` at `:228-241` is the model). This one has none.

It is dispatched on every inbox broadcast, including for the user's own sent messages. New array
→ new context value → every `useMessaging()` consumer re-renders, including `AppContent.tsx:150`
(the top-level router) and `RootNavigator.tsx:234`.

An earlier doc cleared this as "the context value IS memoized." True, but not enough —
**the memo's dependency changes on every event.** About 6 lines to fix.

### Permanent 60 fps JS loop on a tab that never unmounts

`ConversationsScreen.tsx:412-433` — an unconditional infinite `Animated.loop` with
`useNativeDriver: false`. The Lineup tab root stays mounted all session, so this runs forever,
even when the arrow it animates is off screen. It is the only `useNativeDriver: false` infinite
loop among the three tab roots.

### Messaging realtime is dead for the whole first session

`MessagingProvider.tsx:1026` and `:1059` both open with
`supabase.auth.getUser().then(({data:{user}}) => { if (!user) return; ... })` and neither effect
has `user` in its deps. On a cold boot into the demo flow there is no session yet, so both bail —
and **never re-run when the user appears**. Inbox channel, presence and heartbeat are all off.

It works after kill+relaunch because the session exists at mount. **This is why first-session and
post-relaunch are not comparable states in any A/B.**

### Other verified items

| Where | Problem |
|---|---|
| `TripPlanningChatScreen.tsx:2244-2261` | `initialNumToRender={50}`, `windowSize={21}`, no `removeClippedSubviews`, unpaginated history restore, non-memoized `MatchedUsersCarousel`. 400–1200 ms on open. |
| `TripPlanningChatScreen.tsx:2153` | `renderItem` deps include `filtersMenuVisible` and `reportSheetVisible`. With virtualization off, opening a menu re-renders the whole chat. |
| `DirectMessageScreen.tsx:4640` + twin | `renderItem` deps invalidate ~75 mounted cells; the row function is ~780 lines. 150–300 ms per event; a 5-message burst is 1.5–3 s. |
| `SwipeToReplyWrapper.tsx:59` | Inline `onReply` defeats the `useMemo`, so the Pan gesture is rebuilt per cell per render. |
| `ConversationsScreen.tsx:774-800` | Two uncached network queries + full list re-render on every realtime event. |
| `ShareTripStorySheet.tsx:105` | `capture('base64')` on a 1080×1920 lossless PNG, then a template literal that copies it again. `capture('tmpfile')` already exists in the same function. |
| `messagingService.ts:3250` | Unfiltered `public.conversations` subscription, not gated on broadcast mode like its siblings. |
| `eventLogger.ts:118-121` | `analytics_throttle_*` keys written, never cleaned. Inflates every `getAllKeys()`. |
| `OnboardingContext.tsx:525` | `formData` is inside the context value, so the value changes on every keystroke. Memoization can never fix that. The real fix is splitting state from actions. |
| App-wide | 84 untimed `supabase.auth.getUser()` call sites. Note a hang here leaves JS **idle**, so it causes blank screens, not this watchdog firing. |

### Checked and clean — do not re-audit

- **No base64 on native.** Zero `EncodingType.Base64`, zero `base64: true` on any of 12 picker
  sites, no file-byte hashing, no `arrayBuffer`. The `dataURLtoBlob` byte loops are web-only and
  unreachable on native.
- **No interval leak storm.** Only 2–4 `setInterval`s coexist in a normal session.
- **Messaging logic is well built.** No quadratic merges, no `.find()` inside `.map()`, no
  per-message setState loops, no channel leak.
- **`TypingIndicator` defined in render is a false alarm.** All four are consumed through a
  `useMemo`'d element, so the remount only happens when `isTyping` flips, not per render.
- **All four context values are memoized** (this fixes a stale claim in the older doc).

---

## Corrections to existing docs

`docs/status-updates/2026-07-28-onboarding-freeze.md`
- Item 4 is invalid. Session replay was never disabled. Line 10's conclusion does not follow.

`docs/js-thread-performance-verdict.md`
- "2 of 4 context values unmemoized" — stale. All four are memoized now.
- `ProfileScreen.tsx:1882-1922` listed as a live leak — it is **unreachable dead code**.
- Freeze mechanism #1 (the cache sweep) is confirmed and is worse than described: the sweep is
  **doubled**, the byte estimate causes **thrashing**, and it runs on **every foreground**.

`docs/freeze-two-round-audit-verdict.md`
- The oversized 4000px assets are real, but they are **trip** flows, not onboarding, so they are
  not in the first-session path the doc implies.

`CLAUDE.md`
- Onboarding steps are 0 → 7, not 0 → 5. Step 5 is budget. The Swelly chat is not an onboarding
  step.

---

## Fix list, in order

1. `analyticsService.ts:49` → `enableSessionReplay: false`. Re-run the isolate.
2. Revert `TEMP_SKIP_POST_ONBOARDING_PROFILE` and `TEMP_DISABLE_SURF_SKILL_VIDEO` once testing is done.
3. `chatHistoryCache` — kill the second sweep, `multiGet`, in-memory size tally, debounce eviction,
   fix `ESTIMATED_BYTES_PER_MESSAGE`.
4. `conversationReducer` `SYNC_FROM_SERVER` — add the `changed` bail-out.
5. `ConversationsScreen.tsx:421/426` — `useNativeDriver: true`, or gate the loop on the empty state
   actually rendering.
6. `MessagingProvider.tsx:1026/1059` — add `user` to the deps so realtime starts in the first session.
7. `storageService.ts:558` — give `pollForProcessedVideo` a cancel path.
8. `ShareTripStorySheet.tsx:105` — `capture('tmpfile')` instead of `'base64'`.
9. `AppContent.tsx:784/810` — use one nickname, not two.
10. Strip `console.*` in release (`babel-plugin-transform-remove-console`). 1840 calls, 41 guarded.

Items 1–2 are minutes. 3 and 4 are the biggest wins and are in separate files, so they can be done
in parallel.

---

## What still cannot be settled from code alone

- Whether replay is really the cause. Only test 1 answers that.
- Whether the freeze is a true JS block or native contention that makes a JS timer look late.
  The `[TAB-PERF]` profiler already wired at `RootNavigator.tsx:64-72` is the cheapest way to find out.
- Real millisecond costs on a real device with a real account size.
