import { API_CONFIG, ENDPOINTS } from '../../config/api';

const API_BASE_URL = API_CONFIG.BASE_URL;

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  chat_id?: string;
  return_message: string;
  is_finished: boolean;
  data?: any;
}

export interface ContinueChatRequest {
  message: string;
}

export interface ContinueChatResponse {
  return_message: string;
  is_finished: boolean;
  data?: any;
}

export class ChatService {
  static async startNewChat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const url = `${API_BASE_URL}${ENDPOINTS.NEW_CHAT}`;
      console.log('Making request to:', url);
      console.log('Request body:', JSON.stringify(request));
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('Response data:', result);
      return result;
    } catch (error) {
      console.error('Error starting new chat:', error);
      throw error;
    }
  }

  static async continueChat(chatId: string, request: ContinueChatRequest): Promise<ContinueChatResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}${ENDPOINTS.CONTINUE_CHAT(chatId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error continuing chat:', error);
      throw error;
    }
  }

  static async getChatHistory(chatId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}${ENDPOINTS.GET_CHAT(chatId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting chat history:', error);
      throw error;
    }
  }

  static async healthCheck() {
    try {
      const response = await fetch(`${API_BASE_URL}${ENDPOINTS.HEALTH}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error checking API health:', error);
      throw error;
    }
  }
}

