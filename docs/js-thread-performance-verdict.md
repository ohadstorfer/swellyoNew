# JS-Thread Performance Investigation — Verdict + Freeze Deep-Dive

> Investigation: 2026-07-27. Symptoms: app-wide sluggishness — occasional freezes, dropped frames, delayed touch response, janky scrolling. Two questions answered: (1) is this **architectural** or **accumulated**? (2) **what exactly can make the JS thread stuck** (the freezes)?
>
> Method: 5 parallel audits (context re-renders, list/render work, timers/subscriptions, synchronous heavy work, mount graph) + a second freeze-focused pass. Every load-bearing claim was grep/read-verified against the real code. No code was changed.

---

## Verdict: ACCUMULATED — the architecture is fine

The skeleton of this app is good, and the same evidence that found the problems proves it:

- **Platform layer is modern and correct:** Hermes + New Architecture enabled (`app.json:14`, `ios/Podfile.properties.json`), React 19, RN 0.81.
- **The hardest part — messaging state — was built carefully.** `MessagingProvider`'s context value IS memoized (`MessagingProvider.tsx:1490`), the conversation reducer does O(n) move-to-top with deliberate bail-outs (`conversationReducer.ts:215-217`), typing indicators and presence deliberately do NOT ride through context.
- **Navigation is correct:** tabs are lazy, only Trips mounts at start, onboarding and the main app render in a true either/or chain (never both mounted — verified directly).
- **The lists that were already fixed are genuinely good:** Explore deck (`getItemLayout`, native-driver scroll, tight windowing), `ConversationsScreen` (memoized data, narrow deps).

This is **not** a "built wrong" app. ~30 findings collapse into 4 shared root causes; fixing the top handful is normal work, not a rewrite. One pattern-shaped caveat: memoization discipline is near-zero outside the explicitly-fixed spots (3 of 202 components use `React.memo`; 2 of 4 context values unmemoized). A habit to change — file-by-file, no restructuring.

---

## FREEZE DEEP-DIVE — what can actually make JS stuck

"Stuck" is a different bar than "janky." Jank = many small blocks. Stuck = the thread cannot service the next tap/frame/timer for a long stretch. Second-pass analysis, with corrections to the first-pass report:

### First, what the 32s telemetry number actually means

The perf watchdog (`AppContent.tsx:1863`) measures the **gap between 2-second interval ticks**. `blocked_ms: 32180` means *timers were not serviced for 32 seconds* — it does NOT prove one 32-second call stack. Two very different diseases produce the same number:

- **One solid block** — a single synchronous stack (one huge `JSON.parse`, one sync native call that hangs).
- **Sustained starvation** — thousands of small work items fed back-to-back so the queue never drains long enough for a timer to run.

This distinction decides where to look. **After verifying actual payload caps, no single synchronous operation found in this codebase can block for more than ~tens of ms** — so if the freeze is JS-side, it is starvation or a saturation loop, not one giant stack.

### Freeze mechanism #1 (BEST FIT for the 32s onboarding stall): the boot cache-sweep storm, running mid-onboarding on heavy accounts

Chain of verified facts:

1. `MessagingProvider` starts for **any user with a Supabase session** — gated only on `supabase.auth.getUser()` succeeding (`MessagingProvider.tsx:1059+`), never on onboarding completion. A session exists right after Google OAuth, mid-onboarding.
2. On start it loads conversations, then sequentially prefetches the **top 10** conversations' message threads (`MessagingProvider.tsx:266-281`).
3. Each prefetch ends in `saveMessages()` → `evictOldConversations()` (`chatHistoryCache.ts:479`), which reads + `JSON.parse`s **every cached conversation blob twice** (`:111-150`, `:156-170`) *before* the size-limit early-return (`:173`). (An `isEvicting` lock skips *concurrent* eviction, but the prefetch is sequential-awaited, so all 10 run their sweeps in turn.)
4. On an account with ~N cached conversations that's **10 saves × 2 sweeps × N blobs ≈ 20N** back-to-back `AsyncStorage.getItem` + `JSON.parse` hops (N=85 → ~1,700 operations), each small (blobs are capped at 100 messages ≈ ~200KB, parse = single-digit ms), but fed continuously.
5. On a **dev build** (unoptimized React, every console.log serialized to Metro — and this path logs per save), each hop is 2-5× slower.

