import { withTimeout, TimeoutError, mediaUploadTimeoutMs } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejects with the original error when the promise rejects in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the promise hangs past the deadline', async () => {
    const hang = new Promise(() => {}); // never settles
    const p = withTimeout(hang, 5000, 'send');
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    jest.advanceTimersByTime(5000);
    await assertion;
  });
});

describe('mediaUploadTimeoutMs', () => {
  it('returns the 2-minute floor for tiny/unknown files', () => {
    expect(mediaUploadTimeoutMs(0)).toBe(120_000);
    expect(mediaUploadTimeoutMs(500_000)).toBe(125_000); // 0.5MB -> +5s
  });

  it('scales ~1s per 100KB (assumes 100 KB/s worst-case uplink)', () => {
    expect(mediaUploadTimeoutMs(10_000_000)).toBe(220_000); // 10MB -> 120s + 100s
  });

  it('caps at 10 minutes', () => {
    expect(mediaUploadTimeoutMs(250 * 1024 * 1024)).toBe(600_000);
  });
});
