-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssessmentQuestionType" ADD VALUE 'MULTIPLE_SELECT';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'TRUE_FALSE';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'FILL_IN_THE_BLANK';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'MATCHING';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'ORDERING';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'LISTENING';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'READING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WRITTEN_ASSESSMENT_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'WRITTEN_ATTEMPT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'WRITTEN_RESULT_PUBLISHED';

-- AlterTable
ALTER TABLE "assessment_attempts" ADD COLUMN     "auto_submitted_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "assessment_questions" ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "parent_question_id" INTEGER;

-- AlterTable
ALTER TABLE "assessment_responses" ADD COLUMN     "awarded_points" DECIMAL(8,2),
ADD COLUMN     "grading_feedback" TEXT,
ADD COLUMN     "is_auto_graded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "time_limit_minutes" INTEGER;

-- CreateIndex
CREATE INDEX "assessment_questions_parent_question_id_idx" ON "assessment_questions"("parent_question_id");

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_parent_question_id_fkey" FOREIGN KEY ("parent_question_id") REFERENCES "assessment_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
