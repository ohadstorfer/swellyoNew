/**
 * First-strong-character direction detection (Unicode bidi convention), with
 * one deliberate difference from the screens' getBodyTextAlign helper: neutral
 * content returns NULL instead of collapsing to 'left'. That null is the
 * signal that lets the active keyboard's direction break the tie in the chat
 * composer (spec: docs/superpowers/specs/2026-07-09-keyboard-direction-design.md).
 *
 * "Strong" here covers Hebrew/Arabic ranges (RTL) and Latin ranges (LTR) —
 * the same ranges the message-bubble helper uses. Scripts outside these
 * (Cyrillic, CJK, …) read as neutral; acceptable because typing them implies
 * an LTR keyboard, which resolves to left anyway.
 */
export type StrongDirection = 'ltr' | 'rtl';

const isStrongRtl = (code: number): boolean =>
  (code >= 0x0590 && code <= 0x05ff) || // Hebrew
  (code >= 0x0600 && code <= 0x06ff) || // Arabic
  (code >= 0x0750 && code <= 0x077f) || // Arabic Supplement
  (code >= 0x08a0 && code <= 0x08ff) || // Arabic Extended-A
  (code >= 0xfb50 && code <= 0xfdff) || // Arabic Presentation Forms-A
  (code >= 0xfe70 && code <= 0xfeff);   // Arabic Presentation Forms-B

const isStrongLtr = (code: number): boolean =>
  (code >= 0x0041 && code <= 0x005a) || // A-Z
  (code >= 0x0061 && code <= 0x007a) || // a-z
  (code >= 0x00c0 && code <= 0x00ff);   // Latin-1 letters

export function getStrongDirection(
  text: string | null | undefined
): StrongDirection | null {
  if (!text) return null;
  // for..of iterates code points (not UTF-16 units), so surrogate-pair emoji
  // never produce bogus half-codes that could land inside a strong range.
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isStrongRtl(code)) return 'rtl';
    if (isStrongLtr(code)) return 'ltr';
  }
  return null;
}
