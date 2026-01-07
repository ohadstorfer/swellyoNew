import { supabase, isSupabaseConfigured } from '../../config/supabase';

/**
 * Swelly Shaper Service
 * 
 * Handles AI-powered profile editing conversations through Supabase Edge Functions.
 * Uses OpenAI to understand natural language and update profile fields.
 */

export interface ShaperResponse {
  message: string;
  updatedFields?: Array<{ field: string; value: any; displayName: string }>;
  needsConfirmation?: boolean;
  confirmationField?: string;
  confirmationValue?: any;
}

export interface ShaperChatRequest {
  message: string;
}

export interface ShaperChatResponse {
  chat_id?: string;
  return_message: string;
  is_finished: boolean;
  data?: any;
}

class SwellyShaperService {
  private chatId: string | null = null;

  /**
   * Get the Supabase Edge Function URL for Swelly Shaper
   */
  private getFunctionUrl(endpoint: string): string {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    if (!supabaseUrl) {
      throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
    }
    
    return `${supabaseUrl}/functions/v1/swelly-shaper${endpoint}`;
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
   * Get initial welcome message
   */
  async getWelcomeMessage(): Promise<string> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userName = user?.user_metadata?.nickname || user?.email?.split('@')[0] || 'there';
      
      return `Hey ${userName}, how are you? 👋\n\nI'm here to help you edit and modify your profile. I can help you update your surf level, surfboard type, add or change trips, and much more!\n\nWhat would you like to change today?`;
    } catch (error) {
      console.error('Error getting welcome message:', error);
      return `Hey there, how are you? 👋\n\nI'm here to help you edit and modify your profile. I can help you update your surf level, surfboard type, add or change trips, and much more!\n\nWhat would you like to change today?`;
    }
  }

  /**
   * Start a new profile editing conversation
   */
  async startNewConversation(
    request: ShaperChatRequest,
    conversationId?: string
  ): Promise<ShaperChatResponse> {
    try {
      const url = this.getFunctionUrl('/new_chat');
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyShaperService] Starting new conversation:', url);
      console.log('[SwellyShaperService] Request body:', JSON.stringify(request));
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          conversation_id: conversationId,
        }),
      });

      console.log('[SwellyShaperService] Response status:', response.status);
      console.log('[SwellyShaperService] Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SwellyShaperService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyShaperService] Response data:', result);
      
      // Store chat ID for continuing conversation
      if (result.chat_id) {
        this.chatId = result.chat_id;
      }
      
      return result;
    } catch (error) {
      console.error('[SwellyShaperService] Error starting conversation:', error);
      throw error;
    }
  }

  /**
   * Continue an existing profile editing conversation
   */
  async continueConversation(
    chatId: string,
    request: ShaperChatRequest,
    conversationId?: string
  ): Promise<ShaperChatResponse> {
    try {
      const url = this.getFunctionUrl(`/continue/${chatId}`);
      const headers = await this.getAuthHeaders();
      
      console.log('[SwellyShaperService] Continuing conversation:', url);
      
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
        console.error('[SwellyShaperService] Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('[SwellyShaperService] Response data:', result);
      return result;
    } catch (error) {
      console.error('[SwellyShaperService] Error continuing conversation:', error);
      throw error;
    }
  }

  /**
   * Process user message and get response
   * This is the main method used by the UI
   */
  async processMessage(userMessage: string): Promise<ShaperResponse> {
    try {
      let response: ShaperChatResponse;
      
      if (this.chatId) {
        // Continue existing chat
        console.log('[SwellyShaperService] Continuing chat with ID:', this.chatId);
        response = await this.continueConversation(this.chatId, {
          message: userMessage,
        });
      } else {
        // Start new chat
        console.log('[SwellyShaperService] Starting new chat');
        response = await this.startNewConversation({
          message: userMessage,
        });
        if (response.chat_id) {
          this.chatId = response.chat_id;
        }
      }

      // Convert edge function response to ShaperResponse format
      const shaperResponse: ShaperResponse = {
        message: response.return_message,
      };

      // If the conversation finished and has data, extract updated fields
      if (response.is_finished && response.data) {
        const updatedFields: Array<{ field: string; value: any; displayName: string }> = [];
        
        // Handle single field update
        if (response.data.field && response.data.value !== undefined) {
          updatedFields.push({
            field: response.data.field,
            value: response.data.value,
            displayName: this.getFieldDisplayName(response.data.field),
          });
        }
        
        // Handle multiple field updates
        if (response.data.updates && Array.isArray(response.data.updates)) {
          for (const update of response.data.updates) {
            if (update.field && update.value !== undefined) {
              updatedFields.push({
                field: update.field,
                value: update.value,
                displayName: this.getFieldDisplayName(update.field),
              });
            }
          }
        }
        
        if (updatedFields.length > 0) {
          shaperResponse.updatedFields = updatedFields;
        }
      }

      return shaperResponse;
    } catch (error) {
      console.error('[SwellyShaperService] Error processing message:', error);
      throw error;
    }
  }

  /**
   * Reset the chat (start fresh)
   */
  resetChat(): void {
    this.chatId = null;
  }

  /**
   * Get display name for a field
   */
  private getFieldDisplayName(field: string): string {
    const displayNames: { [key: string]: string } = {
      name: 'name',
      age: 'age',
      pronoun: 'pronouns',
      country_from: 'country',
      surfboard_type: 'surfboard type',
      surf_level: 'surf level',
      travel_experience: 'travel experience',
      bio: 'bio',
      profile_image_url: 'profile picture',
      travel_type: 'travel budget',
      travel_buddies: 'travel preference',
      lifestyle_keywords: 'lifestyle interests',
      wave_type_keywords: 'wave preferences',
      destinations_array: 'trips',
    };
    return displayNames[field] || field;
  }
}

export const swellyShaperService = new SwellyShaperService();
