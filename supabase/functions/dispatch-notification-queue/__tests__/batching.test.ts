import { chunk, resolveSkips, buildExpoMessages, CAP_24H, type DrainRow } from '../batching';

describe('chunk', () => {
  it('splits 250 into [100,100,50]', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const out = chunk(arr, 100);
    expect(out.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(out.flat()).toEqual(arr);
  });
  it('exact multiple splits evenly', () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    expect(chunk(arr, 100).map((c) => c.length)).toEqual([100, 100]);
  });
  it('empty array → no chunks', () => {
    expect(chunk([], 100)).toEqual([]);
  });
  it('smaller-than-size array → single chunk', () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });
});

// Minimal row factory. text is the pre-rendered push copy the dispatcher computed.
function row(overrides: Partial<DrainRow> = {}): DrainRow {
  return {
    id: overrides.id ?? 'q1',
    recipient_id: overrides.recipient_id ?? 'u1',
    trip_id: 'trip_id' in overrides ? (overrides.trip_id as string | null) : 't1',
    type: overrides.type ?? 'join_request_received',
    priority: overrides.priority ?? 1,
    notification_id: 'notification_id' in overrides ? (overrides.notification_id as string | null) : null,
    text: overrides.text ?? { title: 'Title', body: 'Body' },
    data: overrides.data ?? {},
  };
}

function emptyMaps() {
  return {
    feedMap: new Map<string, { read_at: string | null; data: Record<string, any> }>(),
    muteMap: new Map<string, number | true>(),
    capCounts: new Map<string, number>(),
    tokenMap: new Map<string, string | null>(),
  };
}

describe('resolveSkips', () => {
  it('happy path: row with a valid token and no skip reason → toSend', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    const { toSend, skips } = resolveSkips([row()], maps);
    expect(skips).toEqual([]);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].id).toBe('q1');
    expect(toSend[0].token).toBe('ExponentPushToken[abc]');
  });

  it('SR4: already-read feed item → read_in_feed', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.feedMap.set('n1', { read_at: '2026-01-01T00:00:00Z', data: {} });
    const { toSend, skips } = resolveSkips([row({ notification_id: 'n1' })], maps);
    expect(toSend).toHaveLength(0);
    expect(skips).toEqual([{ id: 'q1', reason: 'read_in_feed' }]);
  });

  it('SR4: unread feed item still sends', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.feedMap.set('n1', { read_at: null, data: {} });
    const { toSend, skips } = resolveSkips([row({ notification_id: 'n1' })], maps);
    expect(toSend).toHaveLength(1);
    expect(skips).toEqual([]);
  });

  it('SR6: muted (future timestamp) → muted', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.muteMap.set('u1|t1', Date.now() + 3600000);
    const { toSend, skips } = resolveSkips([row()], maps);
    expect(toSend).toHaveLength(0);
    expect(skips).toEqual([{ id: 'q1', reason: 'muted' }]);
  });

  it('SR6: expired mute (past timestamp) still sends', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.muteMap.set('u1|t1', Date.now() - 3600000);
    const { toSend } = resolveSkips([row()], maps);
    expect(toSend).toHaveLength(1);
  });

  it('SR2: over cap and non-urgent → over_cap (deferred)', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.capCounts.set('u1', CAP_24H);
    const { toSend, skips } = resolveSkips([row({ priority: 1 })], maps);
    expect(toSend).toHaveLength(0);
    expect(skips).toEqual([{ id: 'q1', reason: 'over_cap' }]);
  });

  it('SR2: urgent rows (priority 0) bypass the cap', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.capCounts.set('u1', CAP_24H + 5);
    const { toSend } = resolveSkips([row({ priority: 0 })], maps);
    expect(toSend).toHaveLength(1);
  });

  it('SR2: under cap sends', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    maps.capCounts.set('u1', CAP_24H - 1);
    const { toSend } = resolveSkips([row({ priority: 1 })], maps);
    expect(toSend).toHaveLength(1);
  });

  it('no_token: missing token → no_token', () => {
    const maps = emptyMaps();
    const { toSend, skips } = resolveSkips([row()], maps);
    expect(toSend).toHaveLength(0);
    expect(skips).toEqual([{ id: 'q1', reason: 'no_token' }]);
  });

  it('invalid_token: raw hex token → invalid_token', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'abc123def');
    const { toSend, skips } = resolveSkips([row()], maps);
    expect(toSend).toHaveLength(0);
    expect(skips).toEqual([{ id: 'q1', reason: 'invalid_token' }]);
  });

  it('skip precedence matches the per-row order: feed before mute before cap before token', () => {
    const maps = emptyMaps();
    // read in feed AND muted AND over cap AND no token — read_in_feed wins (checked first).
    maps.feedMap.set('n1', { read_at: '2026-01-01T00:00:00Z', data: {} });
    maps.muteMap.set('u1|t1', Date.now() + 3600000);
    maps.capCounts.set('u1', CAP_24H);
    const { skips } = resolveSkips([row({ notification_id: 'n1' })], maps);
    expect(skips).toEqual([{ id: 'q1', reason: 'read_in_feed' }]);
  });

  it('handles a mix of rows in one pass', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('uSend', 'ExponentPushToken[ok]');
    maps.tokenMap.set('uMuted', 'ExponentPushToken[ok]');
    maps.muteMap.set('uMuted|t1', Date.now() + 60000);
    const rows: DrainRow[] = [
      row({ id: 'a', recipient_id: 'uSend' }),
      row({ id: 'b', recipient_id: 'uMuted' }),
      row({ id: 'c', recipient_id: 'uNoToken' }),
    ];
    const { toSend, skips } = resolveSkips(rows, maps);
    expect(toSend.map((r) => r.id)).toEqual(['a']);
    expect(skips).toEqual([
      { id: 'b', reason: 'muted' },
      { id: 'c', reason: 'no_token' },
    ]);
  });
});

describe('buildExpoMessages', () => {
  it('mirrors the single-send shape incl. collapseId + data', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    const { toSend } = resolveSkips(
      [
        row({
          id: 'q1',
          trip_id: 't9',
          type: 'trip_reminder',
          notification_id: 'n9',
          text: { title: 'Hi', body: 'There' },
          data: { stage: 'gear_3', decision: 'approved' },
        }),
      ],
      maps,
    );
    const msgs = buildExpoMessages(toSend);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      to: 'ExponentPushToken[abc]',
      title: 'Hi',
      body: 'There',
      sound: 'default',
      collapseId: 't9',
      data: {
        type: 'trip_reminder',
        tripId: 't9',
        notificationId: 'n9',
        stage: 'gear_3',
        decision: 'approved',
      },
    });
  });

  it('collapseId is undefined when no trip_id', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[abc]');
    const { toSend } = resolveSkips([row({ trip_id: null })], maps);
    const msgs = buildExpoMessages(toSend);
    expect(msgs[0].collapseId).toBeUndefined();
    expect(msgs[0].data.tripId).toBeNull();
  });

  it('one message per toSend row, index-aligned', () => {
    const maps = emptyMaps();
    maps.tokenMap.set('u1', 'ExponentPushToken[a]');
    maps.tokenMap.set('u2', 'ExponentPushToken[b]');
    const { toSend } = resolveSkips(
      [row({ id: 'q1', recipient_id: 'u1' }), row({ id: 'q2', recipient_id: 'u2' })],
      maps,
    );
    const msgs = buildExpoMessages(toSend);
    expect(msgs.map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  });
});
