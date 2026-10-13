/**
 * Every shareable invite link in the app points at one static site.
 *
 * That site (`swellyo-invite-redirect/` in this repo, deployed to Netlify)
 * hosts the Universal Links AASA and the Android App Links assetlinks file, so
 * a tap opens the installed app directly. When the app is not installed it
 * falls back to a page that forwards the query string into `swellyo://` and
 * then to the store.
 *
 * The host used to be spelled out in three separate services, plus `app.json`,
 * the iOS entitlements and the site itself. It is one constant here now so a
 * domain change is one edit on this side.
 *
 * The app's own parser for these links is `parseInviteFromUrl` in
 * `src/components/AppContent.tsx` — it reads the query off ANY url, so the
 * same params work whether they arrive over https (Universal Link) or over the
 * `swellyo://` scheme.
 *
 * The operator dashboard cannot import this file (it is excluded from the Expo
 * tsconfig and blocked in metro.config.js), so it keeps a mirror at
 * `operator-dashboard/src/domain/inviteLinks.ts`. Change both together.
 */
export const INVITE_LINK_BASE = 'https://swellyo-invite.netlify.app';

/**
 * Prefix the invite site writes to the clipboard before bouncing a user to the
 * store, so the invite survives an install (deferred deep link). The app reads
 * it once on first launch.
 *
 * MUST stay in sync with `CLIPBOARD_PREFIX` in
 * `swellyo-invite-redirect/index.html`.
 */
export const INVITE_CLIPBOARD_PREFIX = 'swellyo-invite:';

/** Group trip — tokenless. Opens the trip; the recipient taps "Request to join". */
export function groupTripInviteUrl(tripId: string): string {
  return `${INVITE_LINK_BASE}/?grouptrip=${encodeURIComponent(tripId)}`;
}

/** Surftrip — tokenized, the token is what actually joins them. */
export function surftripInviteUrl(groupId: string, token: string): string {
  return `${INVITE_LINK_BASE}/?surftrip=${encodeURIComponent(groupId)}&t=${encodeURIComponent(token)}`;
}

/** Crew/staff — single-use token. */
export function staffInviteUrl(token: string): string {
  return `${INVITE_LINK_BASE}/?staff=${encodeURIComponent(token)}`;
}
