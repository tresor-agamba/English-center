-- READ ONLY. No business row values, secrets, DDL, DML or advisory locks.
-- psql -X -v expected_database=english_center -v nva_app_role=APP_ROLE
--   -v nva_ingress_role=nva_meta_inbox_ingress_prod
--   -v nva_worker_role=nva_meta_inbox_worker_prod -f this-file
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT 1 / (current_database() = :'expected_database')::int AS target_confirmed,
  current_database() AS database,current_setting('port') AS server_port,
  current_setting('server_version') AS postgres_version,
  current_setting('transaction_read_only') AS read_only,
  current_setting('TimeZone') AS diagnostic_timezone;
-- Timezone defaults for the database/roles: never output other role settings.
SELECT COALESCE(d.datname,'ALL_DATABASES') AS database_scope,
  COALESCE(r.rolname,'ALL_ROLES') AS role_scope, split_part(setting,'=',2) AS timezone
FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase
LEFT JOIN pg_roles r ON r.oid=s.setrole CROSS JOIN LATERAL unnest(s.setconfig) setting
WHERE lower(split_part(setting,'=',1))='timezone'
  AND s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
  AND (s.setrole=0 OR r.rolname IN (:'nva_app_role',:'nva_ingress_role',:'nva_worker_role'));

\echo === Dedicated roles and inherited privileges ===
WITH expected(name) AS (VALUES (:'nva_ingress_role'),(:'nva_worker_role'))
SELECT e.name,r.oid IS NOT NULL AS present,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
 r.rolreplication,r.rolbypassrls,r.rolinherit,r.rolconnlimit,
 EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
 has_database_privilege(r.oid,current_database(),'CREATE,TEMP') AS database_create_or_temp,
 has_schema_privilege(r.oid,'public','CREATE') AS schema_create
FROM expected e LEFT JOIN pg_roles r ON r.rolname=e.name ORDER BY e.name;

\echo === Effective table privileges, including PUBLIC ===
SELECT r.rolname,c.relname,c.relowner=r.oid AS owner,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege(r.oid,c.oid,'SELECT') AS sel,
 has_table_privilege(r.oid,c.oid,'INSERT') AS ins,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS full_update,
 has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden,
 has_any_column_privilege(r.oid,c.oid,'UPDATE') AS some_column_update
FROM pg_roles r CROSS JOIN pg_class c
WHERE r.rolname IN (:'nva_ingress_role',:'nva_worker_role')
 AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
ORDER BY r.rolname,c.relname;
-- Full effective column rights, even when granted at table level or through PUBLIC.
SELECT r.rolname,c.relname,a.attname,
 has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS sel,
 has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS ins,
 has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS upd,
 has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES') AS refs
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
WHERE r.rolname IN (:'nva_ingress_role',:'nva_worker_role')
 AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
 AND a.attnum>0 AND NOT a.attisdropped
 AND (has_column_privilege(r.oid,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))
ORDER BY r.rolname,c.relname,a.attnum;
SELECT r.rolname,c.relname,has_sequence_privilege(r.oid,c.oid,'USAGE') AS usage,
 has_sequence_privilege(r.oid,c.oid,'SELECT,UPDATE') AS excessive
FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname IN (:'nva_ingress_role',:'nva_worker_role')
 AND c.relnamespace='public'::regnamespace AND c.relkind='S' ORDER BY r.rolname,c.relname;
-- An unexpected SECURITY DEFINER function callable through PUBLIC needs DBA review.
-- No source body or role configuration is printed.
SELECT r.rolname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef,pg_get_userbyid(p.proowner) AS function_owner
FROM pg_roles r CROSS JOIN pg_proc p
WHERE r.rolname IN (:'nva_ingress_role',:'nva_worker_role')
 AND p.pronamespace='public'::regnamespace
 AND (p.proname LIKE 'meta\_inbox\_%' ESCAPE '\' OR p.prosecdef)
 AND has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY r.rolname,p.proname;

\echo === HTTP session preservation: metadata only, never sid or sess values ===
SELECT to_regclass('public.http_sessions') IS NOT NULL AS http_sessions_present;
SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
FROM pg_attribute a WHERE a.attrelid=to_regclass('public.http_sessions')
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
SELECT indexname,md5(indexdef) AS definition_md5 FROM pg_indexes WHERE schemaname='public' AND tablename='http_sessions';
SELECT r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') AS sel,
 has_table_privilege(r.oid,c.oid,'INSERT') AS ins,has_table_privilege(r.oid,c.oid,'UPDATE') AS upd,
 has_table_privilege(r.oid,c.oid,'DELETE') AS del
FROM pg_roles r CROSS JOIN pg_class c WHERE c.oid=to_regclass('public.http_sessions')
 AND r.rolname IN (:'nva_app_role',:'nva_ingress_role',:'nva_worker_role');

\echo === Datetime types used in outgoing selection ===
SELECT table_name,column_name,data_type,datetime_precision
FROM information_schema.columns WHERE table_schema='public'
 AND ((table_name='whatsapp_conversation_messages' AND column_name IN ('created_at','updated_at','provider_timestamp'))
   OR (table_name='meta_webhook_events' AND column_name IN ('first_received_at','lease_expires_at')))
ORDER BY table_name,column_name;
COMMIT;
