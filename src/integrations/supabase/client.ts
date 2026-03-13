// Re-export from the canonical Supabase client to prevent dual-instance issues.
// There should be exactly one Supabase client instance in the entire application.
export { supabase } from '../../config/supabase';
