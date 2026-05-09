import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import {
  aggregateReactions,
  AggregatedReaction,
  Message,
  MessageReaction,
  messagingService,
} from '../services/messaging/messagingService';

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;

/**
 * Hydrates `message.reactions` for a chat screen, subscribes to realtime
 * `message_reactions` changes, and exposes optimistic setters.
 *
 * Designed to be dropped into DirectMessageScreen / DirectGroupChat which both
 * own a local `messages: Message[]` state. Subscribes globally to the table —
 * Supabase RLS already restricts each client to reactions on messages in
 * conversations the user is a member of, so an extra filter here would be
 * redundant. We still skip events whose message_id isn't in the current chat.
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

  // Initial hydration: runs once per conversation when the message list first
  // populates. We track per-conversation so switching chats triggers a fresh
  // hydration without re-running on every message arrival.
  const hydratedConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    if (hydratedConvRef.current === conversationId) return;
    hydratedConvRef.current = conversationId;

    let cancelled = false;
    (async () => {
      const ids = messages.map(m => m.id);
      const rows = await messagingService.fetchReactionsForMessages(ids);
      if (cancelled || rows.length === 0) return;

      const byMessage = new Map<string, MessageReaction[]>();
      for (const r of rows) {
        const arr = byMessage.get(r.message_id) ?? [];
        arr.push(r);
        byMessage.set(r.message_id, arr);
      }
      setMessages(prev =>
        prev.map(m => {
          const rs = byMessage.get(m.id);
          if (!rs) return m;
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

  // Realtime subscription on message_reactions for any change relevant to the
  // current message list. Re-fetch the affected message's reactions on each
  // event — simpler and more correct than diffing payloads.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`message-reactions-${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        (payload: any) => {
          const messageId: string | undefined =
            payload?.new?.message_id ?? payload?.old?.message_id;
          if (!messageId) return;
          if (!messageIdsRef.current.has(messageId)) return;
          refreshOne(messageId).catch(err =>
            console.warn('[useMessageReactions] refreshOne failed', err),
          );
        },
      )
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
        refreshOne(messageId);
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
        refreshOne(messageId);
      }
    },
    [currentUserId, optimisticApply, refreshOne],
  );

  return { setReaction, removeReaction };
}
