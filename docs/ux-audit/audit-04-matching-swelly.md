# UX Audit — Matching & Swelly AI

Domain: the Swelly AI chat that extracts filters, the DB match query, and the results carousel + all the picker components feeding it. Bar: WhatsApp / Instagram polish.

Scope reviewed:
- `src/screens/TripPlanningChatScreen.tsx` (the live matching chat)
- `src/screens/SwellyShaperScreen.tsx` (profile-edit AI chat)
- `src/components/MatchedUserCard.tsx`, `MatchedUsersCarousel.tsx`
- `src/components/BoardCarousel.tsx`, `BoardTypeSelector.tsx`, `BudgetButtonSelector.tsx`, `BudgetCardsCarousel.tsx`
- `src/components/Destination*` (via sub-audit)
- `src/services/matching/*`, `src/services/swelly/*`, `src/services/destinations/*` (via sub-audit)

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Top 5 most impactful fixes

1. **🔴 Network/timeout errors are dressed up as "no surfers found."** `runFindMatches`'s `catch` posts *"Sorry, I couldn't find any matches… Try adjusting your destination or preferences"* (`TripPlanningChatScreen.tsx:1191-1196`), and the AI-request service layer has **no timeout and no retry** (services audit). A dropped request tells the user their filters are too narrow. Split "error" from "empty" and add a **Retry** affordance.

2. **🔴 The zero-match state — the single most important screen in a hard-filter search — is one gray sentence with no next step.** No matches renders text only (`:1164`) and, because the action row only renders when `matchedUsers.length > 0` (`:1906`), there is **no "Adjust filters" / "Broaden search" button** attached to it. Give the empty state a real CTA (open Filters, remove the narrowest filter, retry).

3. **🟠 The 30-second loading timeout silently kills the spinner with no message.** `startLoadingWithTimeout` force-sets `isLoading=false` after 30s (`:1059-1066`) but never aborts the request and never posts anything — the typing dots just vanish into a dead end. Replace with an in-chat timeout message + Retry, and actually `AbortController` the fetch.

4. **🟠 Match cards are anonymous and give no reason for the match.** `MatchedUserCard` shows only name + "age yo | country" (`MatchedUserCard.tsx:42-47`), everyone shares one identical generic cover image (`:21,33`), `name` can render literally as **"User"** (`:42`), the profile image has **no placeholder / fade / onError** (`:35-39`), and the only action is a small "View Profile" text link — **no "Message" button** even though `handleSendMessage` exists (`TripPlanningChatScreen.tsx:1456`). In a hard-filter search, show *why* they matched (surf level / board / destination) and add a direct Message CTA.

5. **🟠 The whole conversation is free-text only, and yes/no decisions are parsed by fragile substring matching.** No suggested replies / quick-reply chips anywhere; the single-criterion "show these now?" question is answered by `.includes('yes'|'show'|'now'|…)` (`:1220-1229`) where e.g. **"not now" matches `now` and is read as YES** (`:1289` else-branch never reached). Add tappable Yes/No + suggested-reply chips for every decision point.

---

## TripPlanningChatScreen — Loading states

- 🟠 **30s loading timeout is a silent dead-end.** `:1059-1066` clears `isLoading` after 30s but posts no message and doesn't abort the in-flight fetch (services audit: no `AbortController` anywhere). User sees dots disappear, nothing arrives, input re-enables with no explanation. *Fix: on timeout, append an in-chat "That took too long — tap to retry" message and abort the request.*
- 🟡 **Dead "Finding the perfect surfers for you…" plumbing.** `runFindMatches` filters out a message with that exact text (`:1130`, `:1168`) that is **never added** anywhere. The matching query shows only the generic 3-dot typing indicator — fine, but the filter is leftover dead code and a missed chance for a branded "Searching…" state. *Fix: either add the labeled searching message or delete the filter.*
- 🟡 **No distinct "running the DB query" state.** Chatting with Swelly and running the match query render the *same* typing indicator (`listHeaderComponent`, `:2155-2166`). A search that returns 40 cards feels identical to a one-line reply. *Fix: a dedicated "Finding surfers…" shimmer / card skeletons.*
- 🔵 **Card carousel has no image-loading skeleton** (see Cards section) so the "results appeared" moment is followed by a second of blank avatars.

## TripPlanningChatScreen — Error & failure handling

