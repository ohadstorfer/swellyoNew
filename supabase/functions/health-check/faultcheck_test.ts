// Fault-injection harness for every health check.
//
// GOAL: prove each check returns no FALSE result:
//   - broken dependency  -> check MUST throw  (catches "false green")
//   - healthy dependency -> check MUST resolve (catches "false red")
//
// TECHNIQUE: every check talks to the outside world through `globalThis.fetch`
// (supabase-js uses it under the hood too) or, for realtime, `globalThis.WebSocket`.
// We stub those per-test, decide the response from the request URL/method, then
// ALWAYS restore the originals in `finally`. No real network, no real keys, no
// prod. (--allow-net is only needed so the supabase-js ESM import resolves.)
//
// IMPORTANT: faultcheck_env.ts is imported FIRST so dummy env vars exist before
// aws.ts (which reads AWS_* at module-load) is evaluated.

import "./faultcheck_env.ts";

import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { openaiCheck } from "./checks/openai.ts";
import { googleGeocodeCheck } from "./checks/google.ts";
import { expoPushCheck } from "./checks/expo.ts";
import { edgeFunctionsCheck } from "./checks/edgeFunctions.ts";
import { s3Check } from "./checks/s3.ts";
import { authCheck } from "./checks/auth.ts";
import { dbCheck } from "./checks/db.ts";
import { storageCheck } from "./checks/storage.ts";
import { matchingCheck } from "./checks/matching.ts";
import { realtimeCheck } from "./checks/realtime.ts";

// ── fetch stub plumbing ────────────────────────────────────────────────────

type FetchInfo = { url: string; method: string };
type Handler = (info: FetchInfo, init?: RequestInit) => Response | Promise<Response>;

const realFetch = globalThis.fetch;

function installFetch(handler: Handler) {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    return await handler({ url, method }, init);
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** Run `fn` with fetch stubbed by `handler`, restoring fetch afterwards. */
async function withFetch(handler: Handler, fn: () => Promise<unknown>) {
  installFetch(handler);
  try {
    await fn();
  } finally {
    restoreFetch();
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const text = (body: string, status = 200) => new Response(body, { status });

// =============================================================================
// 1. OPENAI  (checks/openai.ts)
// =============================================================================

Deno.test("openai BROKEN: 401 on /v1/models -> throws (hard auth failure)", async () => {
  await withFetch(
    () => json({ error: "invalid key" }, 401),
    () => assertRejects(() => openaiCheck().run()),
  );
});

Deno.test("openai BROKEN: 404 on /v1/models -> throws (model missing)", async () => {
  await withFetch(
    () => json({ error: "no such model" }, 404),
    () => assertRejects(() => openaiCheck().run()),
  );
});

Deno.test("openai BROKEN: 429 on both attempts -> throws (transient after retry)", async () => {
  await withFetch(
    () => json({ error: "rate limited" }, 429),
    () => assertRejects(() => openaiCheck().run()),
  );
});

Deno.test("openai HEALTHY: 200 for both models -> resolves", async () => {
  await withFetch(
    ({ url }) => {
      if (url.startsWith("https://api.openai.com/v1/models/")) {
        return json({ id: "model", object: "model" }, 200);
      }
      return json({ unexpected: url }, 500);
    },
    async () => {
      await openaiCheck().run(); // must NOT throw
    },
  );
});

// =============================================================================
// 2. GOOGLE PLACES  (checks/google.ts)
// =============================================================================

Deno.test("google BROKEN: 403 REQUEST_DENIED -> throws", async () => {
  await withFetch(
    () => json({ error: { status: "REQUEST_DENIED", message: "key denied" } }, 403),
    () => assertRejects(() => googleGeocodeCheck().run()),
  );
});

Deno.test("google BROKEN: 200 but empty suggestions -> throws", async () => {
  await withFetch(
    () => json({ suggestions: [] }, 200),
    () => assertRejects(() => googleGeocodeCheck().run()),
  );
});

Deno.test("google HEALTHY: 200 with suggestions -> resolves", async () => {
  await withFetch(
    () => json({ suggestions: [{ placePrediction: { placeId: "abc" } }] }, 200),
    async () => {
      await googleGeocodeCheck().run();
    },
  );
});

// =============================================================================
// 3. EXPO PUSH  (checks/expo.ts)
// =============================================================================

Deno.test("expo BROKEN: HTTP 500 -> throws", async () => {
  await withFetch(
    () => json({ errors: [{ message: "server error" }] }, 500),
    () => assertRejects(() => expoPushCheck().run()),
  );
});

Deno.test("expo BROKEN: 200 with top-level errors[] -> throws (account/auth)", async () => {
  await withFetch(
    () => json({ errors: [{ code: "UNAUTHENTICATED", message: "bad token" }] }, 200),
    () => assertRejects(() => expoPushCheck().run()),
  );
});

Deno.test("expo HEALTHY: 200 with per-ticket data[].status='error' -> resolves", async () => {
  await withFetch(
    () =>
      json(
        {
          data: [
            {
              status: "error",
              message: "is not a valid Expo push token",
              details: { error: "InvalidCredentials" },
            },
          ],
        },
        200,
      ),
    async () => {
      await expoPushCheck().run();
    },
  );
});

// =============================================================================
// 4. EDGE FUNCTIONS  (checks/edgeFunctions.ts) — pings 9 functions
// =============================================================================

Deno.test("edge_functions BROKEN: one function 404 -> throws", async () => {
  await withFetch(
    ({ url }) => {
      // break exactly one function with a 404
      if (url.endsWith("/functions/v1/swelly-shaper")) return text("not found", 404);
      return text("bad request", 400);
    },
    () => assertRejects(() => edgeFunctionsCheck().run()),
  );
});

Deno.test("edge_functions BROKEN: 500 from a function -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.endsWith("/functions/v1/analytics-dashboard")) return text("boom", 500);
      return text("bad request", 400);
    },
    () => assertRejects(() => edgeFunctionsCheck().run()),
  );
});

