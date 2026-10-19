SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public."meta_webhook_endpoints" (
  "id" UUID NOT NULL,
  "environment" VARCHAR(16) NOT NULL,
  "application_key" VARCHAR(64) NOT NULL,
  "meta_app_id" VARCHAR(64) NOT NULL,
  "waba_id" VARCHAR(64) NOT NULL,
  "phone_number_id" VARCHAR(64) NOT NULL,
  "inbox_enabled" BOOLEAN NOT NULL DEFAULT false,
  "processing_enabled" BOOLEAN NOT NULL DEFAULT false,
  "normalization_version" SMALLINT NOT NULL DEFAULT 1,
  "identity_version" SMALLINT NOT NULL DEFAULT 1,
  "lookup_key_version" VARCHAR(64) NOT NULL,
  "stream_key_version" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(3),
  CONSTRAINT "meta_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_receipts" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "stored_at" TIMESTAMPTZ(3) NOT NULL,
  "request_digest" BYTEA NOT NULL,
  "digest_key_version" VARCHAR(64) NOT NULL,
  "authentication_key_version" VARCHAR(64) NOT NULL,
  "request_bytes" INTEGER NOT NULL,
  "item_count" INTEGER NOT NULL,
  "new_count" INTEGER NOT NULL,
  "duplicate_count" INTEGER NOT NULL,
  "conflict_count" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "meta_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_events" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "enqueue_order" BIGSERIAL NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "native_message_id" VARCHAR(512),
  "native_status" VARCHAR(64),
  "occurred_at" TIMESTAMPTZ(3),
  "occurred_at_source" VARCHAR(32),
  "identity_version" SMALLINT NOT NULL,
  "normalization_version" SMALLINT NOT NULL,
  "lookup_key_version" VARCHAR(64) NOT NULL,
  "identity_key" BYTEA NOT NULL,
  "content_digest" BYTEA NOT NULL,
  "correlation_key_hash" BYTEA,
  "stream_key" BYTEA,
  "stream_key_version" VARCHAR(64),
  "first_received_at" TIMESTAMPTZ(3) NOT NULL,
  "last_received_at" TIMESTAMPTZ(3) NOT NULL,
  "stored_at" TIMESTAMPTZ(3) NOT NULL,
  "receipt_count" BIGINT NOT NULL DEFAULT 1,
  "normalized_payload_ciphertext" BYTEA,
  "encryption_key_version" VARCHAR(64),
  "state" VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  "effect_outcome" VARCHAR(32),
  "reason_code" VARCHAR(100),
  "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "lease_token" UUID,
  "lease_owner" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "lease_generation" BIGINT NOT NULL DEFAULT 0,
  "processed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "uncorrelated_since" TIMESTAMPTZ(3),
  "target_kind" VARCHAR(16),
  "target_id" INTEGER,
  "observed_attempt" INTEGER,
  "has_conflict" BOOLEAN NOT NULL DEFAULT false,
  "review_required" BOOLEAN NOT NULL DEFAULT false,
  "payload_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "tombstone_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "payload_purged_at" TIMESTAMPTZ(3),
  CONSTRAINT "meta_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_receipt_items" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "entry_index" INTEGER NOT NULL,
  "change_index" INTEGER NOT NULL,
  "item_index" INTEGER NOT NULL,
  "collection" VARCHAR(16) NOT NULL,
  "disposition" VARCHAR(16) NOT NULL,
  "observed_content_digest" BYTEA NOT NULL,
  "conflict_payload_ciphertext" BYTEA,
  "encryption_key_version" VARCHAR(64),
  "conflict_payload_expires_at" TIMESTAMPTZ(3),
  "payload_purged_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "meta_webhook_receipt_items_pkey" PRIMARY KEY ("id")
);

-- Les UUID sont produits par l'application/Prisma : aucun défaut DB UUID.
ALTER TABLE public.meta_webhook_endpoints
  ADD CONSTRAINT meta_endpoint_application_key UNIQUE (environment, application_key),
  ADD CONSTRAINT meta_endpoint_account_key UNIQUE (environment, meta_app_id, waba_id, phone_number_id),
  ADD CONSTRAINT meta_endpoint_values_check CHECK (
    environment IN ('test','staging','production')
    AND application_key ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND meta_app_id ~ '^[0-9]{1,64}$' AND waba_id ~ '^[0-9]{1,64}$'
    AND phone_number_id ~ '^[0-9]{1,64}$'
    AND normalization_version > 0 AND identity_version > 0
    AND lookup_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND stream_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND (disabled_at IS NULL OR (NOT inbox_enabled AND NOT processing_enabled))
  );
