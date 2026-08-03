import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase settings. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  );
}

/**
 * The one Supabase client for the whole site.
 *
 * PKCE + detectSessionInUrl is the browser OAuth flow: Google redirects back
 * here with a `?code=`, and the client swaps it for a session automatically.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** The private bucket holding every traveler document. Never public. */
export const DOCUMENTS_BUCKET = 'group-trip-documents';
