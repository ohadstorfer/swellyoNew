/**
 * Emoji-only detection for WhatsApp-style large-emoji messages: a text message
 * whose body is ONLY emoji (no letters, digits, or other text) renders with an
 * enlarged font — bigger for fewer emoji — for up to BIG_EMOJI_MAX of them.
 * A SINGLE emoji additionally drops the bubble entirely (`isJumbo`); 2-3 emoji
 * stay inside a normal bubble at their enlarged size. 4+ emoji render as
 * ordinary text.
 *
 * Hermes (RN 0.81) has NO `Intl.Segmenter`, and `\p{Emoji}` wrongly matches the
 * digits 0-9, * and #. So we match emoji "clusters" with a regex that relies on
 * the well-supported `\p{Extended_Pictographic}` property plus explicit code-
 * point ranges for skin-tone modifiers, flags (regional indicators) and ZWJ
 * joins — so 👨‍👩‍👧, 🤙🏼 and 🇺🇸 each count as ONE emoji. The whole thing is
 * built inside a try/catch: if a runtime lacks any of these escapes, jumbo
 * simply never triggers (messages render as normal bubbles) instead of crashing.
 */

/** Only a single emoji goes bubble-less; 2+ emoji stay in a normal bubble. */
export const JUMBO_MAX_EMOJI = 1;

/** Emoji-only bodies up to this many emoji render at an enlarged font size. */
export const BIG_EMOJI_MAX = 3;

// Bigger for fewer emoji (WhatsApp shrinks slightly as the count grows).
const FONT_SIZE_BY_COUNT: Record<number, number> = { 1: 52, 2: 42, 3: 34 };

/**
 * Enlarged font size for an emoji-only body of `count` emoji, or null when the
 * body isn't emoji-only (count 0) or exceeds BIG_EMOJI_MAX.
 */
export function getEmojiFontSize(count: number): number | null {
  return FONT_SIZE_BY_COUNT[count] ?? null;
}

// One emoji grapheme cluster:
//   • a flag = two regional indicators, OR
//   • a base pictographic + optional skin-tone / variation-selector, then any
//     number of ZWJ-joined pictographics (family/profession sequences).
const CLUSTER =
  '(?:[\\u{1F1E6}-\\u{1F1FF}]{2}' +
  '|\\p{Extended_Pictographic}(?:[\\u{1F3FB}-\\u{1F3FF}]|\\uFE0F)?' +
  '(?:\\u200D\\p{Extended_Pictographic}(?:[\\u{1F3FB}-\\u{1F3FF}]|\\uFE0F)?)*)';

let emojiOnlyRe: RegExp | null = null;
let clusterRe: RegExp | null = null;
try {
  emojiOnlyRe = new RegExp(`^(?:${CLUSTER})+$`, 'u');
  clusterRe = new RegExp(CLUSTER, 'gu');
} catch {
  // Unsupported property escape on this engine → leave null, jumbo disabled.
  emojiOnlyRe = null;
  clusterRe = null;
}

export interface EmojiOnlyInfo {
  /** True when the trimmed body is ONLY emoji and count is within the jumbo cap. */
  isJumbo: boolean;
  /** Number of emoji graphemes (0 when not emoji-only). */
  count: number;
}

export function getEmojiOnlyInfo(text: string | null | undefined): EmojiOnlyInfo {
  if (!emojiOnlyRe || !clusterRe) return { isJumbo: false, count: 0 };
  const t = (text ?? '').trim();
  if (!t || !emojiOnlyRe.test(t)) return { isJumbo: false, count: 0 };
  const matches = t.match(clusterRe);
  const count = matches ? matches.length : 0;
  return { isJumbo: count > 0 && count <= JUMBO_MAX_EMOJI, count };
}
