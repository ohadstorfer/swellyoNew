# Daily Deep Health Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Supabase Edge Function `health-check` that probes every core building block (DB, Auth, OpenAI, S3, …) on demand, returns a JSON report with HTTP 200/503, and is scheduled + alerted (email + phone push) by UptimeRobot from outside Supabase.

**Architecture:** One edge function is the "brain." It runs independent check functions in parallel, each with its own timeout, and maps the result to HTTP 200 (all critical checks ok) or 503 (any critical fail). A secret token guards it. UptimeRobot pings it on a schedule and alerts on a bad response. The pure orchestration logic is unit-tested with Deno; the individual checks are integration-validated against live services via local `supabase functions serve` + curl.

**Tech Stack:** Deno (edge runtime), `@supabase/supabase-js@2` via esm.sh, AWS SigV4 (ported from existing code), Supabase CLI 2.90.0, UptimeRobot (free tier).

---

## ⚠️ Refinements from the spec (read first)

The approved spec is in `docs/superpowers/specs/2026-06-03-daily-health-check-design.md`. Two deliberate refinements were made while planning — they reduce risk, not scope:

1. **No permanent test user for daily checks.** The spec proposed a permanent `demo-healthcheck` user. Instead, the `supabase_db` check writes/reads a dedicated `health_check_log` table, and the `supabase_auth` check calls the Auth admin `listUsers` API. This removes schema-guessing on `public.users`/`surfers` and removes all side-effect risk (abandonment push, matching, analytics). The **weekly signup test (Task 14) still creates + deletes a real demo user**, which is where real creation is exercised.
2. **`openai` check calls the OpenAI API directly** (a 1-token completion) rather than invoking `swelly-chat-demo`. This isolates the actual dependency (is OpenAI up + is the key valid) without coupling to another function's request contract. An end-to-end `swelly-chat-demo` path test can be added later as a Phase 2 item if desired.

## Commit convention

Ohad commits manually. Treat every **Commit** step as a suggested checkpoint: either run it, or pause for Ohad to review the diff. Do not push.

## Deployment note

Edge functions in this repo are also deployed by copy-pasting into the Supabase dashboard (see `.claude/CLAUDE.md`). This plan uses `supabase functions deploy` where possible, but the function must also work when pasted whole — so **all code for the function lives under `supabase/functions/health-check/` and uses only URL imports + relative imports** (no repo-root shared modules).

## File structure

```
supabase/migrations/20260603000000_health_check_log.sql   # tiny log table for the db check
supabase/functions/health-check/
  types.ts            # Check, CheckResult, HealthReport types
  runner.ts           # pure orchestration: withTimeout, runCheck, runChecks, buildReport, httpStatusFor
  runner_test.ts      # Deno unit tests for runner.ts (pure, mocked checks)
  aws.ts              # AWS SigV4 presign helper, ported from process-profile-video-s3
  checks/
    db.ts             # supabase_db check
    auth.ts           # supabase_auth check
    openai.ts         # openai check
    s3.ts             # aws_s3 check
    index.ts          # buildPhase1Checks()
  index.ts            # HTTP handler: token auth, run checks, map to JSON + status
```

Phase 2 checks (`storage.ts`, `realtime.ts`, `google.ts`, `expo.ts`) are added in Tasks 11–13. The weekly signup test is Task 14. UptimeRobot config is Task 15.

---

## Task 1: Install Deno (for unit tests)

**Files:** none (tooling).

- [ ] **Step 1: Check whether Deno is already installed**

Run: `deno --version`
Expected: either a version prints (skip to Task 2) or "command not found".

- [ ] **Step 2: Install Deno if missing**

Run: `brew install deno`

- [ ] **Step 3: Verify**

Run: `deno --version`
Expected: prints `deno 1.x` (or `2.x`) and `typescript ...`.

---

## Task 2: Create the `health_check_log` table

**Files:**
- Create: `supabase/migrations/20260603000000_health_check_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Tiny table the daily health check writes to, to prove DB read+write works.
-- Not user data. RLS on with no policies => only the service role (used by the
-- edge function) can touch it.
create table if not exists public.health_check_log (
  id      bigint generated always as identity primary key,
  ran_at  timestamptz not null default now(),
  source  text        not null default 'health-check'
);

alter table public.health_check_log enable row level security;
```

