---
name: travel-price-sheet-review
description: Task 10 (operator sets one traveler's price) review verdict — nested-modal placement is correct; the defects are the missing sheet surface and a confirm prompt that fires on price DECREASES
metadata:
  type: project
---

Review of `TravelerPriceSheet` + `TripMemberSheet` (commit `9600215`,
2026-08-03 Stripe-payments SDD).

**Verdict: spec ❌ / quality "issues".** The single highest-risk item was done
right — `TravelerPriceSheet` is a child *inside* `TripMemberSheet`'s own
`BottomSheetShell`, so the second RN `Modal` is genuinely nested rather than a
sibling top-level Modal. Verified safe in RN 0.81: `ModalHostViewShadowNode` is
`RootNodeKind` and `Modal.js` gives the host view `position:'absolute'`, so the
nested Modal contributes nothing to the parent sheet's measured height /
`translateY`. Both shells use `animationType="none"`, so there is no native
presentation animation to race.

The real defects were elsewhere:
1. No white surface / radii / `insets.bottom` padding — see
   [[bottom-sheet-shell-is-headless]].
2. The "are you sure" prompt compares the NEW total against the amount already
   PAID (`paid > 0 && t > paid`) instead of against the traveler's PREVIOUS
   total, so it fires on a price *decrease* for anyone part-paid. The component
   overwrites the loaded total into the TextInput state and keeps no snapshot
   of it, which is what makes the correct comparison impossible.

**Why it matters:** both defects came straight out of the task brief's own
code snippet, copied verbatim. **How to apply:** in this SDD, review brief
snippets as adversarially as hand-written code — "copied verbatim from the
brief" is not evidence of correctness.
