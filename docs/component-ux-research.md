# Component UX Research — Swellyo Create-Trip Flow

Researched May 2026. Applies to the 5-step Create-Trip wizard in `CreateTripFlowA.tsx` / `CreateTripFlowC.tsx`.
Stack: React Native 0.81, Expo SDK 54, Reanimated v3, Gesture Handler v2.

---

## 1. Trip Title Text Input (28-char max)

### Survey

**Airbnb listing title**
Airbnb enforces a 50-char limit (mobile renders ~32 chars before truncation). Their counter appears below the input at all times showing remaining characters. The design shifts to a warning color when fewer than 10 chars remain. The style is small, muted gray by default — unobtrusive but always present.
Source: https://www.airbnb.com/resources/hosting-homes/a/guidelines-for-writing-your-listing-title-533

**Strava activity name**
Strava shows no counter by default, relying on OS truncation. Because activity names are used in timeline cards, the preview matters — users discover the cutoff by trial. This is a known UX friction point: no feedback until the card is rendered.

**Eventbrite event name**
Eventbrite renders a live mini-preview of the event card title beneath the input, updating on every keystroke. The counter is secondary — always visible but small. The live card preview does the real teaching: users see their title wrapping or fitting without needing to count.

**Twitter / X post composer**
The gold standard for character counters. Starts as a subtle circular progress ring, turns yellow at 20 remaining, turns red at 0 (allows 20-char over), then counts negative with a red badge. Near-limit signaling is done with color + number, not icon. The ring communicates ratio visually without displaying a raw number until it matters.

**Material Design 3 / Carbon Design System**
M3 guidelines recommend showing the counter always on inputs with a hard cap, formatted as `current / max` (e.g. "14 / 28"). Carbon Design recommends the same. The reasoning: always-visible counters reduce surprise; users can self-regulate before they hit the limit rather than after.

### Recommendation

Always-visible counter, formatted as `14 / 28`, positioned inline at the trailing edge of the input label row (same line as the label, right-aligned). At 22+ characters (threshold: 6 from limit), shift counter color from muted gray to a warm amber. At 27-28 characters, shift to red. Additionally, render a live 1-line preview below the input showing how the title will appear on a trip card — this is the most powerful teaching mechanism (Eventbrite pattern). The preview is a single styled `Text` component with the same card title font/truncation as the actual `TripsScreen` card, so the user sees exactly what other users will see.

Do not use a circular ring (adds complexity without benefit at 28 chars) — a simple `n / 28` number with a color change is sufficient and maps directly to the TextInput's `maxLength` prop.

### RN/Expo Implementation Note

- Use `TextInput` with `maxLength={28}`. Track length via `onChangeText`.
- The counter is `title.length / 28`.
- Color logic: `title.length >= 27 ? red : title.length >= 22 ? amber : mutedGray`.
- Live preview: render a `Text` component below the input, styled identically to the trip card title in `TripsScreen`, capped at one line with `numberOfLines={1} ellipsizeMode="tail"`. This component re-renders on every keystroke, which is acceptable at this component density.
- No library needed; this is pure controlled TextInput state.

---

## 2. Hero Photo Upload (12:5 aspect ratio)

### Survey

**Airbnb listing creation**
Airbnb's "Become a Host" flow presents a large dashed-border drop zone on web and a full-width tap target on mobile. On first tap it immediately shows an action sheet: "Take a photo" / "Choose from library". After selection, a crop UI appears (aspect-locked to the listing's ratio) before upload. While uploading, the crop result is shown at low opacity with an animated shimmer overlay. On replace: a small "Change photo" button overlays the existing image (bottom-left corner). No library picker re-opens until the user explicitly taps "Change".

**Eventbrite event image**
2:1 ratio. Tap opens a native file picker immediately (no action sheet on web). After selection, Eventbrite shows a "focus point" drag interface — a small circular pin the user can move to indicate the crop center. This is simpler than a full-crop UI and appropriate when aspect ratio is fixed. Mobile: tap the image thumbnail to edit or delete.
Source: https://www.eventbrite.com/blog/ds00-easily-upload-your-main-event-image/

**Instagram post creation**
Sets the benchmark for mobile photo upload UX. Selecting from library shows the photo at the correct crop box immediately, with pinch-to-zoom. No action sheet before the gallery — the gallery IS the first screen. The crop is embedded in the preview, not a separate modal. Replace is done by tapping back to the gallery.

**Hopper app**
Hopper focuses on travel not hosting, so no listing photo upload. However, Hopper's image display is instructive: hero images are always 16:9 or 2:1, positioned so the focal point (destination city skyline) occupies the center-top, never the center-bottom. Their city thumbnails use smart cropping.

**General patterns from UX research (Quora, Medium case studies)**
Industry consensus: pick-then-crop is better than upload-then-crop because the crop step feels lower-stakes before the network transfer happens. The flow should be: (1) show picker → (2) show crop UI → (3) show upload progress. Never upload before cropping.

### Recommendation

Use a tap-to-upload zone with 12:5 aspect ratio maintained by `aspectRatio: 12/5` on the outer container. Before any photo is chosen: render the zone with a dashed border, a camera icon, and the text "Add a cover photo" — the zone should feel inviting, not form-like.