- [ ] **Step 2: Apply the migration to the linked project**

Run: `supabase db push`
Expected: output lists `20260603000000_health_check_log.sql` as applied with no errors.

- [ ] **Step 3: Verify the table exists**

Run: `supabase db execute --query "select count(*) from public.health_check_log;"`
Expected: returns a count (0). If `db execute` is unavailable in this CLI version, verify in the Supabase dashboard SQL editor instead.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000000_health_check_log.sql
git commit -m "feat(health-check): add health_check_log table"
```

---

## Task 3: Define shared types

**Files:**
- Create: `supabase/functions/health-check/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type CheckName =
  | "supabase_db"
  | "supabase_auth"
  | "openai"
  | "aws_s3"
  | "supabase_storage"
  | "realtime"
  | "google_geocode"
  | "expo_push";

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
```

---

## Task 4: Runner — `withTimeout` (TDD)

**Files:**
- Create: `supabase/functions/health-check/runner.ts`
- Test: `supabase/functions/health-check/runner_test.ts`

- [ ] **Step 1: Write the failing test**

Create `runner_test.ts`:

```ts
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withTimeout } from "./runner.ts";

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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: FAIL — `Module not found` / `withTimeout is not exported` (runner.ts does not exist yet).

- [ ] **Step 3: Implement `withTimeout`**

Create `runner.ts`:

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/health-check/runner.ts supabase/functions/health-check/runner_test.ts supabase/functions/health-check/types.ts
git commit -m "feat(health-check): add withTimeout + types"
```

---

## Task 5: Runner — `runCheck` (TDD)

**Files:**
- Modify: `supabase/functions/health-check/runner.ts`
- Test: `supabase/functions/health-check/runner_test.ts`

- [ ] **Step 1: Add failing tests**

Append to `runner_test.ts`:

```ts
import { runCheck } from "./runner.ts";
import type { Check } from "./types.ts";

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
```

- [ ] **Step 2: Run, verify failure**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: FAIL — `runCheck is not exported`.

- [ ] **Step 3: Implement `runCheck`**

Append to `runner.ts`:

```ts
import type { Check, CheckResult } from "./types.ts";

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
```

- [ ] **Step 4: Run, verify pass**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/health-check/runner.ts supabase/functions/health-check/runner_test.ts
git commit -m "feat(health-check): add runCheck"
```

---

## Task 6: Runner — `runChecks`, `buildReport`, `httpStatusFor` (TDD)

**Files:**
- Modify: `supabase/functions/health-check/runner.ts`
- Test: `supabase/functions/health-check/runner_test.ts`

- [ ] **Step 1: Add failing tests**

Append to `runner_test.ts`:

```ts
import { buildReport, httpStatusFor, runChecks } from "./runner.ts";
import type { CheckResult } from "./types.ts";

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
```

- [ ] **Step 2: Run, verify failure**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: FAIL — `runChecks is not exported`.

- [ ] **Step 3: Implement the three functions**

Append to `runner.ts`:

```ts
import type { HealthReport } from "./types.ts";

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
```

- [ ] **Step 4: Run, verify pass**

Run: `deno test supabase/functions/health-check/runner_test.ts`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/health-check/runner.ts supabase/functions/health-check/runner_test.ts
git commit -m "feat(health-check): add runChecks/buildReport/httpStatusFor"
```

---

## Task 7: Port the AWS SigV4 presign helper

**Files:**
- Create: `supabase/functions/health-check/aws.ts`
- Reference: `supabase/functions/process-profile-video-s3/index.ts`

- [ ] **Step 1: Copy the existing, working SigV4 helpers**

Open `supabase/functions/process-profile-video-s3/index.ts`. Copy the helper block — the functions `hmac`, `sha256`, `toHex`, `getSignatureKey`, and `generatePresignedUrl` — verbatim into a new file `supabase/functions/health-check/aws.ts`. These read `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (default `us-east-1`), `AWS_S3_BUCKET` (default `swellyo-videos`) from `Deno.env`.

