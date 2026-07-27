ALTER TABLE "certificate_settings"
  ADD COLUMN "center_name" TEXT NOT NULL DEFAULT 'English Center',
  ADD COLUMN "logo_path" TEXT,
  ADD COLUMN "primary_color" TEXT NOT NULL DEFAULT '#173B57',
  ADD COLUMN "signer_name" TEXT NOT NULL DEFAULT 'Direction English Center',
  ADD COLUMN "signer_title" TEXT NOT NULL DEFAULT 'Direction',
  ADD COLUMN "certificate_title" TEXT NOT NULL DEFAULT 'CERTIFICAT DE FIN DE FORMATION',
  ADD COLUMN "certificate_text" TEXT NOT NULL DEFAULT 'a suivi avec succès la formation',
  ADD COLUMN "footer_text" TEXT NOT NULL DEFAULT 'English Center - Excellence in English';

ALTER TABLE "certificates"
  ADD COLUMN "verification_code" TEXT,
  ADD COLUMN "student_name_snapshot" TEXT,
  ADD COLUMN "course_name_snapshot" TEXT,
  ADD COLUMN "session_name_snapshot" TEXT,
  ADD COLUMN "center_name_snapshot" TEXT,
  ADD COLUMN "signer_name_snapshot" TEXT,
  ADD COLUMN "signer_title_snapshot" TEXT,
  ADD COLUMN "certificate_title_snapshot" TEXT,
  ADD COLUMN "certificate_text_snapshot" TEXT,
  ADD COLUMN "footer_text_snapshot" TEXT,
  ADD COLUMN "primary_color_snapshot" TEXT,
  ADD COLUMN "logo_path_snapshot" TEXT;

UPDATE "certificates" c SET
  "verification_code" = encode(sha256((c."id"::text || c."serial_number" || clock_timestamp()::text || random()::text)::bytea), 'hex'),
  "student_name_snapshot" = u."first_name" || ' ' || u."last_name",
  "course_name_snapshot" = co."title",
  "session_name_snapshot" = ts."name",
  "center_name_snapshot" = cs."center_name",
  "signer_name_snapshot" = cs."signer_name",
  "signer_title_snapshot" = cs."signer_title",
  "certificate_title_snapshot" = cs."certificate_title",
  "certificate_text_snapshot" = cs."certificate_text",
  "footer_text_snapshot" = cs."footer_text",
  "primary_color_snapshot" = cs."primary_color",
  "logo_path_snapshot" = cs."logo_path"
FROM "certificate_requests" cr
JOIN "enrollments" e ON e."id" = cr."enrollment_id"
JOIN "users" u ON u."id" = e."user_id"
JOIN "training_sessions" ts ON ts."id" = e."training_session_id"
JOIN "courses" co ON co."id" = ts."course_id"
CROSS JOIN "certificate_settings" cs
WHERE c."certificate_request_id" = cr."id";

ALTER TABLE "certificates"
  ALTER COLUMN "verification_code" SET NOT NULL,
  ALTER COLUMN "student_name_snapshot" SET NOT NULL,
  ALTER COLUMN "course_name_snapshot" SET NOT NULL,
  ALTER COLUMN "session_name_snapshot" SET NOT NULL,
  ALTER COLUMN "center_name_snapshot" SET NOT NULL,
  ALTER COLUMN "signer_name_snapshot" SET NOT NULL,
  ALTER COLUMN "signer_title_snapshot" SET NOT NULL,
  ALTER COLUMN "certificate_title_snapshot" SET NOT NULL,
  ALTER COLUMN "certificate_text_snapshot" SET NOT NULL,
  ALTER COLUMN "footer_text_snapshot" SET NOT NULL,
  ALTER COLUMN "primary_color_snapshot" SET NOT NULL;
CREATE UNIQUE INDEX "certificates_verification_code_key" ON "certificates"("verification_code");
