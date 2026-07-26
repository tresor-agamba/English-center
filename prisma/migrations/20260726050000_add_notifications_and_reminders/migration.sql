CREATE TYPE "NotificationType" AS ENUM ('LIVE_CLASS_REMINDER','LIVE_CLASS_CANCELLED','LIVE_CLASS_RESCHEDULED','ASSIGNMENT_PUBLISHED','ASSIGNMENT_DEADLINE_REMINDER','ASSIGNMENT_GRADED','FEEDBACK_PUBLISHED','PAYMENT_REQUIRED','PAYMENT_CONFIRMED','ENROLLMENT_CONFIRMED','TRIAL_ENDING','TEACHER_ASSIGNED','TEACHER_UNASSIGNED','GENERAL_ANNOUNCEMENT');
CREATE TYPE "NotificationPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING','PROCESSING','SENT','CANCELLED','FAILED');

CREATE TABLE "notifications" (
 "id" SERIAL PRIMARY KEY, "user_id" INTEGER NOT NULL, "type" "NotificationType" NOT NULL,
 "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL', "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
 "title" TEXT NOT NULL, "message" TEXT NOT NULL, "action_url" TEXT, "related_entity" TEXT, "related_id" INTEGER,
 "deduplication_key" TEXT, "read_at" TIMESTAMP(3), "deleted_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "notifications_deduplication_key_key" ON "notifications"("deduplication_key");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id","read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id","created_at");
CREATE INDEX "notifications_type_idx" ON "notifications"("type");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "scheduled_reminders" (
 "id" SERIAL PRIMARY KEY, "user_id" INTEGER NOT NULL, "type" "NotificationType" NOT NULL,
 "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL', "title" TEXT NOT NULL, "message" TEXT NOT NULL,
 "action_url" TEXT, "related_entity" TEXT, "related_id" INTEGER, "scheduled_for" TIMESTAMP(3) NOT NULL,
 "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "processed_at" TIMESTAMP(3), "failure_reason" TEXT, "deduplication_key" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "scheduled_reminders_deduplication_key_key" ON "scheduled_reminders"("deduplication_key");
CREATE INDEX "scheduled_reminders_status_scheduled_for_idx" ON "scheduled_reminders"("status","scheduled_for");
CREATE INDEX "scheduled_reminders_user_id_idx" ON "scheduled_reminders"("user_id");
CREATE INDEX "scheduled_reminders_related_entity_related_id_idx" ON "scheduled_reminders"("related_entity","related_id");
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "announcements" (
 "id" SERIAL PRIMARY KEY, "title" TEXT NOT NULL, "message" TEXT NOT NULL, "action_url" TEXT,
 "audience_type" TEXT NOT NULL, "audience_ref" TEXT, "recipient_count" INTEGER NOT NULL DEFAULT 0,
 "created_by_id" INTEGER NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at");
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
