import {
  supabaseFetchWithTimeout,
  timeoutForUrl,
  DEFAULT_TIMEOUT_MS,
  STORAGE_TIMEOUT_MS,
  __resetReportThrottleForTests,
} from '../supabaseFetchWithTimeout';

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import * as Sentry from '@sentry/react-native';

// A fetch that never answers, but rejects if aborted (like RN's real fetch).
const hangingFetch = jest.fn((_input: any, init?: any) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new Error('Aborted')),
    );
  }),
);

describe('supabaseFetchWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).fetch = hangingFetch;
    hangingFetch.mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
    __resetReportThrottleForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('picks 25s for normal urls and 300s for storage urls', () => {
    expect(timeoutForUrl('https://x.supabase.co/rest/v1/surfers')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/auth/v1/user')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/storage/v1/object/videos/a.mp4')).toBe(STORAGE_TIMEOUT_MS);
  });

  it('rejects a hung request after the default timeout', async () => {
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers?select=*');
    const check = expect(p).rejects.toThrow(/timed out/i);
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await check;
  });

  it('does NOT kill a storage request at 25s', async () => {
    let settled = false;
    const p = supabaseFetchWithTimeout('https://x.supabase.co/storage/v1/object/videos/a.mp4');
    p.then(() => { settled = true; }, () => { settled = true; });
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await Promise.resolve(); // flush microtasks
    expect(settled).toBe(false);
    jest.advanceTimersByTime(STORAGE_TIMEOUT_MS); // let it finish so jest is clean
    await expect(p).rejects.toThrow(/timed out/i);
  });

  it('passes through a normal response untouched', async () => {
    const okResponse = { ok: true } as Response;
    (global as any).fetch = jest.fn(async () => okResponse);
    await expect(
      supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers'),
    ).resolves.toBe(okResponse);
  });

  it('reports a timeout to Sentry without the query string', async () => {
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers?apikey=SECRET');
    const check = expect(p).rejects.toThrow();
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await check;
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const msg = (Sentry.captureMessage as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('/rest/v1/surfers');
    expect(msg).not.toContain('SECRET');
  });

  it('throttles Sentry reports to one per minute', async () => {
    for (let i = 0; i < 3; i++) {
      const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers');
      const check = expect(p).rejects.toThrow();
      jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
      await check;
    }
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('respects an abort signal the caller passed in', async () => {
    const controller = new AbortController();
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers', {
      signal: controller.signal,
    });
    const check = expect(p).rejects.toThrow(/aborted/i);
    controller.abort();
    await check;
    // Caller aborts are normal (user navigated away) — never reported.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
