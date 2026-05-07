// Manual one-shot blast: notify every surfer who has not finished onboarding
// and has an Expo push token. Triggered by hand from Supabase SQL editor.
// Distinct from `notify-abandoned-onboarding`, which runs hourly and respects
// 1h/24h/7d windows + per-window idempotency columns.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

const TITLE = "Don't miss out \u{1F30A}"
const BODY = "Finish your profile in 2 minutes and start matching with surfers."
const BATCH_SIZE = 100

interface Candidate {
  user_id: string
  expo_push_token: string
}

serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8)
  console.log(`[Blast] [${requestId}] Invocation start`)

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // A device's push token can be attached to MULTIPLE surfer rows over time
  // (logout/login, demo accounts, test accounts). If ANY of those rows has
  // finished_onboarding=true, the device-owner has finished — don't blast.
  const { data: finishedRows, error: finishedErr } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('finished_onboarding', true)
    .not('expo_push_token', 'is', null)
  if (finishedErr) {
    console.error(`[Blast] [${requestId}] Tainted-token query error:`, finishedErr)
    return new Response(JSON.stringify({ error: finishedErr.message, request_id: requestId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const tainted = new Set((finishedRows as { expo_push_token: string }[]).map(r => r.expo_push_token))

  const { data: rows, error } = await supabase
    .from('surfers')
    .select('user_id, expo_push_token')
    .eq('finished_onboarding', false)
    .not('expo_push_token', 'is', null)

  if (error) {
    console.error(`[Blast] [${requestId}] Query error:`, error)
    return new Response(JSON.stringify({ error: error.message, request_id: requestId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const allCandidates = (rows ?? []) as Candidate[]
  const candidates = allCandidates.filter(c => !tainted.has(c.expo_push_token))
  console.log(
    `[Blast] [${requestId}] All unfinished w/ token: ${allCandidates.length}, after tainted filter: ${candidates.length} (excluded ${allCandidates.length - candidates.length})`,
  )

  if (candidates.length === 0) {
    return new Response(
      JSON.stringify({ request_id: requestId, found: 0, sent: 0, errors: 0, stale_cleared: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let sent = 0
  let errors = 0
  const staleTokens: string[] = []

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EXPO_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const messages = batch.map((c) => ({
      to: c.expo_push_token,
      title: TITLE,
      body: BODY,
      sound: 'default',
      data: { type: 'onboarding_reminder', source: 'manual_blast' },
    }))

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '<no body>')
        console.error(`[Blast] [${requestId}] Expo API ${response.status}:`, errBody)
        errors += batch.length
        continue
      }

      const result = await response.json()
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
      console.error(`[Blast] [${requestId}] Batch failed:`, err)
      errors += batch.length
    }
  }

  if (staleTokens.length > 0) {
    console.log(`[Blast] [${requestId}] Clearing ${staleTokens.length} stale tokens`)
    const { error: clearError } = await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .in('expo_push_token', staleTokens)
    if (clearError) {
      console.error(`[Blast] [${requestId}] Stale token cleanup failed:`, clearError)
    }
  }

  console.log(
    `[Blast] [${requestId}] Done — found=${candidates.length}, sent=${sent}, errors=${errors}, stale_cleared=${staleTokens.length}`,
  )

  return new Response(
    JSON.stringify({
      request_id: requestId,
      found: candidates.length,
      sent,
      errors,
      stale_cleared: staleTokens.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
