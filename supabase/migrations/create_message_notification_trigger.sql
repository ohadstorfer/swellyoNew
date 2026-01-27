-- Create database trigger to call edge function when new message is inserted
-- This trigger will fire after a message is inserted and call the edge function

-- Function to call the edge function via HTTP
-- Note: This requires pg_net extension or Supabase webhooks to be configured
CREATE OR REPLACE FUNCTION notify_message_email()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  response_status int;
  response_content text;
  edge_function_url text;
  service_role_key text;
BEGIN
  -- Only process non-system, non-deleted messages
  IF NEW.is_system = true OR NEW.deleted = true THEN
    RETURN NEW;
  END IF;

  -- Build payload
  payload := jsonb_build_object(
    'message_id', NEW.id,
    'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id
  );

  -- Try to get edge function URL and service role key from settings
  -- These should be configured in Supabase Dashboard -> Settings -> Database -> Custom Config
  BEGIN
    edge_function_url := current_setting('app.settings.edge_function_url', true);
    service_role_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    -- If settings not available, construct URL from Supabase URL pattern
    -- You'll need to set these in Supabase Dashboard -> Settings -> Database
    edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-message-notification';
    service_role_key := current_setting('app.settings.service_role_key', true);
  END;

  -- Call edge function via pg_net extension (if available)
  BEGIN
    SELECT status, content INTO response_status, response_content
    FROM net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := payload::text
    );

    -- Log if there was an error (non-2xx status)
    IF response_status < 200 OR response_status >= 300 THEN
      RAISE WARNING 'Edge function call failed: status %, content %', response_status, response_content;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net not available or other error
    -- Use Supabase webhooks instead (configure in Dashboard -> Database -> Webhooks)
    RAISE WARNING 'pg_net extension not available or error calling edge function: %. Use Supabase webhooks instead.', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the message insert
    RAISE WARNING 'Error calling email notification function: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_message_email ON public.messages;
CREATE TRIGGER trigger_notify_message_email
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_email();

-- Alternative Setup: If pg_net is not available, use Supabase's database webhooks
-- 1. Go to Supabase Dashboard -> Database -> Webhooks
-- 2. Create a new webhook:
--    - Table: messages
--    - Events: INSERT
--    - Type: HTTP Request
--    - URL: https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification
--    - HTTP Method: POST
--    - HTTP Headers: 
--      - Authorization: Bearer YOUR_SERVICE_ROLE_KEY
--      - Content-Type: application/json
--    - HTTP Body: 
--      {
--        "message_id": "{{ $1.id }}",
--        "conversation_id": "{{ $1.conversation_id }}",
--        "sender_id": "{{ $1.sender_id }}"
--      }
