import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CheckResult, HealthReport } from "./types.ts";

const ALERT_RECIPIENTS = [
  "ohad.storfer@gmail.com",
  "app@swellyo.com",
  "eyal@swellyo.com",
];

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return s.replace(/[&<>"']/g, (m) => map[m]);
}

// Debounce helper: returns the subset of currently-failing checks that also
// failed in the previous run (i.e. 2 consecutive failures). This prevents a
// single transient blip from alerting all recipients.
//
// Returns null if the history could not be read (caller should fall back to
// alerting on all currently-failing checks so we never go silent on a real outage).
async function qualifyingFailures(
  currentFailed: CheckResult[],
): Promise<CheckResult[] | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // row[0] = current run (just inserted by persistResult)
    // row[1] = previous run
    const { data, error } = await supabase
      .from("health_check_log")
      .select("checks")
      .order("ran_at", { ascending: false })
      .limit(2);

    if (error) {
      console.error("[health-check] debounce history query failed:", error.message);
      return null; // fall back to alerting on all
    }

    // No previous run yet — don't alert until we have 2 consecutive data points.
    if (!data || data.length < 2) return [];

    const prevChecks = data[1]?.checks as CheckResult[] | null;
    if (!Array.isArray(prevChecks)) {
      // Corrupt/missing previous row — fall back to alerting on all
      return null;
    }

    // A check qualifies for alerting only if it is also failing in the previous run.
    const prevFailedNames = new Set(
      prevChecks.filter((c) => !c.ok).map((c) => c.name),
    );
    return currentFailed.filter((c) => prevFailedNames.has(c.name));
  } catch (e) {
    console.error(
      "[health-check] debounce: unexpected error reading history:",
      e instanceof Error ? e.message : String(e),
    );
    return null; // fall back to alerting on all
  }
}

