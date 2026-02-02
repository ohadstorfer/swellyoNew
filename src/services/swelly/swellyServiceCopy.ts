/**
 * Swelly Service Copy - For Testing Server-Side Matching
 * 
 * This is a copy of swellyService.ts with additional methods for server-side matching.
 * Used for testing the new server-side matching system without modifying existing code.
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { TripPlanningRequest, MatchedUser } from '../../types/tripPlanning';

export interface SwellyChatRequest {
  message: string;
}

export interface SwellyChatResponse {
  chat_id?: string;
  return_message: string;
  is_finished: boolean;
  data?: any;
}

export interface SwellyContinueChatRequest {
  message: string;
}

export interface SwellyContinueChatResponse {
  return_message: string;
  is_finished: boolean;
  data?: any;
}

export interface ServerMatchingRequest {
  chatId: string;
  tripPlanningData: TripPlanningRequest;
}

export interface ServerMatchingResponse {
  matches: MatchedUser[];
  totalCount: number;
  chatId: string;
}

class SwellyServiceCopy {
  /**
   * Get the Supabase Edge Function URL for Swelly trip planning (copy version)
   */
  private getFunctionUrl(endpoint: string): string {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    if (!supabaseUrl) {
      throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
    }
    
    // Use the copy version of the edge function
    return `${supabaseUrl}/functions/v1/swelly-trip-planning copy${endpoint}`;
  }

  /**
   * Get authentication headers for Supabase Edge Function calls
   */
  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      throw new Error('Not authenticated. Please sign in again.');
    }

    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
    };
  }

  /**
   * Start a new trip planning conversation (uses copy edge function)
   */
  async startTripPlanningConversation(
    request: SwellyChatRequest,
    conversationId?: string
  ): Promise<SwellyChatResponse> {
    try {
      const url = this.getFunctionUrl('/new_chat');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyServiceCopy] Starting new trip planning conversation:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start conversation: ${response.status} ${errorText}`);
      }

      const data: SwellyChatResponse = await response.json();
      return data;
    } catch (error) {
      console.error('[SwellyServiceCopy] Error starting conversation:', error);
      throw error;
    }
  }

  /**
   * Continue trip planning conversation (uses copy edge function)
   */
  async continueTripPlanningConversation(
    chatId: string,
    request: SwellyContinueChatRequest,
    conversationId?: string
  ): Promise<SwellyContinueChatResponse> {
    try {
      const url = this.getFunctionUrl(`/continue/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyServiceCopy] Continuing conversation:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to continue conversation: ${response.status} ${errorText}`);
      }

      const data: SwellyContinueChatResponse = await response.json();
      return data;
    } catch (error) {
      console.error('[SwellyServiceCopy] Error continuing conversation:', error);
      throw error;
    }
  }

  /**
   * Find matches using server-side matching
   * This calls the new /find-matches endpoint
   */
  async findMatchesServer(
    chatId: string,
    tripPlanningData: TripPlanningRequest
  ): Promise<ServerMatchingResponse> {
    try {
      const url = this.getFunctionUrl('/find-matches');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyServiceCopy] Finding matches server-side:', url);
      console.log('[SwellyServiceCopy] Request:', { chatId, tripPlanningData });
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chatId,
          tripPlanningData,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to find matches: ${response.status} ${errorText}`);
      }

      const data: ServerMatchingResponse = await response.json();
      console.log(`[SwellyServiceCopy] Found ${data.totalCount} matches`);
      return data;
    } catch (error) {
      console.error('[SwellyServiceCopy] Error finding matches:', error);
      throw error;
    }
  }

  /**
   * Health check for the edge function
   */
  async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      const url = this.getFunctionUrl('/health');
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyServiceCopy] Error in health check:', error);
      throw error;
    }
  }

  /**
   * Attach matched users to message (for backward compatibility)
   * Note: With server-side matching, matches are already saved, but this can be used for metadata
   */
  async attachMatchedUsersToMessage(
    chatId: string,
    matchedUsers: MatchedUser[],
    destinationCountry: string
  ): Promise<void> {
    try {
      const url = this.getFunctionUrl(`/attach-matches/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchedUsers,
          destinationCountry,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to attach matches: ${response.status} ${errorText}`);
      }

      console.log('[SwellyServiceCopy] Matched users attached to message');
    } catch (error) {
      console.error('[SwellyServiceCopy] Error attaching matched users:', error);
      throw error;
    }
  }

  /**
   * Get trip planning chat history
   */
  async getTripPlanningHistory(chatId: string): Promise<{ chat_id: string; messages: any[] }> {
    try {
      const url = this.getFunctionUrl(`/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get history: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyServiceCopy] Error getting history:', error);
      throw error;
    }
  }

  /**
   * Get matches from database for a chat
   * This retrieves previously saved matches
   */
  async getMatchesFromDatabase(chatId: string): Promise<MatchedUser[]> {
    try {
      // Query the matching_users table directly
      const { data, error } = await supabase
        .from('matching_users')
        .select('*')
        .eq('chat_id', chatId)
        .order('match_score', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get matches: ${error.message}`);
      }

      // Convert database records to MatchedUser format
      const matches: MatchedUser[] = (data || []).map((record: any) => ({
        user_id: record.matched_user_id,
        match_score: record.match_score,
        matched_areas: record.matched_areas || [],
        common_lifestyle_keywords: record.common_lifestyle_keywords || [],
        common_wave_keywords: record.common_wave_keywords || [],
        days_in_destination: record.days_in_destination || 0,
        match_quality: record.match_quality,
        // Note: We'll need to fetch user details separately if needed
        // For now, return basic match data
      }));

      return matches;
    } catch (error) {
      console.error('[SwellyServiceCopy] Error getting matches from database:', error);
      throw error;
    }
  }
}

export const swellyServiceCopy = new SwellyServiceCopy();

