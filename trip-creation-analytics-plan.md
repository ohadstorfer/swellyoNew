# Trip-Creation Funnel Analytics — Plan

**Status:** Planning doc, nothing built yet.
**Goal in one line:** instrument the trip-creation wizard exactly like we already instrument onboarding — every step, every bottom sheet, and every abandonment point — so we can see where hosts drop off.

---

## Why

Onboarding has a full funnel today; trip creation has **none** (`CreateTripFlowA.tsx`, ~4,400 lines, zero `analyticsService` calls). We're flying blind on the single most important supply action: a host publishing a trip. We can't answer "where do hosts give up?" until this exists.

The pattern is already proven on onboarding — we just mirror it. No new infra.

---

## The flow we're tracking

**Wizard:** `CreateTripWizard.tsx` → `CreateTripFlowA.tsx` (flow variants A / B / C).

**Steps (key — label):**
1. `audience` — Who is it for?
2. `basics` — Trip details (destination, dates, name, cover photo)
3. `vibez` — Trip vibe
4. `budget` — Budget
5. `preview` — Preview → **publish**
- (`aboutYou` — only in Flow B)

**Bottom sheets (inline editors):** Levels, WaveSize, Style, Age, When, HowItWorks, Vibe, StayType, SpecificStay, Activities, SurfFilm, etc. (shell = `WizardBottomSheet.tsx`).

---

## What to track (mirror onboarding's `onboarding_stepN_completed` convention)

| Event | When it fires | Properties |
|---|---|---|
| `trip_creation_started` | Wizard mounts | `flow_variant` (A/B/C) |
| `trip_step_[key]_viewed` | Each step becomes visible | `step_key`, `step_index` |
| `trip_step_[key]_completed` | Next pressed on that step | `step_key`, `step_index` |
| `trip_sheet_[key]_opened` | A bottom sheet opens | `sheet_key`, `step_key` |
| `trip_sheet_[key]_saved` / `_dismissed` | Sheet closed with/without saving | `sheet_key` |
| `trip_published` | Final publish on preview | `flow_variant`, `duration_seconds` |
| `trip_creation_abandoned` | Left before publishing | `abandoned_at_step`, `exit_reason`, `time_spent_seconds` |

**`exit_reason` values** (the three ways people quit — explicitly requested):
- `app_closed` — app backgrounded/killed mid-flow
- `flow_exited` — user hit back / discarded out of the wizard
- `timeout` — inactivity timeout fired (mirror onboarding's 12-min timer; pick a trip value, e.g. 15 min)

---

## Abandonment detection (mirror onboarding)

Onboarding uses: `surfers.finished_onboarding` boolean + a client inactivity timeout (`startOnboardingAbandonTracking`) + server-side push reminders (`notify-abandoned-onboarding`).

Mirror for trips:
- **DB flag:** add `finished_trip_creation` (or per-draft status) so we know who started but never published.
- **Client timeout:** start an abandon timer when the wizard opens; fire `trip_creation_abandoned` if it elapses.
- **Exit/back hook:** fire `trip_creation_abandoned` with `flow_exited` on discard, `app_closed` on background.
- **(Optional, later)** push reminders to nudge hosts who abandoned a draft — only if we want it.

---

## Build order

- **Phase 1** — fire the step + publish events (`started`, `step_*`, `published`). Instant funnel, smallest change.
- **Phase 2** — bottom-sheet events + abandonment (`exit_reason`, timeout, DB flag).
- **Phase 3** — optional abandoned-draft push reminders.

## Reuses (no new infra)
PostHog `analyticsService` wrapper, the existing event queue, the admin analytics dashboard for display.

## Reference (existing onboarding implementation to copy from)
- Events: `src/services/analytics/analyticsService.ts` (`trackOnboardingStep1/2Completed`, `startOnboardingAbandonTracking` ~L336)
- PostHog wrapper: `src/services/analytics/posthogService.ts`
- Abandon flag: `surfers.finished_onboarding`; server reminders: `supabase/functions/notify-abandoned-onboarding/`
