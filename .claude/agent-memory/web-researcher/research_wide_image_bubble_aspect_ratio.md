---
name: research_wide_image_bubble_aspect_ratio
description: How WhatsApp/Messenger/iMessage render extreme-aspect-ratio (very wide or very tall) images in chat bubbles — crop vs letterbox, clamp values
metadata:
  type: reference
---

Researched 2026-07-08. No official WhatsApp doc or reliably indexed reverse-engineering
source publishes exact numeric clamp constants (WhatsApp client is closed-source, decompiled
smali analyses aren't publicly indexed with these values). Findings are triangulated from
practitioner testimony + a same-family app's published CSS.

**Confirmed behavior (cross-app consensus, high confidence):**
- WhatsApp, Messenger, and iMessage all render a **center-cropped ("cover") thumbnail** in
  the bubble for extreme aspect ratios — NOT letterboxing. Direct practitioner quote (GitHub
  issue, GetStream/stream-chat-react-native#2284): "Most chat apps (Messenger, WhatsApp,
  iMessage) show only a portion of the image (like a thumbnail)." Fix used was
  `resizeMode: 'cover'`.
- iMessage specifically: users report photos/screenshots get their top/bottom clipped in
  the bubble (~20% per some reports); iOS versions crop "more aggressively toward square."
  Tap-to-expand always shows the full uncropped original — universal pattern across all
  three apps, no source disputes this.
- Very tall screenshots (e.g. ~1:2) are the most commonly complained-about case, same family
  of behavior as very wide panoramas — both extremes get clamped to a min/max bubble aspect
  ratio and then center-cropped.

**Only app with published numeric constants found: Facebook Messenger web CSS**
(ishadeed.com teardown, single-image bubble):
- `max-width: 480px`, `max-height: 200px` container.
- Effective landscape clamp ratio ≈ 2.4:1 (480/200) — beyond this, cover-crop kicks in.
- Below the max-width/max-height box, image renders at its natural ratio (no cropping) —
  cropping only activates once natural ratio exceeds the container's ratio bounds.
- This is Messenger web, not confirmed identical to WhatsApp mobile, but same "cover figure
  with max-width + max-height box" pattern is the industry-standard implementation for this
  UX and is the best hard number found.

**Telegram (open source, DrKLO/Telegram-Android on GitHub):** uses AndroidUtilities with
scale-down factor `max(widthRatio, heightRatio)` against a 1280x1280 max working size, with
minWidth/minHeight scale-up fallback. Confirms same category of algorithm (compute scale
factor against a max box, then clamp) but exact chat-bubble-specific ratio bounds weren't
extractable from indexed search (would need direct source browsing, not done here).

**Recommendation given to Ohad for RN chat bubble implementation** (no single official
source, but converged from all of the above):
- Clamp bubble aspect ratio to a landscape max (~1.91:1 to 2.4:1) and portrait min
  (~0.5:1 to 0.6:1, i.e. inverse of landscape max).
- Beyond those bounds: fix the bubble to `max-width` (mobile: ~75-78% screen width is the
  visually-observed WhatsApp norm, no hard citation) and a `min-height`/`max-height`, and use
  `resizeMode: 'cover'` (RN Image) — this center-crops correctly, matches all 3 apps.
- Within those bounds: render the image at its natural aspect ratio (no cropping) up to
  max-width, same as Messenger's approach — cropping is a fallback for extremes only, not
  the default for every image.
- Tap → full-screen viewer must always show the full, uncropped original — this is the
  universal fix for the "only a portion visible" complaint, not a UI bug to fix in the bubble.

No further re-research needed unless implementing pixel-exact WhatsApp parity — in that case,
would need to inspect an actual on-device WhatsApp panorama bubble with dev tools/screenshot
measurement rather than search, since no indexed source has the real numbers.
