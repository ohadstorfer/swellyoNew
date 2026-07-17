export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Reject if `promise` does not settle within `ms`. Used to bound network calls
 * on the send path so a stalled request surfaces as an error (→ message marked
 * 'failed', composer unfrozen) instead of hanging forever.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// Timeout for a media upload sized to the payload. Baseline 2 min covers
// presign round-trips and slow starts; then ~1s per 100KB assumes a
// worst-case ~100 KB/s uplink; capped at 10 min (matches the 250MB max
// video sharing bandwidth with other queued items).
export function mediaUploadTimeoutMs(sizeBytes: number): number {
  const base = 120_000;
  const perByte = Math.ceil((sizeBytes || 0) / 100_000) * 1000;
  return Math.min(600_000, base + perByte);
}
