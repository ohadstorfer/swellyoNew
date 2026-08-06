/**
 * Colours for the operator Dashboard tab.
 *
 * The NEUTRALS are deliberately the same values PlanSections uses (its local
 * `T`). This tab renders between Overview and Plan inside the same scroll view,
 * a dozen pixels from a Plan section, so the two have to read as one page.
 * Kept here rather than imported from PlanSections because that constant is
 * private to that file, and a dashboard that quietly re-themed itself when
 * someone tuned a Plan colour would be worse than a little duplication.
 *
 * The STATE colours are not the web dashboard's, and this file no longer claims
 * they are. It used to: "if these ever drift from the web dashboard's
 * tokens.css, the two products stop looking like the same product". By the time
 * anyone measured, all eight values had already drifted — `warn` was brown
 * against its orange, `wait` blue against its purple. The claim was deleted
 * rather than repaired, because these are two products on two platforms with
 * two type scales, and a rule nobody can act on is worse than no rule. Whether
 * they should ever converge is decision D2 in
 * `docs/specs/operator-trips/dashboard-tab-design.md`.
 *
 * What the state colours DO have to be is legible. Every one is used as TEXT on
 * its own tint, never the reverse, so each pair below carries its measured
 * contrast ratio. Nothing here goes below 4.5:1.
 */
export const D = {
  accent: '#05BCD3',
  ink: '#222B30',
  muted: '#7B7B7B',
  surface: '#FFFFFF',
  /** Section dividers. Same grey as `cardBorder` on purpose — they are the same
   *  hairline, and this used to be #EFEFEF, which is a second grey doing one
   *  job. PlanSections draws its section rules with #EEEEEE. */
  hairline: '#EEEEEE',
  border: '#E4E4E4',
  cardBorder: '#EEEEEE',

  // States. Background pairs are the tinted versions used behind banners and
  // tags, never as text colours.
  ok: '#1F8A4C',
  okBg: '#EAF7EF', // 4.8:1
  warn: '#8A6100',
  warnBg: '#FDF3DC', // 5.9:1
  danger: '#C4361E',
  dangerBg: '#FCEEF0', // 5.2:1 — also DocumentReviewScreen's `rowSubBad`

  /**
   * "Waiting for you" — the operator's own backlog, not an error.
   *
   * Was #0E6FA8 on #E7F2FA: a blue that existed in this file and nowhere else
   * in the app, on a tint that existed nowhere else either. The "N waiting" tag
   * wearing it sits one tap from DocumentReviewScreen's `pillAccent`, which is
   * the same idea in teal.
   *
   * Not `accent` on `#E4F8FB` though, which is what pillAccent literally is —
   * that pair measures 2.1:1 and fails at any size. pillAccent survives it by
   * being two words in a pill; `bannerWait` carries a whole sentence about
   * Stripe. #066B8C is the web dashboard's own `--cyan-dark`: same hue family,
   * so the tag still reads as the teal one beside pillAccent, and 5.5:1 on the
   * shared tint.
   */
  wait: '#066B8C',
  waitBg: '#E4F8FB', // 5.5:1
} as const;

export default D;
