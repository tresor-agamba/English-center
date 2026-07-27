-- CreateEnum
CREATE TYPE "AssessmentMode" AS ENUM ('WRITTEN', 'RECORDED_ORAL', 'LIVE_VIDEO_ORAL');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssessmentQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'SHORT_TEXT', 'LONG_TEXT', 'READING_COMPREHENSION', 'LISTENING_COMPREHENSION', 'ESSAY', 'ORAL_QUIZ', 'RECORDED_PRESENTATION', 'READ_ALOUD', 'IMAGE_DESCRIPTION', 'LISTEN_AND_RESPOND', 'PRONUNCIATION', 'PROFESSIONAL_SIMULATION', 'SHORT_ORAL_RESPONSE', 'LONG_ORAL_RESPONSE');

-- CreateEnum
CREATE TYPE "AssessmentAttemptStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'GRADED', 'RETURNED');

-- CreateEnum
CREATE TYPE "AssessmentEvaluationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AssessmentDecision" AS ENUM ('UNDECIDED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "LiveOralSessionStatus" AS ENUM ('SCHEDULED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'ABSENT', 'CANCELLED', 'RESCHEDULED', 'GRADED');

-- CreateEnum
CREATE TYPE "LiveOralAttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'TECHNICAL_ISSUE');

-- CreateEnum
CREATE TYPE "LiveOralParticipantRole" AS ENUM ('CANDIDATE', 'PARTNER');

-- CreateEnum
CREATE TYPE "LiveOralExaminerRole" AS ENUM ('LEAD', 'EXAMINER', 'JURY');

-- AlterEnum
ALTER TYPE "MeetingPlatform" ADD VALUE 'JITSI';

