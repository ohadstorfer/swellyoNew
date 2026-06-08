import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const SPARKLINE_DAYS = 30

interface RequestBody { from?: string | null; to?: string | null }
interface Counter { total: number; prev: number; series: number[] }

const OVERVIEW_KEYS = [
  'trips_created', 'join_requests', 'members_joined', 'unique_hosts', 'commitments_approved',
] as const
type OverviewKey = typeof OVERVIEW_KEYS[number]

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ---------- helpers ----------
function isoMs(s: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

function prevRange(from: string | null, to: string | null): { prevFrom: string | null; prevTo: string | null } {
  const fromMs = isoMs(from), toMs = isoMs(to)
  if (fromMs === null || toMs === null) return { prevFrom: null, prevTo: null }
  const L = toMs - fromMs
  return { prevFrom: new Date(fromMs - L).toISOString(), prevTo: new Date(fromMs).toISOString() }
}

async function overviewTotals(from: string | null, to: string | null): Promise<Record<OverviewKey, number>> {
  const { data, error } = await supabase.rpc('trips_overview', { p_from: from, p_to: to })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) ?? {}
  const out = {} as Record<OverviewKey, number>
  for (const k of OVERVIEW_KEYS) out[k] = Number(row?.[k]) || 0
  return out
}

async function overviewSeries(): Promise<Record<OverviewKey, number[]>> {
  const { data, error } = await supabase.rpc('trips_overview_series', { p_days: SPARKLINE_DAYS })
  if (error) throw error
  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
  const series = {} as Record<OverviewKey, number[]>
  for (const k of OVERVIEW_KEYS) {
    series[k] = rows.map(row => Number(row[k]) || 0)
  }
  return series
}

// ---------- auth (identical pattern to analytics-dashboard) ----------
async function isAdmin(jwt: string): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error } = await userClient.auth.getUser(jwt)
  if (error || !user) return { ok: false, status: 401, reason: 'invalid token' }
  const { data, error: roleErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (roleErr) return { ok: false, status: 500, reason: 'role lookup failed' }
  if (!data || data.role !== 'admin') return { ok: false, status: 403, reason: 'not an admin' }
  return { ok: true }
}

// ---------- handler ----------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401, headers: jsonHeaders })
  }
  const adminCheck = await isAdmin(authHeader.slice(7).trim())
  if (!adminCheck.ok) {
    return new Response(JSON.stringify({ error: adminCheck.reason }), { status: adminCheck.status, headers: jsonHeaders })
  }

  let body: RequestBody = {}
  try {
    if (req.headers.get('content-type')?.includes('application/json')) body = await req.json()
  } catch { body = {} }
  const from = body.from ?? null
  const to = body.to ?? null
  const { prevFrom, prevTo } = prevRange(from, to)
  const hasRange = !!(from && to)

  try {
    const [totals, prevTotals, series, brJson, fnJson] = await Promise.all([
      overviewTotals(from, to),
      hasRange ? overviewTotals(prevFrom, prevTo) : Promise.resolve(null),
      overviewSeries(),
      supabase.rpc('trips_breakdowns_and_rates', { p_from: from, p_to: to }),
      supabase.rpc('trips_funnels', { p_from: from, p_to: to }),
    ])
    if (brJson.error) throw brJson.error
    if (fnJson.error) throw fnJson.error

    const overview: Record<string, Counter> = {}
    for (const k of OVERVIEW_KEYS) {
      overview[k] = {
        total: totals[k],
        prev: prevTotals ? prevTotals[k] : 0,
        series: series[k],
      }
    }

    const br = brJson.data ?? {}
    const fn = fnJson.data ?? {}

    return new Response(JSON.stringify({
      range: { from, to },
      prev_range: { from: prevFrom, to: prevTo },
      overview,
      breakdowns: {
        status: br.status ?? [],
        hosting_style: br.hosting_style ?? [],
        budget: br.budget ?? [],
        top_destinations: br.top_destinations ?? [],
      },
      lifecycle_funnel: fn.lifecycle ?? [],
      demand_funnel: fn.demand ?? [],
      rates: br.rates ?? {
        fill_rate_avg: null, pct_reached_full: null, cancellation_rate: null,
        approval_rate: null, ghost_trips: 0, median_response_hours: null,
      },
    }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    console.error('[analytics-trips] error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'internal error' }), { status: 500, headers: jsonHeaders })
  }
})