Result: a continuous multi-second-to-tens-of-seconds window where the JS queue never drains — exactly what the watchdog reports as one giant gap. And because this runs mid-onboarding for any account with history, testing onboarding **on a developer's own heavy account** puts the storm precisely in the lifestyle→last-step window where the 32180ms event fired. This also matches the field pattern "first session laggy/stuck, fine after kill+reopen" (the second boot's sweeps hit warm caches and settle faster).

Caveat kept honest: for a **brand-new user** (0-few conversations) this storm is near-zero — so it does not explain a fresh user's first-session freeze (e.g. the dfmazariego stuck-Trips replay). That one still needs the profiler (see below).

### Freeze mechanism #2 (best fit for "dead screen" in chat): the stuck-menu 60fps loop

`DirectMessageScreen.tsx:809-847` + twin in `DirectGroupChat.tsx`: while the message long-press menu is open, a `requestAnimationFrame` loop re-measures the bubble every frame (2 native `measureInWindow` calls/frame). The loop's own cleanup is correct — **but** the known `MessageActionsMenu` stuck-close bug means a menu stuck in the open state leaves this running at 60fps forever. That's saturation, not one block: the thread is never idle, taps queue behind render work, and the app *feels* dead while native things (tab bar, scroll) still work. This is the exact signature of the previously-observed "screen dead except native tab bar" freeze. These two bugs should be treated as one compound bug.

### Freeze mechanism #3: native-synchronous calls that could hang (not found, not excluded)

A sync native call ON the JS thread that stalls (disk contention, lock, memory pressure) blocks JS completely and is invisible to static analysis. Known sync-native touchpoints: the new expo-file-system API (`File.write`/`Directory` in `shareRecentsCache.ts`, `shareIntake.ts`, `FilePreviewBody.tsx`), `Paths.appleSharedContainers` access, and whatever PostHog's native replay does at its 1s capture cadence. None *shown* to hang; only an attached profiler during a live freeze can rule them in or out.

### Freeze mechanism #4: dev-build artifacts (only relevant to interpreting dev telemetry)

On dev builds: dev-mode React, Metro over WebSocket for every console.log (this codebase logs heavily on the exact hot paths), React DevTools / element-inspector attach, HMR. These can inflate a 5s starvation into 30s+, or fabricate stalls that don't exist in release. Rule: treat dev-build stall magnitudes as directional only; confirm on release-config builds.

### Corrections vs the first-pass report (downgrades + cleared)

