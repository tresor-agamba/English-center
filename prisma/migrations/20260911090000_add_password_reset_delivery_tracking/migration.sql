CREATE TYPE "PasswordResetDeliveryChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS');
CREATE TYPE "PasswordResetDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');
ALTER TABLE "password_reset_requests"
  ADD COLUMN "delivery_channel" "PasswordResetDeliveryChannel",
  ADD COLUMN "delivery_status" "PasswordResetDeliveryStatus",
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_attempted_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "password_reset_tokens" ADD COLUMN "delivery_pending" BOOLEAN NOT NULL DEFAULT false;
