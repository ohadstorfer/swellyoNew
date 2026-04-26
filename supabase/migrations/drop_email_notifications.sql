-- Remove the email-notifications system entirely.
-- Push notifications (via send-push-notification Edge Function) are the only
-- notification channel going forward. Web is no longer supported.
--
-- Run this in the Supabase SQL editor. After running, also delete the
-- send-message-notification Edge Function from the dashboard, and remove
-- any database webhook that points to it.

-- Drop the AFTER INSERT trigger on messages and its function
DROP TRIGGER IF EXISTS trigger_notify_message_email ON public.messages;
DROP FUNCTION IF EXISTS public.notify_message_email();

-- Drop the email-batching tracking table
DROP TABLE IF EXISTS public.message_email_notifications;

-- Drop the is_mobile_user column from surfers — it was only used by the
-- email function to decide whether to skip a recipient.
ALTER TABLE public.surfers DROP COLUMN IF EXISTS is_mobile_user;
