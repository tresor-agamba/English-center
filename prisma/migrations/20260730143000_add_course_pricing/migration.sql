CREATE TYPE "CoursePricingMode" AS ENUM ('FREE', 'ONE_TIME', 'MONTHLY', 'INSTALLMENT');

ALTER TABLE "courses"
  ADD COLUMN "pricing_mode" "CoursePricingMode",
  ADD COLUMN "pricing_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "registration_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "max_installments" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pricing_starts_at" TIMESTAMP(3),
  ADD COLUMN "pricing_ends_at" TIMESTAMP(3);

UPDATE "courses"
SET "pricing_mode" = CASE
  WHEN "price" IS NULL THEN NULL
  WHEN "price" = 0 THEN 'FREE'::"CoursePricingMode"
  ELSE 'ONE_TIME'::"CoursePricingMode"
END;

ALTER TABLE "payments"
  ADD COLUMN "base_amount" DECIMAL(10,2),
  ADD COLUMN "registration_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pricing_mode" "CoursePricingMode",
  ADD COLUMN "course_id" INTEGER;

UPDATE "payments" AS p
SET
  "base_amount" = p."amount",
  "pricing_mode" = CASE WHEN p."amount" = 0 THEN 'FREE'::"CoursePricingMode" ELSE 'ONE_TIME'::"CoursePricingMode" END,
  "course_id" = ts."course_id"
FROM "enrollments" AS e
JOIN "training_sessions" AS ts ON ts."id" = e."training_session_id"
WHERE e."id" = p."enrollment_id";

ALTER TABLE "payments"
  ALTER COLUMN "base_amount" SET NOT NULL,
  ALTER COLUMN "pricing_mode" SET NOT NULL,
  ALTER COLUMN "course_id" SET NOT NULL;

CREATE INDEX "payments_course_id_idx" ON "payments"("course_id");
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
