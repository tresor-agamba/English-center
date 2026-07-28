ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'PLACEMENT_TEST_REQUIRED';

ALTER TABLE "users"
  ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

ALTER TABLE "enrollments"
  ADD COLUMN "requested_level" "AcademicLevel",
  ADD COLUMN "recommended_level" "AcademicLevel",
  ADD COLUMN "approved_level" "AcademicLevel",
  ADD COLUMN "placement_test_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "placement_test_score" INTEGER,
  ADD COLUMN "placement_test_completed_at" TIMESTAMP(3);
