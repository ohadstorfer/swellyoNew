// Deno types declaration for Supabase Edge Functions
// This file provides type declarations so TypeScript doesn't error on Deno-specific code

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): { [key: string]: string };
  }
  export const env: Env;
}

// Deno std library server module
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

// Supabase JS from esm.sh
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
