-- Additive candidate DDL. Apply only after the admission migration and DBA review.
-- Limits the worker to prospect-consent events; it cannot forge email proofs or decisions.
CREATE OR REPLACE FUNCTION public.nva_record_admission_consent(p_request_id integer,p_action text,p_metadata jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event_id integer;
BEGIN
 IF p_action NOT IN ('CONSENT_CONFIRMED','RECONFIRMED') OR p_action IS NULL
   OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
   OR p_metadata->>'noticeVersion' IS DISTINCT FROM 'admissions-v1'
   OR octet_length(p_metadata::text)>4096
 THEN RAISE EXCEPTION 'Invalid consent event' USING ERRCODE='22023'; END IF;
 -- Hold the request against a concurrent administrative decision until this
 -- transaction ends; never record a prospect event after a terminal decision.
 PERFORM 1 FROM public."WhatsAppAdmissionRequest" WHERE id=p_request_id AND status IN ('PENDING','PROCESSING') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No open admission request' USING ERRCODE='22023'; END IF;
 INSERT INTO public."WhatsAppAdmissionEvent"("requestId",action,metadata,"createdAt")
 VALUES(p_request_id,p_action,p_metadata,clock_timestamp() AT TIME ZONE 'UTC') RETURNING id INTO event_id;
 RETURN event_id;
END $$;
REVOKE ALL ON FUNCTION public.nva_record_admission_consent(integer,text,jsonb) FROM PUBLIC;
