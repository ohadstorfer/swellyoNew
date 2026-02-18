-- Enhance RLS policies for message edit/delete functionality
-- Prevents editing system messages at the database level

-- Step 1: Check for existing violations (system messages with edited = true)
-- If any exist, fix them first to ensure migration succeeds
DO $$
DECLARE
  violation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM public.messages
  WHERE is_system = true AND edited = true;
  
  IF violation_count > 0 THEN
    -- Fix existing violations: set edited = false for system messages
    UPDATE public.messages
    SET edited = false
    WHERE is_system = true AND edited = true;
    
    RAISE NOTICE 'Fixed % system message(s) that had edited = true', violation_count;
  ELSE
    RAISE NOTICE 'No violations found - all system messages have edited = false';
  END IF;
END $$;

-- Step 2: Drop constraint if it exists (idempotent)
ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS prevent_system_message_edit;

-- Step 3: Add constraint to prevent editing system messages
-- This ensures that even if application logic fails, database enforces the rule
ALTER TABLE public.messages
ADD CONSTRAINT prevent_system_message_edit
CHECK (
  -- If is_system is true, edited must remain false
  (is_system = true AND edited = false) OR is_system = false
);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT prevent_system_message_edit ON public.messages IS 
'Prevents system messages from being marked as edited. System messages should remain unchanged.';

-- Verify constraint was created
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.messages'::regclass
  AND conname = 'prevent_system_message_edit';

