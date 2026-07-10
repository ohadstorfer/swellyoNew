import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import {
  aggregateReactions,
  AggregatedReaction,
  Message,
  MessageReaction,
  messagingService,
} from '../services/messaging/messagingService';
import { reactionsTopic } from '../services/messaging/realtimeMode';

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;

/**
 * Hydrates `message.reactions` for a chat screen, subscribes to realtime
 * `message_reactions` changes, and exposes optimistic setters.
 *
 * Designed to be dropped into DirectMessageScreen / DirectGroupChat which both
 * own a local `messages: Message[]` state.
 *
 * Realtime reaction changes arrive on a private per-conversation Broadcast topic
 * (reactions:{conversationId}), fed by the broadcast_reaction_change DB trigger.
 * See docs/superpowers/specs/2026-06-04-reactions-broadcast-migration.md
 */
export function useMessageReactions(
  conversationId: string | undefined,
  currentUserId: string | null | undefined,
  messages: Message[],
  setMessages: SetMessages,
): {
  setReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string) => Promise<void>;
} {
  const messageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messageIdsRef.current = new Set(messages.map(m => m.id));
  }, [messages]);

  const refreshOne = useCallback(
    async (messageId: string) => {
      const rows = await messagingService.fetchReactionsForMessages([messageId]);
      const aggregated = aggregateReactions(rows, currentUserId ?? null);
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? { ...m, reactions: aggregated.length > 0 ? aggregated : undefined }
            : m,
        ),
      );
    },
    [currentUserId, setMessages],
  );

  // Reconciliation pass: runs once per conversation when the message list
  // first populates. Message fetches embed message_reactions, so reactions
  // normally arrive WITH the messages (and persist through the chat cache) —
  // but reaction changes don't bump the message row's updated_at, so a
  // cache-hit + catch-up load can show stale reactions from a previous
  // session. This refetch reconciles the loaded window: it both adds
  // reactions gained while away and clears ones removed while away.
  const hydratedConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    if (hydratedConvRef.current === conversationId) return;
    hydratedConvRef.current = conversationId;

    let cancelled = false;
    (async () => {
      const ids = messages.map(m => m.id);
      const rows = await messagingService.fetchReactionsForMessages(ids);
      if (cancelled) return;

      const byMessage = new Map<string, MessageReaction[]>();
      for (const r of rows) {
        const arr = byMessage.get(r.message_id) ?? [];
        arr.push(r);
        byMessage.set(r.message_id, arr);
      }
      const fetchedIds = new Set(ids);
      setMessages(prev =>
        prev.map(m => {
          // Only touch messages covered by this fetch — anything that arrived
          // since is fresher than this snapshot.
          if (!fetchedIds.has(m.id)) return m;
          const rs = byMessage.get(m.id);
          if (!rs) {
            return m.reactions?.length ? { ...m, reactions: undefined } : m;
          }
          return {
            ...m,
            reactions: aggregateReactions(rs, currentUserId ?? null),
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, messages.length, currentUserId, setMessages]);

  // Reset hydration marker when the conversation changes.
  useEffect(() => {
    hydratedConvRef.current = null;
  }, [conversationId]);

  // Realtime subscription for reaction changes relevant to the current message
  // list. The broadcast_reaction_change DB trigger emits `reaction_changed` on a
  // private per-conversation topic; we refetch the affected message's reactions
  // on each event (idempotent, simpler than diffing payloads).
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(reactionsTopic(conversationId), { config: { private: true } })
      .on('broadcast', { event: 'reaction_changed' }, ({ payload }: any) => {
        const messageId = payload?.message_id as string | undefined;
        if (!messageId) return;
        // Topic is per-conversation, but only a window of messages is loaded.
        if (!messageIdsRef.current.has(messageId)) return;
        refreshOne(messageId).catch(err =>
          console.warn('[useMessageReactions] refreshOne failed', err),
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, refreshOne]);

  const optimisticApply = useCallback(
    (messageId: string, nextEmoji: string | null) => {
      if (!currentUserId) return;
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== messageId) return m;
          // Strip my prior reaction (if any).
          const stripped = (m.reactions ?? [])
            .map(r => {
              if (!r.userIds.includes(currentUserId)) return r;
              return {
                ...r,
                userIds: r.userIds.filter(u => u !== currentUserId),
                count: r.count - 1,
                hasMine: false,
              };
            })
            .filter(r => r.count > 0);

          if (nextEmoji === null) {
            return {
              ...m,
              reactions: stripped.length > 0 ? stripped : undefined,
            };
          }

          const existing = stripped.find(r => r.emoji === nextEmoji);
          let merged: AggregatedReaction[];
          if (existing) {
            merged = stripped.map(r =>
              r.emoji === nextEmoji
                ? {
                    ...r,
                    userIds: [...r.userIds, currentUserId],
                    count: r.count + 1,
                    hasMine: true,
                  }
                : r,
            );
          } else {
            merged = [
              ...stripped,
              {
                emoji: nextEmoji,
                userIds: [currentUserId],
                count: 1,
                hasMine: true,
              },
            ];
          }
          merged.sort(
            (a, b) =>
              b.count - a.count || a.emoji.localeCompare(b.emoji),
          );
          return { ...m, reactions: merged };
        }),
      );
    },
    [currentUserId, setMessages],
  );

  const setReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentUserId) return;
      optimisticApply(messageId, emoji);
      try {
        await messagingService.setReaction(messageId, emoji);
      } catch (err) {
        console.error('[useMessageReactions] setReaction failed', err);
        refreshOne(messageId).catch(() => {});
      }
    },
    [currentUserId, optimisticApply, refreshOne],
  );

  const removeReaction = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      optimisticApply(messageId, null);
      try {
        await messagingService.removeReaction(messageId);
      } catch (err) {
        console.error('[useMessageReactions] removeReaction failed', err);
        refreshOne(messageId).catch(() => {});
      }
    },
    [currentUserId, optimisticApply, refreshOne],
  );

  return { setReaction, removeReaction };
}
