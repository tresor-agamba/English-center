CREATE TYPE "WhatsAppSessionGroupStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "WhatsAppSessionInvitationStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNCERTAIN', 'JOINED');

CREATE TABLE "whatsapp_session_groups" (
    "id" SERIAL NOT NULL,
    "training_session_id" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "invitation_link" VARCHAR(512) NOT NULL,
    "status" "WhatsAppSessionGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "whatsapp_session_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_session_groups_training_session_id_key" ON "whatsapp_session_groups"("training_session_id");
CREATE INDEX "whatsapp_session_groups_status_idx" ON "whatsapp_session_groups"("status");
ALTER TABLE "whatsapp_session_groups" ADD CONSTRAINT "whatsapp_session_groups_training_session_id_fkey"
    FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "whatsapp_session_invitations" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "status" "WhatsAppSessionInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3) WITH TIME ZONE,
    "provider_message_id" VARCHAR(512),
    "idempotency_key" VARCHAR(128),
    "send_requested_at" TIMESTAMP(3) WITH TIME ZONE,
    "last_result" VARCHAR(100),
    "joined_at" TIMESTAMP(3) WITH TIME ZONE,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "whatsapp_session_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_session_invitations_enrollment_id_key" ON "whatsapp_session_invitations"("enrollment_id");
CREATE UNIQUE INDEX "whatsapp_session_invitations_provider_message_id_key" ON "whatsapp_session_invitations"("provider_message_id");
CREATE UNIQUE INDEX "whatsapp_session_invitations_idempotency_key_key" ON "whatsapp_session_invitations"("idempotency_key");
CREATE INDEX "whatsapp_session_invitations_group_id_status_idx" ON "whatsapp_session_invitations"("group_id", "status");
ALTER TABLE "whatsapp_session_invitations" ADD CONSTRAINT "whatsapp_session_invitations_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "whatsapp_session_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_session_invitations" ADD CONSTRAINT "whatsapp_session_invitations_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "WhatsAppSessionInvitationAttemptStatus" AS ENUM ('PROCESSING', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNCERTAIN');
CREATE TABLE "whatsapp_session_invitation_attempts" (
    "id" SERIAL NOT NULL,
    "invitation_id" INTEGER NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "WhatsAppSessionInvitationAttemptStatus" NOT NULL,
    "idempotency_key" VARCHAR(128),
    "provider_message_id" VARCHAR(512),
    "result_code" VARCHAR(100),
    "started_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3) WITH TIME ZONE,
    CONSTRAINT "whatsapp_session_invitation_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_invite_attempt_number_key" ON "whatsapp_session_invitation_attempts"("invitation_id", "attempt_number");
CREATE UNIQUE INDEX "whatsapp_session_invitation_attempts_idempotency_key_key" ON "whatsapp_session_invitation_attempts"("idempotency_key");
CREATE UNIQUE INDEX "whatsapp_session_invitation_attempts_provider_message_id_key" ON "whatsapp_session_invitation_attempts"("provider_message_id");
CREATE INDEX "whatsapp_invite_attempt_history_idx" ON "whatsapp_session_invitation_attempts"("invitation_id", "started_at");
ALTER TABLE "whatsapp_session_invitation_attempts" ADD CONSTRAINT "whatsapp_session_invitation_attempts_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "whatsapp_session_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
