/**
 * sessionBridge — publishes {access_token, expires_at, user_id} into a Keychain
 * access group shared with the SwellyoShare extension (iOS), so the extension
 * can insert messages via PostgREST without ever holding the refresh token.
 *
 * NEVER write the refresh token here. Supabase rotates refresh tokens; if the
 * extension refreshed, the app's stored copy would be invalidated and the user
 * silently logged out of the main app after sharing. The extension only reads
 * this short-lived access token, and when it is expired it falls back to opening
 * the app — which refreshes through the normal autoRefreshToken path.
 *
 * Keychain layout (contract with targets/share-extension/KeychainToken.swift):
 *   kSecClass          kSecClassGenericPassword
 *   kSecAttrService    "swellyo-share:no-auth"   <- expo-secure-store appends
 *                                                   ":no-auth" when
 *                                                   requireAuthentication=false
 *   kSecAttrAccount    Data("swellyo.session".utf8)   <- Data, NOT a String
 *   kSecAttrGeneric    Data("swellyo.session".utf8)
 *   kSecAttrAccessGroup "group.com.swellyo.app"
 * (see node_modules/expo-secure-store/ios/SecureStoreModule.swift `query(with:)`)
 *
 * Expo Go: the accessGroup needs the App Group entitlement, which Expo Go lacks.
 * Every native touch is inside try/catch and degrades to a no-op, same policy as
 * contactPicker.ts — note require() returns a lazy proxy, so the throw only
 * happens on method ACCESS, not on import.
 */

import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '../config/supabase';

export const SHARE_SESSION_KEY = 'swellyo.session';
export const SHARE_KEYCHAIN_OPTS = {
  keychainService: 'swellyo-share',
  accessGroup: 'group.com.swellyo.app',
} as const;

let initialized = false;

interface PublishedSession {
  access_token: string;
  /** epoch SECONDS, matching Supabase's Session.expires_at */
  expires_at: number;
  user_id: string;
}

function loadSecureStore(): any | null {
  try {
    const mod = require('expo-secure-store');
    if (!mod || typeof mod.setItemAsync !== 'function') return null;
    return mod;
  } catch {
    return null;
  }
}

async function publish(
  SecureStore: any,
  session: { access_token?: string; expires_at?: number; user?: { id: string } } | null,
): Promise<void> {
  try {
    if (!session?.access_token || !session.user?.id) {
      await SecureStore.deleteItemAsync(SHARE_SESSION_KEY, SHARE_KEYCHAIN_OPTS);
      return;
    }
    const payload: PublishedSession = {
      access_token: session.access_token,
      expires_at: session.expires_at ?? 0,
      user_id: session.user.id,
    };
    await SecureStore.setItemAsync(SHARE_SESSION_KEY, JSON.stringify(payload), SHARE_KEYCHAIN_OPTS);
  } catch (e) {
    // Expo Go, or a build predating the App Group entitlement. The inline share
    // path is simply unavailable; the extension falls back to opening the app.
    if (__DEV__) console.warn('[sessionBridge] publish failed:', e);
  }
}

/** Idempotent. Call once on app mount. iOS-only; no-ops elsewhere. */
export function initSessionBridge(): void {
  if (Platform.OS !== 'ios' || initialized) return;
  if (!isSupabaseConfigured()) return;
  initialized = true;

  const SecureStore = loadSecureStore();
  if (!SecureStore) return;

  supabase.auth
    .getSession()
    .then(({ data }) => publish(SecureStore, data.session as any))
    .catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') void publish(SecureStore, null);
    else if (session) void publish(SecureStore, session as any);
  });
}

/** Explicit teardown for the logout choreography. Safe to call anywhere. */
export async function clearSharedSession(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const SecureStore = loadSecureStore();
  if (!SecureStore) return;
  await publish(SecureStore, null);
}
