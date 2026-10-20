\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
-- Invocation must supply --set=expected_database=english_center (or audited target).
SELECT 1 / (current_database() = :'expected_database')::int AS correct_database;
SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS postgres_version;
SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
 rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY started_at;
SELECT name, to_regclass('public.' || name) IS NOT NULL AS exists
FROM unnest(ARRAY['whatsapp_conversations','whatsapp_conversation_messages','whatsapp_preferences',
 'whatsapp_commercial_consent_events','whatsapp_prospect_follow_ups','meta_webhook_endpoints','meta_webhook_receipts',
 'meta_webhook_events','meta_webhook_receipt_items','"WhatsAppChatbotRule"','"WhatsAppChatbotSettings"',
 '"WhatsAppChatbotAiBudget"','"WhatsAppScenario"']) AS name;
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='whatsapp_conversation_messages'
 AND column_name IN ('interactive_payload','text_fallback_pending','failure_code','idempotency_key') ORDER BY column_name;
SELECT r.rolname, c.relname, has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any_table_privilege
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname='nva_meta_inbox_ingress_prod' AND n.nspname='public'
AND c.relname IN ('WhatsAppChatbotRule','WhatsAppChatbotSettings','WhatsAppChatbotAiBudget','WhatsAppScenario');
-- Expect false for all four table privileges of the ingress-only role.
SELECT n.nspname, c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
 AND c.relname IN ('meta_webhook_endpoints','meta_webhook_receipts','meta_webhook_events','meta_webhook_receipt_items') ORDER BY c.relname,t.tgname;
COMMIT;
