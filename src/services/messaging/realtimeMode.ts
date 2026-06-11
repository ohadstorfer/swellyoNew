export type RealtimeMode = 'legacy' | 'shadow' | 'broadcast';

/**
 * Default is 'broadcast' (2026-06-11): the legacy batched in.(...) list
 * subscription silently fails to register server-side for accounts with many
 * conversations (client gets SUBSCRIBED, realtime.subscription has no rows,
 * list never live-updates). Broadcast (user-inbox topic, DB trigger live on
 * prod since Phase 0) is immune and was verified on the worst-case account.
 * The env var remains as an escape hatch to force 'legacy' or 'shadow'.
 */
export function getRealtimeMode(): RealtimeMode {
  const v = process.env.EXPO_PUBLIC_MESSAGING_REALTIME;
  return v === 'shadow' || v === 'legacy' ? v : 'broadcast';
}

export const conversationTopic = (conversationId: string) => `messages:${conversationId}`;
export const userInboxTopic = (userId: string) => `user-inbox:${userId}`;
export const reactionsTopic = (conversationId: string) => `reactions:${conversationId}`;
