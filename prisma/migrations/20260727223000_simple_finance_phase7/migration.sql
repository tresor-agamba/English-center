CREATE TYPE "SimpleFeeType" AS ENUM ('FORMATION','SYLLABUS','CERTIFICATE');
CREATE TYPE "StudentInvoiceStatus" AS ENUM ('UNPAID','PARTIALLY_PAID','PAID','CANCELLED');
CREATE TYPE "SimplePaymentMethod" AS ENUM ('CASH','MOBILE_MONEY','BANK_TRANSFER','OTHER');
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INVOICE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECORDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RECEIPT_AVAILABLE';

CREATE TABLE "fee_configurations" ("id" SERIAL PRIMARY KEY,"type" "SimpleFeeType" NOT NULL,"level" "AcademicLevel","amount" DECIMAL(12,2) NOT NULL,"currency" TEXT NOT NULL,"is_active" BOOLEAN NOT NULL DEFAULT true,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "fee_amount_nonnegative" CHECK ("amount">=0),CONSTRAINT "fee_level_consistency" CHECK (("type"='FORMATION' AND "level" IS NOT NULL) OR ("type"<>'FORMATION' AND "level" IS NULL)),CONSTRAINT "fee_currency_allowed" CHECK ("currency" IN ('USD','CDF')));
CREATE UNIQUE INDEX "fee_configurations_type_level_key" ON "fee_configurations"("type","level");
CREATE UNIQUE INDEX "fee_configuration_single_global_key" ON "fee_configurations"("type") WHERE "level" IS NULL;
CREATE INDEX "fee_configurations_type_is_active_idx" ON "fee_configurations"("type","is_active");

CREATE TABLE "student_invoices" ("id" SERIAL PRIMARY KEY,"number" TEXT NOT NULL UNIQUE,"student_id" INTEGER NOT NULL,"academic_enrollment_id" INTEGER,"level" "AcademicLevel" NOT NULL,"total_amount" DECIMAL(12,2) NOT NULL,"paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,"balance_amount" DECIMAL(12,2) NOT NULL,"currency" TEXT NOT NULL,"status" "StudentInvoiceStatus" NOT NULL DEFAULT 'UNPAID',"issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"cancelled_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "invoice_amounts_valid" CHECK ("total_amount">=0 AND "paid_amount">=0 AND "balance_amount">=0 AND "paid_amount"<="total_amount"),CONSTRAINT "invoice_currency_allowed" CHECK ("currency" IN ('USD','CDF')));
CREATE INDEX "student_invoices_student_id_status_idx" ON "student_invoices"("student_id","status"); CREATE INDEX "student_invoices_academic_enrollment_id_idx" ON "student_invoices"("academic_enrollment_id"); CREATE INDEX "student_invoices_currency_status_idx" ON "student_invoices"("currency","status");

CREATE TABLE "student_invoice_lines" ("id" SERIAL PRIMARY KEY,"invoice_id" INTEGER NOT NULL,"type" "SimpleFeeType" NOT NULL,"label" TEXT NOT NULL,"amount" DECIMAL(12,2) NOT NULL,"currency" TEXT NOT NULL,"fee_configuration_id" INTEGER,"certificate_request_id" INTEGER,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "invoice_line_amount_valid" CHECK ("amount">=0),CONSTRAINT "invoice_line_currency_allowed" CHECK ("currency" IN ('USD','CDF')));
CREATE UNIQUE INDEX "student_invoice_lines_invoice_id_type_key" ON "student_invoice_lines"("invoice_id","type"); CREATE INDEX "student_invoice_lines_certificate_request_id_idx" ON "student_invoice_lines"("certificate_request_id");

CREATE TABLE "student_payments" ("id" SERIAL PRIMARY KEY,"invoice_id" INTEGER NOT NULL,"amount" DECIMAL(12,2) NOT NULL,"currency" TEXT NOT NULL,"method" "SimplePaymentMethod" NOT NULL,"reference" TEXT,"idempotency_key" TEXT NOT NULL UNIQUE,"paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"recorded_by_id" INTEGER NOT NULL,"comment" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "student_payment_amount_positive" CHECK ("amount">0),CONSTRAINT "student_payment_currency_allowed" CHECK ("currency" IN ('USD','CDF')));
CREATE INDEX "student_payments_invoice_id_paid_at_idx" ON "student_payments"("invoice_id","paid_at");
CREATE TABLE "payment_receipts" ("id" SERIAL PRIMARY KEY,"number" TEXT NOT NULL UNIQUE,"payment_id" INTEGER NOT NULL UNIQUE,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "financial_audit_logs" ("id" SERIAL PRIMARY KEY,"actor_id" INTEGER NOT NULL,"entity_type" TEXT NOT NULL,"entity_id" INTEGER NOT NULL,"action" TEXT NOT NULL,"data" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "financial_audit_logs_entity_type_entity_id_created_at_idx" ON "financial_audit_logs"("entity_type","entity_id","created_at");

ALTER TABLE "student_invoices" ADD FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT, ADD FOREIGN KEY ("academic_enrollment_id") REFERENCES "academic_enrollments"("id") ON DELETE RESTRICT;
ALTER TABLE "student_invoice_lines" ADD FOREIGN KEY ("invoice_id") REFERENCES "student_invoices"("id") ON DELETE RESTRICT, ADD FOREIGN KEY ("fee_configuration_id") REFERENCES "fee_configurations"("id") ON DELETE SET NULL, ADD FOREIGN KEY ("certificate_request_id") REFERENCES "certificate_requests"("id") ON DELETE SET NULL;
ALTER TABLE "student_payments" ADD FOREIGN KEY ("invoice_id") REFERENCES "student_invoices"("id") ON DELETE RESTRICT, ADD FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "payment_receipts" ADD FOREIGN KEY ("payment_id") REFERENCES "student_payments"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_audit_logs" ADD FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT;
