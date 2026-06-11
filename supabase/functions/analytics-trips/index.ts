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
  from?: string | null  // ISO timestamp — used ONLY by the adoption chart
  to?: string | null    // ISO timestamp — used ONLY by the adoption chart
}

const RETENTION_BUCKETS = [0, 1, 3, 7, 14, 30] as const
const HEALTH_BUCKETS = [0, 1, 3, 7, 14, 21, 30] as const

// Adoption features, in display order.
const ADOPTION_FEATURES = [
  'trip_chat_opened',
  'trip_commit',
  'trip_gear_claim',
  'trip_personal_gear',
  'trip_gear_request',
  'trip_invite_shared',
  'trip_admin_update',
  'trip_gear_added',
  'trip_gear_suggestion',
  'trip_join_decision',
] as const

// Events that signal "this user touched this trip today" for retention-style charts.
const TRIP_ACTIVITY_EVENTS = ['trip_opened', 'trip_chat_opened'] as const

const DAY_MS = 24 * 60 * 60 * 1000
// Data volume is tiny (~13 trips, ~22 participants, <1000 events) — we fetch raw
// rows and compute in TypeScript. The explicit limit just guards against the
// PostgREST default row cap silently truncating results as data grows.
const ROW_LIMIT = 10000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})


// ---------- helpers ----------

/** UTC midnight (ms) of the calendar day containing `t`. */
function utcDay(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS
}

function parseMs(s: string | null | undefined): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

