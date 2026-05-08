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
  from?: string // ISO timestamp
  to?: string   // ISO timestamp
}

interface Counter {
  total: number
  in_range: number
  series: number[]   // daily counts, last 30 days, oldest -> newest. Length = SPARKLINE_DAYS.
}

interface DashboardResponse {
  metric_2: Counter   // users created
  metric_3: Counter   // onboarding phase 1
  metric_4: Counter   // full onboarding
  metric_5: Counter   // first Swelly search
  metric_6: Counter   // first Swelly match
  metric_7: Counter   // convos with 1+ message — bucketed by first-message timestamp
  metric_8: Counter   // both sides replied — bucketed by max(first-by-each-side) timestamp
  metric_9: Counter   // 4+ msgs each — bucketed by max(4th-by-each-side) timestamp
  metric_10: {
    with_surfer: Counter   // distinct user_ids in user_activity that have a non-demo surfer row
    auth_only:   Counter   // distinct user_ids in user_activity with NO surfers row at all
  }
  range: { from: string | null; to: string | null }
}

// Sparkline window — fixed regardless of selected chip. Shows recent trend independent of filter.
const SPARKLINE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/**
 * Bucket an array of ISO timestamp strings into daily counts for the last SPARKLINE_DAYS days.
 * Returns array of length SPARKLINE_DAYS, oldest day first.
 * Bucket index = days ago (0 = oldest, SPARKLINE_DAYS-1 = today).
 */
function bucketSeries(timestamps: string[]): number[] {
  const buckets = new Array<number>(SPARKLINE_DAYS).fill(0)
  // Anchor on today's UTC midnight to keep buckets stable across the function's runtime.
  const todayMidnight = new Date()
  todayMidnight.setUTCHours(0, 0, 0, 0)
  const cutoff = todayMidnight.getTime() - (SPARKLINE_DAYS - 1) * DAY_MS
  for (const ts of timestamps) {
    if (!ts) continue
    const t = new Date(ts).getTime()
    if (t < cutoff) continue
    const idx = Math.floor((t - cutoff) / DAY_MS)
    if (idx >= 0 && idx < SPARKLINE_DAYS) buckets[idx]++
  }
  return buckets
}

/**
 * Compare two ISO/Postgres timestamp strings as Dates (millisecond precision).
 * String comparison is unsafe because Postgres returns "+00:00" while frontends send "Z".
 */
function tsBetween(ts: string, fromMs: number | null, toMs: number | null): boolean {
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return false
  if (fromMs !== null && t < fromMs) return false
  if (toMs !== null && t > toMs) return false
  return true
}

function rangeMs(from: string | null, to: string | null): { fromMs: number | null; toMs: number | null } {
  return {
    fromMs: from ? new Date(from).getTime() : null,
    toMs: to ? new Date(to).getTime() : null,
  }
}

/**
 * Count + sparkline series for an event timestamp column on `surfers`.
 * Returns { total, in_range, series }.
 */
async function countSurferEvent(column: string, from: string | null, to: string | null): Promise<Counter> {
  // Fetch only rows with the column populated (non-demo, non-null). We then derive total/in_range/series in JS.
  const { data, error } = await supabase
    .from('surfers')
    .select(`${column}`)
    .eq('is_demo_user', false)
    .not(column, 'is', null)
  if (error) throw error
  const timestamps = (data ?? []).map((r: any) => r[column] as string)

  const total = timestamps.length
  let in_range = total
  if (from || to) {
    const { fromMs, toMs } = rangeMs(from, to)
    in_range = timestamps.filter(ts => tsBetween(ts, fromMs, toMs)).length
  }
  return { total, in_range, series: bucketSeries(timestamps) }
}

/**
 * Count + sparkline series for surfers.created_at. Always populated, so no IS NOT NULL guard.
 */