- 🔴 **Errors are reported as empty results.** `:1191-1196` catch-block copy blames the user's filters for what may be a network/OpenAI/timeout failure. Combined with the service layer throwing raw `HTTP error! status: N` with no retry (services audit), any transient failure looks like "no surfers exist." *Fix: distinct error copy + Retry button; keep the user's filters intact.*
- 🟠 **`sendMessage` failure uses a native `Alert` and loses the turn.** `:1447` `Alert.alert('Error', 'Failed to send message. Please try again.')`. This (a) violates the project's own `friendlyErrorMessage`/in-chat convention (memory: *Friendly error alerts*), (b) leaves the user's message in the thread with no bot reply and no inline retry. *Fix: in-chat error bubble with a tap-to-retry, matching SwellyShaper's inline pattern (`SwellyShaperScreen.tsx:244-250`).*
- 🟡 **Init/backend-create failure shows a blocking `Alert` over an already-populated UI.** `:1040` and `:1046-1050` fire "Connection Error" alerts even though the topic overlay / first messages already rendered — the user can be mid-topic-selection when a modal alert interrupts. *Fix: non-blocking inline banner; let them keep reading.*
- 🟡 **Inconsistent error UX between the two AI chats.** Matching uses `Alert.alert` (`:1447`); Shaper uses an in-chat bubble (`SwellyShaperScreen.tsx:246`). Pick one (the in-chat one).

## TripPlanningChatScreen — Empty states (critical for hard-filter)

- 🔴 **Zero-match state has no guided next step.** `:1162-1187` posts a plain sentence; no action row is attached (action row requires `matchedUsers.length > 0`, `:1906`). The user's only recourse is to *find* the floating filters button themselves or free-type. *Fix: attach a CTA row to the no-match message — "Adjust filters", "Remove [narrowest filter]", "Search anyway near [country]".*
- 🟠 **No "closest matches" fallback on the live path.** The legacy `matchingService.ts` had a rich relax-and-retry that returns nearest surfers + a human "why no matches" explanation (services audit: `analyzeNoMatchesReason`), but the live server path (`findMatchingUsersServer`) just returns `[]`. The best empty-state UX in the codebase is dead code. *Fix: have the edge fn return closest-N + reason, or reintroduce a client relax pass.*
- 🟡 **First-time / cold state leans entirely on the topic overlay.** If a user dismisses `SwellyTopicOverlay` (`:2586-2593`) it calls `onChatComplete` and leaves — there's no empty chat with example prompts to fall back to. *Fix: a lightweight starter-prompt state behind the overlay.*

## TripPlanningChatScreen — Conversational UX

- 🟠 **No suggested replies / quick-reply chips anywhere.** Every step is free typing, including obvious binary/enumerated choices (surf level, board type, "search now or add filters?"). This is the biggest gap vs. a polished assistant. *Fix: render tappable chips from the AI's `next_action` / known enums.*
- 🟠 **Yes/No decisions parsed by brittle substring matching.** `:1220-1229` — `wantsToSee` triggers on `includes('now')`, so **"not now" → YES**; `'ok'` matches inside "broke", etc. The intended "no" branch (`:1289`) is frequently unreachable. The search-decision regex at `:1348` is more careful but still text-only. *Fix: explicit Yes/No buttons; stop inferring intent from substrings.*
- 🟡 **You can remove filters but not edit or add them via UI.** Removal = drag-to-trash or X chip (`:2406-2435`); adding is a chat button that just prompts you to *type* what to add (`:1593-1599`). No way to tap a filter to change its value. *Fix: tap-chip-to-edit; an "Add filter" picker.*
- 🟡 **Filter removal is immediate with no undo.** `handleRemoveFilter` (`:1709`) fires a backend ack instantly. *Fix: brief "Removed [X] · Undo" snackbar.*
- 🔵 **"Review filters" / Search buttons are good** (`:2065-2130`) — clear affordance, gradient CTA. Keep.

## TripPlanningChatScreen — Feedback & input

- 🟡 **Input disables globally on an unresolved action row, even when that row is scrolled off-screen.** `disabled={… || hasUnresolvedActionRow …}` with placeholder "Choose an option above to continue" (`:2300-2301`). If the action row is above the fold the user sees a dead input and no visible options. *Fix: auto-scroll to / pulse the pending action row when the user taps the disabled input.*
- 🟡 **No haptics on any matching interaction** — not on match-found, not on filter delete, not on send. WhatsApp/IG give a light impact on these. *Fix: `Haptics` on match arrival, filter drop into trash, and search fire.*
- 🔵 **"3 More" button label is hardcoded** regardless of remaining count (`:2002`) — shows "3 More" even when 5+ remain. *Fix: `${remaining} More`.*
- 🔵 **Send is blocking (no streaming).** Spinner → full message (services audit: everything is a single `await response.json()`). Acceptable, but streaming the AI text would feel materially faster.

