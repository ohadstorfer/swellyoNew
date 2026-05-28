---
name: wizard-ux-group-surf-trip
description: Multi-step wizard UX best practices for the 5-step create-group-surf-trip flow — step indicators, navigation, validation, save/resume, transitions, keyboard, microcopy, AI fill
metadata:
  type: project
---

Researched May 2026. Full output at `docs/wizard-ux-research.md`.

## Key findings by area

**Step indicators**: Thin top bar + "Step X of 5" fraction above heading. No named horizontal stepper (5 names clip on mobile). No dots (wrong context). Hybrid bar+label is NN/g / Smashing / PatternFly consensus.

**Navigation**: Sticky footer — Back (ghost/outline, left) + specific verb CTA (right). "Save & exit" as top-right tertiary text from Step 2 onward. Discard-confirm bottom sheet on exit if fields touched. "Next" always tappable; show "2 fields needed" badge instead of disabling.

**Validation**: On-blur for text inputs. On-next for selectors/pickers/sliders/multi-select. Never silently disabled button. Inline errors below the field, specific language ("Your trip needs a title").

**Save/resume**: Create draft row on first Next tap (not on open). `status: 'draft'` on group_trips. "Saved · X min ago" micro-label in footer. Resume screen on re-open: "You were building a trip to [dest] — Step 2 was next."

**Skip/optional**: Entire Step 2 wave section is skippable ("Skip for now" text link). Accommodation type required; sub-fields (name/URL/photo) required only when "yes" gate is set. Spell out "(optional)" in gray — no asterisks.

**Transitions**: `slide_from_right` Steps 1–4 (React Navigation native-stack). `fade_from_bottom` for Step 5 (preview) to signal modal-confirm nature. No custom Reanimated transitions for steps.

**Information density**: Scroll within a step is OK. Step 1 will scroll (8 inputs); that's acceptable. Never more than 2.5 screens. Steps 2–4 fit in one scroll.

**Headers**: 24–26sp conversational question heading + 13sp subtitle. "Step X of 5" in 12sp muted gray above heading. Examples: "What waves are you chasing?", "Where will you stay?", "What's the budget?"

**Preview (Step 5)**: Full rendered trip card + compact summary grid of non-card fields + visibility selector (3 tappable cards). "Publish trip" CTA at bottom. Inline shimmer for budget row if GPT still loading.

**Keyboard (SDK 54)**: react-native-keyboard-controller (already in project). `KeyboardAwareScrollView` with `bottomOffset={footerHeight}`. Footer as sibling outside scroll, animated with `useReanimatedKeyboardAnimation`. APSL's library sticky footer is broken (GitHub #437, #527). Steps 2, 5 don't need keyboard handling (no text inputs).

**Microcopy tone**: Surf-aware question headings. Specific verb+noun CTAs. "(optional)" spelled out. Error messages: "Your trip needs a [field name]" format. Keep surf metaphors in headings only, not in helper text.

**AI fill (budget step)**: Auto-trigger GPT estimate on step arrival. Show inline loading "Estimating budget for [dest]..." Show derivation below tiers: "Based on: Canggu, 10 days, villa." Always show manual override fields pre-filled with selected tier values. Failure fallback: empty min/max + "We couldn't estimate — enter your budget range."

Airbnb May 2026: address input → AI auto-fills listing details (TechCrunch confirmed). Same pattern for optional "Suggest a name" button in Step 1.

**Why:** comprehensive research needed before redesign of the 5-step create-group-trip wizard.
**How to apply:** reference docs/wizard-ux-research.md during wizard implementation.