async function countSurfersCreated(from: string | null, to: string | null): Promise<Counter> {
  const { data, error } = await supabase
    .from('surfers')
    .select('created_at')
    .eq('is_demo_user', false)
  if (error) throw error
  const timestamps = (data ?? []).map((r: any) => r.created_at as string)

  const total = timestamps.length
  let in_range = total
  if (from || to) {
    const { fromMs, toMs } = rangeMs(from, to)
    in_range = timestamps.filter(ts => tsBetween(ts, fromMs, toMs)).length
  }
  return { total, in_range, series: bucketSeries(timestamps) }
}

/**
 * Convo activity metrics share an SQL function. We expose all three (7/8/9) via a single RPC.
 * To keep the edge function self-contained without an RPC, run a single SQL via execute_sql-ish pattern
 * — but since Supabase JS doesn't expose raw SQL, we issue the queries through a Postgres function.
 *
 * Simpler approach used here: call three SQL aggregations via PostgREST views/RPCs is overkill;
 * we use the rest API for the per-user message counts and aggregate in JS.
 *
 * That said — convo counts are O(convos), small dataset for now. We fetch conversation_members rows
 * for direct conversations involving an adv_seeker, plus a per-user message count, and bucket in JS.
 */
/**
 * Compute m7/m8/m9 with criterion-satisfied timestamps so they can be bucketed by from/to and
 * rendered as sparklines (matches the rest of the metrics).
 *
 * Per-convo "satisfied" timestamps:
 *   m7: earliest message timestamp (when the convo first had any message).
 *   m8: max(first-message-by-seeker, first-message-by-other) — both must exist; criterion
 *       met when the LATER first-message lands.
 *   m9: max(seeker_msgs[3].created_at, other_msgs[3].created_at) — both sides need ≥4.
 */
async function computeConvoMetrics(
  from: string | null,
  to: string | null,
): Promise<{ m7: Counter; m8: Counter; m9: Counter }> {
  // 1. Build the demo-user exclusion set once, in JS — sidesteps any cross-table PostgREST FK assumptions.
  const { data: demoRows, error: demoErr } = await supabase
    .from('surfers')
    .select('user_id')
    .eq('is_demo_user', true)
  if (demoErr) throw demoErr
  const demoSet = new Set<string>((demoRows ?? []).map(r => r.user_id))

  // 2. Pull all members of direct conversations.
  const { data: rows, error } = await supabase
    .from('conversation_members')
    .select('conversation_id, user_id, adv_role, conversations!inner ( is_direct )')
    .eq('conversations.is_direct', true)
  if (error) throw error

  const empty: Counter = { total: 0, in_range: 0, series: new Array<number>(SPARKLINE_DAYS).fill(0) }
  if (!rows) return { m7: empty, m8: empty, m9: empty }

  // 3. Group members by conversation. Only keep convos where:
  //    - one member has adv_role='adv_seeker' (= came from Swelly)
  //    - the other member exists (direct = exactly 2 members)
  //    - neither member is a demo user
  const byConvo = new Map<string, { seeker: string | null; other: string | null; hasDemo: boolean }>()
  for (const r of rows as any[]) {
    const cid = r.conversation_id as string
    const entry = byConvo.get(cid) ?? { seeker: null, other: null, hasDemo: false }
    if (demoSet.has(r.user_id)) entry.hasDemo = true
    if (r.adv_role === 'adv_seeker') entry.seeker = r.user_id
    else entry.other = r.user_id
    byConvo.set(cid, entry)
  }
  const swellyConvoIds: { id: string; seeker: string; other: string }[] = []
  for (const [cid, v] of byConvo) {
    if (v.seeker && v.other && !v.hasDemo) swellyConvoIds.push({ id: cid, seeker: v.seeker, other: v.other })
  }
  if (swellyConvoIds.length === 0) return { m7: empty, m8: empty, m9: empty }

  // 4. Fetch all messages in those convos (ordered ascending) so we can pick by sender + position.
  const ids = swellyConvoIds.map(c => c.id)
  const { data: msgs, error: msgErr } = await supabase
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .in('conversation_id', ids)
    .eq('deleted', false)
    .eq('is_system', false)
    .order('created_at', { ascending: true })
  if (msgErr) throw msgErr

  // Group messages by conversation, splitting per sender side.
  // We rely on the ascending order from the query so seekerMsgs[k] / otherMsgs[k] are time-sorted.
  const grouped = new Map<string, { seeker: string[]; other: string[] }>()
  for (const c of swellyConvoIds) grouped.set(c.id, { seeker: [], other: [] })
  for (const m of msgs ?? []) {
    const g = grouped.get(m.conversation_id)
    if (!g) continue
    const c = swellyConvoIds.find(x => x.id === m.conversation_id)!
    if (m.sender_id === c.seeker) g.seeker.push(m.created_at as string)
    else if (m.sender_id === c.other) g.other.push(m.created_at as string)
  }

  // Helper: max of two ISO timestamps.
  const laterOf = (a: string, b: string) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b)

  // Per-metric arrays of "criterion satisfied" timestamps (one per qualifying convo).
  const ts7: string[] = []
  const ts8: string[] = []
  const ts9: string[] = []

  for (const c of swellyConvoIds) {
    const g = grouped.get(c.id)
    if (!g) continue
    const sk = g.seeker
    const ot = g.other
    const allMsgs = sk.length + ot.length

    if (allMsgs >= 1) {
      // Earliest message overall — sk[0] and ot[0] are each side's earliest, take the lesser.
      const candidates = [sk[0], ot[0]].filter(Boolean) as string[]
      const earliest = candidates.reduce((a, b) =>
        new Date(a).getTime() <= new Date(b).getTime() ? a : b,
      )
      ts7.push(earliest)
    }
    if (sk.length >= 1 && ot.length >= 1) ts8.push(laterOf(sk[0], ot[0]))
    if (sk.length >= 4 && ot.length >= 4) ts9.push(laterOf(sk[3], ot[3]))
  }

  const buildCounter = (timestamps: string[]): Counter => {
    const total = timestamps.length
    let in_range = total
    if (from || to) {
      const { fromMs, toMs } = rangeMs(from, to)
      in_range = timestamps.filter(ts => tsBetween(ts, fromMs, toMs)).length
    }
    return { total, in_range, series: bucketSeries(timestamps) }
  }

  return {
    m7: buildCounter(ts7),
    m8: buildCounter(ts8),
    m9: buildCounter(ts9),
  }
}

