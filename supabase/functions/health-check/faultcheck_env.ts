// Side-effect module: sets dummy env vars BEFORE any check module is imported.
// aws.ts reads AWS_* at module-load time, so this MUST be imported first in
// faultcheck_test.ts (ES module import order is preserved, and a side-effect
// import placed before the check imports evaluates first).
//
// None of these are real secrets — they only satisfy the checks' env guards.
// All network I/O is stubbed in the test, so these values never leave the test.
Deno.env.set("SUPABASE_URL", "https://stub.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy");
Deno.env.set("SUPABASE_ANON_KEY", "dummy");
Deno.env.set("OPENAI_API_KEY", "dummy");
Deno.env.set("GOOGLE_GEOCODING_API_KEY", "dummy");
Deno.env.set("AWS_ACCESS_KEY_ID", "dummy");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "dummy");
Deno.env.set("AWS_REGION", "us-east-1");
Deno.env.set("AWS_S3_BUCKET", "dummy-bucket");
