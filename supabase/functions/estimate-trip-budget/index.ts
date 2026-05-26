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
}

interface Tier {
  min: number;
  max: number;
  label?: string;
}

// Coerce a model-produced range into clean integers; throw on garbage.
function sanitizeTier(raw: any): Tier {
  let min = Math.round(Number(raw?.min));
  let max = Math.round(Number(raw?.max));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
    throw new Error('Invalid range numbers');
  }
  if (min > max) [min, max] = [max, min];
  const tier: Tier = { min, max };
  if (typeof raw?.label === 'string' && raw.label.trim()) tier.label = String(raw.label).trim();
  return tier;
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

  const systemPrompt =
    'You are a surf-travel budget estimator. Given a destination, trip length in ' +
    'days, and accommodation type, estimate the TOTAL per-person cost in USD for ' +
    'the WHOLE trip (accommodation + food + local transport + typical surf ' +
    'activities; EXCLUDING international flights). Return three tiers: low ' +
    '(budget/backpacker), medium (comfortable mid-range), high (premium). Each ' +
    'tier is a realistic min-max range in whole US dollars. Ranges must increase ' +
    'low -> medium -> high and should not overlap. Labels must be short (<= 6 ' +
    'words). Respond ONLY with a JSON object, no markdown, no comments.';

  const userPrompt =
    `Destination: ${place}${country}\n` +
    `Trip length: ${durationDays} days\n` +
    `Accommodation type: ${accommodation}\n\n` +
    'Return JSON exactly in this schema:\n' +
    '{"currency":"USD","ranges":{' +
    '"low":{"min":<int>,"max":<int>,"label":"<short phrase>"},' +
    '"medium":{"min":<int>,"max":<int>,"label":"<short phrase>"},' +
    '"high":{"min":<int>,"max":<int>,"label":"<short phrase>"}}}';

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
    const r = parsed?.ranges ?? {};
    const result = {
      currency: 'USD' as const,
      ranges: {
        low: sanitizeTier(r.low),
        medium: sanitizeTier(r.medium),
        high: sanitizeTier(r.high),
      },
    };
    return json(result, 200);
  } catch (e) {
    console.error('[estimate-trip-budget] parse error:', e, 'raw:', content);
    return json({ error: 'Could not parse estimate' }, 502);
  }
});
