// Manual one-shot blast: announce group trips to every surfer who has an Expo
// push token. Triggered by hand (curl / Supabase dashboard).
//
// Distinct from `notify-onboarding-blast`, which targets only surfers who have
// NOT finished onboarding. This one targets EVERY device with a token.
//
// SAFETY: `dry_run` defaults to TRUE. The only way to actually reach Expo is to
// explicitly pass {"dry_run": false}. An accidental re-run of a shell command
// sends nothing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

const TITLE = "Group trips are here \u{1F30A}"
const BODY = "Find a trip to join, or create your own."
// No tripId / conversationId: AppContent's tap router falls through both
// branches and the app simply opens. Intentional — see the design doc.
const DATA = { type: 'announcement', source: 'group_trips_blast' }
const BATCH_SIZE = 100
// Legacy rows hold raw 64-char-hex APNs device tokens instead of Expo tokens
// (written by older client code; the client now only calls getExpoPushTokenAsync).
// Expo rejects them. Same prefix check dispatch-notification-queue uses.
const EXPO_TOKEN_PREFIX = 'ExponentPushToken'

interface Candidate {
  user_id: string
  expo_push_token: string
}

interface Body {
  dry_run?: boolean
  only_user_id?: string
}

serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8)

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Operator-only. Accept a service-role bearer OR x-internal-secret, same as
  // dispatch-notification-queue. Fails closed: an unset ADMIN_FUNCTION_SECRET
  // cannot be matched by an empty header.
  {
    const authHeader = req.headers.get('Authorization') || ''
    const bearerOk = SUPABASE_SERVICE_ROLE_KEY.length > 0 && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    const provided = req.headers.get('x-internal-secret') || ''
    const expected = Deno.env.get('ADMIN_FUNCTION_SECRET') || ''
    const secretOk = expected.length > 0 && provided === expected
    if (!bearerOk && !secretOk) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // dry_run defaults to true — an empty body is a dry run, not a blast.
  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch (_) { /* empty body → dry run */ }
  const dryRun = body.dry_run !== false
  const onlyUserId = body.only_user_id ?? null

  console.log(`[GTBlast] [${requestId}] start dry_run=${dryRun} only_user_id=${onlyUserId ?? '-'}`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let query = supabase
    .from('surfers')
    .select('user_id, expo_push_token')
    .not('expo_push_token', 'is', null)
  if (onlyUserId) query = query.eq('user_id', onlyUserId)

  const { data: rows, error } = await query
  if (error) {
    console.error(`[GTBlast] [${requestId}] Query error:`, error)
    return new Response(JSON.stringify({ error: error.message, request_id: requestId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // A push token can be attached to MULTIPLE surfer rows (logout/login, demo
  // accounts, test accounts). Sending per-row would deliver the same
  // notification 2-3x to the same physical device. Collapse to one send per
  // distinct token; first row wins.
  const allRows = (rows ?? []) as Candidate[]
  const byToken = new Map<string, Candidate>()
  for (const r of allRows) {
    if (!byToken.has(r.expo_push_token)) byToken.set(r.expo_push_token, r)
  }
  const devices = [...byToken.values()]

  // Partition: Expo can only deliver to ExponentPushToken[...]. Posting the
  // legacy raw-APNs tokens would just return 17 error tickets, muddying the
  // sent/errors counts. Skip them from the send and clear them alongside the
  // stale tokens — a dead token is worse than no token, because the client
  // only re-registers when it finds none.
  const candidates = devices.filter((c) => c.expo_push_token.startsWith(EXPO_TOKEN_PREFIX))
  const malformed = devices.filter((c) => !c.expo_push_token.startsWith(EXPO_TOKEN_PREFIX))
  console.log(
    `[GTBlast] [${requestId}] rows=${allRows.length} devices=${devices.length} deliverable=${candidates.length} malformed=${malformed.length}`,
  )

  if (dryRun) {
    return new Response(
      JSON.stringify({
        request_id: requestId,
        dry_run: true,
        rows_matched: allRows.length,
        distinct_devices: devices.length,
        duplicates_collapsed: allRows.length - devices.length,
        devices_to_notify: candidates.length,
        malformed_tokens_skipped: malformed.length,
        message: { title: TITLE, body: BODY, data: DATA },
        sample_tokens: candidates.slice(0, 5).map((c) => c.expo_push_token),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let sent = 0
  let errors = 0
  // Dead on arrival: never posted to Expo, cleared below with the stale ones.
  const staleTokens: string[] = malformed.map((c) => c.expo_push_token)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EXPO_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const messages = batch.map((c) => ({
      to: c.expo_push_token,
      title: TITLE,
      body: BODY,
      sound: 'default',
      data: DATA,
    }))

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '<no body>')
        console.error(`[GTBlast] [${requestId}] Expo API ${response.status}:`, errBody)
        errors += batch.length
        continue
      }

      const result = await response.json()
      // Expo returns tickets index-aligned with the messages we posted.
      const tickets = (result.data ?? []) as { status?: string; details?: { error?: string } }[]

      for (let j = 0; j < batch.length; j++) {
        const ticket = tickets[j]
        if (!ticket) {
          errors += 1
          continue
        }
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            staleTokens.push(batch[j].expo_push_token)
          }
          errors += 1
        } else {
          sent += 1
        }
      }
    } catch (err) {
      console.error(`[GTBlast] [${requestId}] Batch failed:`, err)
      errors += batch.length
    }
  }

  // Self-heal: a token the device no longer honors is dead for every future push.
  if (staleTokens.length > 0) {
    console.log(`[GTBlast] [${requestId}] Clearing ${staleTokens.length} stale tokens`)
    const { error: clearError } = await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .in('expo_push_token', staleTokens)
    if (clearError) {
      console.error(`[GTBlast] [${requestId}] Stale token cleanup failed:`, clearError)
    }
  }

  console.log(
    `[GTBlast] [${requestId}] done deliverable=${candidates.length} sent=${sent} errors=${errors} tokens_cleared=${staleTokens.length}`,
  )

  return new Response(
    JSON.stringify({
      request_id: requestId,
      dry_run: false,
      distinct_devices: devices.length,
      deliverable: candidates.length,
      malformed_skipped: malformed.length,
      sent,
      errors,
      tokens_cleared: staleTokens.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