At the top of `aws.ts`, add the four env constants the helpers depend on (copy them from the source file):

```ts
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID')!
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY')!
const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1'
const AWS_S3_BUCKET = Deno.env.get('AWS_S3_BUCKET') || 'swellyo-videos'
```

- [ ] **Step 2: Export `generatePresignedUrl`**

Add the `export` keyword to the `generatePresignedUrl` function declaration so the s3 check can import it. Its signature must remain:

```ts
export async function generatePresignedUrl(
  method: 'PUT' | 'GET',
  key: string,
  expiresIn: number = 3600,
  contentType?: string,
): Promise<string>
```

- [ ] **Step 3: Type-check the file**

Run: `deno check supabase/functions/health-check/aws.ts`
Expected: no type errors (env vars resolve to `string`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/health-check/aws.ts
git commit -m "feat(health-check): port AWS SigV4 presign helper"
```

---

## Task 8: Phase 1 checks — db, auth, openai, s3

**Files:**
- Create: `supabase/functions/health-check/checks/db.ts`
- Create: `supabase/functions/health-check/checks/auth.ts`
- Create: `supabase/functions/health-check/checks/openai.ts`
- Create: `supabase/functions/health-check/checks/s3.ts`
- Create: `supabase/functions/health-check/checks/index.ts`

> These checks do real network I/O, so they are validated by integration run in Task 10 (local serve + curl), not by mocked unit tests.

- [ ] **Step 1: Write `db.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function dbCheck(): Check {
  return {
    name: "supabase_db",
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { error: insErr } = await supabase
        .from("health_check_log")
        .insert({ source: "health-check" });
      if (insErr) throw new Error(`db insert: ${insErr.message}`);

      const { data, error: selErr } = await supabase
        .from("health_check_log")
        .select("id")
        .order("ran_at", { ascending: false })
        .limit(1);
      if (selErr) throw new Error(`db select: ${selErr.message}`);
      if (!data || data.length === 0) throw new Error("db select returned no rows");

      // best-effort cleanup so the table stays tiny
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("health_check_log").delete().lt("ran_at", cutoff);
    },
  };
}
```

- [ ] **Step 2: Write `auth.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function authCheck(): Check {
  return {
    name: "supabase_auth",
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw new Error(`auth admin: ${error.message}`);
      if (!Array.isArray(data?.users)) throw new Error("auth admin returned no users array");
    },
  };
}
```

- [ ] **Step 3: Write `openai.ts`**

```ts
import type { Check } from "../types.ts";

export function openaiCheck(): Check {
  return {
    name: "openai",
    critical: true,
    run: async () => {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY not set");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`openai ${res.status}: ${body.slice(0, 200)}`);
      }
      await res.body?.cancel();
    },
  };
}
```

- [ ] **Step 4: Write `s3.ts`**

```ts
import type { Check } from "../types.ts";
import { generatePresignedUrl } from "../aws.ts";

const HEALTHCHECK_KEY = "healthcheck/ping.txt";

export function s3Check(): Check {
  return {
    name: "aws_s3",
    critical: true,
    run: async () => {
      // Overwrites the same fixed key each run => no object accumulation.
      const putUrl = await generatePresignedUrl("PUT", HEALTHCHECK_KEY, 120, "text/plain");
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "ok",
      });
      if (!putRes.ok) {
        const body = await putRes.text();
        throw new Error(`s3 put ${putRes.status}: ${body.slice(0, 200)}`);
      }

      const getUrl = await generatePresignedUrl("GET", HEALTHCHECK_KEY, 120);
      const getRes = await fetch(getUrl);
      if (!getRes.ok) throw new Error(`s3 get ${getRes.status}`);
      const text = await getRes.text();
      if (text !== "ok") throw new Error(`s3 get body mismatch: ${text.slice(0, 50)}`);
    },
  };
}
```

- [ ] **Step 5: Write `checks/index.ts`**

```ts
import type { Check } from "../types.ts";
import { dbCheck } from "./db.ts";
import { authCheck } from "./auth.ts";
import { openaiCheck } from "./openai.ts";
import { s3Check } from "./s3.ts";