Deno.test("edge_functions HEALTHY: 400 for all (handler ran, rejected bad body) -> resolves", async () => {
  await withFetch(
    () => text("bad request", 400),
    async () => {
      await edgeFunctionsCheck().run();
    },
  );
});

// =============================================================================
// 5. AWS S3  (checks/s3.ts) — presigned PUT ping, GET ping, GET sentinel
//    Differentiate by method + key in the URL path.
// =============================================================================

function s3Route(info: FetchInfo): "put-ping" | "get-ping" | "get-sentinel" | "unknown" {
  // generatePresignedUrl URL-encodes the key, so "healthcheck/ping.txt" appears
  // as "healthcheck/ping.txt" in the path (slash preserved, dot literal).
  const isPing = info.url.includes("healthcheck/ping.txt");
  const isSentinel = info.url.includes("healthcheck/permanent.txt");
  if (info.method === "PUT" && isPing) return "put-ping";
  if (info.method === "GET" && isPing) return "get-ping";
  if (info.method === "GET" && isSentinel) return "get-sentinel";
  return "unknown";
}

Deno.test("aws_s3 BROKEN: sentinel GET 404 -> throws (permanent.txt vanished)", async () => {
  await withFetch(
    (info) => {
      switch (s3Route(info)) {
        case "put-ping":
          return text("", 200);
        case "get-ping":
          return text("ok", 200);
        case "get-sentinel":
          return text("NoSuchKey", 404);
        default:
          return text("unexpected", 500);
      }
    },
    () => assertRejects(() => s3Check().run()),
  );
});

Deno.test("aws_s3 BROKEN: ping PUT 403 -> throws (write path denied)", async () => {
  await withFetch(
    (info) => {
      if (s3Route(info) === "put-ping") return text("AccessDenied", 403);
      return text("ok", 200);
    },
    () => assertRejects(() => s3Check().run()),
  );
});

Deno.test("aws_s3 HEALTHY: PUT 200, ping GET 'ok', sentinel GET 'permanent' -> resolves", async () => {
  await withFetch(
    (info) => {
      switch (s3Route(info)) {
        case "put-ping":
          return text("", 200);
        case "get-ping":
          return text("ok", 200);
        case "get-sentinel":
          return text("permanent", 200);
        default:
          return text("unexpected", 500);
      }
    },
    async () => {
      await s3Check().run();
    },
  );
});

