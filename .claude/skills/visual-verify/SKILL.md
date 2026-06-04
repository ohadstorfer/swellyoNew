---
name: visual-verify
description: After making UI changes, capture smart-timing screenshots of the affected elements on the booted iOS simulator. Apply the right pattern per element type — buttons get before/after, sliders get multiple values, text inputs get empty/filled/keyboard-open/keyboard-closed, modals get pre-open/open/dismiss, etc. Use when the user wants to visually confirm UI work just done. Trigger phrases include "/visual-verify", "verify the UI", "screenshot the buttons I just changed", "show me what it looks like in the sim".
user_invocable: true
arguments: "Context describing what UI you just changed and want to verify. Example: '/visual-verify the next/back buttons in CreateTripFlowBC'. If omitted, the skill asks which changes to verify before doing anything."
---

# `/visual-verify` — smart screenshots of just-changed UI

You drive the booted iOS simulator via Maestro to capture screenshots of the UI elements the user just touched in code. You pick the right screenshot pattern per element type. You save everything into a single timestamped session folder, and you report back with the most important PNGs.

This skill is the visual half of `/verify`. `/verify` confirms the code builds and types; `/visual-verify` confirms the *pixels* look right.

## Scope contract

- **iOS sim only.** Android is not in scope of this skill. If the user explicitly asks for Android, say it's not yet supported and stop.
- **One session per invocation.** Everything for this run lives in one folder: `.maestro/screenshots/visual-verify-<YYYY-MM-DD_HHMMSS>/`.
- **The user tells you the scope** in the prompt. Do not infer from git diff. If the scope is unclear, ASK with `AskUserQuestion` before doing anything that touches the sim. Never invent.
- **Works on any screen.** If the user names a screen with a documented playbook (see "Playbook library" below), use it directly. Otherwise the skill **derives** the verification plan from the source code (Phase 2b) and runs the **verify-and-adapt loop** (Phase 4). After a successful run on a new screen, the agent adds a new playbook entry so the next agent can skip the loop.

## Phase 1 — Preconditions (fail fast)

Run these checks in parallel. If any fails, stop and explain — do not try to fix automatically:

1. **iOS sim booted.** `xcrun simctl list devices booted | grep -E 'iOS.*Booted|Booted.*iOS'` — must return at least one. If not: "No iOS sim is booted. Run `open -a Simulator` first." and stop.
2. **Metro running with the MCP flag.** `curl -sf http://localhost:8081/status` — must succeed. If not: "Metro isn't running. Start it with: `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start` and then re-run this." and stop.
3. **Maestro available.** `~/.maestro/bin/maestro --version` — must print a version. If not: "Maestro isn't installed at `~/.maestro/bin/maestro`. See `AUTOMATED_TESTING.md`." and stop.

Once green, declare it in one short line ("✓ iOS sim, Metro, Maestro") and continue.

## Phase 2 — Parse the scope

Read the user's argument string + last assistant turn (what UI changes were just made). Extract:

- **Target screen file(s)** — the `.tsx` files containing the changed elements
- **Target element list** — each item is `{ testID, type, file:line, label-or-desc }`
  - `testID`: existing testID on the element (preferred) or `null` if no testID
  - `type`: one of the patterns from the table below
  - `file:line`: where it lives, for the report
  - `label-or-desc`: a short human label

Two ways scope arrives:
- **Explicit** ("/visual-verify the slider in OnboardingStep5BudgetScreen") → Read the file, find the matching element, populate the list.
- **Implicit from recent edits** ("/visual-verify what you just changed") → Look at the last few file edits in this conversation. If multiple files or unclear, **AskUserQuestion** which is the primary target. Do NOT silently pick the first.

If a targeted element has no testID:
1. Prefer to ask the user to add one first (testIDs make Maestro orders of magnitude more reliable). Show the exact 1-line edit needed (`testID="<screen>-<element>-button"` per `AUTOMATED_TESTING.md` convention).
2. If they say "no, just do it without testID", use a `text:` matcher anchored to the visible label as a fallback. Note in the report that this element used a text matcher and may break on label changes.

