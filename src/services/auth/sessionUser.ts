import type { User } from '@supabase/supabase-js';
import { supabase } from '../../config/supabase';

/**
 * The signed-in user, read from the LOCAL session (no network).
 *
 * getUser() is a round-trip to /auth/v1/user on every call. On hot paths
 * (every inbox broadcast, every reaction, every analytics event) it was ~11%
 * of all API traffic in the 21 Oct 2026 18-user test, on an Auth server
 * capped at 10 DB connections. Same rule sendMessage and getConversations
 * already follow: session first, getUser() only when the session cache is
 * empty. Validating the token is the auth guard's job, and RLS still checks
 * every request.
 */
export async function getSessionUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
