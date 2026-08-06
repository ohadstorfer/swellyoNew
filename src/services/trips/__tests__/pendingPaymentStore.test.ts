// The two thresholds ARE the design (see the file header and
// docs/specs/operator-trips/payment-pending-state.md). Getting the 30-minute
// one wrong shows "Processing" over a payment that never happened; getting the
// 7-day one wrong lets a plain "Pay" button back in front of someone whose
// money may already be gone, which is the whole thing this store prevents.
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  attemptPhase,
  describeAttemptAge,
  loadPaymentAttempts,
  recordPaymentAttempt,
  clearPaymentAttempt,
  PENDING_WINDOW_MS,
  ATTEMPT_WINDOW_MS,
} from '../pendingPaymentStore';

const T0 = 1_700_000_000_000; // a fixed epoch — never Date.now() in a test
const KEY = 'swellyo:pendingPayments:trip1';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  jest.clearAllMocks();
});

describe('attemptPhase', () => {
  it('is pending inside the 30-minute window', () => {
    expect(attemptPhase(T0, T0)).toBe('pending');
    expect(attemptPhase(T0, T0 + PENDING_WINDOW_MS - 1)).toBe('pending');
  });

  // The boundary matters: at exactly 30 minutes the row stops saying
  // "Processing" and the §5 warning takes over. Off by one either way and the
  // two states overlap or leave a gap.
  it('becomes unconfirmed exactly at the 30-minute boundary', () => {
    expect(attemptPhase(T0, T0 + PENDING_WINDOW_MS)).toBe('unconfirmed');
  });

  it('stays unconfirmed for the rest of the 7 days', () => {
    expect(attemptPhase(T0, T0 + ATTEMPT_WINDOW_MS - 1)).toBe('unconfirmed');
  });

  it('is forgotten at 7 days', () => {
    expect(attemptPhase(T0, T0 + ATTEMPT_WINDOW_MS)).toBe('none');
  });

  // Clock moved backwards: timezone change, NTP correction, or a device whose
  // owner set the date by hand. Keep warning rather than silently forgetting —
  // the safe direction is always "we might still owe them a warning".
  it('treats a backwards clock as fresh, not as expired', () => {
    expect(attemptPhase(T0, T0 - 60_000)).toBe('pending');
  });
});

describe('loadPaymentAttempts', () => {
  it('returns an empty map when nothing is stored', async () => {
    await expect(loadPaymentAttempts('trip1', T0)).resolves.toEqual({});
  });

  it('reads back what was recorded', async () => {
    store[KEY] = JSON.stringify({ req1: T0 });
    await expect(loadPaymentAttempts('trip1', T0 + 1000)).resolves.toEqual({ req1: T0 });
  });

  it('prunes attempts past the 7-day window and writes the pruned map back', async () => {
    store[KEY] = JSON.stringify({ old: T0, fresh: T0 + ATTEMPT_WINDOW_MS });
    const out = await loadPaymentAttempts('trip1', T0 + ATTEMPT_WINDOW_MS + 1000);
    expect(out).toEqual({ fresh: T0 + ATTEMPT_WINDOW_MS });
    expect(JSON.parse(store[KEY])).toEqual({ fresh: T0 + ATTEMPT_WINDOW_MS });
  });

  it('removes the key entirely once every attempt has aged out', async () => {
    store[KEY] = JSON.stringify({ old: T0 });
    await expect(loadPaymentAttempts('trip1', T0 + ATTEMPT_WINDOW_MS)).resolves.toEqual({});
    expect(KEY in store).toBe(false);
  });

  // A read failure must degrade to the in-memory behaviour this store
  // replaced, never take the trip screen down with it.
  it('returns {} rather than throwing on unparseable storage', async () => {
    store[KEY] = 'not json at all';
    await expect(loadPaymentAttempts('trip1', T0)).resolves.toEqual({});
  });

  it('returns {} when AsyncStorage itself throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk on fire'));
    await expect(loadPaymentAttempts('trip1', T0)).resolves.toEqual({});
  });

  it('drops non-numeric values instead of trusting them', async () => {
    store[KEY] = JSON.stringify({ good: T0, bad: 'yesterday', worse: null });
    await expect(loadPaymentAttempts('trip1', T0)).resolves.toEqual({ good: T0 });
  });

  it('ignores a stored array', async () => {
    store[KEY] = JSON.stringify([T0]);
    await expect(loadPaymentAttempts('trip1', T0)).resolves.toEqual({});
  });
});

describe('recordPaymentAttempt / clearPaymentAttempt', () => {
  it('records and persists', async () => {
    const next = await recordPaymentAttempt('trip1', 'req1', {}, T0);
    expect(next).toEqual({ req1: T0 });
    expect(JSON.parse(store[KEY])).toEqual({ req1: T0 });
  });

  // Deposit and balance can both be mid-flight on the same trip. An earlier
  // single-id version of this state could only ever hold whichever was last.
  it('keeps two attempts on the same trip side by side', async () => {
    const one = await recordPaymentAttempt('trip1', 'deposit', {}, T0);
    const two = await recordPaymentAttempt('trip1', 'balance', one, T0 + 5000);
    expect(two).toEqual({ deposit: T0, balance: T0 + 5000 });
  });

  it('clears one without touching the other', async () => {
    const both = await recordPaymentAttempt(
      'trip1',
      'balance',
      await recordPaymentAttempt('trip1', 'deposit', {}, T0),
      T0 + 5000,
    );
    const left = await clearPaymentAttempt('trip1', 'deposit', both);
    expect(left).toEqual({ balance: T0 + 5000 });
    expect(JSON.parse(store[KEY])).toEqual({ balance: T0 + 5000 });
  });

  it('is a no-op when clearing something that was never there', async () => {
    const same = await clearPaymentAttempt('trip1', 'nope', { req1: T0 });
    expect(same).toEqual({ req1: T0 });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not mutate the map it was given', async () => {
    const before = { req1: T0 };
    await recordPaymentAttempt('trip1', 'req2', before, T0);
    expect(before).toEqual({ req1: T0 });
  });

  it('keeps trips in separate keys', async () => {
    await recordPaymentAttempt('tripA', 'req1', {}, T0);
    await recordPaymentAttempt('tripB', 'req1', {}, T0);
    expect(Object.keys(store).sort()).toEqual([
      'swellyo:pendingPayments:tripA',
      'swellyo:pendingPayments:tripB',
    ]);
  });
});

describe('describeAttemptAge', () => {
  it('rounds to minutes under an hour', () => {
    expect(describeAttemptAge(T0, T0 + 40 * 60_000)).toBe('about 40 minutes ago');
  });

  // Never "about 0 minutes ago" — the sheet is helping someone recognise
  // "that was me", and zero reads as a bug.
  it('never says zero', () => {
    expect(describeAttemptAge(T0, T0 + 1000)).toBe('about 1 minute ago');
  });

  it('switches to hours, then days', () => {
    expect(describeAttemptAge(T0, T0 + 2 * 3600_000)).toBe('about 2 hours ago');
    expect(describeAttemptAge(T0, T0 + 3 * 24 * 3600_000)).toBe('about 3 days ago');
  });

  it('singularises', () => {
    expect(describeAttemptAge(T0, T0 + 3600_000)).toBe('about 1 hour ago');
    expect(describeAttemptAge(T0, T0 + 24 * 3600_000)).toBe('about 1 day ago');
  });
});