On tap, show `ActionSheet` with two options: "Take a photo" and "Choose from library". After image selection, push `expo-image-manipulator` crop to 12:5 before upload (client-side, never raw upload). While upload is in progress: show the cropped image at full opacity with an animated shimmer overlay (left-to-right sweep using Reanimated's `withRepeat`). On error: show a red-bordered zone with "Upload failed. Tap to retry". On success: show the uploaded image with a small "Change photo" pill button overlaid at the bottom-right corner.

For "suggested photos": not recommended at this stage — the user is the host and already knows their destination. Suggested templates add noise without value unless you build a curated surf-destination photo library.

### RN/Expo Implementation Note

- `expo-image-picker` for both camera and library (see project's existing `storageService.ts`).
- `expo-image-manipulator` for client-side crop to 12:5 before upload. Resize to max 1200px wide to keep upload fast.
- Use `expo-image` (not `Image`) for display after upload — better caching and fade-in on load.
- The shimmer overlay: a `LinearGradient` (expo-linear-gradient) animated via `useSharedValue` + `useAnimatedStyle` from Reanimated, translating X from -width to +width in a loop. This is the standard React Native shimmer pattern; no extra library needed.
- Crop UI: `expo-image-manipulator` does cropping silently (no interactive crop UI). For an interactive crop before upload, `react-native-image-crop-picker`'s `openCropper` is the correct choice (already researched for this project). Set `width/height` to a 12:5 ratio (e.g., 1200x500) and `cropping: true`.
- Known gotcha on Android: `expo-image-picker` with `allowsEditing` has a broken crop overlay in light mode (researched). Use `react-native-image-crop-picker`'s `openCropper` instead for the crop step, or post-process with `expo-image-manipulator`.

---

## 3. Destination Picker

### Survey

**Airbnb destination search (guest search bar)**
Uses a "Where" pill in the split search bar. Tapping expands into a full-screen modal with a text input at the top and a grid of "suggested destinations" below (icon tiles + label). As you type, suggestions animate in below, replacing the grid. Recent searches appear between the suggestions grid and the current input. Post-selection: the pill collapses back to show the destination name. The key insight: recent searches + popular destinations default state makes the field feel useful before any typing.
Source: https://medium.com/@Barely-thinking/airbnbs-search-and-browse-functionality-a-deep-dive-40310a6fcd74

**Hopper city search**
Immediately shows recent searches in a list below the input. Typing replaces recent with autocomplete. After selection, the destination field in the main form reflects the chosen city. One notable detail: Hopper groups results by country name, not just city — useful for multi-airport cities.
Source: https://leehanseul.com/neat-ux-hopper-app

**Google Flights destination**
Full-screen modal with a large input at the top. Below: "Popular destinations" horizontally scrollable pill strip. Autocomplete fires after 1-2 chars. Results show city name + country + airport code in a compact 3-column list item. Clears on X button to let user try again — no back-navigation needed.

**Komoot start point**
Tapping the start-point field opens an inline expansion (not a modal) with an autocomplete list scrolling below it. Recent routes appear in the expansion before typing. This inline expansion pattern works well in dense wizard UIs because it doesn't cover the rest of the form context.

### Recommendation

Keep the existing bottom-sheet pattern (it matches how `HomeBreakSearchSheet` works in the project) but improve the default state inside the sheet. Before typing: show a "Popular surf destinations" pill strip (horizontal scroll) with 6-8 curated options (e.g., Bali, Oahu, Nazare, Pipeline, Tamarindo, Mentawai, Jeffreys Bay, Peniche). Below that strip: show "Recent searches" if any exist in AsyncStorage. The pills act as one-tap shortcuts that skip typing entirely — important for surfers who are heading to well-known breaks.

After typing begins: replace the pills with Google Places autocomplete results, each shown as `City, Country` with a small pin icon prefix.

Post-selection: collapse the sheet, show the selected destination in the trigger row as a filled pill (colored background, white text), not a placeholder. This confirms the selection visually and distinguishes it from an empty state.

Do not use country flags — they add visual noise and can be ambiguous for island groups (Indonesia vs Bali).

### RN/Expo Implementation Note

- The project already uses `HomeBreakSearchSheet` for destination. Extend it to show a pre-typed state (popular destinations + recents) rather than an empty input.
- Store recent destination selections in AsyncStorage as an array (max 5) keyed to `@swellyo/recentDestinations`.
- The popular destinations hardcode is fine — it rarely changes and avoids an API call.
- Google Places autocomplete is already wired in this project. Keep it; just improve the default state.
- Bottom sheet from `@gorhom/bottom-sheet` handles the snap points and keyboard avoidance. Ensure `keyboardBehavior="extend"` on the BottomSheet so the autocomplete list isn't hidden behind the keyboard on Android.

---

## 4. Date Picker — Months Range vs Exact-Date Range

### Survey

**Airbnb "I'm flexible" tabs**
Airbnb introduced a 3-tab date mode in 2022 and it became their dominant pattern: "Dates" (exact calendar) / "Months" (month chip grid) / "Flexible" (duration + any month). The months tab shows a scrollable grid of month chips (e.g. "Aug", "Sep", "Oct") — not a calendar. Users tap to select, tap again to deselect, with multi-select allowed. The visual is clean: month names in pill buttons, tapping fills the pill with the brand color. The toggle between tabs is a segmented control above the content area.
Source: https://www.rentalscaleup.com/airbnb-flexible-dates/

**Google Flights flexible dates**
Offers a "Date Grid" view and a "Price Calendar" view. The date grid shows a matrix of depart-by / return-by combinations with cheapest prices filled in. The flexible tab shows month tiles with price ranges. The mode toggle is a set of three pill buttons: "Specific dates" / "Month" / "Flexible". The pill that is active gets a filled background.
Source: https://support.google.com/faqs/answer/2736592

**Skyscanner whole-month search**
Skyscanner's calendar allows selecting a single month to get a "cheapest within this month" result. The month picker is a vertical-scroll list of months with price ranges beside each. A "Cheapest month" option at the top selects automatically. The design is deliberately simple — one column, one month per row.
Source: https://www.skyscanner.com/tips-and-inspiration/skyscanner-tips-and-tools-how-to-search-flight-prices-across-whole-month

**Hopper price calendar**
Hopper shows a full calendar grid by default, but colors each day with a price heatmap (green = cheap, orange = expensive). Month navigation is left/right arrows. There is no "fuzzy months" mode — Hopper commits to exact dates and uses color to guide flexibility.

**Mobiscroll / industry analysis of travel date pickers**
The article on date pickers in flight booking apps found that vertical-scroll continuous calendars (showing 2+ months at once) outperform page-based calendars in task completion time. The key: users see departure and return in the same scroll, reducing back-navigation. Selected range is highlighted with a colored band between the two selected days.
Source: https://blog.mobiscroll.com/date-pickers-in-flight-booking-apps/

### Recommendation

The current two-mode design (`datesMode: 'months' | 'exact'`) is architecturally correct. The UX improvement is in how the toggle is presented and how each mode's input looks.

**Mode toggle:** A 2-segment segmented control, width ~240pt, centered at the top of the dates section: `[ Flexible months ]  [ Exact dates ]`. Use the iOS-native segmented control style (pill inside a track) on both platforms. Default to "Flexible months" for Flow A/B, default to "Exact dates" for Flow C.

**Months mode:** Show a horizontally-scrollable row of month pills (abbreviated: "Jun", "Jul", "Aug"... through 18 months from today). Multi-select with tap-to-toggle. Selected pills are filled with the brand color, unselected are outlined. The range summary beneath updates to show "Jun – Sep 2026" or "Aug 2026" (single month). This is friendlier than two separate dropdowns for `monthFrom` / `monthTo`.

**Exact dates mode:** The existing `CalendarRangePicker` component works well architecturally. The UX improvement is: show both months simultaneously (scroll to 2-month view), highlight the selected range as a colored band between start and end days (current implementation uses `isBetween` logic, which is correct — just ensure the band color is applied). Range summary `"Jul 5 – Jul 19 · 14 days"` below the calendar is correct and matches the `formatRangeSummary` already in the component.

**Fuzzy range display:** When months mode is active and a range is set, show a large readable label: "Aug – Oct 2026" in a 17pt medium weight font beneath the month pills. For a single month: "August 2026".

### RN/Expo Implementation Note

- The month-pill approach replaces the current `monthFrom` / `monthTo` text input fields with a simpler multi-select chip row.
- Month chips can be built as a horizontal `FlatList` or `ScrollView` with pill `TouchableOpacity` components — no library needed.
- The `CalendarRangePicker` already exists at `src/components/trips/CalendarRangePicker.tsx` and is functional. The main UX improvement needed is a 2-month simultaneous view and the colored range band CSS.
- Segmented control: use the `@react-native-segmented-control/segmented-control` package (Expo-compatible) or a custom implementation with two `TouchableOpacity` pills inside a styled container — the custom version gives more control over the surf brand aesthetic.
- Known gotcha: on Android, the native segmented control looks visually different from iOS. A custom implementation (two pills in a rounded container) renders identically on both platforms.

---

## 5. Duration Input (1–30 days, integer)

### Survey

**Airbnb flexible dates duration**
When Airbnb's "Flexible" tab is selected, the duration picker shows 4 preset pills: "Weekend", "Week", "Month", and a custom option. The pills are horizontally arranged, full-width on the inner panel. Only one can be selected at a time (radio behavior). The visual is large, tappable, and requires no dragging.

**Google Flights flexible duration**
Shows preset chips: "+/-1 day", "+/-2 days", "+/-3 days" for padding around a selected date. For trip duration in "flexible" mode: a simple number picker (spinner-style on iOS, text field on Android).

**Couchsurfing / Workaway**
Workaway and similar volunteer-travel apps use a "how many nights" text input with a `+/-` stepper beside it. This is the minimal-friction approach for values that are known precisely (e.g., "I'm staying 12 nights"). No slider.

**Trusted Housesitters**
Uses preset duration categories: "1 week", "2 weeks", "1 month", "longer", plus a "custom" option that opens a numeric input. The preset categories cover ~80% of use cases.

**NNG on sliders**
NN/G explicitly advises against sliders for precise integer inputs: "Sliders work best when the specific value does not matter to the user, but an approximate value is good enough." For trip duration, where 10 days vs 12 days is a meaningful difference, a slider degrades UX.
Source: https://www.nngroup.com/articles/gui-slider-controls/

### Recommendation

Preset chips for the most common durations, plus a manual input fallback. The chip row: `3d | 5d | 7d | 10d | 14d | Custom`. All 6 chips fit in one row at 36pt height. Selecting "Custom" reveals a `TextInput` with `keyboardType="number-pad"` and a `+` / `-` stepper on each side. The currently selected chip gets a filled background.

Rationale: surf trips cluster strongly around 7, 10, and 14 days. Presets handle ~75% of cases in one tap. The custom fallback handles outliers. A slider over a 1–30 range with 1-day precision is nearly impossible to use accurately on mobile (verified by NN/G research and personal testing).

### RN/Expo Implementation Note

- The chips are a horizontal `View` with `flexWrap: 'wrap'` or a fixed-width row using flex.
- The custom input: `TextInput` with `keyboardType="number-pad"`, `maxLength={2}`. Clamp the value to 1–30 on `onBlur`.
- The `+/-` stepper buttons: `TouchableOpacity` components calling `setState(v => Math.max(1, Math.min(30, v + 1)))`.
- Avoid `@react-native-community/slider` for this use case — it is the wrong tool per NN/G guidance for precise integer inputs.

---

## 6. Segmented Control (Months / Exact-Dates Toggle)

### Survey

**When to use segmented control vs tabs vs radio:**
- Segmented control: 2-5 options, mutually exclusive, changes content within the same view instantly. Best for "how to view the same thing" (map/satellite, list/grid, months/exact).
- Tabs: navigate to different sections with distinct content areas. Heavier — tabs imply separate page regions.
- Radio: when the options are part of a form and the user is making a persistent selection among clearly labeled choices. Radio buttons don't animate; they're static.

The date-mode toggle is a classic segmented control case: two mutually exclusive modes, same content area, instant switch. Apple's HIG explicitly lists date/time display format as an example use case.
Source: https://developer.apple.com/design/human-interface-guidelines/segmented-controls

**Material Design 3 segmented button:**
M3 calls this component "Segmented buttons" and specifies: each segment is 40dp tall with 12dp horizontal padding, the selected segment uses `surfaceVariant` fill with an outlined track, and there is a subtle scale animation on press. The active segment can optionally show a checkmark icon.

**Airbnb search bar date mode toggle:**
Airbnb uses a 3-segment control ("Dates / Months / Flexible") at 48pt height with large, readable labels. The selected segment animates with a slide-under fill (not a jump). Unselected segments are label-only, no border on individual segments — the track provides visual grouping.

**Size and label tone for Swellyo:**
The Swellyo brand is casual-surf. Label options: "By Month" / "Exact Dates" is clearest — avoids "Flexible" (which implies Airbnb-style unlimited flexibility) and avoids ambiguous "Range" vs "Precise".

### Recommendation

Custom two-segment control, 48dp tall, full-width within the step content area. Track: `borderRadius: 12`, `backgroundColor: #F0F0F0` (light gray container). Selected segment: `backgroundColor: brand_color`, white text, `borderRadius: 10`. Unselected: transparent, medium-gray text. Animated: the selected fill slides from segment to segment using a `withSpring` animated `left` value on the fill view.

Label tone: `"By month"` / `"Exact dates"`. Short, clear, no jargon.

### RN/Expo Implementation Note

- Custom implementation (2 `TouchableOpacity` side-by-side in a container view) is preferred over the native `@react-native-segmented-control/segmented-control` package because the native control cannot be fully styled on Android (renders as a system widget).
- The sliding animation: use a Reanimated `useSharedValue` tracking the active index, animate a `View` that is absolutely positioned within the track container. `withSpring` gives a satisfying elastic feel.
- Alternatively, simply use `Animated.View` from RN core with `useNativeDriver: true` for the fill slide — no Reanimated needed for this simple translation.
- Touch target: each segment should be at minimum 44x44pt. At 48pt height with full half-width, this is satisfied on any real device.

---

## 7. Multi-Select Chips (Skill Levels, Wave Shapes, Board Types)

### Survey

**Material Design 3 Filter Chips**
M3 specifies filter chips as the correct component for multi-select filtering scenarios. Specs: 32dp height, 8dp horizontal padding, `border-radius: 8dp`, leading icon optional (adds 8dp before label), selected state uses `surfaceVariant` fill + optional check icon. Critically: M3 does NOT recommend a "select all" shortcut for 3-option lists — "all" is only useful when the list is long (6+ items).
Source: https://m3.material.io/components/chips/guidelines

**Bumble interest selection (onboarding)**
Bumble shows ~30 interest chips in a 3-column wrapping grid. Each chip is ~100pt wide, 36pt tall, label-only (no icons for text labels). Selected chips get an outline + fill in Bumble's brand yellow. There is no "select all" — users are expected to tap individually. Bumble's approach is notable for its density: the grid packs a lot of options without scrolling.

**Strava activity type filter**
Strava uses icon+label chips in a horizontal scrolling strip (single row, horizontally scrollable). Selected chips are outlined + filled with Strava's orange. The horizontal strip works because Strava has 10+ types that don't fit in a static grid.

**Airbnb amenity filters**
Airbnb uses icon+label chips in a 2-column wrapping grid inside a bottom sheet. Each chip is ~165pt wide, 48pt tall, icon on the left. This large format is appropriate for amenities (complex concepts benefit from icons). For simpler labels like "Beginner / Intermediate / Advanced", icons add noise.

**Skill levels (3 options) — Swellyo specific**
With only 3 options, chips should be displayed as a single row of 3 equal-width chips, not a wrapping grid. This matches how Airbnb shows "property type" quick-select tiles — a fixed row that reads left-to-right in natural order.

### Recommendation

Three separate chip groups, each with its own labeled section header:

1. **Skill level** (3 options): single row of 3 equal-width chips, label-only, no icons. "Beginner", "Intermediate", "Advanced" — these words are unambiguous without icons.

2. **Wave shapes** (3 options): single row of 3 equal-width chips. Add a very small inline icon (wave illustration, ~16pt) before the label — wave shapes are visual concepts that benefit from iconographic reinforcement. Alternatively: no icon, but add a 1-line description subtitle below the chip label (current implementation has `.desc` strings — these are valuable).

3. **Board types** (4 options): 2x2 grid or a 4-chip wrapping row. Board type chips benefit from a tiny silhouette icon (shortboard silhouette vs longboard silhouette is immediately readable). The 4-chip row at ~76pt per chip is borderline for one row — a 2x2 grid is safer on 360dp Android screens.

**Selected state:** Filled background with the brand color, white text. Unselected: light gray background, dark text. No checkmark icons needed at this density.

**"Any" shortcut:** Not recommended for 3 or 4-option lists. At those sizes, tapping each option individually is faster and clearer than a special "all" action that requires extra cognitive parsing.

**Tap target:** Each chip must be minimum 44pt height. At the 36dp M3 spec this is borderline — use 44pt for all Swellyo chips.

### RN/Expo Implementation Note

- No library needed. Each chip is a `TouchableOpacity` with a `View` container and `Text` label.
- The 2x2 grid for board types: use `flexWrap: 'wrap'` on a `View` with `flexDirection: 'row'`, each chip at `width: '48%'`.
- Selected state style is toggled inline: `isSelected ? styles.chipSelected : styles.chipUnselected`.
- For the wave shapes icon: Ionicons does not have good wave icons. Use an SVG asset or an emoji character ('🌊' for soft, nothing perfect for wally/barrel) — or go label-only with the description subtitle, which is already implemented in `WAVE_SHAPES`.
- Performance: at these small counts (3–4 options per group), re-rendering all chips on each tap is fine. No `useMemo` needed.

---

## 8. Range Slider — Wave Size 1–15 ft, Dual Handle

### Survey

**Airbnb price range slider**
The benchmark dual-handle slider. Key details: the active range is filled with a solid color between the two handles; value labels appear above each handle, updating in real time as the user drags; the track ends are labeled with the min/max bounds; the selected values are also shown in text inputs below the slider so the user can type exact values if preferred. The dual-input-below-slider approach is the most usable pattern for cases where precision matters.
Source: https://www.eleken.co/blog-posts/slider-ui

**Bumble / Hinge age range**
Both use dual-handle sliders for age range. Hinge adds a "This is a dealbreaker" checkbox beside the slider — useful for hard-filter scenarios. Bumble's slider has been noted as imprecise in usability studies, specifically because the handle touch target is too small and the 18–80 range requires very fine motor control.
Source: https://usabilitygeek.com/ux-case-study-bumble/

**Zillow price filter**
Displays a histogram (bar chart) above the slider track showing the distribution of home prices. This pattern ("histogram + slider") tells the user where the density is and helps them set a meaningful range. Very powerful for large datasets but overkill for wave size (1–15 ft with step 1).

**NN/G slider guidelines**
Key guideline: display the current value above or beside the thumb, never below (the user's finger covers a below label on touchscreens). For dual handles, show a value bubble above each thumb during drag, and show the current range in text form (e.g., "4 – 8 ft") in a static label outside the slider track.
Source: https://www.nngroup.com/articles/gui-slider-controls/

### Recommendation

The project already has a `RangeSlider` component (`src/components/trips/RangeSlider.tsx`). The implementation is functional (PanResponder-based, snaps to step). The UX improvements needed:

1. **Value labels above thumbs:** Currently missing. Add a `Text` component absolutely positioned above each thumb showing the current value (e.g., "4 ft", "8 ft"). These should update in real time during drag. Position them so they don't overlap when the handles are close together (switch to a centered combined label "4–8 ft" when the handles are within 2 units of each other).

2. **Track fill color:** Fill the track between the two thumb positions with the brand color. The outer track sections are muted gray.

3. **Static range display:** Below the slider, always show "4 – 8 ft" as a readable text summary. This secondary display persists even when not dragging.

4. **Min/max endpoint labels:** Show "1 ft" and "15 ft" at the track ends in small muted text.

5. **Step = 1 ft:** At 15 distinct values across a reasonable track width (~280pt), each step is ~18pt — very precise for a finger. Consider step = 0.5 or staying at 1 ft but accepting that users may need 2-3 attempts to hit a precise value. Since wave size is a preference range (not exact), this is acceptable — the UX is forgiving.

Do not use a histogram overlay for wave size — there is no distribution data to show and 15 options is too few to benefit from it.

### RN/Expo Implementation Note

- The existing `RangeSlider.tsx` uses `PanResponder`. This works but is the older approach. Migrating to Reanimated v3 + Gesture Handler v2 would give smoother animations (worklet-based, no JS thread involvement during drag). However, the existing PanResponder implementation is correct and can be enhanced in-place by adding the value-label Views.
- The value label position: use a `Animated.View` (or just `View`) positioned absolutely at `left: valueToPx(lower) - LABEL_WIDTH/2` and `bottom: THUMB + 8`. This is a pure computed layout, no extra gesture logic.
- The overlap problem: `if (upper - lower < 2) { showCombinedLabel = true }` — render one centered label instead of two.
- Reanimated migration option: `react-native-fast-range-slider` (amitpdev, Reanimated + GH v2) or `@bam.tech/react-native-split-view` are the 2025 community-recommended alternatives. But the existing implementation is adequate with the label additions.
- Do not use `@miblanchard/react-native-slider` — its multi-thumb support is limited and it hasn't been updated for RN 0.73+.

---

## 9. Card-List Selector (Vibe, Accommodation Type, Visibility)

### Survey

**Airbnb property type picker ("Become a host")**
In the host listing creation flow, Airbnb presents accommodation types as a 2-column grid of icon tiles. Each tile is ~165pt wide, 80pt tall, with a large centered icon and a label below. Selected tile: a border highlight + check in the corner. The grid format communicates "there are many options, browse them" — exactly right for 9 accommodation types.
Source: https://medium.com/design-bootcamp/airbnbs-secret-to-seamless-ux-f7caf7cc9b23

**Eventbrite event type picker**
A 3-column grid of category tiles with icons. Each tile is ~100pt wide, 80pt tall. Very similar to Airbnb. The dense grid format is appropriate when all options are visible without scrolling.

**Klook category grid**
A 4-column grid with icon-only tiles on the explore screen. Labels appear on tap (tooltip-style). This is too compact for a creation flow — but the icon-forward approach is instructive.

**Current "vertical card stack" pattern (existing implementation)**
The existing TRIP_VIBES, ACCOMMODATION_KINDS, and VISIBILITIES are rendered as vertical stacks of title+description cards. This is the pattern used by Linear (team settings), GitHub (repo visibility), and Stripe (account type selection). It works well for high-consequence, description-heavy choices (1-3 options) but creates excessive scrolling for 9 accommodation types.

**Linear team settings pattern**
Linear uses vertical radio-button-style cards with a border highlight on selection. Each card has a title and 1-line description. The border changes from gray to brand color when selected, and a radio dot appears in the top-right corner. This is the gold standard for the "pick one important thing" interaction.

### Recommendation

Split the three selectors into two visual formats based on the number of options and need for descriptions:

**Format A — Vertical radio-button cards (3 options: Vibe, Visibility)**
Keep the existing card stack approach. Improve: make the selected state border thicker (2pt → 3pt), add a small colored dot or check in the top-right corner. Add a brief description below the title (already in the data). Cards at 72pt height with 12pt padding feel authoritative and clickable without being wasteful. This is the correct format for Vibe (surf-focused / chill / mixed) and Visibility (public / friends / private) because the descriptions add meaningful context.

**Format B — 2-column icon grid (9 options: Accommodation type)**
Replace the vertical card stack with a 2-column grid. Each tile: 44pt icon (Ionicons has villa=`home`, hostel=`bed`, hotel=`business`, surfcamp=`water`, bungalow=`leaf`, apartment=`grid`, guesthouse=`heart`, ecolodge=`leaf-outline`, other=`ellipsis-horizontal`), title below icon, no description in the tile. Selected: solid border + filled background tint. Tapping a tile selects it (radio behavior within the grid — only one accommodation type can be selected). A subtitle line showing the description of the currently-selected accommodation can appear below the grid as a "selected item description" panel — this preserves the description without crowding the tiles.

The grid format for 9 accommodation types reduces scrolling from ~9 card-heights to ~5 rows of tiles (2 per row = 4.5 rows), which fits on-screen.

### RN/Expo Implementation Note

- 2-column grid: `flexDirection: 'row', flexWrap: 'wrap'` on a container `View`. Each tile: `width: '48%', margin: '1%'`.
- Icon: `Ionicons` at size 28–32 is appropriate for this tile size.
- The "description panel" below the grid: a `View` that is conditionally rendered when `accommodationKind !== null`, showing the description from `ACCOMMODATION_KINDS.find(k => k.key === accommodationKind)?.desc`. Animate it in with a `FadeIn` from Reanimated.
- For 3-option vertical cards, no library needed — plain `TouchableOpacity` cards with conditional border styling.
- Touch target: each grid tile should be minimum 44x44pt, which is satisfied at 2-column layout on any screen ≥360dp.

---

## 10. Numeric Pair Input — Age Range (Min/Max, 16–99)

### Survey

**Tinder age preference**
Tinder uses a dual-handle slider for age range. The slider spans 18–55+ (with an "any" option above 55). Handles are large (thumb ~24pt diameter). Value labels appear above the track showing the current min and max. The label always updates live. This is a widely-used but imprecise interaction for exact age values.

**Bumble age filter**
Bumble uses a dual-handle slider labeled "Age Range" with handles at each end. A toggle below the slider reads: "See people 2 years either side if I run out of matches" — an overflow fallback. Usability studies noted difficulty with precise age control (e.g., setting min to exactly 28 vs 29 requires very fine dragging).
Source: https://www.thematchartist.com/bumble/how-to-chang-age-range-on-bumble

**Hinge age filter**
Two separate numeric text inputs ("Min age" and "Max age") displayed side by side, with keyboard-type numeric. Inline validation fires on blur — if min > max, the max input gets a red outline. The "This is a dealbreaker" checkbox below adds hard-filter semantics.

**Dating app consensus**
Sliders are common for age range in dating apps because the values are approximate and users think in terms of ranges. However, the Swellyo age constraint (minimum span of 7 years for Flow A, 5 for B, 2 for C, stored in `AGE_WINDOW_BY_STYLE`) is a hard constraint, not a soft preference. This shifts the recommendation.

**NNG on sliders for precise values**
NN/G specifically calls out that sliders are bad for precise integer inputs. Age range with a minimum span constraint is a precise, constrained problem — not a "rough preference" problem. Text inputs are more appropriate here.
Source: https://www.nngroup.com/articles/gui-slider-controls/

### Recommendation

Side-by-side numeric inputs, not a slider. Two `TextInput` components labeled "Min age" and "Max age", displayed in a 2-column row. Both use `keyboardType="number-pad"`. Range: clamp to 16–99.

Validation flow:
- Validate on blur, not on keystroke (to avoid red-state while user is mid-typing).
- If `min > max`: immediately set `max = min + minimumSpan` and show a brief toast "Age range must span at least N years".
- If `max - min < minimumSpan`: on "Next" button tap, show an inline error below the inputs: "Age range must be at least [N] years. Current span: [X] years."
- Helper text below the pair: "Min [N]-year gap required" — shown in muted gray at all times so users understand the rule before hitting an error.

The minimum span varies by flow style (7/5/2). This constraint is unusual enough that users need upfront explanation, not just error correction.

### RN/Expo Implementation Note

- Two `TextInput` components in a `flexDirection: 'row'` container with a `View` spacer in between.
- `maxLength={2}` on each input.
- `onBlur` handler: parse both values, apply the span constraint fix, call `setState`.
- The existing `AGE_WINDOW_BY_STYLE` record in `CreateTripFlowA.tsx` already has the per-flow values — use it directly.
- Do not use a range slider here. NN/G + the hard span constraint both argue against it.
- Known gotcha: `keyboardType="number-pad"` on iOS shows no decimal point or minus sign, which is correct. On Android, `keyboardType="numeric"` includes a period — use `"number-pad"` on both platforms or filter out non-numeric chars in `onChangeText`.

---

## 11. Yes/No Gate — Accommodation Locked-In Answer

### Survey

**GitHub repository visibility at creation**
GitHub's "Create repository" form has a radio button pair for "Public" / "Private". The two options are displayed as large radio-button cards (border box style), side by side. A lock icon appears on the "Private" option. There is no confirmation step — the consequence is implied by the iconography and the label description. The choice is not described as irreversible at this screen; that framing comes from GitHub's documentation rather than the UI.
Source: https://github.com/cli/cli/issues/9807 (discussion of consequence signaling)

**Stripe account type selection**
Stripe's onboarding shows two large option cards: "Individual" and "Company". Each card has a title, icon, and 2-line description. The cards are displayed at the same visual weight — neither is highlighted as "recommended". A small muted note below the cards reads "You can't change this later" in red or orange. This explicit "you can't change this later" label is the industry pattern for immutability signals.

**Linear team type setting**
Linear presents workspace type choices as cards with a title and description. For settings that are permanent, a small alert icon and "(Cannot be changed)" label appears below the radio group. This is unambiguous without being alarming.

**NN/G on confirmation dialogs**
NN/G recommends using confirmation dialogs for "actions that are irreversible and high-consequence." An accommodation locked-in state is both — it determines whether the user must provide a name/URL/photo for the accommodation (adding 3 required fields) and cannot be changed later.
Source: https://www.nngroup.com/articles/confirmation-dialog/

**"Hold to confirm" pattern (Dhiwise / LogRocket research)**
For truly destructive single actions, some apps use a "hold and hold button" pattern (Snapchat story delete, some fintech apps). This is too heavy for a creation flow where "Yes, I have accommodation locked in" is a normal positive answer.

### Recommendation

Two large cards displayed side by side, full-width of the step container divided 50/50. Each card: 100pt tall, 16pt padding, a relevant icon at top-center (lock icon for "Yes, I have a place locked in", search icon for "No, still looking"), a title in medium weight, a 1-line description below.

**Immutability signal:** A small muted line below the two-card row, centered: "This can't be changed after you continue." No icon, no red color — just a matter-of-fact note in a small muted font. This is the Stripe/Linear pattern: state the constraint once, plainly, without alarm.

**After selection:** The selected card gets a colored border. Then automatically scroll to the next section (or auto-advance to the next step) — do not wait for the user to tap "Next". The self-advancing behavior (as seen in many conversational onboarding flows) works well for binary Yes/No gates.

If the user selects "Yes": the form expands to show the accommodation name, URL, and photo fields below the two cards (or in the next step). The expansion should animate smoothly.

### RN/Expo Implementation Note

- Two `TouchableOpacity` cards in a `flexDirection: 'row'` with `gap: 12`.
- Selected card: `borderColor: brandColor, borderWidth: 2`. Unselected: `borderColor: grayLight, borderWidth: 1`.
- Auto-advance: after selection, call `setTimeout(() => scrollToNextSection(), 250)` to give a brief visual confirmation before moving on.
- The "can't change later" label: `Text` component below the row, `textAlign: 'center'`, `fontSize: 12`, `color: grayMuted`.
- In edit mode (`initialTrip` is set), the two cards should be displayed as disabled / read-only (reduced opacity, `pointerEvents: 'none'`) since `accommodationLocked` is treated as immutable in edit mode per the existing code.

---

## 12. Tier Picker — Budget Low/Mid/High with USD Ranges

### Survey

**Airbnb price filter tiers**
Airbnb's filter UI doesn't use named tiers (Budget / Mid-range / Premium) — it uses a continuous price range slider with a histogram overlay. However, Airbnb's host pricing guidance uses informal tier language: "budget stays", "mid-range", "luxury". The implicit recommendation model (suggesting hosts set competitive prices) uses color coding and small "good value" / "popular" badges.

**Booking.com budget categories**
Booking.com shows star-rating filters and price range filters, but not named budget tiers. The closest is their "Budget-friendly" / "Mid-range" / "Luxury" category strip on the homepage — these are pill filters with no price ranges shown. Users must apply multiple filters to understand what "budget" means in their destination.

**Klook tour tiers**
Klook explicitly uses price tier cards in certain tour categories. Each card shows: tier name (e.g., "Standard", "Premium"), price range per person ("$120–180"), and a brief description ("Includes accommodation, guide, and transport"). The "recommended" tier gets a colored badge ("Popular choice"). This is the closest reference to what Swellyo needs.

**Pricing UI / plan selection best practices (Setproduct research)**
The consensus for 3-tier plan pickers: (1) Make the middle tier the visual anchor — slightly taller, highlighted border, "Recommended" badge. (2) Show the price range prominently, larger than the description text. (3) Include "per person" or "total" clarification — ambiguity here is a source of user distrust. (4) Use an asymmetric layout where the middle card stands taller than the two flanking cards.
Source: https://www.setproduct.com/blog/pricing-ui-design

**AI-estimated badge usage**
When an AI generates data that is shown to users, transparency is important. Airbnb shows AI-suggested pricing with an "AirCover suggested" label. Stripe shows AI-fraud-score labels with a clear "Radar" branding. The pattern: show the AI source + a small info icon that opens a tooltip explaining the methodology.

### Recommendation

Three cards in a horizontal row (or stacked if screen width < 360dp). The "Mid-range" card is the visual anchor: slightly taller bottom padding or a "Best for most trips" badge in the brand color at the top. Each card contains:

- Tier name: "Budget" / "Mid-range" / "Premium" in bold
- USD range: "$400 – $800" in large (18pt) font — this is the most important piece of information
- "per person, excl. flights" in small muted text below the range — this disambiguation is non-negotiable for real travel commitments
- A 1-line description: e.g., "Hostel or guesthouse, shared transport" for budget

**AI-estimated badge:** A small pill button labeled "AI estimate" with an info icon beside the range. Tapping it shows a brief tooltip: "Estimated from destination, duration, and similar trips. Adjust if needed." This follows the Stripe/Airbnb AI-transparency pattern.

**If AI estimate is unavailable (fallback):** Show two free-text `TextInput` fields for `budgetManualMin` and `budgetManualMax` (already in the state) with a label "Enter your budget range (USD)". The tier cards should be disabled/grayed with a note: "Budget estimate unavailable for this destination."

### RN/Expo Implementation Note

- Three `TouchableOpacity` cards in a `flexDirection: 'row'` with `flex: 1` on each.
- The "Mid-range" card visual anchor: use `paddingVertical: 20` vs `16` for the flanking cards, plus a colored badge `View` at the top with `position: 'absolute', top: -10, alignSelf: 'center'`.
- AI estimate tooltip: `Modal` or `Popover` triggered by the info button. A simple `Modal` with `transparent: true` and an absoluteFill backdrop is the easiest implementation.
- The `formatRange` utility already exists in the file (`formatRange = (r) => ...`). Use it.
- The `budgetEstimate` object from the GPT call already contains `{ low: {min, max}, medium: {min, max}, high: {min, max} }` — map these directly to the three cards.
- Currency: currently hardcoded to USD. If multi-currency is added later, the "per person, excl. flights" disclaimer helps users understand what the number includes regardless of currency.

---

## 13. Combined Input Cluster — Locked Accommodation (Name + URL + Photo)

### Survey

**Airbnb listing photo + title cluster**
Airbnb's listing edit screen puts the primary photo at the top of the cluster, then the listing title below it, then additional fields. The visual hierarchy communicates: the photo is the most visually impactful element — lead with it. Title is secondary. Other fields (description, pricing) are tertiary.

**Eventbrite event creation: venue info**
Eventbrite's venue section order: venue name (required) → address → URL (optional). Photo is handled separately in a dedicated step. This separation (photo in its own step vs combined with name/URL) works for Eventbrite's multi-step wizard but would add step count to Swellyo's already-5-step flow.

**Yelp business creation**
Yelp puts: name → category → address → phone → website URL. Photo is handled after creation ("claim your business" flow). The field order follows importance to the user, not technical requirements.

**General form field ordering (UXmatters, UXplanet)**
"Collect the information that is central to your form's purpose first." For accommodation: the name is the most semantically important (what place is it?) — it should come first. The URL is supplementary (where can people read more?). The photo is the richest media element and should sit either first (visual hierarchy) or last (photo is optional to add, even if technically required).
Source: https://uxplanet.org/designing-more-efficient-forms-structure-inputs-labels-and-actions-e3a47007114f

**Required vs optional visual marking**
When all fields are required, do not use asterisks — instead, use a single line below the section header: "All fields required." This reduces visual noise vs marking each individual field. (Source: form design consensus across UXmatters, Smashing Magazine, Ventureharbour.)
Source: https://ventureharbour.com/form-design-best-practices/

### Recommendation

Field order: Name → URL → Photo. Rationale: name is text (fastest to input, clearest mental anchor), URL is supplementary context (user has it open in a browser), photo is the heaviest step (picker + crop). This order follows cognitive load progression from easy to heavier.

**Accommodation name:** Standard `TextInput` with label "Accommodation name", placeholder "e.g., Surf Shack Hostel". No character limit needed (URLs are the natural constraint). Validation: non-empty on blur.

**URL field:** `TextInput` with `keyboardType="url"` (shows `@` and `/` keys on iOS). Placeholder "Booking page or website". Real-time validation: on blur, check if the string starts with `http://` or `https://`. If not: show an inline message "Add https:// to the start" and auto-prepend it. If it starts correctly: show a green checkmark inline. Do not make a network request to validate the URL — this is over-engineering for a creation flow. A format check is sufficient.

**Photo upload:** Same pattern as the hero photo (see Component 2) but without the 12:5 aspect ratio constraint — use a square or 4:3 crop. Keep the tap-to-upload dashed zone with camera icon, same shimmer-on-upload UX.

**"All fields required" note:** Show a single line below the section title: "All three fields are required." No asterisks.

### RN/Expo Implementation Note

- URL auto-prepend: `if (!value.startsWith('http')) setState(v => 'https://' + v)` on blur.
- `keyboardType="url"` on iOS surfaces the `/` and `.com` keys. On Android, this behaves the same as `"default"` in most keyboard implementations — that is acceptable.
- Inline green checkmark: `Ionicons` `checkmark-circle` icon, rendered conditionally to the right of the URL input inside the input container. Use an `InputAccessoryView` pattern or a simple absolutely-positioned View within a relative-positioned container.
- The photo for locked accommodation uses the same `uploadTripImage` service call and `expo-image-picker` flow as the hero image. Consider extracting a reusable `TripPhotoUploader` component that both uses.

---

## 14. Inline Preview / Summary Card (Preview Step)

### Survey

**Airbnb listing preview**
Airbnb's host flow includes a dedicated preview step showing exactly how the listing will appear in search results. The preview is an actual rendered version of the listing card, not a static mockup. Below the preview: a "Go live" / "Publish later" choice. The preview step is positioned as the last step and acts as both a review checkpoint and a confidence-building moment ("this is what travelers will see").
Source: https://medium.com/@y.luthfi.r/airbnb-ux-case-study-host-your-home-909ea66dece4

**Strava activity card**
Strava's activity card shows: hero map or photo thumbnail, activity name, key stats (distance, time, elevation) in a 3-column row, and the athlete's avatar + timestamp. The card is interactive — tapping drills into the full activity. On the creation side, Strava shows a preview of the activity card before saving.

**Eventbrite event card preview**
Eventbrite allows users to "Preview" their event in the upper-right corner of the creation wizard at any time — it's available throughout the creation flow, not just at the end. The preview opens a new browser tab showing the event exactly as attendees will see it.
Source: https://www.eventbrite.com/help/en-us/articles/551351/how-to-create-an-event/

**Multi-step form best practices (Smashing Magazine)**
"Present users with a summary of the choices they made throughout the wizard near the end of the process to allow them to review and double-check their input before finishing." The summary step reduces errors and increases user confidence. It should show all entered data in a compact but readable format.
Source: https://www.smashingmagazine.com/2024/12/creating-effective-multistep-form-better-user-experience/

**Instagram story / WhatsApp status preview**
Both show a fullscreen preview of the media + text before posting. The "Preview = final product" principle: the preview step should look exactly like the published card, not a form-style summary.

### Recommendation

The preview step should render the actual trip card as it will appear in `TripsScreen`, not a form recap. This means the same component used to display trips in the feed is reused here — the user sees the exact output of their work.

**Card contents and hierarchy:**
1. Hero photo at full width (12:5 crop, same as production card)
2. Title in 17pt bold, 1 line with ellipsis
3. Destination + date range on one line (e.g., "Bali, Indonesia · Aug – Oct 2026")
4. Budget tier + range: "Mid-range · $800 – $1,500 / person"
5. Vibe + skill level chips: small pills in a horizontal strip ("Surf-focused", "Intermediate", "Advanced")
6. Wave shape chips: "Barrel wave", "Wally wave"
7. Board types: "Shortboard", "Mid-length"
8. Accommodation type: "Surf camp"

Below the card preview: an "Edit" button per section (small text links: "Edit basics", "Edit surf setup", etc.) that navigate back to the relevant step. This is the Airbnb pattern — preview + granular edit links, not a single "Go back" button.

**What to show vs omit from the preview:**
- Show: everything that appears on the public-facing card (title, photo, destination, dates, budget, vibe, skill level, wave size, board type)
- Omit from card (but show in a "Visibility settings" sub-section below): visibility setting (public/friends/private), age range, exact accommodation details — these are administrative/matching details, not what the public card shows.

**Interactivity:** The card preview itself should be non-tappable (purely visual). The edit links are the interaction point. Do not make the card tappable in this context — it creates ambiguity about what tapping would do.

### RN/Expo Implementation Note

- Reuse the trip card component from `TripsScreen` directly. If it doesn't exist as a standalone component yet, extract it into `src/components/trips/TripCard.tsx` and use it in both `TripsScreen` and the preview step.
- Missing fields (e.g., hero image not yet uploaded): render gracefully — show a placeholder gradient or a "Add a cover photo" prompt inside the hero area.
- The "Edit basics" / "Edit surf setup" links: these are `TouchableOpacity` with `Text` that call `setCurrentStep('basics')` or equivalent — the wizard already has step state management.
- The preview step does not need to call any API — it is entirely local state rendered visually. The actual save happens when the user confirms from the preview step.
- Scroll behavior: the preview card + edit links may exceed one screen on shorter devices. Wrap the preview step in a `ScrollView`.
- Reanimated `FadeIn` entry animation on the preview card creates a satisfying "reveal" moment — strongly recommended for the emotional payoff of completing the form.

---

## Summary Table

| # | Component | Core Pattern | Priority Fix |
|---|-----------|-------------|-------------|
| 1 | Trip title input | Always-visible `n/28` counter + live card preview | Add live preview below input |
| 2 | Hero photo upload | Dashed tap zone → action sheet → crop → shimmer | Add shimmer, crop to 12:5 |
| 3 | Destination picker | Bottom sheet + popular surf destinations pills default state | Pre-typed state with surf destination pills |
| 4 | Date picker modes | Segmented control + month-chip row for fuzzy, calendar for exact | Replace month dropdowns with chip row |
| 5 | Duration input | Preset chips (3/5/7/10/14d) + Custom text input | Replace free input with chip row |
| 6 | Segmented control | Custom 2-pill track, `withSpring` animated fill | Custom control (not native — Android looks bad) |
| 7 | Multi-select chips | Rows of 3 for small sets, 2x2 grid for board types | 2x2 grid for board types, 44pt tap targets |
| 8 | Wave size slider | Dual handle + value labels above thumbs + range text below | Add floating value labels, track fill color |
| 9 | Card-list selector | Vertical radio cards for 3-option sets, 2-col icon grid for 9-option | Grid for accommodation types |
| 10 | Age range inputs | Side-by-side numeric inputs, not slider; span validation on blur | Replace any slider intent with text inputs |
| 11 | Yes/No gate | Two large cards side-by-side + "can't change this later" note | Add immutability note, auto-advance on selection |
| 12 | Budget tier picker | 3 horizontal cards, mid-range anchored/recommended, AI badge | Mid-range as visual anchor, "per person" clarification |
| 13 | Locked accommodation cluster | Name → URL → Photo order, URL format validation, "all required" note | URL auto-prepend, inline green checkmark |
| 14 | Preview card | Render actual trip card component, edit links per section | Extract TripCard component, FadeIn reveal |

---

## Sources

- [Airbnb listing title guidelines](https://www.airbnb.com/resources/hosting-homes/a/guidelines-for-writing-your-listing-title-533)
- [Guesty: Airbnb title character limitation](https://help.guestyforhosts.com/hc/en-gb/articles/11783015183133-Airbnb-Listing-Title-Character-Limitation)
- [Eventbrite: upload your main event image](https://www.eventbrite.com/blog/ds00-easily-upload-your-main-event-image/)
- [Eventbrite: how to create an event](https://www.eventbrite.com/help/en-us/articles/551351/how-to-create-an-event/)
- [Airbnb: flexible dates explained](https://www.rentalscaleup.com/airbnb-flexible-dates/)
- [Google Flights flexible date search](https://support.google.com/faqs/answer/2736592?hl=en)
- [Skyscanner whole-month search tips](https://www.skyscanner.com/tips-and-inspiration/skyscanner-tips-and-tools-how-to-search-flight-prices-across-whole-month)
- [Mobiscroll: date pickers in flight booking apps](https://blog.mobiscroll.com/date-pickers-in-flight-booking-apps/)
- [NN/G: slider design rules of thumb](https://www.nngroup.com/articles/gui-slider-controls/)
- [Eleken: 40 real-world slider UI examples](https://www.eleken.co/blog-posts/slider-ui)
- [Material Design 3: chips guidelines](https://m3.material.io/components/chips/guidelines)
- [Mobbin: chip UI design examples](https://mobbin.com/glossary/chip)
- [NN/G: confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)
- [Setproduct: pricing UI design](https://www.setproduct.com/blog/pricing-ui-design)
- [Smashing Magazine: effective multistep forms (2024)](https://www.smashingmagazine.com/2024/12/creating-effective-multistep-form-better-user-experience/)
- [UXplanet: designing more efficient forms](https://uxplanet.org/designing-more-efficient-forms-structure-inputs-labels-and-actions-e3a47007114f)
- [Ventureharbour: 58 form design best practices](https://ventureharbour.com/form-design-best-practices/)
- [Bumble age range change guide](https://www.thematchartist.com/bumble/how-to-chang-age-range-on-bumble)
- [Usability Geek: Bumble UX case study](https://usabilitygeek.com/ux-case-study-bumble/)
- [Airbnb UX case study (host your home)](https://medium.com/@y.luthfi.r/airbnb-ux-case-study-host-your-home-909ea66dece4)
- [Apple HIG: segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
- [Airbnb's search and browse: deep dive](https://medium.com/@Barely-thinking/airbnbs-search-and-browse-functionality-a-deep-dive-40310a6fcd74)
- [Hopper redesign case study](https://medium.com/@wickendall/redesigning-the-hopper-app-4be24ed77d88)
- [React Native Reanimated: slider example](https://docs.swmansion.com/react-native-reanimated/examples/slider/)
- [react-native-fast-range-slider (amitpdev)](https://github.com/amitpdev/react-native-fast-range-slider)
