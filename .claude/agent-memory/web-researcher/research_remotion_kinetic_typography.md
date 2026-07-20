---
name: research_remotion_kinetic_typography
description: Kinetic typography / typing-text hook video best practices for Remotion (fonts, spring configs, timing, color, effects) — built for Swellyo "Stop waiting / find your crew TODAY" reel
metadata:
  type: reference
---

Researched 2026-07-14 for a 2-line marketing hook video (Reels/TikTok, Remotion).

## Fonts
- Archivo Black (Google Fonts, weight 900 only) — punchiest "slam" feel, geometric, reads well in caps and lowercase, community favorite for TikTok/Reels bold text overlays.
- Montserrat Black/ExtraBold (700–900) — most-used font among top TikTok/Reels creators per multiple sources (mimics TikTok Sans/Proxima Nova feel), safer pick, has weight range for hierarchy if needed later.
- General rule: bold sans-serif (700+) gets ~31% better mobile readability scores than lighter weights. Avoid thin/script/decorative fonts — illegible once in motion.
- Load via `@remotion/google-fonts/ArchivoBlack` or `/Montserrat`, call `loadFont()` at module top level (never inside component render). Render engine auto-awaits font load before first frame — `waitUntilDone()` only needed outside normal render flow.

## Animation pattern
- Word-by-word spring pop-in (scale + blur-in) beats typewriter/cursor-blink for short punchy hooks — cursor typing reads as "diary/quote" style, slower, less premium for a 2-line slam hook.
- Stagger words by ~6 frames (0.2s at 30fps) using `frame - delay` offset pattern with spring() driving scale/opacity per word.
- Spring config for premium (non-cheap) feel: default Remotion spring (damping 10, mass 1, stiffness 100) is bouncier/cheaper-looking than ideal for text — bump damping to 12–15, stiffness 150–200, mass 0.5–0.8 for a snappy, controlled pop with minimal overshoot. For an "emphasis" word (like TODAY), drop damping to 8–10 for a little more bounce/overshoot — reads as exciting rather than premium-restrained.
- Blend crossfades between line 1 → line 2 (opacity overlap), never a hard cut/jump — avoids layout jump per Remotion's own text-animation guidance.

## Timing (short-form hook conventions)
- Functional attention window is 0–3s; swipe-away decisions cluster 2–3s in.
- On-screen hook text: 4–8 words max, high contrast, top/bottom safe zones.
- Fast short-form pacing ≈ 3 words/sec (180wpm) for reading captions, but a punch-in slam hook (not meant to be "read" like a caption) can compress faster since it's a visual beat, not comprehension text.
- Recommended total video length for a 2-line/6-word hook: 3.5–4.5s (105–135 frames at 30fps). Hold the final frame with the full second line ~1–1.3s (30–40 frames) for retention/legibility before any loop or cut.

## Color
- Teal/jade is a forecasted defining color family for 2026 (WGSN/Coloro) — Swellyo's brand teal is on-trend, not dated.
- Dark background + near-white text is the standard high-contrast kinetic-typography setup; on dark teal/near-black backgrounds pair with near-white (#F5F7F7) body text.
- Brand teal #0891b2 can look muddy at very dark background luminance — brighten the accent word to a more saturated cyan-teal (~#22D3EE / #06B6D4 range) for it to actually pop against near-black.

## Effects — recommended vs overdone
- Recommended: subtle grain/noise overlay (5–10% opacity, overlay/soft-light blend) — cheap way to read as "cinematic/premium." Use `@remotion/noise` or a tiled noise PNG with `mix-blend-mode: overlay`.
- Recommended: slow Ken Burns background scale drift (1.0 → ~1.03–1.05 over full duration) — adds life without distraction.
- Recommended: blur-in on text entrance (8–10px → 0 as it scales up).
- Recommended: soft glow behind the single emphasis word only (drop-shadow, low opacity, brand-teal-tinted).
- Use sparingly / only once: micro screen-shake (2–4px, 2–3 frames) on the landing frame of the emphasis word only — overdone if applied to every word.
- Skip: typewriter cursor blink (wrong vibe for a slam hook), heavy vignette, underline-swipe highlight (overused meme aesthetic), full-screen flash cuts, motion blur via `@remotion/motion-blur` (adds render cost, not needed for spring-based pop-in at this length).

## Remotion technical notes
- `@remotion/google-fonts` — `loadFont()` at module top level, pass weights array.
- `spring()` for scale/blur values, `interpolate()` for opacity/translateY with `extrapolateLeft/Right: 'clamp'`.
- Stagger technique: compute `localFrame = frame - (baseDelay + index * staggerFrames)`, feed into spring(), clamp negative frames.
- `@remotion/noise` — type-safe pure functions for procedural grain if not using a static tiled asset.

## Sources
- https://www.remotion.dev/docs/spring
- https://www.remotion.dev/docs/google-fonts
- https://www.remotion.dev/docs/animating-properties
- https://github.com/remotion-dev/skills/blob/main/skills/remotion/rules/text-animations.md
- https://www.3str.net/blog/kinetic-typography-in-web-design
- https://www.schweitzerdesigns.com/post/2026-color-typography-trends
- https://www.opus.pro/blog/instagram-reels-hook-formulas
- https://www.influencers-time.com/short-form-video-hook-design-for-reels-and-tiktok/
