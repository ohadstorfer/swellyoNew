---
name: bottom-sheet-shell-is-headless
description: BottomSheetShell supplies only scrim + slide + Modal — a new sheet that forgets its own white surface and insets.bottom padding renders as text floating on the dim scrim
metadata:
  type: project
---

`BottomSheetShell` is headless: it owns the RN `Modal`, the fading scrim, the
slide and the swipe, and nothing else. Every consumer renders its own
`styles.surface` (`backgroundColor:'#FFFFFF'` + top radii) AND its own
`paddingBottom: Math.max(insets.bottom, 16) + N`.

**Why:** two failure modes that only show up on device, so they survive tsc and
jest. Without the surface the sheet's content sits directly on the 0.45 black
scrim over whatever is behind it — dark text on muddy grey, transparent inputs.
Without the bottom inset padding, `androidNavBarNudge` (BottomSheetShell pushes
the sheet down by `insets.bottom` to work around expo/expo#39749) slides the
last row — usually the primary button — under the Android nav bar.

**How to apply:** on any review of a new/ported sheet, check the outermost child
passed to `BottomSheetShell` for both. Spec/brief snippets in this repo have
shipped without them (Task 10's `TravelerPriceSheet`), so don't assume a
copied-verbatim snippet is complete. Compare against
`src/components/trips/RejectDocumentSheet.tsx`, which is the full pattern
(surface + grabber via the render-prop `panHandlers` + inset padding + `ff()`
fonts). See [[travel-price-sheet-review]].