-- CreateTable
CREATE TABLE "assessments" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "mode" "AssessmentMode" NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "course_id" INTEGER NOT NULL,
    "training_session_id" INTEGER,
    "created_by_id" INTEGER NOT NULL,
    "open_at" TIMESTAMP(3),
    "close_at" TIMESTAMP(3),
    "total_points" DECIMAL(8,2) NOT NULL,
    "passing_score" DECIMAL(8,2) NOT NULL,
    "preparation_seconds" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "max_recording_seconds" INTEGER,
    "allow_playback" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "type" "AssessmentQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "expected_answer" JSONB,
    "media_storage_key" TEXT,
    "media_mime_type" TEXT,
    "preparation_seconds" INTEGER,
    "max_response_seconds" INTEGER,
    "max_attempts" INTEGER,
    "position" INTEGER NOT NULL,
    "points" DECIMAL(8,2) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "AssessmentAttemptStatus" NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_responses" (
    "id" SERIAL NOT NULL,
    "assessment_attempt_id" INTEGER NOT NULL,
    "assessment_question_id" INTEGER NOT NULL,
    "text_response" TEXT,
    "selected_options" JSONB,
    "audio_storage_key" TEXT,
    "audio_original_file_name" TEXT,
    "audio_mime_type" TEXT,
    "audio_size_bytes" INTEGER,
    "audio_duration_seconds" INTEGER,
    "audio_checksum" TEXT,
    "recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_criteria" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(6,2) NOT NULL,
    "max_score" DECIMAL(8,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_evaluations" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "assessment_attempt_id" INTEGER,
    "live_oral_session_id" INTEGER,
    "evaluator_id" INTEGER NOT NULL,
    "status" "AssessmentEvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "overall_score" DECIMAL(8,2) NOT NULL,
    "feedback" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "audio_feedback_storage_key" TEXT,
    "audio_feedback_mime_type" TEXT,
    "audio_feedback_duration_sec" INTEGER,
    "decision" "AssessmentDecision" NOT NULL DEFAULT 'UNDECIDED',
    "graded_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_criterion_scores" (
    "id" SERIAL NOT NULL,
    "assessment_evaluation_id" INTEGER NOT NULL,
    "assessment_criterion_id" INTEGER NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "criterion_label_snapshot" TEXT NOT NULL,
    "criterion_weight_snapshot" DECIMAL(6,2) NOT NULL,
    "criterion_max_score_snapshot" DECIMAL(8,2) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_oral_sessions" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "training_session_id" INTEGER NOT NULL,
    "scheduled_start_at" TIMESTAMP(3) NOT NULL,
    "scheduled_end_at" TIMESTAMP(3) NOT NULL,
    "meeting_platform" "MeetingPlatform" NOT NULL DEFAULT 'OTHER',
    "private_meeting_url" TEXT NOT NULL,
    "meeting_code" TEXT,
    "status" "LiveOralSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "access_before_minutes" INTEGER NOT NULL DEFAULT 30,
    "access_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "rescheduled_from_id" INTEGER,
    "rescheduled_by_id" INTEGER,
    "rescheduled_at" TIMESTAMP(3),
    "reschedule_reason" TEXT,
    "cancelled_by_id" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_oral_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_oral_participants" (
    "id" SERIAL NOT NULL,
    "live_oral_session_id" INTEGER NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "role" "LiveOralParticipantRole" NOT NULL DEFAULT 'CANDIDATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_oral_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_oral_examiners" (
    "id" SERIAL NOT NULL,
    "live_oral_session_id" INTEGER NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "role" "LiveOralExaminerRole" NOT NULL DEFAULT 'EXAMINER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_oral_examiners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_oral_attendances" (
    "id" SERIAL NOT NULL,
    "live_oral_session_id" INTEGER NOT NULL,
    "live_oral_participant_id" INTEGER NOT NULL,
    "status" "LiveOralAttendanceStatus" NOT NULL,
    "marked_by_teacher_id" INTEGER NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_oral_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oral_session_events" (
    "id" SERIAL NOT NULL,
    "live_oral_session_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "LiveOralSessionStatus",
    "to_status" "LiveOralSessionStatus",
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oral_session_events_pkey" PRIMARY KEY ("id")
);

-- Business invariants enforced at database level
ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_points_check" CHECK ("total_points" > 0 AND "passing_score" >= 0 AND "passing_score" <= "total_points"),
  ADD CONSTRAINT "assessments_window_check" CHECK ("open_at" IS NULL OR "close_at" IS NULL OR "close_at" > "open_at"),
  ADD CONSTRAINT "assessments_limits_check" CHECK ("preparation_seconds" >= 0 AND "max_attempts" > 0 AND ("max_recording_seconds" IS NULL OR "max_recording_seconds" > 0)),
  ADD CONSTRAINT "assessments_recording_mode_check" CHECK (
    ("mode" = 'RECORDED_ORAL' AND "max_recording_seconds" IS NOT NULL)
    OR ("mode" <> 'RECORDED_ORAL' AND "max_recording_seconds" IS NULL)
  );

ALTER TABLE "assessment_questions"
  ADD CONSTRAINT "assessment_questions_values_check" CHECK (
    "position" > 0 AND "points" > 0
    AND ("preparation_seconds" IS NULL OR "preparation_seconds" >= 0)
    AND ("max_response_seconds" IS NULL OR "max_response_seconds" > 0)
    AND ("max_attempts" IS NULL OR "max_attempts" > 0)
  );

ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "assessment_attempts_number_check" CHECK ("attempt_number" > 0),
  ADD CONSTRAINT "assessment_attempts_dates_check" CHECK (
    ("submitted_at" IS NULL OR "submitted_at" >= "started_at")
    AND ("graded_at" IS NULL OR ("submitted_at" IS NOT NULL AND "graded_at" >= "submitted_at"))
  );

ALTER TABLE "assessment_responses"
  ADD CONSTRAINT "assessment_responses_audio_values_check" CHECK (
    ("audio_size_bytes" IS NULL OR "audio_size_bytes" > 0)
    AND ("audio_duration_seconds" IS NULL OR "audio_duration_seconds" > 0)
  ),
  ADD CONSTRAINT "assessment_responses_content_check" CHECK (
    "text_response" IS NOT NULL OR "selected_options" IS NOT NULL OR "audio_storage_key" IS NOT NULL
  );

ALTER TABLE "assessment_criteria"
  ADD CONSTRAINT "assessment_criteria_values_check" CHECK (
    "position" > 0 AND "weight" > 0 AND "weight" <= 100 AND "max_score" > 0
  );

ALTER TABLE "assessment_evaluations"
  ADD CONSTRAINT "assessment_evaluations_source_check" CHECK (
    ("assessment_attempt_id" IS NOT NULL AND "live_oral_session_id" IS NULL)
    OR ("assessment_attempt_id" IS NULL AND "live_oral_session_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "assessment_evaluations_score_check" CHECK ("overall_score" >= 0),
  ADD CONSTRAINT "assessment_evaluations_audio_feedback_check" CHECK (
    "audio_feedback_duration_sec" IS NULL OR "audio_feedback_duration_sec" > 0
  );

ALTER TABLE "assessment_criterion_scores"
  ADD CONSTRAINT "assessment_criterion_scores_values_check" CHECK (
    "score" >= 0 AND "score" <= "criterion_max_score_snapshot"
    AND "criterion_weight_snapshot" > 0 AND "criterion_weight_snapshot" <= 100
    AND "criterion_max_score_snapshot" > 0
  );

ALTER TABLE "live_oral_sessions"
  ADD CONSTRAINT "live_oral_sessions_window_check" CHECK ("scheduled_end_at" > "scheduled_start_at"),
  ADD CONSTRAINT "live_oral_sessions_access_check" CHECK (
    "access_before_minutes" >= 0 AND "access_before_minutes" <= 1440
    AND "access_after_minutes" >= 0 AND "access_after_minutes" <= 1440
  ),
  ADD CONSTRAINT "live_oral_sessions_reschedule_check" CHECK (
    ("status" <> 'RESCHEDULED' AND "rescheduled_from_id" IS NULL)
    OR ("rescheduled_by_id" IS NOT NULL AND "rescheduled_at" IS NOT NULL AND length(trim("reschedule_reason")) >= 3)
  ),
  ADD CONSTRAINT "live_oral_sessions_cancellation_check" CHECK (
    "status" <> 'CANCELLED'
    OR ("cancelled_by_id" IS NOT NULL AND "cancelled_at" IS NOT NULL AND length(trim("cancellation_reason")) >= 3)
  );

-- CreateIndex
CREATE INDEX "assessments_course_id_status_idx" ON "assessments"("course_id", "status");

-- CreateIndex
CREATE INDEX "assessments_training_session_id_status_idx" ON "assessments"("training_session_id", "status");

-- CreateIndex
CREATE INDEX "assessments_mode_status_idx" ON "assessments"("mode", "status");

-- CreateIndex
CREATE INDEX "assessments_open_at_close_at_idx" ON "assessments"("open_at", "close_at");

-- CreateIndex
CREATE INDEX "assessment_questions_assessment_id_type_idx" ON "assessment_questions"("assessment_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_assessment_id_position_key" ON "assessment_questions"("assessment_id", "position");

-- CreateIndex
CREATE INDEX "assessment_attempts_enrollment_id_status_idx" ON "assessment_attempts"("enrollment_id", "status");

-- CreateIndex
CREATE INDEX "assessment_attempts_assessment_id_status_idx" ON "assessment_attempts"("assessment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_assessment_id_enrollment_id_attempt_num_key" ON "assessment_attempts"("assessment_id", "enrollment_id", "attempt_number");

-- CreateIndex
CREATE INDEX "assessment_responses_assessment_question_id_idx" ON "assessment_responses"("assessment_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_responses_assessment_attempt_id_assessment_quest_key" ON "assessment_responses"("assessment_attempt_id", "assessment_question_id");

-- CreateIndex
CREATE INDEX "assessment_criteria_assessment_id_idx" ON "assessment_criteria"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_criteria_assessment_id_code_key" ON "assessment_criteria"("assessment_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_criteria_assessment_id_position_key" ON "assessment_criteria"("assessment_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_evaluations_assessment_attempt_id_key" ON "assessment_evaluations"("assessment_attempt_id");

-- CreateIndex
CREATE INDEX "assessment_evaluations_assessment_id_status_idx" ON "assessment_evaluations"("assessment_id", "status");

-- CreateIndex
CREATE INDEX "assessment_evaluations_enrollment_id_status_idx" ON "assessment_evaluations"("enrollment_id", "status");

-- CreateIndex
CREATE INDEX "assessment_evaluations_evaluator_id_idx" ON "assessment_evaluations"("evaluator_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_evaluations_live_oral_session_id_enrollment_id_key" ON "assessment_evaluations"("live_oral_session_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "assessment_criterion_scores_assessment_criterion_id_idx" ON "assessment_criterion_scores"("assessment_criterion_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_criterion_scores_assessment_evaluation_id_assess_key" ON "assessment_criterion_scores"("assessment_evaluation_id", "assessment_criterion_id");

-- CreateIndex
CREATE INDEX "live_oral_sessions_assessment_id_status_idx" ON "live_oral_sessions"("assessment_id", "status");

-- CreateIndex
CREATE INDEX "live_oral_sessions_training_session_id_scheduled_start_at_idx" ON "live_oral_sessions"("training_session_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "live_oral_sessions_scheduled_start_at_scheduled_end_at_idx" ON "live_oral_sessions"("scheduled_start_at", "scheduled_end_at");

-- CreateIndex
CREATE INDEX "live_oral_sessions_rescheduled_from_id_idx" ON "live_oral_sessions"("rescheduled_from_id");

-- CreateIndex
CREATE INDEX "live_oral_participants_enrollment_id_idx" ON "live_oral_participants"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_oral_participants_live_oral_session_id_enrollment_id_key" ON "live_oral_participants"("live_oral_session_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "live_oral_examiners_teacher_id_idx" ON "live_oral_examiners"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_oral_examiners_live_oral_session_id_teacher_id_key" ON "live_oral_examiners"("live_oral_session_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_oral_attendances_live_oral_participant_id_key" ON "live_oral_attendances"("live_oral_participant_id");

-- CreateIndex
CREATE INDEX "live_oral_attendances_live_oral_session_id_status_idx" ON "live_oral_attendances"("live_oral_session_id", "status");

-- CreateIndex
CREATE INDEX "live_oral_attendances_marked_by_teacher_id_idx" ON "live_oral_attendances"("marked_by_teacher_id");

-- CreateIndex
CREATE INDEX "oral_session_events_live_oral_session_id_created_at_idx" ON "oral_session_events"("live_oral_session_id", "created_at");

-- CreateIndex
CREATE INDEX "oral_session_events_actor_id_idx" ON "oral_session_events"("actor_id");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessment_attempt_id_fkey" FOREIGN KEY ("assessment_attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessment_question_id_fkey" FOREIGN KEY ("assessment_question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_criteria" ADD CONSTRAINT "assessment_criteria_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_evaluations" ADD CONSTRAINT "assessment_evaluations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_evaluations" ADD CONSTRAINT "assessment_evaluations_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_evaluations" ADD CONSTRAINT "assessment_evaluations_assessment_attempt_id_fkey" FOREIGN KEY ("assessment_attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_evaluations" ADD CONSTRAINT "assessment_evaluations_live_oral_session_id_fkey" FOREIGN KEY ("live_oral_session_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_evaluations" ADD CONSTRAINT "assessment_evaluations_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_criterion_scores" ADD CONSTRAINT "assessment_criterion_scores_assessment_evaluation_id_fkey" FOREIGN KEY ("assessment_evaluation_id") REFERENCES "assessment_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_criterion_scores" ADD CONSTRAINT "assessment_criterion_scores_assessment_criterion_id_fkey" FOREIGN KEY ("assessment_criterion_id") REFERENCES "assessment_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_rescheduled_by_id_fkey" FOREIGN KEY ("rescheduled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_sessions" ADD CONSTRAINT "live_oral_sessions_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_participants" ADD CONSTRAINT "live_oral_participants_live_oral_session_id_fkey" FOREIGN KEY ("live_oral_session_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_participants" ADD CONSTRAINT "live_oral_participants_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_examiners" ADD CONSTRAINT "live_oral_examiners_live_oral_session_id_fkey" FOREIGN KEY ("live_oral_session_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_examiners" ADD CONSTRAINT "live_oral_examiners_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_attendances" ADD CONSTRAINT "live_oral_attendances_live_oral_session_id_fkey" FOREIGN KEY ("live_oral_session_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_attendances" ADD CONSTRAINT "live_oral_attendances_live_oral_participant_id_fkey" FOREIGN KEY ("live_oral_participant_id") REFERENCES "live_oral_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_oral_attendances" ADD CONSTRAINT "live_oral_attendances_marked_by_teacher_id_fkey" FOREIGN KEY ("marked_by_teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oral_session_events" ADD CONSTRAINT "oral_session_events_live_oral_session_id_fkey" FOREIGN KEY ("live_oral_session_id") REFERENCES "live_oral_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oral_session_events" ADD CONSTRAINT "oral_session_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