export function buildPhase1Checks(): Check[] {
  return [dbCheck(), authCheck(), openaiCheck(), s3Check()];
}
```

- [ ] **Step 6: Type-check all the check files**

Run: `deno check supabase/functions/health-check/checks/index.ts`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/health-check/checks/
git commit -m "feat(health-check): add phase 1 checks (db, auth, openai, s3)"
```

---

## Task 9: HTTP handler — `index.ts`

**Files:**
- Create: `supabase/functions/health-check/index.ts`

- [ ] **Step 1: Write the handler**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildReport, httpStatusFor, runChecks } from "./runner.ts";
import { buildPhase1Checks } from "./checks/index.ts";

const HEALTHCHECK_TOKEN = Deno.env.get("HEALTHCHECK_TOKEN");
const TIMEOUT_MS = 8000;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-healthcheck-token") ?? url.searchParams.get("token");
  if (!HEALTHCHECK_TOKEN || token !== HEALTHCHECK_TOKEN) return unauthorized();

  const results = await runChecks(buildPhase1Checks(), TIMEOUT_MS);
  const report = buildReport(results, new Date().toISOString());

  return new Response(JSON.stringify(report), {
    status: httpStatusFor(report),
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Type-check the whole function**

Run: `deno check supabase/functions/health-check/index.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/health-check/index.ts
git commit -m "feat(health-check): add HTTP handler with token auth"
```

---

## Task 10: Local integration run + validation

**Files:**
- Create (gitignored, local only): `supabase/functions/.env.local`

- [ ] **Step 1: Create a local env file with the real secrets**

Create `supabase/functions/.env.local` (do NOT commit — confirm it is covered by `.gitignore`, add `supabase/functions/.env.local` to `.gitignore` if not):

```
HEALTHCHECK_TOKEN=pick-a-long-random-string
OPENAI_API_KEY=<real key from Supabase dashboard secrets>
AWS_ACCESS_KEY_ID=<real>
AWS_SECRET_ACCESS_KEY=<real>
AWS_REGION=us-east-1
AWS_S3_BUCKET=swellyo-videos
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by `supabase functions serve`.)

- [ ] **Step 2: Serve the function locally**

Run: `supabase functions serve health-check --env-file supabase/functions/.env.local --no-verify-jwt`
Expected: logs `Serving functions on http://localhost:54321/functions/v1/health-check`.

- [ ] **Step 3: Hit it with the correct token (happy path)**

In a second terminal, run:
`curl -s -o /dev/null -w "%{http_code}\n" -H "x-healthcheck-token: pick-a-long-random-string" http://localhost:54321/functions/v1/health-check`
Expected: `200` (if all four live dependencies are healthy). Then run without `-o /dev/null` to see the JSON body and confirm each check shows `"ok":true`.

- [ ] **Step 4: Hit it with a wrong token**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -H "x-healthcheck-token: wrong" http://localhost:54321/functions/v1/health-check`
Expected: `401`.

- [ ] **Step 5: Force a failure to confirm 503**

Temporarily set `OPENAI_API_KEY=bad` in `.env.local`, restart serve, re-run the happy-path curl.
Expected: `503`, and the JSON body shows `"name":"openai","ok":false` with an error string, while the other checks remain `ok:true`. Restore the real key afterward.

- [ ] **Step 6: Commit (gitignore only, if changed)**

```bash
git add .gitignore
git commit -m "chore(health-check): ignore local function env file"
```

---

## Task 11: Deploy + set the production secret

**Files:** none (deployment).

- [ ] **Step 1: Set the `HEALTHCHECK_TOKEN` secret on the project**

Run: `supabase secrets set HEALTHCHECK_TOKEN=<the same long random string>`
Expected: "Finished supabase secrets set." (The other secrets — `OPENAI_API_KEY`, `AWS_*` — already exist for the other functions.)

- [ ] **Step 2: Deploy the function**

Run: `supabase functions deploy health-check`
Expected: deploy succeeds and prints the function URL.

> If your workflow is dashboard copy-paste instead: open the Supabase dashboard → Edge Functions → create `health-check`, and paste each file. Because the function uses relative imports, paste them as separate files in the dashboard editor (it supports multiple files per function), preserving the `checks/` folder structure.

- [ ] **Step 3: Smoke-test the deployed function**

Run: `curl -s -H "x-healthcheck-token: <token>" https://<project-ref>.supabase.co/functions/v1/health-check | head -c 400`
Expected: JSON report with `"ok":true` and four checks. (Find `<project-ref>` in the dashboard or `supabase/config.toml`.)

---

## Task 12: Phase 2 checks — storage, realtime, google, expo

**Files:**
- Create: `supabase/functions/health-check/checks/storage.ts`
- Create: `supabase/functions/health-check/checks/realtime.ts`
- Create: `supabase/functions/health-check/checks/google.ts`
- Create: `supabase/functions/health-check/checks/expo.ts`
- Modify: `supabase/functions/health-check/checks/index.ts`

- [ ] **Step 1: Create a `healthcheck` storage bucket (one-time)**

In the Supabase dashboard → Storage, create a private bucket named `healthcheck`. (Or via SQL: `insert into storage.buckets (id, name, public) values ('healthcheck','healthcheck',false) on conflict do nothing;`)

- [ ] **Step 2: Write `storage.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function storageCheck(): Check {
  return {
    name: "supabase_storage",
    critical: false,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const path = "ping.txt";
      const up = await supabase.storage.from("healthcheck").upload(path, new Blob(["ok"]), {
        upsert: true,
        contentType: "text/plain",
      });
      if (up.error) throw new Error(`storage upload: ${up.error.message}`);
      const del = await supabase.storage.from("healthcheck").remove([path]);
      if (del.error) throw new Error(`storage remove: ${del.error.message}`);
    },
  };
}
```

- [ ] **Step 3: Write `realtime.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function realtimeCheck(): Check {
  return {
    name: "realtime",
    critical: false,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await new Promise<void>((resolve, reject) => {
        const channel = supabase.channel("healthcheck");
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            supabase.removeChannel(channel);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            supabase.removeChannel(channel);
            reject(new Error(`realtime status: ${status}`));
          }
        });
      });
    },
  };
}
```

- [ ] **Step 4: Write `google.ts`**

```ts
import type { Check } from "../types.ts";

export function googleGeocodeCheck(): Check {
  return {
    name: "google_geocode",
    critical: false,
    run: async () => {
      const key = Deno.env.get("GOOGLE_GEOCODING_API_KEY");
      if (!key) throw new Error("GOOGLE_GEOCODING_API_KEY not set");
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=Tel+Aviv&key=${key}`,
      );
      if (!res.ok) throw new Error(`google ${res.status}`);
      const json = await res.json();
      if (json.status !== "OK" || !json.results?.length) {
        throw new Error(`google status: ${json.status} ${json.error_message ?? ""}`);
      }
    },
  };
}
```

- [ ] **Step 5: Write `expo.ts`**

```ts
import type { Check } from "../types.ts";

