-- REVIEWED LOCALLY; production execution still requires DBA approval.
-- See docs/whatsapp-worker-sql-validation-20261023.md for isolated evidence and limits.
-- No schema migration, endpoint activation, password literal, PUBLIC revoke or data deletion.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF current_database() IS DISTINCT FROM 'english_center' OR NOT (
    (current_user = 'postgres' AND inet_server_addr() IS NULL AND inet_server_port() IS NULL)
    OR (inet_server_addr() IS NOT DISTINCT FROM '127.0.0.1'::inet
      AND inet_server_port() IS NOT DISTINCT FROM 5432)
  ) THEN RAISE EXCEPTION 'Wrong target; stop'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nva_meta_inbox_worker_prod') THEN
    RAISE EXCEPTION 'Role already exists; audit instead of overwriting';
  END IF;
  IF to_regprocedure('public.meta_inbox_lock_endpoint(uuid)') IS NULL OR
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
      AND t.tgenabled='O' AND t.tgname IN ('meta_endpoint_guard','meta_receipt_guard','meta_event_guard',
        'meta_item_guard','meta_receipt_complete','meta_item_complete','meta_new_event_complete')) <> 7
  THEN RAISE EXCEPTION 'Incomplete Meta safety SQL; stop'; END IF;
END $$;
CREATE ROLE nva_meta_inbox_worker_prod NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
GRANT CONNECT ON DATABASE english_center TO nva_meta_inbox_worker_prod;
GRANT USAGE ON SCHEMA public TO nva_meta_inbox_worker_prod;
GRANT SELECT ON public.meta_webhook_endpoints, public.meta_webhook_events,
  public.meta_webhook_receipts, public.meta_webhook_receipt_items TO nva_meta_inbox_worker_prod;
-- FOR UPDATE only; worker cannot activate processing or alter endpoint identity.
GRANT UPDATE (id) ON public.meta_webhook_endpoints TO nva_meta_inbox_worker_prod;
GRANT UPDATE (state,effect_outcome,reason_code,processing_attempts,consecutive_failures,
  next_attempt_at,lease_token,lease_owner,lease_expires_at,lease_generation,processed_at,
  failed_at,uncorrelated_since,review_required,payload_expires_at)
  ON public.meta_webhook_events TO nva_meta_inbox_worker_prod;
GRANT EXECUTE ON FUNCTION public.meta_inbox_lock_endpoint(uuid) TO nva_meta_inbox_worker_prod;
-- No password hash access and no enrollment/user/payment writes.
GRANT SELECT (id,phone_number,whatsapp_number,role,is_active,must_change_password)
  ON public.users TO nva_meta_inbox_worker_prod;
GRANT SELECT ON public.enrollments, public.courses, public.training_sessions,
  public.registration_groups, public."WhatsAppChatbotRule", public."WhatsAppChatbotSettings",
  public."WhatsAppScenario" TO nva_meta_inbox_worker_prod;
GRANT SELECT,INSERT ON public.whatsapp_conversations,
  public.whatsapp_preferences, public.whatsapp_prospect_follow_ups, public.notifications,
  public."WhatsAppChatbotAiBudget" TO nva_meta_inbox_worker_prod;
GRANT SELECT ON public."WhatsAppAdmissionRequest" TO nva_meta_inbox_worker_prod;
REVOKE INSERT ON public."WhatsAppAdmissionRequest" FROM nva_meta_inbox_worker_prod;
GRANT INSERT (id,"conversationId","fullName","phoneNumber",email,"requestedLevel",source,
 "consentAt","consentVersion","sourceMessageId","confirmationDraft","createdAt","updatedAt")
 ON public."WhatsAppAdmissionRequest" TO nva_meta_inbox_worker_prod;
GRANT SELECT ON public.whatsapp_conversation_messages TO nva_meta_inbox_worker_prod;
-- Only the admin application may create a message attributed to an advisor.
REVOKE INSERT ON public.whatsapp_conversation_messages FROM nva_meta_inbox_worker_prod;
GRANT INSERT (id,conversation_id,direction,message_type,body,provider_message_id,idempotency_key,
 provider_timestamp,received_at,processing_status,processing_started_at,processed_at,
 delivery_status,attempts,failure_code,created_at,updated_at,interactive_payload,text_fallback_pending)
 ON public.whatsapp_conversation_messages TO nva_meta_inbox_worker_prod;
GRANT UPDATE (user_id,assigned_advisor_id,control_state,engine_state,engine_version,
  handoff_at,resumed_at,closed_at,last_message_at,updated_at)
  ON public.whatsapp_conversations TO nva_meta_inbox_worker_prod;
GRANT UPDATE (body,interactive_payload,text_fallback_pending,provider_message_id,provider_timestamp,
  processing_status,processing_started_at,processed_at,delivery_status,attempts,failure_code,updated_at)
  ON public.whatsapp_conversation_messages TO nva_meta_inbox_worker_prod;
GRANT UPDATE (is_enabled,has_opted_in,opted_out_at,updated_at)
  ON public.whatsapp_preferences TO nva_meta_inbox_worker_prod;
GRANT UPDATE (status,provider_message_id,processing_started_at,sent_at,delivered_at,read_at,
  failed_at,cancelled_at,failure_code,updated_at)
  ON public.whatsapp_prospect_follow_ups TO nva_meta_inbox_worker_prod;
GRANT UPDATE ("fullName","phoneNumber",email,"requestedLevel","consentAt","confirmationDraft","updatedAt")
  ON public."WhatsAppAdmissionRequest" TO nva_meta_inbox_worker_prod;
