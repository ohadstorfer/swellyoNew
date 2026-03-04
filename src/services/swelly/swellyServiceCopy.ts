import { supabase, isSupabaseConfigured } from '../../config/supabase';
import type { MatchedUser } from '../../types/tripPlanning';

/**
 * Swelly Service Copy - uses "swelly-trip-planning-copy" edge for trip-planning and server-side matching.
 * Same interface as swellyService but points to the Copy edge and adds findMatchingUsersServer.
 */

export interface SwellyChatRequest {
  message: string;
}

export interface SwellyChatResponse {
  chat_id?: string;
  return_message: string;
  is_finished: boolean;
  data?: any;
  ui_hints?: {
    show_destination_cards?: boolean;
    destinations?: string[];
    show_budget_buttons?: boolean;
  };
}

export interface SwellyContinueChatRequest {
  message: string;
  /** When adding to existing filters (Add Filter flow), send current queryFilters so backend can merge. */
  existing_query_filters?: any;
  adding_filters?: boolean;
  /** Optional: preserve destination/area when merging in add-filters mode. */
  existing_destination_country?: string | null;
  existing_area?: string | null;
}

/** Trip-planning payload when is_finished is true (optional shape for type hints). */
export interface TripPlanningFinishedData {
  search_summary?: string;
  destination_country?: string;
  area?: string | null;
  [key: string]: unknown;
}

export interface SwellyContinueChatResponse {
  return_message: string;
  is_finished: boolean;
  data?: any;
  ui_hints?: {
    show_destination_cards?: boolean;
    destinations?: string[];
    show_budget_buttons?: boolean;
  };
}

class SwellyService {
  /**
   * Get the Supabase Edge Function URL for Swelly chat
   */
  private getFunctionUrl(endpoint: string, conversationType: 'onboarding' | 'trip-planning' = 'onboarding'): string {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    if (!supabaseUrl) {
      throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
    }
    
    // Copy flow: use "swelly-trip-planning-copy" edge for all trip-planning (and health when used from Copy screen)
    const isDevMode = process.env.EXPO_PUBLIC_DEV_MODE === 'true';
    const chatFunctionName = isDevMode ? 'swelly-chat-demo' : 'swelly-chat';
    const functionName = conversationType === 'trip-planning' ? 'swelly-trip-planning-copy' : chatFunctionName;
    return `${supabaseUrl}/functions/v1/${functionName}${endpoint}`;
  }

