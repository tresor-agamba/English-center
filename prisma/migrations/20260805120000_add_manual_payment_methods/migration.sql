ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MANUAL_PAYMENT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MANUAL_PAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MANUAL_PAYMENT_REJECTED';

CREATE TABLE "manual_payment_methods" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "beneficiary_name" TEXT,
    "account_number" TEXT,
    "account_holder" TEXT,
    "bank_name" TEXT,
    "swift_code" TEXT,
    "bank_branch" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "instructions_fr" TEXT,
    "instructions_en" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manual_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manual_payment_methods_code_key" ON "manual_payment_methods"("code");
CREATE INDEX "manual_payment_methods_is_enabled_display_order_idx" ON "manual_payment_methods"("is_enabled", "display_order");
