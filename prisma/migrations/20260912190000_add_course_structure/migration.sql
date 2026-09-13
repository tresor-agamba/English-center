-- Additive only: preserve all historical commercial amounts and relationships.
CREATE TYPE "TrainingStructure" AS ENUM ('SIMPLE', 'LEVEL_BASED');
CREATE TYPE "CourseAccessPolicy" AS ENUM ('LEGACY_STAGED', 'FULL_PAYMENT');
ALTER TABLE "courses"
  ADD COLUMN "structure_type" "TrainingStructure" NOT NULL DEFAULT 'SIMPLE',
  ADD COLUMN "number_of_levels" INTEGER,
  ADD COLUMN "session_count" INTEGER,
  ADD COLUMN "access_policy" "CourseAccessPolicy" NOT NULL DEFAULT 'LEGACY_STAGED';
ALTER TABLE "training_sessions" ADD COLUMN "level_number" INTEGER;
ALTER TABLE "courses" ADD CONSTRAINT "courses_structure_valid" CHECK (
  ("structure_type" = 'SIMPLE' AND "number_of_levels" IS NULL) OR
  ("structure_type" = 'LEVEL_BASED' AND "number_of_levels" >= 1 AND "number_of_levels" IS NOT NULL AND "session_count" IS NOT NULL)
);
ALTER TABLE "courses" ADD CONSTRAINT "courses_session_count_positive" CHECK ("session_count" IS NULL OR "session_count" > 0);
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_level_positive" CHECK ("level_number" IS NULL OR "level_number" > 0);
