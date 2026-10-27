-- NVA V3: idempotent COLUMN grants only. No activation or data writes.
-- Apply manually on the reviewed NVA target, after canonical worker provisioning.
-- Laboratory adaptations change database/port only, never role/grant semantics.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF current_database() IS DISTINCT FROM 'english_center' OR NOT (
    (current_user = 'postgres' AND inet_server_addr() IS NULL AND inet_server_port() IS NULL)
    OR (inet_server_addr() IS NOT DISTINCT FROM '127.0.0.1'::inet AND inet_server_port() IS NOT DISTINCT FROM 5432)
  ) THEN RAISE EXCEPTION 'Wrong NVA target; stop'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nva_meta_inbox_worker_prod'
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
    AND NOT rolbypassrls AND NOT rolinherit)
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='nva_meta_inbox_worker_prod'))
  THEN RAISE EXCEPTION 'Unsafe or missing NVA worker role; audit first'; END IF;
  IF to_regclass('public.whatsapp_prospect_follow_ups') IS NULL THEN RAISE EXCEPTION 'Missing follow-up table'; END IF;
  IF has_table_privilege('nva_meta_inbox_worker_prod','public.whatsapp_prospect_follow_ups','UPDATE,DELETE,TRUNCATE')
    OR has_column_privilege('nva_meta_inbox_worker_prod','public.users','password_hash','SELECT')
    OR has_any_column_privilege('nva_meta_inbox_worker_prod','public.enrollments','INSERT,UPDATE')
    OR has_column_privilege('nva_meta_inbox_worker_prod','public."WhatsAppAdmissionRequest"','status','INSERT,UPDATE')
  THEN RAISE EXCEPTION 'Unexpected broad worker privileges; audit instead of changing them'; END IF;
END $$;
-- Inbound: reset deadline and template locale after a new message.
-- Sender: atomically claim an attempt and record provider acceptance.
GRANT UPDATE (scheduled_for,template_name,template_language,attempts,accepted_at)
  ON public.whatsapp_prospect_follow_ups TO nva_meta_inbox_worker_prod;
COMMIT;
