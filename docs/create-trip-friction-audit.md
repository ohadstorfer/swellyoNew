# Create Trip Flow A — Friction Audit
**File audited:** `src/screens/trips/CreateTripFlowA.tsx`
**Entry point:** `src/screens/trips/CreateTripWizard.tsx`
**Subcomponents:** `src/components/trips/CalendarRangePicker.tsx`, `src/components/trips/RangeSlider.tsx`, `src/components/HomeBreakSearchSheet.tsx`
**Service:** `src/services/trips/groupTripsService.ts`
**No design-language-snapshot.md found** — divergences compared manually against `OnboardingStep4Screen.tsx`, `TripDetailScreen.tsx`, `ProfileScreen.tsx`, `ChatScreen.tsx`.

---

## STEP 0: Wizard Entry (CreateTripWizard.tsx)

Not a numbered flow step but is the first screen the user sees. Sits before step 1.

### Inputs inventory
- Three option cards: A / B / C hosting style selector (single-select, tap)
- Cancel button (footer left)
- Next button (footer right)

### UX per input
- Option cards: tap selects, tap again does NOT deselect (no toggle-off). No default selection.
- "Next" fires an Alert if nothing is selected ("Hold on — Please pick a trip type.").
- No description of what A/B/C means in real user language (e.g. "A. Create a group with a general idea", "Loose & collaborative" — insider language, not feature language).

