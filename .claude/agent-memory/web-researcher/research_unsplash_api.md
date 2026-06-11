---
name: unsplash-api-trip-cover-picker
description: Unsplash API legal/technical requirements for in-app photo search+select picker (trip cover use case) — license, hotlinking, download tracking, attribution, rate limits, Demo vs Production, unsplash-js RN compat, Pexels/Pixabay alternatives
metadata:
  type: reference
---

## Verdict: YES, legal and free — with mandatory constraints

A trip-cover photo picker using Unsplash API is explicitly a sanctioned use case (same as Trello board backgrounds, Ghost editor, Medium article images). Swellyo is not a wallpaper app or Unsplash clone — it has independent value. The "replicating Unsplash" prohibition does NOT apply here.

## 1. Free API / Pricing

- API is entirely free. No paid tier.
- Demo: 50 requests/hour. Production (approved): 1,000–5,000 requests/hour (official docs say 1,000; some sources say 5,000 — verify at dashboard).
- Image requests to images.unsplash.com do NOT count against the rate limit. Only API metadata calls count.

## 2. Demo vs Production

- Demo = default on signup. 50 req/hr. Good for dev/testing.
- Production = manual review required. Submit screenshots of the app (showing attribution and photo use), accurate title and description. If approved, limit jumps. Contact partnerships@unsplash.com for edge cases.
- Approval criteria: proper hotlinking + download tracking implemented, guidelines compliance shown in screenshots.

## 3. License (Unsplash License)

- Commercial use: ALLOWED. "You may use images for free, including for commercial purposes."
- Attribution NOT required by the Unsplash License itself — it's the API Guidelines that mandate attribution (because you're an API integrator).
- Prohibited by license: "Selling unaltered photos" and "compiling photos to build a competing service."
- Using as a trip cover = NOT selling unaltered photos. NOT building a competing service. Fully allowed.

## 4. The Three Hard Technical Requirements

### A) Hotlinking (MANDATORY — no exceptions for standard apps)

Official guideline verbatim: "All API uses must use the hotlinked image URLs returned by the API under the photo.urls properties."

API Terms verbatim: "you must directly use or embed the related image URLs returned by the API in your Developer Apps (generally referred to as 'hotlinking')"

- CANNOT download to own Supabase Storage and rehost.
- Must serve image directly from Unsplash CDN URLs (photo.urls.raw / .full / .regular / .small / .thumb).
- Exception 1: Remixed/derivative images (no longer original) don't need hotlinking.
- Exception 2: Companies needing own infra can contact api@unsplash.com for a "photo views beacon alternative" (tracking pixel instead of hotlinking). Not available for standard small apps.
- **Architecture implication for Swellyo:** Store only the photo ID + URL (photo.urls.regular) in Supabase. Serve from Unsplash CDN. Do not copy the image bytes.

### B) Trigger a Download (MANDATORY on selection)

Official guideline: "When your application performs something similar to a download (like when a user chooses the image to include in a blog post, set as a header, etc.), you must send a request to the download endpoint."

- Exactly when: When the user SELECTS/CONFIRMS the photo as their trip cover. Not on search browse.
- Endpoint: GET `photo.links.download_location` (each photo has a unique field, not a generic endpoint).
- This is a pure event/tracking call (increments download counter). Response is irrelevant. It does NOT give you a download URL.
- Setting as a header/cover image is explicitly listed as a triggering action in the guidelines.

### C) Attribution (MANDATORY on display)

Official guideline verbatim: "When displaying a photo from Unsplash, your application must attribute Unsplash, the Unsplash photographer, and contain a link back to their Unsplash profile. All links back to Unsplash should use utm parameters in the form of ?utm_source=your_app_name&utm_medium=referral"

Required format: "Photo by [Photographer Name] on Unsplash"
- [Photographer Name] links to: https://unsplash.com/@username?utm_source=swellyo&utm_medium=referral
- "Unsplash" links to: https://unsplash.com/?utm_source=swellyo&utm_medium=referral

