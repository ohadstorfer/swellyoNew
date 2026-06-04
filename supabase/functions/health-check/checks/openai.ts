import type { Check } from "../types.ts";

// Checks that each prod model is accessible — zero token cost (GET model info only).
// Failure classification:
//   401/403 or 404 → HARD failure (key/org wrong, model truly missing)
//   429 or >=500 or network/timeout → TRANSIENT: retry once; if still bad,
//     throw with message prefixed "transient:" so it's visible in the report.
//     The A6 debounce in alert.ts will suppress email for a single transient blip.
const MODELS = ["gpt-5.2", "gpt-4o-mini"];
const TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 500;

async function checkModel(model: string, key: string): Promise<void> {
  async function attempt(): Promise<{ status: number; ok: boolean }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ac.signal,
      });
      await res.body?.cancel();
      return { status: res.status, ok: res.ok };
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { status: 0, ok: false };
      }
      throw e; // unexpected network error
    } finally {
      clearTimeout(timer);
    }
  }

  let result: { status: number; ok: boolean };
  try {
    result = await attempt();
  } catch {
    // First attempt had a network error — treat as transient, retry once
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      result = await attempt();
    } catch (e2) {
      throw new Error(`transient: ${model} network error: ${(e2 as Error).message}`);
    }
  }

  if (result.ok) return; // 200 — model is accessible

  const { status } = result;

  // Hard failures: auth problem or model genuinely missing
  if (status === 401 || status === 403) throw new Error(`${model}: auth rejected (${status})`);
  if (status === 404) throw new Error(`${model}: model not found (404)`);

  // Transient: rate-limited, server error, or timeout (status 0)
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  let result2: { status: number; ok: boolean };
  try {
    result2 = await attempt();
  } catch (e2) {
    throw new Error(`transient: ${model} network error on retry: ${(e2 as Error).message}`);
  }
  if (result2.ok) return;
  const s2 = result2.status;
  if (s2 === 401 || s2 === 403) throw new Error(`${model}: auth rejected (${s2})`);
  if (s2 === 404) throw new Error(`${model}: model not found (404)`);
  const label = s2 === 0 ? "timeout" : String(s2);
  throw new Error(`transient: ${model}: still failing after retry (${label})`);
}

export function openaiCheck(): Check {
  return {
    name: "openai",
    critical: true,
    run: async () => {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY not set");

      // Run model checks sequentially to avoid saturating rate limits
      for (const model of MODELS) {
        await checkModel(model, key);
      }
    },
  };
}