// Sends a failure-alert email via Resend when checks have failed on 2 consecutive
// runs. Best-effort: it never throws and never affects the health-check HTTP response.
export async function sendFailureAlert(report: HealthReport): Promise<void> {
  try {
    const currentFailed = report.checks.filter((c) => !c.ok);
    if (currentFailed.length === 0) return;

    // Debounce: only alert on checks that were also failing in the previous run.
    const toAlert = await qualifyingFailures(currentFailed);
    let failedToReport: CheckResult[];
    if (toAlert === null) {
      // History read failed — fall back to alerting on all currently-failing checks
      // so we never go silent on a real outage.
      console.warn("[health-check] debounce failed, falling back to full alert");
      failedToReport = currentFailed;
    } else {
      failedToReport = toAlert;
    }

    if (failedToReport.length === 0) {
      console.log("[health-check] debounce: no checks failed on 2 consecutive runs — suppressing alert");
      return;
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.error("[health-check] RESEND_API_KEY not set — cannot send alert");
      return;
    }
    const from = Deno.env.get("EMAIL_FROM") || "Swellyo <onboarding@resend.dev>";
    const passed = report.checks.length - currentFailed.length;

    const rows = failedToReport
      .map(
        (c) =>
          `<tr>` +
          `<td style="padding:6px 12px;font-weight:600;">${escapeHtml(c.name)}</td>` +
          `<td style="padding:6px 12px;color:${c.critical ? "#b00020" : "#8a6d00"};">${
            c.critical ? "CRITICAL" : "non-critical"
          }</td>` +
          `<td style="padding:6px 12px;color:#555;">${escapeHtml(c.error ?? "")}</td>` +
          `</tr>`,
      )
      .join("");

    const subject = `⚠️ Swellyo health check: ${failedToReport.length} failing${report.ok ? "" : " (CRITICAL)"}`;

    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;">` +
      `<h2 style="color:#b00020;margin:0 0 4px;">Swellyo health check failed</h2>` +
      `<p style="color:#555;margin:0 0 14px;">${passed}/${report.checks.length} checks passed · ${escapeHtml(report.ranAt)}</p>` +
      `<table style="border-collapse:collapse;width:100%;background:#fafafa;border:1px solid #eee;">` +
      `<tr style="background:#f0f0f0;">` +
      `<th style="text-align:left;padding:6px 12px;">Check</th>` +
      `<th style="text-align:left;padding:6px 12px;">Severity</th>` +
      `<th style="text-align:left;padding:6px 12px;">Error</th></tr>` +
      `${rows}</table>` +
      `</div>`;

    const text =
      `Swellyo health check failed (${report.ranAt})\n` +
      `${passed}/${report.checks.length} checks passed\n\n` +
      failedToReport
        .map((c) => `- ${c.name} [${c.critical ? "CRITICAL" : "non-critical"}]: ${c.error ?? ""}`)
        .join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: ALERT_RECIPIENTS, subject, html, text }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[health-check] Resend error ${res.status}: ${err.slice(0, 300)}`);
    } else {
      await res.body?.cancel();
    }
  } catch (e) {
    console.error("[health-check] sendFailureAlert failed:", e instanceof Error ? e.message : String(e));
  }
}

export interface DailyStats {
  windowHours: number;
  runs: number;
  healthyRuns: number;
  failedRuns: number;
  failuresByCheck: Record<string, number>;
  latestRanAt: string | null;
  latestOk: boolean | null;
}

// Daily "still alive" heartbeat + 24h summary. ALWAYS sends (it's the proof the
// function + cron are alive — its absence is the signal something died). Not
// debounced. Best-effort: never throws.
export async function sendDailySummary(stats: DailyStats): Promise<void> {
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.error("[health-check] RESEND_API_KEY not set — cannot send daily summary");
      return;
    }
    const from = Deno.env.get("EMAIL_FROM") || "Swellyo <onboarding@resend.dev>";

    const noRuns = stats.runs === 0;
    const allHealthy = !noRuns && stats.failedRuns === 0;
    const subject = noRuns
      ? "⚠️ Swellyo health check — NO runs in last 24h (cron may be down)"
      : allHealthy
      ? "✅ Swellyo health check — alive, all healthy (last 24h)"
      : `⚠️ Swellyo health check — alive, ${stats.failedRuns} run(s) had failures (last 24h)`;

    const failureRows = Object.entries(stats.failuresByCheck)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([name, count]) =>
          `<tr><td style="padding:5px 12px;font-weight:600;">${escapeHtml(name)}</td>` +
          `<td style="padding:5px 12px;color:#b00020;">${count} failed run(s)</td></tr>`,
      )
      .join("");

    const headline = noRuns
      ? `<h2 style="color:#b00020;margin:0 0 4px;">No health-check runs in the last ${stats.windowHours}h</h2>` +
        `<p style="color:#555;margin:0 0 14px;">The hourly cron may have stopped, or the function is unreachable. Investigate.</p>`
      : allHealthy
      ? `<h2 style="color:#136e4f;margin:0 0 4px;">All systems healthy ✅</h2>` +
        `<p style="color:#555;margin:0 0 14px;">The health check is alive. ${stats.runs} runs in the last ${stats.windowHours}h, all passed.</p>`
      : `<h2 style="color:#8a6d00;margin:0 0 4px;">Alive, but ${stats.failedRuns} run(s) had failures ⚠️</h2>` +
        `<p style="color:#555;margin:0 0 14px;">${stats.healthyRuns}/${stats.runs} runs healthy in the last ${stats.windowHours}h.</p>`;

    const latestLine = stats.latestRanAt
      ? `<p style="color:#777;font-size:13px;margin:10px 0 0;">Latest run: ${escapeHtml(stats.latestRanAt)} — ${stats.latestOk ? "OK" : "FAILED"}</p>`
      : "";

    const failTable = failureRows
      ? `<table style="border-collapse:collapse;width:100%;background:#fafafa;border:1px solid #eee;margin-top:8px;">` +
        `<tr style="background:#f0f0f0;"><th style="text-align:left;padding:5px 12px;">Check</th><th style="text-align:left;padding:5px 12px;">Failures (24h)</th></tr>` +
        `${failureRows}</table>`
      : "";

    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;">` +
      headline +
      failTable +
      latestLine +
      `</div>`;

    const text =
      `Swellyo health check — daily summary (last ${stats.windowHours}h)\n` +
      (noRuns
        ? `NO runs recorded — the hourly cron may have stopped. Investigate.\n`
        : `${stats.healthyRuns}/${stats.runs} runs healthy.\n` +
          (Object.keys(stats.failuresByCheck).length
            ? `Failures: ${Object.entries(stats.failuresByCheck).map(([n, c]) => `${n} (${c})`).join(", ")}\n`
            : "") +
          (stats.latestRanAt ? `Latest run: ${stats.latestRanAt} — ${stats.latestOk ? "OK" : "FAILED"}\n` : ""));

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: ALERT_RECIPIENTS, subject, html, text }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[health-check] Resend daily-summary error ${res.status}: ${err.slice(0, 300)}`);
    } else {
      await res.body?.cancel();
    }
  } catch (e) {
    console.error("[health-check] sendDailySummary failed:", e instanceof Error ? e.message : String(e));
  }
}