---

## MatchedUserCard & MatchedUsersCarousel

- 🟠 **Cards give no match reason and look generic.** Only name + "age yo | country" (`MatchedUserCard.tsx:42-47`). No surf level, board type, or the destination they matched on — the very fields the hard filter used (services audit: `surf_level`, `surfboard_type`, `matched_areas` all come back but are dropped). *Fix: add 1–2 match-reason chips ("Advanced · Longboard · surfed Bali").*
- 🟠 **Profile image has no placeholder, fade-in, or error fallback.** `:35-39` renders `<Image source={{uri}}>` directly; a slow or broken URL shows blank/broken with pop-in as the carousel scrolls. Cover image is one shared static asset for everyone (`:21,33`). *Fix: blurhash/placeholder + fade; `onError` → default avatar; consider a real per-user cover.*
- 🟠 **No direct "Message" action on a card.** Only a small "View Profile" text link (`:50-59`); to DM a match you must open the profile first. `onStartConversation`/`handleSendMessage` already exist (`TripPlanningChatScreen.tsx:1456-1467`) but aren't wired to a card button. *Fix: add a "Message" CTA on the card.*
- 🟠 **Carousel auto-jumps to the MIDDLE card on layout.** `MatchedUsersCarousel.tsx:33-39` scrolls to `floor(users.length/2)`. If results are ranked, this hides the top matches and starts the user in the middle. *Fix: start at index 0 (best match) unless there's a deliberate reason.*
- 🟡 **`name` can render as literally "User".** `:42` `user.name || 'User'`; age+country can both be empty → `cardDetails` renders an empty line (`:43-47`). Missing-data mapping passes nulls straight through (services audit: `mapServerMatchToMatchedUser`). *Fix: hide empty rows; better fallback than "User".*
- 🟡 **No carousel position indicator.** Plain snapping `ScrollView` (`:52-78`), no dots / "3 of 12". User can't tell how many matches exist or where they are. *Fix: pagination dots or count label.*
- 🟡 **Only "View Profile" is tappable; the card body isn't.** Avatar + name aren't a tap target (`:31-48`), and the button itself is small. *Fix: make the whole card tappable to open the profile.*
- 🟡 **Card uses raw RN `Text` + web-only `fontFamily`.** `:2-9`, `:114-135` — on native this falls back to the system font, breaking the app's font-parity rules (memory: *Implement with ff()*). *Fix: use the app `Text`/`ff()`.*
- 🔵 **Hardcoded dimensions** (width 274, cover 102, avatar marginTop −75) don't scale for small/large fonts or narrow devices (`:66-103`).

---

## SwellyShaperScreen (profile-edit AI)

- 🟠 **No loading timeout guard.** Unlike the matching screen, `handleSend` (`:190-252`) has no 30s failsafe — if `processMessage` hangs (no timeout in the service, services audit), the typing indicator spins **forever** with the input disabled. *Fix: mirror `startLoadingWithTimeout`.*
- 🟡 **History-restore failure is silent.** `:140-143` swallows the error and shows only the welcome message — a user with a long edit history silently loses it. *Fix: a subtle "couldn't load history" note.*
- 🟡 **Good inline error pattern here** (`:244-250`) — this is the model the matching screen should copy.
- 🔵 **Duplicated `TypingIndicator`** — identical component defined here (`:262-321`) and in TripPlanningChatScreen (`:1480-1539`). *Fix: extract one shared component.*

---

## Destination pickers (used inside the Swelly flow)

Full findings from sub-audit; highlights:

