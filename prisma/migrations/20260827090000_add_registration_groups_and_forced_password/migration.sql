ALTER TABLE "users"
  ADD COLUMN "whatsapp_number" TEXT,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "registration_groups" (
  "id" SERIAL NOT NULL,
  "training_session_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "week_days" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "teacher_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "registration_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_groups_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_groups_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "registration_groups_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "registration_groups_time_check" CHECK ("end_time" > "start_time")
);

CREATE UNIQUE INDEX "registration_groups_training_session_id_name_key" ON "registration_groups"("training_session_id", "name");
CREATE INDEX "registration_groups_training_session_id_is_active_idx" ON "registration_groups"("training_session_id", "is_active");
CREATE INDEX "registration_groups_teacher_id_idx" ON "registration_groups"("teacher_id");

ALTER TABLE "enrollments" ADD COLUMN "registration_group_id" INTEGER;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_registration_group_id_fkey" FOREIGN KEY ("registration_group_id") REFERENCES "registration_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "enrollments_registration_group_id_status_idx" ON "enrollments"("registration_group_id", "status");