// =============================================================================
// 6. SUPABASE AUTH  (checks/auth.ts)
//    /auth/v1/health, /auth/v1/settings, then admin.listUsers via supabase-js.
// =============================================================================

Deno.test("supabase_auth BROKEN: settings shows google:false -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.endsWith("/auth/v1/health")) return json({ description: "ok" }, 200);
      if (url.endsWith("/auth/v1/settings")) return json({ external: { google: false } }, 200);
      if (url.includes("/auth/v1/admin/users")) return json({ users: [], aud: "x" }, 200);
      return json({ unexpected: url }, 500);
    },
    () => assertRejects(() => authCheck().run()),
  );
});

Deno.test("supabase_auth BROKEN: /auth/v1/health 500 -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.endsWith("/auth/v1/health")) return json({ msg: "down" }, 500);
      return json({ external: { google: true } }, 200);
    },
    () => assertRejects(() => authCheck().run()),
  );
});

Deno.test("supabase_auth HEALTHY: health 200, settings google:true, listUsers ok -> resolves", async () => {
  await withFetch(
    ({ url }) => {
      if (url.endsWith("/auth/v1/health")) return json({ description: "ok" }, 200);
      if (url.endsWith("/auth/v1/settings")) return json({ external: { google: true } }, 200);
      if (url.includes("/auth/v1/admin/users")) {
        return json({ users: [], aud: "authenticated" }, 200);
      }
      return json({ unexpected: url }, 500);
    },
    async () => {
      await authCheck().run();
    },
  );
});

// =============================================================================
// 7. SUPABASE DB  (checks/db.ts) — PostgREST via supabase-js.
//    insert.select(id).single, select.single, delete, then surfers head/count.
// =============================================================================

Deno.test("supabase_db BROKEN: 500 on health_check_log insert -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.includes("/rest/v1/health_check_log")) {
        return json({ message: "relation broken" }, 500);
      }
      return json({ unexpected: url }, 500);
    },
    () => assertRejects(() => dbCheck().run()),
  );
});

Deno.test("supabase_db HEALTHY: insert/select/delete + surfers head all ok -> resolves", async () => {
  await withFetch(
    ({ url, method }) => {
      if (url.includes("/rest/v1/health_check_log")) {
        // .single() expects a single object body, not an array.
        if (method === "POST") return json({ id: "probe-abc" }, 201);
        if (method === "GET") return json({ id: "probe-abc" }, 200);
        if (method === "DELETE") return new Response(null, { status: 204 });
      }
      if (url.includes("/rest/v1/surfers")) {
        // head:true + count:"exact" -> HEAD with content-range header
        return new Response(null, {
          status: 200,
          headers: { "content-range": "0-0/0", "content-type": "application/json" },
        });
      }
      return json({ unexpected: url }, 500);
    },
    async () => {
      await dbCheck().run();
    },
  );
});

// =============================================================================
// 8. SUPABASE STORAGE  (checks/storage.ts)
//    createBucket, upload, createSignedUrl, signed GET, remove, listBuckets.
// =============================================================================

Deno.test("supabase_storage BROKEN: 500 on storage API -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.includes("/storage/v1/")) return json({ message: "storage down" }, 500);
      return json({ unexpected: url }, 500);
    },
    () => assertRejects(() => storageCheck().run()),
  );
});

