CREATE TYPE "LessonType" AS ENUM ('TEXT', 'VIDEO', 'PDF', 'AUDIO', 'LINK', 'DOWNLOAD', 'EMBED', 'LIVE_SESSION');
CREATE TYPE "LmsCourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');
CREATE TYPE "LessonCompletionRule" AS ENUM ('IMMEDIATE', 'AFTER_ASSESSMENT_SUBMISSION', 'AFTER_ASSESSMENT_PASS');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_ARCHIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LESSON_AVAILABLE';

ALTER TABLE "courses"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" INTEGER,
  ADD COLUMN "lms_status" "LmsCourseStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "published_at" TIMESTAMP(3);
UPDATE "courses"
SET "lms_status" = CASE WHEN "is_published" THEN 'PUBLISHED'::"LmsCourseStatus" ELSE 'DRAFT'::"LmsCourseStatus" END,
    "published_at" = CASE WHEN "is_published" THEN "updated_at" ELSE NULL END;

ALTER TABLE "course_modules"
  ADD COLUMN "available_at" TIMESTAMP(3),
  ADD COLUMN "prerequisite_module_id" INTEGER;

CREATE TABLE "course_chapters" (
  "id" SERIAL NOT NULL,
  "course_module_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "available_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "course_chapters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_chapters_position_positive" CHECK ("position" > 0)
);

ALTER TABLE "lessons"
  ADD COLUMN "assessment_id" INTEGER,
  ADD COLUMN "available_at" TIMESTAMP(3),
  ADD COLUMN "completion_rule" "LessonCompletionRule" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "course_chapter_id" INTEGER,
  ADD COLUMN "external_url" TEXT,
  ADD COLUMN "type" "LessonType" NOT NULL DEFAULT 'TEXT';

ALTER TABLE "lesson_resources"
  ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "original_file_name" TEXT,
  ADD COLUMN "public_id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "storage_key" TEXT,
  ALTER COLUMN "url" DROP NOT NULL;

ALTER TABLE "lesson_progress"
  ADD COLUMN "last_opened_at" TIMESTAMP(3),
  ADD COLUMN "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "opened_at" TIMESTAMP(3),
  ADD COLUMN "time_spent_seconds" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "lesson_progress_time_nonnegative" CHECK ("time_spent_seconds" >= 0),
  ADD CONSTRAINT "lesson_progress_position_nonnegative" CHECK ("last_position_seconds" >= 0);

DROP INDEX "lessons_course_module_id_position_key";
CREATE UNIQUE INDEX "lessons_unassigned_chapter_position_key"
  ON "lessons" ("course_module_id", "position") WHERE "course_chapter_id" IS NULL;
CREATE UNIQUE INDEX "lessons_course_chapter_id_position_key"
  ON "lessons" ("course_chapter_id", "position") WHERE "course_chapter_id" IS NOT NULL;
CREATE INDEX "lessons_course_chapter_id_idx" ON "lessons"("course_chapter_id");
CREATE INDEX "lessons_assessment_id_idx" ON "lessons"("assessment_id");
CREATE INDEX "course_chapters_course_module_id_idx" ON "course_chapters"("course_module_id");
CREATE UNIQUE INDEX "course_chapters_course_module_id_position_key" ON "course_chapters"("course_module_id", "position");
CREATE INDEX "course_modules_prerequisite_module_id_idx" ON "course_modules"("prerequisite_module_id");
CREATE INDEX "courses_lms_status_idx" ON "courses"("lms_status");
CREATE INDEX "courses_created_by_id_idx" ON "courses"("created_by_id");
CREATE UNIQUE INDEX "lesson_resources_public_id_key" ON "lesson_resources"("public_id");
CREATE INDEX "lesson_progress_enrollment_completed_idx" ON "lesson_progress"("enrollment_id", "completed_at");

ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_prerequisite_module_id_fkey"
  FOREIGN KEY ("prerequisite_module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_chapters" ADD CONSTRAINT "course_chapters_course_module_id_fkey"
  FOREIGN KEY ("course_module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_chapter_id_fkey"
  FOREIGN KEY ("course_chapter_id") REFERENCES "course_chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
