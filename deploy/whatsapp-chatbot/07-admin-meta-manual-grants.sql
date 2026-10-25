-- Candidate ONLY. Additional read columns and consent-function execution for
-- the EXISTING admin application role. Deploy the function first.
-- Requires explicit :expected_database and :nva_app_role from the operator.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT 1/(current_database()=:'expected_database' AND current_database()='english_center')::int;
SELECT 1/(:'nva_app_role' !~* '(novance|meta.*(ingress|worker)|postgres|public)' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'nva_app_role' AND NOT rolsuper))::int;
GRANT SELECT (id,environment,application_key,meta_app_id,waba_id,phone_number_id,disabled_at,inbox_enabled,processing_enabled)
 ON public.meta_webhook_endpoints TO :"nva_app_role";
GRANT SELECT (id,endpoint_id,stream_key,kind,state,effect_outcome)
 ON public.meta_webhook_events TO :"nva_app_role";
GRANT EXECUTE ON FUNCTION public.nva_record_admission_consent(integer,text,jsonb) TO :"nva_app_role";
COMMIT;
