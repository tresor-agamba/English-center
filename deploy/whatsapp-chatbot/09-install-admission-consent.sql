-- CANDIDATE: DBA execution only after explicit authorization and backups.
-- Run as the trusted table owner (or reviewed DBA), never SET ROLE worker.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT 1/(current_user=:'expected_consent_owner')::int AS approved_owner_confirmed;
DO $$
DECLARE owner_id oid;
BEGIN
 IF current_database()<>'english_center' OR NOT (
  (current_user='postgres' AND inet_server_addr() IS NULL)
  OR (inet_server_addr() IS NOT DISTINCT FROM '127.0.0.1'::inet
   AND inet_server_port() IS NOT DISTINCT FROM 5432))
 THEN RAISE EXCEPTION 'Wrong target'; END IF;
 IF current_user ~* '(meta.*(worker|ingress))'
  OR NOT has_table_privilege(current_user,'public."WhatsAppAdmissionRequest"','SELECT')
  OR NOT has_table_privilege(current_user,'public."WhatsAppAdmissionEvent"','INSERT')
  OR NOT has_sequence_privilege(current_user,'public."WhatsAppAdmissionEvent_id_seq"','USAGE')
 THEN RAISE EXCEPTION 'Trusted consent owner privileges required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)
  AND EXISTS(SELECT 1 FROM pg_class WHERE oid IN
   ('public."WhatsAppAdmissionRequest"'::regclass,'public."WhatsAppAdmissionEvent"'::regclass)
   AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
 THEN RAISE EXCEPTION 'Use the reviewed table owner or DBA'; END IF;
 SELECT proowner INTO owner_id FROM pg_proc
  WHERE oid=to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)');
 IF owner_id IS NOT NULL AND owner_id<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'Existing function has another owner; review separately'; END IF;
END $$;
\ir ../../docs/sql/whatsapp-admission-worker-consent-function.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid=to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)')
   AND a.grantee=0 AND a.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION 'PUBLIC consent execution forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='nva_meta_inbox_ingress_prod'
  AND has_function_privilege(r.oid,to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)'),'EXECUTE'))
 THEN RAISE EXCEPTION 'Ingress consent execution forbidden; inspect default/inherited grants'; END IF;
END $$;
COMMIT;
