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

interface RequestBody {
  from?: string | null
  to?: string | null
}

interface Counter {
  total: number       // count within selected range (all-time if from/to both null)
  prev: number        // count within the equivalent prior range (0 if no range provided)
  series: number[]    // daily counts for last SPARKLINE_DAYS days, oldest -> newest
}

const EVENT_NAMES = [
  'user_signed_up',
  'onboarding_step_1',
  'onboarding_step_2',
  'onboarding_step_3',
  'onboarding_step_4',
  'onboarding_step_5',
  'onboarding_step_6',
  'onboarding_step_7',
  'onboarding_finalized',
  'swelly_search_clicked',
  'swelly_connect_clicked',
  'first_message_sent',
  'conversation_two_sided',
  'conversation_deep_engaged',
  'app_opened',
] as const
type EventName = typeof EVENT_NAMES[number]

// Events that can repeat per user — dashboard counts distinct users (not total rows).
const DISTINCT_EVENTS: ReadonlySet<EventName> = new Set([
  'app_opened',
  'swelly_search_clicked',
  'swelly_connect_clicked',
])

const SPARKLINE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})


// ---------- helpers ----------

function isoMs(s: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

/** Compute the equivalent prior range. (to-from) duration shifted back, ending at `from`. */
function prevRange(from: string | null, to: string | null): { prevFrom: string | null; prevTo: string | null } {
  const fromMs = isoMs(from)
  const toMs = isoMs(to)
  if (fromMs === null || toMs === null) return { prevFrom: null, prevTo: null }
  const L = toMs - fromMs
  return {
    prevFrom: new Date(fromMs - L).toISOString(),
    prevTo: new Date(fromMs).toISOString(),
  }
}

/** COUNT(*) for one-shot events in a range, excluding demo/admin. */
async function countEvent(name: EventName, from: string | null, to: string | null): Promise<number> {
  let q = supabase
    .from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_name', name)
    .eq('is_demo_user', false)
    .eq('is_admin', false)
  if (from) q = q.gte('occurred_at', from)
  if (to)   q = q.lt('occurred_at', to)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

/** COUNT(DISTINCT user_id) for repeatable events via the SQL RPC defined in the migration. */
async function countDistinctUsers(name: EventName, from: string | null, to: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('count_distinct_users_event', {
    p_event: name,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data) || 0
}

/** Dispatch: distinct for repeatable events, plain count otherwise. */
async function countFor(name: EventName, from: string | null, to: string | null): Promise<number> {
  return DISTINCT_EVENTS.has(name)
    ? countDistinctUsers(name, from, to)
    : countEvent(name, from, to)
}

/**
 * Fetch event rows for the last SPARKLINE_DAYS days and bucket into daily counts.
 * For DISTINCT events, dedupes per day (user counted once per day).
 */
async function seriesFor(name: EventName): Promise<number[]> {
  const todayMidnight = new Date()
  todayMidnight.setUTCHours(0, 0, 0, 0)
  const cutoffMs = todayMidnight.getTime() - (SPARKLINE_DAYS - 1) * DAY_MS
  const cutoffIso = new Date(cutoffMs).toISOString()

  const distinct = DISTINCT_EVENTS.has(name)
  const select = distinct ? 'occurred_at, user_id' : 'occurred_at'

  const { data, error } = await supabase
    .from('analytics_events')
    .select(select)
    .eq('event_name', name)
    .eq('is_demo_user', false)
    .eq('is_admin', false)
    .gte('occurred_at', cutoffIso)
  if (error) throw error

  const buckets = new Array<number>(SPARKLINE_DAYS).fill(0)
  if (distinct) {
    const perDay = new Map<number, Set<string>>()
    for (const row of (data ?? []) as Array<{ occurred_at: string; user_id: string | null }>) {
      const t = new Date(row.occurred_at).getTime()
      if (Number.isNaN(t)) continue
      const idx = Math.floor((t - cutoffMs) / DAY_MS)
      if (idx < 0 || idx >= SPARKLINE_DAYS) continue
      if (!row.user_id) continue
      let s = perDay.get(idx)
      if (!s) { s = new Set(); perDay.set(idx, s) }
      s.add(row.user_id)
    }
    for (const [idx, s] of perDay) buckets[idx] = s.size
  } else {
    for (const row of (data ?? []) as Array<{ occurred_at: string }>) {
      const t = new Date(row.occurred_at).getTime()
      if (Number.isNaN(t)) continue
      const idx = Math.floor((t - cutoffMs) / DAY_MS)
      if (idx >= 0 && idx < SPARKLINE_DAYS) buckets[idx]++
    }
  }
  return buckets
}


// ---------- auth ----------

async function isAdmin(jwt: string): Promise<{ ok: true; userId: string } | { ok: false; status: number; reason: string }> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error } = await userClient.auth.getUser(jwt)
  if (error || !user) return { ok: false, status: 401, reason: 'invalid token' }
  const { data, error: roleErr } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (roleErr) return { ok: false, status: 500, reason: 'role lookup failed' }
  if (!data || data.role !== 'admin') return { ok: false, status: 403, reason: 'not an admin' }
  return { ok: true, userId: user.id }
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
  const jwt = authHeader.slice(7).trim()
  const adminCheck = await isAdmin(jwt)
  if (!adminCheck.ok) {
    return new Response(JSON.stringify({ error: adminCheck.reason }), { status: adminCheck.status, headers: jsonHeaders })
  }

  let body: RequestBody = {}
  try {
    if (req.headers.get('content-type')?.includes('application/json')) body = await req.json()
  } catch {
    body = {}
  }
  const from = body.from ?? null
  const to = body.to ?? null
  const { prevFrom, prevTo } = prevRange(from, to)
  const hasRange = !!(from && to)

  try {
    // For each event: compute total in range, prev in prior range, series for last 30d.
    // Series and counts share the underlying table — three round-trips per event in the
    // worst case, but they're tiny indexed queries, run in parallel below.
    const results = await Promise.all(
      EVENT_NAMES.map(async (name) => {
        const [total, prev, series] = await Promise.all([
          countFor(name, from, to),
          hasRange ? countFor(name, prevFrom, prevTo) : Promise.resolve(0),
          seriesFor(name),
        ])
        return [name, { total, prev, series } as Counter] as const
      }),
    )

    const metrics: Record<string, Counter> = {}
    for (const [name, counter] of results) metrics[name] = counter

    return new Response(JSON.stringify({
      range: { from, to },
      prev_range: { from: prevFrom, to: prevTo },
      metrics,
    }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    console.error('[analytics-dashboard] error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'internal error' }), { status: 500, headers: jsonHeaders })
  }
})
