import AsyncStorage from '@react-native-async-storage/async-storage';
import { MatchedUser } from '../types/tripPlanning';

/**
 * Matched users message metadata stored in AsyncStorage
 * Uses messageIndex (position in conversation) as the key for reliable matching
 */
export interface MatchedUsersMessage {
  messageIndex: number; // Position in the conversation (excluding system messages)
  matchedUsers: MatchedUser[];
  destinationCountry: string;
}

const STORAGE_KEY_PREFIX = '@swellyo_trip_planning_matched_users_';

/**
 * Get the storage key for a specific chatId
 */
function getStorageKey(chatId: string): string {
  return `${STORAGE_KEY_PREFIX}${chatId}`;
}

/**
 * Save matched users data for a specific message in a conversation
 * @param chatId - The chat ID for the conversation
 * @param messageIndex - Position of the message in the conversation (excluding system messages)
 * @param matchedUsers - Array of matched users to display
 * @param destinationCountry - Destination country for the matched users
 */
export async function saveMatchedUsers(
  chatId: string | null,
  messageIndex: number,
  matchedUsers: MatchedUser[],
  destinationCountry: string
): Promise<void> {
  if (!chatId) {
    console.warn('[tripPlanningStorage] Cannot save matched users: chatId is null');
    return;
  }

  try {
    const key = getStorageKey(chatId);
    const existing = await loadMatchedUsers(chatId);
    
    // Check if this messageIndex already exists and update it, otherwise add new
    const existingIndex = existing.findIndex(msg => msg.messageIndex === messageIndex);
    const newMessage: MatchedUsersMessage = {
      messageIndex,
      matchedUsers,
      destinationCountry,
    };

    if (existingIndex >= 0) {
      // Update existing entry
      existing[existingIndex] = newMessage;
    } else {
      // Add new entry
      existing.push(newMessage);
    }

    await AsyncStorage.setItem(key, JSON.stringify(existing));
    console.log('[tripPlanningStorage] Saved matched users for message index:', messageIndex);
  } catch (error) {
    console.error('[tripPlanningStorage] Error saving matched users:', error);
    // Don't throw - this is non-critical functionality
  }
}

/**
 * Load all matched users data for a conversation
 * @param chatId - The chat ID for the conversation
 * @returns Array of matched users messages
 */
export async function loadMatchedUsers(chatId: string | null): Promise<MatchedUsersMessage[]> {
  if (!chatId) {
    return [];
  }

  try {
    const key = getStorageKey(chatId);
    const stored = await AsyncStorage.getItem(key);
    
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    
    return [];
  } catch (error) {
    console.error('[tripPlanningStorage] Error loading matched users:', error);
    return [];
  }
}

/**
 * Clear matched users data for a specific conversation
 * @param chatId - The chat ID for the conversation
 */
export async function clearMatchedUsers(chatId: string | null): Promise<void> {
  if (!chatId) {
    return;
  }

  try {
    const key = getStorageKey(chatId);
    await AsyncStorage.removeItem(key);
    console.log('[tripPlanningStorage] Cleared matched users for chatId:', chatId);
  } catch (error) {
    console.error('[tripPlanningStorage] Error clearing matched users:', error);
    // Don't throw - this is non-critical functionality
  }
}

/**
 * Clear all matched users data (for cleanup/maintenance)
 * Note: This removes all trip planning matched users data
 */
export async function clearAllMatchedUsers(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const tripPlanningKeys = keys.filter(key => key.startsWith(STORAGE_KEY_PREFIX));
    
    if (tripPlanningKeys.length > 0) {
      await AsyncStorage.multiRemove(tripPlanningKeys);
      console.log('[tripPlanningStorage] Cleared all matched users data');
    }
  } catch (error) {
    console.error('[tripPlanningStorage] Error clearing all matched users:', error);
    // Don't throw - this is non-critical functionality
  }
}

