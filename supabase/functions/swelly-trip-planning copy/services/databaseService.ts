/**
 * Database Service for Match Storage Operations
 * 
 * Handles all database operations for the matching_users table
 */

import { MatchResult, MatchRecord } from '../types.ts';

/**
 * Save match results to the matching_users table
 * Uses ON CONFLICT to handle duplicates (one match per user per chat)
 */
export async function saveMatches(
  chatId: string,
  requestingUserId: string,
  matches: MatchResult[],
  filters: any,
  destinationCountry?: string,
  area?: string | null,
  supabaseAdmin: any
): Promise<void> {
  if (!matches || matches.length === 0) {
    console.log('[databaseService] No matches to save');
    return;
  }

  try {
    // Prepare data for bulk insert
    const matchRecords = matches.map(match => ({
      chat_id: chatId,
      requesting_user_id: requestingUserId,
      matched_user_id: match.user_id,
      destination_country: destinationCountry || null,
      area: area || null,
      match_score: match.match_score,
      priority_score: match.priority_score || null,
      general_score: match.general_score || null,
      matched_areas: match.matched_areas || null,
      matched_towns: match.matched_towns || null,
      common_lifestyle_keywords: match.common_lifestyle_keywords || null,
      common_wave_keywords: match.common_wave_keywords || null,
      days_in_destination: match.days_in_destination || null,
      match_quality: match.match_quality || null,
      filters_applied: filters || null,
    }));

    // Bulk insert with conflict handling
    // ON CONFLICT updates the existing record with new match data
    const { error } = await supabaseAdmin
      .from('matching_users')
      .upsert(matchRecords, {
        onConflict: 'chat_id,matched_user_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('[databaseService] Error saving matches:', error);
      throw new Error(`Failed to save matches: ${error.message}`);
    }

    console.log(`[databaseService] Successfully saved ${matches.length} matches for chat ${chatId}`);
  } catch (error) {
    console.error('[databaseService] Error in saveMatches:', error);
    throw error;
  }
}

/**
 * Get previously matched user IDs for a chat
 * Used to exclude users who have already been matched in this conversation
 */
export async function getPreviouslyMatchedUserIds(
  chatId: string,
  supabaseAdmin: any
): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('matching_users')
      .select('matched_user_id')
      .eq('chat_id', chatId);

    if (error) {
      console.error('[databaseService] Error getting previously matched user IDs:', error);
      return [];
    }

    const userIds = (data || []).map((record: any) => record.matched_user_id);
    console.log(`[databaseService] Found ${userIds.length} previously matched users for chat ${chatId}`);
    return userIds;
  } catch (error) {
    console.error('[databaseService] Error in getPreviouslyMatchedUserIds:', error);
    return [];
  }
}

/**
 * Get matches for a chat, sorted by score
 * Supports pagination with limit/offset
 */
export async function getMatchesForChat(
  chatId: string,
  supabaseAdmin: any,
  limit?: number,
  offset?: number
): Promise<MatchRecord[]> {
  try {
    let query = supabaseAdmin
      .from('matching_users')
      .select('*')
      .eq('chat_id', chatId)
      .order('match_score', { ascending: false })
      .order('created_at', { ascending: false });

    if (limit !== undefined) {
      query = query.limit(limit);
    }
    if (offset !== undefined) {
      query = query.range(offset, offset + (limit || 100) - 1);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[databaseService] Error getting matches for chat:', error);
      throw new Error(`Failed to get matches: ${error.message}`);
    }

    return (data || []) as MatchRecord[];
  } catch (error) {
    console.error('[databaseService] Error in getMatchesForChat:', error);
    throw error;
  }
}

/**
 * Delete matches for a chat (useful for testing or resetting)
 */
export async function deleteMatchesForChat(
  chatId: string,
  supabaseAdmin: any
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('matching_users')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.error('[databaseService] Error deleting matches:', error);
      throw new Error(`Failed to delete matches: ${error.message}`);
    }

    console.log(`[databaseService] Deleted matches for chat ${chatId}`);
  } catch (error) {
    console.error('[databaseService] Error in deleteMatchesForChat:', error);
    throw error;
  }
}