Deno.test("supabase_storage HEALTHY: full upload/sign/read/remove/list cycle -> resolves", async () => {
  await withFetch(
    ({ url, method }) => {
      // Signed-URL fetch (the read of the object) carries ?token= in the query.
      if (url.includes("token=") && url.includes("/object/sign/")) {
        return text("ok", 200);
      }
      if (url.includes("/storage/v1/bucket")) {
        if (method === "POST") return json({ name: "healthcheck" }, 200);
        if (method === "GET") {
          return json(
            [
              { id: "1", name: "profile-surf-videos" },
              { id: "2", name: "message-images" },
              { id: "3", name: "healthcheck" },
            ],
            200,
          );
        }
      }
      if (url.includes("/storage/v1/object/sign/")) {
        // createSignedUrl POST -> returns relative signedURL
        return json({ signedURL: "/object/sign/healthcheck/x.txt?token=ABC" }, 200);
      }
      if (url.includes("/storage/v1/object/")) {
        if (method === "POST") return json({ Key: "healthcheck/x.txt", path: "x.txt" }, 200);
        if (method === "DELETE") return json([{ name: "x.txt" }], 200);
      }
      return json({ unexpected: url }, 500);
    },
    async () => {
      await storageCheck().run();
    },
  );
});

// =============================================================================
// 9. MATCHING  (checks/matching.ts) — supabase-js .rpc()
//    PostgREST maps a 4xx body {message} into error.message.
// =============================================================================

Deno.test("matching BROKEN: rpc returns success (no error) -> throws (false-green guard)", async () => {
  await withFetch(
    ({ url }) => {
      if (url.includes("/rest/v1/rpc/find_and_connect_matches")) {
        return json(null, 200); // success — guard did NOT fire
      }
      return json({ unexpected: url }, 500);
    },
    () => assertRejects(() => matchingCheck().run()),
  );
});

Deno.test("matching BROKEN: rpc error message is NOT 'Surfer not found' -> throws", async () => {
  await withFetch(
    ({ url }) => {
      if (url.includes("/rest/v1/rpc/find_and_connect_matches")) {
        return json(
          { code: "42883", message: "function find_and_connect_matches does not exist" },
          404,
        );
      }
      return json({ unexpected: url }, 500);
    },
    () => assertRejects(() => matchingCheck().run()),
  );
});

Deno.test("matching HEALTHY: rpc error contains 'Surfer not found' -> resolves", async () => {
  await withFetch(
    ({ url }) => {
      if (url.includes("/rest/v1/rpc/find_and_connect_matches")) {
        return json(
          {
            code: "P0001",
            message: "Surfer not found for user_id 00000000-0000-0000-0000-000000000000",
            details: null,
            hint: null,
          },
          400,
        );
      }
      return json({ unexpected: url }, 500);
    },
    async () => {
      await matchingCheck().run();
    },
  );
});

// =============================================================================
// 10. REALTIME  (checks/realtime.ts) — uses WebSocket, not fetch.
//     Stub globalThis.WebSocket with a fake that synchronously errors+closes,
//     which the realtime channel reports as CHANNEL_ERROR -> check rejects.
// =============================================================================

const realWS = globalThis.WebSocket;

class ErroringWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  url: string;
  // deno-lint-ignore no-explicit-any
  onopen: ((e: any) => void) | null = null;
  // deno-lint-ignore no-explicit-any
  onclose: ((e: any) => void) | null = null;
  // deno-lint-ignore no-explicit-any
  onerror: ((e: any) => void) | null = null;
  // deno-lint-ignore no-explicit-any
  onmessage: ((e: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Fire error + close on next tick so the realtime client sees a failed socket.
    setTimeout(() => {
      this.readyState = ErroringWebSocket.CLOSED;
      this.onerror?.({ type: "error" });
      this.onclose?.({ code: 1006, reason: "fault-injected", wasClean: false });
    }, 0);
  }

  send() {/* no-op: socket never opens */}
  close() {
    this.readyState = ErroringWebSocket.CLOSED;
  }
  // deno-lint-ignore no-explicit-any
  addEventListener(type: string, cb: (e: any) => void) {
    if (type === "open") this.onopen = cb;
    else if (type === "close") this.onclose = cb;
    else if (type === "error") this.onerror = cb;
    else if (type === "message") this.onmessage = cb;
  }
  removeEventListener() {}
}

Deno.test("realtime BROKEN: WebSocket errors/closes -> CHANNEL_ERROR -> throws", async () => {
  // @ts-ignore: swap in fake socket
  globalThis.WebSocket = ErroringWebSocket;
  try {
    await assertRejects(() => realtimeCheck().run());
  } finally {
    // @ts-ignore
    globalThis.WebSocket = realWS;
  }
});
