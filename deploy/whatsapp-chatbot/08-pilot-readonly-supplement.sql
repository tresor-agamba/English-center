-- READ ONLY supplement to existing 03/04/05 diagnostics; never installs/repairs.
-- Required psql vars: expected_database, nva_app_role, nva_ingress_role, nva_worker_role.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT 1/(current_database()=:'expected_database')::int AS target_confirmed,
 current_database() AS database,current_user AS diagnostic_role,
 inet_server_port() AS server_port,current_setting('transaction_read_only') AS readonly;

SELECT to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)') IS NOT NULL AS consent_function_present;
SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,md5(p.proconfig::text) AS settings_md5,
 (p.proconfig=ARRAY['search_path=pg_catalog']::text[]) AS expected_search_path_only,
 md5(p.prosrc) AS source_body_md5,
 EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
FROM pg_proc p WHERE p.oid=to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)');

WITH names(role) AS (VALUES(:'nva_app_role'),(:'nva_ingress_role'),(:'nva_worker_role'))
SELECT n.role,r.oid IS NOT NULL AS role_present,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
 has_function_privilege(r.oid,to_regprocedure('public.nva_record_admission_consent(integer,text,jsonb)'),'EXECUTE') AS consent_execute,
 has_column_privilege(r.oid,to_regclass('public."WhatsAppAdmissionRequest"'),'confirmationDraft','UPDATE') AS draft_update,
 has_column_privilege(r.oid,to_regclass('public."WhatsAppAdmissionRequest"'),'status','INSERT,UPDATE') AS decision_write,
 has_column_privilege(r.oid,to_regclass('public.whatsapp_conversation_messages'),'sender_user_id','INSERT,UPDATE') AS author_write,
 has_any_column_privilege(r.oid,to_regclass('public."WhatsAppAdmissionEvent"'),'INSERT,UPDATE') AS admission_event_write,
 has_column_privilege(r.oid,to_regclass('public.users'),'password_hash','SELECT') AS password_hash_read
FROM names n LEFT JOIN pg_roles r ON r.rolname=n.role ORDER BY n.role;

-- Metadata only; VALID does not prove a successful restoration.
SELECT CASE WHEN to_regclass('public.database_backups') IS NULL
 THEN 'SELECT ''BACKUP_REGISTRY_ABSENT'' AS backup_registry;'
 ELSE 'SELECT id,status,size_bytes,checksum_sha256,postgres_version,verification_status,last_verified_at,completed_at FROM public.database_backups WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;'
 END AS diagnostic_query
\gexec

-- Small bounded sample. No body, recipient, provider ID, token or session data.
SELECT CASE WHEN to_regclass('public.whatsapp_conversation_messages') IS NULL
 THEN 'SELECT ''MESSAGE_HISTORY_ABSENT'' AS message_history;'
 ELSE 'SELECT direction,delivery_status,count(*) AS sample_count,max(updated_at) AS last_update FROM (SELECT direction,delivery_status,updated_at FROM public.whatsapp_conversation_messages ORDER BY id DESC LIMIT 1000) recent GROUP BY direction,delivery_status ORDER BY direction,delivery_status;'
 END AS diagnostic_query
\gexec
COMMIT;
