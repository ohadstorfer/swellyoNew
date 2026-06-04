import type { Check, CheckResult, HealthReport } from "./types.ts";

// NOTE: when the timeout wins, the underlying promise is NOT cancelled — it continues
// running until the isolate tears down. Threading an AbortSignal is deferred to Phase 2
// if long-lived checks need it.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

export async function runCheck(check: Check, timeoutMs: number): Promise<CheckResult> {
  const start = Date.now();
  try {
    await withTimeout(check.run(), timeoutMs);
    return { name: check.name, ok: true, ms: Date.now() - start, critical: check.critical };
  } catch (e) {
    return {
      name: check.name,
      ok: false,
      ms: Date.now() - start,
      critical: check.critical,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function runChecks(checks: Check[], timeoutMs: number): Promise<CheckResult[]> {
  return Promise.all(checks.map((c) => runCheck(c, timeoutMs)));
}

export function buildReport(results: CheckResult[], ranAt: string): HealthReport {
  const ok = results.filter((r) => r.critical).every((r) => r.ok);
  return { ok, ranAt, checks: results };
}

export function httpStatusFor(report: HealthReport): number {
  return report.ok ? 200 : 503;
}
