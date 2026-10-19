-- Dedicated test cluster only. Verify identity before application.
-- NOLOGIN: credentials/HBA/real activation remain separate.
CREATE ROLE nva_meta_inbox_ingress NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
GRANT CONNECT ON DATABASE nva_whatsapp_test TO nva_meta_inbox_ingress;
GRANT USAGE ON SCHEMA public TO nva_meta_inbox_ingress;
GRANT SELECT ON public.meta_webhook_endpoints TO nva_meta_inbox_ingress;
GRANT UPDATE (id) ON public.meta_webhook_endpoints TO nva_meta_inbox_ingress;
GRANT SELECT, INSERT ON public.meta_webhook_receipts, public.meta_webhook_events,
  public.meta_webhook_receipt_items TO nva_meta_inbox_ingress;
GRANT UPDATE (item_count, new_count, duplicate_count, conflict_count)
  ON public.meta_webhook_receipts TO nva_meta_inbox_ingress;
GRANT UPDATE (receipt_count, last_received_at, has_conflict, review_required,
  state, failed_at, reason_code, next_attempt_at, lease_token, lease_owner, lease_expires_at)
  ON public.meta_webhook_events TO nva_meta_inbox_ingress;
GRANT USAGE ON SEQUENCE public.meta_webhook_events_enqueue_order_seq TO nva_meta_inbox_ingress;
GRANT EXECUTE ON FUNCTION public.meta_inbox_lock_endpoint(uuid) TO nva_meta_inbox_ingress;
