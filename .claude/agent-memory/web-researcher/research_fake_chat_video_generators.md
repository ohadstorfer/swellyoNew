---
name: research-fake-chat-video-generators
description: Free tools to make animated iMessage/WhatsApp-style chat conversation videos (bubbles pop in, typing indicator, export MP4) — for marketing/social content, not app dev
metadata:
  type: project
---

Researched 2026-07-06 for Eyal — likely for a Swellyo marketing/social clip, not a codebase feature.

**Top 3 for fast + clean output:**
1. **TypeMagic** (typemagic.io) — purpose-built, HD export, realistic typing animation, free to try no card. Fastest for a polished single video. Newer product (2026), one-time-payment pricing after free trial ($97+), so "free" may be trial-limited — verify before relying on it for final export.
2. **Chat-Animator** (chat-animator.net — NOT chat-animator.com, that domain is now squatted/redirects to a hotel site) — 100% free, no signup, exports gif/webm/mp4 "any size," full control over animation/hold duration, start delay, canvas W/H, background color, CSS font. No watermark. Rougher UI (indie tool), less polished visuals than TextingStory/TypeMagic but zero cost and zero limits.
3. **TextingStory** (mobile app, iOS/Android, textingstory.com) — most battle-tested (2016, 20M+ users, T-Mobile Super Bowl ad referenced it), free bubble color changes + images, auto-paced video export. Best community trust/sentiment. Mobile-only, so awkward if working from desktop.

**Other notable options:**
- **CapCut** (desktop+mobile, free) — no dedicated chat tool, but community templates (search "iMessage"/"Text Message Bubble" on capcut.com/template-detail) let you drop your own text into a pre-animated bubble sequence. Good if already editing in CapCut; more manual/fiddly than dedicated generators. Free, no watermark.
- **Kapwing** — NOT worth it for this: free tier caps 720p, 1-min export, hard watermark. Fine only for a quick 720p test, not final asset.
- **Canva** — has static chat/message *templates* (canva.com/templates/s/chat, /conversation) but limited native support for one-by-one animated bubble sequences; works better as a design base than a chat-video generator. Free tier, watermark-free exports.
- **Veed.io** — general AI text-to-video, not a fake-chat specialist; free tier watermarks. Skip for this use case — FlickifyAI/ClipGOAT/Short AI are the actual chat-specialized alternatives in Veed's own space.
- **ClipGOAT** (clipgoat.com) — free tier = 60 credits, no card. Adds AI voice-over per speaker + auto message pop-in with delays, exports vertical video or screenshot sets. Paid tiers start $20/mo once credits run out.
- **FlickifyAI, Short AI** — same category as ClipGOAT (AI voiceover + chat bubbles), credit-based free tiers, not deeply reviewed but consistently mentioned alongside ClipGOAT/TypeMagic in search results.
- **Mixkit / Motion Array free AE templates** — exist (mixkit.co/free-after-effects-templates/{chat,messenger,text-message-animation-605}) but require After Effects to actually use — not a fast path unless Eyal already has AE.
- **GitHub: samkwak188/Fake-Text-Video-Generator-Demo** — open source, Flask + Selenium + FFmpeg, needs Python 3.8+, Chrome, and an ElevenLabs API key for voiceover; preset video backgrounds downloaded separately from Google Drive. Fully customizable (profile pics, names, sound effects, reorder messages) but setup overhead is the highest of any option here — only worth it if Eyal wants a repeatable scripted pipeline, not a one-off video.

**Gotcha found:** chat-animator.com (no TLD suffix difference, just .com vs .net) has expired and now redirects to an unrelated hotel booking site — make sure to use chat-animator.net if recommending this tool to anyone.

No Reddit thread with strong first-hand user sentiment on any single tool was found (search results were dominated by SEO/review-farm content, not real user reviews) — treat "real user sentiment" claims here as light, mostly from TikTok tutorial existence + tool's own longevity (TextingStory) rather than confirmed Reddit consensus.
