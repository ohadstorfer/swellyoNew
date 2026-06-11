# R7 — Completeness Audit

_Independent verification sweep. Date: 2026-06-11. Branch: eyal._

---

## Summary

**Gaps found: 10**
**Contradictions found: 4**
**Remaining human/product decisions: 6**

---

## 1. Gaps — Items Missing or Misclassified Across R1–R6

### GAP-01: Three DM open paths, not two (all reports say "dual-render")

All reports describe a "dual-render" problem with two DM paths (ConversationsStack inner push vs AppContent overlay). There is actually a **third** path: `ConversationsScreen` owns its own `selectedConversation` local state (line 239) used when `stackCtx` is null on web. This is distinct from AppContent's `selectedConversation` overlay state and from the inner stack push.

The three paths are:
1. ConversationsStack `navigation.navigate('DirectMessage')` — native only, from conversation list tap
2. AppContent `selectedConversation` overlay — from Profile, TripPlanning, push notification, cross-screen entry
3. ConversationsScreen-local `setSelectedConversation` — web only, from conversation list tap when `stackCtx` is null

R4 documents the web path as using "local `selectedConversation` state inside ConversationsScreen" but the reports never explicitly count this as a third distinct code path — they frame it as "Path A vs Path B". The migration plan must account for three convergence points, not two.

**File:** `src/screens/ConversationsScreen.tsx:189–211` (`openConversation` function)

---

### GAP-02: SwellyShaperScreen is UNREACHABLE in production (R4 misclassified)

R4 (C7 entry) classifies SwellyShaperScreen as an "Early-return overlay inside ConversationsScreen". This is wrong. `setShowSwellyShaper(true)` is **never called** anywhere in the codebase. The ConversationsScreen local state `showSwellyShaper` has no setter call that activates it. The AppContent state `showSwellyShaper` also has no `true` setter call. R5 correctly identified this. R4 did not.

**Impact on migration:** SwellyShaperScreen should be flagged as dead code for the migration plan. Do not wire it as a route. Confirm with product before removing.

**Files:** `src/screens/ConversationsScreen.tsx:248` (state declared, never set true), `src/components/AppContent.tsx:922` (same)

---

### GAP-03: ConversationsScreen has two additional undocumented Modals

R1's census of ConversationsScreen modals is incomplete. The screen contains:
- A hamburger **menu Modal** (`showMenu` state, `<Modal transparent animationType="fade">`, lines ~1413–1621) — a settings/logout popover
- A **logout loading overlay Modal** (`isLoggingOut` state, `<Modal transparent animationType="fade">`, lines ~1649–1662) — prevents interaction during logout

Neither is mentioned in any report. Both are ephemeral UI overlays (not navigation), but the logout Modal blocks all interaction and must continue to render above any navigator during the logout choreography.

**File:** `src/screens/ConversationsScreen.tsx:1413` and `:1649`

---

### GAP-04: OnboardingChrome.tsx not in R1's component census

`src/components/onboarding/OnboardingChrome.tsx` exists and is part of the new onboarding scaffold architecture (`OnboardingHeader` and a footer button rendered by `OnboardingScaffold`). It uses `useOnboardingStepChrome` from `OnboardingStepContext` and persists across all onboarding step transitions as the fixed chrome layer. It is pure UI (no navigation), but it is a component missed from the R1 inventory.

**File:** `src/components/onboarding/OnboardingChrome.tsx`

---

### GAP-05: OnboardingStepContext.tsx not mentioned anywhere

`src/context/OnboardingStepContext.tsx` is a bridge between the persistent onboarding chrome (header + next button) and step screens. It uses a token system to prevent the outgoing step's unmount from clearing the incoming step's registered handlers. This is entirely relevant to migration of onboarding — if OnboardingScaffold is ever replaced with a navigator, this context's "both steps briefly mounted during slide" comment is load-bearing.

**File:** `src/context/OnboardingStepContext.tsx:1–14` (key comment about dual-mount during slide)

---

### GAP-06: DestinationCardsCarousel.tsx (non-copy) is dead code — R1 status listed as "unknown"

R1 says `DestinationCardsCarouselCopy` has "unknown usage — needs grep to confirm live consumers." The non-copy `DestinationCardsCarousel.tsx` is imported by **nothing** in `src/`. The copy variant is used only in `ChatScreen.tsx` which is itself on the dead onboarding chat path. Both carousel components are effectively dead.

**File:** `src/components/DestinationCardsCarousel.tsx` — no importer in src/

---

### GAP-07: AnalyticsDashboardScreen has an internal sheet Modal not counted

R1 lists AnalyticsDashboardScreen as having a "Modal for filter sheet." The filter sheet is a local `FilterSheet` component defined at the bottom of `AnalyticsDashboardScreen.tsx` with `<Modal animationType="slide" transparent>` at line 428. This was mentioned in R1's table but the count of `<Modal>` instances was not updated to include it. Minor omission but confirms the file has 1 navigation-relevant Modal beyond the screen wrapper.

