// Edge Function: estimate-trip-budget
// Estimates a per-person USD budget for a surf trip in 3 tiers (low/medium/high)
// from destination + trip length + accommodation type, via OpenAI.
//
// Deployed by COPY-PASTE into the Supabase dashboard (same convention as
// swelly-trip-planning). Requires the OPENAI_API_KEY secret (already set).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface EstimateRequest {
  destination: string;
  country?: string | null;
  formatted_address?: string | null;
  duration_days: number;
  accommodation_type?: string | null;
  travel_month?: string | null; // "YYYY-MM" — drives seasonality
}

interface Tier {
  min: number;
  max: number;
  label?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "2026-07" -> "July". Returns null on anything that isn't a valid YYYY-MM.
function monthName(ym?: string | null): string | null {
  if (!ym) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym).trim());
  if (!m) return null;
  return MONTHS[Number(m[2]) - 1] ?? null;
}

// Coerce a model-produced per-day range into finite non-negative numbers; throw
// on garbage. Rounding is deferred until after the per-day -> whole-trip scaling
// so the rounding error isn't multiplied by the trip length.
function sanitizeTier(raw: any): Tier {
  let min = Number(raw?.min);
  let max = Number(raw?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
    throw new Error('Invalid range numbers');
  }
  if (min > max) [min, max] = [max, min];
  const tier: Tier = { min, max };
  if (typeof raw?.label === 'string' && raw.label.trim()) tier.label = String(raw.label).trim();
  return tier;
}

// Force the three tiers to strictly increase and not overlap (low.max <=
// medium.min <= medium.max <= high.min ...). The model is told to do this but
// doesn't always comply, which would otherwise surface as overlapping/jumbled
// price cards in the UI. Operates on per-day values (monotonic under scaling).
function enforceOrdering(low: Tier, medium: Tier, high: Tier): void {
  medium.min = Math.max(medium.min, low.max);
  medium.max = Math.max(medium.max, medium.min);
  high.min = Math.max(high.min, medium.max);
  high.max = Math.max(high.max, high.min);
}

// Scale a per-day tier to the whole trip and round to whole dollars.
function scaleTier(t: Tier, days: number): Tier {
  const out: Tier = { min: Math.round(t.min * days), max: Math.round(t.max * days) };
  if (t.label) out.label = t.label;
  return out;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY not configured' }, 502);
  }

  let body: EstimateRequest;
  try {
    body = (await req.json()) as EstimateRequest;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.destination || !body?.duration_days || body.duration_days < 1) {
    return json({ error: 'Invalid input' }, 400);
  }

  const durationDays = Math.min(Math.max(Math.round(body.duration_days), 1), 90);
  const place = body.formatted_address || body.destination;
  const country = body.country ? ` (${body.country})` : '';
  const accommodation = body.accommodation_type || 'unspecified';
  const month = monthName(body.travel_month);

  const systemPrompt =
    'You are a surf-travel budget estimator. Given a destination, travel month, ' +
    'and accommodation type, estimate the per-person, PER-DAY cost in USD ' +
    '(accommodation + food + local transport + typical surf activities; ' +
    'EXCLUDING international flights). Account for seasonality: peak/high season ' +
    'costs more than off-season at that destination. Return three tiers: low ' +
    '(budget/backpacker), medium (comfortable mid-range), high (premium). Each ' +
    'tier is a realistic per-day min-max range in US dollars. Ranges MUST ' +
    'increase low -> medium -> high and MUST NOT overlap. Labels must be short ' +
    '(<= 6 words). Respond ONLY with a JSON object, no markdown, no comments.';

  const userPrompt =
    `Destination: ${place}${country}\n` +
    (month ? `Travel month: ${month}\n` : '') +
    `Trip length: ${durationDays} days\n` +
    `Accommodation type: ${accommodation}\n\n` +
    'Return JSON exactly in this schema (PER-DAY per-person amounts, NOT trip totals):\n' +
    '{"currency":"USD","per_day":{' +
    '"low":{"min":<number>,"max":<number>,"label":"<short phrase>"},' +
    '"medium":{"min":<number>,"max":<number>,"label":"<short phrase>"},' +
    '"high":{"min":<number>,"max":<number>,"label":"<short phrase>"}}}';

  let content = '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[estimate-trip-budget] OpenAI error:', res.status, errText);
      return json({ error: 'OpenAI request failed' }, 502);
    }
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[estimate-trip-budget] fetch error:', e);
    return json({ error: 'OpenAI request failed' }, 502);
  }

  // Strip code fences + comments before parsing (mirrors swelly-trip-planning).
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    // New schema is `per_day`; fall back to `ranges` for any stale response.
    const r = parsed?.per_day ?? parsed?.ranges ?? {};
    const low = sanitizeTier(r.low);
    const medium = sanitizeTier(r.medium);
    const high = sanitizeTier(r.high);

    // Enforce increasing / non-overlapping on per-day values, then scale to the
    // whole trip. Scaling is monotonic, so the ordering survives.
    enforceOrdering(low, medium, high);

    const result = {
      currency: 'USD' as const,
      ranges: {
        low: scaleTier(low, durationDays),
        medium: scaleTier(medium, durationDays),
        high: scaleTier(high, durationDays),
      },
    };
    return json(result, 200);
  } catch (e) {
    console.error('[estimate-trip-budget] parse error:', e, 'raw:', content);
    return json({ error: 'Could not parse estimate' }, 502);
  }
});
