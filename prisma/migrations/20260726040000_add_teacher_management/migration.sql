ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TEACHER';

CREATE TABLE "training_session_teachers" (
    "id" SERIAL NOT NULL,
    "training_session_id" INTEGER NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "is_lead_teacher" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "training_session_teachers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "training_session_teachers_training_session_id_teacher_id_key"
ON "training_session_teachers"("training_session_id", "teacher_id");
CREATE INDEX "training_session_teachers_teacher_id_idx" ON "training_session_teachers"("teacher_id");
CREATE INDEX "training_session_teachers_training_session_id_is_lead_teacher_idx"
ON "training_session_teachers"("training_session_id", "is_lead_teacher");
CREATE UNIQUE INDEX "training_session_teachers_one_lead_per_session"
ON "training_session_teachers"("training_session_id") WHERE "is_lead_teacher" = true;

ALTER TABLE "training_session_teachers"
ADD CONSTRAINT "training_session_teachers_training_session_id_fkey"
FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_session_teachers"
ADD CONSTRAINT "training_session_teachers_teacher_id_fkey"
FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignments" ADD COLUMN "training_session_id" INTEGER;
CREATE INDEX "assignments_training_session_id_idx" ON "assignments"("training_session_id");
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_training_session_id_fkey"
FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
