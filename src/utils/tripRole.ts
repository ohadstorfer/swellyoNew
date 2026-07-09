// Single source of truth for "is this user a host of this trip".
// Any host (not only the creator) returns true. The host_id branch keeps the
// primary host resolving during the placeholder window, before participants load.
export function isTripHost(
  trip: { host_id: string } | null | undefined,
  participants: { user_id: string; role: 'host' | 'member' }[],
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (trip?.host_id === userId) return true;
  return participants.some(p => p.user_id === userId && p.role === 'host');
}
