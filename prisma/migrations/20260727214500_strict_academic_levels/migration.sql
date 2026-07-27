CREATE TYPE "AcademicLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3');

ALTER TABLE "academic_cohorts" ADD COLUMN "level" "AcademicLevel";
UPDATE "academic_cohorts" AS cohort
SET "level" = level."code"::text::"AcademicLevel"
FROM "academic_levels" AS level
WHERE cohort."level_id" = level."id"
  AND level."code" IN ('LEVEL_1', 'LEVEL_2', 'LEVEL_3');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "academic_cohorts" WHERE "level" IS NULL) THEN
    RAISE EXCEPTION 'Migration impossible: une cohorte utilise un niveau autre que LEVEL_1, LEVEL_2 ou LEVEL_3';
  END IF;
END $$;
ALTER TABLE "academic_cohorts" ALTER COLUMN "level" SET NOT NULL;

ALTER TABLE "academic_enrollments" ADD COLUMN "entry_level" "AcademicLevel";
UPDATE "academic_enrollments" AS enrollment
SET "entry_level" = level."code"::text::"AcademicLevel"
FROM "academic_levels" AS level
WHERE enrollment."entry_level_id" = level."id"
  AND level."code" IN ('LEVEL_1', 'LEVEL_2', 'LEVEL_3');

ALTER TABLE "academic_cohorts" DROP CONSTRAINT "academic_cohorts_level_id_fkey";
ALTER TABLE "academic_enrollments" DROP CONSTRAINT "academic_enrollments_entry_level_id_fkey";
DROP INDEX "academic_cohorts_level_id_status_idx";
ALTER TABLE "academic_cohorts" DROP COLUMN "level_id";
ALTER TABLE "academic_enrollments" DROP COLUMN "entry_level_id";
DROP TABLE "academic_levels";
CREATE INDEX "academic_cohorts_level_status_idx" ON "academic_cohorts"("level", "status");
