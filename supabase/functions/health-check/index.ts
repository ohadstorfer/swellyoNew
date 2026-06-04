import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildReport, httpStatusFor, runChecks } from "./runner.ts";
import { buildAllChecks } from "./checks/index.ts";
import { sendDailySummary, sendFailureAlert } from "./alert.ts";
import type { DailyStats } from "./alert.ts";
import { generatePresignedUrl } from "./aws.ts";
import type { CheckResult, HealthReport } from "./types.ts";

const HEALTHCHECK_TOKEN = Deno.env.get("HEALTHCHECK_TOKEN");
const TIMEOUT_MS = 8000;

const S3_SENTINEL_KEY = "healthcheck/permanent.txt";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// Summarize the last `windowHours` of runs from health_check_log for the daily heartbeat.
async function computeDailyStats(windowHours = 24): Promise<DailyStats> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("health_check_log")
    .select("ran_at, ok, checks")
    .eq("source", "health-check")
    .gte("ran_at", since)
    .order("ran_at", { ascending: false });
  if (error) throw new Error(`daily stats query: ${error.message}`);

  const rows = data ?? [];
  const failuresByCheck: Record<string, number> = {};
  let healthyRuns = 0;
  for (const row of rows) {
    if (row.ok) healthyRuns++;
    const checks = (row.checks as CheckResult[] | null) ?? [];
    for (const c of checks) {
      if (!c.ok) failuresByCheck[c.name] = (failuresByCheck[c.name] ?? 0) + 1;
    }
  }
  return {
    windowHours,
    runs: rows.length,
    healthyRuns,
    failedRuns: rows.length - healthyRuns,
    failuresByCheck,
    latestRanAt: rows[0]?.ran_at ?? null,
    latestOk: rows[0]?.ok ?? null,
  };
}

async function persistResult(report: HealthReport, status: number): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await supabase.from("health_check_log").insert({
      ran_at: report.ranAt,
      source: "health-check",
      ok: report.ok,
      checks: report.checks,
      status,
    });
    // retention: keep ~30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("health_check_log").delete().lt("ran_at", cutoff);
  } catch (_e) {
    // best-effort: never let storage failure affect the health response
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-healthcheck-token") ?? url.searchParams.get("token");
  if (!HEALTHCHECK_TOKEN || token !== HEALTHCHECK_TOKEN) return unauthorized();

  // ── Seed action: write the S3 sentinel object (operator one-time action) ────
  // Usage: GET ?action=seed-s3-sentinel&token=<token>
  // This does NOT run the normal health checks.
  if (url.searchParams.get("action") === "seed-s3-sentinel") {
    try {
      const putUrl = await generatePresignedUrl("PUT", S3_SENTINEL_KEY, 120, "text/plain");
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "permanent",
      });
      return new Response(
        JSON.stringify({ seeded: putRes.ok, status: putRes.status }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          seeded: false,
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  }

  // ── Daily summary: heartbeat + last-24h digest email (driven by a daily cron) ─
  // Usage: GET ?action=daily-summary&token=<token>. Always sends the email.
  if (url.searchParams.get("action") === "daily-summary") {
    try {
      const stats = await computeDailyStats(24);
      await sendDailySummary(stats);
      return new Response(JSON.stringify({ sent: true, ...stats }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ sent: false, error: err instanceof Error ? err.message : String(err) }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  }

  // ── Normal health-check run ───────────────────────────────────────────────
  const results = await runChecks(buildAllChecks(), TIMEOUT_MS);
  const report = buildReport(results, new Date().toISOString());
  const status = httpStatusFor(report);

  await persistResult(report, status);
  await sendFailureAlert(report);

  return new Response(JSON.stringify(report), {
    status,
    headers: { "content-type": "application/json" },
  });
});
