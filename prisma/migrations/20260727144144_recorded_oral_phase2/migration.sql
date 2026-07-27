-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RECORDED_ORAL_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'RECORDED_ORAL_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'RECORDED_ORAL_RESULT_PUBLISHED';

-- AlterTable
ALTER TABLE "assessment_responses" ADD COLUMN     "replacement_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "assessment_responses"
  ADD CONSTRAINT "assessment_responses_replacement_count_check" CHECK ("replacement_count" >= 0);