- 🟠 **Google Places autocomplete fails silently — no results, errors, and missing-API-key all collapse to "nothing appears."** `DestinationMapPickerCard.tsx:450,468` (`setSuggestions([])` on both HTTP and network error), no zero-results row (`:509`), and the field goes dead with an inviting placeholder when the key is absent (`:609`). *Fix: explicit "No places found" / "Couldn't load — retry" / "Search unavailable" states.*
- 🟠 **The inline "map" is decorative (`pointerEvents="none"`) yet sits on a screen called "map picker," and while shown it covers the time input + Next button.** `MapPickerModal.tsx:77,99,111,165`, overlay `:360-368`. Misleading affordance. *Fix: make it interactive or shrink it to a non-map visual; don't obscure the form.*
- 🟠 **No WebView error/Expo-Go fallback** — a failed map (no network, bad key, Expo Go) shows a blank area with no message (`MapPickerModal.tsx`, no `onError`; `WebView===null` renders empty). *Fix: error + "map unavailable" fallbacks.*
- 🟠 **Clearing the duration field silently desyncs data from UI** in both cards — empty → `parseFloat` NaN → effect early-returns and the stale value stays reported while `isAllDataValid` still passes (`DestinationInputCard.tsx:170-174`, `DestinationMapPickerCard.tsx:260-263`). *Fix: push `0` and show inline validation.*
- 🟡 **Per-card "Next" is never gated** (`DestinationInputCard.tsx:465`) — user can advance past an empty card; only final Save validates, and `handleSubmit` then fails silently (`DestinationCardsCarousel.tsx:115-117`). *Fix: gate Next per card, or auto-scroll to the first invalid card.*
- 🟡 **Duration unit picker is swipe-only, one step per gesture, tap-dead** (`DestinationInputCard.tsx:417`, `DestinationMapPickerCard.tsx:688-714`) — Days→Years needs 3 deliberate swipes; you can't tap a visible unit. A nicer momentum/tap version exists (`DestinationDurationInput.tsx`) but **isn't wired into either card**. *Fix: consolidate onto the better component; add tap-to-select.*
- 🟡 **No carousel position affordance** on the destination cards (`DestinationCardsCarousel.tsx:43`, tracked but never rendered) — no dots, no "N of M", native scroll disabled so snap props are dead code (`:343-393`). *Fix: dots/label + real snapping.*
- 🔵 Background/place images pop in with no placeholder or fade (`DestinationInputCard.tsx:325`); no debounce visible on some search paths; hardcoded hex colors bypass theme.

---

## Onboarding selectors feeding the filters (Board / Budget)

- 🟡 **Three separate bespoke infinite-carousel implementations** (`BoardCarousel.tsx`, `BudgetCardsCarousel.tsx`, `DestinationCardsCarousel.tsx`), each hand-rolling touch handling, edge-wrapping, and `setTimeout`-based snapping. `BoardCarousel` disables native scroll entirely and drives everything off manual `onTouch*` + many timing races (`BoardCarousel.tsx:244-413`, `scrollEnabled={false}` `:879`). High fragility, inconsistent feel between the three. *Fix: standardize on one carousel primitive.*
- 🟡 **Two different budget UIs** — a 3-button selector (`BudgetButtonSelector.tsx`) and a 4-card carousel (`BudgetCardsCarousel.tsx`) with different option sets (`budget/mid/high` vs adding `premium`). Inconsistent. Note budget matching is disabled per CLAUDE.md, so this is low-value surface. *Fix: converge or retire one.*
- 🟡 **`BoardTypeSelector` reuses surf-level icons for board types** with a misleading mapping (`BoardTypeSelector.tsx:36-43`, e.g. "Soft Top → charging/expert"). Visually implies a difficulty ranking that isn't real. *Fix: board-specific icons.*
- 🔵 **`BudgetButtonSelector` fakes a 300ms "Submitting…" delay** (`:37-39`) with no real async work — cargo-cult feedback. *Fix: remove or tie to real work.*
- 🔵 `BudgetCardsCarousel` card image (non-structured branch) has `#f5f5f5` bg but no load/error handling (`:444-448`).

---

## Cross-cutting themes

- **Silent failure is the dominant anti-pattern** across matching, AI, and destination code: no timeouts, no retries, errors mapped to empty states, missing-key/no-result/map-error all rendering as "nothing." Every one needs an explicit loading / empty / error state.
- **Free-text-only interaction** with no quick replies, plus intent inferred from `.includes()` substrings, makes an "AI assistant" feel less capable than the buttons it's replacing.
- **Match results are the payoff and they're under-designed** — generic cards, no match reason, no message CTA, middle-card start, no image handling.
- **Rich empty-state and closest-match logic already exists in the codebase but is dead** (legacy `matchingService.ts`); the live server path throws it away.
- **Three bespoke carousels + duplicated TypingIndicators + raw-Text cards** = accumulating inconsistency; consolidation would raise the floor everywhere.
