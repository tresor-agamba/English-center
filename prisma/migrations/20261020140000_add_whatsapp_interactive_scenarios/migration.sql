CREATE TABLE "WhatsAppScenario" (
 "id" UUID PRIMARY KEY, "title" VARCHAR(120) NOT NULL, "triggers" JSONB NOT NULL, "definition" JSONB NOT NULL,
 "priority" INTEGER NOT NULL DEFAULT 0 CHECK ("priority" BETWEEN 0 AND 1000), "enabled" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WhatsAppScenario_enabled_priority_idx" ON "WhatsAppScenario"("enabled","priority");
ALTER TABLE "whatsapp_conversation_messages" ADD COLUMN "interactive_payload" JSONB, ADD COLUMN "text_fallback_pending" BOOLEAN NOT NULL DEFAULT false;