/**
 * Active users — splits into two buckets based on whether the user_activity row's user_id
 * matches a non-demo `surfers` row:
 *   with_surfer: real users with a completed surfer profile (the "true" funnel number)
 *   auth_only:   accounts that opened the app but never created a surfer row (incomplete signups)
 *
 * `total` = ever opened, `in_range` = last_seen_at within [from, to].
 *
 * Caveat: last_seen_at is the MOST RECENT activity only (no history). So this only works for
 * "since X" ranges (which all dashboard chips are). It cannot answer "active during a closed past
 * window" (e.g. only March 1–31) — a user active March 15 but again on April 5 has last_seen=April 5
 * and would be excluded from a March-only range. The current chips never produce such ranges.
 */
async function countActiveUsers(
  from: string | null,
  to: string | null,
): Promise<{ with_surfer: Counter; auth_only: Counter }> {
  // Build classification sets once: which user_ids belong to demo / non-demo / no-surfer-at-all.
  const { data: surferRows, error: sErr } = await supabase
    .from('surfers')
    .select('user_id, is_demo_user')
  if (sErr) throw sErr
  const demoSet = new Set<string>()
  const nonDemoSet = new Set<string>()
  for (const s of surferRows ?? []) {
    if (s.is_demo_user) demoSet.add(s.user_id)
    else nonDemoSet.add(s.user_id)
  }

  const { data: allRows, error: allErr } = await supabase
    .from('user_activity')
    .select('user_id, last_seen_at')
  if (allErr) throw allErr

  const withSurferTotal = new Set<string>()
  const withSurferInRange = new Set<string>()
  const authOnlyTotal = new Set<string>()
  const authOnlyInRange = new Set<string>()

  // Also collect last_seen_at timestamps per bucket for sparkline data.
  // Distinct user per bucket day (so a user opening the app twice on the same day counts once for that day).
  const withSurferDayUsers = new Map<number, Set<string>>()  // dayIdx -> set of user_ids
  const authOnlyDayUsers = new Map<number, Set<string>>()

  const todayMidnight = new Date()
  todayMidnight.setUTCHours(0, 0, 0, 0)
  const cutoff = todayMidnight.getTime() - (SPARKLINE_DAYS - 1) * DAY_MS

  const { fromMs, toMs } = rangeMs(from, to)

  for (const row of allRows ?? []) {
    if (demoSet.has(row.user_id)) continue
    const isWithSurfer = nonDemoSet.has(row.user_id)
    const inRange = tsBetween(row.last_seen_at, fromMs, toMs)

    if (isWithSurfer) {
      withSurferTotal.add(row.user_id)
      if (inRange) withSurferInRange.add(row.user_id)
    } else {
      authOnlyTotal.add(row.user_id)
      if (inRange) authOnlyInRange.add(row.user_id)
    }

    // Sparkline bucket — last_seen_at relative to today.
    const t = new Date(row.last_seen_at).getTime()
    if (t < cutoff) continue
    const idx = Math.floor((t - cutoff) / DAY_MS)
    if (idx < 0 || idx >= SPARKLINE_DAYS) continue
    const map = isWithSurfer ? withSurferDayUsers : authOnlyDayUsers
    let s = map.get(idx)
    if (!s) { s = new Set(); map.set(idx, s) }
    s.add(row.user_id)
  }

  const seriesFrom = (m: Map<number, Set<string>>) => {
    const arr = new Array<number>(SPARKLINE_DAYS).fill(0)
    for (const [idx, s] of m) arr[idx] = s.size
    return arr
  }

  const allTime = !from && !to
  return {
    with_surfer: {
      total: withSurferTotal.size,
      in_range: allTime ? withSurferTotal.size : withSurferInRange.size,
      series: seriesFrom(withSurferDayUsers),
    },
    auth_only: {
      total: authOnlyTotal.size,
      in_range: allTime ? authOnlyTotal.size : authOnlyInRange.size,
      series: seriesFrom(authOnlyDayUsers),
    },
  }
}

