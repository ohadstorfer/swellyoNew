// Pure, testable decision logic for the notification-queue dispatcher.
// NO I/O, NO network, NO Deno globals — this file must be importable by Jest.
// The edge fn (index.ts) does the DB round-trips, packs the results into the maps
// below, and delegates ALL skip/send decisions + Expo message shaping to here.

export type PushText = { title: string; body: string };

/** A drained queue row, with its already-rendered push copy + feed data snapshot. */
export type DrainRow = {
  id: string;
  recipient_id: string;
  trip_id: string | null;
  type: string;
  priority: number;
  notification_id: string | null;
  /** Pre-rendered push copy (SR1 digest text for batch leaders, else renderPush). */
  text: PushText;
  /** The notifications.data snapshot (for stage/decision deep-link fields). */
  data: Record<string, any>;
};

/** A row that passed every check and is ready to send, carrying its resolved token. */
export type PreparedRow = DrainRow & { token: string };

export type SkipReason =
  | 'read_in_feed'
  | 'muted'
  | 'over_cap'
  | 'no_token'
  | 'invalid_token';

export type Skip = { id: string; reason: SkipReason };

export type ResolveMaps = {
  /** notification_id → { read_at, data }. Built from a single notifications .in() read. */
  feedMap: Map<string, { read_at: string | null; data: Record<string, any> }>;
  /** `${recipient_id}|${trip_id}` → muted_until epoch ms (or `true` = muted indefinitely). */
  muteMap: Map<string, number | true>;
  /** recipient_id → count of pushes already sent in the rolling 24h window. */
  capCounts: Map<string, number>;
  /** recipient_id → expo_push_token (null/undefined when absent). */
  tokenMap: Map<string, string | null>;
};

/** SR2: <=3 non-urgent (priority>0) pushes per recipient per rolling 24h; the rest defer. */
export const CAP_24H = 3;

const EXPO_TOKEN_PREFIX = 'ExponentPushToken[';

/** Split an array into consecutive chunks of at most `size`. e.g. 250,100 → [100,100,50]. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Apply the per-row skip rules in the EXACT order the legacy loop used:
 *   SR4 read_in_feed → SR6 muted → SR2 over_cap → no_token → invalid_token.
 * Rows that clear every check come back in `toSend` with their resolved token.
 * Note: SR1 batching (leader/follower digest collapse) is handled upstream in
 * index.ts before this is called; followers never reach here.
 */
export function resolveSkips(
  rows: DrainRow[],
  maps: ResolveMaps,
): { toSend: PreparedRow[]; skips: Skip[] } {
  const toSend: PreparedRow[] = [];
  const skips: Skip[] = [];

  for (const row of rows) {
    // SR4 dedup-vs-feed: if they already read the linked feed row, drop the push.
    if (row.notification_id) {
      const feed = maps.feedMap.get(row.notification_id);
      if (feed?.read_at) {
        skips.push({ id: row.id, reason: 'read_in_feed' });
        continue;
      }
    }

    // SR6 mute: a future muted_until silences trip pushes.
    const muteVal = row.trip_id ? maps.muteMap.get(`${row.recipient_id}|${row.trip_id}`) : undefined;
    if (muteVal === true || (typeof muteVal === 'number' && muteVal > Date.now())) {
      skips.push({ id: row.id, reason: 'muted' });
      continue;
    }

    // SR2 frequency cap: non-urgent rows over the 24h cap get deferred upstream.
    if (row.priority > 0) {
      const count = maps.capCounts.get(row.recipient_id) ?? 0;
      if (count >= CAP_24H) {
        skips.push({ id: row.id, reason: 'over_cap' });
        continue;
      }
    }

    // Token resolution + self-heal of non-Expo tokens.
    const token = maps.tokenMap.get(row.recipient_id);
    if (!token) {
      skips.push({ id: row.id, reason: 'no_token' });
      continue;
    }
    if (!token.startsWith(EXPO_TOKEN_PREFIX)) {
      skips.push({ id: row.id, reason: 'invalid_token' });
      continue;
    }

    toSend.push({ ...row, token });
  }

  return { toSend, skips };
}

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  collapseId: string | undefined;
  data: {
    type: string;
    tripId: string | null;
    notificationId: string | null;
    stage?: any;
    decision?: any;
  };
};

/**
 * Shape prepared rows into Expo push messages, mirroring the legacy single-send body.
 * SR5 collapse rides on `collapseId = trip_id`; stage/decision drive tap deep-links.
 * Index-aligned with `toSend` so tickets can be mapped back 1:1.
 */
export function buildExpoMessages(toSend: PreparedRow[]): ExpoMessage[] {
  return toSend.map((row) => ({
    to: row.token,
    title: row.text.title,
    body: row.text.body,
    sound: 'default',
    collapseId: row.trip_id || undefined,
    data: {
      type: row.type,
      tripId: row.trip_id,
      notificationId: row.notification_id,
      stage: row.data?.stage ?? undefined,
      decision: row.data?.decision ?? undefined,
    },
  }));
}
