/**
 * Regression tests for conversationReducer's list ordering, focused on the
 * "sent message bubbles to top, then reverts ~1s later" bug.
 *
 * Root cause: SYNC_FROM_SERVER (fed by the inbox broadcast that fires for the
 * SENDER too) could carry a STALE conversations.updated_at — sendMessage()'s
 * updated_at touch is fire-and-forget, so the broadcast-triggered SELECT can run
 * before it commits — while last_message is already fresh. The old code let the
 * stale server updated_at win and re-sorted by updated_at alone, dropping the
 * just-sent conversation back to its pre-send slot.
 *
 * Pure reducer, no supabase/service imports — safe to unit test directly.
 */

import {
  conversationReducer,
  conversationRecency,
  type ConversationAction,
} from '../conversationReducer';
import type { Conversation, Message } from '../../services/messaging/messagingService';

// --- fixtures -------------------------------------------------------------

const T0 = '2026-07-01T10:00:00.000Z'; // convTarget's original (old) activity
const T2 = '2026-07-01T10:02:00.000Z'; // convOther's activity
const T3 = '2026-07-01T10:03:00.000Z'; // the newly-sent message (newest)
const T5 = '2026-07-01T10:05:00.000Z'; // a genuinely-newer server update

const msg = (id: string, conversationId: string, createdAt: string): Message => ({
  id,
  conversation_id: conversationId,
  sender_id: 'me',
  attachments: [],
  is_system: false,
  edited: false,
  deleted: false,
  created_at: createdAt,
} as unknown as Message);

const conv = (id: string, updatedAt: string, lastMessage?: Message): Conversation => ({
  id,
  is_direct: true,
  metadata: {},
  created_by: 'me',
  created_at: T0,
  updated_at: updatedAt,
  last_message: lastMessage,
} as Conversation);

const ids = (state: Conversation[]) => state.map(c => c.id);

// --- tests ----------------------------------------------------------------

describe('conversationRecency', () => {
  it('folds in last_message.created_at so a stale updated_at cannot lower recency', () => {
    // updated_at is stale (T0) but the last message is fresh (T3) → recency is T3.
    const c = conv('x', T0, msg('m3', 'x', T3));
    expect(conversationRecency(c)).toBe(new Date(T3).getTime());
  });

  it('uses updated_at when there is no last_message', () => {
    expect(conversationRecency(conv('x', T2))).toBe(new Date(T2).getTime());
  });
});

describe('conversationReducer — sent-message ordering', () => {
  it('keeps a just-sent conversation on top when a STALE server sync arrives (the reported bug)', () => {
    // Target starts BELOW another conversation.
    let state: Conversation[] = [
      conv('other', T2, msg('m2', 'other', T2)),
      conv('target', T0, msg('m0', 'target', T0)),
    ];

    // User sends a message in `target` → optimistic move-to-top.
    const newMessage = msg('m3', 'target', T3);
    state = conversationReducer(state, {
      type: 'NEW_MESSAGE',
      payload: { conversationId: 'target', message: newMessage },
    } as ConversationAction);
    expect(ids(state)).toEqual(['target', 'other']);

    // ~400ms later the inbox broadcast fires (for the sender too) and syncs from
    // server. The fire-and-forget updated_at touch has NOT committed yet, so the
    // server row still carries the STALE updated_at (T0) — but last_message is
    // already the fresh one (m3 @ T3).
    const staleServerSync: Conversation[] = [
      conv('other', T2, msg('m2', 'other', T2)),
      conv('target', T0 /* STALE */, msg('m3', 'target', T3) /* fresh */),
    ];
    state = conversationReducer(state, {
      type: 'SYNC_FROM_SERVER',
      payload: { conversations: staleServerSync },
    } as ConversationAction);

    // Must NOT revert — target stays on top because recency folds in the fresh
    // last_message timestamp. (Old code sorted by updated_at alone → ['other','target'].)
    expect(ids(state)).toEqual(['target', 'other']);
    expect(conversationRecency(state[0])).toBe(new Date(T3).getTime());
  });

  it('still reorders when the server genuinely has newer activity (no over-correction)', () => {
    const state: Conversation[] = [
      conv('target', T3, msg('m3', 'target', T3)),
      conv('other', T2, msg('m2', 'other', T2)),
    ];

    // `other` legitimately received a newer message (T5) elsewhere.
    const freshServerSync: Conversation[] = [
      conv('other', T5, msg('m5', 'other', T5)),
      conv('target', T3, msg('m3', 'target', T3)),
    ];
    const next = conversationReducer(state, {
      type: 'SYNC_FROM_SERVER',
      payload: { conversations: freshServerSync },
    } as ConversationAction);

    // The guard must not freeze a stale-but-local conversation on top — genuine
    // newer server activity wins.
    expect(ids(next)).toEqual(['other', 'target']);
  });
});
