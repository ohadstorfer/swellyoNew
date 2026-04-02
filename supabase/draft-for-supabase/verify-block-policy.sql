-- Check the policy exists and is RESTRICTIVE
SELECT policyname, cmd, permissive, qual FROM pg_policies WHERE tablename = 'surfers' AND policyname = 'surfers_block_filter';
