import { User as SupabaseUser } from '@supabase/supabase-js';
import { User as AppUser } from '../services/database/databaseService';

/**
 * Converts a Supabase user object to the app's User format.
 * Uses the Supabase UUID string directly as the user ID.
 */
export function convertSupabaseUserToAppUser(
  supabaseUser: SupabaseUser,
  nickname?: string
): AppUser {
  // Get nickname from user metadata, parameter, or email
  const userNickname = nickname ||
    supabaseUser.user_metadata?.nickname ||
    supabaseUser.user_metadata?.name ||
    supabaseUser.email?.split('@')[0] ||
    'User';

  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    nickname: userNickname,
    googleId: supabaseUser.user_metadata?.sub || supabaseUser.id,
    createdAt: supabaseUser.created_at,
    updatedAt: supabaseUser.updated_at || supabaseUser.created_at,
  };
}
