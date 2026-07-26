CREATE TYPE "AssignmentSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LATE', 'GRADED', 'RETURNED');

CREATE TABLE "assignments" (
  "id" SERIAL NOT NULL,
  "course_id" INTEGER NOT NULL,
  "course_module_id" INTEGER,
  "lesson_id" INTEGER,
  "title" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "max_score" DECIMAL(6,2) NOT NULL,
  "due_at" TIMESTAMP(3),
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "allow_late_submission" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assignment_submissions" (
  "id" SERIAL NOT NULL,
  "assignment_id" INTEGER NOT NULL,
  "enrollment_id" INTEGER NOT NULL,
  "answer_text" TEXT,
  "answer_url" TEXT,
  "status" "AssignmentSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_at" TIMESTAMP(3),
  "score" DECIMAL(6,2),
  "feedback" TEXT,
  "graded_at" TIMESTAMP(3),
  "feedback_published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assignments_course_id_idx" ON "assignments"("course_id");
CREATE INDEX "assignments_course_module_id_idx" ON "assignments"("course_module_id");
CREATE INDEX "assignments_lesson_id_idx" ON "assignments"("lesson_id");
CREATE INDEX "assignments_is_published_idx" ON "assignments"("is_published");
CREATE INDEX "assignments_due_at_idx" ON "assignments"("due_at");
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_enrollment_id_key" ON "assignment_submissions"("assignment_id", "enrollment_id");
CREATE INDEX "assignment_submissions_assignment_id_idx" ON "assignment_submissions"("assignment_id");
CREATE INDEX "assignment_submissions_enrollment_id_idx" ON "assignment_submissions"("enrollment_id");
CREATE INDEX "assignment_submissions_status_idx" ON "assignment_submissions"("status");

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_module_id_fkey" FOREIGN KEY ("course_module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