GRANT UPDATE (calls) ON public."WhatsAppChatbotAiBudget" TO nva_meta_inbox_worker_prod;
GRANT SELECT,INSERT ON public.whatsapp_commercial_consent_events TO nva_meta_inbox_worker_prod;
GRANT SELECT ON public."WhatsAppAdmissionEvent" TO nva_meta_inbox_worker_prod;
REVOKE INSERT ON public."WhatsAppAdmissionEvent" FROM nva_meta_inbox_worker_prod;
GRANT EXECUTE ON FUNCTION public.nva_record_admission_consent(integer,text,jsonb) TO nva_meta_inbox_worker_prod;
REVOKE USAGE ON SEQUENCE public."WhatsAppAdmissionEvent_id_seq" FROM nva_meta_inbox_worker_prod;
-- Status callbacks and STOP cancellation only; no notification delivery creation.
GRANT SELECT ON public.whatsapp_deliveries TO nva_meta_inbox_worker_prod;
GRANT UPDATE (status,provider_message_id,processing_started_at,sent_at,delivered_at,read_at,
  failed_at,cancelled_at,failure_code,failure_reason,updated_at)
  ON public.whatsapp_deliveries TO nva_meta_inbox_worker_prod;
DO $$
DECLARE table_name text; seq_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_conversations','whatsapp_conversation_messages',
    'whatsapp_preferences','whatsapp_prospect_follow_ups','notifications',
    'WhatsAppAdmissionRequest','whatsapp_commercial_consent_events'] LOOP
    seq_name := pg_get_serial_sequence(format('public.%I',table_name),'id');
    IF seq_name IS NOT NULL THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO nva_meta_inbox_worker_prod',seq_name::regclass);
    END IF;
  END LOOP;
  IF has_database_privilege('nva_meta_inbox_worker_prod',current_database(),'CREATE,TEMP')
    OR has_schema_privilege('nva_meta_inbox_worker_prod','public','CREATE')
    OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND c.relkind IN ('r','p','v','m')
      AND has_table_privilege('nva_meta_inbox_worker_prod',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    OR has_any_column_privilege('nva_meta_inbox_worker_prod','public.users','INSERT,UPDATE,REFERENCES')
    OR has_column_privilege('nva_meta_inbox_worker_prod','public.users','password_hash','SELECT')
    OR has_column_privilege('nva_meta_inbox_worker_prod','public.whatsapp_conversation_messages','sender_user_id','INSERT,UPDATE')
    OR has_column_privilege('nva_meta_inbox_worker_prod','public."WhatsAppAdmissionRequest"','status','INSERT,UPDATE')
    OR has_any_column_privilege('nva_meta_inbox_worker_prod','public."WhatsAppAdmissionEvent"','INSERT,UPDATE')
  THEN RAISE EXCEPTION 'Inherited PUBLIC privileges violate isolation; rollback and DBA review'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
    AND c.relkind IN ('r','p','v','m')
    AND c.relname NOT IN ('meta_webhook_endpoints','meta_webhook_events','meta_webhook_receipts',
      'meta_webhook_receipt_items','users','enrollments','courses','training_sessions','registration_groups',
      'WhatsAppChatbotRule','WhatsAppChatbotSettings','WhatsAppScenario','whatsapp_conversations',
      'whatsapp_conversation_messages','whatsapp_preferences','whatsapp_prospect_follow_ups','notifications',
      'WhatsAppAdmissionRequest','WhatsAppChatbotAiBudget','whatsapp_commercial_consent_events',
      'WhatsAppAdmissionEvent','whatsapp_deliveries')
    AND (has_table_privilege('nva_meta_inbox_worker_prod',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('nva_meta_inbox_worker_prod',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  THEN RAISE EXCEPTION 'PUBLIC exposes unrelated objects; rollback and DBA review'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='S'
    AND (has_sequence_privilege('nva_meta_inbox_worker_prod',c.oid,'SELECT,UPDATE')
      OR (has_sequence_privilege('nva_meta_inbox_worker_prod',c.oid,'USAGE') AND c.oid NOT IN (
        SELECT pg_get_serial_sequence(format('public.%I',t),'id')::regclass FROM unnest(ARRAY[
          'whatsapp_conversations','whatsapp_conversation_messages','whatsapp_preferences',
          'whatsapp_prospect_follow_ups','notifications','WhatsAppAdmissionRequest',
          'whatsapp_commercial_consent_events']) t))))
  THEN RAISE EXCEPTION 'PUBLIC exposes unrelated sequence privileges; rollback and DBA review'; END IF;
  IF NOT has_function_privilege('nva_meta_inbox_worker_prod','pg_catalog.pg_advisory_xact_lock(bigint)','EXECUTE')
    OR NOT has_function_privilege('nva_meta_inbox_worker_prod','pg_catalog.clock_timestamp()','EXECUTE')
  THEN RAISE EXCEPTION 'Required built-in EXECUTE unavailable; DBA review'; END IF;
END $$;
COMMIT;
-- Separate credential provisioning AFTER authorization, using interactive psql only:
-- SET password_encryption = 'scram-sha-256';
-- \password nva_meta_inbox_worker_prod
-- ALTER ROLE nva_meta_inbox_worker_prod LOGIN;
-- Store the resulting URL privately; do not print it or share .env files.
-- Never grant this role to ingress, or application roles to this worker.
