---
name: create-trip-component-ux
description: UX best practices for all 14 input components in the Swellyo create-trip wizard — patterns from Airbnb, Eventbrite, Bumble, Strava, Google Flights, Skyscanner, NN/G, Material Design 3
metadata:
  type: project
---

Full research document at `docs/component-ux-research.md` (May 2026).

**Why:** Redesign proposal for the 5-step Create-Trip wizard in CreateTripFlowA/C. Real money + travel commitments, so trustworthy UX is required.

**How to apply:** Reference this doc before implementing any UI component in the create-trip flow. Key decisions are codified per component.

## Key decisions per component

1. **Title input** — always-visible `n/28` counter + live card preview below input
2. **Hero photo** — dashed tap zone → action sheet → crop (react-native-image-crop-picker, 12:5) → shimmer during upload
3. **Destination picker** — existing bottom sheet + add popular surf destination pills as default state
4. **Date mode** — segmented control (custom, not native — Android looks bad) + month chips for fuzzy mode (not text dropdowns)
5. **Duration** — preset chips 3/5/7/10/14d + Custom text input; no slider (NN/G: sliders degrade UX for precise integers)
6. **Segmented control** — custom two-pill implementation with Reanimated withSpring animated fill
7. **Multi-select chips** — 3-option groups in single row, 4-option board types in 2x2 grid, 44pt tap targets
8. **Wave size slider** — existing RangeSlider.tsx needs: value labels above thumbs (update live), track fill color, static range text below, min/max endpoint labels
9. **Card-list selector** — vertical radio cards for 3-option sets (vibe, visibility); 2-column icon grid for 9-option accommodation types
10. **Age range** — two side-by-side numeric TextInput, not slider; span validation on blur; uses AGE_WINDOW_BY_STYLE constant
11. **Yes/No gate** — two large side-by-side cards + "can't be changed after you continue" note; auto-advance on selection
12. **Budget tier** — 3 horizontal cards; mid-range as visual anchor (slightly taller); AI estimate badge; "per person" clarification mandatory
13. **Accommodation cluster** — Name → URL → Photo field order; URL auto-prepend https://; inline green checkmark on valid URL
14. **Preview card** — render actual TripCard component (extract from TripsScreen); FadeIn reveal; edit links per section below card

## Important gotchas found
- `expo-image-picker allowsEditing` broken on Android (known bug) — use `react-native-image-crop-picker`'s openCropper instead
- Native `@react-native-segmented-control/segmented-control` looks bad on Android — always use custom implementation
- Sliders for precise integers (age, duration) degrade UX per NN/G — use text inputs or preset chips instead
- `TripCard` component does not yet exist as a standalone; must be extracted from TripsScreen before preview step can reuse it

[[research_expo_image_picker_android]]
[[research_rnimage_crop_picker_modal]]
[[research_rngh_custom_slider]]