// Reachability only — does NOT send a push. Posts an obviously-invalid token and
// confirms Expo's push API answers with a structured response (not a network/5xx error).
export function expoPushCheck(): Check {
  return {
    name: "expo_push",
    critical: false,
    run: async () => {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: "ExponentPushToken[healthcheck]", title: "noop" }),
      });
      // Expo returns 200 with a per-message error for a bad token, or 4xx for a
      // malformed request. Either proves the API is reachable. A 5xx or network
      // failure is what we care about.
      if (res.status >= 500) throw new Error(`expo ${res.status}`);
      await res.body?.cancel();
    },
  };
}
```

- [ ] **Step 6: Register the new checks in `checks/index.ts`**

Replace `buildPhase1Checks` body so the file reads:

```ts
import type { Check } from "../types.ts";
import { dbCheck } from "./db.ts";
import { authCheck } from "./auth.ts";
import { openaiCheck } from "./openai.ts";
import { s3Check } from "./s3.ts";
import { storageCheck } from "./storage.ts";
import { realtimeCheck } from "./realtime.ts";
import { googleGeocodeCheck } from "./google.ts";
import { expoPushCheck } from "./expo.ts";

export function buildPhase1Checks(): Check[] {
  return [
    dbCheck(),
    authCheck(),
    openaiCheck(),
    s3Check(),
    storageCheck(),
    realtimeCheck(),
    googleGeocodeCheck(),
    expoPushCheck(),
  ];
}
```

- [ ] **Step 7: Type-check + local re-run**

Run: `deno check supabase/functions/health-check/checks/index.ts`
Then repeat Task 10 Step 2–3 and confirm all 8 checks appear with `ok:true` (add the Phase 2 secrets — `GOOGLE_GEOCODING_API_KEY` — to `.env.local`).
Expected: `200` with 8 checks.

- [ ] **Step 8: Deploy + commit**

```bash
supabase functions deploy health-check
git add supabase/functions/health-check/checks/
git commit -m "feat(health-check): add phase 2 checks (storage, realtime, google, expo)"
```

---

## Task 13: Tag critical vs non-critical intentionally

**Files:**
- Review: all files in `supabase/functions/health-check/checks/`

- [ ] **Step 1: Confirm the criticality flags match the intent**

Critical (flip HTTP to 503 → wakes you up): `supabase_db`, `supabase_auth`, `openai`, `aws_s3`.
Non-critical (reported but won't page you): `supabase_storage`, `realtime`, `google_geocode`, `expo_push`.

Verify each check file's `critical:` value matches the list above. Adjust if Ohad wants any Phase 2 check to page (e.g. make `realtime` critical if DMs are core). No code change unless intent differs.

---

## Task 14: Weekly signup-creation test

**Files:**
- Create: `supabase/functions/health-check/checks/signup.ts`
- Modify: `supabase/functions/health-check/index.ts`

> This runs on a SEPARATE schedule (weekly), so it is exposed under `?suite=signup` rather than included in the default suite. It creates a demo user and deletes it.

- [ ] **Step 1: Inspect required columns before writing inserts**

Run: `supabase db execute --query "select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='surfers' and is_nullable='NO';"`
Expected: a list of NOT NULL columns on `surfers`. Note any with no default — those must be supplied in Step 2's insert. (Also run for `public.users`.) If `db execute` is unavailable, run the query in the dashboard SQL editor.

- [ ] **Step 2: Write `signup.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// Creates a demo user (email starts with "demo" => auto-flagged is_demo_user via
// trigger), verifies the surfer row + triggers, then deletes. finished_onboarding
// is true and no push token is set, so the abandonment-reminder cron never targets it.
export function signupCheck(timestamp: number): Check {
  return {
    name: "supabase_db", // reported under the signup suite; label is for the report only
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const email = `demo-signup-test-${timestamp}@swellyo.test`;
      const created = await supabase.auth.admin.createUser({
        email,
        password: `Hc!${timestamp}aA1`,
        email_confirm: true,
      });
      if (created.error) throw new Error(`create user: ${created.error.message}`);
      const userId = created.data.user!.id;

      try {
        // Insert public.users + surfers rows. Add any NOT-NULL-no-default columns
        // discovered in Step 1 here.
        const u = await supabase.from("users").insert({ id: userId, email, nickname: "HC Signup" });
        if (u.error) throw new Error(`users insert: ${u.error.message}`);

        const s = await supabase.from("surfers").insert({
          user_id: userId,
          is_demo_user: true,
          finished_onboarding: true,
          date_of_birth: "1990-01-01",
        });
        if (s.error) throw new Error(`surfers insert: ${s.error.message}`);

        const check = await supabase
          .from("surfers")
          .select("is_demo_user, age")
          .eq("user_id", userId)
          .single();
        if (check.error) throw new Error(`surfers read: ${check.error.message}`);
        if (check.data.is_demo_user !== true) throw new Error("is_demo_user not auto-flagged");
        if (check.data.age == null) throw new Error("age not computed by trigger");
      } finally {
        // Always clean up, even if an assertion failed.
        await supabase.auth.admin.deleteUser(userId);
      }
    },
  };
}
```

- [ ] **Step 3: Add the `suite` switch to `index.ts`**

In `index.ts`, after the token check, branch on the `suite` query param:

```ts
import { signupCheck } from "./checks/signup.ts";
// ...
  const suite = url.searchParams.get("suite") ?? "daily";
  const checks = suite === "signup"
    ? [signupCheck(Date.now())]
    : buildPhase1Checks();

  const results = await runChecks(checks, TIMEOUT_MS);
