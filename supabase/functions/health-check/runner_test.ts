import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
// Side-effect import: must come before buildAllChecks, since aws.ts reads AWS_*
// at module-load time. Nothing here does network I/O — we only inspect the
// Check objects' config, never call run().
import "./faultcheck_env.ts";
import { buildReport, httpStatusFor, runCheck, runChecks, withTimeout } from "./runner.ts";
import { buildAllChecks } from "./checks/index.ts";
import type { Check, CheckName, CheckResult } from "./types.ts";

const passing: Check = { name: "supabase_db", critical: true, run: () => Promise.resolve() };
const failing: Check = {
  name: "openai",
  critical: false,
  run: () => Promise.reject(new Error("boom")),
};
const hanging: Check = {
  name: "aws_s3",
  critical: true,
  run: () => new Promise(() => {}),
};

Deno.test("withTimeout resolves when the promise is fast", async () => {
  const value = await withTimeout(Promise.resolve(42), 1000);
  assertEquals(value, 42);
});

Deno.test("withTimeout rejects with a timeout error when slow", async () => {
  const never = new Promise<number>(() => {});
  try {
    await withTimeout(never, 30);
    throw new Error("should not reach here");
  } catch (e) {
    assertStringIncludes((e as Error).message, "timeout");
  }
});

Deno.test("runCheck marks a passing check ok", async () => {
  const r = await runCheck(passing, 1000);
  assertEquals(r.ok, true);
  assertEquals(r.name, "supabase_db");
  assertEquals(r.critical, true);
  assertEquals(typeof r.ms, "number");
});

Deno.test("runCheck captures a thrown error", async () => {
  const r = await runCheck(failing, 1000);
  assertEquals(r.ok, false);
  assertEquals(r.error, "boom");
});

Deno.test("runCheck times out a hanging check", async () => {
  const r = await runCheck(hanging, 30);
  assertEquals(r.ok, false);
  assertStringIncludes(r.error ?? "", "timeout");
});

Deno.test("runCheck: a check's own timeoutMs overrides the default", async () => {
  // Default would fire at 10ms; the check's own 400ms leash lets it finish.
  const slowButAllowed: Check = {
    name: "supabase_storage",
    critical: false,
    timeoutMs: 400,
    run: () => new Promise((res) => setTimeout(res, 60)),
  };
  const r = await runCheck(slowButAllowed, 10);
  assertEquals(r.ok, true);
});

Deno.test("runCheck: an overridden timeout still fires when exceeded", async () => {
  const r = await runCheck({ ...hanging, timeoutMs: 30 }, 5000);
  assertEquals(r.ok, false);
  assertStringIncludes(r.error ?? "", "timeout after 30ms");
});

Deno.test("only storage and openai override the runner timeout, by the documented amounts", () => {
  const checks = buildAllChecks();
  // A check may only override when its OWN worst case exceeds the runner
  // default: storage runs six sequential bucket ops, openai allows a 5s attempt
  // plus one retry per model. Everything else keeps the default (undefined).
  // Whenever this fails, reconcile the check's internal budget against
  // TIMEOUT_MS in index.ts rather than just updating the number here — an
  // under-budgeted check reports the runner's timeout instead of the real fault.
  const expected: Partial<Record<CheckName, number>> = {
    supabase_storage: 30000,
    openai: 25000,
  };
  for (const c of checks) {
    assertEquals(c.timeoutMs, expected[c.name], `${c.name} has an unexpected timeout override`);
  }
});

Deno.test("runChecks runs all checks and returns one result each", async () => {
  const results = await runChecks([passing, failing], 1000);
  assertEquals(results.length, 2);
  assertEquals(results[0].ok, true);
  assertEquals(results[1].ok, false);
});

Deno.test("buildReport: ok only when all CRITICAL checks pass", () => {
  const criticalOk: CheckResult = { name: "supabase_db", ok: true, ms: 1, critical: true };
  const criticalFail: CheckResult = { name: "supabase_auth", ok: false, ms: 1, critical: true };
  const nonCriticalFail: CheckResult = { name: "openai", ok: false, ms: 1, critical: false };

  assertEquals(buildReport([criticalOk, nonCriticalFail], "T").ok, true);
  assertEquals(buildReport([criticalOk, criticalFail], "T").ok, false);
  assertEquals(buildReport([criticalOk], "T").ranAt, "T");
});

Deno.test("httpStatusFor maps ok->200, not ok->503", () => {
  assertEquals(httpStatusFor({ ok: true, ranAt: "T", checks: [] }), 200);
  assertEquals(httpStatusFor({ ok: false, ranAt: "T", checks: [] }), 503);
});
