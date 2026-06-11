---
name: supabase-image-caching
description: Supabase Storage cache-control headers (/object/public/ vs /render/image/), expo-image cachePolicy behavior vs HTTP headers, cache-busting with versioned query params, Smart CDN plan requirements
metadata:
  type: reference
---

## Supabase Storage Cache-Control — /object/public/ Route

- Default header when no cacheControl is set at upload time: `no-cache`
- When cacheControl is set at upload (e.g., `"3600"`), Supabase prefixes `max-age=` automatically, producing `Cache-Control: max-age=3600`
- GOTCHA: if you pass `"max-age=3600"` it creates `max-age=max-age=3600` (malformed). Pass seconds only or `"3600, immutable"` style strings.
- Confirmed bug (Oct 2024, supabase-swift #550): some client libraries incorrectly send `no-cache` on the upload request, overriding your cacheControl. Status: assigned, fix PR open but resolution not confirmed.
- Updating cacheControl on an existing file is NOT supported — you must re-upload to a new path. Discussed in supabase/discussions #11746 — still unresolved Jan 2026.
- The cacheControl upload option DOES affect the /object/public/ route when the header is correctly applied.

## Supabase Storage — /render/image/ Transform Route

- Pro Plan and above ONLY ($5/1,000 origin images after 100/month included).
- Free plan: image transformations are not available.
- Width/height: integers 1–2500; max file size 25MB; max resolution 50 megapixels.
- Transform URLs serve CDN-cached responses. Supabase auto-detects best format (WebP for Chrome, etc.).
- Cache invalidation on transform route: included in Smart CDN invalidation (up to 60 seconds after overwrite).

## Smart CDN (Pro Plan+)

- Free plan: basic CDN with 1-hour max-age header. No auto-invalidation on file overwrite.
- Pro plan+: Smart CDN enabled automatically. On file update/delete, CDN cache invalidates within ~60 seconds globally.
- Even with Smart CDN, BROWSER cache can still serve stale — Smart CDN controls edge cache, not browser cache.
- Smart CDN caches assets at the edge "for as long as possible" — browser TTL is still controlled by the cacheControl upload option.

## Cache-Busting — Versioned Query Params

- Supabase CDN (Cloudflare) DOES treat query strings as part of the cache key. A new `?v=` or `?t=` param = new cache entry = fresh fetch.
- Official Supabase recommendation: use `?cacheNonce=N` or `?version=N` incremented on file update.
- Community consensus: store `avatar_updated_at` timestamp in DB, append `?t=<avatar_updated_at>` to the public URL at render time.
- Using `Date.now()` on every render defeats caching entirely — only update the param when the image actually changes.

## expo-image — cachePolicy Behavior

- Default cachePolicy: `'disk'` — downloads and stores to disk on first request; serves from disk on subsequent renders.
- `'memory-disk'`: memory first, disk fallback. Used by this project in ProfileImage, chat screens, AvatarCacheService.
- Critical finding: expo-image disk cache does NOT respect HTTP `Cache-Control: no-cache` headers. It caches indefinitely regardless of server headers. There is no built-in TTL/expiry mechanism (feature request open, expo/expo #36940).
- Implication: if Supabase serves `no-cache` and you use `cachePolicy="disk"`, expo-image will still cache the image — good for performance, bad for freshness.
- The correct staleness solution is URL-versioning (change the URL when the image changes) not relying on HTTP headers to bust the expo-image cache.
- Web (react-native-web): `Image.prefetch()` resolves to `false` on web. expo-image falls back to a standard `<img>` tag with browser cache semantics. cachePolicy prop has no effect (shows a warning in dev). Web caching = governed by HTTP headers only.

## Recommended Pattern for Swellyo

Avatars and trip covers:
1. Upload with `cacheControl: "31536000"` (1 year) — use seconds-only string to avoid Supabase's `max-age=` prefix bug.
2. Store `avatar_updated_at` / `cover_updated_at` timestamp in the user/trip DB row.
3. Render URL as: `getPublicUrl(path).publicUrl + '?t=' + updated_at_unix_seconds`
4. On image replace: upload to SAME path (simpler), update the DB timestamp, Smart CDN handles CDN invalidation within 60s, and new URL param busts both browser and any proxy cache.
5. expo-image cachePolicy="memory-disk" is correct. The URL change is what forces a fresh fetch, not headers.
6. Do NOT use Supabase image transforms (Pro plan only, limited free quota, not needed for avatars at current scale).

## Related memories
- [[profile-image-upload]] — upload flow, compression settings, expo-image-manipulator
