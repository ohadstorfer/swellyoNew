/**
 * Emoji-only detection for WhatsApp-style "jumbo emoji" messages: a text message
 * whose body is ONLY emoji (no letters, digits, or other text) and at most
 * JUMBO_MAX_EMOJI of them renders large with no bubble.
 *
 * Hermes (RN 0.81) has NO `Intl.Segmenter`, and `\p{Emoji}` wrongly matches the
 * digits 0-9, * and #. So we match emoji "clusters" with a regex that relies on
 * the well-supported `\p{Extended_Pictographic}` property plus explicit code-
 * point ranges for skin-tone modifiers, flags (regional indicators) and ZWJ
 * joins — so 👨‍👩‍👧, 🤙🏼 and 🇺🇸 each count as ONE emoji. The whole thing is
 * built inside a try/catch: if a runtime lacks any of these escapes, jumbo
 * simply never triggers (messages render as normal bubbles) instead of crashing.
 */

export const JUMBO_MAX_EMOJI = 3;

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