async function isAdmin(jwt: string): Promise<{ ok: true; userId: string } | { ok: false; status: number; reason: string }> {
  // Validate the JWT and extract the user ID. We use a separate client bound to the caller's token.
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  // Auth
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401, headers: jsonHeaders })
  }
  const jwt = authHeader.slice(7).trim()
  const adminCheck = await isAdmin(jwt)
  if (!adminCheck.ok) {
    return new Response(JSON.stringify({ error: adminCheck.reason }), { status: adminCheck.status, headers: jsonHeaders })
  }

  // Body
  let body: RequestBody = {}
  try {
    if (req.headers.get('content-type')?.includes('application/json')) body = await req.json()
  } catch {
    body = {}
  }
  const from = body.from ?? null
  const to = body.to ?? null

  try {
    const [m2, m3, m4, m5, m6, convo, m10] = await Promise.all([
      countSurfersCreated(from, to),
      countSurferEvent('onboarding_phase1_completed_at', from, to),
      countSurferEvent('onboarding_completed_at', from, to),
      countSurferEvent('swelly_first_search_at', from, to),
      countSurferEvent('swelly_first_match_at', from, to),
      computeConvoMetrics(from, to),
      countActiveUsers(from, to),
    ])

    const response: DashboardResponse = {
      metric_2: m2,
      metric_3: m3,
      metric_4: m4,
      metric_5: m5,
      metric_6: m6,
      metric_7: convo.m7,
      metric_8: convo.m8,
      metric_9: convo.m9,
      metric_10: m10,
      range: { from, to },
    }
    return new Response(JSON.stringify(response), { status: 200, headers: jsonHeaders })
  } catch (e) {
    console.error('[analytics-dashboard] error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'internal error' }), { status: 500, headers: jsonHeaders })
  }
})