## Phase 2b — Analyze the target screen (build a verification plan)

The skill must work on **any** screen the user points it at, not just the ones with a hand-written playbook below. Before you touch the sim, build a plan by reading the source and classifying what's there.

For each target screen:

1. **Locate the source file.** Read `src/screens/<ScreenName>.tsx` (or `src/components/<ComponentName>.tsx`). Read 1 level deep into any imported component that looks interactive (e.g., if the screen imports `CustomSlider`, read that too). Do not crawl the whole codebase.

2. **Classify each interactive element** by mapping JSX/imports to a type from the "JSX → Type" table below. For each element, record:

   ```
   { name, type, file:line, selector: { id | text | accessibilityText }, dependencies }
   ```

   `dependencies`: other elements that must be filled first for this one to do something (e.g., "Save" depends on "country + place filled").

3. **Verify each selector against the live screen.** Once you've navigated to the screen (Phase 3), call `mcp__maestro__inspect_screen` and confirm each element you planned for actually appears in the hierarchy with the expected `resource-id` / `text` / `accessibilityText`. If a planned element isn't there, the code may have diverged from your read — re-read the source or ask the user.

4. **Order the captures by dependency.** Capture stateless elements (buttons that don't need other state) first. Capture stateful ones (Save buttons, "Next" gates) after filling their inputs.

5. **Plan navigation to reach the screen.** From the current sim state, build the tap sequence (see Phase 3 navigation map).

Don't start interacting until this plan exists. If anything in the plan is ambiguous (multiple possible screens match the user's words, unknown element type, missing testID, unclear dependency), ASK before proceeding.

### JSX / Import → element type mapping

When you read a target `.tsx`, use these signals to classify each interactive element. Match against **import names first** (most reliable); fall back to JSX component names.

| Import / JSX signal | Type from the pattern table |
|---|---|
| `TextInput` from `'react-native'`; `ChatTextInput`, `TextField`, `WhatsAppTextInput` | text-input |
| `Slider` from `'@react-native-community/slider'`; `CustomSlider` | slider |
| `Switch` from `'react-native'` | switch |
| `TouchableOpacity` / `Pressable` / `Button` with a single onPress and non-tab styling | button |
| `Modal`, `BottomSheet`, `RBSheet`; `Reanimated.View` styled as full-screen overlay | modal |
| `Picker`, `RNPickerSelect`, `ActionSheet`, `CountryPicker`, `CountrySearchModal`, custom country/spot search modal | dropdown |
| `FlatList`, `SectionList`, `ScrollView` with `data=` and renderItem | list |
| `expo-image-picker`, `react-native-image-crop-picker`, system Photos picker | image-picker |
| `react-native-snap-carousel`, `Reanimated.FlatList horizontal`, our `BoardCarousel` / `DestinationsCarousel` / `BudgetCardsCarousel` / `DestinationCardsCarousel` | carousel |
| `ActivityIndicator` toggled by an `isLoading` state | loading/async-state |
| 2+ `TouchableOpacity` grouped, one with "active" styling per state | tabs / segmented |
| Custom checkbox icon (`<CheckboxIcon checked=...>`) toggled by tap | checkbox |
| `DateTimePicker` from `'@react-native-community/datetimepicker'`; calendar libs | date-picker (native iOS pattern) |
| Any sheet/modal that searches for something and returns a value (CountrySearchModal, HomeBreakSearchSheet) | dropdown |

If a custom component doesn't match anything above, **read its source one level deep** to find the primitive. `BudgetCardsCarousel` → uses horizontal FlatList → treat as carousel. `DateOfBirthSheet` → uses DateTimePicker → date-picker pattern.

If even after reading 1 level deep you can't classify it, **ASK the user** what to capture. Don't guess.

## Phase 3 — Navigate to the screen

Generate an inline Maestro YAML and run it with `mcp__maestro__run` (or `~/.maestro/bin/maestro test` with a temp file as fallback).

### Launch boilerplate (ALWAYS include)

Every flow you generate starts with this block. Three modals can pop up between `launchApp` and the real UI — handle each conditionally:

