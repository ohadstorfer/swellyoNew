import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Get Supabase credentials from environment variables
// Trim whitespace to handle any formatting issues
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

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
    });
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
