CREATE TYPE "WhatsAppConversationControlState" AS ENUM ('BOT_ACTIVE', 'HUMAN_TAKEOVER', 'BOT_PAUSED', 'OPTED_OUT', 'CLOSED');
CREATE TYPE "WhatsAppConversationMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "WhatsAppConversationMessageType" AS ENUM ('TEXT', 'MEDIA', 'INTERACTIVE', 'SYSTEM');
CREATE TYPE "WhatsAppInboundProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "WhatsAppOutboundDeliveryStatus" AS ENUM ('QUEUED', 'PROCESSING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');
CREATE TYPE "WhatsAppCommercialConsentScope" AS ENUM ('COMMERCIAL_FOLLOW_UPS');
CREATE TYPE "WhatsAppCommercialConsentDecision" AS ENUM ('GRANTED', 'REVOKED');
CREATE TYPE "WhatsAppCommercialConsentSource" AS ENUM ('WHATSAPP_INBOUND', 'WEB_FORM', 'ADMIN_RECORDED');

CREATE TABLE "whatsapp_conversations" (
    "id" SERIAL NOT NULL,
    "phone_number" VARCHAR(16) NOT NULL,
    "user_id" INTEGER,
    "assigned_advisor_id" INTEGER,
    "control_state" "WhatsAppConversationControlState" NOT NULL DEFAULT 'BOT_ACTIVE',
    "engine_state" JSONB,
    "engine_version" INTEGER NOT NULL DEFAULT 1,
    "handoff_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_conversation_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "direction" "WhatsAppConversationMessageDirection" NOT NULL,
    "message_type" "WhatsAppConversationMessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "provider_message_id" TEXT,
    "idempotency_key" TEXT,
    "provider_timestamp" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" "WhatsAppInboundProcessingStatus",
    "processing_started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "delivery_status" "WhatsAppOutboundDeliveryStatus",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(100),
    "sender_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_conversation_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_conversation_messages_status_direction_check" CHECK (
      ("direction" = 'INBOUND' AND "processing_status" IS NOT NULL AND "delivery_status" IS NULL)
      OR
      ("direction" = 'OUTBOUND' AND "processing_status" IS NULL AND "delivery_status" IS NOT NULL)
    )
);

CREATE TABLE "whatsapp_commercial_consent_events" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "scope" "WhatsAppCommercialConsentScope" NOT NULL,
    "decision" "WhatsAppCommercialConsentDecision" NOT NULL,
    "source" "WhatsAppCommercialConsentSource" NOT NULL,
    "evidence_message_id" INTEGER,
    "evidence_provider_message_id" TEXT,
    "evidence_reference" VARCHAR(200),
    "notice_version" VARCHAR(100),
    "recorded_by_user_id" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_commercial_consent_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_conversations_phone_number_key" ON "whatsapp_conversations"("phone_number");
CREATE INDEX "whatsapp_conversations_control_state_last_message_at_idx" ON "whatsapp_conversations"("control_state", "last_message_at");
CREATE INDEX "whatsapp_conversations_user_id_last_message_at_idx" ON "whatsapp_conversations"("user_id", "last_message_at");
CREATE INDEX "whatsapp_conversations_assigned_advisor_id_control_state_la_idx" ON "whatsapp_conversations"("assigned_advisor_id", "control_state", "last_message_at");

CREATE UNIQUE INDEX "whatsapp_conversation_messages_provider_message_id_key" ON "whatsapp_conversation_messages"("provider_message_id");
CREATE UNIQUE INDEX "whatsapp_conversation_messages_idempotency_key_key" ON "whatsapp_conversation_messages"("idempotency_key");
CREATE INDEX "whatsapp_conversation_messages_conversation_id_created_at_i_idx" ON "whatsapp_conversation_messages"("conversation_id", "created_at", "id");
CREATE INDEX "whatsapp_conversation_messages_processing_status_received_a_idx" ON "whatsapp_conversation_messages"("processing_status", "received_at");
CREATE INDEX "whatsapp_conversation_messages_delivery_status_created_at_idx" ON "whatsapp_conversation_messages"("delivery_status", "created_at");
CREATE INDEX "whatsapp_conversation_messages_sender_user_id_created_at_idx" ON "whatsapp_conversation_messages"("sender_user_id", "created_at");

CREATE UNIQUE INDEX "whatsapp_commercial_consent_events_deduplication_key_key" ON "whatsapp_commercial_consent_events"("deduplication_key");
CREATE INDEX "whatsapp_commercial_consent_events_conversation_id_scope_oc_idx" ON "whatsapp_commercial_consent_events"("conversation_id", "scope", "occurred_at", "id");
CREATE INDEX "whatsapp_commercial_consent_events_evidence_message_id_idx" ON "whatsapp_commercial_consent_events"("evidence_message_id");
CREATE INDEX "whatsapp_commercial_consent_events_recorded_by_user_id_crea_idx" ON "whatsapp_commercial_consent_events"("recorded_by_user_id", "created_at");

ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assigned_advisor_id_fkey" FOREIGN KEY ("assigned_advisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_conversation_messages" ADD CONSTRAINT "whatsapp_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_conversation_messages" ADD CONSTRAINT "whatsapp_conversation_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_commercial_consent_events" ADD CONSTRAINT "whatsapp_commercial_consent_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_commercial_consent_events" ADD CONSTRAINT "whatsapp_commercial_consent_events_evidence_message_id_fkey" FOREIGN KEY ("evidence_message_id") REFERENCES "whatsapp_conversation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_commercial_consent_events" ADD CONSTRAINT "whatsapp_commercial_consent_events_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