```yaml
appId: com.swellyo.app
---
- launchApp:
    clearState: false  # only true if explicitly requested — see "Entering onboarding"
    stopApp: true

# Modal 1 — Dev-client launcher (appears after clearState, asks which Metro server to use)
- runFlow:
    when:
      visible:
        text: "http://localhost:8081"
    commands:
      - tapOn:
          text: "http://localhost:8081"

# Modal 2 — First-launch dev-menu (appears after dev-client connects, one-time per install)
- runFlow:
    when:
      visible:
        text: "This is the developer menu.*"
    commands:
      - tapOn:
          text: "Continue"

# Modal 3 — LogBox red overlay (any console.error in dev triggers it; AppContent throws one on every cold start)
- runFlow:
    when:
      visible:
        text: "Dismiss.*"
    commands:
      - tapOn:
          text: "Dismiss.*"
```

After the boilerplate, gate on a testID for the screen state you expect to land on (Welcome vs Lineup vs mid-onboarding) with `extendedWaitUntil … timeout: 120000`. The first cold bundle on the sim takes 60–90s.

### Navigation map — how to reach each screen

The app has 3 root states. Pick the right entry:

**1. Logged-out / Welcome.** Only reachable by clearing both local AsyncStorage AND the demo user on Supabase. Gate testID: `welcome-google-button`. Use only when you must verify pre-auth UI.

**2. Mid-onboarding.** A demo or new user whose `currentStep < 7`. Gate testID: `onboarding-next-button`. The app auto-routes to whichever step the user was last on.

**3. Authenticated home (Lineup).** Standard for an existing account. Gate testID: `conversations-profile-button`. This is Ohad's normal state.

#### Routes from authenticated home

```
Lineup (conversations-profile-button)
├── tap conversations-profile-button → ProfileScreen
├── tap conversations-menu-button → menu sheet
│       ├── tap "Trips" → TripsScreen (trips-back-button)
│       ├── tap "Settings" → SettingsScreen
│       └── tap "Profile" → ProfileScreen
├── tap conversations-swelly-button → Swelly chat (swelly-chat-input)
└── tap conversation-row-<id> → DM (dm-chat-input) or Group (group-chat-input)

TripsScreen
└── tap trips-empty-create-button (when empty) OR menu → "Create new trip"
        → mode picker (A/B/C)
            → A: CreateTripFlowA (create-trip-a-next-button)
            → BC: CreateTripFlowBC (create-trip-bc-next-button)
            → C: CreateTripFlowC (create-trip-c-next-button)
```

#### Entering the onboarding flow

If the user is in state 3 (logged in) and you need to verify onboarding screens, you have three options. Pick based on the user's wording:

- **`clearState: true` + walk through fresh Welcome** — clears AsyncStorage. If Ohad's account is what's on the sim, this is destructive (logs him out, needs Google sign-in to recover). Use only when explicitly authorized.
- **Fresh demo user** — `clearState: true` + tap `welcome-demo-button`. Creates a new synthetic user. Caveat: the demo user persists on Supabase; if a previous demo run got partway through onboarding, this user may resume at their last step rather than at step 0. To force a true reset, the user must delete the prior demo user from Supabase first.
- **Resume current state** — `clearState: false`. The app reopens at wherever the user left off. Use this when the user has manually navigated to the screen they want verified.

When the user prompt does not say which path, ask once with `AskUserQuestion` before doing anything destructive.

#### Onboarding step-by-step navigation

Once inside the onboarding flow, the `onboarding-next-button` + `onboarding-back-button` testIDs work on every step. The label changes per step ("Next" → "Continue" → "Finish") but the testID is stable. Tap `id: onboarding-next-button` regardless of label.

The Next button is **disabled** when the step's inputs aren't satisfied. If `tapOn` of the Next testID succeeds but the screen doesn't change, the button was disabled — go fill the required input (see Smart Input Patterns) and try Next again.

### Fallback: ground-truth navigation

If you don't know the chain (new feature, recently moved nav), call `mcp__maestro__inspect_screen` (or `~/.maestro/bin/maestro hierarchy`) at each step to see the live tree. The hierarchy's `resource-id` field shows real testIDs; `text`/`accessibilityText` shows labels. Don't guess from code — the hierarchy is ground truth.

