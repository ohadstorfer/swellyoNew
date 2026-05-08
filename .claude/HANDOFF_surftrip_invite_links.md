# Surftrip Invite Links — Handoff

## What got built (this session, all on `ohad` branch, uncommitted)

Native-priority invite link system for surftrip groups. Behavior:
- Admin/host shares link → invitee auto-joins
- Member shares → invitee creates pending request (admin approves)
- Sharer demoted or left group → fallback to request flow (hybrid frozen+current role check)
- Web → "Get the app" landing only (no web auto-join, by product decision)
- App not installed → store fallback via Universal Links / App Links

### DB (applied to production via MCP)

Migration: `supabase/migrations/20260508000000_surftrip_invite_links.sql`

- `public.surftrip_invite_links` — id, group_id, created_by, created_role, revoked_at, `unique(group_id, created_by)` so one stable token per (sharer, group)
- RLS: only `created_by = auth.uid()` member can SELECT their own row
- `add_surftrip_member_with_conversation(group, user, role)` — helper, dual insert into `surftrip_group_members` + `conversation_members`
- `create_surftrip_invite(group_id) -> uuid` — captures current role, upsert
- `accept_surftrip_invite(token) -> json` — outcomes: invalid / already_member / joined / requested / group_full. Uses `pg_advisory_xact_lock(hashtext('surftrip:'||group_id))` so concurrent last-seat clicks are serialized. Hybrid role: `min(created_role, current_sharer_role)`. If pending request exists when auto-joining, marks it approved cleanly (membership inserted first, trigger no-ops).
- `get_surftrip_invite_preview(token) -> json` — anon-callable, whitelisted fields only (returns nulls for invalid tokens, doesn't leak existence)
- Refactored `handle_surftrip_join_request_approval` — same advisory lock + capacity check, calls helper. Fixes a pre-existing race in the approval flow.

### Edge function (deployed via MCP)

`supabase/functions/send-surftrip-request-notification/index.ts` — fan-out to all `host`/`admin` members of the group on new pending request. `verify_jwt: false` (webhook pattern, matches existing functions).

### Client

- `src/services/surftrips/surftripsService.ts` — `getSurftripInviteUrl` is now async (calls RPC, returns tokenized URL); added `acceptSurftripInvite(token)` and `getSurftripInvitePreview(token)`. Linter touched the file but only added other unrelated entries (addMembersFromDms, listAddableDmPartners) — don't revert.
- `src/screens/surftrips/SurftripDetailScreen.tsx:163-197` — share handler awaits the new async URL with error handling.
- `src/screens/surftrips/SurftripInviteLanding.tsx` (new) — web landing component with preview + App Store / Play Store buttons.
- `src/components/AppContent.tsx`:
  - Added imports for `Linking`, `AsyncStorage`, `acceptSurftripInvite`, `SurftripInviteLanding`
  - Replaced lines 95-125 with: `parseInviteFromUrl` callback, web URL parser (with cleanup via `history.replaceState`), native `Linking.getInitialURL` + `addEventListener('url', ...)` (cleanup with `sub.remove()`), AsyncStorage hydration on mount, persistence-while-pending effect, post-auth resolver that calls `acceptSurftripInvite` and navigates by outcome
  - Added web landing gate at top of render (before age gate) — if `Platform.OS === 'web' && (token || groupId)`, render `<SurftripInviteLanding>` instead of normal app
  - State keys: `pendingInviteGroupId`, `pendingInviteToken`, `inviteResolverRef`, AsyncStorage key `pendingSurftripInvite`

### Native config (full rebuild required, NOT OTA-eligible)

- `app.json`:
  - `ios.associatedDomains: ["applinks:www.swellyo.com"]`
  - `android.intentFilters: [{ VIEW, autoVerify: true, data: scheme=https host=www.swellyo.com pathPrefix=/, BROWSABLE+DEFAULT }]`
- `public/.well-known/apple-app-site-association` (no extension, **placeholder** Team ID)
- `public/.well-known/assetlinks.json` (**placeholder** SHA-256 fingerprints)
- `create-netlify-redirects.js` — copies `public/.well-known/` → `dist/.well-known/` after expo export
- `netlify.toml` — `[[headers]]` blocks for `application/json` content-type on both files

## TS check

0 new errors over the 53 existing src/ baseline. None in any surftrip file.

---

## Before shipping (BLOCKERS)

1. **Apple Team ID** — replace `REPLACE_WITH_APPLE_TEAM_ID` in `public/.well-known/apple-app-site-association`. Get from Apple Developer portal → Membership.
2. **Android SHA-256** — replace both `REPLACE_WITH_..._SHA256` in `public/.well-known/assetlinks.json`. Run `eas credentials -p android` to view prod release + Play Store upload key fingerprints.
3. **App Store URL** — `SurftripInviteLanding.tsx:24` `APP_STORE_URL` is a placeholder. Replace once Swellyo is live in App Store with the numeric ID. Play Store URL is already correct.
4. **Supabase webhook** — Dashboard → Database → Webhooks → create webhook on `INSERT INTO public.surftrip_join_requests` → POST to the deployed edge function `send-surftrip-request-notification`. Without this, member-shared link requests are silent (admins won't be notified).
5. **PRE_BUILD_CHECKLIST.md** — walk through before `eas build` / `eas submit`. Native config changed (associatedDomains, intentFilters) so this must be a full native rebuild.

## After shipping (verification)

1. iOS device with app installed: tap link from Notes/Messages (NOT Safari on swellyo.com — Apple suppresses universal links from same-domain Safari) → app opens, accepts invite based on outcome
2. iOS without app → App Store
3. Android with app: `adb shell pm get-app-links com.swellyo.app` should show verified=true
4. Android without app → Play Store
5. Web → "Get the app" landing renders with preview if token, generic copy if not
6. Concurrent last-seat clicks → exactly one `joined`, other `group_full`
7. Logged out → click link → signup → after step 6 the pending invite resolves
8. AASA cache: after deploy, force-refresh via `xcrun simctl openurl booted "https://app-site-association.cdn-apple.com/a/v1/www.swellyo.com"` and reinstall app on devices

## Files touched

```
NEW:
  supabase/migrations/20260508000000_surftrip_invite_links.sql
  supabase/functions/send-surftrip-request-notification/index.ts
  src/screens/surftrips/SurftripInviteLanding.tsx
  public/.well-known/apple-app-site-association   (placeholder)
  public/.well-known/assetlinks.json              (placeholder)

MODIFIED:
  src/services/surftrips/surftripsService.ts      (async invite URL + accept/preview)
  src/screens/surftrips/SurftripDetailScreen.tsx  (await async URL)
  src/components/AppContent.tsx                   (Linking + persistence + resolver + web gate)
  app.json                                        (associatedDomains + intentFilters)
  netlify.toml                                    (Content-Type headers)
  create-netlify-redirects.js                     (copy .well-known to dist)
```

## Decisions captured (so they don't get re-litigated)

- Token-based, not userId-in-URL (admins' user_ids visible to members → forgeable)
- One stable token per (group, sharer), reusable
- Hybrid role check: frozen `created_role` (audit) + current sharer role at click (safety). Rationale: prevents demoted admins from grandfathering in, while keeping link semantics predictable.
- Web is store-fallback only — no web auto-join
- `pg_advisory_xact_lock` on group_id for max_members race
- Tokenless legacy URLs (`?surftrip=<id>` without `&t=`) on native: open detail screen (no auto-join). On web: same landing in view-only mode.
- Out of scope: token rotation on revoke (would need separate token column from row id), in-app preview-then-accept landing, mute notifications toggle (separate feature)
