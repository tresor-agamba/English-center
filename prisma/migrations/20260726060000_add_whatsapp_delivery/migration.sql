CREATE TYPE "WhatsAppDeliveryStatus" AS ENUM ('PENDING','PROCESSING','ACCEPTED','SENT','DELIVERED','READ','FAILED','CANCELLED');
CREATE TABLE "whatsapp_preferences" (
  "id" SERIAL PRIMARY KEY, "user_id" INTEGER NOT NULL, "phone_number" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT false, "has_opted_in" BOOLEAN NOT NULL DEFAULT false,
  "opted_in_at" TIMESTAMP(3), "opted_out_at" TIMESTAMP(3), "verified_at" TIMESTAMP(3),
  "source" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "whatsapp_preferences_user_id_key" ON "whatsapp_preferences"("user_id");
ALTER TABLE "whatsapp_preferences" ADD CONSTRAINT "whatsapp_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "whatsapp_deliveries" (
  "id" SERIAL PRIMARY KEY, "notification_id" INTEGER, "user_id" INTEGER NOT NULL, "phone_number" TEXT NOT NULL,
  "template_name" TEXT NOT NULL, "template_language" TEXT NOT NULL, "template_parameters" JSONB,
  "status" "WhatsAppDeliveryStatus" NOT NULL DEFAULT 'PENDING', "provider_message_id" TEXT,
  "deduplication_key" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processing_started_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3), "sent_at" TIMESTAMP(3), "delivered_at" TIMESTAMP(3), "read_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3), "cancelled_at" TIMESTAMP(3), "failure_code" TEXT, "failure_reason" TEXT,
  "last_attempt_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "whatsapp_deliveries_provider_message_id_key" ON "whatsapp_deliveries"("provider_message_id");
CREATE UNIQUE INDEX "whatsapp_deliveries_deduplication_key_key" ON "whatsapp_deliveries"("deduplication_key");
CREATE INDEX "whatsapp_deliveries_status_scheduled_for_idx" ON "whatsapp_deliveries"("status","scheduled_for");
CREATE INDEX "whatsapp_deliveries_user_id_created_at_idx" ON "whatsapp_deliveries"("user_id","created_at");
CREATE INDEX "whatsapp_deliveries_notification_id_idx" ON "whatsapp_deliveries"("notification_id");
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
