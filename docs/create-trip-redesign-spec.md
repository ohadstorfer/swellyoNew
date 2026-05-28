# Create-Trip Redesign Spec — Flow A

> Implementation brief for the full UX/UI overhaul of `src/screens/trips/CreateTripFlowA.tsx`.
> Inputs: `design-language-snapshot.md`, `create-trip-friction-audit.md`, `wizard-ux-research.md`, `component-ux-research.md`.
> Out of scope: `CreateTripWizard.tsx` (hosting-style chooser), `CreateTripFlowC.tsx`, DB schema changes.
> Touches the same 5 steps the current flow ships: **basics → surfSetup → accommodation → budget → preview**.

When the four research docs conflict, the resolved choice and a one-line "why" is given inline.

---

## 1. Vision

- The 5-step form stops feeling like a back-office data-entry sheet and starts feeling like the conversational, surf-aware on-boarding pattern already shipping in `OnboardingStep1Screen` / `OnboardingWelcomeScreen`. Same font stack, same teal, same pill button, same card weight.
- Every step now has one large conversational heading ("What waves are you chasing?") and one short subtitle. The fraction counter is small, muted, and sits above the heading — never as separate chrome.
- Validation moves from full-screen `Alert.alert('Hold on', …)` dialogs to inline field errors that fire on blur for text fields and on Next for everything else, with the failing field scrolled into view. No more dead-end "Hold on" modals.
- Mobile-correct keyboard handling everywhere: `react-native-keyboard-controller`'s `KeyboardAwareScrollView` with `bottomOffset` set to the footer height, and the sticky footer animating up with `useReanimatedKeyboardAnimation`. The "Next" button is always visible above the keyboard.
- All 5 production bugs (months-mode validation hole, edit-mode budget regression, silent accommodation-photo failure, back-during-submit race, RangeSlider scroll-steal) are fixed in the same rewrite — no follow-up PR.

---

## 2. Design Tokens for the Flow

Single source. These override the legacy `theme.ts` brown/peach palette completely. **Do not import** `colors.primary` / `colors.buttonBackground` / `Button.tsx` / `Input.tsx` — those are dead code.

### Colors

| Token | Hex | Use |
|-------|-----|-----|
| `brandTeal` | `#0788B0` | Primary CTA, progress fill end-stop, focused field border, selected card border, active chip bg, brand accents |
| `brandTealLight` | `#00A2B6` | Hover / pressed state on teal surfaces, secondary teal accents |
| `cyan` | `#05BCD3` | Progress fill start-stop (gradient), filled-field check icon, subtle accent on selected lifestyle-style cards |
| `brandTealTint` | `#E6F4F8` | Selected-card background fill, range-rail fill, AI-estimate badge bg |
| `inkDark` | `#212121` | Primary button bg (near-black, never teal — matches OnboardingStep1), header titles |
| `inkBody` | `#222B30` | Body text, headings, back-arrow color |
| `inkMid` | `#333333` | Bot message body, secondary body text |
| `textMuted` | `#7B7B7B` | Helper text, subtitles, "Step X of 5" label, fraction counter |
| `textPlaceholder` | `#B0B0B0` | Input placeholder text |
| `borderField` | `#CFCFCF` | Unfocused input border |
| `borderCard` | `#E0E0E0` | Default card / chip border |
| `borderHairline` | `#EEEEEE` | Section divider, footer top border |
| `surfaceCard` | `#FFFFFF` | Card surface, input bg, sheet bg |
| `surfaceScreen` | `#FAFAFA` | Screen background |
| `surfaceMuted` | `#F2F2F2` | Inactive segment bg, photo placeholder bg, unselected chip bg |
| `error` | `#FF0000` | Field error border (matches `Input.tsx:54` red), required asterisk |
| `errorText` | `#C0392B` | Inline error message text |
| `errorBg` | `#FDECEA` | Inline error banner bg (only used for severe errors) |
| `success` | `#34C759` | Success checkmark on URL field |
| `progressTrack` | `#BDBDBD` | Progress bar track (matches `theme.ts` `progressBackground`) |

