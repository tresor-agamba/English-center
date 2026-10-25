-- DIAGNOSTIC ONLY. No DDL, DML, application imports, workers or lock functions.
-- psql -X -v expected_database=... -v nva_app_role=... -v nva_ingress_role=... -f this-file
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT 1 / (current_database() = :'expected_database')::int AS expected_database_confirmed;
SELECT current_database() AS database, current_user AS diagnostic_role,
       host(inet_server_addr()) AS server_address, inet_server_port() AS server_port,
       current_setting('server_version') AS postgres_version,
       current_setting('transaction_read_only') AS read_only;

\echo === Migration history: no error logs or connection strings ===
SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL
  THEN 'SELECT ''ABSENT'' AS prisma_history;'
  ELSE 'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM public._prisma_migrations ORDER BY migration_name;'
END AS diagnostic_query
\gexec

\echo === Required relations (missing is reported, never repaired) ===
WITH expected(name) AS (VALUES
  ('users'),('courses'),('training_sessions'),('registration_groups'),('enrollments'),
  ('http_sessions'),('notifications'),('scheduled_reminders'),('whatsapp_deliveries'),('whatsapp_conversations'),
  ('whatsapp_conversation_messages'),('whatsapp_preferences'),
  ('whatsapp_commercial_consent_events'),('whatsapp_prospect_follow_ups'),
  ('meta_webhook_endpoints'),('meta_webhook_receipts'),('meta_webhook_events'),
  ('meta_webhook_receipt_items'),('meta_webhook_events_enqueue_order_seq'),
  ('WhatsAppChatbotRule'),('WhatsAppChatbotSettings'),('WhatsAppChatbotAiBudget'),
  ('WhatsAppScenario'),('WhatsAppAdmissionRequest'),('WhatsAppAdmissionEvent'),
  ('provider_applications'),('provider_deliveries'),('provider_send_attempts'),
  ('provider_message_aliases'),('provider_webhook_events'),('provider_reconciliation_audits'))
SELECT name, to_regclass(format('public.%I',name)) IS NOT NULL AS present
FROM expected ORDER BY name;

\echo === Column definitions only; no row values ===
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, character_maximum_length, numeric_precision, numeric_scale,
       datetime_precision, md5(column_default) AS column_default_md5
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('courses','training_sessions','registration_groups','http_sessions',
  'meta_webhook_endpoints','meta_webhook_receipts','meta_webhook_events','meta_webhook_receipt_items',
  'WhatsAppChatbotRule','WhatsAppChatbotSettings','WhatsAppChatbotAiBudget',
  'WhatsAppScenario','WhatsAppAdmissionRequest','WhatsAppAdmissionEvent',
  'whatsapp_conversation_messages')
ORDER BY table_name,ordinal_position;

\echo === Constraints: validation, referential actions, deferred checks ===
SELECT c.relname AS table_name,k.conname,k.contype,k.convalidated,
       k.condeferrable,k.condeferred,md5(pg_get_constraintdef(k.oid)) AS definition_md5
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND (c.relname LIKE 'meta\_webhook\_%' ESCAPE '\'
 OR c.relname IN ('WhatsAppAdmissionRequest','WhatsAppAdmissionEvent','WhatsAppScenario',
 'lessons','http_sessions','academic_enrollments','student_invoices','student_payments'))
ORDER BY c.relname,k.conname;

\echo === Indexes: include partial predicates, validity and readiness ===
SELECT t.relname AS table_name,c.relname AS index_name,i.indisunique,
       i.indisvalid,i.indisready,md5(pg_get_indexdef(i.indexrelid)) AS definition_md5,
       md5(pg_get_expr(i.indpred,i.indrelid)) AS partial_predicate_md5
FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND (t.relname LIKE 'meta\_webhook\_%' ESCAPE '\'
 OR t.relname IN ('WhatsAppAdmissionRequest','WhatsAppAdmissionEvent','WhatsAppScenario',
 'lessons','lesson_progress','training_session_teachers','http_sessions'))
ORDER BY t.relname,c.relname;

\echo === Seven required Meta triggers (presence alone is insufficient) ===
WITH expected(name) AS (VALUES ('meta_endpoint_guard'),('meta_receipt_guard'),
 ('meta_event_guard'),('meta_item_guard'),('meta_receipt_complete'),
 ('meta_item_complete'),('meta_new_event_complete'))
