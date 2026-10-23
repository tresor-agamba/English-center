-- DIAGNOSTIC ONLY. Outputs public catalog/aggregates and boolean settings.
-- Never outputs students, contact details, private course links or messages.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT 1 / (current_database() = :'expected_database')::int AS expected_database_confirmed;
-- Fail closed if the required catalog shape is not deployed. Run structure audit first.
WITH required(table_name,column_name) AS (VALUES
 ('courses','structure_type'),('courses','number_of_levels'),('courses','session_count'),
 ('courses','access_policy'),('courses','price'),('courses','currency'),
 ('courses','pricing_active'),('courses','pricing_starts_at'),('courses','pricing_ends_at'),
 ('courses','lms_status'),('courses','archived_at'),('courses','closed_at'),
 ('training_sessions','level_number'),('training_sessions','registration_deadline'),
 ('training_sessions','week_days'),('registration_groups','capacity'),
 ('enrollments','registration_group_id'))
SELECT 1 / (count(*)=0)::int AS catalog_shape_confirmed FROM required r
WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name);

\echo === Public catalog configuration: no registration/contact data ===
SELECT id,slug,title,is_published,lms_status,archived_at IS NOT NULL AS archived,
 closed_at IS NOT NULL AS closed,structure_type,number_of_levels,session_count,
 access_policy,price,currency,pricing_mode,pricing_active,pricing_starts_at,pricing_ends_at,
 registration_fee,duration_value,duration_unit,training_mode,
 CASE WHEN structure_type='LEVEL_BASED' THEN number_of_levels::bigint*session_count::bigint ELSE session_count END AS advertised_total_sessions,
 CASE WHEN access_policy='LEGACY_STAGED' THEN 5 ELSE 0 END AS trial_sessions_per_enrollment,
 CASE WHEN access_policy='LEGACY_STAGED' THEN round(price*0.5,2) ELSE price END AS minimum_after_trial_for_new_enrollment,
 CASE WHEN access_policy='LEGACY_STAGED' THEN 10 ELSE session_count END AS partial_session_limit,
 (is_published AND lms_status='PUBLISHED' AND archived_at IS NULL AND closed_at IS NULL) AS publication_flags_ok,
 (pricing_active AND pricing_mode='ONE_TIME' AND price>0
  AND (pricing_starts_at IS NULL OR pricing_starts_at<=CURRENT_TIMESTAMP)
  AND (pricing_ends_at IS NULL OR pricing_ends_at>CURRENT_TIMESTAMP)) AS price_currently_displayable,
 (coalesce(length(trim(short_description)),0)>0 OR coalesce(length(trim(description)),0)>0) AS has_public_description,
 (price=60 AND currency='USD' AND structure_type='LEVEL_BASED'
  AND number_of_levels=3 AND session_count=16 AND access_policy='LEGACY_STAGED') AS matches_requested_nva_english_structure
FROM public.courses ORDER BY id;

\echo === Registration sessions: capacity uses the application's occupying statuses ===
WITH sessions AS (
 SELECT s.id,s.course_id,s.level_number,s.status,s.start_date,s.end_date,
  s.registration_deadline,s.capacity,s.week_days,s.start_time,s.end_time,s.platform,s.timezone,
  (SELECT count(*) FROM public.enrollments e WHERE e.training_session_id=s.id
   AND e.status IN ('TRIAL_ACTIVE','PLACEMENT_TEST_REQUIRED','PAYMENT_REQUIRED','CONFIRMED')) AS occupied,
  c.is_published,c.lms_status,c.archived_at,c.closed_at,c.structure_type,c.number_of_levels
 FROM public.training_sessions s JOIN public.courses c ON c.id=s.course_id
)
SELECT id,course_id,level_number,status,start_date,end_date,registration_deadline,capacity,
 occupied,greatest(capacity-occupied,0) AS remaining_places,week_days,start_time,end_time,platform,timezone,
 (status='OPEN' AND start_date>=CURRENT_TIMESTAMP AND registration_deadline>=CURRENT_TIMESTAMP
  AND capacity>occupied AND is_published AND lms_status='PUBLISHED' AND archived_at IS NULL AND closed_at IS NULL
  AND (structure_type<>'LEVEL_BASED' OR level_number BETWEEN 1 AND least(number_of_levels,3))) AS registration_candidate
FROM sessions ORDER BY course_id,start_date,id;

\echo === Registration groups: no teacher names or private meeting URLs ===
SELECT g.id,g.training_session_id,g.is_active,g.week_days,g.start_time,g.end_time,g.capacity,
 (SELECT count(*) FROM public.enrollments e WHERE e.registration_group_id=g.id
  AND e.status IN ('TRIAL_ACTIVE','PLACEMENT_TEST_REQUIRED','PAYMENT_REQUIRED','CONFIRMED')) AS occupied
FROM public.registration_groups g ORDER BY g.training_session_id,g.start_time,g.id;

\echo === Chatbot flags only; no configured response bodies, FAQ or scenarios ===
SELECT CASE WHEN to_regclass('public."WhatsAppChatbotSettings"') IS NULL
 THEN 'SELECT ''ABSENT'' AS chatbot_settings;'
 ELSE 'SELECT id,enabled,"aiEnabled",coalesce((to_jsonb(s)->>''admissionsEnabled'')::boolean,false) AS admissions_enabled,(to_jsonb(s)->''admissionContent'') IS NOT NULL AND (to_jsonb(s)->''admissionContent'')<>''null''::jsonb AS has_custom_admission_content FROM public."WhatsAppChatbotSettings" s;'
END AS diagnostic_query
\gexec
SELECT CASE WHEN to_regclass('public."WhatsAppScenario"') IS NULL
 THEN 'SELECT ''ABSENT'' AS scenario_settings;'
 ELSE 'SELECT enabled,count(*) AS scenario_count FROM public."WhatsAppScenario" GROUP BY enabled ORDER BY enabled;'
END AS diagnostic_query
\gexec
-- Endpoint identities/account IDs, ciphertexts and key versions are deliberately excluded.
SELECT CASE WHEN to_regclass('public.meta_webhook_endpoints') IS NULL
 THEN 'SELECT ''ABSENT'' AS meta_settings;'
 ELSE 'SELECT environment,inbox_enabled,processing_enabled,disabled_at IS NOT NULL AS disabled,count(*) AS endpoint_count FROM public.meta_webhook_endpoints GROUP BY environment,inbox_enabled,processing_enabled,disabled_at IS NOT NULL;'
END AS diagnostic_query
\gexec
COMMIT;
