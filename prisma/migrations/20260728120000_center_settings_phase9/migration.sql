CREATE TABLE "center_settings" (
  "id" TEXT NOT NULL DEFAULT 'MAIN',
  "official_name" TEXT NOT NULL DEFAULT 'English Center', "short_name" TEXT, "description" TEXT,
  "address" TEXT, "city" TEXT DEFAULT 'Kinshasa', "country" TEXT DEFAULT 'RDC',
  "primary_phone" TEXT, "secondary_phone" TEXT, "email" TEXT, "website" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Kinshasa', "primary_language" TEXT NOT NULL DEFAULT 'fr',
  "primary_currency" TEXT NOT NULL DEFAULT 'USD', "is_active" BOOLEAN NOT NULL DEFAULT true,
  "main_logo_file_id" INTEGER, "secondary_logo_file_id" INTEGER, "favicon_file_id" INTEGER,
  "primary_color" TEXT NOT NULL DEFAULT '#1D4ED8', "secondary_color" TEXT NOT NULL DEFAULT '#173B57', "accent_color" TEXT NOT NULL DEFAULT '#C9A95E',
  "default_cohort_capacity" INTEGER NOT NULL DEFAULT 30, "default_group_capacity" INTEGER NOT NULL DEFAULT 20,
  "default_session_minutes" INTEGER NOT NULL DEFAULT 60, "usual_start_time" TEXT NOT NULL DEFAULT '08:00', "usual_end_time" TEXT NOT NULL DEFAULT '17:00',
  "opening_days" TEXT[] DEFAULT ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY']::TEXT[],
  "default_training_mode" "AcademicGroupModality" NOT NULL DEFAULT 'IN_PERSON',
  "tolerated_late_minutes" INTEGER NOT NULL DEFAULT 15, "online_courses_enabled" BOOLEAN NOT NULL DEFAULT true,
  "in_person_courses_enabled" BOOLEAN NOT NULL DEFAULT true, "hybrid_courses_enabled" BOOLEAN NOT NULL DEFAULT true,
  "invoice_prefix" TEXT NOT NULL DEFAULT 'INV', "receipt_prefix" TEXT NOT NULL DEFAULT 'REC',
  "next_invoice_number" BIGINT NOT NULL DEFAULT 1, "next_receipt_number" BIGINT NOT NULL DEFAULT 1,
  "training_fees_enabled" BOOLEAN NOT NULL DEFAULT true, "syllabus_fees_enabled" BOOLEAN NOT NULL DEFAULT true, "certificate_fees_enabled" BOOLEAN NOT NULL DEFAULT true,
  "show_balance_on_receipts" BOOLEAN NOT NULL DEFAULT true, "show_payment_method" BOOLEAN NOT NULL DEFAULT true, "show_payment_reference" BOOLEAN NOT NULL DEFAULT true,
  "certificates_enabled" BOOLEAN NOT NULL DEFAULT true, "certificate_signer_name" TEXT NOT NULL DEFAULT 'Direction English Center',
  "certificate_signer_title" TEXT NOT NULL DEFAULT 'Direction', "certificate_signature_file_id" INTEGER, "certificate_stamp_file_id" INTEGER,
  "certificate_intro_text" TEXT NOT NULL DEFAULT 'Le présent certificat atteste que', "certificate_validation_text" TEXT NOT NULL DEFAULT 'a suivi avec succès la formation',
  "certificate_issue_place" TEXT DEFAULT 'Kinshasa', "certificate_number_format" TEXT NOT NULL DEFAULT 'CERT-{YEAR}-{NUMBER}',
  "certificate_show_verification_code" BOOLEAN NOT NULL DEFAULT true, "certificate_show_logo" BOOLEAN NOT NULL DEFAULT true,
  "document_show_logo" BOOLEAN NOT NULL DEFAULT true, "document_show_center_name" BOOLEAN NOT NULL DEFAULT true,
  "document_show_address" BOOLEAN NOT NULL DEFAULT true, "document_show_phone" BOOLEAN NOT NULL DEFAULT true,
  "document_show_email" BOOLEAN NOT NULL DEFAULT true, "document_show_currency" BOOLEAN NOT NULL DEFAULT true,
  "document_footer" TEXT, "document_thank_you_text" TEXT DEFAULT 'Merci pour votre confiance.',
  "document_signature_file_id" INTEGER, "document_stamp_file_id" INTEGER,
  "lms_enabled" BOOLEAN NOT NULL DEFAULT true, "lms_progression_mode" TEXT NOT NULL DEFAULT 'FREE',
  "lms_max_tracked_minutes_per_action" INTEGER NOT NULL DEFAULT 30, "lms_require_previous_lesson" BOOLEAN NOT NULL DEFAULT false,
  "lms_downloads_enabled" BOOLEAN NOT NULL DEFAULT true, "lms_auto_resume_enabled" BOOLEAN NOT NULL DEFAULT true, "lms_time_tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
  "student_welcome_message" TEXT, "teacher_welcome_message" TEXT,
  "written_assessments_enabled" BOOLEAN NOT NULL DEFAULT true, "recorded_oral_assessments_enabled" BOOLEAN NOT NULL DEFAULT true,
  "live_video_oral_assessments_enabled" BOOLEAN NOT NULL DEFAULT true, "default_maximum_score" DECIMAL(8,2) NOT NULL DEFAULT 100,
  "default_passing_score" DECIMAL(8,2) NOT NULL DEFAULT 50, "default_written_duration_minutes" INTEGER NOT NULL DEFAULT 60,
  "max_audio_file_size_mb" INTEGER NOT NULL DEFAULT 25,
  "allowed_video_platforms" TEXT[] DEFAULT ARRAY['GOOGLE_MEET','ZOOM','MICROSOFT_TEAMS','JITSI']::TEXT[],
  "automatic_result_publication" BOOLEAN NOT NULL DEFAULT false, "show_evaluator_comment" BOOLEAN NOT NULL DEFAULT true,
  "attendance_late_minutes" INTEGER NOT NULL DEFAULT 15, "attendance_correction_enabled" BOOLEAN NOT NULL DEFAULT true,
  "attendance_correction_max_hours" INTEGER NOT NULL DEFAULT 48, "attendance_correction_reason_required" BOOLEAN NOT NULL DEFAULT true,
  "attendance_technical_issue_enabled" BOOLEAN NOT NULL DEFAULT true, "attendance_excused_enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id" INTEGER, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "center_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "center_settings_singleton" CHECK ("id" = 'MAIN'),
  CONSTRAINT "center_settings_currency" CHECK ("primary_currency" IN ('USD','CDF')),
  CONSTRAINT "center_settings_colors" CHECK ("primary_color" ~ '^#[0-9A-Fa-f]{6}$' AND "secondary_color" ~ '^#[0-9A-Fa-f]{6}$' AND "accent_color" ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT "center_settings_numbers" CHECK ("next_invoice_number" > 0 AND "next_receipt_number" > 0)
);
CREATE TABLE "center_level_settings" (
  "level" "AcademicLevel" NOT NULL, "display_name" TEXT NOT NULL, "description" TEXT, "indicative_weeks" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "display_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "center_level_settings_pkey" PRIMARY KEY ("level")
);
CREATE UNIQUE INDEX "center_level_settings_display_order_key" ON "center_level_settings"("display_order");
CREATE TABLE "private_setting_files" (
  "id" SERIAL NOT NULL, "category" TEXT NOT NULL, "storage_key" TEXT NOT NULL, "mime_type" TEXT NOT NULL,
  "extension" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "uploaded_by_id" INTEGER NOT NULL,
  "replaced_by_id" INTEGER, "deleted_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_setting_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "private_setting_files_storage_key_key" ON "private_setting_files"("storage_key");
CREATE INDEX "private_setting_files_category_deleted_at_idx" ON "private_setting_files"("category","deleted_at");
CREATE TABLE "center_settings_audits" (
  "id" SERIAL NOT NULL, "category" TEXT NOT NULL, "field" TEXT NOT NULL, "old_value" JSONB, "new_value" JSONB,
  "actor_id" INTEGER NOT NULL, "ip_address" TEXT, "user_agent" TEXT, "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "center_settings_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "center_settings_audits_category_created_at_idx" ON "center_settings_audits"("category","created_at");
CREATE INDEX "center_settings_audits_actor_id_created_at_idx" ON "center_settings_audits"("actor_id","created_at");
ALTER TABLE "center_settings" ADD CONSTRAINT "center_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "private_setting_files" ADD CONSTRAINT "private_setting_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_settings_audits" ADD CONSTRAINT "center_settings_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "center_level_settings" ("level","display_name","display_order","updated_at") VALUES
('LEVEL_1','Level 1',1,CURRENT_TIMESTAMP),('LEVEL_2','Level 2',2,CURRENT_TIMESTAMP),('LEVEL_3','Level 3',3,CURRENT_TIMESTAMP);
