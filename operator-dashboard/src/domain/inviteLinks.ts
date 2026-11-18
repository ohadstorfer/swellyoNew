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

/**
 * Group trip — tokenless. Opens the trip in the app, where the recipient taps
 * "Request to join". Byte-for-byte the app's `groupTripInviteUrl`, which is
 * what `getGroupTripInviteUrl` returns.
 */
export function groupTripInviteUrl(tripId: string): string {
  return `${INVITE_LINK_BASE}/?grouptrip=${encodeURIComponent(tripId)}`;
}

/**
 * The text the app's "Share Trip" sends — `handleShare` in TripDetailScreen.
 * The URL sits inside the message so it survives apps that drop the separate
 * `url` field (WhatsApp).
 */
export function tripShareMessage(title: string | null | undefined, url: string): string {
  const name = title?.trim() || 'my surf trip';
  return `Yo! check out my trip "${name}" on Swellyo! 🌊\n${url}`;
}