Where required: "When displaying a photo" — this means both in the picker AND on the trip card/detail where the cover is shown. Attribution must persist wherever the photo is visible.

## 5. Replicating Unsplash — Risk Assessment

Official guideline verbatim: "You cannot replicate the core user experience of Unsplash (unofficial clients, wallpaper applications, etc.)."

The official guideline article clarifies:
- ALLOWED: "integrate Unsplash inside an existing app that offers more value than simply the Unsplash integration" — Ghost, Trello, Medium are cited examples.
- PROHIBITED: Apps that have "no content and no value to users" without Unsplash — wallpaper apps, unofficial clients.

Swellyo verdict: SAFE. Swellyo is a surf-trip social platform with independent value. The photo picker is one feature in a much larger product. Structurally identical to Trello's "set board background" integration.

## 6. Attribution on Stored/Displayed Trip Covers

- Attribution is required every time the photo is displayed — in the picker, on trip cards, on trip detail views.
- Store in DB: photographer_name, photographer_url (unsplash profile), unsplash_photo_url (link back to photo page), photo_id.
- Minimum compliant: small overlay or caption "Photo by [Name] on Unsplash" with the two linked UTM-tagged URLs.
- Pattern: small semi-transparent caption bar at bottom of hero image.

## 7. SDK / Auth Architecture

- Official SDK: `unsplash-js` (GitHub: unsplash/unsplash-js). v7.0.18 (last release May 2023, still maintained).
- Does it work in React Native? Expo SDK 54 has a native fetch — but unsplash-js was written for Node/browser, not explicitly RN. Community reports: works with fetch available. No known blockers in SDK 54 since fetch is natively available (no polyfill needed in newer Expo).
- Auth model: Access Key is required. 
  - SERVER-SIDE: Pass `accessKey` directly — correct.
  - CLIENT-SIDE/BROWSER: Must proxy through your own backend (unsplash-js docs: "you must proxy your requests through your server by setting baseUrl"). 
  - React Native is NOT a browser but the Access Key would be visible in the JS bundle (extractable). Unsplash's guidelines don't explicitly say RN apps must proxy, but best practice = proxy through a Supabase Edge Function.
  
- Recommended architecture for Swellyo:
  1. Create a Supabase Edge Function `unsplash-proxy` that holds the Access Key as a secret.
  2. React Native app calls Edge Function with search query.
  3. Edge Function calls Unsplash API, returns results.
  4. Download trigger: client can call download_location endpoint directly (it's a public URL, no auth needed — just a GET).

## 8. Alternatives (brief)

- **Pexels**: 200 req/hr / 20k/month. Attribution recommended but not strictly required by license. Similar "no replicating core experience" restriction. No explicit hotlinking requirement — more flexible on storage. Attribution: "Photo by [Name] on Pexels" recommended.
- **Pixabay**: 100 req/60s. Explicitly PROHIBITS permanent hotlinking — expects you to download and serve from your own server. Attribution required in search display. No paid tier. Most flexible for self-hosting.

For Swellyo (which must hotlink anyway for Unsplash): Pexels is a reasonable fallback with nearly identical content quality and slightly easier storage rules. Pixabay is best if you want to store in Supabase Storage.

## Sources

- https://unsplash.com/api-terms — API Terms of Service
- https://unsplash.com/license — Unsplash License
- https://unsplash.com/documentation — API docs (rate limits, hotlinking, download tracking)
- https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines — API Guidelines
- https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images — Hotlinking guideline
- https://help.unsplash.com/en/articles/2511315-guideline-attribution — Attribution guideline
- https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download — Download trigger guideline
- https://help.unsplash.com/en/articles/2511257-guideline-replicating-unsplash — Replicating Unsplash guideline
- https://help.unsplash.com/en/articles/3887917-when-should-i-apply-for-a-higher-rate-limit — Production approval
- https://github.com/unsplash/unsplash-js — Official JS SDK
