BEGIN;
ALTER TABLE "WhatsAppChatbotSettings" ADD COLUMN "admissionsEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "admissionContent" JSONB;
CREATE TABLE "WhatsAppAdmissionRequest" (
 "id" SERIAL PRIMARY KEY, "conversationId" INTEGER NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE RESTRICT,
 "fullName" VARCHAR(120) NOT NULL, "phoneNumber" VARCHAR(20) NOT NULL, "email" VARCHAR(254) NOT NULL,
 "requestedLevel" VARCHAR(24) NOT NULL CHECK ("requestedLevel" IN ('BEGINNER','INTERMEDIATE','ADVANCED','UNKNOWN')),
 "source" VARCHAR(16) NOT NULL DEFAULT 'WHATSAPP' CHECK ("source"='WHATSAPP'),
 "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PROCESSING','ENROLLED','CANCELLED')),
 "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "consentVersion" VARCHAR(32) NOT NULL DEFAULT 'admissions-v1',
 "sourceMessageId" VARCHAR(256) NOT NULL UNIQUE,
 "assignedAdminId" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
 "convertedById" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
 "enrollmentId" INTEGER REFERENCES "enrollments"("id") ON DELETE RESTRICT, "confirmationDraft" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("status"='ENROLLED') = ("enrollmentId" IS NOT NULL))
);
CREATE UNIQUE INDEX "whatsapp_admission_one_open_per_conversation" ON "WhatsAppAdmissionRequest"("conversationId") WHERE "status" IN ('PENDING','PROCESSING');
CREATE INDEX "WhatsAppAdmissionRequest_status_createdAt_idx" ON "WhatsAppAdmissionRequest"("status","createdAt");
CREATE INDEX "WhatsAppAdmissionRequest_phoneNumber_idx" ON "WhatsAppAdmissionRequest"("phoneNumber");
CREATE TABLE "WhatsAppAdmissionEvent" (
 "id" SERIAL PRIMARY KEY, "requestId" INTEGER NOT NULL REFERENCES "WhatsAppAdmissionRequest"("id") ON DELETE RESTRICT,
 "adminId" INTEGER REFERENCES "users"("id") ON DELETE SET NULL, "action" VARCHAR(40) NOT NULL,
 "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WhatsAppAdmissionEvent_requestId_createdAt_idx" ON "WhatsAppAdmissionEvent"("requestId","createdAt");
COMMIT;