- **DOWNGRADED — `writeShareRecents` as a freeze cause.** The sync `file.write` is real (`MessagingProvider.tsx:1013-1018` → `shareRecentsCache.ts:53-84`), but the payload is 12 items and it no-ops at 0 conversations. It's a milliseconds-scale hard block per message — a jank contributor worth fixing, **not** a multi-second freeze.
- **DOWNGRADED — "one big JSON.parse" as a freeze cause.** Chat blobs are capped at 100 messages (`chatHistoryCache.ts:25`) ≈ ~200KB → single-digit-ms parses. The full conversation-list blob (`conversationListCache.ts:179`) is ~100-500KB → ~5-15ms. No single JSON op found can block for seconds. The danger is the *sum* (mechanism #1), not any single call.
- **CLEARED — the new profile-video upload code (2026-07-25).** Verified end-to-end off-thread: transcode is native (`AsyncFunction` + `exportAsynchronously`), the durable copy uses legacy async `copyAsync` (`pendingProfileVideoUpload.ts:95-107`), the S3 PUT streams via native `uploadAsync` (`storageService.ts:498`). It runs in the 32s window but cannot block JS.
- **NOT a JS freeze — `ProfileScreen` 7-minute poll** (`:1882-1922`). Each tick is an awaited network fetch; it leaks network/battery, doesn't block the thread.
- **DIFFERENT DISEASE — PostHog replay.** Native-side capture; competes for CPU (dropped frames) but does not occupy the JS event loop. Only an A/B (replay off vs on) or Instruments capture separates it.

### One more thing the freeze data can't be trusted on yet

`isComplete` (from DB, `OnboardingContext.tsx:293-295`) and `currentStep` (from AsyncStorage cache, `:344-346`) are restored independently with no reconciliation, and `shouldShowConversations` wins the render (`AppContent.tsx:1706`). A stale cached step means "stall during onboarding" telemetry may actually be a stall **in the main app** — and the `route: "Trips"` field can be a stale `navigationRef` value from a previous mount. Tag stall events with `currentStep` AND the actually-rendered branch before drawing conclusions from field data.

---

## How to hunt the freeze (in order)

1. **Reproduce mechanism #1 deliberately (no tools needed):** on a dev build, sign into a heavy account (many conversations), reset onboarding, walk to the lifestyle step, and watch Metro for the `[chatHistoryCache]` save/evict log storm alongside the `⚠️ PERF: JS thread blocked` line. If the storm and the stall coincide, confirmed. Then repeat on a **fresh** account — the stall should shrink dramatically or vanish.
2. **The decisive measurement:** reproduce a freeze with Xcode Instruments (Time Profiler) attached, release configuration. During the frozen seconds: JS thread busy inside Hermes (`JSON.parse`, string ops) → mechanism #1. JS thread spinning through rAF/measure → mechanism #2. JS thread **idle** → native cause (#3, or replay/image decode) and none of the JS findings explain it. This single capture settles the whole question.
3. **Cheap field instrumentation (one small change, OTA-able):** add `currentStep` + rendered-branch + `conversations.length` to the existing `js_thread_stall` event. Then PostHog can answer "do stalls correlate with account size?" — the direct test of mechanism #1 at scale.
4. **For the chat dead-screen freeze:** reproduce the stuck `MessageActionsMenu` state; if the rect keeps tracking (bubble dim follows scroll) while taps are dead, the rAF loop is live → mechanism #2 confirmed.
5. **Replay A/B:** one release build with `enableSessionReplay: false`, same account, same flow. Any freeze that disappears was native contention, not JS.

## If the hunt confirms mechanism #1, the fix (already spec-ready)

Fix `evictOldConversations`: check the size budget from a running in-memory tally *before* touching disk, collapse the two sweeps into one, and debounce eviction (every Nth save or once per minute) instead of running per save. Also worth gating the 10-conversation boot prefetch on onboarding being complete (or `InteractionManager`-deferring it), so a mid-onboarding session never pays it. File-local, JS-only, OTA-able.

---

## Full findings, grouped by root cause (first pass, all verified)

### Root cause 1 — Missing memoization at fan-out points (jank, not freezes)

| Finding | Location | Trigger |
|---|---|---|
| `OnboardingContext` value is a plain object, no `useMemo`; its functions recreated every render | `OnboardingContext.tsx:495-512` | Every keystroke in onboarding text fields re-renders all **22** consumer files, including `AppContent` (~140 hooks), `MessagingProvider`'s render body, and `UserProfileProvider` |
| `UserProfileContext` value unmemoized — cascades to 11 more consumers | `UserProfileContext.tsx:168` | Any upstream re-render or profile change |
| `ExploreTripCard` calls `useUserProfile()` **inside each deck row** | `TripsScreen.tsx:412` | Every `UserProfileProvider` change re-renders every visible Explore card |
| Chat screens have **zero** row-level memo boundaries; `renderItem` deps include `menuVisible`, `selectedMessage`, `otherUserLastReadAt` | `DirectMessageScreen.tsx:4756, 4819`; `DirectGroupChat.tsx:4640, 4819` | Menu open / read receipt re-renders **all** ~20 visible bubbles instead of 1 |
| My Trips list: inline `renderItem`, unmemoized `TripCard`, arrays rebuilt every render | `TripsScreen.tsx:1160-1170, 1248-1265` | Every background refetch / filter change |
| Swelly chat lists defeat virtualization: `initialNumToRender={50}`, `windowSize={21}` | `ChatScreen.tsx:1014-1016`, `TripPlanningChatScreen.tsx:2258-2260` | ~50 rows mounted at once; runs during onboarding |

### Root cause 2 — Redundant synchronous cache I/O on hot paths (the freeze-relevant one — see deep-dive)

- **`chatHistoryCache.ts` eviction double-sweep per save** (`:111-150`, `:156-170`, `:479`) — 60+ `saveMessages` call sites + the 10-conversation boot prefetch (`MessagingProvider.tsx:266-281`). Freeze mechanism #1.
- **`conversationListCache.ts`** — full re-parse (`:102`), two O(n²) merges (`:123`, `:164`), full re-stringify (`:179`) per (2s-debounced) save.
- **`writeShareRecents`** — sync file write per incoming message, iOS (`MessagingProvider.tsx:1013-1018` → `shareRecentsCache.ts:53-84`). Small payload — jank, not freeze.
- **Onboarding AsyncStorage save per keystroke** (`OnboardingContext.tsx:225-229, 390-403`) — fine on native (~1-2KB); on **web** the base64 profile picture makes every keystroke stringify megabytes.

### Root cause 3 — Production observability overhead

- **1,837 `console.*` call sites**, ~40 `__DEV__`-gated, no babel stripping — all live in release. Worst: `swellyService.ts:108, 335` stringifies the full Swelly conversation per AI message (during onboarding); `analyticsService.ts` logs every event's full properties.
- **PostHog session replay**, unmasked, ~1 fps native capture (`analyticsService.ts:44-63`). Native cost; per-second JS touch for coordination/flush.

### Root cause 4 — Individual leaks and runaways

- `ProfileScreen.tsx:1882-1922` — video poll: 2s tick up to **7 min**, Supabase fetch per tick, no unmount cleanup / focus guard.
- `DirectMessageScreen.tsx:809-847` (+ `DirectGroupChat` twin) — 60fps measure loop; safe alone, a freeze when combined with the stuck-menu bug (freeze mechanism #2).
- `RootNavigator.tsx` — stack pushes have no dedup/cap; loops grow the stack indefinitely, every card stays mounted.
- `OnboardingContext.tsx:293-295` vs `:344-346` — `isComplete`/`currentStep` restored from different sources with no reconciliation → telemetry can mislabel where stalls happen.
- Five realtime channels open mid-onboarding (`MessagingProvider.tsx:1059+`, `AppContent.tsx:591, 1202` — gated on `user?.id` only). Cheap per-channel; first-session load the user doesn't need yet.

---

## Top fixes ranked by impact ÷ effort

**If hunting freezes, do #2 first** (it's freeze mechanism #1); the rest of the order targets overall feel.

1. **Strip console in release** — `transform-remove-console` in `babel.config.js` (keep error/warn). ~5 lines, OTA-able, removes the constant tax from all 1,837 sites.
2. **Fix `chatHistoryCache` eviction** — one sweep, size-check before parsing, in-memory size tally, debounced eviction; optionally gate/defer the boot prefetch until onboarding is done. Removes freeze mechanism #1.
3. **`useMemo` the `OnboardingContext` + `UserProfileContext` values** (+ `useCallback` their functions) — mirrors `MessagingProvider.tsx:1490`. ~20 lines, kills the app-wide keystroke fan-out.
4. **Tame the two Swelly chat lists** — `initialNumToRender` 50→15, `windowSize` 21→7. Two lines, inside the first-session window.
5. **Gate `writeShareRecents`** — only write when the top-N actually changed, or debounce 5s.
6. **Fix the ProfileScreen poll** — interval in a ref, clear on unmount. Trivial.
7. **Pass `viewerCountry` into `ExploreTripCard` as a prop** instead of per-row `useUserProfile()`. Trivial.
8. **Memoized row component for the chat screens** — split `renderMessage` into a `React.memo` `MessageRow` in both 7,000-line forked files. Biggest interaction win, most effort/regression surface — do last, deliberately, with device testing. (Also fixes mechanism #2's blast radius, though the stuck-menu close bug needs its own fix.)

Items 1-7 are each an hour or less. Item 8 is a real project.

---

## What couldn't be determined statically

- **Real millisecond costs** — only the Hermes profiler / Instruments gives real numbers on real devices and account sizes.
- **Which mechanism the 32s stall actually was** — mechanism #1 is the best static fit, but only the Instruments capture (freeze-hunt step 2) proves it, and a fresh-account freeze (dfmazariego) is NOT explained by it.
- **PostHog replay's true cost** — native and closed; only measurable empirically.
- **Whether the stuck-menu bug leaves the rAF loop running** — needs the repro in freeze-hunt step 4.
- **Field frequency of the `isComplete`/`currentStep` desync** — needs the one-line telemetry tag.
- **Real AsyncStorage payload sizes on heavy accounts** — estimates only.
