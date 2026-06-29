---
name: supabase-image-transform-billing
description: Supabase Storage Image Transformations billing model (Pro plan, what counts, CDN cache vs meter, overage price) and replacement patterns for avoiding the quota entirely
metadata:
  type: reference
---

## Billing Model — Official Answer (Supabase Docs)

**What is counted:** Distinct (unique) ORIGIN IMAGES transformed during the billing period — NOT transformation requests. Source: [Manage Storage Image Transformations usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)

> "You are charged for the number of distinct images transformed during the billing period, regardless of how many transformations each image undergoes."

- Transforming user1.jpg at 100x100, 200x200, and 400x400 = **1 origin image**, not 3.
- Count resets at the start of each billing cycle.
- Pro plan includes 100 origin images/month at no additional charge.
- Overage: **$5 per 1,000 origin images** beyond quota.
- The "20 transformations per image" fair-use cap mentioned in some third-party sources is NOT in official docs as of June 2026.

**CDN cache and the meter:** CDN cache hits do NOT increment the meter. The meter counts origin images on first transform. Serving cached transformed URLs is free. Smart CDN (Pro plan, auto-enabled) caches aggressively and invalidates within ~60s on file overwrite. Recommendation in docs: leverage Smart CDN to reduce repeat transforms.

**Implication for Swellyo:** With avatars + trip hero photos growing unbounded with user count, the quota fills permanently, not cyclically — every new user = +1 origin image forever (as long as the same user's avatar gets transformed at least once per billing period). At $5/1,000 this is cheap in absolute terms (~$5 per 1,000 users) but it never stops growing.

## Replacement Options

### (a) Pre-generate thumbnails at upload time — RECOMMENDED
- Use expo-image-manipulator (already in project per [[profile-image-upload]]) to resize before upload.
- Upload both full + thumb as separate static objects: `avatars/userId/original.jpg` + `avatars/userId/thumb_200.jpg`.
- Serve thumb via plain `getPublicUrl()` — no /render/image/ endpoint, no quota.
- **Pro:** Zero ongoing cost, infinite scale, works in Expo Go, works on web.
- **Con:** Upload takes slightly longer (2 sequential uploads); storage doubles but cheap ($0.021/GB/mo).
- Edge Function variant: receive the upload, resize server-side with sharp/wasm, store both. More complex, no meaningful advantage over client-side for mobile.

### (b) Serve full-size and let expo-image downsample on-device
- Just use `getPublicUrl()` on the original, no transform.
- expo-image will downsample at render time; it does NOT write a smaller image back to cache — it decodes and downsamples every session from disk cache.
- **Pro:** Zero complexity.
- **Con:** Full-size avatars (2-4MB each) downloaded by every viewer on every device. On a feed with 20 avatars = 40-80MB per load. Egress cost ($0.09/GB after 250GB) and load time make this unacceptable at scale.

### (c) External image proxy (wsrv.nl, Cloudflare Images, Cloudinary)

**wsrv.nl (images.weserv.nl):**
- Free, no API key, no attribution required. BSD 3-Clause.
- Commercial use in products is explicitly permitted ("using the free service in your products is permitted, but support is best-effort").
- Rate limit: 2,500 images per 10 minutes per IP. After that, IP blocked for 1 hour. This is the *uncached* request rate — cached hits presumably don't count.
- Known reliability issue: Cloudflare throttled image traffic on free-tier accounts at weserv.nl domain in 2022 (issue #360, closed). The wsrv.nl domain was not affected.
- Serving 6M images/hour and 400TB/month outbound — widely used.
- **Privacy concern:** Supabase public bucket URLs are passed to wsrv.nl as a query param. Those URLs are public anyway (they're public bucket objects), so no additional privacy exposure — but a third-party does proxy all your images.
- **Verdict for Swellyo:** Viable short-term (free, simple, no signup), but best-effort support + Cloudflare throttle history makes it a reliability risk for a production consumer app. Acceptable for prototype/launch; not for long-term at scale.

**Cloudflare Images (paid):**
- Free tier: 5,000 unique transformations/month free.
- Paid: first 5,000 included, then $0.50/1,000 unique transformations/month. Plus storage ($5/100k stored images) and delivery ($1/100k delivered).
- Remote-URL (Transform) path: you DON'T store images in Cloudflare — it fetches from Supabase public URL on first request, caches edge. $0.50/1,000 unique transforms (after 5k free).
- **Fit:** Excellent CDN, no-egress model, simpler than self-hosting. But requires Cloudflare account, paid plan, and a $5/month minimum spend zone. More ops overhead than option (a) for modest scale.
- **Verdict:** Good at scale (>10k MAU), overkill now.

**Cloudinary free tier:**
- 25 credits/month free = 25,000 transformations OR 25GB storage OR 25GB bandwidth (combined).
- Auto-suspends on overage (not charged, just blocked).
- Vendor lock-in risk: transformation URLs are tied to Cloudinary's CDN.
- **Verdict:** Fine for prototyping, but suspension on overage is dangerous for production. Moving off later is painful (all URLs change).

### (d) Self-hosted Cloudflare Worker with Image Resizing
- Cloudflare Workers Image Resizing: available on Paid (Pro $20/mo+) Cloudflare zone plans, not free.
- Add a Worker route that fetches from Supabase public URL, resizes via Cloudflare's native resize API, returns cached image.
- **Pro:** Full control, cached, no vendor lock-in for image storage (images stay in Supabase).
- **Con:** Requires a Cloudflare paid zone ($20/mo+), Worker invocation costs, complexity.
- **Verdict:** Overcomplicated vs option (a) for Swellyo's current scale.

## Decision Table

| Option | Cost | Scale | Complexity | RN/Web | Verdict |
|---|---|---|---|---|---|
| (a) Client-side thumb at upload | Storage only (~$0) | Infinite | Low | Full | RECOMMENDED |
| (b) Full-size + on-device downsample | Egress at scale | Poor | Zero | Full | No |
| (c) wsrv.nl | Free | Good (best-effort) | Zero | Full | Launch fallback |
| (c) Cloudflare Images | $0.50/1k+storage | Excellent | Medium | Full | Scale path |
| (c) Cloudinary | Free/suspend risk | Limited | Low | Full | No |
| (d) CF Worker | $20+/mo | Excellent | High | Full | Overkill |

## Recommendation for Swellyo

Option (a): generate a `thumb_200.jpg` (or whatever size your UI needs) client-side with expo-image-manipulator at upload time, store it as a separate static object, serve via plain `getPublicUrl()`. This is free, scales infinitely, and Swellyo already has expo-image-manipulator wired in. Stop using /render/image/ entirely.

If immediate implementation of (a) is blocked, wsrv.nl works now with zero setup — just swap `/render/image/...?width=200` for `https://wsrv.nl/?url=<supabase-public-url>&w=200&q=75`.

## Related memories
- [[supabase-image-caching]] — cache-control headers, Smart CDN, expo-image cachePolicy, ?t=updated_at pattern
- [[profile-image-upload]] — expo-image-manipulator settings, 1024px/q0.75 JPEG
