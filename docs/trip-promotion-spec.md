# Trip Promotion — "Help the host blow up their trip"

**Status:** Idea backlog / not built yet. This doc is the brief so a future session can
implement any item without re-deriving context.

**Where it lives today:** `src/screens/trips/TripPublishedScreen.tsx` — the success screen
shown right after a trip is published. Currently it has exactly one promotion action: a
native `Share.share()` that sends a join link (`getGroupTripInviteUrl(tripId)` →
`https://swellyo-invite.netlify.app/?grouptrip=<id>`). Recipients open the trip in-app and
tap "Request to join" (group trips are host-approved).

---

## The guiding principle (the WHY)

The published moment is **peak host motivation** — they just finished building, they're
excited, and they want crew. Whatever we put here has the highest chance of being acted on,
so it's the right place to invest.

"Share a link" treats the host as a **megaphone**: it maximizes *reach* but not *fit*. A
link dropped in a WhatsApp group reaches random people. Swellyo's unfair advantage is that
**the trip was built from hard filters** (surf level, board type, dates/months, destination,
accommodation). So Swellyo already knows *exactly who this trip is for*.

Therefore split promotion into two jobs:
1. **Fill it from inside Swellyo** — targeted, high-fit, unique to us (our moat).
2. **Broadcast it outside** — high reach (Instagram, link shares).

Qualified join requests > random link clicks. Build the moat first.

---

## Cross-cutting building blocks (most ideas reuse these)

- **Trip filters already stored on the trip** (`group_trips` row): `target_surf_levels`,
  `surfboard_type`/`accommodation_type`, `date_months` / `start_date`/`end_date`,
  destination (`destination`, `destinations_array` JSONB), age window, etc. See
  `CreateTripFlowA.tsx` save payload and `src/services/trips/groupTripsService.ts`.
- **Matching engine** — `findMatchingUsers()` / `findMatchingUsersV2()` in
  `src/services/matching/matchingService.ts`. Takes a `TripPlanningRequest` (with
  `queryFilters`) + `requestingUserId` + `excludedUserIds`, returns `MatchedUser[]` using
  Supabase hard filters (`.in()`, `.gte()/.lte()`, in-memory destination filter on
  `destinations_array`). Built for the "find surfers for me" chat, but the filter logic is
  reusable. (Note: it does some OpenAI area-normalization; for a lightweight invite list we
  may want a thinner query — see Idea 1 difficulties.)
- **Direct messages** — `MessagingProvider.tsx` + `src/services/messaging/messagingService.ts`.
  Supabase Realtime (recently migrated to a broadcast model). We can DM a user a trip card.
- **Invite link + deep linking** — `getGroupTripInviteUrl()`; the static invite site forwards
  `?grouptrip=` into the app via the `swellyo://` scheme; `AppContent.tsx`'s Linking listener
  opens the trip. Web is live on Netlify (also mirrored to SwellyoLove repo).
- **No image-capture / share libs installed yet.** `package.json` has no `react-native-view-shot`,
  `react-native-share`, `expo-sharing`, `expo-media-library`, or Skia. The IG-story and
  rich-preview ideas need new deps (call it out before installing).
- **Analytics:** PostHog is wired. Every promotion action should fire an event (see
  "Instrumentation" at the bottom) so we can see what actually fills trips.

---

## TIER 1 — Inside Swellyo (the moat, highest leverage)

### Idea 1 — Invite matching surfers ⭐ (build this first)
**What:** On the published screen, a section "Surfers who fit this trip" → a list of Swellyo
users matched against the trip's own filters, each with a one-tap **Invite** that DMs them the
trip card (link + "Join my trip").

**Why:** Unique to Swellyo, reuses code we already have, and produces *qualified* requests
instead of random clicks. Turns the host's filters (already collected) into distribution.

**How it'd work (UX):**
- After publish, fetch top N (~10–20) matches.
- Card per surfer: avatar, name, level/board, "Invite" button. Tapping sends a DM with the
  trip card and flips the button to "Invited ✓".
- Optional "Invite all top matches" bulk action.

**Implementation start:**
- Map the stored trip filters → a `TripPlanningRequest.queryFilters` shape, call
  `findMatchingUsers(request, hostUserId, [hostUserId])`.
- Reuse the DM send path in `messagingService.ts`; define a "trip invite" message type
  (renders a trip card bubble that deep-links to the trip).
- New UI: `TripPublishedScreen` section or a dedicated `InviteSurfersSheet`.

**Difficulties / risks:**
- `findMatchingUsers` is coupled to the planning-chat flow and does OpenAI area
  normalization → latency + cost on a success screen. Likely want a **thin dedicated query**
  (same Supabase hard-filters, no LLM) for the invite list.
- Notification/spam concerns: cap invites, don't let a user be spammed by many hosts; respect
  blocks. Need a `trip_invites` table to dedupe ("already invited") and to power the
  recipient's inbox.
- Privacy: only invite via DM (don't expose who matched beyond what's already public).
- Empty state when few/no matches (new destinations) — fall back to link share.

**Open questions:** invite = DM only, or also a dedicated notification + "Invites" inbox?
Cap per trip? Can invited users one-tap "Request to join" from the DM card?

---

### Idea 2 — Discovery feed / "Trips looking for crew"
**What:** A browsable surface where open trips appear, filterable by destination/dates/level.
The published trip gets listed automatically (host opt-in).

**Why:** Converts one-time *push* into ongoing *pull* — surfers find trips without being
invited. Compounds: every published trip feeds the feed; the feed drives joins.

**How it'd work:** New tab/section listing public trips (cards), with filters that mirror the
matching filters. "Request to join" from the card.

**Implementation start:** Query `group_trips` where `visibility='public'` + not full + future
dates; reuse `TripPreviewCard`. New screen + nav entry. Add ranking later (relevance to viewer
via matching).

