CREATE TYPE "BackupType" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_RESTORE');
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DELETED');
CREATE TYPE "BackupVerificationStatus" AS ENUM ('NOT_VERIFIED', 'VALID', 'INVALID');

CREATE TABLE "database_backups" (
  "id" TEXT NOT NULL, "storage_key" TEXT NOT NULL, "size_bytes" BIGINT,
  "status" "BackupStatus" NOT NULL DEFAULT 'PENDING', "type" "BackupType" NOT NULL DEFAULT 'MANUAL',
  "checksum_sha256" TEXT, "postgres_version" TEXT,
  "verification_status" "BackupVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
  "last_verified_at" TIMESTAMP(3), "error_message" TEXT, "created_by_id" INTEGER,
  "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "database_backups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "database_backups_storage_key_format" CHECK ("storage_key" ~ '^[0-9a-f-]{36}\.dump$'),
  CONSTRAINT "database_backups_checksum_format" CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "database_backups_storage_key_key" ON "database_backups"("storage_key");
CREATE INDEX "database_backups_status_created_at_idx" ON "database_backups"("status","created_at");
CREATE INDEX "database_backups_verification_status_created_at_idx" ON "database_backups"("verification_status","created_at");

CREATE TABLE "backup_policies" (
  "id" TEXT NOT NULL DEFAULT 'MAIN', "retention_days" INTEGER NOT NULL DEFAULT 30,
  "max_backups" INTEGER NOT NULL DEFAULT 30, "auto_cleanup" BOOLEAN NOT NULL DEFAULT true,
  "daily_backup" BOOLEAN NOT NULL DEFAULT false, "daily_backup_time" TEXT NOT NULL DEFAULT '02:00',
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "backup_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_policies_singleton" CHECK ("id" = 'MAIN'),
  CONSTRAINT "backup_policies_values" CHECK ("retention_days" BETWEEN 1 AND 3650 AND "max_backups" BETWEEN 1 AND 1000 AND "daily_backup_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
CREATE TABLE "backup_audit_logs" (
  "id" SERIAL NOT NULL, "backup_id" TEXT, "actor_id" INTEGER, "action" TEXT NOT NULL,
  "result" TEXT NOT NULL, "request_id" TEXT, "ip_address" TEXT, "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "backup_audit_logs_backup_id_created_at_idx" ON "backup_audit_logs"("backup_id","created_at");
CREATE INDEX "backup_audit_logs_action_created_at_idx" ON "backup_audit_logs"("action","created_at");
CREATE TABLE "system_operation_locks" (
  "name" TEXT NOT NULL, "owner_token" TEXT NOT NULL, "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "system_operation_locks_pkey" PRIMARY KEY ("name")
);
CREATE INDEX "system_operation_locks_expires_at_idx" ON "system_operation_locks"("expires_at");
ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "backup_audit_logs" ADD CONSTRAINT "backup_audit_logs_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "database_backups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "backup_audit_logs" ADD CONSTRAINT "backup_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
