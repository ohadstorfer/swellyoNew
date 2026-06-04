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

/** A single check. `run` resolves on success and THROWS on failure. */
export interface Check {
  name: CheckName;
  critical: boolean;
  run: () => Promise<void>;
}

export interface CheckResult {
  name: CheckName;
  ok: boolean;
  ms: number;
  critical: boolean;
  error?: string;
}

export interface HealthReport {
  ok: boolean; // true iff every CRITICAL check passed
  ranAt: string; // ISO timestamp
  checks: CheckResult[];
}