**Resolved conflict (friction audit divergence #5):** The wizard primary CTA is `#212121` (matches every onboarding-step CTA), NOT teal. Teal is reserved for highlights / progress / selected state. Why: `OnboardingStep1Screen.tsx:405` and the entire onboarding scaffold use `#212121`; the current trip flow is the lone outlier.

### Typography

Use `Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat'` for Montserrat refs, same pattern for Inter. Never use the `System` fallback.

| Style | Size / Line | Weight | Family | Use |
|-------|-----|---|---|---|
| `stepHeading` | 24 / 30 | 700 | Montserrat | Step heading ("What waves are you chasing?") |
| `stepSubtitle` | 14 / 20 | 400 | Inter | One-line subtitle below heading |
| `stepCounter` | 12 / 16 | 600 | Inter | "Step 2 of 5" above heading (`textMuted`) |
| `sectionTitle` | 18 / 24 | 700 | Montserrat | "Visibility & invite" on preview step, group headers within a step |
| `fieldLabel` | 14 / 20 | 600 | Inter | Label above each field |
| `fieldOptional` | 12 / 16 | 500 | Inter | "(optional)" inline next to field label, `textMuted` |
| `fieldValue` | 16 / 22 | 400 | Inter | Filled input text |
| `fieldPlaceholder` | 15 / 20 | 400 | Inter | Empty input placeholder, `textPlaceholder` |
| `helperText` | 13 / 18 | 400 | Inter | Below-field helper, `textMuted` |
| `errorMessage` | 12 / 16 | 500 | Inter | Inline field error, `errorText` |
| `chipText` | 14 / 18 | 600 | Inter | Chip / pill label |
| `cardTitle` | 16 / 22 | 700 | Montserrat | Selectable card title |
| `cardDesc` | 13 / 18 | 400 | Inter | Selectable card description |
| `buttonPrimary` | 16 / 22 | 700 | Montserrat | Primary CTA label (matches `OnboardingStep1Screen.tsx:409`) |
| `buttonSecondary` | 14 / 20 | 600 | Inter | Secondary / back button label |
| `counterPair` | 13 / 18 | 600 | Inter | Trip-title character counter ("14 / 28") |

### Spacing

Use `src/styles/theme.ts` tokens: `xs:4 sm:8 md:16 lg:24 xl:32`. Concrete values inline:

| Use | Value |
|-----|-------|
| Screen horizontal padding | `16` (md) |
| Step content top padding | `20` |
| Step content bottom padding | `120` (above sticky footer with safe area) |
| Field gap (between field group + next label) | `20` |
| Inside-field-group gap (label → input) | `8` |
| Inline row gap | `12` |
| Chip row gap | `8` |
| Card row gap (option cards, vibe etc.) | `10` |
| Hero photo aspect ratio | `12 / 5` |

### Radius

| Token | Value | Use |
|-------|-------|-----|
| Field / input | `12` |
| Card (option / accommodation tile / vibe / visibility) | `16` |
| Chip | `12` (matches `chipText` size; standard pill, not full-pill) |
| Photo zone | `16` |
| Sticky footer top corners | none (flat top, sits on hairline border) |
| Primary button | `28` (pill — 56pt height / 28 radius, matches onboarding `gradientButton`) |
| Secondary back button (ghost) | `28` |
| Progress bar track / fill | `2` (half of 4-pt height) |

### Shadows

| Use | Spec |
|-----|------|
| Selected card | `shadowColor:'#596E7C', offset:{0,2}, opacity:0.12, radius:12` (Android `elevation:2`) |
| Sticky footer | `shadowColor:'#000', offset:{0,-2}, opacity:0.06, radius:8` (Android `elevation:6`) |
| Photo upload zone (hovered/pressed) | none — borders only |

---

## 3. Global Wizard Chrome

### 3.1 Header / Progress Indicator

A single thin pill with cyan→teal gradient, plus a small fraction counter, sitting in a `SafeAreaView edges={['top']}` band at the top of the screen. This replaces the current `progressBar` style.

```
┌────────────────────────────────────────────────────┐
│  ‹                                              ✕  │  ← back chevron (left), close X (right). 44×44 tap.
│                                                    │
│      [━━━━━━━━━━━━━━━━━░░░░░░░░░░]                │  ← 4dp pill, 280pt max width, centered
│              Step 2 of 5                           │  ← 12/600 Inter, textMuted, marginTop:6
│                                                    │
└────────────────────────────────────────────────────┘
   borderBottom: 1px #EEEEEE
```

Exact spec:

- Container: `paddingHorizontal:16, paddingTop:8, paddingBottom:12, borderBottomWidth:1, borderBottomColor:#EEEEEE`.
- Top row: `flexDirection:'row', alignItems:'center', justifyContent:'space-between', height:44`.
  - Left: back chevron `<Ionicons name="chevron-back" size={28} color="#222B30" />` with `padding:8, hitSlop:{10,10,10,10}`. On Step 1 it acts as the chooser back; on Steps 2–5 it goes to previous step. Disabled with `opacity:0.4` while submitting.
  - Right: close `<Ionicons name="close" size={26} color="#222B30" />` with same padding/hitSlop. Triggers `discardConfirm()` if any field has been touched, else calls `onCancel()`.
- Progress track:
  - `height:4, width:280, borderRadius:2, backgroundColor:#BDBDBD, overflow:'hidden', alignSelf:'center', marginTop:8`.
  - Fill: `LinearGradient` from `expo-linear-gradient`, colors `['#05BCD3', '#0788B0']`, `start:{x:0,y:0.5}, end:{x:1,y:0.5}`. Width = `((stepIdx + 1) / 5) * 280` animated via `withTiming(targetWidth, { duration: 320, easing: Easing.out(Easing.cubic) })`.
- Fraction counter: `<Text>Step {stepIdx+1} of 5</Text>` directly below the bar, `marginTop:6, fontSize:12, fontWeight:'600', color:'#7B7B7B', textAlign:'center'`.

**Resolved conflict (wizard research §1 vs §8):** Wizard research recommends "Step X of Y" above the heading, but `design-language-snapshot.md` shows the onboarding pattern as a top-of-screen pill bar. We place the bar at the top (matches onboarding muscle memory) AND echo the fraction counter under the bar (gives explicit position). The step heading sits inside the scroll content — that's a separate `Text`, not part of the header chrome.

### 3.2 Sticky Footer

```
─────────────────────────────────────────────  hairline #EEE
│                                            │
│  ┌─────────┐  ┌───────────────────────┐    │
│  │  Back   │  │     Next step →       │    │  ← back: ghost, 1/3 width. CTA: filled, 2/3 width.
│  └─────────┘  └───────────────────────┘    │
│                                            │
─────────────────────────────────────────────  safe area bottom inset
```

Exact spec:

- Outer: `position:'absolute', left:0, right:0, bottom:0, backgroundColor:'#FFFFFF', borderTopWidth:1, borderTopColor:'#EEEEEE', paddingHorizontal:16, paddingTop:12, paddingBottom: max(insets.bottom, 12)`.
- Inner row: `flexDirection:'row', gap:12, alignItems:'stretch'`.
- Back button (ghost): `flex:1, height:56, borderRadius:28, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center', justifyContent:'center'`. Label: `buttonSecondary` style, color `#222B30`. **Hidden on Step 1** (the left slot is empty; the primary CTA takes full width).
- Primary CTA: `flex:2 when back visible, flex:1 when not, height:56, borderRadius:28, backgroundColor:'#212121', alignItems:'center', justifyContent:'center'`. Label: `buttonPrimary` style, color `#FFFFFF`. Disabled: `opacity:0.6`. Loading (final step submit): replace label with `<ActivityIndicator color="#FFFFFF" />`.

CTA label per step (exact strings):

| Step | Label |
|------|-------|
| 1 basics | `Set surf details` |
| 2 surfSetup | `Pick your stay` |
| 3 accommodation | `Estimate budget` |
| 4 budget | `Preview trip` |
| 5 preview (create) | `Publish trip` |
| 5 preview (edit) | `Save changes` |

**Resolved conflict (friction audit "Continue vs Next inconsistency"):** Use specific verb+noun labels (wizard research §2 + §11), not generic "Next". Cleans up the lone "Continue" on accommodation.

Back button:
- Step 1: hidden; left slot empty.
- Steps 2–5: visible, label `Back`.
- Disabled (opacity 0.4, no taps) while `submitting === true`. Fixes friction-audit bug #3.

### 3.3 Step-transition animation

Use **Reanimated v3 layout animations on the step content `View`**, NOT React Navigation. The wizard is a single screen with `stepIdx` state — putting it in a `Stack.Navigator` would add navigation lifecycle complexity we don't need.

- Forward (Next): outgoing step exits `SlideOutLeft.duration(220)`, incoming step enters `SlideInRight.duration(260).easing(Easing.out(Easing.cubic))`.
- Backward (Back): outgoing `SlideOutRight.duration(220)`, incoming `SlideInLeft.duration(260)`.
- Step 5 (preview): override — incoming enters `FadeIn.duration(280)`. Signals the "this is your trip" reveal moment (per component research §14 + wizard research §6).

Implement by tagging the step container `<Animated.View key={step} entering={…} exiting={…}>`. A `direction` ref tracks Next vs Back so the correct animation set fires.

**Resolved conflict (wizard research §6 recommended React Navigation native-stack):** We diverge here. The whole wizard is one modal; introducing a stack inside it is heavier than the Reanimated approach and breaks the existing `<HomeBreakSearchSheet>` modal layering. Reanimated `SlideInRight/Left` is GPU-accelerated in v3 and matches the documented "feels native" requirement.

### 3.4 Keyboard handling

Mandatory architecture — fixes friction-audit divergence #2.

```tsx
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

const FOOTER_HEIGHT = 80; // 56 button + 24 vertical padding

function CreateTripFlowA(props) {
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const insets = useSafeAreaInsets();

  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardHeight.value }],
  }));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      <WizardHeader … />
      <KeyboardAwareScrollView
        bottomOffset={FOOTER_HEIGHT + insets.bottom + 16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: FOOTER_HEIGHT + 24 }}
      >
        {renderStep()}
      </KeyboardAwareScrollView>
      <Animated.View style={[styles.footer, footerStyle]} pointerEvents="auto">
        <WizardFooter … />
      </Animated.View>
    </SafeAreaView>
  );
}
```

Notes:
- `KeyboardAwareScrollView` from `react-native-keyboard-controller` (already in deps via `useReanimatedKeyboardAnimation` used elsewhere). Verify import path against installed version.
- `keyboardHeight` is `0` when keyboard is dismissed, negative-of-keyboard-height when shown; the footer translates with it to sit above the keyboard.
- Scroll resets to top on step change: pass a `ref` to `KeyboardAwareScrollView` and call `scrollToPosition(0, 0, false)` in a `useEffect` keyed to `stepIdx`. Fixes the "step opens mid-scroll" issue.
- Auto-focus: see per-step rules in §4. Use `useFocusEffect`-style focus on the first text field of a step ONLY on Step 1 (the title field); other steps with text inputs (3 accommodation name, 4 budget manual) do NOT auto-focus — those fields are conditional.

### 3.5 Draft-autosave behavior

Per wizard research §4: create the draft as soon as the user completes the first meaningful action (tapping Next on Step 1). Until then, no draft exists.

- **AsyncStorage key:** `@swellyo/createTripDraft`.
- **Payload shape:** `{ state: WizardState, stepIdx: number, hostingStyle: HostingStyle, savedAt: ISOString, schemaVersion: 1 }`. Pure serializable WizardState — note `Date` objects become ISO strings, restored via `parseISODate`.
- **Write trigger:** every successful Next tap (after `validateStep()` passes), and every step's "blur" / `onChange` for text fields (debounced 500ms). Write is non-blocking (`AsyncStorage.setItem` fire-and-forget).
- **Read trigger:** on `CreateTripFlowA` mount with `editMode === false`. If a draft exists AND `savedAt` is within 30 days:
  - Show a one-time **resume sheet** (bottom sheet, 40% screen height) before rendering Step 1, with copy:
    - Title: `Pick up where you left off?`
    - Body: `You were planning a trip{destinationText ? ' to ' + destinationText : ''} — Step {n} of 5 was next.`
    - Buttons: `Start fresh` (ghost) and `Continue` (primary). Continue restores state + `stepIdx`. Start fresh deletes the draft and starts at Step 1 with `INITIAL_STATE`.
- **Clear trigger:** on successful submit (`onCreated()` is about to fire) and on the user choosing "Discard" in the discard-confirm prompt.
- **Edit mode:** draft logic is fully bypassed — `editMode === true` always starts from `stateFromTrip(initialTrip)`.

Not creating draft rows in `group_trips` (avoids polluting the DB with abandoned drafts and the related "status: 'draft'" column that doesn't exist). AsyncStorage is the storage layer for in-flight drafts; DB is only written on Publish.

### 3.6 Discard-confirm prompt

Triggered by: close-X tap (top-right header), OS back gesture on Android, or external `onCancel()` while `hasBeenTouched === true`.

A `hasBeenTouched` boolean is set to `true` on first state mutation in any field. Until it flips, exit is silent.

When triggered: show RN `Alert.alert` (matches `TripsScreen.tsx:322-332` pattern):

- Title: `Discard your new trip?`
- Message: `Any details you've entered won't be saved.`
- Buttons:
  - `Keep editing` (cancel, default)
  - `Discard` (destructive)
- On Discard: clear AsyncStorage draft, call `onCancel()`.

**Resolved conflict (wizard research §2 recommended bottom-sheet):** Use `Alert.alert` instead — matches every other discard prompt in the app (TripsScreen, TripDetailScreen) for consistency. Adding a custom sheet just for this is over-design.

---

## 4. Per-Step Layout & Content

### Step 1 — Basics

**Heading:** `Plan your trip`
**Subtitle:** `Start with the name, the place, and when you're going.`

Fields in display order. Field gap between groups = `20`. Inside-group gap = `8`.

#### 1.1 Trip name (required)

- **Label:** `Trip name` + right-aligned counter `{title.length} / 28`.
  - Counter color: `#7B7B7B` default → `#E5A100` (amber) at 22–26 chars → `#C0392B` (errorText) at 27–28.
- **Input:** standard `TextInput`, height 56, radius 12, border `#CFCFCF`, paddingH 16. Filled text style `fieldValue` (`#222B30`).
- **Placeholder:** `e.g. Bali and Barrels` (`#B0B0B0`).
- **maxLength:** 28.
- **Auto-focus:** YES on Step 1 mount. Fires keyboard immediately.
- **Keyboard:** `default`. **returnKeyType:** `next` — moves focus to nothing (next field is photo picker, not text) — actually use `default` to avoid the next-button confusion.
- **Live preview row** (below input, marginTop 8): a 1-line `<Text>` styled identically to the production trip card title — `fontSize:16, fontWeight:'700', color:'#222B30', numberOfLines:1, ellipsizeMode:'tail'`. Shows the typed title or the placeholder `Your trip will look like this` in `textPlaceholder`. Visual teaching mechanism per component research §1.
- **Validation:** on blur — `if (!title.trim()) showError('Your trip needs a name')`. Inline red text below counter, plus border turns `#FF0000`. On Next — same rule re-runs.

#### 1.2 Cover photo (required)

- **Label:** `Cover photo`.
- **Helper text:** `Looks best in landscape — we'll crop to 12:5.`
- **Visual when empty:** dashed-border zone, `aspectRatio: 12/5`, `borderWidth:2, borderStyle:'dashed', borderColor:'#CFCFCF', borderRadius:16, backgroundColor:'#FAFAFA'`. Centered content: `<Ionicons name="camera-outline" size={32} color="#0788B0" />`, then `<Text>Tap to add cover photo</Text>` in `fieldLabel` style, `#0788B0`.
- **Visual when filled:** `<Image>` filling the 12:5 zone, `borderRadius:16`. Small floating "Change photo" pill at bottom-right (`absolute, bottom:8, right:8`): `backgroundColor:'rgba(33,33,33,0.85)', borderRadius:12, paddingH:12, paddingV:6`, text `Change photo` in white 13/600.
- **Visual while uploading (only fires on submit):** filled image at full opacity with a shimmer overlay (LinearGradient white-translucent strip, translating X via Reanimated `withRepeat`, 1500ms loop).
- **Tap behavior:** show `ActionSheet` (RN `ActionSheetIOS` on iOS, custom bottom-sheet on Android) with `Take a photo` / `Choose from library` / `Cancel`. Then launch picker. Crop step uses `expo-image-picker`'s `allowsEditing:true, aspect:[12,5]` (existing approach is fine — keep).
- **Remove affordance:** long-press the filled image to show RN `Alert.alert('Remove cover photo?', '', [Cancel, Remove])`. Set `heroImageUri:null` on Remove.
- **Validation:** on Next — `if (!heroImageUri) showError('Add a cover photo to publish your trip')` and scroll to this field.

#### 1.3 Destination (required in create; locked in edit)

- **Label:** `Destination`. In edit mode add small inline gray text right-aligned: `Locked`.
- **Visual create:** picker box, same dimensions as text input (height 56, radius 12, `#CFCFCF` border). Left content: `<Ionicons name="location-outline" size={18} color="#0788B0" />` + 8pt gap + the destination string (or placeholder `Where are you heading?` in `#B0B0B0`). Right content: `<Ionicons name="chevron-down" size={18} color="#7B7B7B" />`.
- **Visual edit (locked):** same box but `backgroundColor:'#F2F2F2'`, no chevron, no tap. Text in `#7B7B7B`. Helper text below: `Destination can't be changed after a trip is created.` Friction-audit issue addressed: lock is more obvious.
- **Tap behavior:** opens existing `HomeBreakSearchSheet` (already polished — see audit). Pass `confirmTitle="Use this destination"`, `title="Pick destination"`, `searchPlaceholder="Search beaches, towns, breaks…"`. The sheet's internal hardcoded "Save" label is a tracked friction-audit divergence #13 — fix it in this rewrite by passing the title through (small `HomeBreakSearchSheet.tsx` patch). The popular-surf-destinations pre-typed state suggested in component research §3 is OUT OF SCOPE here (it lives inside that sheet's internals) — flag as a follow-up; not blocking.
- **Validation:** on Next (create) — `if (!destination.trim()) showError('Pick a destination for your trip')` and open the sheet on tap-error.

#### 1.4 Dates (required)

A two-section block: mode toggle + the active mode's picker.

##### 1.4.a Date mode toggle

- **Component:** custom 2-segment control (per component research §6 — native iOS one looks broken on Android).
- **Spec:** `height:44, backgroundColor:'#F2F2F2', borderRadius:12, padding:4, flexDirection:'row'`. Two `TouchableOpacity` segments, each `flex:1, height:36, borderRadius:8, alignItems:'center', justifyContent:'center'`. Selected segment: `backgroundColor:'#FFFFFF'` with shadow `{opacity:0.08, radius:4, offset:{0,2}, elevation:2}`. Text: selected `#222B30` 14/600 Inter; unselected `#7B7B7B` 14/500 Inter.
- **Labels:** `By month` and `Exact dates`. (Resolved per component research §6: avoid "Flexible".)
- **Default:** `'months'` for Flow A (matches current behavior).
- **Animation:** the white fill slides between segments using a Reanimated `useSharedValue` tracking the active index, `withSpring(targetIndex, { damping:18, stiffness:180 })`. Skipping animation also fine — visual jump is acceptable per friction.

##### 1.4.b Months mode picker

Replace the 12-cell grid with a **horizontally-scrollable chip row** (component research §4).

- **Container:** `<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical:4, gap:8 }}>`. 18 months from current month forward (covers "next year and a half" — surfers plan ~1 year ahead).
- **Chip:** `height:44, paddingHorizontal:16, borderRadius:22, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center', justifyContent:'center'`. Label: e.g. `Aug` or `Aug '27` if next year. Font: `chipText` (14/600 Inter, `#222B30`).
- **Selected endpoint (start or end of range):** `backgroundColor:'#0788B0', borderColor:'#0788B0'`. Label color: white.
- **In-range chip (between start and end):** `backgroundColor:'#E6F4F8', borderColor:'#9ED1E2'`. Label color: `#066b8c`.
- **Range logic:** same as current `handleMonthTap` — 1st tap sets start, 2nd tap sets end (with auto-swap), 3rd tap restarts from that month. Keep the existing logic — it's correct.
- **Below the row** (marginTop 12): live range summary in `cardTitle` style — `Aug – Oct 2027` or single-month `August 2027` or empty-state helper `Tap a month to start your range, then tap another for the end.`
- **Validation:** on Next — `if (!monthFrom) showError('Pick at least one month for your trip')`. Fixes friction-audit bug #4 (months-no-selection passes).

##### 1.4.c Exact-date mode picker

- Reuse the existing `CalendarRangePicker` component. Keep — visually cohesive, range rail is correct, summary format `Jul 5 – Jul 19 · 14 days` is clean.
- Minor refactor inside the component: enforce `Montserrat`/`Inter` fonts (currently uses system fallback). One-line styles fix.
- Validation: on Next — `if (datesMode === 'exact' && !startDate) showError('Pick a start date')`. End is auto-derived; if user picks only start, they get `endDate: null` which is allowed (current code already supports it but the duration field becomes meaningless — see 1.5).

##### 1.4.d Duration (months mode only — required)

- **Render rule:** Only visible when `datesMode === 'months'`. In `exact` mode duration is derived from start/end and this whole row is skipped.
- **Label:** `Trip length`. Right-aligned helper: `Used for the budget estimate.`
- **Visual:** replace the free-text + "days" pair with a **preset chip row** (component research §5): chips `3d`, `5d`, `7d`, `10d`, `14d`, `Other`. Same chip styling as the month chips (height 44, radius 22, brand-teal selected fill).
- **When `Other` chip is selected:** reveal a small inline 2-element row below: `TextInput` (60pt wide, number-pad, maxLength 2, value clamped 1–30 on blur) + label `days` (in `helperText` style). The text input maps to `durationValue` (string).
- **Validation:** on Next (months mode only) — `if (!durationValue || toDays(durationValue) < 1) showError('Pick a trip length')`.

#### 1.5 Trip vibe (optional — but framed as not-optional)

**Resolved conflict (friction audit "vibe is optional, looks required" vs wizard research §5 "skip vs require"):** Default vibe to `'mixed'` so it never blocks Next and never looks empty. Label has no "(optional)" tag — user can change it but doesn't need to think about it. Persisted to `trip_vibe` column.

- **Label:** `Trip vibe`.
- **Visual:** the existing card-stack with title + description, but upgraded:
  - 3 cards vertical stack, gap 10.
  - Card: `padding:16, borderRadius:16, borderWidth:1, borderColor:'#E0E0E0', backgroundColor:'#FFFFFF'`.
  - Selected: `borderColor:'#0788B0', borderWidth:2, backgroundColor:'#E6F4F8'`, plus a checkmark-circle icon top-right (`<Ionicons name="checkmark-circle" size={20} color="#0788B0" />`, absolute `top:12, right:12`).
  - Title: `cardTitle` style (Montserrat 16/700). Description: `cardDesc` style (Inter 13/400 `#7B7B7B`).
- **Default selected:** `mixed`.
- **Validation:** none.

#### 1.6 Age range (required)

- **Label:** `Who can join` + helper `Ages 16–99, span at least {ageWindow} years.` (ageWindow is 7 for Flow A.)
- **Visual:** two TextInputs side-by-side with a centered `–` separator. Each input: width auto via `flex:1`, height 56, radius 12, border `#CFCFCF`, centered text. Placeholder `Min` / `Max`.
- **Keyboard:** `number-pad`. `maxLength:2`.
- **Defaults:** empty. **Auto-fix on blur** (per component research §10): if `min` is entered but `max` is not, set `max = min + ageWindow`. If `max` is entered but `min` is not, set `min = max - ageWindow`.
- **Validation flow:**
  - On blur of either field: parse to int. If out of range (`<16` or `>99`), border turns red + inline error `Ages must be 16–99` below.
  - On Next: if either empty → `Add a minimum and maximum age`. If `max < min` → `Maximum age must be at least the minimum`. If `max - min < ageWindow` → `Age range must span at least ${ageWindow} years (currently ${max - min}).`
- **No slider.** NN/G says sliders are wrong for precise constrained integers. Numeric inputs only.

#### Step 1 validation summary (blocks Next)

- title non-empty
- heroImageUri non-null
- destination non-empty (create only)
- datesMode='months': `monthFrom` present AND duration ≥ 1
- datesMode='exact': `startDate` present (endDate optional — if set, end ≥ start)
- ageMin and ageMax both parseable, 16–99, max ≥ min, max-min ≥ ageWindow

---

### Step 2 — Surf Setup

**Heading:** `What waves are you chasing?`
**Subtitle:** `Tell future paddle-buddies what to expect.`

Field gap 20. Inside-group gap 8.

#### 2.1 Skill level (required)

- **Label:** `Skill level` + right helper `Pick one or more`.
- **Visual:** single row of 3 equal-width chip buttons (component research §7).
- **Chip:** `flex:1, height:48, borderRadius:24, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center', justifyContent:'center'`. Gap between chips: 8.
- **Labels:** `Beginner`, `Intermediate`, `Advanced`.
- **Selected:** `backgroundColor:'#0788B0', borderColor:'#0788B0'`, label color white. Unselected label `#222B30`.
- **Multi-select:** tap toggles.
- **Validation:** on Next — `if (skillLevels.length === 0) showError('Pick at least one skill level')`.

#### 2.2 Wave shape (now required — addresses friction-audit gap)

- **Label:** `Wave shape` + right helper `Pick one or more`.
- **Visual:** 3 vertical cards (same `optionCard` styling as vibe — radius 16, padding 16, selected = teal border 2pt + tint bg + checkmark icon).
- **Card content:** title + description (existing copy in `WAVE_SHAPES`).
- **Multi-select.**
- **Validation:** on Next — `if (waveShapes.length === 0) showError('Pick at least one wave shape')`. New constraint (closes friction-audit gap).

#### 2.3 Wave size (required, has sensible default)

- **Label row:** `Wave size` (left) + live value `4–8 ft` (right, `#0788B0` 14/700).
- **Visual:** refactored `RangeSlider` (see §7 for refactor decision).
  - Track: `height:6, backgroundColor:'#E0E0E0', borderRadius:3`.
  - Active fill (between thumbs): `backgroundColor:'#0788B0'`.
  - Thumbs: `width:28, height:28, borderRadius:14, backgroundColor:'#FFFFFF', borderWidth:2, borderColor:'#0788B0'`, shadow.
  - **Floating value labels:** small pill above each thumb, `backgroundColor:'#212121', borderRadius:8, paddingH:8, paddingV:4`, text `12/700 #FFFFFF`. Show only while dragging that thumb. When thumbs are within 2 units of each other, render a single combined pill centered on their midpoint.
  - **Endpoint labels:** `1 ft` at far left, `15 ft` at far right of the track, in `helperText` style.
- **Defaults:** min 4, max 8.
- **Validation:** automatic via clamp logic. `max >= min` always enforced.

#### 2.4 Board types (optional)

- **Label:** `Board types` + right `(optional)` in `fieldOptional` style.
- **Visual:** **2×2 grid** (component research §7 — better on 360dp Android than 4-wide row).
- **Each tile:** `width: '48%', aspectRatio: 3.2, marginBottom:8, borderRadius:16, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center', justifyContent:'center'`. Label: `chipText` style (14/600 Inter `#222B30`). Selected: teal border 2pt + `#E6F4F8` bg + label color `#066b8c`. No icons (Ionicons doesn't have good surfboard glyphs — keep clean).
- **Labels:** `Shortboard`, `Mid-length`, `Soft-top`, `Longboard`.
- **Multi-select.**
- **Validation:** none. Empty array maps to `['all']` on submit (existing behavior — keep but add tiny helper text below grid when empty: `Leave empty for all board types.` This addresses friction-audit "surfaces never sees fallback to 'all'").

#### Step 2 validation summary

- skillLevels.length ≥ 1
- waveShapes.length ≥ 1
- waveSizeMin ≤ waveSizeMax (auto-enforced by slider)

---

### Step 3 — Accommodation

**Heading:** `Where will you stay?`
**Subtitle:** `Even a rough idea helps people decide.`

#### 3.1 Accommodation type (now required — addresses friction-audit gap)

- **Label:** `Type`.
- **Visual:** **2-column icon grid** (component research §9). 9 items in 5 rows (last row has 1 item — fine).
- **Tile:** `width:'48%', aspectRatio:1.7, marginBottom:10, borderRadius:16, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center', justifyContent:'center', padding:12`. Selected: `borderColor:'#0788B0', borderWidth:2, backgroundColor:'#E6F4F8'`.
- **Icon (Ionicons size 28, color `#0788B0`):**
  - villa: `home-outline`
  - hostel: `bed-outline`
  - hotel: `business-outline`
  - surfcamp: `water-outline`
  - bungalow: `leaf-outline`
  - apartment: `grid-outline`
  - guesthouse: `heart-outline`
  - ecolodge: `flower-outline`
  - other: `ellipsis-horizontal-outline`
- **Label:** title only, below icon, `chipText` style.
- **Description panel below grid (conditional):** when `accommodationKind !== null`, render a small panel `marginTop:16, padding:12, backgroundColor:'#E6F4F8', borderRadius:12` with the selected kind's description. Wraps in `Animated.View entering={FadeIn.duration(200)}`. Keeps descriptions accessible without inflating the tile.
- **Validation:** on Next — `if (!accommodationKind) showError('Pick an accommodation type')`. New constraint (closes friction-audit gap).

#### 3.2 Locked-in gate (required, immutable)

- **Label:** `Do you have a specific place booked?` (friction-audit issue addressed: awkward "clearly selected a stay already?" → natural-sounding question).
- **Helper text under label:** `You can't change this after you publish.` (friction-audit issue: phrased as friendly fact, not warning).
- **Visual:** two large side-by-side cards (component research §11). Container: `flexDirection:'row', gap:12, marginTop:12`. Each card: `flex:1, padding:16, borderRadius:16, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF', alignItems:'center'`.
  - **Yes card:** Icon `<Ionicons name="lock-closed-outline" size={28} color="#0788B0" />`. Title `Yes, booked`. Subtitle `I have a place locked in.`
  - **No card:** Icon `<Ionicons name="search-outline" size={28} color="#0788B0" />`. Title `Not yet`. Subtitle `Still looking — flexible.`
- **Selected state:** `borderColor:'#0788B0', borderWidth:2, backgroundColor:'#E6F4F8'`.
- **Edit mode:** the non-selected card has `opacity:0.35, pointerEvents:'none'`. The selected card looks normal. Helper text below changes to `Locked from when you first published.` (Friction-audit issue addressed: looks intentional, not buggy.)
- **No auto-advance** (component research §11 suggested it). We keep manual Next so the user can see the conditional fields appear without a jarring step jump. The visual reward is the next-section reveal animation.
- **Validation:** on Next — `if (accommodationLocked === null) showError('Choose yes or no')`.

#### 3.3 Locked accommodation cluster (conditional — visible only when gate === Yes)

Wrapped in `<Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>` so the appearance feels deliberate.

Field order: **Name → URL → Photo** (component research §13).

- **Section helper at top of cluster:** `All three fields are required to publish.` in `helperText` style.

##### 3.3.a Name

- Label `Accommodation name`. Placeholder `e.g. Surf Shack Hostel`. Standard text input. No char limit.
- Validation on blur: non-empty.
- On Next: `if (locked && !name.trim()) showError('Add the name of your stay')`.

##### 3.3.b URL

- Label `Booking page or website`. Placeholder `https://...`.
- `keyboardType="url"`, `autoCapitalize="none"`.
- **Auto-prepend `https://`** on blur if value doesn't start with `http`. Tooltip-like helper text on focus: `We'll add https:// automatically.`
- **Inline check icon** on the right of the input when value matches a basic URL regex (`^https?:\/\/[^\s]+\.[^\s]+`): `<Ionicons name="checkmark-circle" size={20} color="#34C759" />`.
- On Next: `if (locked && !url.trim()) showError('Add the booking page or website')`. No deeper URL validation — format check is enough.

##### 3.3.c Photo

- Same picker pattern as 1.2 Cover photo but with `aspect:[4,3]` (per component research §13 — square-ish suits villa/hotel photos).
- Label `Photo of the place`. Placeholder text inside dashed zone: `Tap to add a photo.`
- **Different icon** from hero (`<Ionicons name="bed-outline" size={32} color="#0788B0" />` instead of camera) so it's visually distinct from the cover photo zone (friction-audit issue addressed).
- On Next: `if (locked && !accommodationImageUri) showError('Add a photo of your stay')`.

#### Step 3 validation summary

- accommodationKind ≠ null
- accommodationLocked ∈ {true, false}
- if locked === true: name + url + image all present

---

### Step 4 — Budget

**Heading:** `What's the budget?`
**Subtitle:** `We'll estimate it. You confirm.`

#### State machine on arrival

On entry to Step 4: read estimate state.
- `budgetLoading === true`: show **partial loading state**, not full-screen spinner. The 3 tier cards are rendered as skeleton shimmer rows (3 stacked `Skeleton` rows from `src/components/skeletons/Shimmer.tsx`). Back button stays available. (Friction-audit issue: full-step spinner removed.)
- `budgetEstimate !== null && !error`: render the 3 tier cards.
- `budgetError && !budgetEstimate`: render manual-fallback mode.
- `editMode === true`: skip the estimate entirely. Render manual mode preloaded with the existing trip's budget. Header subtitle changes to `Confirm the budget for your trip.` (no estimate happening). Fixes friction-audit issue: "edit mode looks like an error state."

#### Estimate trigger

- In create mode: kick off `maybeEstimateBudget()` when leaving Step 3 (current behavior — keep).
- In edit mode: never run the estimate (current behavior — keep, but the UX no longer presents it as a failure).
- Re-run trigger: if any input that feeds `estimateKey` has changed since the last successful estimate (destination, duration, accommodation kind), invalidate the cache and re-run on entry to Step 4. The current `estimateKey` check is correct — extend it so changes to step 1 between steps 1 and 4 trigger a re-estimate without the user noticing.

#### 4.1 Estimate display — 3 tier cards (component research §12)

**Resolved conflict (component research §12 said "horizontal row, mid as anchor"):** Use a horizontal row of three cards (Budget / Mid-range / Premium). Mid-range gets the visual anchor.

- **Container:** `flexDirection:'row', gap:8, marginTop:16, alignItems:'stretch'`.
- **Card (Budget and Premium):** `flex:1, padding:14, borderRadius:16, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF'`.
- **Card (Mid-range, anchor):** `flex:1.05, padding:16, borderRadius:16, borderWidth:1, borderColor:'#CFCFCF', backgroundColor:'#FFFFFF'`. Above the card (absolute `top:-10, alignSelf:'center'`): pill badge `Best for most`, `backgroundColor:'#0788B0', borderRadius:10, paddingH:10, paddingV:4`, white 11/700.
- **Card content (each):**
  - Top: tier name in `cardTitle` style (Montserrat 16/700 `#222B30`).
  - Middle: USD range `$400 – $800` in 20/700 Inter `#212121` (the dominant info — per component research §12).
  - Bottom: `per person` in `helperText` style (Inter 12/400 `#7B7B7B`).
- **Selected:** `borderColor:'#0788B0', borderWidth:2, backgroundColor:'#E6F4F8'`. Tier name color becomes `#066b8c`.
- **Below the row** (marginTop 16):
  - **Derivation line:** `Based on {destination}, {N} days{accommodationKind ? ', ' + accommodationKind : ''}.` in `helperText` style.
  - **"Adjust manually" link:** small tertiary text button `Adjust the range yourself →`. Tapping reveals the manual min/max input pair below the cards. Initial state: hidden.
- **AI estimate badge** (top-right corner of the 3-card row, absolute): a small chip `AI estimate` with `<Ionicons name="sparkles-outline" size={12} color="#0788B0" />`, bg `#E6F4F8`, paddingH:8, paddingV:4, radius:10. Tapping shows an `Alert.alert('How this works', 'Estimated from your destination, duration, and accommodation type. You can adjust manually.', [{text:'OK'}])`.
- **Validation:** on Next — `if (!budgetTier && !(manualMin && manualMax)) showError('Pick a budget tier or enter a range')`.

#### 4.2 Manual fallback — error / explicit-override path

Triggered by (a) estimate failure, (b) edit mode, (c) user tapping "Adjust the range yourself".

- **Banner (only on estimate failure):** `<View style={{ flexDirection:'row', gap:8, alignItems:'center', backgroundColor:'#FDECEA', padding:12, borderRadius:12 }}>` with icon `<Ionicons name="alert-circle-outline" color="#C0392B" size={18} />` and text `We couldn't estimate this one — enter a range yourself.` (errorText color).
- **Label:** `Budget per person (USD)`.
- **Visual:** 2 number inputs side-by-side, same as age inputs. Placeholder `Min` and `Max`. `keyboardType="number-pad"`, `maxLength:6`.
- **Retry estimate button** (only visible on estimate failure, not edit mode): below the inputs, secondary outlined button `Try estimate again` — `borderColor:'#0788B0', borderWidth:1, height:48, borderRadius:24, alignItems:'center', justifyContent:'center'`. Label `#0788B0` 14/600.
- **Edit mode banner:** show a friendly note instead of error banner: `Editing — enter the budget range for your trip.` in `helperText` style.
- **Validation:** on Next — both fields non-empty and parseable, `min ≥ 0`, `max ≥ min`.

#### Step 4 validation summary

- Either: a tier is selected AND `budgetEstimate` exists, OR both manualMin and manualMax are valid integers with min ≤ max.

---

### Step 5 — Preview

**Heading:** `Here's your trip`
**Subtitle:** `Review it, choose who can see it, then publish.`

#### 5.1 Preview card

A render of the actual trip-feed card (component research §14). Extracted as `TripPreviewCard` (see §7) — must visually match the production TripsScreen card so the user sees exactly what others will see.

- Hero image at 12:5 (or placeholder gradient if missing).
- Title 16/700 Montserrat, 1 line.
- Destination + date one line: `{destination} · {dateText}` in 14/400 Inter `#555`.
- Budget line: `{tierName} · {formatRange(budget)} per person` in 14/400 Inter `#222B30`.
- Chip row below: vibe + skill chips. Chip styling matches TripsScreen card tags (`backgroundColor:'#F2F2F2', paddingH:8, paddingV:4, borderRadius:8, fontSize:11`).

The "PREVIEW" kicker is removed — context is obvious from the heading. (Friction-audit issue addressed.)

#### 5.2 Summary grid (under the preview card)

A compact 2-column key-value grid showing the fields that the trip card does NOT visually expose (per component research §14):

- `Wave shapes` → comma-joined list, e.g. `Soft wave, Wally wave`
- `Wave size` → `{min}–{max} ft`
- `Board types` → comma-joined or `Any`
- `Accommodation` → `{kind}{locked ? ' · ' + accommodationName : ''}`
- `Age range` → `{min}–{max}`

Layout: `flexDirection:'row', flexWrap:'wrap'` with each row `width:'48%', paddingVertical:8`. Key: `helperText` style. Value: 14/600 Inter `#222B30`.

Each row is a `TouchableOpacity` that jumps back to its source step via `setStepIdx(targetStep)`. Tap row → step. Edit. Tap Back → returns to Step 5 (need to track a `returnTo` ref).

#### 5.3 Visibility (required-with-default)

- **Section title:** `Who can see this trip` (18/700 Montserrat).
- **Visual:** 3 stacked cards (same `optionCard` styling as vibe — title + description + selected state with checkmark).
- **Default:** `public` (existing behavior — keep).
- **Validation:** none (always set).

#### 5.4 Submit

- Footer CTA changes to `Publish trip` (create) / `Save changes` (edit).
- On tap → `handleSubmit()`. While submitting: CTA shows ActivityIndicator, footer disables both buttons (back AND submit — fixes friction-audit bug #3).
- On success: clear AsyncStorage draft, call `onCreated()`.
- On failure: `Alert.alert('Could not publish', e.message)` and re-enable the buttons.

#### Step 5 validation summary

None — the user can publish.

---

## 5. Bug Fixes Included in the Rewrite

| # | Bug | Fix |
|---|-----|-----|
| 1 | **Edit mode + months → budget step always errors** (`durationValue:''`, `toDays('')=0`). | In edit mode the budget step skips the estimate entirely and renders manual mode preloaded from `trip.budget_min/max`. No `durationValue` dependency at all in edit mode. See §4 state machine. |
| 2 | **Accommodation image upload silently fails** — trip creates but image is lost. | In `handleSubmit`, if `accommodationCommitted` and `accRes.success === false`, throw `new Error(accRes.error || 'Failed to upload accommodation photo')`. Same semantics as the hero upload. The user sees an Alert and can retry. |
| 3 | **Back button not disabled during submit** — navigating back during upload leaves uploads in flight. | Footer back button gets `disabled={submitting}` and `opacity:0.4` while submitting. Both buttons reflect the in-flight state. |
| 4 | **Months mode with no months passes Step 1 validation.** | Add `if (datesMode === 'months' && !monthFrom) return 'Pick at least one month for your trip'` to `validateStep('basics')`. Implemented as part of §4 Step 1.4.b. |
| 5 | **`RangeSlider` scroll-steal on Android** — uses `PanResponder`. | Refactor `RangeSlider` to use `react-native-gesture-handler`'s `GestureDetector` with a `Pan` gesture configured with `.activeOffsetX(2).failOffsetY(8)` so the parent ScrollView wins vertical scrolls but the slider wins horizontal drags. Reanimated `useSharedValue` drives the thumb positions on the UI thread. See §7 RangeSlider refactor. |

---

## 6. Microcopy Library

All user-facing strings in one place. Sentence case unless noted. Headings use surf voice; field labels and helpers stay functional and direct (per wizard research §11).

| Where | String | Notes |
|-------|--------|-------|
| **Header — top-right close** | (icon only, ✕) | |
| **Discard prompt — title** | `Discard your new trip?` | |
| **Discard prompt — body** | `Any details you've entered won't be saved.` | |
| **Discard prompt — cancel** | `Keep editing` | |
| **Discard prompt — confirm** | `Discard` | destructive |
| **Resume sheet — title** | `Pick up where you left off?` | |
| **Resume sheet — body** | `You were planning a trip{destinationText? ' to ' + destinationText : ''} — Step {n} of 5 was next.` | |
| **Resume sheet — primary** | `Continue` | |
| **Resume sheet — secondary** | `Start fresh` | |
| **Footer CTA Step 1** | `Set surf details` | |
| **Footer CTA Step 2** | `Pick your stay` | |
| **Footer CTA Step 3** | `Estimate budget` | |
| **Footer CTA Step 4** | `Preview trip` | |
| **Footer CTA Step 5 (create)** | `Publish trip` | |
| **Footer CTA Step 5 (edit)** | `Save changes` | |
| **Footer back** | `Back` | |
| **Step counter** | `Step {n} of 5` | |
| **Step 1 heading** | `Plan your trip` | surf voice |
| **Step 1 subtitle** | `Start with the name, the place, and when you're going.` | |
| **Step 1 — Trip name label** | `Trip name` | |
| **Step 1 — Trip name placeholder** | `e.g. Bali and Barrels` | |
| **Step 1 — Trip name preview placeholder** | `Your trip will look like this` | |
| **Step 1 — Trip name counter format** | `{n} / 28` | |
| **Step 1 — Cover photo label** | `Cover photo` | |
| **Step 1 — Cover photo helper** | `Looks best in landscape — we'll crop to 12:5.` | |
| **Step 1 — Cover photo empty zone label** | `Tap to add cover photo` | |
| **Step 1 — Cover photo change** | `Change photo` | |
| **Step 1 — Cover photo remove alert** | `Remove cover photo?` | |
| **Step 1 — Destination label** | `Destination` | |
| **Step 1 — Destination placeholder** | `Where are you heading?` | |
| **Step 1 — Destination locked badge** | `Locked` | edit mode only |
| **Step 1 — Destination locked helper** | `Destination can't be changed after a trip is created.` | edit mode only |
| **Step 1 — Dates label** | `Dates` | |
| **Step 1 — Dates toggle option 1** | `By month` | |
| **Step 1 — Dates toggle option 2** | `Exact dates` | |
| **Step 1 — Months empty helper** | `Tap a month to start your range, then tap another for the end.` | |
| **Step 1 — Months single label format** | `{Month} {year}` (e.g. `August 2027`) | |
| **Step 1 — Months range label format** | `{Start} – {End} {year}` (e.g. `Aug – Oct 2027`) | |
| **Step 1 — Exact dates picker placeholder** | `Tap dates to set range` | |
| **Step 1 — Trip length label** | `Trip length` | months mode only |
| **Step 1 — Trip length helper** | `Used for the budget estimate.` | |
| **Step 1 — Trip length presets** | `3d`, `5d`, `7d`, `10d`, `14d`, `Other` | |
| **Step 1 — Trip length custom unit** | `days` | |
| **Step 1 — Trip vibe label** | `Trip vibe` | |
| **Step 1 — Trip vibe options** | `Surf-focused` / `Dawn patrol and sunset sessions`, `Chill` / `Relaxed surf + explore`, `Mixed` / `Flexible activities` | titles + descs |
| **Step 1 — Age range label** | `Who can join` | |
| **Step 1 — Age range helper** | `Ages 16–99, span at least {n} years.` | n = ageWindow |
| **Step 2 heading** | `What waves are you chasing?` | |
| **Step 2 subtitle** | `Tell future paddle-buddies what to expect.` | |
| **Step 2 — Skill level label** | `Skill level` | |
| **Step 2 — Skill level right tag** | `Pick one or more` | |
| **Step 2 — Skill level chips** | `Beginner`, `Intermediate`, `Advanced` | |
| **Step 2 — Wave shape label** | `Wave shape` | |
| **Step 2 — Wave shape right tag** | `Pick one or more` | |
| **Step 2 — Wave shape options** | `Soft wave` / `Gentle, rolling — fat shoulder, no curl`, `Wally wave` / `Walled, fast face — punchy without barreling`, `Barrel wave` / `Hollow, throwing lip — proper tubes` | (same as current copy) |
| **Step 2 — Wave size label** | `Wave size` | |
| **Step 2 — Wave size value format** | `{min}–{max} ft` (single = `{n} ft`) | |
| **Step 2 — Board types label** | `Board types` | |
| **Step 2 — Board types right tag** | `(optional)` | |
| **Step 2 — Board types empty helper** | `Leave empty for all board types.` | shown only when empty |
| **Step 2 — Board types options** | `Shortboard`, `Mid-length`, `Soft-top`, `Longboard` | |
| **Step 3 heading** | `Where will you stay?` | |
| **Step 3 subtitle** | `Even a rough idea helps people decide.` | |
| **Step 3 — Type label** | `Type` | |
| **Step 3 — Type options** | `Villa`, `Hostel`, `Hotel`, `Surf camp`, `Bungalow`, `Apartment`, `Guesthouse`, `Eco lodge`, `Other` | titles only on tiles; descriptions in panel below |
| **Step 3 — Gate label** | `Do you have a specific place booked?` | |
| **Step 3 — Gate helper (create)** | `You can't change this after you publish.` | |
| **Step 3 — Gate helper (edit)** | `Locked from when you first published.` | |
| **Step 3 — Gate Yes card title** | `Yes, booked` | |
| **Step 3 — Gate Yes card subtitle** | `I have a place locked in.` | |
| **Step 3 — Gate No card title** | `Not yet` | |
| **Step 3 — Gate No card subtitle** | `Still looking — flexible.` | |
| **Step 3 — Locked cluster top helper** | `All three fields are required to publish.` | |
| **Step 3 — Accommodation name label** | `Accommodation name` | |
| **Step 3 — Accommodation name placeholder** | `e.g. Surf Shack Hostel` | |
| **Step 3 — Accommodation URL label** | `Booking page or website` | |
| **Step 3 — Accommodation URL placeholder** | `https://...` | |
| **Step 3 — Accommodation URL helper** | `We'll add https:// automatically.` | shown on focus |
| **Step 3 — Accommodation photo label** | `Photo of the place` | |
| **Step 3 — Accommodation photo empty** | `Tap to add a photo` | |
| **Step 4 heading** | `What's the budget?` | |
| **Step 4 subtitle (create)** | `We'll estimate it. You confirm.` | |
| **Step 4 subtitle (edit)** | `Confirm the budget for your trip.` | |
| **Step 4 — Estimating label** | (no extra text — just the shimmer rows) | |
| **Step 4 — Tier names** | `Budget`, `Mid-range`, `Premium` | |
| **Step 4 — Mid badge** | `Best for most` | |
| **Step 4 — Per-person disclaimer** | `per person` | |
| **Step 4 — Derivation format** | `Based on {destination}, {n} days{accomKind ? ', ' + accomKind : ''}.` | |
| **Step 4 — AI badge** | `AI estimate` | tappable |
| **Step 4 — AI badge alert title** | `How this works` | |
| **Step 4 — AI badge alert body** | `Estimated from your destination, duration, and accommodation type. You can adjust manually.` | |
| **Step 4 — Adjust link** | `Adjust the range yourself →` | |
| **Step 4 — Manual label** | `Budget per person (USD)` | |
| **Step 4 — Manual placeholders** | `Min`, `Max` | |
| **Step 4 — Estimate fail banner** | `We couldn't estimate this one — enter a range yourself.` | |
| **Step 4 — Edit-mode helper** | `Editing — enter the budget range for your trip.` | |
| **Step 4 — Retry button** | `Try estimate again` | |
| **Step 5 heading** | `Here's your trip` | |
| **Step 5 subtitle** | `Review it, choose who can see it, then publish.` | |
| **Step 5 — Section title** | `Who can see this trip` | |
| **Step 5 — Visibility options** | `Public` / `Anyone can discover and request to join`, `Friends` / `Visible to your connections only`, `Private` / `Only people you invite can see and join` | |
| **Step 5 — Summary grid keys** | `Wave shapes`, `Wave size`, `Board types`, `Accommodation`, `Age range` | |
| **Submit error alert (create)** | `Could not publish` | title; message = e.message |
| **Submit error alert (edit)** | `Could not save trip` | title; message = e.message |
| **Not signed in alert** | `Not signed in` / `Please sign in again.` | |
| **Inline error — title empty** | `Your trip needs a name` | |
| **Inline error — cover photo** | `Add a cover photo to publish your trip` | |
| **Inline error — destination** | `Pick a destination for your trip` | |
| **Inline error — months empty** | `Pick at least one month for your trip` | |
| **Inline error — duration empty** | `Pick a trip length` | |
| **Inline error — exact date empty** | `Pick a start date` | |
| **Inline error — exact date order** | `End date must be on or after the start date` | |
| **Inline error — age missing** | `Add a minimum and maximum age` | |
| **Inline error — age range** | `Ages must be 16–99` | |
| **Inline error — age max<min** | `Maximum age must be at least the minimum` | |
| **Inline error — age span** | `Age range must span at least {n} years (currently {span}).` | |
| **Inline error — skill levels** | `Pick at least one skill level` | |
| **Inline error — wave shapes** | `Pick at least one wave shape` | |
| **Inline error — accommodation type** | `Pick an accommodation type` | |
| **Inline error — accommodation gate** | `Choose yes or no` | |
| **Inline error — accommodation name** | `Add the name of your stay` | |
| **Inline error — accommodation URL** | `Add the booking page or website` | |
| **Inline error — accommodation photo** | `Add a photo of your stay` | |
| **Inline error — budget tier** | `Pick a budget tier or enter a range` | |
| **Inline error — budget manual missing** | `Enter both a minimum and maximum` | |
| **Inline error — budget manual order** | `Maximum must be at least the minimum` | |

---

## 7. Component Breakdown

### Files to add (under `src/components/trips/`)

#### 7.1 `CreateTripWizardChrome.tsx`

Header + footer + progress bar + keyboard scaffolding wrapped as one component the screen mounts. Owns the `KeyboardAwareScrollView`, the animated footer, the back/close handlers.

```ts
interface CreateTripWizardChromeProps {
  stepIdx: number;
  totalSteps: number;
  ctaLabel: string;
  ctaDisabled?: boolean;
  submitting?: boolean;
  showBack: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;            // triggers discard confirm
  children: React.ReactNode;       // the step content (one step at a time)
  stepKey: string;                 // drives the FadeIn / SlideInRight keyed transition
  direction: 'forward' | 'backward';
}
```

Renders the safe-area header, progress bar, scroll content area, and animated sticky footer. Emits `onNext` (parent decides if validation passes) and `onBack`/`onClose`.

#### 7.2 `MonthChipPicker.tsx`

```ts
interface MonthChipPickerProps {
  monthsAhead?: number;       // default 18
  monthFrom: string;          // 'YYYY-MM' or ''
  monthTo: string;            // 'YYYY-MM' or ''
  onChange: (next: { monthFrom: string; monthTo: string }) => void;
}
```

Horizontally scrollable chip row + below-row summary text. Internally handles tap-to-start-range / tap-to-set-end / tap-after-full-range = restart logic.

#### 7.3 `DurationChipPicker.tsx`

```ts
interface DurationChipPickerProps {
  value: string;              // '' or '3' | '5' | '7' | '10' | '14' | custom number
  onChange: (next: string) => void;
}
```

Presets `[3, 5, 7, 10, 14]` + `Other`. Selecting `Other` reveals the inline number input + `days` label.

#### 7.4 `SurfChipPicker.tsx`

Reusable multi-select chip row for the small-N sets (skill levels, board types). Generic.

```ts
interface SurfChipPickerProps<T extends string> {
  options: { key: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
  columns?: 1 | 2;            // 1 = single row; 2 = 2x2 grid
}
```

#### 7.5 `WaveShapeCardPicker.tsx`

Wave shape multi-select with title + desc cards. Hard-coded options (the `WAVE_SHAPES` constant moves into this component).

```ts
interface WaveShapeCardPickerProps {
  selected: WaveShapeKind[];
  onChange: (next: WaveShapeKind[]) => void;
}
```

#### 7.6 `AccommodationTypeGrid.tsx`

2-col icon grid with the 9 accommodation kinds + the conditional description panel below.

```ts
interface AccommodationTypeGridProps {
  value: AccommodationKind | null;
  onChange: (next: AccommodationKind) => void;
}
```

#### 7.7 `BudgetTierCards.tsx`

3-card horizontal row, anchor Mid card, AI badge, derivation line, "adjust manually" link slot.

```ts
interface BudgetTierCardsProps {
  estimate: BudgetEstimate;
  selectedTier: 'low' | 'medium' | 'high' | null;
  onChange: (next: 'low' | 'medium' | 'high') => void;
  derivationText: string;     // 'Based on Bali, 10 days, villa.'
  onAdjustManually: () => void;
}
```

#### 7.8 `TripPreviewCard.tsx`

The visual trip card used in TripsScreen, lifted into a shared component. Same props the TripsScreen card consumes today, but accepts in-flight data (not just persisted GroupTrip rows). The current TripsScreen card is inline in `TripsScreen.tsx:106–149` — extract it.

```ts
interface TripPreviewCardProps {
  title: string | null;
  heroImageUri: string | null;
  destination: string;
  dateText: string;
  budgetText: string | null;     // e.g. 'Mid-range · $800 – $1,500 per person'
  vibeLabel: string | null;
  skillLabels: string[];
}
```

The same component is then used in `TripsScreen.tsx` (refactor TripCard there to consume it) so the preview = production guarantee holds. Two callers: Step 5 preview and TripsScreen feed.

### Files to refactor

#### 7.9 `CalendarRangePicker.tsx` — **keep, minor refactor**

Functional logic is correct. Two minor changes:
1. Add `fontFamily: 'Inter'` / `'Montserrat'` to month label, day-of-week label, and cell text styles.
2. Optional: clamp month-navigation to current month (don't allow nav into past months). Wrap the back-chevron with `disabled={isFirstMonth}` and `opacity:0.3` when at the min.

No prop changes.

#### 7.10 `RangeSlider.tsx` — **refactor (replace internals, keep export)**

Replace `PanResponder` with `react-native-gesture-handler` v2 + Reanimated v3:

- Wrap thumb area in `<GestureDetector gesture={Gesture.Pan().activeOffsetX(2).failOffsetY(8)}>`. The `activeOffsetX(2)` means horizontal motion ≥ 2px claims the gesture; `failOffsetY(8)` means vertical motion ≥ 8px hands the gesture back to the parent scroll. This fixes friction-audit bug #5.
- Thumb position via `useSharedValue` and `useAnimatedStyle` on the UI thread — no JS-thread chatter during drag.
- Add the floating value labels (a `View` per thumb, positioned absolutely above the track, `opacity` controlled by an `isDragging` shared value, showing only while the user is touching).
- Add the static `1 ft` / `15 ft` endpoint labels in the parent (outside the slider component), in the wizard's wave-size row.
- Public API unchanged: same `{min, max, step, lower, upper, onChange}` props.

#### 7.11 `HomeBreakSearchSheet.tsx` — **patch (small)**

One-line bug fix from friction-audit divergence #13: respect the `confirmTitle` prop on the internal Save button. Currently hardcoded `Save`.

### Files to consume / not extract

- The Photo upload pattern is used twice (Step 1 cover, Step 3 accommodation). The picker logic is small enough (one `pickImage()` function + a touchable). Keep inline in `CreateTripFlowA.tsx` for now; only extract `TripPhotoUploader` if a third caller appears.

---

## 8. Persistence Mapping

Every field that survives publish lands in an existing `group_trips` column (verified against `groupTripsService.ts`). No schema changes.

| Field | DB target | Notes |
|-------|-----------|-------|
| `title` | `group_trips.title` (text) | Trim before insert |
| `heroImageUri` | `group_trips.hero_image_url` (text) | Uploaded to Supabase Storage via `uploadTripImage(uri, hostId, 'hero')`; the returned URL is what's persisted |
| `destination` | `group_trips.destination_country` (text) | + side-effect: `setTripDestination(tripId, geo)` writes geocoded fields to `group_trip_destinations` |
| `destinationGeo` | Side table `group_trip_destinations` via `setTripDestination` | Best-effort; geo failure doesn't block publish (existing behavior — keep) |
| `datesMode` | derived → `dates_set_in_stone` (boolean) | `true` if exact, else `null` |
| `monthFrom` + `monthTo` | `group_trips.date_months` (text[]) | Expanded by `expandMonthRange` to inclusive list, capped at 6 months |
| `startDate` | `group_trips.start_date` (date) | ISO `YYYY-MM-DD` |
| `endDate` | `group_trips.end_date` (date) | ISO; nullable |
| `durationValue` | **STATE ONLY** — feeds `estimateTripBudget()` | Not persisted. In edit-mode + months it's `''`, which is fine because budget estimate is skipped in edit mode (per §4 redesign) |
| `tripVibe` | `group_trips.trip_vibe` (text) | One of 'surf' / 'chill' / 'mixed' |
| `ageMin` / `ageMax` | `group_trips.age_min`, `age_max` (int) | Parsed via parseInt |
| `skillLevels` | `group_trips.target_surf_levels` (text[]) | Defaults to `['all']` if empty (keep existing fallback semantics — but with required validation now, this never fires) |
| `waveShapes` | `group_trips.wave_shapes` (text[]) | New required field on Step 2 |
| `waveSizeMin` / `waveSizeMax` | `group_trips.wave_size_min`, `wave_size_max` (numeric) | |
| `surfStyles` | `group_trips.target_surf_styles` (text[]) | Defaults to `['all']` if empty |
| `accommodationKind` | `group_trips.accommodation_type` (text[]) | Persisted as `[accommodationKind]` (existing pattern) |
| `accommodationLocked` | derived — NOT a column | Used as a UI gate. The persisted artifact is the presence/absence of `accommodation_name` (so edit mode infers via `trip.accommodation_name ? true : false`). Keep current `stateFromTrip` logic. |
| `accommodationName` | `group_trips.accommodation_name` (text) | Only set when locked === true |
| `accommodationUrl` | `group_trips.accommodation_url` (text) | Same |
| `accommodationImageUri` | `group_trips.accommodation_image_url` (text) | Uploaded via `uploadTripImage(uri, hostId, 'accommodation')`. **Fix bug #2:** if upload fails, throw — don't silently null it. |
| `budgetEstimate` | **STATE ONLY** — the GPT response | Cached in component state during the session; not persisted |
| `budgetTier` | derived → `budget_min`, `budget_max` | When a tier is selected, its `{min, max}` becomes the persisted budget |
| `budgetManualMin` / `budgetManualMax` | `group_trips.budget_min`, `budget_max` (numeric) | Used when no estimate or manual override |
| `budgetCurrency` | `group_trips.budget_currency` (text) | Always `'USD'` for now |
| `visibility` | `group_trips.visibility` (text) | 'public' / 'friends' / 'private' |

### Fields that get default values (not collected by Flow A)

- `description` → `''` (Flow A doesn't ask)
- `vibe` → `null` (legacy time-of-day vibe; replaced by `trip_vibe`)
- `surf_spots` → `null`
- `host_been_there` → `null`
- `wave_type` → `null` (Flow B field)
- `surf_style` → `null`
- `accommodation_status` → `null` (Flow B field — locked-in already covered)
- `destination_area`, `destination_spot` → `null`
- `included_components`, `total_cost`, `cost_per_person`, `price_includes` → `null` (Flow C fields)
- `packing_list`, `group_packing_list` → `[]`

### Update mode (existing — keep)

`UpdateGroupTripInput` excludes destination columns by type — already correct. The new flow continues to pass only the editable subset; the service handles the rest.

---

## 9. Phasing for Implementation

5 parallelizable workstreams. Each can be assigned to a separate agent. Stream A is the only one that touches the cross-cutting state/validation engine; the others touch isolated components.

### Stream A — Chrome + state engine

**Files touched:**
- `src/components/trips/CreateTripWizardChrome.tsx` (new)
- `src/screens/trips/CreateTripFlowA.tsx` (refactor — top-level structure, NOT step content)

**Scope:**
- Header band with gradient progress bar
- Sticky animated footer with `useReanimatedKeyboardAnimation`
- `KeyboardAwareScrollView` integration + scroll-to-top on step change
- Step transition (`SlideInRight/Left` Reanimated)
- Discard-confirm `Alert.alert` plumbing
- AsyncStorage draft autosave + resume sheet
- Validation engine: replaces `Alert.alert('Hold on', err)` with inline-error state per field; exposes `setFieldError(field, msg)` / `clearFieldError(field)` from a step-local `useFieldErrors()` hook
- Bug #3 fix (back disabled while submitting)
- Bug #4 fix (months-no-selection rejected in validation)

**Dependencies:** None (foundational).

**Complexity:** ⬛⬛⬛⬛ (4/5). The validation refactor + keyboard handling is the riskiest part of the rewrite.

---

### Stream B — Step 1 components

**Files touched:**
- `src/components/trips/MonthChipPicker.tsx` (new)
- `src/components/trips/DurationChipPicker.tsx` (new)
- `src/components/trips/CalendarRangePicker.tsx` (minor refactor — fonts, optional past-month clamp)

**Scope:**
- Build `MonthChipPicker` (horizontal chip scroller, range tap logic, summary text)
- Build `DurationChipPicker` (5 presets + Other → inline number input)
- Patch `CalendarRangePicker` for fonts + optional bounds
- All components are pure / controlled — props in, callback out. No state side-effects.

**Dependencies:** None (works against stub props until Stream E integrates).

**Complexity:** ⬛⬛⬛ (3/5). Range tap logic + horizontal scroll on web/iOS/Android.

---

### Stream C — Step 2 components + RangeSlider refactor

**Files touched:**
- `src/components/trips/SurfChipPicker.tsx` (new)
- `src/components/trips/WaveShapeCardPicker.tsx` (new)
- `src/components/trips/RangeSlider.tsx` (refactor — Gesture Handler v2 + Reanimated, floating value labels)

**Scope:**
- Build `SurfChipPicker` (generic, used for skill levels + board types)
- Build `WaveShapeCardPicker` (title+desc cards, multi-select)
- Refactor `RangeSlider` per §7.10 — fixes friction-audit bug #5
- Add floating value labels (UI-thread, visible only while dragging)

**Dependencies:** None.

**Complexity:** ⬛⬛⬛⬛ (4/5). The RangeSlider Reanimated/GH migration has real concurrency edge cases. Test on Android edge-to-edge.

---

### Stream D — Steps 3, 4, 5 components

**Files touched:**
- `src/components/trips/AccommodationTypeGrid.tsx` (new)
- `src/components/trips/BudgetTierCards.tsx` (new)
- `src/components/trips/TripPreviewCard.tsx` (new — extracted from `TripsScreen.tsx`)
- `src/screens/trips/TripsScreen.tsx` (refactor — consume the extracted card)

**Scope:**
- Build `AccommodationTypeGrid` (2-col tiles + conditional description panel)
- Build `BudgetTierCards` (3-card horizontal row with mid-anchor + AI badge)
- Extract TripCard from `TripsScreen.tsx:106–149` into `TripPreviewCard.tsx`. Update both callers (TripsScreen feed + new wizard preview).
- Build the summary grid + visibility section inline in Step 5 (small enough not to extract)

**Dependencies:** Light — extracting TripCard touches `TripsScreen.tsx` but doesn't change its API.

**Complexity:** ⬛⬛⬛ (3/5).

---

### Stream E — Integration + Step content rewrite + bug fixes 1, 2

**Files touched:**
- `src/screens/trips/CreateTripFlowA.tsx` (rewrite all step content — wires up streams A–D)
- `src/components/HomeBreakSearchSheet.tsx` (one-line `confirmTitle` patch)

**Scope:**
- Replace all step-content code in `CreateTripFlowA.tsx` to use the new components from streams B–D, with the chrome from stream A
- Apply microcopy from §6
- Wire persistence per §8
- Bug fixes:
  - #1 (edit-mode + months budget regression): in step 4, branch on `editMode` and skip the estimate entirely
  - #2 (silent accommodation upload failure): throw on `accRes.success === false` in `handleSubmit`
- Resume sheet + draft autosave wired in
- Final validation summary per step

**Dependencies:** Streams A, B, C, D must be merged first.

**Complexity:** ⬛⬛⬛⬛ (4/5). It's the assembly point; expect 1–2 cycles of polish.

---

### Suggested execution order (sequential dependencies bolded)

1. **Stream A in parallel with B, C, D** (all independent).
2. Streams B, C, D finish in parallel.
3. **Stream E** consumes A, B, C, D and integrates. Single agent.

This gives 4 agents working in parallel for the first 60–70% of the work, then a single integrator.

---

## 10. Test Plan

Manual scenarios the implementer must walk through on web + iOS + Android before declaring done. Three columns: scenario, expected behavior, pass criterion.

### A. Create-mode happy path

| Scenario | Expected | Pass |
|----------|----------|------|
| Open Create from TripsScreen → land on Step 1 with keyboard up, title field focused | Header shows "Step 1 of 5", progress bar 20% filled with cyan→teal gradient | Visual + counter correct |
| Type a 14-character title | Counter shows `14 / 28` in gray. Live preview text below updates | Counter color stays gray |
| Type 23 chars | Counter turns amber `23 / 28` | Color shift visible |
| Type 28 chars | Counter is red. Input refuses additional characters | maxLength enforced |
| Tap cover photo zone → action sheet → choose from library → pick → crop to 12:5 | Image fills the 12:5 zone. "Change photo" pill visible at bottom-right | Image renders |
| Long-press the filled cover photo | Remove alert appears | Alert text matches §6 |
| Tap destination → sheet opens → search "Bali" → pick a result → confirm | Sheet dismisses. Destination field shows the picked name | Confirm button label = "Use this destination" |
| Default `By month` mode → scroll month chip row to August → tap Aug → tap Oct | Aug shows endpoint style, Sep in-range style, Oct endpoint. Summary shows `Aug – Oct 2027` | Range styles correct |
| Select duration preset `10d` | Chip selected (teal fill) | Selection visual |
| Tap `Other` → reveal number input → type 11 | Number input visible. Value persisted | UI animates in |
| Default vibe is `Mixed` (selected). Tap `Surf-focused` | Selection flips. Mixed deselects | Visual |
| Tap age min → type 22 → blur. min has 22, max auto-fills to 29 | Both fields populated. No error | Auto-fix works |
| Type 33 in max → blur. min was 22, max=33, ageWindow=7. span=11 ≥ 7. Valid | No error | |
| Tap Set surf details (CTA) | Slides left, Step 2 shows from right. Progress bar animates to 40% | Animation correct |
| **Step 2**: tap Intermediate chip | Chip turns teal | Visual |
| Tap Wave shape > Wally wave | Card turns teal-border + checkmark | Visual |
| Drag the lower wave-size thumb left to 2 | Value label appears above thumb showing `2 ft`. Header row shows `2–8 ft` | Floating label visible |
| Drag accidentally vertically | Slider does NOT consume the gesture; scroll wins (Android specifically) | No friction-audit bug #5 |
| Tap Pick your stay | Step 3 from right | |
| **Step 3**: tap Surf camp tile | Tile teal border + bg. Description panel appears below: "Surf-focused, all-in package" | Visual |
| Tap `Yes, booked` | Card selected. Conditional cluster fades in below | Animation |
| Type name + URL `bookings.example` → blur URL | URL becomes `https://bookings.example`. Green check icon appears | Auto-prepend works |
| Add accommodation photo | Photo zone fills with image | |
| Tap Estimate budget | Step 4 from right. Loading skeleton rows show for ~1–2 sec | Skeleton, not full-screen spinner |
| Tiers appear. Tap `Mid-range` card | Card selected. "Best for most" badge stays at top | Selection works |
| Tap AI estimate badge | Alert: "How this works" + body | Alert |
| Tap Preview trip | Step 5 fades in (no slide) | Fade animation specifically |
| Preview card shows: hero photo, title, destination, dates, budget, vibe + skill chips | Card matches the production TripsScreen card visually | Visual identity |
| Tap a summary row (e.g. `Wave shapes`) | Jumps back to Step 2 | Navigation works |
| From Step 2, tap Pick your stay → Estimate budget → Preview trip | Returns to Step 5 | |
| Default visibility is `Public`. Tap `Friends` | Selection moves | |
| Tap Publish trip | CTA shows ActivityIndicator. Back is disabled. Photos upload | Both buttons disabled during submit |
| Submit succeeds | `onCreated()` fires. Draft cleared from AsyncStorage. Modal dismisses | |

### B. Edit-mode happy path

| Scenario | Expected | Pass |
|----------|----------|------|
| Open edit on an existing trip with `dates_set_in_stone=null, date_months=[…]` (months mode trip) | Step 1 prefilled. Trip name editable. Destination is locked with helper text. | "Locked" badge visible |
| Navigate Step 1 → Step 2 → Step 3 → Step 4 | Step 4 shows manual mode with prefilled `budget_min/max`. NO estimate spinner. Helper says "Editing — enter the budget range for your trip." | Bug #1 fixed |
| Change budget min from 800 to 900 | Field updates | |
| Step 5 → Save changes | Submit fires `updateGroupTrip`. Success → modal dismisses | |

### C. Validation error paths

| Scenario | Expected |
|----------|----------|
| Step 1 → leave title empty → tap CTA | Title field border turns red. Inline message: "Your trip needs a name". Scroll snaps to that field. CTA does not advance. |
| Step 1 → months mode but no month tapped → tap CTA | Inline error on month picker: "Pick at least one month for your trip". (Closes friction-audit bug #4) |
| Step 1 → age min=22, max=25, ageWindow=7 → tap CTA | Inline error under age row: "Age range must span at least 7 years (currently 3)." |
| Step 2 → no skill level chip selected → tap CTA | Inline error on skill row: "Pick at least one skill level" |
| Step 2 → no wave shape selected → tap CTA | Inline error: "Pick at least one wave shape" |
| Step 3 → no accommodation type tile selected → tap CTA | Inline error: "Pick an accommodation type" |
| Step 3 → tile selected but gate unanswered → tap CTA | Inline error on gate row: "Choose yes or no" |
| Step 3 → Yes selected, name empty → tap CTA | Inline error on name field |
| Step 4 → estimate returned, no tier selected, no manual entered → tap CTA | Inline error above tier row: "Pick a budget tier or enter a range" |

### D. Estimate failure path

| Scenario | Expected |
|----------|----------|
| Step 4 entered with bad destination (no places API key in dev) | Estimate throws → red banner appears: "We couldn't estimate this one — enter a range yourself." Manual min/max fields visible. Retry button shown. |
| Tap Retry estimate | Loading skeleton again. Maybe succeeds maybe fails. |

### E. Draft / resume

| Scenario | Expected |
|----------|----------|
| Start Step 1, type a title, tap Set surf details (lands on Step 2) | AsyncStorage `@swellyo/createTripDraft` populated |
| Close modal via top-right ✕ → discard alert → tap Keep editing | Alert dismisses, still on Step 2 |
| Close modal → Discard | Alert confirms. Modal closes. AsyncStorage draft cleared. |
| Close modal → Keep editing → close again → Discard | Same as above |
| Type title, tap Next (creates draft), close via ✕ → Keep editing → close → Discard | Draft cleared |
| Type title, tap Next, close via ✕ → Discard | Draft cleared. Reopen Create: starts at fresh Step 1, NO resume sheet |
| Type title, tap Next, force-quit app, reopen, Create | Resume sheet appears: "Pick up where you left off?" — Continue restores to Step 2 with title intact |

### F. Discard / dirty-exit

| Scenario | Expected |
|----------|----------|
| Open Create, touch nothing, tap ✕ | Closes silently. No alert. AsyncStorage unchanged |
| Open Create, type one character in title, tap ✕ | Discard alert |

### G. Keyboard

| Scenario | Expected |
|----------|----------|
| Step 1: focus title field | Keyboard slides up. Footer slides up with it. Title field is visible above the keyboard. CTA is visible above the keyboard |
| Step 1: focus age min (bottom of step) | Field scrolls into view above the keyboard. CTA visible |
| Step 3: gate=Yes, focus URL field | Same — field above keyboard, CTA visible |
| Step 4: focus budget min in manual mode | Same |
| Android edge-to-edge: focus title field | Same as iOS — no footer overlap |

### H. Step transitions

| Scenario | Expected |
|----------|----------|
| Step 1 → CTA → Step 2 | Slide left + slide in right, 220+260ms |
| Step 2 → Back → Step 1 | Slide right + slide in left |
| Step 4 → CTA → Step 5 | Fade in (no slide). Preview card visible |

### I. Bug regression checks

| Friction-audit bug | Check |
|--------------------|-------|
| #1 Edit mode + months → budget error | Walk B. Pass = no error spinner, manual mode loads |
| #2 Silent accommodation upload failure | Mock storage failure → expect Alert "Could not publish" with the upload error message |
| #3 Back during submit | While Publish is in flight, tap Back rapidly. Button disabled / unresponsive |
| #4 Months no-selection passes | Walk C row 2. Pass = error |
| #5 RangeSlider Android scroll-steal | On Android device, scroll the step vertically while finger crosses the slider. Pass = scroll wins |

### J. Cross-platform smoke

| Platform | Smoke pass criteria |
|----------|---------------------|
| Web (Chrome, Safari) | All five steps render. Submit succeeds. Fonts = Montserrat/Inter. |
| iOS | Same. Keyboard avoidance works. Discard alert uses native iOS style. |
| Android (Expo Go OR build) | Same. Edge-to-edge keyboard footer offset works. Range slider doesn't conflict with scroll. |

---

## Implementation Notes for the Builder

- **Don't import `colors` from `theme.ts`** — those tokens are wrong. Use the hex values from §2 directly inline in styles or via a local `const colors = { ... }` at the top of each new component file.
- **Don't import `Button.tsx` or `Input.tsx`** — they're dead.
- **Always use the platform-conditional font family ref** for Montserrat and Inter (see §2 Typography).
- **`react-native-keyboard-controller` is already in deps** (per project memory). If the import path errors, install the latest version (`yarn add react-native-keyboard-controller@latest`). No new heavy deps.
- **Reanimated v3 + Gesture Handler v2 are installed.** No new install needed.
- **`expo-linear-gradient` is installed** (used elsewhere). Use it for the progress bar gradient.
- **The TripCard extraction** in Stream D is the only thing that touches a screen outside this flow. Do it carefully and test TripsScreen still renders correctly.
- **The `HomeBreakSearchSheet` patch** is one line — pass `confirmTitle` through to the internal Save button label. Don't redesign that component.
- The "popular surf destinations" pre-typed state inside `HomeBreakSearchSheet` is a follow-up improvement, not part of this redesign scope.
