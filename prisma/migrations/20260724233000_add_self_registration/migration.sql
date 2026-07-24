-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'PAYMENT_FAILED');

-- AlterTable
ALTER TABLE "enrollments"
ADD COLUMN "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT';

-- Existing enrollments predate online payment and are treated as confirmed.
UPDATE "enrollments" SET "status" = 'CONFIRMED';
