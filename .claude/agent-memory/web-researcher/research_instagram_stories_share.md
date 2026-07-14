---
name: research_instagram_stories_share
description: Sharing an image to Instagram Stories from a third-party RN/Expo app in 2025-2026 — mechanism, link sticker verdict, library choice, specs
metadata:
  type: reference
---

Researched 2026-07-13.

## Mechanism (unchanged since ~2019, still current in 2026)
- **iOS**: write image(s) + metadata to the shared UIPasteboard under Instagram's reserved keys, then open the `instagram-stories://share` URL scheme. Instagram reads the pasteboard, not URL params, for the actual content.
  - `com.instagram.sharedSticker.backgroundImage` — full-screen background
  - `com.instagram.sharedSticker.stickerImage` — floating sticker over user's own background/camera
  - `com.instagram.sharedSticker.backgroundTopColor` / `backgroundBottomColor` — gradient if no image
  - Pasteboard items expire ~5 minutes after being set.
  - Requires `LSApplicationQueriesSchemes` entry for `instagram-stories` (and usually `instagram`) in Info.plist to allow `canOpenURL` / opening the scheme.
- **Android**: `Intent(ACTION_SEND)` with action `com.instagram.share.ADD_TO_STORY`, package `com.instagram.android`.
  - Extras: `source_application` (Facebook/Meta App ID string), `interactive_asset_uri` (content:// URI, sticker), `background_asset_uri` in some variants, `top_background_color` / `bottom_background_color` hex strings.
  - Needs a `<queries>` manifest entry for `com.instagram.android` (Android 11+ package visibility) — Expo config plugin or manual AndroidManifest edit.
- **App ID requirement**: Since **January 2023**, Meta requires a Facebook/Meta App ID passed as `source_application` (Android) / in the iOS pasteboard payload, or Instagram silently rejects/ignores the share. Creating the App ID just means registering an app in the Meta developer dashboard — **no App Review / permission submission is needed** for this specific flow, since it's a client-side pasteboard + URL scheme handoff, not a Graph API call. Any registered App ID works immediately.

## Link sticker — DEFINITIVE VERDICT: NOT POSSIBLE for third-party apps in 2026
There is **no supported way** for a third-party app to programmatically attach a tappable link sticker to a story it shares via the pasteboard/intent mechanism.
- The old `contentURL`/`attributionURL` pasteboard key (`com.instagram.sharedSticker.contentURL`) exists in some libraries' code (including react-native-share) but multiple independent developer reports (GitHub issues on react-native-share, StackOverflow/Medium writeups) confirm: it may make the sticker *appear* clickable while still in the "compose" screen inside Instagram, but **the link does nothing once the story is actually published** — Meta silently drops it. This is not officially documented by Meta at all (current official docs at developers.facebook.com/docs/instagram-platform/sharing-to-stories/ make zero mention of contentURL/attributionURL or any link parameter).
- This is separate from (and should not be confused with) the **Graph API** for Business accounts publishing Stories programmatically — that API also does not support publishing stickers (link/poll/location) per Meta's own IG Graph API docs. Same end conclusion via a different mechanism.
- **The only way a link ends up on the story is the user manually adding a Link Sticker inside Instagram and pasting a URL.** Apps cannot pre-fill the Link Sticker's URL field for the user.

### How real apps (Spotify, Strava) actually do it
1. Share a background/sticker image via the pasteboard mechanism (their branded card/activity image).
2. Simultaneously **copy their deep link/URL to the clipboard** before or during the handoff (note: this can conflict with the pasteboard write used for the image itself — some devs report the story-image pasteboard write clobbers a separately-copied URL, so ordering/timing matters, or use `Clipboard.setString` right before opening the URL scheme, giving the user a brief window).
3. Instagram opens directly into the "add to your story" compose screen with their image already placed.
4. **User manually taps the sticker icon → Link sticker → pastes** the URL (which is sitting in their clipboard from step 2) → publishes.
5. This is a manual, user-driven step every time — there is no automation around it. Strava's own help docs describe this exact flow (tap sticker icon, select Link, paste the auto-copied Strava URL).

So: **"share image to story with a tappable link back to my app" is possible only as a two-step UX (auto-share image + user manually pastes a pre-copied link into their own Link sticker), never as a single automated action.** Any implementation claiming otherwise (old blog posts, old library issues referencing "swipe-up" attribution) is stale — the swipe-up-for-10k-followers feature was replaced by the universal Link Sticker years ago, and it was never scriptable by third parties either way.

## React Native library
- **react-native-share** (`Share.shareSingle` with `social: Social.InstagramStories`) is still the standard/best-maintained option in 2026. Actively published, documents Expo config (via `npx expo install react-native-share` + a config plugin block in `app.config.ts`/`app.json` for `LSApplicationQueriesSchemes` and Android package `queries`), and documents New Architecture compatibility in its README.
- Works with prebuild (bare/dev-client) — **not usable in Expo Go**, since it's a native module. Needs a dev build, consistent with the rest of Swellyo's native-module pattern (see project's `isExpoGo` guard convention).
- Alternative smaller/newer packages exist (e.g. `Expo-Instagram-Stories` on GitHub) but are far less maintained/battle-tested than react-native-share; not recommended over it.
- Hand-rolling with `expo-linking` + a small native module is unnecessary unless react-native-share's Instagram Stories support breaks — it hasn't; this is one of the more stable corners of the library.

## Image specs
- **Background image**: minimum 720×1280, recommended 1080×1920 (9:16). 9:18 also accepted for taller devices.
- **Sticker image**: recommended ~640×480, placed floating over whatever background the user already has (camera roll photo, live camera, etc.) — behaves very differently from backgroundImage, which fills the whole screen and leaves no room for the user's own content.
- **Video**: up to 1080p, max ~20s, recommend under 50MB.
- Default gradient background color if none supplied: `#222222`.
- For a card-style share (e.g. a trip/profile card design), backgroundImage is almost always the right choice over stickerImage — stickerImage is for "floats over your camera" use cases (like Spotify's now-playing card).

## Watch out for
- Old tutorials/blog posts (2019-2022 era) casually mention `contentURL` as if it works — it does not result in a live tappable link post-publish. Don't trust anything not corroborated by a 2024+ source.
- Clipboard write ordering: if you copy your deep link to the clipboard, do it in a way that doesn't get immediately overwritten by the pasteboard image-sharing call, or the user will paste garbage into the Link sticker.
- This whole feature requires a native dev build (EAS), not Expo Go — same constraint as other native modules already in this project.
- No App Review needed for the sharing mechanism itself, but you still need a registered Meta App ID (free, dashboard-only step) or the share silently fails since Jan 2023.

## Sources
- https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/ (official, current spec — no contentURL/link param documented)
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ (Graph API — confirms no sticker/link publishing support)
- https://github.com/react-native-share/react-native-share/issues/1265 (attributionURL doesn't survive to published story)
- https://github.com/react-native-share/react-native-share/issues/1388 (clipboard-paste-link workaround discussion)
- https://communityhub.strava.com/what-s-new-10/how-to-share-your-strava-activity-to-instagram-stories-with-a-link-9612 (real-world example of manual link-sticker-paste flow)
- https://medium.com/@danielcrompton5/share-content-to-an-instagram-story-from-an-ios-app-d55b1e10e68a (iOS pasteboard mechanics)
- https://medium.com/@burakekmen/story-sharing-on-facebook-instagram-in-ios-apps-2df2a82ebf96 (pasteboard keys + Android intent detail)
- https://github.com/react-native-share/react-native-share (library, README covers Expo config + New Architecture)
