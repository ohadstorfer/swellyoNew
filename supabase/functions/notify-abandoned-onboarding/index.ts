import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

type ReminderKey = '1h' | '24h' | '7d'

interface ReminderConfig {
  key: ReminderKey
  column: string
  // Inclusive lower bound: created_at must be older than this.
  olderThan: string
  // Exclusive upper bound: created_at must be newer than this. Limits the
  // bucket to "users who *just* became eligible" so we don't keep scanning
  // ancient unfinished accounts every hour.
  newerThan: string
  title: string
  body: string
}

const REMINDERS: ReminderConfig[] = [
  {
    key: '1h',
    column: 'onboarding_reminder_1h_sent_at',
    olderThan: '1 hour',
    newerThan: '2 hours',
    title: 'Just one more step \u{1F30A}',
    body: 'Finish setting up your profile in less than 2 min and start joining trips!',
  },
  {
    key: '24h',
    column: 'onboarding_reminder_24h_sent_at',
    olderThan: '24 hours',
    newerThan: '25 hours',
    title: 'Awesome surftrips are waiting \u{1F334}\u{1F30A}',
    body: 'Finish your profile to find your trip!',
  },
  {
    key: '7d',
    column: 'onboarding_reminder_7d_sent_at',
    olderThan: '7 days',
    newerThan: '7 days 1 hour',
    title: 'Still want in? \u{1F334}',
    body: 'Your profile takes literally 2 minutes. Come back and finish \u{1F64C}\u{1F3FC}',
  },
]

interface CandidateRow {
  user_id: string
  expo_push_token: string
}

async function fetchTaintedTokens(supabase: any): Promise<Set<string>> {
  // A device's push token can be attached to MULTIPLE surfer rows over time
  // (logout/login, demo accounts, test accounts). If ANY of those rows has
  // finished_onboarding=true, the device-owner has finished — don't remind.
  const { data, error } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('finished_onboarding', true)
    .not('expo_push_token', 'is', null)

  if (error) {
    console.error('[Abandonment] Error loading tainted tokens:', error)
    return new Set()
  }
  return new Set((data as { expo_push_token: string }[]).map(r => r.expo_push_token))
}

async function findCandidates(
  supabase: any,
  reminder: ReminderConfig,
  tainted: Set<string>,
): Promise<CandidateRow[]> {
  const now = Date.now()
  const upperIso = new Date(now - parseIntervalMs(reminder.olderThan)).toISOString()
  const lowerIso = new Date(now - parseIntervalMs(reminder.newerThan)).toISOString()

  const { data, error } = await supabase
    .from('surfers')
    .select('user_id, expo_push_token')
    .eq('finished_onboarding', false)
    .not('expo_push_token', 'is', null)
    .is(reminder.column, null)
    .lt('created_at', upperIso)
    .gte('created_at', lowerIso)

  if (error) {
    console.error(`[Abandonment] Error querying ${reminder.key} candidates:`, error)
    return []
  }

  const rows = (data as CandidateRow[]) ?? []
  return rows.filter(r => !tainted.has(r.expo_push_token))
}

function parseIntervalMs(interval: string): number {
  // Tiny parser for the limited set we use: "1 hour", "24 hours", "7 days",
  // "7 days 1 hour", "25 hours", "2 hours".
  let total = 0
  const re = /(\d+)\s*(hour|hours|day|days)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(interval)) !== null) {
    const n = parseInt(m[1], 10)
    const unit = m[2]
    if (unit.startsWith('hour')) total += n * 3600 * 1000
    else if (unit.startsWith('day')) total += n * 86400 * 1000
  }
  if (total === 0) {
    throw new Error(`[Abandonment] Cannot parse interval: ${interval}`)
  }
  return total
}

async function sendOne(
  supabase: any,
  reminder: ReminderConfig,
  row: CandidateRow,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EXPO_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`

  const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: row.expo_push_token,
      title: reminder.title,
      body: reminder.body,
      sound: 'default',
      data: { type: 'onboarding_reminder', reminderKey: reminder.key },
    }),
  })

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }))
    console.error(
      `[Abandonment] Expo API error (${pushResponse.status}) for ${row.user_id}:`,
      JSON.stringify(errorData),
    )
    return
  }

  const result = await pushResponse.json()

  // Stale-token cleanup, same pattern as send-push-notification.
  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Abandonment] Clearing stale token for ${row.user_id}`)
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', row.user_id)
    return
  }

  // Mark this reminder as sent so we don't send it again. Done after the Expo
  // call so a transient network failure simply leaves the row eligible next
  // hour (within the bucket window).
  const update: Record<string, string> = {}
  update[reminder.column] = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('surfers')
    .update(update)
    .eq('user_id', row.user_id)

  if (updateError) {
    console.error(`[Abandonment] Failed to mark ${reminder.column} for ${row.user_id}:`, updateError)
  } else {
    console.log(`[Abandonment] Sent ${reminder.key} to ${row.user_id}`)
  }
}

serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8)
  console.log(`[Abandonment] [${requestId}] Invocation start`)

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Caller authentication: triggered hourly by pg_cron, which sends the shared
  // secret in the x-internal-secret header (sourced from Vault — see
  // 20260606_secure_onboarding_cron.sql). Fails closed if the secret is unset.
  {
    const provided = req.headers.get('x-internal-secret') || ''
    const expected = Deno.env.get('ADMIN_FUNCTION_SECRET') || ''
    if (!expected || provided !== expected) {
      console.log(`[Abandonment] [${requestId}] Unauthorized: missing/invalid x-internal-secret`)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const tainted = await fetchTaintedTokens(supabase)
  console.log(`[Abandonment] [${requestId}] Tainted tokens (have a finished surfer): ${tainted.size}`)

  const summary: Record<ReminderKey, { found: number; sent: number }> = {
    '1h': { found: 0, sent: 0 },
    '24h': { found: 0, sent: 0 },
    '7d': { found: 0, sent: 0 },
  }

  for (const reminder of REMINDERS) {
    try {
      const rows = await findCandidates(supabase, reminder, tainted)
      summary[reminder.key].found = rows.length

      for (const row of rows) {
        try {
          await sendOne(supabase, reminder, row)
          summary[reminder.key].sent += 1
        } catch (err) {
          console.error(`[Abandonment] Send failed for ${row.user_id} / ${reminder.key}:`, err)
        }
      }
    } catch (err) {
      console.error(`[Abandonment] Window ${reminder.key} failed:`, err)
    }
  }

  console.log(`[Abandonment] [${requestId}] Summary:`, JSON.stringify(summary))

  return new Response(
    JSON.stringify({ request_id: requestId, summary }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
