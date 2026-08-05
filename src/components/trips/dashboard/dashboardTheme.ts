/**
 * Colours for the operator Dashboard tab.
 *
 * Deliberately the SAME values PlanSections uses (its local `T`), plus the
 * state colours the web dashboard has and the Plan tab never needed —
 * ok / warn / danger / wait. Kept here rather than imported from PlanSections
 * because that constant is private to that file, and a dashboard that quietly
 * re-themed itself when someone tuned a Plan colour would be worse than a
 * little duplication.
 *
 * If these ever drift from the web dashboard's `tokens.css`, the two products
 * stop looking like the same product. They are meant to match.
 */
export const D = {
  accent: '#05BCD3',
  ink: '#222B30',
  muted: '#7B7B7B',
  surface: '#FFFFFF',
  hairline: '#EFEFEF',
  border: '#E4E4E4',
  cardBorder: '#EEEEEE',

  // States. Background pairs are the tinted versions used behind banners and
  // tags, never as text colours.
  ok: '#1F8A4C',
  okBg: '#EAF7EF',
  warn: '#8A6100',
  warnBg: '#FDF3DC',
  danger: '#C4361E',
  dangerBg: '#FCEEF0',
  /** "Waiting for you" — the operator's own backlog, not an error. */
  wait: '#0E6FA8',
  waitBg: '#E7F2FA',
} as const;

export default D;
