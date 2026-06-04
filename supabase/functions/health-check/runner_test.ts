import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildReport, httpStatusFor, runCheck, runChecks, withTimeout } from "./runner.ts";
import type { Check, CheckResult } from "./types.ts";

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
