-- Replace the enrollment enum while preserving existing confirmed records.
ALTER TABLE "enrollments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "EnrollmentStatus" RENAME TO "EnrollmentStatus_old";
CREATE TYPE "EnrollmentStatus" AS ENUM ('TRIAL_ACTIVE', 'PAYMENT_REQUIRED', 'CONFIRMED', 'CANCELLED', 'PAYMENT_FAILED');
ALTER TABLE "enrollments"
ALTER COLUMN "status" TYPE "EnrollmentStatus"
USING (
  CASE
    WHEN "status"::text = 'PENDING_PAYMENT' THEN 'TRIAL_ACTIVE'
    ELSE "status"::text
  END
)::"EnrollmentStatus";
ALTER TABLE "enrollments" ALTER COLUMN "status" SET DEFAULT 'TRIAL_ACTIVE';
DROP TYPE "EnrollmentStatus_old";

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateTable
CREATE TABLE "class_meetings" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "private_meeting_url" TEXT NOT NULL,
    "training_session_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "class_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "class_meeting_id" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "class_meetings_training_session_id_idx" ON "class_meetings"("training_session_id");
CREATE INDEX "attendances_class_meeting_id_idx" ON "attendances"("class_meeting_id");
CREATE UNIQUE INDEX "attendances_enrollment_id_class_meeting_id_key" ON "attendances"("enrollment_id", "class_meeting_id");

ALTER TABLE "class_meetings"
ADD CONSTRAINT "class_meetings_training_session_id_fkey"
FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendances"
ADD CONSTRAINT "attendances_enrollment_id_fkey"
FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendances"
ADD CONSTRAINT "attendances_class_meeting_id_fkey"
FOREIGN KEY ("class_meeting_id") REFERENCES "class_meetings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