/** Parse a DATE column ('YYYY-MM-DD') as UTC midnight ms. */
function parseDateMs(s: string | null | undefined): number | null {
  if (!s) return null
  const t = new Date(`${s}T00:00:00Z`).getTime()
  return Number.isNaN(t) ? null : t
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


// ---------- raw data fetchers ----------

interface ParticipantRow {
  trip_id: string
  user_id: string
  role: 'host' | 'member'
  joined_at: string
}

interface TripRow {
  id: string
  title: string | null
  status: string
  end_date: string | null
  participant_count: number | null
  created_at: string
}

interface EventRow {
  event_name: string
  user_id: string | null
  trip_id: string | null
  occurred_at: string
}

async function fetchParticipants(): Promise<ParticipantRow[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('trip_id, user_id, role, joined_at')
    .limit(ROW_LIMIT)
  if (error) throw error
  return (data ?? []) as ParticipantRow[]
}

async function fetchTrips(): Promise<TripRow[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('id, title, status, end_date, participant_count, created_at')
    .limit(ROW_LIMIT)
  if (error) throw error
  return (data ?? []) as TripRow[]
}

/**
 * Resolve which participant user_ids are demo or admin users.
 * The participants table has no flags, so we look at `surfers`
 * (is_demo_user + is_admin — the latter kept in sync with users.role
 * by a trigger) and double-check users.role = 'admin' directly for
 * anyone without a surfers row.
 */
async function fetchExcludedUserIds(userIds: string[]): Promise<Set<string>> {
  const excluded = new Set<string>()
  if (userIds.length === 0) return excluded

  const [{ data: surferRows, error: surferErr }, { data: adminRows, error: adminErr }] = await Promise.all([
    supabase
      .from('surfers')
      .select('user_id, is_demo_user, is_admin')
      .in('user_id', userIds)
      .limit(ROW_LIMIT),
    supabase
      .from('users')
      .select('id')
      .in('id', userIds)
      .eq('role', 'admin')
      .limit(ROW_LIMIT),
  ])
  if (surferErr) throw surferErr
  if (adminErr) throw adminErr

  for (const row of (surferRows ?? []) as Array<{ user_id: string; is_demo_user: boolean | null; is_admin: boolean | null }>) {
    if (row.is_demo_user || row.is_admin) excluded.add(row.user_id)
  }
  for (const row of (adminRows ?? []) as Array<{ id: string }>) {
    excluded.add(row.id)
  }
  return excluded
}

/** Events of the given names, excluding demo/admin rows (flags live on the event itself). */
async function fetchEvents(
  names: readonly string[],
  opts: { from?: string | null; to?: string | null } = {},
): Promise<EventRow[]> {
  let q = supabase
    .from('analytics_events')
    .select('event_name, user_id, trip_id, occurred_at')
    .in('event_name', names as string[])
    .eq('is_demo_user', false)
    .eq('is_admin', false)
    .limit(ROW_LIMIT)
  if (opts.from) q = q.gte('occurred_at', opts.from)
  if (opts.to) q = q.lt('occurred_at', opts.to)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as EventRow[]
}


// ---------- chart 1: retention ----------

interface RetentionPoint { day: number; active: number; eligible: number }

function computeRetention(
  participants: ParticipantRow[],
  excluded: Set<string>,
  appOpenedEvents: EventRow[],
  todayMs: number,
): {
  buckets: number[]
  joiners: RetentionPoint[]
  hosts: RetentionPoint[]
  totals: { joiners: number; hosts: number }
} {
  // Each user's day-0 = their EARLIEST joined_at; their group = role on that row.
  // `day0` holds the raw joined_at ms so ties resolve by true earliest row;
  // it's converted to a UTC calendar day below.
  const firstJoin = new Map<string, { day0: number; role: 'host' | 'member' }>()
  for (const p of participants) {
    if (excluded.has(p.user_id)) continue
    const t = parseMs(p.joined_at)
    if (t === null) continue
    const existing = firstJoin.get(p.user_id)
    if (!existing || t < existing.day0) {
      firstJoin.set(p.user_id, { day0: t, role: p.role })
    }
  }

  // Per-user set of UTC days with an app_opened event.
  const appDays = new Map<string, Set<number>>()
  for (const e of appOpenedEvents) {
    if (!e.user_id) continue
    const t = parseMs(e.occurred_at)
    if (t === null) continue
    let s = appDays.get(e.user_id)
    if (!s) { s = new Set(); appDays.set(e.user_id, s) }
    s.add(utcDay(t))
  }

  const groups: Record<'joiners' | 'hosts', RetentionPoint[]> = {
    joiners: RETENTION_BUCKETS.map((day) => ({ day, active: 0, eligible: 0 })),
    hosts: RETENTION_BUCKETS.map((day) => ({ day, active: 0, eligible: 0 })),
  }
  const totals = { joiners: 0, hosts: 0 }

  for (const [userId, { day0, role }] of firstJoin) {
    const group = role === 'host' ? 'hosts' : 'joiners'
    totals[group]++
    const day0Utc = utcDay(day0)
    const userDays = appDays.get(userId)
    for (let i = 0; i < RETENTION_BUCKETS.length; i++) {
      const target = day0Utc + RETENTION_BUCKETS[i] * DAY_MS
      if (target > todayMs) continue // not eligible yet
      groups[group][i].eligible++
      if (userDays?.has(target)) groups[group][i].active++
    }
  }

  return {
    buckets: [...RETENTION_BUCKETS],
    joiners: groups.joiners,
    hosts: groups.hosts,
    totals,
  }
}


// ---------- chart 2: feature adoption ----------

function computeAdoption(
  participants: ParticipantRow[],
  excluded: Set<string>,
  featureEvents: EventRow[],
  from: string | null,
  to: string | null,
): {
  range: { from: string | null; to: string | null }
  features: { key: string; joiners: { used: number; denom: number }; hosts: { used: number; denom: number } }[]
} {
  // A user counts in hosts if they have ANY host row, in joiners if ANY member row (can be both).
  const hostUsers = new Set<string>()
  const joinerUsers = new Set<string>()
  for (const p of participants) {
    if (excluded.has(p.user_id)) continue
    if (p.role === 'host') hostUsers.add(p.user_id)
    else joinerUsers.add(p.user_id)
  }

  // event_name -> set of distinct users who fired it (events already range-filtered).
  const usersByEvent = new Map<string, Set<string>>()
  for (const e of featureEvents) {
    if (!e.user_id) continue
    let s = usersByEvent.get(e.event_name)
    if (!s) { s = new Set(); usersByEvent.set(e.event_name, s) }
    s.add(e.user_id)
  }

  const countUsed = (cohort: Set<string>, eventUsers: Set<string> | undefined): number => {
    if (!eventUsers) return 0
    let n = 0
    for (const u of cohort) if (eventUsers.has(u)) n++
    return n
  }

  return {
    range: { from, to },
    features: ADOPTION_FEATURES.map((key) => {
      const eventUsers = usersByEvent.get(key)
      return {
        key,
        joiners: { used: countUsed(joinerUsers, eventUsers), denom: joinerUsers.size },
        hosts: { used: countUsed(hostUsers, eventUsers), denom: hostUsers.size },
      }
    }),
  }
}


// ---------- chart 3: trip health ----------

type TripTag = 'alive' | 'cooling' | 'dead' | 'completed'

interface TripHealthRow {
  trip_id: string
  title: string | null
  crew: number
  created_at: string
  days: { day: number; active: number | null }[]
  tag: TripTag
  last7_active: number
}

function computeHealth(
  trips: TripRow[],
  tripActivityEvents: EventRow[],
  todayMs: number,
): { buckets: number[]; trips: TripHealthRow[] } {
  // trip_id -> (UTC day -> set of distinct active users that day)
  const activityByTrip = new Map<string, Map<number, Set<string>>>()
  for (const e of tripActivityEvents) {
    if (!e.trip_id || !e.user_id) continue
    const t = parseMs(e.occurred_at)
    if (t === null) continue
    const day = utcDay(t)
    let byDay = activityByTrip.get(e.trip_id)
    if (!byDay) { byDay = new Map(); activityByTrip.set(e.trip_id, byDay) }
    let users = byDay.get(day)
    if (!users) { users = new Set(); byDay.set(day, users) }
    users.add(e.user_id)
  }

  const last7CutoffMs = todayMs - 6 * DAY_MS // last 7 calendar days, inclusive of today

  const rows: TripHealthRow[] = trips.map((trip) => {
    const crew = trip.participant_count ?? 0
    const createdDay = utcDay(parseMs(trip.created_at) ?? 0)
    const byDay = activityByTrip.get(trip.id)

    const days = HEALTH_BUCKETS.map((day) => {
      const target = createdDay + day * DAY_MS
      if (target > todayMs) return { day, active: null } // still in the future for this trip
      return { day, active: byDay?.get(target)?.size ?? 0 }
    })

    // Distinct users active over the last 7 calendar days.
    const last7Users = new Set<string>()
    if (byDay) {
      for (const [day, users] of byDay) {
        if (day >= last7CutoffMs && day <= todayMs) {
          for (const u of users) last7Users.add(u)
        }
      }
    }
    const last7Active = last7Users.size

    const endDateMs = parseDateMs(trip.end_date)
    let tag: TripTag
    if (trip.status !== 'active' || (endDateMs !== null && endDateMs < todayMs)) {
      tag = 'completed'
    } else if (last7Active === 0) {
      tag = 'dead'
    } else if (last7Active >= 0.4 * crew) {
      tag = 'alive'
    } else {
      tag = 'cooling'
    }

    return {
      trip_id: trip.id,
      title: trip.title ?? null,
      crew,
      created_at: trip.created_at,
      days,
      tag,
      last7_active: last7Active,
    }
  })

  const tagOrder: Record<TripTag, number> = { alive: 0, cooling: 1, dead: 2, completed: 3 }
  rows.sort((a, b) => tagOrder[a.tag] - tagOrder[b.tag] || b.crew - a.crew)

  return { buckets: [...HEALTH_BUCKETS], trips: rows }
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
  // Range applies ONLY to the adoption chart; retention and health ignore it.
  const from = body.from ?? null
  const to = body.to ?? null

  try {
    const todayMs = utcDay(Date.now())

    const [participants, trips] = await Promise.all([fetchParticipants(), fetchTrips()])
    const cohortUserIds = [...new Set(participants.map((p) => p.user_id))]

    const [excluded, appOpenedEvents, featureEvents, tripActivityEvents] = await Promise.all([
      fetchExcludedUserIds(cohortUserIds),
      fetchEvents(['app_opened']),
      fetchEvents(ADOPTION_FEATURES, { from, to }),
      fetchEvents(TRIP_ACTIVITY_EVENTS),
    ])

    const payload = {
      retention: computeRetention(participants, excluded, appOpenedEvents, todayMs),
      adoption: computeAdoption(participants, excluded, featureEvents, from, to),
      health: computeHealth(trips, tripActivityEvents, todayMs),
    }

    return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders })
  } catch (e) {
    console.error('[analytics-trips] error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'internal error' }), { status: 500, headers: jsonHeaders })
  }
})
