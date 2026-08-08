export type CheckName =
  | "supabase_db"
  | "supabase_auth"
  | "openai"
  | "aws_s3"
  | "supabase_storage"
  | "realtime"
  | "google_geocode"
  | "expo_push"
  | "edge_functions"
  | "matching";

/** A single check. `run` resolves on success and THROWS on failure.
 *  It may resolve to a string — a diagnostic note the runner copies onto the
 *  result (storage uses it for per-op timings). */
export interface Check {
  name: CheckName;
  critical: boolean;
  run: () => Promise<void | string>;
  /** Overrides the runner's default timeout. Only set it where a check is
   *  legitimately slower than the rest — see storage.ts for the one case. */
  timeoutMs?: number;
}

export interface CheckResult {
  name: CheckName;
  ok: boolean;
  ms: number;
  critical: boolean;
  error?: string;
  /** Diagnostic detail from the check (e.g. storage per-op timings). */
  note?: string;
}

export interface HealthReport {
  ok: boolean; // true iff every CRITICAL check passed
  ranAt: string; // ISO timestamp
  checks: CheckResult[];
}
