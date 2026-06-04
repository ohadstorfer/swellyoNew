import type { Check } from "../types.ts";
import { generatePresignedUrl } from "../aws.ts";

const PING_KEY = "healthcheck/ping.txt";
const SENTINEL_KEY = "healthcheck/permanent.txt";

export function s3Check(): Check {
  return {
    name: "aws_s3",
    critical: true,
    run: async () => {
      // ── 1. Write+read-back ping.txt (proves the write path) ──────────────────
      const putUrl = await generatePresignedUrl("PUT", PING_KEY, 120, "text/plain");
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "ok",
      });
      if (!putRes.ok) {
        const body = await putRes.text();
        throw new Error(`s3 put ${putRes.status}: ${body.slice(0, 200)}`);
      }

      const getUrl = await generatePresignedUrl("GET", PING_KEY, 120);
      const getRes = await fetch(getUrl);
      if (!getRes.ok) {
        const body = await getRes.text();
        throw new Error(`s3 get ${getRes.status}: ${body.slice(0, 200)}`);
      }
      const text = await getRes.text();
      if (text.trim() !== "ok") throw new Error(`s3 get body mismatch: ${text.slice(0, 50)}`);

      // ── 2. Sentinel read (permanent.txt must pre-exist; never written here) ──
      // A failed GET here means an old object disappeared (deletion / lifecycle).
      const sentinelUrl = await generatePresignedUrl("GET", SENTINEL_KEY, 120);
      const sentinelRes = await fetch(sentinelUrl);
      if (!sentinelRes.ok) {
        throw new Error(
          `s3 sentinel: permanent.txt missing/changed (key=${SENTINEL_KEY}, status=${sentinelRes.status})`,
        );
      }
      const sentinelBody = await sentinelRes.text();
      if (sentinelBody.trim() !== "permanent") {
        throw new Error(
          `s3 sentinel: permanent.txt missing/changed (key=${SENTINEL_KEY})`,
        );
      }
    },
  };
}
