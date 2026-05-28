# Wizard UX Research — Create a Group Surf Trip

Researched May 2026. Covers 12 design areas for the 5-step "create a group surf trip" flow.
Steps are: **basics** → **surfSetup** → **accommodation** → **budget** → **preview**.

---

## 1. Step Indicators

### Pattern types and when each works

**Fraction counter ("Step 2 of 5")**
Used by: Shift (automotive test drives), N26 (banking account setup), Blinkist onboarding. Best for 3–7 steps with variable content density per step where you want minimal chrome. It consumes almost no vertical space — critical on mobile. Disadvantage: users have no preview of what step names mean, so they can't mentally pre-load what info they'll need. When your steps are self-explanatory through their content headings (see Section 8), the fraction is enough.

**Thin top progress bar (no step labels)**
Used by: MyInterview (recruitment wizard), Duolingo language onboarding. Best for flows that feel more like a journey than a checklist — no explicit count means less anxiety about how many steps remain. MyInterview documented a 90% reduction in candidate drop-off after switching from a labeled stepper to a thin fill bar. Tradeoff: users who are halfway and realize they have no idea how much remains will feel lost. Works best when steps are short and the bar fills fast enough to feel rewarding.

**Named horizontal stepper (all step names visible)**
Used by: Amazon customer service, Tripadvisor tour booking, Urban Outfitters checkout. Best for task-oriented flows where users may need to go back and correct a specific section. Named steppers let users jump directly to "Accommodation" rather than hitting Back three times. Expensive in horizontal space — only works when you have 3–5 steps with short names, and names that mean something without being seen in context.

**Dots (unlabeled)**
Used by: typical onboarding carousels (Instagram, TikTok). Best only for 3–5 purely informational swipe-through screens. Should not be used for a creation wizard — dots do not communicate which step you are on in a way that gives progress feedback, and they provide no sense of distance to the end.

**Hybrid: thin bar + "Step X of Y" label**
Used by: Whatnot (marketplace seller setup), Monarch (fintech onboarding). Combines the fill-reward of a bar with the explicit position of a fraction. This is the default of NN/g, Smashing Magazine, and PatternFly. The bar goes at the top; the label sits in the step header area or near the primary button. This is the most widely recommended pattern for 5–10 step flows on mobile.

### Recommendation for Swellyo

Use a **thin top bar + step counter label embedded in the step heading**. The bar (4–6 dp tall, brand color, full screen width) fills as steps complete and gives a visceral sense of forward progress. The label should appear as secondary text above the main heading, formatted as "Step 2 of 5" in small muted type — not as a separate UI block. Do not use a named horizontal stepper: five step names at the top of a mobile screen on iOS will clip or require 11pt text. Do not use dots — this is a creation flow, not an intro carousel. The fraction label tells a host exactly how far they are; the bar rewards each completion. This matches what Blinkist, Whatnot, and Monarch do.

---

## 2. Forward/Back Navigation

### Sticky footer button bar vs floating buttons

PatternFly, Smashing Magazine, and NN/g all agree: the navigation bar should be **fixed at the bottom** of the viewport (sticky footer), never scrolled away. This is non-negotiable on mobile — if the primary action scrolls out of view, completion rates drop. The standard layout is: **Back** (left, secondary style) and **Next / Continue** (right, primary filled button). They must stay in the same physical position across all steps so users build a muscle rhythm.

LinkedIn profile setup, Bumble onboarding, and Airbnb's listing wizard all use the sticky footer pattern. Airbnb's listing creation flow has "Back" and "Next" as the persistent footer pair throughout all three of its main sections, with "Save & exit" as a tertiary text link top-right.

**Back button placement**: left side of the footer. Never in the header as a back-arrow alone, because on mobile the header back arrow competes with the system navigation gesture and feels ambiguous about whether "back" means "previous step" or "leave the wizard."

**Cancel / exit**: Airbnb uses "Save & exit" as a top-right text button. Eventbrite and LinkedIn use an "X" in the top-left corner. The UX difference is meaningful: "X" communicates "close and discard," while "Save & exit" communicates "I'm keeping your work." For a creation flow with meaningful work invested, "Save & exit" is strictly better. PatternFly's design guidelines explicitly state that closing a wizard should trigger a discard-confirm modal.