**File:** `src/screens/AnalyticsDashboardScreen.tsx:428`

---

### GAP-08: TripsBottomNav.tsx internal comment says "Rendered once at the bottom of TripsScreen" — stale and misleading

The JSDoc comment at line 194 says "Rendered once at the bottom of TripsScreen so it overlays all three tabs." This is **factually wrong** — it is rendered in `AppContent.tsx:1984`, not TripsScreen. A migration engineer reading only the TripsBottomNav file would have a wrong mental model.

**File:** `src/components/trips/TripsBottomNav.tsx:194–199`

---

### GAP-09: CreateTripFlowA wizard draft version bump not noted

`useTripWizardDraft` uses `WIZARD_STATE_VERSION = 6` as a cache key. R3 mentions this but no report flags that the version must be bumped if the wizard's state shape changes during migration (e.g., if route params replace AsyncStorage fields). Post-migration, if the wizard modal becomes a navigator screen and its state is encoded differently, old drafts stored under version 6 will silently produce no draft offer (version mismatch is treated as no draft). This is not a blocker but must be tracked.

**File:** `src/screens/trips/CreateTripFlowA.tsx` — search `WIZARD_STATE_VERSION`

---

### GAP-10: VideoCarousel.tsx not in any component census

`src/components/VideoCarousel.tsx` is used in `OnboardingStep2Screen.tsx` for the surf-level video picker. It is pure UI with no navigation or Modal behavior, but it was not listed anywhere in R1–R6. No migration impact, but the inventory is incomplete.

**File:** `src/components/VideoCarousel.tsx`

---

## 2. Contradictions Found

### CONTRADICTION-01: WelcomeToLineupOverlay — Modal vs. not Modal (R2 vs. R1/R5)

**R2** states in its layer z-order table: `WelcomeToLineupOverlay (RN Modal, always rendered)`.

**R1** explicitly states: "NOT a Modal — rendered as absolute-positioned View inside the main tree."
**R5** confirms: "Component stays permanently mounted — it uses Animated fade-in/out on `visible` toggle (NOT RN `<Modal>`)."

**Verified truth:** `WelcomeToLineupOverlay.tsx` contains NO `<Modal>` import or usage. Line 71 even has a comment: "Backdrop fade animation — replaces the old `<Modal animationType='fade'>`." It was refactored away from a Modal. **R1 and R5 are correct; R2 is wrong.**

**Migration impact:** This overlay must be treated as a persistent absolute-fill View (like `display:none` toggle), not as a root-level RN Modal. Its 350ms back-delay choreography relies on it being in the same render tree as ProfileScreen, not in a separate Modal layer.

---

### CONTRADICTION-02: SwellyShaperScreen entry point (R4 vs. R5)

**R4** classifies SwellyShaperScreen (C7) as an "Early-return overlay inside ConversationsScreen" and describes it as accessible when triggered via `showSwellyShaper` local state.

**R5** states: "Currently no UI entry point wired to open it from anywhere visible to the user."

**Verified truth:** `setShowSwellyShaper(true)` is called nowhere in the codebase. The ConversationsScreen state exists but is never activated. **R5 is correct; R4's C7 classification as an active reachable screen is wrong.** SwellyShaperScreen is dead at both AppContent and ConversationsScreen levels.

---

### CONTRADICTION-03: R6 vertical swipe count (3 vs. 4 in same document)

**R6** counts summary says "Vertical swipe-dismiss modal gestures: 3" but the parenthetical names four items: `ImagePreview, FullscreenVideo, FullscreenImageViewer, VideoPreview`. The count is 4, not 3.

**Verified truth:** All four files (`ImagePreviewModal.tsx`, `FullscreenVideoPlayer.tsx`, `FullscreenImageViewer.tsx`, `VideoPreviewModal.tsx`) have `Gesture.Pan()` vertical swipe-to-close. Count should be 4.

---

### CONTRADICTION-04: TripsBottomNav render location wording (TripsBottomNav.tsx comment vs. R3/AppContent)

**TripsBottomNav.tsx JSDoc (line 194):** "Rendered once at the bottom of TripsScreen so it overlays all three tabs."

**R3 and AppContent code:** The bar is rendered in `AppContent.tsx:1984`, not in TripsScreen. TripsScreen has `useTripsBottomNavControl()` as a fallback only.

**Verified truth:** The component file's own documentation is wrong. All reports correctly document the AppContent render location. The misleading comment in the file could misdirect a migration engineer reading the source.

---

## 3. Remaining Classification Uncertainties (Needs Human/Product Decision)

### UNCERTAINTY-01: SwellyShaperScreen — remove or keep as dormant route?

