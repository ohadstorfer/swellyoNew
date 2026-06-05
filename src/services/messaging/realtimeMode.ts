export type RealtimeMode = 'legacy' | 'shadow' | 'broadcast';

export function getRealtimeMode(): RealtimeMode {
  const v = process.env.EXPO_PUBLIC_MESSAGING_REALTIME;
  return v === 'shadow' || v === 'broadcast' ? v : 'legacy';
}

export const conversationTopic = (conversationId: string) => `messages:${conversationId}`;
export const userInboxTopic = (userId: string) => `user-inbox:${userId}`;
export const reactionsTopic = (conversationId: string) => `reactions:${conversationId}`;
