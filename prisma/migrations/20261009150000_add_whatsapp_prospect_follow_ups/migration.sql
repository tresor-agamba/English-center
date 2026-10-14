CREATE TYPE "WhatsAppProspectFollowUpStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

CREATE TABLE "whatsapp_prospect_follow_ups" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "consent_event_id" INTEGER NOT NULL,
    "sequence_hours" INTEGER NOT NULL,
    "template_name" VARCHAR(512) NOT NULL,
    "template_language" VARCHAR(10) NOT NULL DEFAULT 'fr',
    "template_parameters" JSONB,
    "deduplication_key" TEXT NOT NULL,
    "status" "WhatsAppProspectFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "processing_started_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "failure_code" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_prospect_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_prospect_follow_ups_deduplication_key_key" ON "whatsapp_prospect_follow_ups"("deduplication_key");
CREATE UNIQUE INDEX "whatsapp_prospect_follow_ups_provider_message_id_key" ON "whatsapp_prospect_follow_ups"("provider_message_id");
CREATE INDEX "whatsapp_prospect_follow_ups_status_scheduled_for_idx" ON "whatsapp_prospect_follow_ups"("status", "scheduled_for");
CREATE INDEX "whatsapp_prospect_follow_ups_conversation_id_status_idx" ON "whatsapp_prospect_follow_ups"("conversation_id", "status");

ALTER TABLE "whatsapp_prospect_follow_ups" ADD CONSTRAINT "whatsapp_prospect_follow_ups_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_prospect_follow_ups" ADD CONSTRAINT "whatsapp_prospect_follow_ups_consent_event_id_fkey" FOREIGN KEY ("consent_event_id") REFERENCES "whatsapp_commercial_consent_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