**Discard-confirm prompt**: show a bottom sheet or modal when the user taps "X" or the OS back gesture, with two options: "Save draft" (primary) and "Discard" (destructive, red). The copy on the modal should name what they lose: "Discard your new trip? Any details you've entered won't be saved." Never use generic "Are you sure?" — that wording is identified in multiple NN/g studies as low-signal friction.

**"Next" button label**: prefer action-specific labels over generic "Next" — for example: "Add surf setup →", "Lock in accommodation →", "Set budget →", "Publish trip". Descriptive labels reduce anxiety about what comes next. However, "Continue" is acceptable when the step has no single obvious action label. Do not use "Submit" or "Proceed."

### Recommendation for Swellyo

Sticky footer with "Back" (ghost/outline) and a labeled primary CTA on the right: "Set up surf →", "Add accommodation →", "Estimate budget →", "Publish trip". On Step 1 (basics), hide the Back button — show nothing on the left, or show the "Save & exit" draft action there. Add "Save & exit" as top-right header text from Step 2 onward. Trigger a discard-confirm bottom sheet on exit if any field has been touched.

---

## 3. Validation Patterns

### Timing tradeoffs in a wizard context

Four common approaches, with tradeoffs:

**Inline as-you-type**: validates every keystroke. Best for password strength bars or character counters. Harmful for names, destinations, or any free text because it fires error states before the user has finished thinking. Smashing Magazine (2018) cites a 22% success rate increase and 42% decrease in completion time for inline validation — but this applies to *post-touch* inline, not while-typing.

**On-blur (after leaving the field)**: fires when the user tabs or taps away from an input. This is the community consensus best practice for text fields in forms. It catches errors immediately after the user has finished a thought, before they move on. Timing window: 500–1000ms after typing stops or immediately on field blur. This is what Airbnb and Bumble use for their profile fields.

**On-next (step-level validation)**: validates the entire step's required fields when the user taps "Next." Fires an error scroll to the first invalid field with an inline error message. This is the right approach for multi-step wizards where steps have heterogeneous field types (toggles, multi-selects, sliders, pickers) that can't meaningfully validate on blur. PatternFly, Smashing Magazine, and the Reform.app navigation guide all recommend on-next for wizard steps.

**Disabled-until-valid "Next" button**: disables the CTA until all required fields are filled. The UX research is split. Adrian Roselli (accessibility advocate) and Smashing Magazine both argue against disabled buttons because autofill/paste inputs don't always trigger onChange and the button stays disabled despite the form being complete. The counter-argument (UX Pickle, PatternFly) is that a disabled button with a visible reason is better than a tap that leads to an error scroll. A middle ground: keep "Next" always tappable, but show a subtle indicator ("3 required fields missing") near the button before the user taps it — then fire on-next validation with a scroll to the first error.

**Error messages**: always inline, immediately below the field. Never a banner at the top. Language: human, specific, actionable. "Your trip title can't be blank" not "Required field." "Select at least one skill level" not "Invalid selection."

### Recommendation for Swellyo

On-blur for text inputs (trip name, accommodation URL, name). On-next for everything else (selectors, sliders, multi-picks, photo). Never disable the Next button silently — instead, show a light badge ("2 fields needed") near the CTA when required fields are incomplete, then scroll to the first error on tap. The accommodation step has a yes/no gate that unlocks sub-fields; validate those sub-fields only when the gate is "yes." The budget step should never block Next even if GPT estimate fails — the manual fallback is the fallback.

---

## 4. Save and Resume

### How top wizards handle partial state

Appmaster.io's definitive save-and-resume guide (2024) and the Reform.app navigation guide both recommend the same approach: create a draft record as soon as the user completes the first meaningful action (tapping "Next" on Step 1) rather than on first screen load (which creates empty draft pollution). Store `current_step` and `updated_at` alongside the field data. For signed-in users, this means a `group_trip_drafts` table or a `status: 'draft'` flag on `group_trips`.

