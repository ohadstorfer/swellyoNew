import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY");

const KEYWORD_MAX_LENGTH = 60;
const FALLBACK_QUERY = "outdoor lifestyle";

interface RequestBody {
  keyword?: string;
}

interface ResultResponse {
  query: string;
  pexels_url?: string;
  has_result: boolean;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
}

/**
 * Build a short Pexels search phrase from a lifestyle keyword using GPT.
 * On failure returns fallback or trimmed keyword.
 */
async function buildPexelsLifestyleQuery(keyword: string): Promise<string> {
  const trimmed = keyword.trim();
  if (!trimmed) return FALLBACK_QUERY;

  if (!OPENAI_API_KEY) {
    console.warn("[lifestyle-image-query] OPENAI_API_KEY not set, using keyword as query");
    return trimmed;
  }

  const systemPrompt =
    "You generate short image search queries for a stock photo API. The query should help fetch realistic photos for hobbies, activities, or lifestyle. Return 3–7 words only, no punctuation except spaces.";
  const userMessage = `Keyword: "${trimmed}". Return only the search query.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn("[lifestyle-image-query] OpenAI error:", response.status, errText);
      return trimmed;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return trimmed;

    // Parse: trim, drop emojis/weird punctuation, enforce length
    const cleaned = content
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
    if (!cleaned) return trimmed;
    return cleaned;
  } catch (e) {
    console.warn("[lifestyle-image-query] GPT request failed:", e);
    return trimmed;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders() }
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const rawKeyword = body.keyword;
  if (typeof rawKeyword !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing or invalid keyword" }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const keyword = rawKeyword.trim().slice(0, KEYWORD_MAX_LENGTH);
  if (!keyword) {
    return new Response(
      JSON.stringify({
        query: FALLBACK_QUERY,
        has_result: false,
      } as ResultResponse),
      { status: 200, headers: corsHeaders() }
    );
  }

  let searchQuery: string;
  try {
    searchQuery = await buildPexelsLifestyleQuery(keyword);
  } catch (e) {
    console.warn("[lifestyle-image-query] buildPexelsLifestyleQuery failed:", e);
    searchQuery = keyword;
  }

  console.log("[lifestyle-image-query] keyword:", keyword, "-> query:", searchQuery);

  if (!PEXELS_API_KEY) {
    console.warn("[lifestyle-image-query] PEXELS_API_KEY not set");
    return new Response(
      JSON.stringify({
        query: searchQuery,
        has_result: false,
      } as ResultResponse),
      { status: 200, headers: corsHeaders() }
    );
  }

  try {
    const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=3&orientation=square`;
    const pexelsRes = await fetch(pexelsUrl, {
      headers: { Authorization: PEXELS_API_KEY },
    });

    if (!pexelsRes.ok) {
      console.warn("[lifestyle-image-query] Pexels API error:", pexelsRes.status);
      return new Response(
        JSON.stringify({ query: searchQuery, has_result: false } as ResultResponse),
        { status: 200, headers: corsHeaders() }
      );
    }

    const pexelsData = await pexelsRes.json();
    const photos = pexelsData?.photos;
    const count = Array.isArray(photos) ? photos.length : 0;
    console.log("[lifestyle-image-query] Pexels returned", count, "photos");

    if (count === 0) {
      return new Response(
        JSON.stringify({ query: searchQuery, has_result: false } as ResultResponse),
        { status: 200, headers: corsHeaders() }
      );
    }

    const first = photos[0];
    const imageUrl = first?.src?.medium || first?.src?.small || first?.src?.tiny;
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ query: searchQuery, has_result: false } as ResultResponse),
        { status: 200, headers: corsHeaders() }
      );
    }

    return new Response(
      JSON.stringify({
        query: searchQuery,
        pexels_url: imageUrl,
        has_result: true,
      } as ResultResponse),
      { status: 200, headers: corsHeaders() }
    );
  } catch (e) {
    console.error("[lifestyle-image-query] Pexels fetch failed:", e);
    return new Response(
      JSON.stringify({ query: searchQuery, has_result: false } as ResultResponse),
      { status: 200, headers: corsHeaders() }
    );
  }
});
