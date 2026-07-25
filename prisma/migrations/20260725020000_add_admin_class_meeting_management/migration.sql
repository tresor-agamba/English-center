-- CreateEnum
CREATE TYPE "ClassMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "class_meetings"
ADD COLUMN "status" "ClassMeetingStatus" NOT NULL DEFAULT 'SCHEDULED';

-- CreateIndex
CREATE UNIQUE INDEX "class_meetings_training_session_id_starts_at_key"
ON "class_meetings"("training_session_id", "starts_at");