  /**
   * Get authentication headers for Supabase Edge Function calls
   */
  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('[swellyService] No session - auth guard will handle redirect');
      throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
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
   * Start a new conversation with Swelly
   * @param request - Initial message or context for the conversation
   * @param conversationId - Optional Supabase conversation ID to link chat history
   * @returns Swelly's response and chat ID
   */
  async startNewConversation(
    request: SwellyChatRequest, 
    conversationId?: string
  ): Promise<SwellyChatResponse> {
    try {
      const url = this.getFunctionUrl('/new_chat');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Starting new conversation:', url);
      console.log('[SwellyService] Request body:', JSON.stringify(request));
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          conversation_id: conversationId,
        }),
      });

      console.log('[SwellyService] Response status:', response.status);
      console.log('[SwellyService] Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Response data:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error starting new conversation:', error);
      throw error;
    }
  }

  /**
   * Continue an existing conversation with Swelly
   * @param chatId - The chat ID from the previous conversation
   * @param request - The user's message
   * @param conversationId - Optional Supabase conversation ID to link chat history
   * @returns Swelly's response
   */
  async continueConversation(
    chatId: string, 
    request: SwellyContinueChatRequest,
    conversationId?: string
  ): Promise<SwellyContinueChatResponse> {
    try {
      const url = this.getFunctionUrl(`/continue/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Continuing conversation:', url);
      
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
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Response data:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error continuing conversation:', error);
      throw error;
    }
  }

  /**
   * Get chat history for a specific conversation
   * @param chatId - The chat ID
   * @returns Chat history
   */
  async getChatHistory(chatId: string): Promise<any> {
    try {
      const url = this.getFunctionUrl(`/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Getting chat history:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Chat history:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error getting chat history:', error);
      throw error;
    }
  }

  /**
   * Get trip planning chat history for a specific conversation
   * @param chatId - The chat ID
   * @returns Chat history with messages
   */
  async getTripPlanningHistory(chatId: string): Promise<{ chat_id: string; messages: Array<{ role: string; content: string }> }> {
    try {
      const url = this.getFunctionUrl(`/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Getting trip planning history:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Trip planning history:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error getting trip planning history:', error);
      throw error;
    }
  }

  /**
   * Check if the Swelly API is healthy and available (Copy flow uses trip-planning-copy edge)
   * @returns Health check response
   */
  async healthCheck(): Promise<any> {
    try {
      const url = this.getFunctionUrl('/health', 'trip-planning');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Checking API health:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Health check result:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error checking API health:', error);
      throw error;
    }
  }

  /**
   * Initialize a conversation with Swelly using user's onboarding data
   * This creates a context message from the user's profile
   * 
   * @param userProfile - User's onboarding/profile data
   * @returns Swelly's initial response and chat ID
   */
  async initializeWithProfile(userProfile: {
    nickname?: string;
    age?: number;
    boardType?: number;
    surfLevel?: number;
    travelExperience?: number;
  }): Promise<SwellyChatResponse> {
    // Build context message from user profile
    const boardTypeNames: { [key: number]: string } = {
      0: 'shortboarder',
      1: 'midlength surfer',
      2: 'longboarder',
      3: 'soft top surfer',
    };

    // Use the actual calculated surf level category instead of hardcoded mapping
    let surfLevelName = 'intermediate'; // Default fallback
    if (userProfile.boardType !== undefined && userProfile.surfLevel !== undefined) {
      try {
         const { getSurfLevelMapping } = await import('../../utils/surfLevelMapping');
        const mapping = getSurfLevelMapping(userProfile.boardType, userProfile.surfLevel);
        if (mapping && mapping.category) {
          surfLevelName = mapping.category;
        }
      } catch (error) {
        console.warn('[SwellyService] Failed to get surf level mapping, using default:', error);
      }
    }

    const boardTypeName = boardTypeNames[userProfile.boardType ?? -1] || 'surfer';
    const trips = userProfile.travelExperience ?? 0;
    const name = userProfile.nickname || 'User';
    const age = userProfile.age ? `, age ${userProfile.age}` : '';

    const contextMessage = `Context: ${name}${age}, ${boardTypeName}, ${surfLevelName} level surfer, ${trips} surf trips`;

    return this.startNewConversation({
      message: contextMessage,
    });
  }

  /**
   * Start a new trip planning conversation with Swelly
   * @param request - Initial message for the trip planning conversation
   * @param conversationId - Optional Supabase conversation ID to link chat history
   * @returns Swelly's response and chat ID
   */
  async startTripPlanningConversation(
    request: SwellyChatRequest, 
    conversationId?: string
  ): Promise<SwellyChatResponse> {
    try {
      const url = this.getFunctionUrl('/new_chat', 'trip-planning');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Starting trip planning conversation:', url);
      console.log('[SwellyService] Request body:', JSON.stringify(request));
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          conversation_id: conversationId,
        }),
      });

      console.log('[SwellyService] Response status:', response.status);
      console.log('[SwellyService] Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Response data:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error starting trip planning conversation:', error);
      throw error;
    }
  }

  /**
   * Continue an existing trip planning conversation with Swelly
   * @param chatId - The chat ID from the previous conversation
   * @param request - The user's message
   * @param conversationId - Optional Supabase conversation ID to link chat history
   * @returns Swelly's response
   */
  async continueTripPlanningConversation(
    chatId: string, 
    request: SwellyContinueChatRequest,
    conversationId?: string
  ): Promise<SwellyContinueChatResponse> {
    try {
      const url = this.getFunctionUrl(`/continue/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Continuing trip planning conversation:', url);
      
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
        console.error('[SwellyService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyService] Response data:', result);
      return result;
    } catch (error) {
      console.error('[SwellyService] Error continuing trip planning conversation:', error);
      throw error;
    }
  }

  /**
   * Attach matched users to the last assistant message in a trip planning conversation
   * @param chatId - The chat ID for the conversation
   * @param matchedUsers - Array of matched users to attach
   * @param destinationCountry - Destination country for the matched users
   * @param requestData - Optional trip planning request data for action row (Add Filter / More)
   */
  async attachMatchedUsersToMessage(
    chatId: string,
    matchedUsers: any[],
    destinationCountry: string,
    requestData?: any,
    totalCount?: number
  ): Promise<{ messageIndex?: number } | void> {
    try {
      const url = this.getFunctionUrl(`/attach-matches/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyService] Attaching matched users to message:', url);
      console.log('[SwellyService] Matched users count:', matchedUsers.length);
      console.log('[SwellyService] Destination country:', destinationCountry);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchedUsers,
          destinationCountry,
          ...(requestData != null && { requestData }),
          ...(totalCount !== undefined && { totalCount }),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyService] Error attaching matched users:', errorText);
        // Don't throw - log error but don't block UI
        console.warn('[SwellyService] Failed to save matched users to backend, but matches are still displayed in UI');
        return;
      }

      const result = await response.json();
      console.log('[SwellyService] Matched users attached successfully:', result);
      return { messageIndex: result.messageIndex };
    } catch (error) {
      console.error('[SwellyService] Error attaching matched users to message:', error);
      // Don't throw - log error but don't block UI
      console.warn('[SwellyService] Failed to save matched users to backend, but matches are still displayed in UI');
    }
  }

  /**
   * Update the selected action (new_chat, add_filter, more) for a match block so it persists on restore.
   * @param chatId - The chat ID
   * @param messageIndex - Index of the assistant message (in backend messages array)
   * @param selectedAction - The action the user selected
   */
  async updateMatchActionSelection(
    chatId: string,
    messageIndex: number,
    selectedAction: 'new_chat' | 'add_filter' | 'more'
  ): Promise<void> {
    try {
      const url = this.getFunctionUrl(`/update-match-action/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ messageIndex, selectedAction }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[SwellyService] updateMatchActionSelection failed:', errorText);
      }
    } catch (error) {
      console.warn('[SwellyService] updateMatchActionSelection error:', error);
    }
  }

  /**
   * Update the requestData (filters) for a match block so it persists on restore.
   * @param chatId - The chat ID
   * @param messageIndex - Index of the assistant message (in backend messages array)
   * @param requestData - Updated trip planning request data (e.g. after removing a filter)
   */
  async updateMatchRequestData(
    chatId: string,
    messageIndex: number,
    requestData: any
  ): Promise<void> {
    try {
      const url = this.getFunctionUrl(`/update-match-filters/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ messageIndex, requestData }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[SwellyService] updateMatchRequestData failed:', errorText);
      }
    } catch (error) {
      console.warn('[SwellyService] updateMatchRequestData error:', error);
    }
  }

  /**
   * Update the search summary block (requestData, searchSummary, selectedAction) on the last assistant message
   * so it persists and restores (pending search + two buttons + selection).
   */
  async updateSearchSummaryBlock(
    chatId: string,
    requestData: any,
    searchSummary: string,
    selectedAction: 'search' | 'continue_editing' | null,
    messageIndex?: number
  ): Promise<void> {
    try {
      const url = this.getFunctionUrl(`/update-search-summary-block/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      const body: { requestData: any; searchSummary: string; selectedAction: 'search' | 'continue_editing' | null; messageIndex?: number } = { requestData, searchSummary, selectedAction };
      if (messageIndex !== undefined) body.messageIndex = messageIndex;
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[SwellyService] updateSearchSummaryBlock failed:', errorText);
      }
    } catch (error) {
      console.warn('[SwellyService] updateSearchSummaryBlock error:', error);
    }
  }

  /**
   * Acknowledge filter removal: persist new filters, get GPT summary, and return the new message for the client to append.
   */
  async acknowledgeFilterRemoval(
    chatId: string,
    payload: {
      messageIndex?: number;
      requestData: any;
      removedFilterLabel?: string;
      context: 'message' | 'pending_search';
    }
  ): Promise<{ success: boolean; newMessage?: { id: string; text: string; isUser: boolean; timestamp: string } }> {
    try {
      const url = this.getFunctionUrl(`/acknowledge-filter-removal/${chatId}`, 'trip-planning');
      const headers = await this.getAuthHeaders();
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.warn('[SwellyServiceCopy] acknowledgeFilterRemoval failed:', response.status, data);
        return { success: false };
      }
      return { success: true, newMessage: data.newMessage };
    } catch (error) {
      console.warn('[SwellyServiceCopy] acknowledgeFilterRemoval error:', error);
      return { success: false };
    }
  }

  /**
   * Run matching on the server (Copy flow only). POSTs to /find-matches on the Copy edge.
   * @param chatId - Trip planning chat ID
   * @param tripPlanningData - Extracted data from Swelly response (destination_country, area, queryFilters, etc.)
   * @returns Matched users in client MatchedUser shape
   */
  async findMatchingUsersServer(
    chatId: string,
    tripPlanningData: any
  ): Promise<{ matches: MatchedUser[]; totalCount: number }> {
    // Normalize: ensure queryFilters is set when backend sent query_filters
    const payload = tripPlanningData && typeof tripPlanningData === 'object'
      ? { ...tripPlanningData, queryFilters: tripPlanningData.queryFilters ?? tripPlanningData.query_filters ?? null }
      : tripPlanningData;
    console.log('[SwellyServiceCopy] find-matches payload: queryFilters present=', payload?.queryFilters != null, 'surf_level_category present=', payload?.queryFilters?.surf_level_category != null);

    const url = this.getFunctionUrl('/find-matches', 'trip-planning');
    const headers = await this.getAuthHeaders();

    console.log('[SwellyServiceCopy] Finding matches server-side:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chatId, tripPlanningData: payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SwellyServiceCopy] find-matches error:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    const serverMatches = data.matches || [];
    const matches: MatchedUser[] = serverMatches.map((m: any) => mapServerMatchToMatchedUser(m));
    const totalCount = typeof data.totalCount === 'number' ? data.totalCount : (data.matches?.length ?? 0);
    console.log('[SwellyServiceCopy] Server returned', matches.length, 'matches (totalCount=', totalCount, ')');
    return { matches, totalCount };
  }
}

/**
 * Map server MatchResult (snake_case) to client MatchedUser (camelCase where needed)
 */
function mapServerMatchToMatchedUser(m: any): MatchedUser {
  return {
    user_id: m.user_id,
    name: m.name ?? 'User',
    profile_image_url: m.profile_image_url ?? null,
    match_score: m.match_score ?? 0,
    matched_areas: m.matched_areas,
    common_lifestyle_keywords: m.common_lifestyle_keywords,
    common_wave_keywords: m.common_wave_keywords,
    surfboard_type: m.surfboard_type,
    surf_level: m.surf_level,
    travel_experience: m.travel_experience,
    country_from: m.country_from,
    age: m.age,
    days_in_destination: m.days_in_destination,
    destinations_array: m.destinations_array,
    matchQuality: m.match_quality ?? undefined,
  };
}

export const swellyServiceCopy = new SwellyService();
