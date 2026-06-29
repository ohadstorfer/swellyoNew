---
name: jumbo-emoji-chat
description: Jumbo emoji rendering in chat apps (WhatsApp/iMessage/Signal) — trigger count, sizing, bubble removal, Hermes-safe JS detection
metadata:
  type: reference
---

## Trigger Rule

**Max 3 emoji for jumbo treatment.** Confirmed independently:
- iMessage (iOS 10+): Apple explicitly documented max 3 emoji for large display
- Signal Desktop: issues describe "1-3 emojis exclusively" as jumbo threshold
- react-emoji-render library: "three or less emoji characters" triggers onlyEmojiClassName
- WhatsApp: not officially documented, but community consensus and behavior matches 3

At 4+ emoji = normal bubble. Boundary is hard: 3 = jumbo, 4 = standard.

**What qualifies:**
- Message body must be ONLY emoji — no letters, numbers, punctuation, spaces between emoji
- Leading/trailing whitespace is trimmed before check (most implementations strip it)
- Spaces BETWEEN emoji disqualify the message (common implementation choice)
- ZWJ sequences (👨‍👩‍👧) = 1 grapheme = counts as 1 emoji
- Skin-tone modifiers (🤙🏼) = 1 grapheme = counts as 1 emoji
- Variation selectors (U+FE0F, e.g., ☕️ vs ☕) are part of the grapheme, not separate
- Flag emoji (🇺🇸 = two Regional Indicator chars) = 1 grapheme = counts as 1 emoji

## Sizing

**Not officially published by WhatsApp.** Based on community implementations:
- Normal text: ~14-16sp
- Jumbo emoji: approximately 48-72sp (3-5x scale)
- iMessage goes to roughly 3x normal for any 1-3 emoji count
- WhatsApp appears to use a flat large size (not scaling by count) based on reverse-engineered CSS
- Common community choices: 56sp flat, or scaled (1→72, 2→64, 3→56)

## Bubble/Chrome

- Background: fully removed (transparent, no bubble color, no border, no tail)
- Padding: none or minimal
- Timestamp: floats below the emoji, right-aligned — sometimes with a tiny semi-transparent chip for readability
- Read receipts: remain visible, positioned with the timestamp
- Reactions: still attach below the same way as normal bubbles

## Hermes-Safe JS Detection

**Key facts:**
- `\p{Emoji}` regex: BAD — matches digits 0-9, *, # (false positives)
- `\p{Extended_Pictographic}` regex: Better (no digit false positives) but can't count ZWJ sequences as single units (each UTF-16 component matches separately)
- Hermes DOES support unicode property escapes per official RegExp.md docs
- `Intl.Segmenter`: NOT supported in Hermes (confirmed by unicode-segmenter README)
- Regex-only approach: cannot correctly count ZWJ families/skin tones as single emoji

**Best library: `unicode-segmenter`**
- Zero dependencies
- Explicitly built for and tested on Hermes (named in README as primary target)
- 3-8x faster than `graphemer`, 20-26x faster than `grapheme-splitter` on Hermes bytecode
- Handles ZWJ sequences, skin tones, flag emoji, variation selectors correctly
- Unicode 17.0.0, Standard Annex #29 revision 47

```typescript
import { graphemeSegments, GraphemeCategory } from 'unicode-segmenter/grapheme';

const JUMBO_MAX = 3;

export function getEmojiOnlyInfo(text: string): { isJumbo: boolean; count: number } {
  const trimmed = text.trim();
  if (!trimmed) return { isJumbo: false, count: 0 };

  let count = 0;
  for (const { _catBegin } of graphemeSegments(trimmed)) {
    // Extended_Pictographic = standard emoji, ZWJ families, skin tones
    // Regional_Indicator = flag emoji (🇺🇸 etc.) — segmenter combines the two chars into one grapheme
    const isEmoji =
      _catBegin === GraphemeCategory.Extended_Pictographic ||
      _catBegin === GraphemeCategory.Regional_Indicator;
    if (!isEmoji) return { isJumbo: false, count: 0 };
    count++;
    if (count > JUMBO_MAX) return { isJumbo: false, count };
  }

  return { isJumbo: count > 0, count };
}
```

Usage in bubble component:
```typescript
const { isJumbo, count } = getEmojiOnlyInfo(message.body);
// isJumbo = no bubble background, large font
// count can drive font size scaling (1→72, 2→64, 3→56) or flat (all→56)
```

## Sources
- https://www.redmondpie.com/send-3x-large-size-emoji-using-ios-10-messages-app-heres-how/ (iMessage 3 emoji max confirmed)
- https://github.com/signalapp/Signal-Desktop/issues/7068 (Signal 1-3 emoji jumbomoji)
- https://www.npmjs.com/package/react-emoji-render ("three or less emoji" threshold)
- https://github.com/cometkim/unicode-segmenter (Hermes-safe emoji counting)
- https://github.com/facebook/hermes/blob/main/doc/RegExp.md (Hermes does support \p{} escapes)
- https://alexwlchan.net/til/2023/use-unicode-property-escapes-to-find-emoji/ (\p{Emoji} digit false-positive warning)