SELECT e.name,t.oid IS NOT NULL AS present,c.relname,t.tgenabled,
       t.tgdeferrable,t.tginitdeferred,md5(pg_get_triggerdef(t.oid)) AS definition_md5
FROM expected e LEFT JOIN (pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public')
 ON t.tgname=e.name AND NOT t.tgisinternal ORDER BY e.name;

\echo === Meta functions: identity, security and definition digest; never executed ===
WITH expected(name) AS (VALUES ('meta_inbox_lock_endpoint'),('meta_inbox_endpoint_guard'),
 ('meta_inbox_receipt_guard'),('meta_inbox_event_guard'),('meta_inbox_item_guard'),
 ('meta_inbox_check_manifest'),('meta_inbox_check_new_event'))
SELECT e.name,p.oid IS NOT NULL AS present,pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,md5(p.proconfig::text) AS function_settings_md5,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM expected e LEFT JOIN (pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public')
 ON p.proname=e.name ORDER BY e.name,arguments;

\echo === Application/ingress roles: no password attributes ===
WITH expected(name) AS (VALUES (:'nva_app_role'),(:'nva_ingress_role'))
SELECT e.name,r.oid IS NOT NULL AS present,r.rolcanlogin,r.rolsuper,r.rolcreatedb,
       r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
       EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships,
       has_database_privilege(r.oid,d.oid,'CONNECT') AS can_connect,
       has_database_privilege(r.oid,d.oid,'CREATE') AS can_create_schema,
       has_database_privilege(r.oid,d.oid,'TEMP') AS can_create_temp,
       has_schema_privilege(r.oid,n.oid,'CREATE') AS can_create_in_public
FROM expected e LEFT JOIN pg_roles r ON r.rolname=e.name
CROSS JOIN pg_database d CROSS JOIN pg_namespace n
WHERE d.datname=current_database() AND n.nspname='public' ORDER BY e.name;

\echo === Effective relation privileges, including inherited PUBLIC grants ===
SELECT r.rolname,c.relname,c.relowner=r.oid AS owns_relation,
 has_table_privilege(r.oid,c.oid,'SELECT') AS sel,
 has_table_privilege(r.oid,c.oid,'INSERT') AS ins,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS upd,
 has_table_privilege(r.oid,c.oid,'DELETE') AS del,
 has_table_privilege(r.oid,c.oid,'TRUNCATE,REFERENCES,TRIGGER') AS dangerous_extra,
 has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS any_column_privilege
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN (:'nva_app_role',:'nva_ingress_role') AND n.nspname='public'
 AND c.relkind IN ('r','p','v','m') ORDER BY r.rolname,c.relname;
SELECT r.rolname,c.relname,has_sequence_privilege(r.oid,c.oid,'USAGE') AS usage,
 has_sequence_privilege(r.oid,c.oid,'SELECT') AS sel,
 has_sequence_privilege(r.oid,c.oid,'UPDATE') AS upd
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN (:'nva_app_role',:'nva_ingress_role') AND n.nspname='public'
 AND c.relkind='S' ORDER BY r.rolname,c.relname;
-- Read pg_catalog ACLs directly: information_schema can hide other roles' grants.
SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
 c.relname AS table_name,a.attname AS column_name,acl.privilege_type,acl.is_grantable
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(NULLIF(a.attacl,'{}'::aclitem[])) acl
WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
 AND (acl.grantee=0 OR acl.grantee IN
  (SELECT oid FROM pg_roles WHERE rolname IN (:'nva_app_role',:'nva_ingress_role')))
ORDER BY grantee,c.relname,a.attname,acl.privilege_type;
SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
 c.relname AS object_name,acl.privilege_type,acl.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(NULLIF(c.relacl,'{}'::aclitem[])) acl
WHERE n.nspname='public' AND acl.is_grantable AND
 (acl.grantee=0 OR acl.grantee IN
  (SELECT oid FROM pg_roles WHERE rolname IN (:'nva_app_role',:'nva_ingress_role')))
ORDER BY grantee,c.relname,acl.privilege_type;
SELECT r.rolname,p.proname,has_function_privilege(r.oid,p.oid,'EXECUTE') AS executable
FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE r.rolname IN (:'nva_app_role',:'nva_ingress_role')
 AND ((n.nspname='public' AND p.proname LIKE 'meta\_inbox\_%' ESCAPE '\')
 OR (n.nspname='pg_catalog' AND p.proname IN ('clock_timestamp','pg_advisory_xact_lock')))
ORDER BY r.rolname,p.proname;
COMMIT;