```

(Replace the existing `buildPhase1Checks()` call accordingly.)

- [ ] **Step 4: Local validation**

Repeat Task 10 Step 2, then:
`curl -s -H "x-healthcheck-token: <token>" "http://localhost:54321/functions/v1/health-check?suite=signup"`
Expected: `200`, one check `ok:true`. Then verify in the dashboard that NO leftover `demo-signup-test-*` user remains in Authentication → Users.

- [ ] **Step 5: Deploy + commit**

```bash
supabase functions deploy health-check
git add supabase/functions/health-check/checks/signup.ts supabase/functions/health-check/index.ts
git commit -m "feat(health-check): add weekly signup-creation suite"
```

---

## Task 15: Configure UptimeRobot (scheduling + alerts)

**Files:** none (external config). Document the result in the spec doc.

- [ ] **Step 1: Create the daily monitor**

In UptimeRobot → Add New Monitor:
- Type: **HTTP(s)** (keyword monitor).
- URL: `https://<project-ref>.supabase.co/functions/v1/health-check?token=<token>`
- Keyword: `"ok":true` — Alert when keyword **does not exist**.
- Monitoring interval: as desired (e.g. every 30 min, or use UptimeRobot's longest free interval for "daily-ish").

> Note: the token in the URL is acceptable for UptimeRobot. If you prefer the header form, UptimeRobot's paid tiers allow custom request headers; on free tier use the `?token=` query param.

- [ ] **Step 2: Create the weekly signup monitor**

Add a second monitor pointing at `...?suite=signup&token=<token>` with the same keyword rule. Set its interval as infrequent as the plan allows (the free tier minimum is short; if true weekly cadence matters, drive `?suite=signup` from a Supabase pg_cron job instead — optional follow-up).

- [ ] **Step 3: Configure alert contacts**

In UptimeRobot → My Settings → Alert Contacts: enable **email** and install the UptimeRobot mobile app and enable **push notifications**. Attach both contacts to both monitors.

- [ ] **Step 4: Verify an alert fires**

Temporarily point the keyword to something the response will never contain (or briefly break a critical dependency in a staging context). Confirm you receive both an email and a phone push. Restore.

- [ ] **Step 5: Record the setup**

Append the monitor URLs (with the token redacted) and alert-contact summary to `docs/superpowers/specs/2026-06-03-daily-health-check-design.md` under a new "## Deployed configuration" section, and commit.

---

## Self-Review (completed by plan author)

- **Spec coverage:** strategy/building-blocks (Tasks 8, 12) ✓; architecture function-as-brain + UptimeRobot scheduler (Tasks 9, 15) ✓; JSON report + 200/503 (Tasks 6, 9) ✓; secret token security (Task 9) ✓; Phase 1 checks (Task 8) ✓; Phase 2 checks (Task 12) ✓; weekly signup test via Option 3 create-as-demo + delete (Task 14) ✓; error handling per-check try/catch + timeout + critical/non-critical (Tasks 4–6, 13) ✓; success criteria (Tasks 10, 11, 15) ✓. The permanent-test-user item is intentionally replaced (see Refinements) — flagged for Ohad.
- **Placeholder scan:** no TBD/TODO; the only "fill in from inspection" point is Task 14 Step 1→2 (NOT NULL columns), which is a deliberate inspect-then-insert step, not a placeholder.
- **Type consistency:** `Check`/`CheckResult`/`HealthReport` used consistently; `runCheck(check, timeoutMs)`, `runChecks(checks, timeoutMs)`, `buildReport(results, ranAt)`, `httpStatusFor(report)`, `generatePresignedUrl(method, key, expiresIn, contentType)`, `buildPhase1Checks()` signatures match across all tasks.
