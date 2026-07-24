-- AlterTable
ALTER TABLE "training_sessions"
ADD COLUMN "platform" TEXT,
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Kinshasa';
