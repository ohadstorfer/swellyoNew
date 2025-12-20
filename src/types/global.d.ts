// Global type declarations for Vite environment variables
// This supports the auto-generated Supabase client

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID: string;
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