**Difficulties:** Needs enough trip supply to feel alive (cold-start). Moderation/quality of
public trips. `visibility` already exists on trips — confirm semantics. Ranking/personalization
is a later layer.

---

### Idea 3 — Notify your network
**What:** When a host publishes, nudge their followers / past trip-mates: "X just posted a trip."

**Why:** Warm audience — people who already know the host convert best. Free distribution.

**Implementation start:** Requires a follow/relationship graph (confirm if one exists) or a
"people I've travelled with" set (derivable from past trip participants). Push via existing
notification infra (expo push token index migration landed recently).

**Difficulties:** Do we have a follow graph today? If not, scope to past trip-mates first.
Notification fatigue — frequency caps.

---

## TIER 2 — Outside Swellyo (reach)

### Idea 4 — Instagram Story share ⭐ (best external add)
**What:** Auto-generate a branded trip card image (hero photo + title + dates + "Join on
Swellyo" + maybe a QR/handle) and drop it straight into the user's IG Story with the link.

**Why:** Instagram is where this audience lives. A designed story card >> a pasted link. High
viral potential per host.

**How it'd work (UX):** "Share to Instagram" button → render the card → open IG Stories with the
image as the background; user adds a link sticker (or we preset it where supported).

**Implementation start:**
- Render an off-screen branded card → image via **`react-native-view-shot`** (new dep).
- Share to IG Stories: `Linking`/intent to `instagram-stories://share` with
  `backgroundImage`/`stickerImage` (iOS needs `LSApplicationQueriesSchemes` for `instagram-stories`;
  Android needs the intent + FacebookAppID). Fallback: save image + open IG / generic share
  sheet (`expo-sharing` or `react-native-share`, also new deps).

**Difficulties:**
- New native deps → **requires a dev/native rebuild** (see PRE_BUILD_CHECKLIST.md), not OTA.
- IG link stickers are gated by IG; reliable path is image background + user adds link sticker,
  or rely on the bio/profile link. Manage expectations.
- Per-platform plumbing (iOS query schemes, Android FacebookAppID). Test on real device
  (Eyal's iOS dev client).
- Design the card template (needs the hero image; handle missing-photo case).

**Open questions:** Story only, or also a feed-post image + Twitter/X? Include QR code for the
trip link?

---

### Idea 5 — Rich link previews + web landing page
**What:** Make the shared link *unfurl* with a real image/title/description in
WhatsApp/iMessage/Telegram, and land non-app users on a web page that previews the trip and
pushes the app.

**Why:** Today a bare `?grouptrip=` link converts poorly — no preview, dead-ends for people
without the app. A rich card + real landing page massively lifts click→join.

**How it'd work:**
- Per-trip **Open Graph** tags (`og:title`, `og:description`, `og:image`) so the link shows a
  card anywhere it's pasted.
- A web trip-preview page (hero, title, dates, "Open in app" / "Get the app").

**Implementation start:** Replace/augment the static `swellyo-invite.netlify.app` forwarder
with a **Netlify Function** (web deploys on Netlify) that reads the trip (public fields) and
serves per-trip OG meta + a preview page; deep-links into the app if installed. Generate an OG
image (dynamic via a function, or reuse the trip hero).

**Difficulties:** Need a public, read-only trip endpoint (RLS for anonymous read of public
trips). OG image generation infra (or just use the hero URL). Keep app deep-link behavior
intact. Two repos to deploy (swellyoNew + SwellyoLove).

---

### Idea 6 — Copy link (tiny, do alongside)
**What:** One-tap "Copy link" next to Share. **Why:** Some hosts want to paste it themselves.
**Implementation:** `expo-clipboard` (confirm installed) + toast. Trivial.

---

## TIER 3 — Virality mechanics (later)

### Idea 7 — Members re-share (turn joiners into nodes)
**What:** When someone joins, prompt *them* to invite their crew. **Why:** Each join becomes a
new distribution node — compounding reach. **Start:** Add the same share/invite actions to the
member view of an approved trip; nudge on join. **Difficulty:** Don't be naggy; one well-timed
prompt.

### Idea 8 — Light incentives / referral
**What:** "Invite 3 surfers to unlock …" or referral credit. **Why:** Pushes hosts who'd
otherwise stop at one share. **Difficulty:** Needs a reward worth chasing + anti-abuse; only if
we want to lean into growth. Probably last.

---

## Recommended sequencing

1. **Idea 1 — Invite matching surfers** (moat, reuses matching + DMs; JS-only if we add a thin
   query). Highest value.
2. **Idea 6 — Copy link** (trivial, ship with #1).
3. **Idea 5 — Rich link + web preview** (lifts the link we already share; web/Netlify work).
4. **Idea 4 — Instagram Story share** (best external reach; needs native rebuild).
5. **Idea 2 — Discovery feed** (compounding, but needs trip supply).
6. **Ideas 3, 7, 8** as follow-ups.

## Instrumentation (do for every item)
Fire PostHog events so we learn what actually fills trips:
`promo_share_link`, `promo_copy_link`, `promo_invite_surfer` (with match score),
`promo_invite_all`, `promo_ig_story`, `promo_feed_view`, and downstream
`join_request_from_invite` / `join_request_from_link` so we can attribute joins to channel.

## Data/infra likely needed
- `trip_invites` table (host_id, trip_id, invitee_id, channel, status, created_at) — dedupe +
  recipient inbox + attribution.
- Anonymous read access (RLS) to public trip fields for the web preview.
- Confirm whether a follow/relationship graph exists (for Idea 3).
- New deps for IG/image: `react-native-view-shot` (+ `expo-sharing` or `react-native-share`) →
  native rebuild required.
