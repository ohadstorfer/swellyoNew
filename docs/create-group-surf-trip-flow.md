# Create a Group Surf Trip — Flow Spec

Status: **Not implemented yet.** This document describes a planned feature for organizing (hosting) a new group surf trip in the Swellyo app. Source: archived Figma spec in the "🗂️ Archives" canvas of the Swellyo Data Entry App file.

## Overview

This is the flow a **host** (trip organizer) goes through to create a new group surf trip that other travelers can later join. It is distinct from the existing "Join a trip" and "Swelly chat trip planning" flows — here the user is creating a trip they will lead, not searching for one.

The spec defines **three variants (A, B, C)** of the same flow. The variants are not separate features — they are the same set of steps tuned to three different host personalities / levels of control. The host picks one at the very beginning via a single question, and the rest of the flow adapts (which fields are required, which can be skipped, and how granular the inputs are).

Legend used in the spec:
- 🟣 **must** — field is required in this variant
- 🟢 **skip** — field can be skipped in this variant

## Step 0 — Pick the hosting style

The flow opens with one question:

> **Do you want to…**
> - **A.** create a group with a general idea, then take decisions together
> - **B.** lead the group on most topics, but still allow open discussion on some of them
> - **C.** create a full trip for others to join your exact vision

- **A** = loose / collaborative host. Many fields are skippable, dates and destination can stay fuzzy.
- **B** = semi-structured host. Real dates, destination required, accommodation can be by style or specific.
- **C** = fully prescriptive host. Everything is locked — exact dates, specific destination + spot, specific accommodation, tightest participant age range.

The answer to this question drives the required/optional status of every subsequent field.

## Step 1 — General details

Same ordered steps for all three variants. Differences per variant noted inline.

### 1.1 Trip name
- **A:** required
- **B / C:** optional

### 1.2 Trip hero image
- Required in all variants.

### 1.3 Description
- Required in all variants.

### 1.4 Dates
- **A:** month / months only. Target 1–3 months. (Fuzzy window, not a specific date range.)
- **B:** specific dates + follow-up question "are they set in stone?"
- **C:** specific dates + follow-up question "are they set in stone?"

### 1.5 Destination / spot
- **A:** pick a destination / spot, with a skip option for both.
- **B:** pick a destination / spot, with a skip option for **spot only** (destination is required).
- **C:** pick a destination **and** a spot. Both required.

### 1.6 Where will you stay
- **A:** pick a type only — hostel / bungalow / villa / hotel / eco lodge / etc.
- **B:** two sub-steps — (a) style, then (b) specific:
  - a. hostel / bungalow / villa / hotel / eco lodge / etc
  - b. enter name, website URL, picture
- **C:** enter name, website URL, picture (specific accommodation required).

### 1.7 Trip vibe (optional in all variants)
Four day-part selectors:
- **Morning** — selection: surf / yoga / …
- **Afternoon** — chill / eat / surf
- **Evening**
- **Night** — sleep well / party / …

### 1.8 Where will we surf (optional in all variants)
Search and select spots the group plans to surf at.

## Step 2 — Participants alignment

This section defines the profile of travelers the host wants to attract. Rules tighten from A → C.

### 2.1 Age range
Minimum allowed window width:
- **A:** 7 years
- **B:** 5 years
- **C:** 2 years

(C forces the tightest targeting; A forces the host to stay broad.)

### 2.2 Target surf level (multi-select, at least one)
- beginner
- intermediate
- advanced
- pro
- all levels

### 2.3 Target surf style (multi-select, at least one)
- shortboard
- midlength
- longboard
- softtop
- all styles

### 2.4 What type of waves you are aiming to surf
UI: animation with sliding bars for **fat ↔ barreling**, plus **size (ft / m)**.

Option to skip with a note:

> "if you have multiple levels, consider skipping this step"

## Step 3 — After Creation: Invite travelers

Once the trip is created, the host lands on an invite screen with four ways to bring people in:

1. **Copy invitation link** — shareable URL with a copy button.
2. **Invite via email** — email input field.
3. **Upload to Instagram** — share a generated asset to IG.
4. **Search travelers with Swelly** — use the existing Swelly matching flow to find travelers that fit the trip's participants-alignment filters.

The fourth option is the natural bridge to the existing matching system — once the host has defined surf level, style, age range, etc., those same filters can be fed into `matchingService.findMatchingUsers()` to surface candidate travelers.

## Summary table

| Field                    | A (collaborative) | B (semi-structured) | C (prescriptive)          |
| ------------------------ | ----------------- | ------------------- | ------------------------- |
| Trip name                | required          | optional            | optional                  |
| Hero image               | required          | required            | required                  |
| Description              | required          | required            | required                  |
| Dates                    | month(s), 1–3 mo  | exact + set-in-stone| exact + set-in-stone      |
| Destination              | skippable         | required            | required                  |
| Spot                     | skippable         | skippable           | required                  |
| Accommodation            | type only         | type + specific     | specific only             |
| Trip vibe                | optional          | optional            | optional                  |
| Surf spots list          | optional          | optional            | optional                  |
| Age range (min width)    | 7 years           | 5 years             | 2 years                   |
| Surf level (multi)       | required          | required            | required                  |
| Surf style (multi)       | required          | required            | required                  |
| Wave type (fat↔barreling + size) | skippable | skippable           | skippable                 |

## Notes for implementation (not in the spec, inferred from the repo)

- This feature does **not** exist yet in the codebase. There is no "create group trip" screen or service.
- The matching filters described in Step 2 overlap heavily with the existing hard-filter set in `src/services/matchingService.ts` (country, age range, `surfboard_type`, `surf_level_category`), so the "Search travelers with Swelly" button in Step 3 should be able to reuse `findMatchingUsers()` with filters derived from the trip.
- `destinations_array` is JSONB and filtered in-memory — the destination/spot selection from Step 1.5 will need to respect that when querying.
- Hero image and accommodation picture uploads should go through Supabase Storage, same as existing profile media.
- The "three variants" should almost certainly be stored as a single `hosting_style: 'A' | 'B' | 'C'` column on the trip row, with the required/optional logic enforced client-side in the creation wizard and validated server-side on insert.
