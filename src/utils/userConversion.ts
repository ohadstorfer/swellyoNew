import { User as SupabaseUser } from '@supabase/supabase-js';
import { User as AppUser } from '../services/database/databaseService';

/**
 * Converts a Supabase user object to the app's User format
 * 
 * @param supabaseUser - The Supabase user object
 * @param nickname - Optional nickname (if not available in user metadata)
 * @returns The converted app User object
 */
export function convertSupabaseUserToAppUser(
  supabaseUser: SupabaseUser,
  nickname?: string
): AppUser {
  // Convert Supabase UUID string to a numeric ID for legacy compatibility
  // Use the first 15 hex characters converted to a number
  const numericId = parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now();
  
  // Get nickname from user metadata, parameter, or email
  const userNickname = nickname || 
    supabaseUser.user_metadata?.nickname || 
    supabaseUser.user_metadata?.name || 
    supabaseUser.email?.split('@')[0] || 
    'User';
  
  return {
    id: numericId,
    email: supabaseUser.email || '',
    nickname: userNickname,
    googleId: supabaseUser.user_metadata?.sub || supabaseUser.id,
    createdAt: supabaseUser.created_at,
    updatedAt: supabaseUser.updated_at || supabaseUser.created_at,
  };
}

