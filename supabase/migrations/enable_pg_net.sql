-- Enable pg_net extension to allow database functions to make HTTP calls
-- This is required for the process_ready_email_batches() function to call the edge function

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Verify it was enabled
SELECT extname, extversion 
FROM pg_extension 
WHERE extname = 'pg_net';

