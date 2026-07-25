-- Operator Trips — new notification types.
--
-- MUST run alone, before 20260724000100. `alter type ... add value` cannot be
-- used by code in the same transaction that adds it.
--
-- Reuses the live push queue: public.notifications -> tg_enqueue_push ->
-- notification_queue -> dispatch-notification-queue. No second system.

alter type public.notification_type add value if not exists 'operator_requirement_added';
alter type public.notification_type add value if not exists 'operator_requirement_due_soon';
alter type public.notification_type add value if not exists 'operator_requirement_overdue';
alter type public.notification_type add value if not exists 'operator_requirement_overdue_operator';
alter type public.notification_type add value if not exists 'operator_document_rejected';
alter type public.notification_type add value if not exists 'operator_document_approved';
