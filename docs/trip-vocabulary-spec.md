# Trip Vocabulary — Crew · Captain · Operator

**One line:** Crew, Captain, Operator — *together, led, business.*
Three ways a surf trip comes to life. Same product, three energies.

This is the single, intentional vocabulary for the three trip flows. It replaces the
inconsistent labels that previously existed across the Create chooser, Explore pills,
and the Overview chip (the same flow was called 3 different things).

## Data vs. language

The flows stay keyed internally as `HostingStyle = 'A' | 'B' | 'C'` (a stable DB column on
`group_trips`). We do **not** rename the data. All user-facing language is centralized in
`src/services/trips/tripVocabulary.ts` and imported everywhere.

| Internal | Word | Energy |
|---|---|---|
| `A` | **Crew** | together |
| `B` | **Captain** | led |
| `C` | **Operator** | business |

The progression is deliberate: casual/together → one person leads → professional/commercial.
Crew & Captain share a nautical metaphor (a captain leads a crew). "Operator" breaks the
metaphor on purpose — the break signals the jump into a business.

---

## 1. CREW (A) — "together"

A group of surfers builds the trip together. Shared decisions, nobody above anyone.

- **One-word:** Crew
- **Explore pill:** Crew
- **Overview byline:** By the crew
- **The creator is:** part of the crew
- **People section title:** Your crew
- **Chooser card:**
  - Title: **Crew**
  - Tagline: **Planned together**
  - Body: "You and your crew shape the trip as a group — votes on the big calls, you approve what moves forward."
- **Voice:** "your crew", "plan it together", "gather a crew"

## 2. CAPTAIN (B) — "led"

One person sets the course. Others join and ride along.

- **One-word:** Captain
- **Explore pill:** Captained
- **Overview byline:** Captained / Led by [name]
- **The creator is:** the Captain
- **People section title:** Meet your Captain
- **Chooser card:**
  - Title: **Captain**
  - Tagline: **You lead the way**
  - Body: "You're the Captain. You set the plan, surfers join and support it."
- **Voice:** "you're the Captain", "take the helm", "Why you're the right Captain"
- Replaces every prior use of "leader" / "host (you lead)".

## 3. OPERATOR (C) — "business"

A business runs it. Everything's fixed — price, plan, stay. Join knowing exactly what you get.

- **One-word:** Operator
- **Explore pill:** Operator
- **Overview byline:** By a trip operator
- **The creator is:** the operator
- **People section title:** Run by
- **Chooser card:**
  - Title: **Operator**
  - Tagline: **Run like a business**
  - Body: "Everything's already set — dates, price, the lot. Surfers join knowing exactly what to expect."
- **Voice:** "the price you set", "run the show"

---

## Cross-surface phrasing table

| Context | Crew (A) | Captain (B) | Operator (C) |
|---|---|---|---|
| Chooser title | Crew | Captain | Operator |
| Chooser tagline | Planned together | You lead the way | Run like a business |
| Explore pill | Crew | Captained | Operator |
| Overview chip / byline | By the crew | Captained | By a trip operator |
| Role word (creator) | the crew | the Captain | the operator |
| People section | Your crew | Meet your Captain | Run by |

## Implementation

1. New module `src/services/trips/tripVocabulary.ts` — exports all labels/bylines/role
   words/chooser copy keyed by `HostingStyle`. Single source of truth.
2. Replace the 3 scattered label maps:
   - `TripsScreen.tsx` → `HOSTING_STYLE_OPTIONS` (chooser)
   - `TripsScreen.tsx` → `TRIP_TYPE` (explore pill)
   - `TripDetailView.tsx` → `TRIP_TYPE_LABEL` (overview chip)
3. Sweep role-specific copy in `CreateTripFlowA.tsx`, `TripDetailScreen.tsx`,
   `TripDetailViewRedesigned.tsx`: "leader" → "Captain", "Meet your leader" →
   "Meet your Captain", etc.
4. Unchanged (low risk): DB values, `WIZARD_STATE_VERSION`, file names, internal
   boolean flags (`isLeaderFlow`/`isFixedFlow`).