### Maestro selector gotchas (learned the hard way)

- **`text:` matchers are full-string regex with IGNORE_CASE.** Partial matches need `.*`. `text: "What is your style"` does NOT match `"What is your style?"` — write `"What is your style.*"`.
- **Special chars in matchers**: `?`, `(`, `)`, `+` are regex metacharacters. Escape with `\\` or just append `.*` to the part before them. `text: "Add Destination"` works (no special chars). `text: "Select country / state"` works (slashes are fine). `text: "Skip (anyway)"` would NOT — write `"Skip.*anyway.*"`.
- **Duplicate text in hierarchy**: When you type into a search input, the input's value AND the matching result row both have the same text. `tapOn: text` tap can hit either. Disambiguate with `index: 1` (the input is typically index 0, the row index 1) or use `point:` with bounds from `inspect_screen`.
- **`hideKeyboard` is not universal.** It fails on custom inputs (Google Places autocomplete, react-native-whatsapp-textinput, some date pickers). Fallback: `tapOn: { point: "20%, 12%" }` — tap the screen's top non-interactive area. Avoid percentages between 20–60% if a sheet/modal occupies the middle — you may accidentally hit content.
- **`tapOn` of a disabled button completes silently.** Maestro reports COMPLETED even if nothing happened. To verify a button actually fired, screenshot the screen after the tap and compare — if the same UI is still there, the button was disabled. Then go fill the prerequisite input.
- **Coordinate format**: `point: "X%, Y%"` is screen percentage (device-independent, recommended). `point: "X, Y"` is logical points (the same units as `bounds` in `inspect_screen` output — use when you have exact bounds).

## Phase 3b — Smart input patterns (interact, don't just skip)

This is the most important rule of the skill: **when a screen has interactive inputs you'd normally skip, fill them with meaningful test data first.** The whole point of visual verification is to capture how those inputs RENDER when used, not just their empty/initial state.

The default for every screen with form inputs:

