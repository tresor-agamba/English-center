-- CANDIDATE ONLY: scoped permission repair for an EXISTING reviewed worker role.
-- Also restrict INSERT author attribution to the existing admin application.
-- Never execute blindly, never use the laboratory bootstrap authentication.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE r record;
BEGIN
 IF current_database() IS DISTINCT FROM 'english_center' OR NOT (
   (current_user='postgres' AND inet_server_addr() IS NULL)
   OR (inet_server_addr() IS NOT DISTINCT FROM '127.0.0.1'::inet AND inet_server_port() IS NOT DISTINCT FROM 5432)
 ) THEN RAISE EXCEPTION 'Wrong target; stop'; END IF;
 SELECT * INTO r FROM pg_roles WHERE rolname='nva_meta_inbox_worker_prod';
 IF NOT FOUND OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
 THEN RAISE EXCEPTION 'Missing or unsafe worker role; stop'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
 THEN RAISE EXCEPTION 'Unexpected role membership; stop'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='WhatsAppAdmissionRequest' AND column_name='confirmationDraft')
 THEN RAISE EXCEPTION 'Missing admission migration; stop'; END IF;
END $$;
GRANT UPDATE ("confirmationDraft") ON public."WhatsAppAdmissionRequest" TO nva_meta_inbox_worker_prod;
REVOKE INSERT ON public."WhatsAppAdmissionRequest" FROM nva_meta_inbox_worker_prod;
GRANT INSERT (id,"conversationId","fullName","phoneNumber",email,"requestedLevel",source,
 "consentAt","consentVersion","sourceMessageId","confirmationDraft","createdAt","updatedAt")
 ON public."WhatsAppAdmissionRequest" TO nva_meta_inbox_worker_prod;
REVOKE INSERT ON public.whatsapp_conversation_messages FROM nva_meta_inbox_worker_prod;
GRANT INSERT (id,conversation_id,direction,message_type,body,provider_message_id,idempotency_key,
 provider_timestamp,received_at,processing_status,processing_started_at,processed_at,
 delivery_status,attempts,failure_code,created_at,updated_at,interactive_payload,text_fallback_pending)
 ON public.whatsapp_conversation_messages TO nva_meta_inbox_worker_prod;
REVOKE INSERT ON public."WhatsAppAdmissionEvent" FROM nva_meta_inbox_worker_prod;
GRANT EXECUTE ON FUNCTION public.nva_record_admission_consent(integer,text,jsonb) TO nva_meta_inbox_worker_prod;
REVOKE USAGE ON SEQUENCE public."WhatsAppAdmissionEvent_id_seq" FROM nva_meta_inbox_worker_prod;
DO $$ BEGIN
 IF has_column_privilege('nva_meta_inbox_worker_prod','public.whatsapp_conversation_messages','sender_user_id','INSERT,UPDATE')
 OR has_column_privilege('nva_meta_inbox_worker_prod','public."WhatsAppAdmissionRequest"','status','INSERT,UPDATE')
 OR has_any_column_privilege('nva_meta_inbox_worker_prod','public."WhatsAppAdmissionEvent"','INSERT,UPDATE')
 THEN RAISE EXCEPTION 'Inherited author/decision privilege; stop and review'; END IF;
END $$;
COMMIT;
