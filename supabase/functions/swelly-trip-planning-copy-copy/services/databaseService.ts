/**
 * Database Service for Match Storage (copy-copy)
 */

import { MatchResult, MatchRecord } from '../types.ts'

export async function saveMatches(
  chatId: string,
  requestingUserId: string,
  matches: MatchResult[],
  filters: any,
  destinationCountry?: string,
  area?: string | null,
  supabaseAdmin?: any
): Promise<void> {
  if (!matches?.length || !supabaseAdmin) return
  const records = matches.map((m) => ({
    chat_id: chatId,
    requesting_user_id: requestingUserId,
    matched_user_id: m.user_id,
    destination_country: destinationCountry ?? null,
    area: area ?? null,
    match_score: m.match_score,
    priority_score: m.priority_score ?? null,
    general_score: m.general_score ?? null,
    matched_areas: m.matched_areas ?? null,
    matched_towns: m.matched_towns ?? null,
    common_lifestyle_keywords: m.common_lifestyle_keywords ?? null,
    common_wave_keywords: m.common_wave_keywords ?? null,
    days_in_destination: m.days_in_destination ?? null,
    match_quality: m.match_quality ?? null,
    filters_applied: filters ?? null,
  }))
  await supabaseAdmin.from('matching_users').upsert(records, { onConflict: 'chat_id,matched_user_id', ignoreDuplicates: false })
}

export async function getPreviouslyMatchedUserIds(chatId: string, supabaseAdmin: any): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('matching_users').select('matched_user_id').eq('chat_id', chatId)
  if (error) return []
  return (data || []).map((r: any) => r.matched_user_id)
}