SwellyShaperScreen is completely unreachable (GAP-02, CONTRADICTION-02). The migration plan must decide:
- **Option A:** Remove it entirely (delete file and all import references).
- **Option B:** Keep it as a latent route in the new navigator, wired to a future entry point (e.g., a "Shaper AI" menu item in Profile or Settings).

This is a product decision. The migration engineer should not wire it as an active route without confirmation.

---

### UNCERTAINTY-02: TripPlanningChatScreen (non-copy) — remove or dead layer?

`showTripPlanningChat` is never set to `true` by any user action. The non-copy Swelly chat screen is mounted-but-dead. The `handleTripPlanningChatBack` handler checks `showTripPlanningChat` but it can never be true. Should it be:
- **Option A:** Deleted entirely. The "copy" becomes the canonical screen (renamed).
- **Option B:** Kept as the stable production variant and the "copy" merged into it, renaming complete.

No report took a position. Product must decide before migration.

---

### UNCERTAINTY-03: ConversationsScreen hamburger menu — route or stay as Modal?

The hamburger menu (GAP-03) is a settings/logout popover rendered as a `<Modal transparent>` inside ConversationsScreen. Under react-navigation it could stay as a Modal (simplest) or become an inline dropdown or a sheet route. Not architecturally dangerous as a Modal, but if the menu gains more items it becomes a route concern.

---

### UNCERTAINTY-04: ProfileEditPanel — root-level Modal or transparentModal route?

R5 calls this out as a landmine. It renders outside the `activeOverlay` priority chain — it floats above everything including ProfileScreen. In migration it must either:
- Stay as a root-level `<Modal>` (zero migration risk, recommended), or
- Become a `transparentModal` route at the root navigator, allowing hardware-back handling and animation coordination.

The `animationType="none"` + internal Reanimated spring means the default navigator transition must be suppressed if it becomes a route. No report took a final position.

---

### UNCERTAINTY-05: OnboardingScaffold — keep outside navigator or migrate to child navigator?

R5 recommends keeping it outside the main navigator as a pre-navigator gate. R2 notes the same. But the new `OnboardingChrome.tsx` (GAP-04) architecture with `OnboardingStepContext` means both the chrome and step content are briefly mounted simultaneously during step transitions. If onboarding ever needs URL routing (e.g., for web deep-link to onboarding step), it would need a sub-navigator. Current consensus: keep outside. But product should confirm no web URL-per-step requirement exists.

---

### UNCERTAINTY-06: LoadingScreen.tsx consent Modal — App Store compliance?

R1 flags: `LoadingScreen.tsx` is on a dead render path but contains a consent Modal for AI usage. Before removing the file, App Store compliance must be verified. The consent may be required by Apple's guidelines for AI-powered features. If removed and Apple reviews the app, a missing consent flow could cause rejection. This is a product/legal question, not a code question.

---

## 4. Non-Gaps Verified

The following items were independently verified and are accurately documented in R1–R6:

- `TripPlanningChatScreenCopy.tsx` IS the live Swelly screen (`handleSwellyPress` → `setShowTripPlanningChatCopy(true)`). All reports agree.
- `WelcomeToLineupOverlay` is NOT a Modal — position:absolute View. Confirmed at source.
- `ConversationsStack` is the only real navigator (`src/navigation/ConversationsStack.tsx`) — confirmed no other navigator files exist.
- No `navigationRef` exists — `NavigationContainer` in `App.tsx` has no `ref` prop.
- `setShowSwellyShaper(true)` is never called anywhere.
- `BackHandler` is used only in `MapPickerModal.tsx` (2 instances, Android-only).
- `useReanimatedKeyboardAnimation` is used in exactly 3 files: `DirectMessageScreen`, `DirectGroupChat`, `ChatScreen`.
- Platform-split files: 3 total (`CountryPickerWrapper.web.tsx`, `CountryPickerWrapper.native.tsx`, `AvatarCropModal.native.tsx`).
- `DestinationCardsCarousel.tsx` (non-copy) has zero importers — dead code.
- `DestinationCardsCarouselCopy` is only used in `ChatScreen.tsx` (dead onboarding chat path).
- `GoogleSignInTest.tsx` has zero importers — dead component.
- `src/navigation/` contains exactly one file: `ConversationsStack.tsx`.

---

## 5. Screen Census Reconciliation

All 33 files in `src/screens/` are accounted for across R1–R6. No screen file was missed from the census.

All navigation-relevant components in `src/components/` are accounted for, with two additions from this sweep:
- `OnboardingChrome.tsx` — new file, onboarding UI only, no navigation behavior
- Hamburger menu Modal + logout Modal inside `ConversationsScreen.tsx` — ephemeral UI Modals not in any report's Modal count

Final `<Modal>` count adjustment: R1 said 45 files; `ConversationsScreen.tsx` has 2 additional instances (menu + logout) and `AnalyticsDashboardScreen.tsx` has 1 (filter sheet). R1's count of 45 was likely accurate since these were probably already included in the raw grep, but they were not explicitly called out in the inventory.