-- Un seul périmètre actif, tous environnements confondus dans CETTE base.
CREATE UNIQUE INDEX meta_endpoint_one_active_key
  ON public.meta_webhook_endpoints ((1))
  WHERE disabled_at IS NULL AND (inbox_enabled OR processing_enabled);

ALTER TABLE public.meta_webhook_receipts
  ADD CONSTRAINT meta_receipt_endpoint_id_key UNIQUE (endpoint_id, id),
  ADD CONSTRAINT meta_receipt_endpoint_fkey FOREIGN KEY (endpoint_id)
    REFERENCES public.meta_webhook_endpoints(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_values_check CHECK (
    request_bytes BETWEEN 1 AND 1048576 AND octet_length(request_digest) = 32
    AND item_count BETWEEN 0 AND 512
    AND new_count BETWEEN 0 AND 512 AND duplicate_count BETWEEN 0 AND 512
    AND conflict_count BETWEEN 0 AND 512
    AND item_count = new_count + duplicate_count + conflict_count
    AND digest_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND authentication_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND expires_at >= stored_at
  );
CREATE INDEX meta_receipt_time_idx ON public.meta_webhook_receipts(endpoint_id, stored_at, id);
CREATE INDEX meta_receipt_expiry_idx ON public.meta_webhook_receipts(expires_at, id);

ALTER TABLE public.meta_webhook_events
  ADD CONSTRAINT meta_event_endpoint_id_key UNIQUE (endpoint_id, id),
  ADD CONSTRAINT meta_event_identity_key UNIQUE (endpoint_id, identity_version, lookup_key_version, identity_key),
  ADD CONSTRAINT meta_webhook_events_enqueue_order_key UNIQUE (enqueue_order),
  ADD CONSTRAINT meta_event_endpoint_fkey FOREIGN KEY (endpoint_id)
    REFERENCES public.meta_webhook_endpoints(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_event_values_check CHECK (
    kind IN ('INBOUND','STATUS','PROVIDER_ERROR','UNSUPPORTED')
    AND state IN ('RECEIVED','READY','PROCESSING','UNCORRELATED','RETRY_WAIT','PROCESSED','IGNORED','FAILED','EXPIRED')
    AND (effect_outcome IS NULL OR effect_outcome IN ('APPLIED','DUPLICATE','NONE'))
    AND identity_version > 0 AND normalization_version > 0
    AND enqueue_order > 0 AND receipt_count >= 1
    AND processing_attempts >= 0 AND consecutive_failures >= 0 AND lease_generation >= 0
    AND octet_length(identity_key) = 32 AND octet_length(content_digest) = 32
    AND (correlation_key_hash IS NULL OR octet_length(correlation_key_hash) = 32)
    AND (stream_key IS NULL OR octet_length(stream_key) = 32)
    AND ((stream_key IS NULL) = (stream_key_version IS NULL))
    AND lookup_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND (stream_key_version IS NULL OR stream_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND (encryption_key_version IS NULL OR encryption_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND last_received_at >= first_received_at
    AND payload_expires_at <= tombstone_expires_at
    AND ((occurred_at IS NULL) = (occurred_at_source IS NULL))
    AND (occurred_at_source IS NULL OR occurred_at_source = 'meta-seconds')
    AND (native_message_id IS NULL OR length(native_message_id) > 0)
    AND (kind <> 'STATUS' OR (native_message_id IS NOT NULL AND native_status IS NOT NULL AND length(native_status) > 0))
    AND (kind <> 'INBOUND' OR (native_message_id IS NOT NULL AND stream_key IS NOT NULL))
    AND ((target_kind IS NULL AND target_id IS NULL)
      OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_id > 0 AND length(target_kind) > 0))
    AND (observed_attempt IS NULL OR observed_attempt >= 0)
    AND (NOT has_conflict OR review_required)
  ),
  ADD CONSTRAINT meta_event_lease_check CHECK (
    (state = 'PROCESSING' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_owner ~ '^[a-zA-Z0-9_-]{1,64}$' AND lease_expires_at IS NOT NULL AND lease_generation > 0)
    OR (state <> 'PROCESSING' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT meta_event_payload_check CHECK (
    (normalized_payload_ciphertext IS NOT NULL AND octet_length(normalized_payload_ciphertext) > 0
      AND encryption_key_version IS NOT NULL AND payload_purged_at IS NULL)
    OR (normalized_payload_ciphertext IS NULL AND encryption_key_version IS NULL
      AND payload_purged_at IS NOT NULL
      AND (state IN ('PROCESSED','IGNORED','EXPIRED') OR (state = 'FAILED' AND review_required)))
  ),
  ADD CONSTRAINT meta_event_result_check CHECK (
    (state NOT IN ('PROCESSED','IGNORED') OR (processed_at IS NOT NULL AND effect_outcome IS NOT NULL))
    AND (state <> 'FAILED' OR failed_at IS NOT NULL)
    AND (state <> 'EXPIRED' OR payload_purged_at IS NOT NULL)
    AND (state <> 'UNCORRELATED' OR (kind = 'STATUS' AND uncorrelated_since IS NOT NULL))
    AND (state NOT IN ('READY','RETRY_WAIT','UNCORRELATED') OR next_attempt_at IS NOT NULL)
  );
CREATE INDEX meta_event_queue_idx ON public.meta_webhook_events(endpoint_id, state, next_attempt_at, enqueue_order);
CREATE INDEX meta_event_lease_idx ON public.meta_webhook_events(endpoint_id, state, lease_expires_at);
CREATE INDEX meta_event_stream_idx ON public.meta_webhook_events(endpoint_id, stream_key, enqueue_order);
CREATE INDEX meta_event_native_idx ON public.meta_webhook_events(endpoint_id, native_message_id, state);
CREATE INDEX meta_event_correlation_idx ON public.meta_webhook_events(endpoint_id, correlation_key_hash, state);
CREATE INDEX meta_event_operations_idx ON public.meta_webhook_events(endpoint_id, state, first_received_at, id);
CREATE INDEX meta_event_payload_expiry_idx ON public.meta_webhook_events(payload_expires_at, id);
CREATE INDEX meta_event_tombstone_expiry_idx ON public.meta_webhook_events(tombstone_expires_at, id);

ALTER TABLE public.meta_webhook_receipt_items
  ADD CONSTRAINT meta_receipt_position_key UNIQUE (endpoint_id, receipt_id, entry_index, change_index, collection, item_index),
  ADD CONSTRAINT meta_receipt_item_receipt_fkey FOREIGN KEY (endpoint_id, receipt_id)
    REFERENCES public.meta_webhook_receipts(endpoint_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_item_event_fkey FOREIGN KEY (endpoint_id, event_id)
    REFERENCES public.meta_webhook_events(endpoint_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_item_values_check CHECK (
    entry_index >= 0 AND change_index >= 0 AND item_index >= 0
    AND collection IN ('messages','statuses','errors')
    AND disposition IN ('NEW','DUPLICATE','CONFLICT')
    AND octet_length(observed_content_digest) = 32 AND expires_at >= created_at
    AND (encryption_key_version IS NULL OR encryption_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND (
      (disposition <> 'CONFLICT' AND conflict_payload_ciphertext IS NULL AND encryption_key_version IS NULL
        AND conflict_payload_expires_at IS NULL AND payload_purged_at IS NULL)
      OR (disposition = 'CONFLICT' AND conflict_payload_expires_at IS NOT NULL
        AND conflict_payload_expires_at <= expires_at
        AND ((conflict_payload_ciphertext IS NOT NULL AND octet_length(conflict_payload_ciphertext) > 0
            AND encryption_key_version IS NOT NULL AND payload_purged_at IS NULL)
          OR (conflict_payload_ciphertext IS NULL AND encryption_key_version IS NULL AND payload_purged_at IS NOT NULL)))
    )
  );
CREATE INDEX meta_receipt_item_event_idx ON public.meta_webhook_receipt_items(endpoint_id, event_id, created_at);
CREATE INDEX meta_receipt_item_expiry_idx ON public.meta_webhook_receipt_items(expires_at, id);

-- Toutes les écritures applicatives prennent d'abord l'endpoint FOR UPDATE.
-- Ces triggers ajoutent des garde-fous, pas un remplacement de cet ordre.
CREATE FUNCTION public.meta_inbox_lock_endpoint(p_endpoint uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM id FROM public.meta_webhook_endpoints WHERE id = p_endpoint FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_ENDPOINT_REQUIRED';
  END IF;
END;
$$;

CREATE FUNCTION public.meta_inbox_endpoint_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.id, NEW.environment, NEW.application_key, NEW.meta_app_id, NEW.waba_id, NEW.phone_number_id)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.application_key, OLD.meta_app_id, OLD.waba_id, OLD.phone_number_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ENDPOINT_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.stream_key_version IS DISTINCT FROM OLD.stream_key_version AND EXISTS (
    SELECT 1 FROM public.meta_webhook_events WHERE endpoint_id = OLD.id
      AND stream_key IS NOT NULL AND (state NOT IN ('PROCESSED','IGNORED') OR has_conflict)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_OPEN_STREAM_VERSION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_endpoint_guard BEFORE UPDATE ON public.meta_webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_endpoint_guard();

CREATE FUNCTION public.meta_inbox_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
    RETURN NEW;
  END IF;
  PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
  IF TG_OP = 'DELETE' THEN
    IF OLD.expires_at > clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_RECEIPT_RETENTION';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.endpoint_id, NEW.received_at, NEW.stored_at, NEW.request_digest,
    NEW.digest_key_version, NEW.authentication_key_version, NEW.request_bytes)
    IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.received_at, OLD.stored_at, OLD.request_digest,
    OLD.digest_key_version, OLD.authentication_key_version, OLD.request_bytes)
    OR NEW.expires_at < OLD.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_RECEIPT_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipts
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_receipt_guard();

CREATE FUNCTION public.meta_inbox_event_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
    RETURN NEW;
  END IF;
  PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
  IF TG_OP = 'DELETE' THEN
    IF OLD.tombstone_expires_at > clock_timestamp()
      OR OLD.has_conflict
      OR (OLD.kind IN ('INBOUND','UNSUPPORTED') AND OLD.state NOT IN ('PROCESSED','IGNORED')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_EVENT_RETENTION_OR_BARRIER';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.endpoint_id, NEW.enqueue_order, NEW.kind, NEW.native_message_id, NEW.native_status,
    NEW.occurred_at, NEW.occurred_at_source, NEW.identity_version, NEW.normalization_version,
    NEW.lookup_key_version, NEW.identity_key, NEW.content_digest, NEW.correlation_key_hash,
    NEW.stream_key, NEW.stream_key_version, NEW.first_received_at, NEW.stored_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.enqueue_order, OLD.kind, OLD.native_message_id, OLD.native_status,
    OLD.occurred_at, OLD.occurred_at_source, OLD.identity_version, OLD.normalization_version,
    OLD.lookup_key_version, OLD.identity_key, OLD.content_digest, OLD.correlation_key_hash,
    OLD.stream_key, OLD.stream_key_version, OLD.first_received_at, OLD.stored_at)
    OR NEW.lease_generation < OLD.lease_generation OR NEW.receipt_count < OLD.receipt_count
    OR NEW.last_received_at < OLD.last_received_at OR NEW.processing_attempts < OLD.processing_attempts
    OR NEW.tombstone_expires_at < OLD.tombstone_expires_at
    OR (OLD.has_conflict AND NOT NEW.has_conflict)
    OR (OLD.payload_purged_at IS NOT NULL AND (
      NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at OR NEW.normalized_payload_ciphertext IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_EVENT_IDENTITY_OR_HISTORY_IMMUTABLE';
  END IF;
  IF NEW.state = 'PROCESSING' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
    IF NEW.lease_generation <> OLD.lease_generation + 1
      OR NEW.processing_attempts <> OLD.processing_attempts + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_LEASE_GENERATION_REQUIRED';
    END IF;
  ELSIF NEW.lease_generation <> OLD.lease_generation THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_UNEXPECTED_GENERATION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_event_guard();

-- Une seule occurrence de création, tant que son manifeste est conservé.
CREATE UNIQUE INDEX meta_receipt_new_event_key
  ON public.meta_webhook_receipt_items(endpoint_id, event_id) WHERE disposition = 'NEW';

CREATE FUNCTION public.meta_inbox_item_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE e public.meta_webhook_events%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
  ELSE
    PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
    IF TG_OP = 'DELETE' THEN
      PERFORM id FROM public.meta_webhook_receipts
        WHERE endpoint_id = OLD.endpoint_id AND id = OLD.receipt_id FOR UPDATE;
      IF OLD.expires_at > clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ITEM_RETENTION';
      END IF;
      RETURN OLD;
    END IF;
    IF ROW(NEW.id, NEW.endpoint_id, NEW.receipt_id, NEW.event_id, NEW.entry_index, NEW.change_index,
      NEW.item_index, NEW.collection, NEW.disposition, NEW.observed_content_digest, NEW.created_at,
      NEW.conflict_payload_expires_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.receipt_id, OLD.event_id, OLD.entry_index, OLD.change_index,
      OLD.item_index, OLD.collection, OLD.disposition, OLD.observed_content_digest, OLD.created_at,
      OLD.conflict_payload_expires_at)
      OR NEW.expires_at < OLD.expires_at
      OR (OLD.payload_purged_at IS NOT NULL AND NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ITEM_IDENTITY_IMMUTABLE';
    END IF;
  END IF;
  PERFORM id FROM public.meta_webhook_receipts
    WHERE endpoint_id = NEW.endpoint_id AND id = NEW.receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_RECEIPT_REQUIRED';
  END IF;
  SELECT * INTO e FROM public.meta_webhook_events
    WHERE endpoint_id = NEW.endpoint_id AND id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_EVENT_REQUIRED';
  END IF;
  IF (NEW.disposition IN ('NEW','DUPLICATE') AND NEW.observed_content_digest <> e.content_digest)
    OR (NEW.disposition = 'CONFLICT' AND (NEW.observed_content_digest = e.content_digest OR NOT e.has_conflict))
    OR (e.kind = 'INBOUND' AND NEW.collection <> 'messages')
    OR (e.kind = 'STATUS' AND NEW.collection <> 'statuses')
    OR (e.kind = 'PROVIDER_ERROR' AND NEW.collection <> 'errors') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_MANIFEST_EVENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_item_guard();

-- Relecture de la receipt finale, pas de l'image NEW initiale à zéro.
CREATE FUNCTION public.meta_inbox_check_manifest()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  p uuid; r uuid; parent public.meta_webhook_receipts%ROWTYPE;
  total bigint; fresh bigint; duplicates bigint; conflicts bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    p := OLD.endpoint_id;
    IF TG_TABLE_NAME = 'meta_webhook_receipts' THEN r := OLD.id; ELSE r := OLD.receipt_id; END IF;
  ELSE
    p := NEW.endpoint_id;
    IF TG_TABLE_NAME = 'meta_webhook_receipts' THEN r := NEW.id; ELSE r := NEW.receipt_id; END IF;
  END IF;
  SELECT * INTO parent FROM public.meta_webhook_receipts WHERE endpoint_id = p AND id = r FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF; -- purge entière dans la même transaction
  SELECT count(*), count(*) FILTER (WHERE disposition = 'NEW'),
    count(*) FILTER (WHERE disposition = 'DUPLICATE'), count(*) FILTER (WHERE disposition = 'CONFLICT')
    INTO total, fresh, duplicates, conflicts FROM public.meta_webhook_receipt_items
    WHERE endpoint_id = p AND receipt_id = r;
  IF parent.item_count NOT BETWEEN 1 AND 512 OR total <> parent.item_count
    OR fresh <> parent.new_count OR duplicates <> parent.duplicate_count OR conflicts <> parent.conflict_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_MANIFEST_INCOMPLETE';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER meta_receipt_complete
AFTER INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_manifest();
CREATE CONSTRAINT TRIGGER meta_item_complete
AFTER INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipt_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_manifest();

-- Exigé à la création seulement : la purge ultérieure du manifeste reste possible.
CREATE FUNCTION public.meta_inbox_check_new_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.meta_webhook_events WHERE endpoint_id = NEW.endpoint_id AND id = NEW.id)
    AND (SELECT count(*) FROM public.meta_webhook_receipt_items
      WHERE endpoint_id = NEW.endpoint_id AND event_id = NEW.id AND disposition = 'NEW') <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_NEW_EVENT_OCCURRENCE_REQUIRED';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER meta_new_event_complete AFTER INSERT ON public.meta_webhook_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_new_event();