1. Take a `baseline.png` of the screen at rest
2. Interact with each input meaningfully (don't skip)
3. Take a `filled.png` of the screen after interaction
4. Only THEN advance via Next

Default test data — use these unless the prompt says otherwise:

| Input | Default test value |
|---|---|
| Nickname / name | `Test Surfer` |
| Email | `test@swellyo.app` |
| Age / DOB | 28 years old (DOB = today minus 28 years) |
| Country / location | First option in the picker, or `Costa Rica` if free-text |
| Slider (travel experience, surf level) | 50% (middle) |
| Carousel pick (board type) | Swipe through ALL options capturing each, leave second card selected |
| Free-form text | `Verifying with /visual-verify` |

For screens where the "default" CTA is `Skip` (e.g., video upload, destinations, optional fields), **prefer the non-skip path** unless the user said otherwise. The skill's job is to show what the feature looks like USED, not what the bypass looks like.

### Native iOS picker patterns

These are the tricky ones — system pickers, not React Native views — and the patterns below are what unblocks them.

#### Date picker (DOB, trip dates, etc.)

Modern iOS (14+) date pickers default to the **compact text-entry mode**. Try `inputText` FIRST — it works for most modern RN date inputs:

```yaml
- tapOn: { id: "<date-picker-testID>" }
- inputText: "02/14/1997"
- hideKeyboard
- takeScreenshot: .maestro/screenshots/.../dob-filled
```

If `inputText` does nothing (component locked into wheel-only style), fall back to **wheel swipe**:

1. Call `mcp__maestro__inspect_screen` to find the wheel's `bounds` — three wheels (month / day / year), each is a vertical strip.
2. For each wheel, compute the center `(x, y_mid)`. To advance values, swipe from `(x, y_mid + 60)` to `(x, y_mid - 60)` (drag up = newer value). One swipe ≈ 3–5 values.
3. Iterate until the visible value matches the target. Cap iterations at 30 per wheel to avoid infinite loops.

```yaml
- swipe:
    from: { x: 80,  y: 660 }
    to:   { x: 80,  y: 500 }
    duration: 400
- swipe:
    from: { x: 200, y: 660 }
    to:   { x: 200, y: 500 }
    duration: 400
- swipe:
    from: { x: 320, y: 660 }
    to:   { x: 320, y: 540 }
    duration: 400
- takeScreenshot: .maestro/screenshots/.../dob-wheel-set
```

Default target date: 28 years before today (legal-age surfer), formatted MM/DD/YYYY in en-US.

#### Image picker (profile photo, post media, etc.)

The iOS Photos library on the sim is **empty by default** — nothing to pick. Seed it before the run with `xcrun simctl addmedia`. Three placeholder JPEGs ship in the repo at `.maestro/fixtures/`:

- `test-surfer.jpg` — portrait, good for profile picture
- `test-board.jpg` — square, good for board upload
- `test-wave.jpg` — square, good for general post

Seeding is idempotent — re-running just adds duplicates but doesn't break anything. Do it once at the start of any session that will hit an image picker:

```bash
xcrun simctl addmedia booted \
  .maestro/fixtures/test-surfer.jpg \
  .maestro/fixtures/test-board.jpg \
  .maestro/fixtures/test-wave.jpg
```

After seeding, the picker shows the photos. Tap the first thumbnail (typically top-left) and confirm:

```yaml
- tapOn: { id: "<picker-trigger-testID>" }
- waitForAnimationToEnd:
    timeout: 3000
- takeScreenshot: .maestro/screenshots/.../picker-open
# Tap first thumbnail — coords are ~upper-left after the search bar
- tapOn:
    point: "15%, 22%"
- waitForAnimationToEnd:
    timeout: 1500
# Most pickers show Add / Choose / Use Photo to confirm
- runFlow:
    when:
      visible:
        text: "Add|Choose|Use Photo|Done"
    commands:
      - tapOn:
          text: "Add|Choose|Use Photo|Done"
- takeScreenshot: .maestro/screenshots/.../picker-confirmed
```

If the app uses **`react-native-image-crop-picker`** (it does — see `package.json`), the picker is a different sheet: thumbnails fill the screen, and after tapping one the user gets a crop/edit screen. Capture both: `picker-thumbnails`, then `picker-crop-edit`, then `picker-confirmed`.

### System permission alerts

iOS shows system alerts for Photos, Camera, Notifications, Location. Maestro can tap them by text — the wording is stable across iOS versions:

```yaml
- runFlow:
    when:
      visible:
        text: "Allow Access to All Photos|Allow Full Access|Allow"
    commands:
      - tapOn:
          text: "Allow Access to All Photos|Allow Full Access|Allow"
```

Match the broadest one first; iOS has ~6 wordings for Photos alone (Allow Once / Allow While Using / Limit Access / Allow Access to All Photos / etc.). Default for visual-verify: choose the most-permissive option (`Allow Access to All Photos` etc.) so the feature renders fully. Note in the report which alert was answered.

### External flows (Google sign-in, CAPTCHAs)

These are outside the app — Maestro cannot reliably drive them. Strategy:

- **Google / Apple sign-in**: prefer the **demo button** (`welcome-demo-button`) to bypass OAuth entirely. The skill should never try to complete a real OAuth flow.
- **CAPTCHAs**: if one appears, **stop, screenshot, ping the user via `SendUserFile`, and wait for them to solve it manually**. After they confirm, resume. Document the handoff in the session summary.

### Playbook library — verified screen-specific interactions

This is the **library of screens that have been verified end-to-end**. When the user's scope matches one of these, fire the documented YAML directly — you don't need the verify-and-adapt loop.

**When the user names a screen NOT in this list**, fall back to: Phase 2b (read source + classify) → Phase 3 (navigate) → Phase 4 generic verify-and-adapt loop. After the run succeeds, **add a new entry to this library** so the next agent can use it as a playbook. Each entry should be tight: dated, with the exact tap/input sequence, gotchas noted inline.

Update this list as the app evolves — if a screen changes, the playbook may go stale; the verify-and-adapt loop is the fallback.

- **OnboardingStep4DestinationsScreen ("Where have you traveled")**: Do NOT tap `Skip`. Real flow proven 2026-05-29:
  1. Tap `Add Destination` (text matcher) → opens bottom sheet
  2. Tap `Select country.*` → opens `CountrySearchModal`
  3. Tap `Search countries.*` → focuses search input
  4. `inputText: "Indonesia"` (or any surf destination)
  5. `hideKeyboard` (works here — standard TextInput)
  6. Tap result row with `tapOn: { text: "Indonesia", index: 1 }` — **index:1 because the input value also matches "Indonesia"**
  7. Back on sheet, tap `City.*` (places input — placeholder is `City / town / surf spot...`)
  8. `inputText: "Bali"`, wait 2.5s for Google Places autocomplete
  9. ⚠️ `hideKeyboard` FAILS on Google Places input — fallback: tap a non-interactive area like the sheet title at point `"20%, 12%"`
  10. Tap first suggestion: `tapOn: { text: "Bali, Indonesia" }` (Google Places returns "City, Country" format)
  11. Tap `Save` button
  12. Success indicator: destinations carousel shows new card AND the onboarding CTA changes from `Skip` to `Next` (because `hasDestinations === true` in `OnboardingStep4DestinationsScreen.tsx:131`)

- **OnboardingStep2/3Screen carousel (board type, surf level)**: Use the **carousel pattern**: swipe horizontally to each option, capture each. Do NOT just leave the default selected.

- **OnboardingStep3Screen slider (travel experience)**: Use the **slider pattern**: capture at 0/25/50/75/100% via `swipe` to compute positions.

- **OnboardingVideoUploadScreen ("Show Us Your Style")**: This requires picking a video from photos — not automatable without granting Photos permissions and seeding test media. For this screen alone, tap `Skip` is acceptable. Note it in the report.

### Modal / dialog patterns

When a modal appears that wasn't part of the planned flow, handle it per this table:

| Modal text fragment | Action | Reason |
|---|---|---|
| `Sure you want to skip?` | Tap `Go back` (not Skip anyway) | The skill prefers the interaction path. |
| `Allow Swellyo to access ...` (system permissions) | Tap `Allow` | We want the feature to work, not the denial path. |
| Confirmation alert (`Cancel` / `OK`) | Tap `OK` | Proceed with the intent. |
| Network error / Retry | Tap `Retry` once, screenshot, then stop if it fails again | Capture the error state but don't loop. |

For unknown modals: call `mcp__maestro__inspect_screen`, save its hierarchy to the session folder as `unknown-modal-hierarchy.json`, screenshot the modal, and ask the user how to handle it before continuing. Don't guess.

## Phase 4 — Apply the per-type pattern

For each element in scope, reach its initial state then capture the screenshots per the table. Save every PNG into `.maestro/screenshots/visual-verify-<ts>/<screen>/<element-id-or-label>/<state>.png`.

### Pattern table

| Type | States to capture |
|---|---|
| **button** (TouchableOpacity, Pressable, Button) | `before-tap.png`, `after-tap.png` |
| **slider** (Slider, CustomSlider) | `0pct.png`, `25pct.png`, `50pct.png`, `75pct.png`, `100pct.png` |
| **text-input** (TextInput, ChatTextInput, etc.) | `empty.png`, `filled.png`, `keyboard-open.png`, `keyboard-closed.png` |
| **switch** / **toggle** | `off.png`, `on.png` |
| **checkbox** / **radio** | `unchecked.png`, `checked.png` |
| **dropdown** / **picker** / **select** | `closed.png`, `open.png`, `after-selection.png` |
| **modal** / **sheet** / **bottom-sheet** | `before-open.png`, `fully-open.png`, `after-dismiss.png` |
| **tabs** / **segmented** | one screenshot per tab: `tab-<n>-<label>.png` |
| **list** / **flatlist** / **sectionlist** | `populated.png` always; `empty-state.png` if reachable; `scrolled-bottom.png` if scrollable |
| **loading** / **async-state** | `idle.png`, `loading.png`, `loaded.png`, `error.png` (only if you can trigger error) |
| **image-picker** / **upload** | `empty.png`, `with-image.png` |
| **card-carousel** | one PNG per card visible while swiping, max 5: `card-1.png` … `card-5.png` |

### How to implement the tricky ones

- **Slider**: Call `mcp__maestro__inspect_screen` to get the element's `bounds`. Calculate 5 x-coordinates along the bounds (0%, 25%, 50%, 75%, 100% of the width). For each, send `swipe` from the current thumb position to the target x. Screenshot after each. Assume horizontal — if the element looks vertical from `bounds` (height > width × 2), flip to y-axis.
- **TextInput keyboard**: `takeScreenshot empty.png` → `tapOn: { id: <input-testID> }` → `takeScreenshot keyboard-open.png` → `inputText: "Sample 123"` → `takeScreenshot filled.png` → `hideKeyboard` → `takeScreenshot keyboard-closed.png`.
- **Modal**: `takeScreenshot before-open.png` → `tapOn: <trigger>` → `waitForAnimationToEnd: { timeout: 3000 }` → `takeScreenshot fully-open.png` → dismiss (`tapOn: "Cancel.*"` if exists, else `swipe down`) → `waitForAnimationToEnd` → `takeScreenshot after-dismiss.png`.
- **List scrolled-bottom**: Try `scrollUntilVisible` with a known footer id first. If no footer, do 3 `scroll` actions, then screenshot.
- **Tabs**: For each tab label, tap it, `waitForAnimationToEnd`, screenshot.

### The verify-and-adapt loop (default for screens without a playbook)

For documented playbooks (see "Specific feature-level interactions" below), you can fire a pre-recorded YAML and trust it. For **any other screen**, don't fire taps blindly. The cycle is:

1. **inspect** — `mcp__maestro__inspect_screen` (or `~/.maestro/bin/maestro hierarchy`). Read the live accessibility tree.
2. **match** — find your target element by `resource-id` (testID), then `text`, then `accessibilityText`. Verify the selector is unambiguous (no duplicate text from input value + result row).
3. **act** — one tap, swipe, or `inputText`.
4. **verify** — quick screenshot OR `inspect_screen` again. Did the expected state change happen? (new element visible, old element gone, value changed, modal opened/closed).
5. **adapt** — if not, run the failure recovery decision tree below before retrying.

Repeat for every element in your plan. This loop is slower per step than firing a flat YAML, but it's the only safe default for screens that haven't been verified before. After running it once for a new screen, **document the result as a new playbook** under "Specific feature-level interactions" so the next agent can skip the loop.

### State reset between elements

If verifying multiple elements on the same screen, reset state between them: tap back or use `launchApp { stopApp: true }` to restart. Do not let one element's state pollute the next.

### Errors during capture — recovery decision tree

When an interaction fails, pick the right recovery before retrying. Don't just retry the same thing.

```
Failure: "Element not found" / assert failed
├── Did you write the full label as a regex? Check Maestro selector gotchas.
│       Add ".*" suffix; escape ?,(,) or just wrap with ".*".
├── Screen still loading? → extendedWaitUntil with timeout 30000–120000 (cold bundle ≈ 60–90s).
├── Modal blocking the screen? → check the modal/dialog patterns table; dismiss first.
├── Element off-screen? → swipe up/down to find it.
└── testID/text actually different in live tree? → inspect_screen; trust the live tree over the source.

Failure: "tapOn COMPLETED but screen didn't change"
├── Button was disabled. → fill the prerequisite input (text, slider, toggle) then retry.
│       Skill assumption: disabled buttons report COMPLETED but do nothing.
├── Wrong element matched (duplicate text). → use index: 1+ OR point: with exact bounds from inspect_screen.
├── Maestro tapped empty space at matched bounds. → element may have moved during animation; re-inspect.
└── App is in transition. → waitForAnimationToEnd longer (3000–5000ms), then re-inspect.

Failure: "hideKeyboard failed"
├── Custom input (Google Places, react-native-whatsapp-textinput, etc.)
└── Fallback: tapOn: { point: "X%, 10–15%" } — a top non-interactive area like the sheet title or status bar.

Failure: "swipe did nothing"
├── Wrong axis (vertical list mistaken for horizontal carousel). → check bounds height/width ratio.
├── Swipe distance too short. → use direction: LEFT/RIGHT with duration:600 OR point coords with larger delta.
└── Element not focused. → tapOn the element first, then swipe.

Failure: launchApp opened the dev-client launcher (clearState used)
└── Already handled in launch boilerplate — make sure your YAML includes the 3 modal-dismissal runFlow blocks.

Failure: assertion failed but the text is visible in the screenshot
├── Text is split across lines or nodes (e.g., "Where have you" / "traveled?"). → use the first line only with ".*".
├── Text is rendered in accessibilityText not text. → switch matcher.
└── Text is behind a sheet/modal that Maestro considers "covering". → dismiss the sheet first.
```

For any failure, **save the failure screenshot AND the hierarchy** to the session folder before retrying. `<element>/hierarchy-on-failure.json` + `<element>/screenshot-on-failure.png`. Continue with the next element rather than aborting the whole run — partial output is better than nothing.

## Phase 5 — Report

Write `.maestro/screenshots/visual-verify-<ts>/summary.md`:

```markdown
# Visual verify — <feature label>
Date: 2026-MM-DD HH:MM
Platform: iOS Simulator (<device name>)
Scope: <pasted from user prompt>

## Elements

### <element-1 id or label> — <type>
File: <path>:<line>
- `<state>.png` ✓ (or ⚠️ + reason)
- ...

### <element-2 …>
...

## Observations
- Anything notable: slow animation, missing animation, layout shift, off-screen element, etc.

## Reproduce
Inline YAML used for this session (paste full YAML).
```

Then in the chat reply to the user:

1. **One-line summary** of what was verified
2. **List of session screenshots** with their absolute paths (the user's `.maestro/screenshots/` is symlinked into iCloud Drive → they'll appear on their iPhone Files app within seconds)
3. **`SendUserFile` the most informative PNGs** (the first state of each element, plus any with ⚠️) so they show inline in the chat. Cap at 6 PNGs to keep the message clean — list the rest as paths.
4. **Any ⚠️ observations** — call them out at the top, not buried.

## Idioms and conventions

- Use **`mcp__maestro__run`** with inline YAML by default. Only fall back to writing a `.maestro/*.yaml` file + `~/.maestro/bin/maestro test` if MCP is unreachable.
- Always pass a `device_id` to maestro MCP calls (get it from `mcp__maestro__list_devices` once at start of session, cache it).
- For each Maestro screenshot, the path in the YAML is relative to the working directory (`/Users/ohadstorfer/swellyoNative`). Always use the full session-folder path: `takeScreenshot: .maestro/screenshots/visual-verify-<ts>/<screen>/<element>/<state>`.
- TestIDs already in use are documented in `AUTOMATED_TESTING.md` — read that file before navigating to confirm what's available.
- LogBox dismissal is mandatory in dev builds; always include the conditional `runFlow` from Phase 3.
- Do not modify any source files during this skill except (rarely) to add a testID the user explicitly approved.

## Reminders

- This skill is **read-only against the codebase** by default. The only file writes are: screenshots (PNGs), the session `summary.md`, and (optionally, with user approval) a `testID=` addition to a `.tsx` file.
- The Mac may sleep mid-run if the user walks away. Long sessions: assume nothing about wall-clock time; gate on Maestro completion, not timers.
- Token cost: every `takeScreenshot` PNG eventually surfaces in the chat as a path. Only `SendUserFile` the most informative ones inline. List the rest as paths so the user can open them via iCloud Drive on the iPhone.
- If the user invokes `/visual-verify` without an argument and the recent conversation has no clear UI scope, ask first with `AskUserQuestion`. Never start a session without scope.

## What this skill is NOT

- Not a visual-regression tool (no baseline diffing — that's a future skill).
- Not a CI runner (use GH Actions + Maestro Cloud for that).
- Not for verifying business logic (that's `/verify` and tests).
- Not for Android (yet).
