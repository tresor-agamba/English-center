-- CreateEnum
CREATE TYPE "CourseType" AS ENUM (
  'GENERAL_ENGLISH',
  'BUSINESS_ENGLISH',
  'ENGLISH_FOR_BANKERS',
  'CONVERSATION',
  'IELTS_PREPARATION',
  'BEGINNER_ENGLISH',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('HOURS', 'DAYS', 'WEEKS', 'MONTHS');

-- AlterTable Course
ALTER TABLE "courses"
ADD COLUMN "course_type" "CourseType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "duration_value" INTEGER,
ADD COLUMN "duration_unit" "DurationUnit";

-- AlterTable TrainingSession: derive safe values for existing rows.
ALTER TABLE "training_sessions"
ADD COLUMN "week_days" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "start_time" TEXT,
ADD COLUMN "end_time" TEXT;

UPDATE "training_sessions"
SET
  "week_days" = ARRAY[upper(trim(to_char("start_date", 'DAY')))],
  "start_time" = to_char("start_date", 'HH24:MI'),
  "end_time" = to_char("end_date", 'HH24:MI')
WHERE "start_time" IS NULL OR "end_time" IS NULL;

ALTER TABLE "training_sessions" ALTER COLUMN "start_time" SET NOT NULL;
ALTER TABLE "training_sessions" ALTER COLUMN "end_time" SET NOT NULL;
ALTER TABLE "training_sessions" ALTER COLUMN "start_time" SET DEFAULT '00:00';
ALTER TABLE "training_sessions" ALTER COLUMN "end_time" SET DEFAULT '00:00';