**Signaling restored state to users**: the community strongly agrees on explicit signaling rather than silent restoration. Show a small "Draft restored" toast at the top of Step 1 when opening a draft, and display a tiny "Saved" timestamp indicator near the bottom footer ("Last saved 2 min ago"). This is what Airbnb does in their listing editor. Avoid silently opening to Step 3 without telling users where they are — they need a moment to re-orient.

**"Save & exit" vs "Finish later"**: "Save & exit" is the Airbnb/LinkedIn phrasing; "Finish later" is what Reform.app and Appmaster.io recommend because it implies the work is in progress and worth returning to, rather than implying a clean close. Either works — the key is that it appears as a tertiary text link at the top of every step, never hidden.

**Auto-save**: save field values to AsyncStorage (already the pattern in Swellyo's onboarding form) on every step transition (not every keystroke). Commit to the DB on "Save & exit" and on each "Next" tap if a trip ID exists.

### Recommendation for Swellyo

Create a `status: 'draft'` group_trip row on first "Next" tap from Step 1. Persist each step's data on transition. When the user returns to the "Create trip" flow and a draft exists, show a resumption screen before Step 1: "You were building a trip to [destination or 'unknown destination'] — Step 2 of 5 was next. Continue or start fresh." Use the existing AsyncStorage pattern from onboarding as the local fallback. Show a "Saved · just now" micro-label in the footer area.

---

## 5. Skip vs Require

### When optional fields should be skippable

NN/g's wizard article states that optional steps "should be clearly marked and skippable without impeding progress." Smashing Magazine (2018) recommends marking optional fields with an explicit "(optional)" label — not an asterisk on required fields (which is the old convention) — because on most screens, the majority of fields are required and the asterisk system inverts expectations.

The reform.app guide recommends: "Only include what's absolutely necessary. Remove any optional fields or steps that could clutter the experience." This means surfacing optional fields conditionally — only after the core required path is complete, or tucked behind a "Add more details" disclosure.

**"Skip for now" vs omission**: show a "Skip for now" text link below optional field groups, not a footer-level button. Duolingo uses this pattern extensively — the skip action is present but subordinate, below the primary CTA. Do not offer skip on required steps.

**Visual treatment of optional**: "(optional)" in lighter gray text next to or below the field label. The word "optional" should appear on the field group label, not per-field when an entire section is optional.

### Recommendation for Swellyo

**Step 2 (surfSetup)**: wave shapes, wave size, and surf style are skippable as a group — show a "Skip this step" text link below the step's content for the entire step (since a host with beginner-level guests can reasonably say "any wave works"). Skill level is required (at least one). Show "(optional)" near the surf style section header.

**Step 3 (accommodation)**: the yes/no gate on "locked in a stay?" determines whether name/URL/photo sub-fields appear. Sub-fields are required only when the gate is "yes." If "no," the step is complete with just the accommodation type selected. The type itself is required.

**Step 5 (preview)**: visibility selection is required before submitting. The card preview is not an input — it has no skip.

---

## 6. Step Transitions

### What the community recommends for React Native

React Navigation's native stack and its `animation` prop support: `slide_from_right` (iOS default), `fade`, `fade_from_bottom` (Android default), `none`. Custom transitions via `transitionSpec` are possible but add complexity.

The consensus from the React Native and Expo community (2024–2026):

- **Horizontal slide** (left → right for Next, right → left for Back): this is the iOS system paradigm. Users immediately understand "next step is to the right." It also allows the back swipe gesture. This is what Tinder, Bumble, and LinkedIn profile setup use. It matches the mental model of a linear flow.
- **Fade**: good for non-linear navigations (tab switches, modals), but in a wizard it removes the sense of directionality — users lose the spatial model of "I am moving forward."
- **No transition**: the fastest but feels abrupt. Acceptable only when each step fills the entire screen with a new visual (photo-heavy steps where the content itself creates the transition effect).
- **Fade from bottom (modal-like)**: appropriate for the preview/publish step (Step 5) to signal this step is different in nature — it's a confirmation, not another input step.

**Shared Element Transitions (Reanimated v3)**: still marked experimental as of 2025. Not recommended for production wizard flows.

**Performance note**: horizontal slide via React Navigation's native-stack (`animation: "slide_from_right"`) is GPU-accelerated and the most performant option on both platforms. Never implement custom Animated.Value-based slide transitions for wizard steps — they jank on Android.

### Recommendation for Swellyo

Use React Navigation's native-stack `animation: "slide_from_right"` for all step transitions (Steps 1→2→3→4). For the Back direction, use `animation: "slide_from_left"` by overriding on the Back tap. For Step 5 (preview), use `animation: "fade_from_bottom"` to signal the modal-confirm nature of the final step. Do not use custom Reanimated transitions for step slides — they are not worth the performance risk.

---

## 7. Information Density

### One big scroll vs broken into sub-steps

Smashing Magazine (2024) and multiple wizard guides recommend no more than **4–5 fields per step** on mobile. The Reform.app guide recommends going further: group by conceptual theme and keep each step to a single decision type. NN/g states: "The advantage of a wizard is that it allows users to focus on one task at a time."

**When to scroll within a step**: acceptable when fields are tightly related (e.g., Step 2's surf setup: skill levels + wave shapes + wave size + surf style all belong together conceptually). Long within-step scroll is better than splitting a single conceptual group across two steps, which forces Back navigation just to see related decisions.

**When to split into sub-steps**: when a decision is a gateway to more fields (Airbnb does this for accommodation: type first, then specific details). When the content of a step is so dense that it fills more than 2.5 screens of scroll, consider a sub-step rather than infinite scroll.

**Airbnb's model**: three macro-sections (About your place / Make it stand out / Finish up), each macro-section containing several short screens. Within each macro-section, screens are very short — typically 1–3 inputs. This is what Smashing Magazine calls "staged disclosure."

**Tinder / Bumble / Hinge onboarding**: the gold standard for mobile density. Each screen contains one question. The screen height is entirely used for the question heading + answer options. No scrolling within a step. Works because each input type is a tap-select, never a long text field.

### Recommendation for Swellyo

Step 1 (basics) has the most fields — title, cover photo, destination, dates mode, date range/months, duration, vibe, age range. This is 6–8 distinct inputs on a mobile screen and will scroll. This is acceptable because they are all conceptually "what is this trip?" However, consider splitting the dates section (datesMode selector + actual date inputs) into a visually distinct sub-group within the scroll, not a separate step. Steps 2–4 should each be dense enough to require scrolling only for Step 2's multi-selects. Step 5 (preview) should be the fullest scroll — showing the full trip card preview plus visibility selection.

---

## 8. Step Headers

### Large title + subtitle vs field labels only

The dominant pattern across top-performing creation flows (2023–2025):

**Duolingo, Bumble, Hinge onboarding**: every screen has a large (24–28sp) centered heading phrased as a question or directive: "What's your name?", "How would you describe your surfing?", "What's your vibe for this trip?". Below it: a short (13–14sp) subtitle explaining why the question matters or what good looks like. Inputs appear below. No step counter in the heading area — the heading IS the information.

**Airbnb listing creation**: large left-aligned section title ("Your place's potential") with a short subtitle ("Hosts with more details get up to 20% more bookings"). This is more marketing-oriented. The heading sets context; the inputs follow.

**LinkedIn profile wizard**: action-verb heading ("Add your work experience") with no subtitle. Direct, functional. Works for a professional context.

**PatternFly / enterprise wizards**: title + subtitle in a header band, separate from content. This is fine for desktop but wastes precious mobile vertical space.

The community consensus for mobile: **large, conversational heading (24sp minimum, left-aligned or centered) + optional short subtitle (13–14sp, lighter color)**. The heading replaces the need for a step name in the stepper — users orient from the heading, not a "Step 2 of 5 — Surf Setup" label. The fraction counter is secondary identity; the heading is primary.

**Tone**: the travel and social creation space uses warm, first-person plural framing: "What waves are you chasing?" not "Select wave parameters." "Where are you heading?" not "Destination." Airbnb's wizard uses low-key motivation ("Your place stands out more with details"). Tinder/Bumble use plain direct questions.

### Recommendation for Swellyo

Each step should have a large (24–26sp, semibold) conversational heading + one-line subtitle. Suggested headings:

- Step 1: "Plan your trip" / "Start with the basics — name, destination, and when."
- Step 2: "What waves are you chasing?" / "Tell surfers what to expect in the water."
- Step 3: "Where will you stay?" / "Accommodation type shapes who joins."
- Step 4: "What's the budget?" / "We'll estimate — you confirm."
- Step 5: "Here's your trip" / "Review it, choose who can see it, then publish."

Place the "Step X of 5" fraction in small muted text (12sp, gray) immediately above the heading, not below it. This matches the Blinkist and Monarch pattern.

---

## 9. Final Preview / Review Patterns

### Full card preview, summary list, or both?

PatternFly's design system states the final step must always be labeled "Review" and must "present a summary of choices made throughout the wizard." The two dominant implementations:

**Full rendered preview (Airbnb-style)**: shows the actual listing card exactly as it will appear to guests. This is what Airbnb does before publishing. It is high-confidence: the host sees exactly what travelers will see. The cost is implementation complexity — you must render the full card in read-only mode within the wizard.

**Editable summary list (Eventbrite-style)**: a list of key-value pairs (Title: "Bali Barrel Hunt", Destination: "Canggu, Indonesia", Skill levels: "Advanced, Pro", etc.) with inline edit icons per row. Lower implementation effort; higher information density. Eventbrite uses this for event creation. The weakness: it doesn't show the real visual output.

**Both (Tinder / dating app approach)**: show the rendered profile card first, then below it, a section of editable summary rows for fields that didn't fit the card (e.g., visibility, privacy settings). This is the best of both — the emotional validation of "here's what it looks like" plus the completeness of a summary.

**The "empty state" problem**: PatternFly recommends that if the preview step involves a backend process (e.g., AI budget estimation, image processing), embed a progress bar in the step rather than blocking the user on a loading screen between steps.

### Recommendation for Swellyo

Show the actual trip card exactly as it will appear in the trips feed, with all filled fields rendered as they would display. Below the card: a compact two-column summary grid of the key values that don't fit the card (wave shapes, skill levels, age range, accommodation type). Below the summary: the visibility selector (public / friends / private) as three tappable cards. The "Publish trip" CTA is at the bottom. If the budget step's GPT estimate is still loading on arrival at Step 5, show an inline shimmer in the budget row of the summary grid, not a full-screen loader.

---

## 10. Keyboard Avoidance During Wizard Scroll

### Best practices for React Native + Expo specifically

This is the most technically volatile area — advice that was correct for Expo SDK 52 may be wrong for SDK 54.

**The core problem**: in a wizard with a sticky footer (Next button), when a keyboard appears, the sticky footer must move up with the keyboard. `KeyboardAvoidingView` with `behavior="padding"` handles this on iOS but fails on Android with edge-to-edge enabled (Expo SDK 54 default). The result: the "Next" button is hidden behind the keyboard.

**What doesn't work (SDK 54)**:
- Wrapping the footer inside `KeyboardAvoidingView` on Android: the edge-to-edge inset system means the footer stays at the bottom of the screen, behind the keyboard.
- `softwareKeyboardLayoutMode: "pan"` in app.json: adjusts the whole screen, not the footer independently.
- APSL's `react-native-keyboard-aware-scroll-view`: its sticky footer support is broken — there are open GitHub issues (#437, #527) confirming the footer doesn't lift above the keyboard.

**What works**:
- **`react-native-keyboard-controller`** (already in the project per agent memory): its `KeyboardAwareScrollView` with `bottomOffset={footerHeight}` lifts scroll content so the focused input appears above the footer and keyboard. The footer itself must be positioned outside `KeyboardAwareScrollView` and use `useKeyboardHandler` or `useReanimatedKeyboardAnimation` to animate its translateY up with the keyboard. This is the same library the project already uses for chat keyboard sync.
- **Architecture pattern**: wrap each wizard step in `KeyboardAwareScrollView` for the scrollable content. The sticky footer lives outside, as a sibling, not inside the scroll view. The footer's bottom offset is driven by `useSafeAreaInsets().bottom + keyboardHeight`.
- **Android-specific**: `react-native-keyboard-controller` handles Android edge-to-edge correctly as of v1.12+. It uses the `WindowInsetsCompat` API internally, which is the right approach for SDK 54.

**Common pitfalls**:
- Nesting `KeyboardAvoidingView` inside a `ScrollView`: causes double-adjustment jank (documented in Expo keyboard handling guide).
- Using `KeyboardAvoidingView` inside a React Navigation modal: the modal's separate view hierarchy breaks the height calculation.
- Forgetting to add `bottomOffset` equal to the footer height: the focused input lands exactly at the keyboard top, clipped by the footer.

**Per-step advice**:
- Step 1 has many text inputs (title, destination). Use `KeyboardAwareScrollView` throughout.
- Step 2 has no text inputs (all selectors/sliders). Keyboard is irrelevant.
- Step 3 has text inputs only behind the "yes" gate (name, URL). Conditionally enable keyboard-aware behavior.
- Step 4 has potential manual-override inputs (min/max budget). Same as Step 3.
- Step 5 is read-only (preview). No keyboard.

### Recommendation for Swellyo

Use `react-native-keyboard-controller`'s `KeyboardAwareScrollView` with `bottomOffset` set to the footer height (typically 72–80dp + safe area bottom). Place the sticky footer as a sibling absolutely positioned at the bottom, animated with `useReanimatedKeyboardAnimation`. This is consistent with the `useChatKeyboardScroll` hook already in the project. For steps without text inputs (2, 5), use a plain `ScrollView`.

---

## 11. Microcopy and Tone

### How top travel apps phrase wizard headings and helper text

**Airbnb**: conversational + motivational. "You won't be charged yet" (removes anxiety at payment). "Listings with more details get up to 20% more bookings" (outcome framing, not command). "Your place's potential" (frames the task as an opportunity). Uses contractions freely. Never imperative.

**Hopper**: direct but warm. Notification opt-in copy shows exactly what push notifications will say — removes risk from the opt-in decision. The UX review (Barno Studio, 2024) criticized Hopper for unclear error states and missing explanatory text, which hurt trust.

**Duolingo**: goal-oriented framing. "What do you want to learn?" not "Select a language." Every question is framed around the user's outcome. Motivational microcopy after each step ("You're on your way!") but never patronizing.

**Tinder / Bumble**: minimal, direct questions. "What's your name?" "How old are you?" No helper text because none is needed — the questions are self-evident. This works because their questions require no context.

**What the community agrees on (Smashing Magazine, Reform.app, Growform)**:
- Use "Continue to [next step name]" over "Next" — tells users what they're doing.
- Use "Optional" (spelled out) rather than asterisks for required fields.
- Error messages: specific and non-blaming. "Your trip needs a title" not "Title is required."
- Helper text under inputs: one line, 12–13sp, muted color, explains the why or the format.
- Button labels: sentence case, active verb. "Publish trip" not "PUBLISH TRIP."
- Placeholder text: do not use as labels. Use floating labels or above-field labels.

**Surf community tone**: the Swellyo context calls for slightly informal, stoke-aware language without going full bro. "What waves are you chasing?" is better than "Wave preference." "Who's paddling out with you?" is better than "Target skill level." But don't overdo it — if every field has a surfing metaphor, it becomes exhausting. Reserve the surf voice for headings; keep helper text direct.

### Recommendation for Swellyo

Step headings: conversational question format ("What's the vibe?", "Where are you heading?"). CTAs: specific verb + noun ("Add surf details", "Set accommodation", "Estimate budget", "Publish trip"). Helper text: direct, single-sentence, no exclamation marks. Optional markers: the word "(optional)" in gray text, not asterisks. Error messages: "Your trip needs a [field name]" format, never "Invalid input." The tone should feel like a knowledgeable local helping you plan — not an enterprise form and not a parody of surf culture.

---

## 12. Smart Defaults and AI Fill

### When it's delightful vs creepy

**Airbnb (May 2026)**: native AI that auto-fills listing details when a host enters their property address. TechCrunch confirmed this as part of the May 2026 release. The trigger is a single input (address) and the result is populated fields across multiple categories. This is the platonic ideal of "smart fill" — one input, many outputs, user can edit everything. It feels helpful, not creepy, because the data comes from the address (predictable source) and everything is editable.

**Airbnb's GPT description (earlier)**: hosts can tap a "Write for me" button after providing basic amenity info. The AI drafts a listing description they then edit. This is additive — it appears after the user has already entered data, not instead of entering it. This reduces the "creepy" feeling because the AI is clearly working from what the user provided.

**Hopper's MILO (2024)**: an AI travel agent that answers questions and provides personalized suggestions during search. More conversational than pre-fill. Works because users explicitly invoke it ("Ask MILO") rather than having fields appear pre-filled.

**Duolingo**: adapts lesson difficulty and pacing based on early quiz responses. Not creepy because it's clearly goal-serving (making lessons appropriate) and the effect is visible (the app tells you "We'll start here based on your answers").

**When AI fill backfires (the "creepy" zone)**:
- Pre-filling with data the user didn't expect you to have (inferred demographic data, location inference beyond what's needed).
- AI fill that happens silently with no visual indication — users think they typed it themselves.
- AI suggestions that are confidently wrong and can't be easily overridden.

**The "delightful" zone**:
- AI fills with clearly derived data (address → property details, destination → typical budget range).
- AI fill with explicit trigger ("Estimate for me" button), not automatic.
- AI output shown as a suggestion/draft with low-friction edit path.
- AI that explains its reasoning briefly: "Based on 7-night stays in Canggu for 4 people — Budget: $800–1,200 · Mid: $1,400–2,000 · Premium: $2,800+"

**The budget step in context**: Swellyo's Step 4 (budget) uses GPT to estimate three tiers based on destination, duration, and accommodation type. This is firmly in the "delightful" zone — it is explicitly invoked by reaching the step, the inputs are visible to the user (they just entered them), and the tiers are editable. The critical UX requirement: show the AI working ("Estimating for Canggu · 10 days · Villa...") rather than a cold loading spinner. Show the inputs that drove the estimate below the result ("Based on: Canggu, 10 days, villa"). Make the manual min/max override always visible, not hidden behind an "advanced" toggle — this builds trust.

### Recommendation for Swellyo

For the budget step: trigger the GPT estimate automatically when the user arrives at Step 4 (inputs are already known from Steps 1 and 3). Show an inline loading state ("Estimating budget for [destination]...") not a full-screen spinner. When complete, show the three tier cards (Budget / Mid-range / Premium) with the USD range in each. Below the tiers, show the derivation: "Estimate based on [destination], [N] days, [accommodation type]." Always show the manual override fields (min/max inputs) below the tiers, pre-filled with the selected tier's values, so users can fine-tune. If the estimate fails silently, fall back to empty min/max fields with helper text: "We couldn't estimate — enter your budget range."

For the trip name (Step 1): consider an "Suggest a name" button that generates a short trip title from destination + vibe + dates. This is additive (user opted in by tapping) and the inputs are already known. This is the same pattern as Airbnb's "Write for me."

---

## Summary of Key Recommendations (Quick Reference)

| Area | Recommendation |
|---|---|
| Step indicator | Thin top bar + "Step X of 5" above heading (no named stepper) |
| Navigation | Sticky footer: Back (ghost) left + labeled CTA right; "Save & exit" top-right |
| Validation | On-blur for text; on-next for selectors/pickers; never silent disabled button |
| Save/resume | Create draft on first Next tap; "Saved · X min ago" footer label; resume screen on re-open |
| Skip/optional | "Skip for now" below optional groups; "(optional)" on section labels; per-step skip on Step 2 wave section |
| Transitions | `slide_from_right` for Steps 1–4; `fade_from_bottom` for Step 5 |
| Density | Scroll within step is OK; never more than 2.5 screens per step; Steps 2–4 fit in one scroll |
| Headers | 24–26sp conversational question + 13sp subtitle; fraction counter above heading in muted gray |
| Preview | Full rendered trip card + compact summary grid + visibility selector |
| Keyboard | `KeyboardAwareScrollView` (react-native-keyboard-controller) + `bottomOffset`; footer as sibling, not child |
| Microcopy | Surf-aware question headings; specific verb+noun CTAs; "(optional)" spelled out; specific error messages |
| AI fill | Budget: auto-estimate on step arrival + inline derivation display + always-visible manual override |

---

## Sources

- [Wizard UI Pattern: When to Use It and How to Get It Right — Eleken](https://www.eleken.co/blog-posts/wizard-ui-pattern-explained)
- [32 Stepper UI Examples and What Makes Them Work — Eleken](https://www.eleken.co/blog-posts/stepper-ui-examples)
- [Wizards: Definition and Design Recommendations — Nielsen Norman Group](https://www.nngroup.com/articles/wizards/)
- [Creating an Effective Multistep Form for Better UX — Smashing Magazine (Dec 2024)](https://www.smashingmagazine.com/2024/12/creating-effective-multistep-form-better-user-experience/)
- [Best Practices for Mobile Form Design — Smashing Magazine (2018)](https://www.smashingmagazine.com/2018/08/best-practices-for-mobile-form-design/)
- [Best Practices for High-Conversion Wizard UI Design — Lollypop (Jan 2026)](https://lollypop.design/blog/2026/january/wizard-ui-design/)
- [Multi-Step Form Navigation Best Practices — Reform.app](https://www.reform.app/blog/multi-step-form-navigation-best-practices)
- [Save-and-Resume Multi-Step Wizard Patterns — AppMaster](https://appmaster.io/blog/save-and-resume-multi-step-wizard)
- [PatternFly Wizard Design Guidelines](https://www.patternfly.org/components/wizard/design-guidelines/)
- [Progress Tracker Design: UX Best Practices — UXPin](https://www.uxpin.com/studio/blog/design-progress-trackers/)
- [Keyboard Handling — Expo Documentation](https://docs.expo.dev/guides/keyboard-handling/)
- [react-native-keyboard-controller — Expo SDK Documentation](https://docs.expo.dev/versions/latest/sdk/keyboard-controller/)
- [KeyboardAwareScrollView — react-native-keyboard-controller](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-aware-scroll-view)
- [To disable or not to disable: The button debate in UX — Medium](https://medium.com/@ferrarimarika/to-disable-or-not-to-disable-the-button-debate-in-ux-f942adf5cd04)
- [Don't Disable Form Controls — Adrian Roselli (Feb 2024)](https://adrianroselli.com/2024/02/dont-disable-form-controls.html)
- [Usability Pitfalls of Disabled Buttons — Smashing Magazine](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/)
- [Airbnb Gets Into Hotels, Expands AI for Host Onboarding — TechCrunch (May 2026)](https://techcrunch.com/2026/05/20/airbnb-gets-into-hotels-expands-ai-for-host-onboarding-and-customer-support/)
- [Airbnb 2024 Spring Update](https://news.airbnb.com/airbnb-2024-spring-update/)
- [Introducing the Listings Tab — Airbnb Resource Center](https://www.airbnb.com/resources/hosting-homes/a/introducing-the-listings-tab-638)
- [The Pros and Cons of Hopper — Barno Studio / Medium (UX Review)](https://medium.com/@barnoteam/the-pros-and-cons-of-hopper-book-travel-on-mobile-a-ux-review-and-suggestions-a0b62dff0e5)
- [How Airbnb Became a Leader in UX Design — Prototypr](https://blog.prototypr.io/how-airbnb-became-a-leader-in-ux-design-7d8ab8ad803e)
- [I Studied the UX/UI of Over 200 Onboarding Flows — DesignerUp](https://designerup.co/blog/i-studied-the-ux-ui-of-over-200-onboarding-flows-heres-everything-i-learned/)
- [How to Add Custom Transitions to React Navigation — OneUptime (Jan 2026)](https://oneuptime.com/blog/post/2026-01-15-react-native-custom-transitions/view)
- [This Is UX Writing at Its Very Best — Real Big Words](https://realbigwords.com/best-ux-writing)
