-- REVIEW ONLY. Run later with psql against the explicitly approved VPS database.
-- No passwords, business grants, PUBLIC revokes, table creation or migrations.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF current_database() <> 'english_center' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 5432 THEN
    RAISE EXCEPTION 'Wrong production target; stop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nva_meta_inbox_ingress_prod') THEN
    RAISE EXCEPTION 'Role already exists; audit it instead of overwriting';
  END IF;
  IF to_regclass('public.meta_webhook_endpoints') IS NULL
    OR to_regclass('public.meta_webhook_receipts') IS NULL
    OR to_regclass('public.meta_webhook_events') IS NULL
    OR to_regclass('public.meta_webhook_receipt_items') IS NULL
    OR to_regclass('public.meta_webhook_events_enqueue_order_seq') IS NULL
    OR to_regprocedure('public.meta_inbox_lock_endpoint(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Incomplete Meta SQL deployment; stop, do not improvise a migration';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
      AND t.tgenabled='O' AND t.tgname IN ('meta_endpoint_guard','meta_receipt_guard','meta_event_guard',
        'meta_item_guard','meta_receipt_complete','meta_item_complete','meta_new_event_complete')) <> 7 THEN
    RAISE EXCEPTION 'Missing or disabled Meta safety triggers; stop';
  END IF;
END $$;
CREATE ROLE nva_meta_inbox_ingress_prod NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
GRANT CONNECT ON DATABASE english_center TO nva_meta_inbox_ingress_prod;
GRANT USAGE ON SCHEMA public TO nva_meta_inbox_ingress_prod;
GRANT SELECT ON public.meta_webhook_endpoints TO nva_meta_inbox_ingress_prod;
-- Needed by SELECT FOR UPDATE. The existing endpoint trigger forbids identity changes.
GRANT UPDATE (id) ON public.meta_webhook_endpoints TO nva_meta_inbox_ingress_prod;
GRANT SELECT, INSERT ON public.meta_webhook_receipts, public.meta_webhook_events,
  public.meta_webhook_receipt_items TO nva_meta_inbox_ingress_prod;
GRANT UPDATE (item_count,new_count,duplicate_count,conflict_count)
  ON public.meta_webhook_receipts TO nva_meta_inbox_ingress_prod;
GRANT UPDATE (receipt_count,last_received_at,has_conflict,review_required,state,failed_at,
  reason_code,next_attempt_at,lease_token,lease_owner,lease_expires_at)
  ON public.meta_webhook_events TO nva_meta_inbox_ingress_prod;
GRANT USAGE ON SEQUENCE public.meta_webhook_events_enqueue_order_seq TO nva_meta_inbox_ingress_prod;
GRANT EXECUTE ON FUNCTION public.meta_inbox_lock_endpoint(uuid) TO nva_meta_inbox_ingress_prod;
DO $$
BEGIN
  IF has_database_privilege('nva_meta_inbox_ingress_prod',current_database(),'CREATE,TEMP')
    OR has_schema_privilege('nva_meta_inbox_ingress_prod','public','CREATE') THEN
    RAISE EXCEPTION 'PUBLIC grants CREATE/TEMP: strict isolation impossible with role grants alone. Roll back and request DBA review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
      AND c.relname NOT IN ('meta_webhook_endpoints','meta_webhook_receipts','meta_webhook_events',
        'meta_webhook_receipt_items','meta_webhook_events_enqueue_order_seq')
      AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('nva_meta_inbox_ingress_prod',c.oid,'USAGE,SELECT,UPDATE')
        ELSE has_table_privilege('nva_meta_inbox_ingress_prod',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('nva_meta_inbox_ingress_prod',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN
    RAISE EXCEPTION 'PUBLIC exposes business objects: roll back and request DBA review';
  END IF;
END $$;
COMMIT;
-- Separate authorized credential provisioning in an interactive psql session:
-- SET password_encryption = 'scram-sha-256';
-- \password nva_meta_inbox_ingress_prod
-- ALTER ROLE nva_meta_inbox_ingress_prod LOGIN;
-- Use a password manager / secure vault. No password literal in SQL or shell.
-- Then connect as the actual role and run runtime.ready() before HTTP activation.
