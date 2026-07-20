import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Get Supabase credentials from environment variables
// Trim whitespace to handle any formatting issues
// Exported so the iOS share extension's config blob (shareRecentsCache) can carry
// them into the App Group container — the anon key is public by design.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

// Validate that credentials are provided and valid
const validateUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const missingVars = [];
  if (!SUPABASE_URL) missingVars.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missingVars.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  
  console.error(
    `⚠️ Supabase configuration error: Missing environment variables: ${missingVars.join(', ')}\n` +
    `Please create a .env file in the root directory with:\n` +
    `EXPO_PUBLIC_SUPABASE_URL=your_supabase_url\n` +
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key\n\n` +
    `After updating .env, restart your development server.`
  );
}

if (SUPABASE_URL && !validateUrl(SUPABASE_URL)) {
  console.error(
    `⚠️ Supabase configuration error: Invalid URL format: "${SUPABASE_URL}"\n` +
    `The URL must be a valid HTTP or HTTPS URL (e.g., https://xxxxx.supabase.co)`
  );
}

// Only create client if we have valid credentials
// This prevents the error from crashing the app if Supabase isn't configured
let supabaseClient: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY && validateUrl(SUPABASE_URL)) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce', // Recommended for mobile apps
      },
      global: {
        headers: {
          'x-client-info': `swellyo@1.0.0`,
        },
      },
      realtime: {
        params: { eventsPerSecond: 10 },   // pin the client→server event rate (10 = current default)
        heartbeatIntervalMs: 45000,        // lengthen socket keepalive (default 30s) to trim traffic at scale
        // Jittered backoff for socket reconnect AND every channel's rejoin
        // timer (RealtimeChannel shares this function via socket.reconnectAfterMs).
        // The library default is a fixed [1s,2s,5s,10s] with NO jitter, so after
        // a socket error every open channel re-joined in the same JS macrotask —
        // an O(N²) synchronous burst that pegged the JS thread on loaded
        // sessions (js-thread-freeze-spec.md). Jitter spreads the rejoins out.
        reconnectAfterMs: (tries: number) =>
          ([1000, 2000, 5000, 10000][tries - 1] ?? 10000) + Math.floor(Math.random() * 1500),
      },
    });

    // Dev-only: log WebSocket lifecycle so channel-level cascades are
    // distinguishable from socket-level failures. If the next incident
    // shows [Realtime] socket CLOSED with no foreground/background event,
    // the cause is socket-level (JWT / network / server kill) rather than
    // per-channel — fixes need to target the realtime transport.
    if (__DEV__ && supabaseClient) {
      const rt: any = (supabaseClient as any).realtime;
      try {
        // Endpoint + token presence at boot — confirms WHERE the socket dials and
        // whether it has an auth token. A wss:// URL that never OPENs points at the
        // network/proxy blocking WebSocket upgrades (REST over https still works).
        console.log('[Realtime] endpoint:', rt?.endPoint ?? rt?.endpointURL?.() ?? 'unknown');
        console.log('[Realtime] hasAccessToken:', !!(rt?.accessTokenValue ?? rt?.accessToken));
        rt?.onOpen?.(() => console.log('[Realtime] socket OPEN'));
        // Close event carries code + reason — the single most useful datum:
        //   1006 = abnormal (network/proxy blocked the upgrade, never connected)
        //   1000 = normal close (often server-side auth/JWT rejection)
        //   4xxx = Supabase app-level (e.g. token/limit)
        rt?.onClose?.((e: any) =>
          console.log('[Realtime] socket CLOSED', { code: e?.code, reason: e?.reason || '(none)' })
        );
        rt?.onError?.((err: any) =>
          console.log('[Realtime] socket ERROR', err?.message ?? String(err))
        );
      } catch (_) {
        // diagnostic only
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to create Supabase client:', error);
    console.error('Please check your EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  }
} else {
  // Create a dummy client that will fail gracefully
  console.warn('⚠️ Supabase not properly configured. Some features may not work.');
  try {
    supabaseClient = createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: false,
        persistSession: false,
    detectSessionInUrl: false,
  },
});
  } catch {
    // If even the placeholder fails, we'll handle it in the code
  }
}

export const supabase: SupabaseClient = supabaseClient!;

// Helper function to check if Supabase is properly configured
export const isSupabaseConfigured = (): boolean => {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && 
    SUPABASE_URL !== 'YOUR_SUPABASE_URL' && 
    SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY' &&
    !SUPABASE_URL.includes('placeholder') &&
    validateUrl(SUPABASE_URL) &&
    supabaseClient !== null);
};

// Log configuration status in development
if (__DEV__) {
  console.log('Supabase Configuration:', {
    isConfigured: isSupabaseConfigured(),
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_ANON_KEY,
    platform: Platform.OS,
  });
}
