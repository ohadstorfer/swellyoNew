import { API_CONFIG, ENDPOINTS } from '../../config/api';

/**
 * Swelly Service
 * 
 * Handles all interactions with the Swelly chat/conversation system (Step 5).
 * This service manages the conversation flow with Swelly, including:
 * - Starting new conversations
 * - Continuing existing conversations
 * - Retrieving chat history
 * - Health checks
 */

const API_BASE_URL = API_CONFIG.BASE_URL;

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

class SwellyService {
  /**
   * Start a new conversation with Swelly
   * @param request - Initial message or context for the conversation
   * @returns Swelly's response and chat ID
   */
  async startNewConversation(request: SwellyChatRequest): Promise<SwellyChatResponse> {
    try {
      const url = `${API_BASE_URL}${ENDPOINTS.NEW_CHAT}`;
      console.log('[SwellyService] Starting new conversation:', url);
      console.log('[SwellyService] Request body:', JSON.stringify(request));
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
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
   * @returns Swelly's response
   */
  async continueConversation(chatId: string, request: SwellyContinueChatRequest): Promise<SwellyContinueChatResponse> {
    try {
      const url = `${API_BASE_URL}${ENDPOINTS.CONTINUE_CHAT(chatId)}`;
      console.log('[SwellyService] Continuing conversation:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
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
      const url = `${API_BASE_URL}${ENDPOINTS.GET_CHAT(chatId)}`;
      console.log('[SwellyService] Getting chat history:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
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
   * Check if the Swelly API is healthy and available
   * @returns Health check response
   */
  async healthCheck(): Promise<any> {
    try {
      const url = `${API_BASE_URL}${ENDPOINTS.HEALTH}`;
      console.log('[SwellyService] Checking API health:', url);
      
      const response = await fetch(url, {
        method: 'GET',
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

    const surfLevelNames: { [key: number]: string } = {
      0: 'beginner',
      1: 'beginner-intermediate',
      2: 'intermediate',
      3: 'intermediate-advanced',
      4: 'advanced',
    };

    const boardTypeName = boardTypeNames[userProfile.boardType ?? -1] || 'surfer';
    const surfLevelName = surfLevelNames[userProfile.surfLevel ?? -1] || 'intermediate';
    const trips = userProfile.travelExperience ?? 0;
    const name = userProfile.nickname || 'User';
    const age = userProfile.age ? `, age ${userProfile.age}` : '';

    const contextMessage = `Context: ${name}${age}, ${boardTypeName}, ${surfLevelName} level surfer, ${trips} surf trips`;

    return this.startNewConversation({
      message: contextMessage,
    });
  }
}

export const swellyService = new SwellyService();

