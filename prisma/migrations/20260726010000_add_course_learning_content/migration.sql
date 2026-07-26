-- CreateEnum
CREATE TYPE "LessonResourceType" AS ENUM ('PDF', 'VIDEO_LINK', 'EXTERNAL_LINK', 'DOCUMENT');

-- CreateTable
CREATE TABLE "course_modules" (
  "id" SERIAL NOT NULL,
  "course_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- Preserve existing lessons by creating one published module per course.
INSERT INTO "course_modules" ("course_id", "title", "description", "position", "is_published")
SELECT DISTINCT "course_id", 'Contenu existant', 'Module créé automatiquement pendant la migration.', 1, true
FROM "lessons";

ALTER TABLE "lessons"
ADD COLUMN "course_module_id" INTEGER,
ADD COLUMN "description" TEXT,
ADD COLUMN "estimated_minutes" INTEGER,
ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false;

UPDATE "lessons" l
SET "course_module_id" = m."id",
    "is_published" = true
FROM "course_modules" m
WHERE m."course_id" = l."course_id";

ALTER TABLE "lessons" ALTER COLUMN "course_module_id" SET NOT NULL;
ALTER TABLE "lessons" DROP COLUMN "course_id";

CREATE TABLE "lesson_resources" (
  "id" SERIAL NOT NULL,
  "lesson_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "type" "LessonResourceType" NOT NULL,
  "url" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lesson_progress" (
  "id" SERIAL NOT NULL,
  "enrollment_id" INTEGER NOT NULL,
  "lesson_id" INTEGER NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_modules_course_id_position_key" ON "course_modules"("course_id", "position");
CREATE INDEX "course_modules_course_id_idx" ON "course_modules"("course_id");
CREATE UNIQUE INDEX "lessons_course_module_id_position_key" ON "lessons"("course_module_id", "position");
CREATE INDEX "lessons_course_module_id_idx" ON "lessons"("course_module_id");
CREATE UNIQUE INDEX "lesson_resources_lesson_id_position_key" ON "lesson_resources"("lesson_id", "position");
CREATE INDEX "lesson_resources_lesson_id_idx" ON "lesson_resources"("lesson_id");
CREATE UNIQUE INDEX "lesson_progress_enrollment_id_lesson_id_key" ON "lesson_progress"("enrollment_id", "lesson_id");
CREATE INDEX "lesson_progress_enrollment_id_idx" ON "lesson_progress"("enrollment_id");
CREATE INDEX "lesson_progress_lesson_id_idx" ON "lesson_progress"("lesson_id");

ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_module_id_fkey"
FOREIGN KEY ("course_module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_resources" ADD CONSTRAINT "lesson_resources_lesson_id_fkey"
FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_fkey"
FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey"
FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
