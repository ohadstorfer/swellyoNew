/**
 * Mirror of `src/constants/inviteLinks.ts` in the app.
 *
 * The dashboard cannot import from the app's `src/` — it is excluded from the
 * Expo tsconfig and blocked in metro.config.js on purpose (see the
 * `operator-dashboard/` section of the root CLAUDE.md). So the invite host is
 * duplicated here. Change both files together.
 */
export const INVITE_LINK_BASE = 'https://swellyo-invite.netlify.app';

/** Crew/staff — single-use token. */
export function staffInviteUrl(token: string): string {
  return `${INVITE_LINK_BASE}/?staff=${encodeURIComponent(token)}`;
}
