-- OPTIONAL DBA step, only after checking the application role's existing grants.
-- Never grant business access to the ingress-only role or NovanceTech.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SELECT 1 / (current_database() = :'expected_database')::int AS correct_database;
SELECT 1 / (EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'nva_app_role')
 AND :'nva_app_role' !~* '(novance|meta.*ingress)' AND :'nva_app_role' <> 'public')::int AS correct_application_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."WhatsAppChatbotRule" TO :"nva_app_role";
GRANT SELECT, INSERT, UPDATE ON public."WhatsAppChatbotSettings", public."WhatsAppChatbotAiBudget", public."WhatsAppScenario" TO :"nva_app_role";
GRANT USAGE, SELECT ON SEQUENCE public."WhatsAppChatbotRule_id_seq" TO :"nva_app_role";
COMMIT;

-- Admissions extension: execute only after migration 20261022120000 and explicit DBA review.
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT 1 / (current_database() = :'expected_database')::int AS correct_database;
SELECT 1 / (:'nva_app_role' !~* '(novance|meta.*ingress)' AND :'nva_app_role' <> 'public')::int AS correct_application_role;
GRANT SELECT, INSERT, UPDATE ON public."WhatsAppAdmissionRequest", public."WhatsAppAdmissionEvent" TO :"nva_app_role";
GRANT USAGE, SELECT ON SEQUENCE public."WhatsAppAdmissionRequest_id_seq", public."WhatsAppAdmissionEvent_id_seq" TO :"nva_app_role";
COMMIT;