### What works
- Simple gate — user picks intent before seeing the full wizard.
- Hosting style is correctly locked in the DB on create (destination can't be re-selected in edit mode).

### What's rough
- **A and B route to the exact same screen** (`CreateTripFlowA` with `hostingStyle` prop). This is internally consistent but the user just made a "meaningful" choice that has zero visible effect on the wizard they land on. Confusing.
- **Step counter skips** — wizard shows "Step 1 of 5" immediately after the chooser. The chooser itself is not counted, so the user has actually completed 2 screens before the counter starts.
- **No back** from step 0 to the chooser once you're in — `handleBack` at stepIdx===0 calls `onCancel`, which dismisses the entire modal, not "go back to the chooser".
- Option card copy ("Loose & collaborative — many fields can stay fuzzy") uses developer framing. Users think in experiences, not field fuzziness.

---

## STEP 1: Trip Basics (`case 'basics'`)

### Inputs inventory (display order)
1. **Trip name** — TextInput
2. **Cover photo** — TouchableOpacity image picker (opens library)
3. **Destination** — TouchableOpacity picker box (opens `HomeBreakSearchSheet`)
4. **Dates mode** — segmented control (Months / Exact dates)
5a. **Month grid** (months mode) — 12 tappable month cells, range selection
5b. **Exact dates** (exact mode) — `CalendarRangePicker` component
6. **Estimated trip duration** — TextInput with "days" unit box (months mode only)
7. **Trip vibe** — three option cards (Surf-focused / Chill / Mixed), single-select
8. **Age range** — two TextInputs side-by-side (Min / Max)

### Per-input UX
| Field | Label | Placeholder | Keyboard | Validation |
|---|---|---|---|---|
| Trip name | "Trip name" | "e.g. Bali and Barrels" | default | Required, max 28 chars |
| Cover photo | "Cover photo" | icon + "Add cover photo" | — (picker) | Required |
| Destination | "Destination" | "e.g. Uluwatu, Bali" | — (sheet) | Required in create; locked in edit |
| Dates mode | "Dates" | — | — (segmented) | n/a |
| Month grid | (none) | — | — (tap) | Not individually validated — months can both be unset and Next will pass |
| Exact dates | (none) | "Tap dates to set range" | — (tap) | End before start caught on Next |
| Duration | "Estimated trip duration" | "e.g. 10" | number-pad | Required in months mode: must be ≥ 1 |
| Trip vibe | "Trip vibe" | — | — (cards) | Not validated — can skip entirely |
| Age Min | "Age range" | "Min" | number-pad | Required; 16–99; must be ≥16 |
| Age Max | (shared label) | "Max" | number-pad | Required; ≤99; max≥min; range span ≥ ageWindow |

**Validation trigger:** All via `Alert.alert('Hold on', err)` on Next tap.

### What works
- Max length constant (28 chars) is thoughtfully sized to a real example.
- Month range selection logic is correct — auto-swaps if you tap earlier month as second tap (CreateTripFlowA.tsx:390-400).
- Date summary line (`monthLabel` blue text) shows selection clearly.
- Helper text "Tap a month to start your range…" only shows when nothing is selected — disappears when it's no longer needed.
- Age range helper shows the correct minimum span per hosting style (AGE_WINDOW_BY_STYLE, line 128).
- Destination picker uses Google Places with geocoding → persisted to `group_trip_destinations` table on create. High-quality data.

### What's rough
- **Trip vibe is optional but positioned between mandatory fields (dates and age).** No "optional" tag. Users read the form top to bottom and assume everything is required.
- **Duration field (months mode) is a free-text number, not a stepper/slider.** User types "10", unit box shows "days" but those two boxes are not visually connected — they look like separate fields. Looks broken.
- **Month grid has no label.** There's a "Dates" label above the segmented control but nothing labelling the grid itself. After switching to Months, the grid appears with zero instruction context until they select something.
- **Months mode: no validation that the user actually selected months.** Only `durationValue` is validated. A user can leave `monthFrom`/`monthTo` blank, enter a duration, and submit — a trip with no date context is created.
- **Exact dates mode: `CalendarRangePicker` has no guidance** on whether a start-only selection (no end date) is acceptable. The user can tap one day and move on — budget step uses `dayCount=0`, causing a "Missing trip details" budget error.
- **Trip name has no character counter.** Max is 28 but user has no feedback they're close to the limit — it silently stops accepting input.
- **Cover photo has no way to remove/replace.** Once set, tapping the preview re-opens the picker, which is fine, but there's no "remove" affordance and no feedback that tapping on it changes it.
- **Destination is completely locked in edit mode** but the lock is expressed as a greyed-out input with a small helper text ("Destination is locked once a trip is created."). Not prominent enough — a host might expect to fix a typo.
- **Age range validation error ("Please enter an age range.") fires when either field is empty.** This is technically correct but unhelpful — doesn't tell you which one is missing.

### States observed
- Empty: title placeholder visible, photo placeholder visible, destination placeholder visible.
- Partial: months mode with no months tapped — no visual indication anything is wrong until Next.
- Valid: all fields filled — no green/checkmark confirmation.
- Invalid: Alert dialog, no inline error indicators, no field highlighting.
- Loading: none on this step (destination picker has its own loading state).
- Error: Alert only.
- Success: none (just advances to step 2).
- **Missing state:** no inline validation, no "field was touched and is empty" red-border state.

---

## STEP 2: Surf Setup (`case 'surfSetup'`)

### Inputs inventory (display order)
1. **Skill level** — chip row, multi-select (Beginner / Intermediate / Advanced)
2. **Wave shape** — option cards, multi-select (Soft wave / Wally wave / Barrel wave)
3. **Wave size** — `RangeSlider` (1–15 ft)
4. **Surf style** — chip row, multi-select (Shortboard / Mid-length / Soft-top / Longboard), optional

### Per-input UX
| Field | Label | Tap behavior | Validation |
|---|---|---|---|
| Skill level | "Skill level" + "Pick one or more" tag | toggle chip | Required ≥ 1 |
| Wave shape | "Wave shape" + "Pick one or more" tag | toggle card | Not validated (0 is fine) |
| Wave size | "Wave size" (live value shown right) | drag two thumbs | waveSizeMax ≥ waveSizeMin validated |
| Surf style | "Surf style" + "Optional" tag | toggle chip | Optional, not validated |

### What works
- Live wave size value shown right of label ("4–8 ft") updates on every drag — clear feedback.
- Optional tag on surf style sets expectations correctly.
- Multi-select chips are well-suited for a small set.

### What's rough
- **Wave shape uses full-width option cards; skill level and surf style use chips.** Same conceptual pattern (multi-select from a small set), different components. No consistency rule is apparent.
- **Wave shape validation is absent.** You can advance with zero wave shapes selected. The only required field in this step is skill level. This means a host can post a trip with no wave context at all — wave shape seems like it should be required or at least prompted.
- **"Wally wave" is surf jargon.** Most surfers, including intermediates, won't know what "wally" means. No tooltip or further explanation beyond "Walled, fast face — punchy without barreling," which is itself jargon.
- **RangeSlider has no thumb labels.** The current range is shown above the slider, but there's no tick marks, no min/max endpoint labels. Users don't know they can drag to 15 ft without exploring.
- **RangeSlider uses `PanResponder` directly, not `react-native-gesture-handler`.** This means it can conflict with the parent ScrollView's touch handling. On Android, the ScrollView may steal the touch before the slider gets it.
- **"Pick one or more" tags are right-aligned with the label** using a `labelRow` flex row, but the font size (12px, `#B0B0B0`) is very small and low contrast — borderline unreadable at small screen sizes.
- **No "Select all" shortcut** for skill level — a host wanting all levels has to tap three chips.
- **Surf style → `surfStyles.length === 0` falls back to `['all']` on submit** (line 621). The user never sees this — there's no indication that leaving it blank means "all styles".

### States observed
- Empty: chips all deselected, slider at defaults (4–8 ft).
- Partial: some chips selected.
- Valid: ≥ 1 skill level, slider set.
- Invalid: Alert only ("Please pick at least one skill level.").
- Missing state: no inline errors, no visual indication of which field is blocking Next.

---

## STEP 3: Accommodation (`case 'accommodation'`)

### Inputs inventory (display order)
1. **Type** — 9 option cards, single-select (Villa / Hostel / Hotel / Surf camp / Bungalow / Apartment / Guesthouse / Eco lodge / Other)
2. **"Have you clearly selected a stay already?"** — Yes/No gate buttons
3. **(Conditional on Yes) Name** — TextInput
4. **(Conditional on Yes) URL** — TextInput
5. **(Conditional on Yes) Photo** — TouchableOpacity image picker

### Per-input UX
| Field | Label | Placeholder | Validation |
|---|---|---|---|
| Accommodation type | "Type" | — | Not validated (can skip) |
| Lock gate | "Have you clearly selected a stay already?" | — | Required to answer (cannot be null) |
| Name | "Name" | "e.g. Beachfront Villa Uluwatu" | Required if locked |
| URL | "URL" | "https://…" | Required if locked, `url` keyboard type |
| Photo | "Photo" | icon + "Add photo" | Required if locked |

**Lock answer is immutable after create.** In edit mode: `canToggle = false`, unselected gate button gets 0.5 opacity.

### What works
- 9 accommodation options cover the real range.
- "This cannot be changed later" warning under the gate label is explicit and honest.
- Conditional field display (Name/URL/Photo only when Yes) reduces visual noise.

### What's rough
- **9 option cards is a massive vertical scroll.** The step has one visible action (picking accommodation type) plus a mandatory gate question that appears below a wall of cards. The gate question will be invisible on most phones without scrolling, so users won't see it until they scroll past the cards — they may tap Next and get an error they don't understand.
- **Accommodation type is NOT validated.** `validateStep('accommodation')` only checks `accommodationLocked`. A host can submit with no accommodation type at all (null), which persists `null` to `accommodation_type[]`. The type field is labelled "Type" with no "Optional" tag, so users assume it's required.
- **"Have you clearly selected a stay already?" is awkward product-English.** It reads like a form written by an engineer, not a question a host would naturally answer. Something like "Do you have a specific place booked?" is clearer.
- **The gate question is buried below 9 cards.** On a 5" phone, the gate won't be visible at all without scrolling. First-time users will fill out the cards, hit Next, and get an error about a field they never saw.
- **In edit mode, the unselected gate button gets `opacity: 0.5`** but is still rendered. It looks broken/disabled rather than "locked to your original answer." There's no explanation visible other than the original "This cannot be changed later" helper which is always shown (even in edit).
- **URL field has no validation beyond "not empty."** No URL format check. A user can type "villa on the beach" and pass.
- **Photo for accommodation uses the same `pickImage()` function** as hero image, cropping to a 12:5 ratio (landscape). For a villa/hotel photo this is fine, but the crop is silently applied — users don't know their portrait photo will be cropped.
- **The accommodation photo picker is identical in appearance to the hero photo picker** — same icon, same label ("Add photo"), same aspect ratio. No visual distinction.

### States observed
- Unanswered gate (null): no indication this field is blocking Next until Alert fires.
- Gate = No: clean, no extra fields.
- Gate = Yes, fields empty: valid-looking UI until Next triggers Alert.
- Gate = Yes, fields filled: normal.
- Edit mode: gate locked, both buttons dimmed except the current answer — confusing.
- **Missing:** no state shown when the accommodation type is skipped (looks like a required field that the user just didn't fill).

---

## STEP 4: Budget (`case 'budget'`)

### Inputs inventory — happy path (estimate loaded)
1. **Label** — "Estimated budget per person (USD)"
2. **Helper text** — "Pick the tier that fits your trip."
3. **Budget tier cards** — 3 option cards (Budget / Mid-range / Premium), each showing GPT-generated range + label

### Inputs inventory — fallback path (estimate failed or loading)
1. **Error text** — red helper text
2. **Label** — "Budget per person (USD)"
3. **Budget Min** — TextInput
4. **Budget Max** — TextInput
5. **"Retry estimate"** — secondary button

### Loading state
- Full-step loading: `ActivityIndicator` + "Estimating budget…" text, centered, `paddingVertical: 40`. No content visible.

### Per-input UX
| Field | Validation |
|---|---|
| Tier selection | Required if estimate loaded |
| Manual min | Required if estimate not loaded; numeric |
| Manual max | Required; must be ≥ min |

### What works
- Budget estimate fires in the background when the user leaves step 3 (not when they enter step 4). This means the estimate is often ready before the user arrives — good UX.
- Caching by `estimateKey` (destination + duration + accommodation type) avoids redundant API calls on revisit (line 411).
- Fallback to manual entry is well-handled — "Retry estimate" button is present.
- `formatRange` helper gives clean "$1,200 – $2,400" output.

### What's rough
- **If the estimate is loading when the user arrives at step 4, the entire step shows a spinner with no controls.** The user can't go back (Back button is in the footer, which is outside the `renderStep` area — so it IS visible). But the step appears completely locked. No "This might take a few seconds" message.
- **In edit mode, `maybeEstimateBudget` is intentionally skipped** (line 537: `if (step === 'accommodation' && !editMode)`). Edit mode goes straight to manual fallback with prefilled values. The comment explains this, but the user sees the fallback path with no explanation — it looks like an error state.
- **`budgetError` is never cleared if the user updates trip details and retries manually from step 4.** If a budget estimate previously failed and the user entered manual values, then navigated back to step 1 and changed the duration, revisiting step 4 still shows the manual fallback and the old error text (the error persists in state until a successful estimate replaces it).
- **Tier card format** — "Budget · $1,200 – $2,400" — the middle dot is not a standard separator for this pattern. Looks slightly off.
- **No currency selector.** Hardcoded USD. International hosts have no way to indicate local currency. The label says "(USD)" but it's ambiguous whether the estimate is converted to USD or is destination-native.
- **No explanation of what "per person" means** (per day? for the whole trip?). The step header says "Estimated per person, in USD" but that still doesn't clarify the time horizon.
- **`durationValue` is not persisted.** In months mode, the duration input feeds the budget estimate but is `durationValue: ''` on `stateFromTrip` (line 237: `durationValue: '',`). So in edit mode, if the user chose months (not exact), the duration estimate uses `toDays('')=0`, causing the "Missing trip details" error immediately on entering step 4.

### States observed
- Loading: spinner + "Estimating budget…"
- Estimate success: 3 tier cards.
- Estimate failure: error text + manual fields + Retry.
- Tier selected: card highlights.
- Tier not selected: Alert on Next.
- **Missing:** no "estimate changed because you changed trip details" notice.
- **Broken:** edit mode + months mode → always shows fallback with "Missing trip details" error because `durationValue` is not restored.

---

## STEP 5: Preview (`case 'preview'`)

### Inputs inventory (display order)
1. **Preview card** — read-only summary (hero image, title, destination, dates, budget range, skill+vibe chips)
2. **"Visibility & invite"** section title
3. **Visibility** — 3 option cards (Public / Friends / Private), single-select

### Per-input UX
| Field | Validation |
|---|---|
| Visibility | Not validated; defaults to 'public' (line 212) |

### What works
- Preview card gives a genuine sense of what the listing will look like.
- Visibility defaults to 'public' so the user doesn't have to think about it for a typical trip.
- "Publish trip" button copy is clear and action-oriented.

### What's rough
- **Preview card is a custom wireframe card, not the actual trip card component used in `TripsScreen`/`TripDetailScreen`.** It shows different info than what will be displayed on the trip listing. Users see a preview that doesn't match reality.
- **Preview does NOT show wave setup, accommodation type, or surf style** — the fields collected in steps 2 and 3. Host gets no confirmation those inputs were captured.
- **Visibility is defaulted to 'public' without explicitly asking.** The user who skips this step publishes their trip to all users by default. No "are you sure?" friction. A Friends or Private trip requires the user to know to scroll past the preview card to the visibility section.
- **"PREVIEW" kicker text** (uppercase, letter-spaced, grey, line 1264) is pure design filler. It serves no functional purpose — the user already knows this is a preview from context.
- **Wave size, wave shape, and surf style are not in the preview.** The host has no way to confirm those fields were accepted.
- **Preview chip row (line 1277)** shows skill labels + vibe but not wave shapes, surf styles, or accommodation. The chips are cosmetic, not comprehensive.
- **Step subtitle is "Who can see and join this trip?"** — but the majority of the step shows a preview card, not visibility controls. Subtitle is misleading.
- **No confirm-and-edit loop.** Clicking on fields in the preview to jump back to that step to edit is not possible — the only navigation is the Back button.
- **Visibility: `not validated`** — the user can arrive at this step, tap "Publish trip" immediately with the default visibility, without reading the visibility section at all.

### States observed
- Default: public visibility selected, preview rendered.
- Some fields empty: "Untitled trip" fallback for missing title, no fallback text for missing image (just a greyed out box).
- Submitting: button shows `ActivityIndicator` + opacity 0.6, Back is not disabled (line 1322 `disabled={submitting}` on back, but `handleBack` calls `onCancel` at step 0 — it would actually call `setStepIdx(stepIdx - 1)` since stepIdx=4, so Back still navigates back while submitting — not a hard bug but a race condition).
- Error: `Alert.alert('Could not create trip', e?.message)` — dismisses and stays on step 5.
- Success: `onCreated()` is called — navigator handles close.

---

## CROSS-CUTTING CONCERNS

### Progress indicator
- **What it shows:** "Step X of 5" text + thin horizontal fill bar.
- **Position:** fixed top, inside a `paddingHorizontal: 16` container, with `borderBottomWidth: 1`.
- **Fill:** `((stepIdx + 1) / STEPS.length) * 100%` — starts at 20% on step 1, reaches 100% on step 5.
- **Issues:**
  - Counts from 1 on the first step, which means the bar is already 20% full before the user has done anything. Counter starts at "Step 1 of 5" not "0 of 5".
  - No step names shown — user can't tell what's coming or how much work step 4 is vs step 2.
  - No animation on fill — bar jumps to new width on step change, no transition.
  - No indicator on the Wizard chooser screen (step 0) — so the chooser step is uncounted.

### Footer navigation
- **Layout:** 1:2 flex ratio — Back/Cancel (left, grey) and Next/Continue/Publish (right, teal).
- **Label changes:**
  - Step 0: Cancel + Next
  - Steps 1–3, 5 Back + Next
  - Step 4 accommodation: Back + Continue (line 1341: `step === 'accommodation' ? 'Continue' : 'Next'`)
  - Step 5: Back + "Publish trip" (create) / "Save changes" (edit)
- **Issues:**
  - "Continue" vs "Next" inconsistency: step 3 (accommodation) says "Continue" for no clear reason. All other steps say "Next".
  - Back at step 0 cancels the whole modal — there's no way to return to the chooser screen from within the wizard. This is a permanent navigation dead end.
  - The Back button is not disabled during submission (line 1322: `disabled={submitting}` only on the primary button). Tapping Back during image upload would navigate back while the upload is in flight.
  - No "X" / close button anywhere in the flow. The only dismiss is Back/Cancel which requires multiple taps from deep in the flow.

### Keyboard behavior
- **No `KeyboardAvoidingView` anywhere in the wizard.** The root `View` (`styles.root: { flex: 1 }`) has no keyboard avoidance.
- The parent `ScrollView` has `keyboardShouldPersistTaps="handled"` — this prevents tap-dismissal of the keyboard when tapping non-interactive areas, which is correct for keeping keyboard open on option card selection.
- On iOS, bottom inputs (age range on step 1, budget min/max on step 4) will be completely covered by the keyboard. The ScrollView will need to be scrolled manually to see the inputs.
- No `KeyboardAwareScrollView` (which `OnboardingStep4Screen.tsx` uses) — this is a direct regression from how the rest of the app handles keyboards.
- No auto-focus on first field when a step opens.
- No `returnKeyType="next"` on any inputs — keyboard "done" button dismisses rather than advancing focus.

### Scroll behavior
- **Footer is fixed** (`View` outside `ScrollView`, not sticky inside). Correct pattern.
- **No scroll reset on step change.** If you scroll to the bottom of step 1 (age range) then tap Next, step 2 opens mid-scroll. User lands in the middle of the surf setup content, not at the top.
- **Step 3 (accommodation) scroll issue is critical.** 9 option cards + gate question will extend far below the fold. No scroll hint, no sticky headers, no "tap to expand" pattern.
- **`contentContainerStyle: { padding: 16, paddingBottom: 32 }`** — 32px bottom padding is not enough when the footer is ~64px tall. On some phones, the last field on a step may be partially obscured by the footer.

### Validation flow
- **100% Alert-based.** No inline errors. No field-level red borders or error text.
- Alert fires on Next tap — not on blur, not on field exit.
- Alert dialogs use "Hold on" as the title on every step, every error. No differentiation.
- **Only one error shown at a time.** If three fields are invalid, user must go through three separate Next-tap/Alert/dismiss cycles to find all errors.
- Age range validation fires multiple checks in sequence but only one Alert total — the first failing check wins (line 485-490). Fine, but no highlighting to show which field.
- `accommodationLocked === null` fires the Alert "Please answer if you have a stay selected." but the gate button is buried below 9 cards. The user has no idea where this field is.

### Loading states
- **Budget estimate:** `ActivityIndicator` + text, replaces entire step content. Back button still accessible.
- **Image upload (submit):** `ActivityIndicator` replaces primary button text. No upload progress. No per-image progress (hero + accommodation photo upload sequentially — if hero succeeds but accommodation fails, the error message is "Failed to upload hero image" — wait, no: the error message on accommodation failure is whatever `accRes.error` says, which may be blank → no error thrown, `accommodationImageUrl` stays null. This is a **silent partial failure** (line 580: `if (accRes.success && accRes.url) accommodationImageUrl = accRes.url;` — no error thrown).
- **Submit:** sets `submitting=true`, disables primary button, shows spinner in button. Back button not disabled — race condition possible.
- **Destination resolve (HomeBreakSearchSheet):** `ActivityIndicator` inside the suggestion row. Well-handled.

### Error states
- **Budget estimate failure:** shows red helper text + manual fields + Retry button. Good.
- **Network error on submit:** `Alert.alert('Could not create trip', e?.message)`. Generic. No retry from the same state.
- **Image upload failure for accommodation:** silently fails (see above). Trip creates but accommodation image is missing — no user feedback.
- **Missing API key for Google Places:** HomeBreakSearchSheet shows "Places API key missing" as an error string. Raw engineering error message exposed to user.
- **Bad budget estimate response shape:** throws "Bad estimate response" — user sees this raw string in the manual fallback.

### Edit mode
- **Destination locked** — input is greyed out with a helper text. Clear but low prominence.
- **Accommodation lock answer is immutable** — the gate buttons are disabled but both are rendered with opacity 0.5 on the non-selected one. This looks like a rendering bug rather than intentional locking.
- **Budget in edit mode always goes to manual fallback** — even if the trip was created with a GPT estimate. `budgetEstimate: null` on `stateFromTrip()`. The host has to re-enter numbers manually every time they edit.
- **`durationValue` is not restored in edit mode** — it's `''` always (line 237). This is fine for exact-date trips, but for months-mode trips it means the budget step shows "Missing trip details" on load.
- **Hero image: if the existing trip has a remote URL, it's correctly treated as already-uploaded** (line 562: `isRemoteUrl`). No re-upload. Good.
- **`waveShapes` is restored from edit** — the new `wave_shapes` column is correctly read back (line 243).

### Subcomponent assessments

#### CalendarRangePicker (`src/components/trips/CalendarRangePicker.tsx`)
- Functional and visually correct (range rail + endpoint circles).
- **Collapse/expand toggle** — the calendar is hidden by default behind a date-summary pill (line 98-108). This is the right pattern.
- **No keyboard interaction** — pure tap. Fine.
- **Month navigation arrows have no min/max bounds.** A user can navigate back to past months and try to select past dates — they're shown as disabled (grey) but the calendar keeps going back. Should clamp at current month.
- **Day-of-week header labels** are single letters: `['S', 'M', 'T', 'W', 'T', 'F', 'S']` — two "T" labels (Thursday/Tuesday). Standard pattern but can be confusing on small screens.
- **Range summary format** ("Jan 5 – Jan 12 · 8 days") is clean and includes day count. Better feedback than the rest of the app provides.
- **Tap to start fresh** — if a full range is set, tapping any date starts a new range from scratch. Not discoverable; no instruction.
- **No swipe to navigate months** — only left/right chevron buttons.
- **Visually cohesive** with the rest of the wizard (same `#0788B0` endpoint color) but uses different font family (system, not `Montserrat`/`Inter` like the rest of the app).

#### RangeSlider (`src/components/trips/RangeSlider.tsx`)
- **Uses `PanResponder` directly** — not `react-native-gesture-handler`. High chance of scroll-steal conflict on Android.
- **No labels** at min or max ends of the track. Users won't know the range is 1–15 ft.
- **Thumb size is 26px** — on the small side for a touch target. Apple HIG recommends minimum 44pt; Google Material recommends 20dp+. 26px is borderline.
- **No accessibility:** no `accessibilityRole`, no `accessibilityLabel`, no `accessibilityValue`. Cannot be used with VoiceOver/TalkBack.
- **`measureNow` is called on each `onPanResponderGrant`** — correct approach to handle parent scroll position. But the async `measure()` call means there's a one-frame race on grant. Usually fine but could cause a tiny jitter on first touch.
- **No haptic feedback** on value snapping.

#### HomeBreakSearchSheet (`src/components/HomeBreakSearchSheet.tsx`)
- Full bottom sheet with animation, swipe-to-dismiss, Google Places autocomplete, and map preview.
- **Visually the most polished component in the flow.** Uses the app's theme colors, `Montserrat`/`Inter` fonts, `spacing` constants from `src/styles/theme.ts`.
- **Confirm button says "Save" (line 408).** The wizard's own confirm copy is "Confirm destination" (the `confirmTitle` prop passed from CreateTripFlowA, line 1349). The button inside the sheet hardcodes "Save" — these two don't align.
- **Map preview requires Google Maps API key** — not the same key as Places autocomplete. If `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` is set but the Maps JavaScript API isn't enabled for that key, the map silently fails and shows the fallback (map-outline icon + "Map unavailable for this place"). Likely to hit in dev/staging.
- **"Powered by Google" attribution** at the bottom is a mandatory requirement; good that it's included.
- Sheet height is 80% of screen (`SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.8)`) — fixed at mount time, does not respond to device rotation.

---

## DIVERGENCE LIST
(Compared against `OnboardingStep4Screen.tsx`, `ProfileScreen.tsx`, `TripDetailScreen.tsx`, `ChatScreen.tsx`, and `src/styles/theme.ts`)

| # | Where | Current flow | Rest of app |
|---|---|---|---|
| 1 | **Font family** | All text uses system font (no `fontFamily` set in StyleSheet). | `OnboardingStep4Screen`, `ProfileScreen`, `HomeBreakSearchSheet` use `Montserrat` (headings) and `Inter` (body) explicitly. |
| 2 | **Keyboard handling** | No `KeyboardAvoidingView`. | `OnboardingStep4Screen` uses `KeyboardAwareScrollView` from `react-native-keyboard-aware-scroll-view`. |
| 3 | **SafeAreaView** | Not wrapped in `SafeAreaView`. Root is a plain `View`. | `TripDetailScreen`, `ProfileScreen`, `TripsScreen` all use `SafeAreaView` or `useSafeAreaInsets`. |
| 4 | **Text component** | Uses raw RN `Text`. | Rest of app imports `Text` from `../components/Text` (the custom wrapper that handles fonts). |
| 5 | **Primary button color** | `#0788B0` (brand teal). | `HomeBreakSearchSheet` confirm button uses `#212121` (near-black). Different CTA color within the same flow. |
| 6 | **Error handling** | Alert dialogs only, titled "Hold on". | No other screen in the audited set uses Alert for form validation — they use inline error states or toast-style messages. |
| 7 | **Input style** | `borderWidth:1, borderRadius:10, fontSize:15, color:#222B30`. | `OnboardingStep4Screen` uses `react-native-paper`'s `TextInput` with a different outline and focus state. |
| 8 | **Heading size** | `fontSize: 22, fontWeight: '700'` (line 1377). | `OnboardingStep4Screen` headings use `typography.titleLarge` (24px/700). 2pt discrepancy. |
| 9 | **Scroll reset on step change** | None — scroll position carries over between steps. | Not an explicit app pattern but is the expected behavior for any multi-step form. |
| 10 | **Loading state during image upload** | Button spinner only, no per-image progress. | `OnboardingStep4Screen` uses `GalleryPermissionOverlay` + upload progress indicators. |
| 11 | **Back navigation** | Back at step 0 = full cancel. No return to chooser screen. | Standard navigation in the rest of the app: back always goes to the previous screen. |
| 12 | **Accessibility** | No `accessibilityRole`, `accessibilityLabel`, or `accessibilityHint` on any interactive element. | Not consistent elsewhere either, but `OnboardingStep4Screen` uses `accessible={true}` on some tap targets. |
| 13 | **`HomeBreakSearchSheet` confirm button** | "Save" (hardcoded in the component). | `confirmTitle` prop is "Confirm destination" — passed correctly but button label ignores it. |
| 14 | **Option card border radius** | `borderRadius: 12` (line 1481). | `CreateTripWizard.tsx` option cards also use `borderRadius: 12`. Consistent within trip flow, but onboarding uses `borderRadius.medium = 16` from theme. |
| 15 | **Progress bar color** | `#0788B0`. | `src/styles/theme.ts` defines `progressFill: '#333'`. Inconsistent with global theme token. |

---

## HIGH-PRIORITY BUGS (not design issues — actual broken behavior)

1. **Edit mode + months dates → budget step always errors** (`durationValue` not restored, `toDays('')=0`). File: `CreateTripFlowA.tsx:237`.
2. **Accommodation image upload failure is silent** — trip creates but image is lost with no user feedback. File: `CreateTripFlowA.tsx:578-581`.
3. **Back button not disabled during submission** — navigating back during image upload leaves upload in flight, `onCreated` or error handler may fire after the component is unmounted. File: `CreateTripFlowA.tsx:1322`.
4. **Months mode with no months selected passes step 1 validation** — only `durationValue` is required, not `monthFrom`/`monthTo`. File: `CreateTripFlowA.tsx:474-492`.
5. **`RangeSlider` scroll-steal on Android** — uses `PanResponder` not `react-native-gesture-handler`. File: `src/components/trips/RangeSlider.tsx:85`.
