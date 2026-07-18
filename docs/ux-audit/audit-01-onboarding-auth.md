# Swellyo UX Audit — Onboarding & Auth

Reviewer: senior product designer. Bar: WhatsApp / Instagram-level polish.
Scope: Welcome/auth, age gate, onboarding steps 1–7 (board, surf-level video, travel slider, profile, destinations, budget, lifestyle, video upload), Team Welcome, onboarding contexts/scaffold, auth + onboarding services.

Severity legend: 🔴 Critical (breaks flow / looks broken) · 🟠 High (noticeably worse than WA/IG) · 🟡 Medium (polish) · 🔵 Low (nitpick)

---

## Top 5 most impactful fixes for this domain

1. **🔴 Developer-facing error dialogs ship to real users on sign-in failure.** `WelcomeScreen.handleGoogleSignIn` shows alerts that literally say "A database trigger is failing", "Row Level Security policies are blocking the operation", "check your Supabase database configuration", "if you're a developer, check the Supabase dashboard settings" (`WelcomeScreen.tsx:683–704`). A real user hitting a transient signup error sees this and thinks the app is broken. Replace with one friendly message + Retry.
2. **🔴 The final "Create Profile" step silently marks onboarding complete even when the profile save fails.** `handleStep7Next` catches the error, shows **no** message, and still calls `markOnboardingComplete()` + navigates in (`AppContent.tsx:1045–1054`). The `surfers` row may never have been created, yet the user is pushed into the app as "onboarded." At minimum show a Retry (as Step 4 destinations already does).
3. **🟠 Age-verification bottom sheet is a trap in its normal state.** Tapping the backdrop only closes it when already in the error state (`WelcomeScreen.tsx:991`); there is no Cancel/close button and no Android hardware-back handling (it's a custom `Animated.View`, not a `Modal`). A user who taps a sign-in button by accident must scroll-pick a DOB and press Continue to escape.
4. **🟠 Primary CTAs never show a spinner and required-field errors have no message.** Every loading state is a text swap ("Signing in…", "Loading…", "Uploading…") with no `ActivityIndicator` — below the WA/IG bar. On Step 4, empty required fields (name/location/pronoun) only recolor a border; there's no error text, no scroll-to-first-error, so a user taps "Create Profile" and nothing appears to happen.
5. **🟠 Silent upload failures for avatar and surf video.** Step 4 falls back to embedding a base64 blob as the avatar on any upload error with no user feedback (`OnboardingStep4Screen.tsx:961–985`); the surf-video step uploads fire-and-forget on Next and only `console.error`s on failure (`OnboardingVideoUploadScreen.tsx:424–430`). Users believe media is set when it isn't.

---

## WelcomeScreen.tsx (auth entry + age gate)

- 🔴 **Raw developer error copy in production alerts.** `WelcomeScreen.tsx:683–728` branches on `Database error` / `server_error` and renders multi-line troubleshooting aimed at developers ("A database trigger is failing", "check the Supabase dashboard settings"). *Fix:* collapse to a single `friendlyErrorMessage`-based alert ("Something went wrong signing you in. Please try again.") + Retry; log the technical detail only.
- 🟠 **Age sheet has no Cancel affordance and can't be dismissed normally.** Backdrop tap is wired only for the error state (`:991`); the sheet has a drag handle visual (`:1007`) but no pan-to-dismiss and no close button. It's not a `Modal`, so Android back won't dismiss it. *Fix:* add a Cancel/X, allow backdrop-tap dismiss in the normal state, and handle Android back.
- 🟠 **Disabled sign-in buttons give no reason.** Apple/Google are disabled at 0.6 opacity until `agreedToTerms` (`:914–915`, `:931–932`) but tapping a greyed button does nothing and never points the user at the Terms checkbox. *Fix:* on tap-while-disabled, nudge/scroll-highlight the Terms row, or keep the button enabled and validate on press with an inline message.
- 🟠 **Long cold-start spinner with no fallback.** During `isRestoringSession` the screen shows only the spinning logo with buttons hidden (`AppContent.tsx:2022–2029`); session restore retries 4× at a 5s timeout (`OnboardingContext.tsx:39–48, 90–187`), so a bad network can spin ~20s before login even appears. *Fix:* show the sign-in buttons sooner (restore in background) or add a "Taking longer than usual…" affordance.
- 🟠 **Age "Continue" button has no disabled/loading state.** `handleAgeVerifyContinue` guards with `if (isVerifying) return` (`:311`) but the button (`:1097–1103`) never dims or shows progress, so a double-tap looks unresponsive. *Fix:* disable + show spinner while `isVerifying`.
- 🟡 **Text-only loading, no spinner** on Apple/Google ("Signing in…", `:921`/`:938`). WA/IG show an inline spinner. *Fix:* add `ActivityIndicator`.
- 🟡 **Web redirect-blocked path uses two verbose alerts** (`:558–568`, `:621–630`) with bullet-point browser troubleshooting — developer-flavored. *Fix:* soften copy.
- 🟡 **No accessibility labels** on the sign-in buttons, Terms checkbox, or age picker wheels; screen readers get raw child text or nothing. *Fix:* add `accessibilityRole="button"` + `accessibilityLabel`.
- 🔵 **Dead login stub.** `handleLogin` is a `// TODO` `console.log` (`:739–742`) — not reachable from UI; remove.
- 🔵 **Age wheels are scroll-only.** Unlike Step 4's DOB picker (which supports tapping a row), these only respond to scroll (`:1031–1090`). Minor discoverability gap.
- 🔵 **Age gate is device-local and bypassable** (secret 3s long-press unblock `:1011`, survives only until app-data clear). Called out as intentional (server-side gating elsewhere) — fine, noting for completeness.

## OnboardingWelcomeScreen.tsx (step 0)

- Clean, self-contained, swipe-back wired (`:42–49`), button has `activeOpacity`. No async so no loading needed.
- 🟡 **`allowFontScaling={false}` on all copy** (`:83–98`) breaks Dynamic Type for low-vision users. Recurring across onboarding.
- 🔵 No `accessibilityRole` on "Start Your Journey".

## Onboarding scaffold & chrome (steps 1–7) — OnboardingScaffold/OnboardingChrome/OnboardingStepContext

- Good: persistent header (back + animated progress + cross-fading label) and a single Next button that dims + shows `loadingLabel` while saving (`OnboardingChrome.tsx:122–153`). Double-tap is guarded per-step via `isSavingStepN` in AppContent.
- 🟡 **Next button never shows a spinner** — only label → "Loading…" (`:130`). Consistent but below the bar.
- 🟡 **Back button has `testID` but no `accessibilityLabel`** (`OnboardingChrome.tsx:86`).
- 🔵 No "exit onboarding" affordance; back from step 1 relies on AppContent routing.

## OnboardingStep1Screen.tsx (board type)

- Default board preselected, `canProceed` always true — no empty state needed. Fine.
- 🔵 Video preload is best-effort/non-blocking with `console.warn` on failure (`:148–163`) — acceptable (Step 2 has its own thumbnail fallback).

## OnboardingStep2Screen.tsx (surf-level video)

- Good: shows a thumbnail until the player reports `readyToPlay` (`:108–150`).
- 🟠 **No error/fallback state if a level video fails to load.** If the player never becomes ready, the user is stuck on a frozen thumbnail with no message or retry. *Fix:* surface a lightweight "couldn't load video" state or fall back to a static image + allow proceeding.
- 🔵 **Fragile title auto-fit.** Manual char-width estimation to fit 2 lines (`:51–79`) instead of `numberOfLines={2}` + `adjustsFontSizeToFit`. Works but brittle.
- 🔵 Dead `skipButton` style with `opacity: 0` (`:280–285`).

## OnboardingStep3Screen.tsx (travel slider)

- `validateForm` effectively always passes (default 0). No real failure surface. Fine.

## OnboardingStep4Screen.tsx (profile: name/location/DOB/avatar/home break/pronouns)

- 🟠 **Silent avatar upload fallback to base64.** On any upload failure the code keeps the local base64/`file://` string as the avatar and continues with no user feedback (`:961–985`). A giant base64 string can end up persisted as the profile image. *Fix:* on failure, show a friendly "Couldn't upload your photo — try again" and don't persist base64.
- 🟠 **Required-field errors are border-only, no message, no scroll-to-error.** name/location/pronoun set a red border (`:925–927`) with no `errorText` (only DOB gets one at `:535`); tapping "Create Profile" with an offscreen empty field looks like a dead button. *Fix:* add inline error copy + auto-scroll to first error.
- 🟡 **Pronoun defaults to `'sis'` for everyone** (`:773`), so every user is pre-labeled "Sis" and `pronounError` can never fire (value always present). *Fix:* start unset and require an explicit pick, or make the default neutral.
- 🟡 **Name field uses `autoCapitalize="none"`** (via the shared `Field`, `:157`) so names don't auto-capitalize. *Fix:* `words` for the name field.
- 🟡 **`Alert.alert('Image Picker Not Available', 'Please install expo-image-picker…')`** (`:890`) is a developer message that can reach a user in Expo Go. *Fix:* soften or guard.
- Good: gallery permission primer + Settings deep-link on hard denial (`:859–875`); `isUploading` disables Next with an "Uploading…" label (`:1015–1017`); DOB hard-gate resolves from a fresh DB fetch and won't flash (`:797–827`).
- 🔵 "Age*" placeholder opens a **date-of-birth** wheel and then displays the computed age — mildly confusing label vs. control.

## OnboardingStep4DestinationsScreen.tsx (destinations)

- Strong: Skip disclaimer modal for the empty case (`:174–179`), remove-confirmation alert (`:85–94`), and **Retry / Continue-anyway** handling on save failure in `AppContent.tsx:927–934` — this is the model the other steps should follow.
- 🔵 Empty state is the carousel's "add" card — acceptable.

## OnboardingStep5BudgetScreen.tsx (budget)

- Good: Next stays disabled until a card is centered (`canProceed: !!centered`, `:46–51`); selection restores from `initialData`.
- 🟡 Save failure silently advances (`AppContent.tsx:952–954`) — low stakes (single enum) but inconsistent with Step 4's retry.

## OnboardingStep6LifestyleScreen.tsx (lifestyle)

- 🟡 **Copy says "Select 3 or more!" but nothing is enforced** — `canProceed` is always true and you can continue with zero picks (`:194–199`). Either enforce a minimum or soften the copy to "Pick a few."
- Good: "Add your own" Pexels fetch has a loading spinner + "No image found" alert (`:163–184`); debounced search; memoized cards.
- 🔵 Very short (<2 char) or no-result searches show a blank grid with no "no results" message.

## OnboardingVideoUploadScreen.tsx (surf clip)

- 🟠 **Upload is fire-and-forget with no failure feedback.** `handleNext` calls `uploadProfileVideoS3(...).catch(err => console.error(...))` then advances (`:424–430`). If it fails, the user believes their clip is set; there's no progress, success, or retry. *Fix:* surface upload progress/failure (at least a retry toast), consistent with the app's upload-progress-ring work elsewhere.
- Good: skip supported (Next → "Skip", `:432–437`), client-side video validation with inline error text (`:359–363`, `:496–498`), permission primer + Settings deep-link.
- 🔵 Three stacked `play()` workaround effects (`:124–323`) are fragile/hard to maintain but functional.

## SwellyoTeamWelcome.tsx

- Static welcome chat; back + CTA wired. Fine overall.
- 🔵 **Hardcoded timestamp "10:45"** (`:114`) reads as fake next to a real chat UI.
- 🔵 `dropInButton` has a stray `borderLeftWidth: 4` with no color (`:288`) — dead style.
- 🔵 Platform-hacky header `paddingTop` math (`:149`, `:164`).

## OnboardingContext.tsx / OnboardingStepContext.tsx

- Robust: server-validated `getUser()` restore with exponential-backoff retries; non-blocking preloads; DB `finished_onboarding` wins over local cache to avoid flashing onboarding.
- 🟡 **Restore can take ~20s on bad network** (4 × 5s) while the UI shows only a spinning logo — see the WelcomeScreen cold-start item. Consider surfacing the login buttons during restore.
- 🔵 All step saves in `saveStepToSupabase` swallow errors (`:418–421`) "so the user can continue" — reasonable, but combined with Step 7's silent completion it means a fully-failed sync leaves an "onboarded" user with an incomplete DB row.

## authService.ts / GoogleSignInTest.tsx

- 🔵 `GoogleSignInTest.tsx` is a dead stub (its button only `console.log`s). Remove.
- 🔵 Legacy web/mobile Google paths are `@deprecated` dead code (only reached if Supabase unconfigured, which never happens in prod). Fine, just noting.

---

## Cross-cutting themes (fix once, help everywhere)

- **Loading = text swap, never a spinner.** Adopt an `ActivityIndicator` inside primary CTAs (Welcome sign-in, age Continue, onboarding Next, upload).
- **Inconsistent save-failure handling.** Step 4 destinations does it right (Retry/Continue). Steps 1–3, 5, 6, and especially **Step 7** silently swallow failures; Step 7 additionally marks onboarding complete on failure.
- **Accessibility gaps.** Most onboarding `TouchableOpacity`s lack `accessibilityRole`/`accessibilityLabel`; several screens hard-disable font scaling.
- **Developer-flavored error copy** appears in three places (Google sign-in DB/server errors, image-picker-not-available, redirect-blocked). Route all through `friendlyErrorMessage`.
