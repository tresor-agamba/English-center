ALTER TABLE "enrollments"
  ADD COLUMN "expected_total_amount" DECIMAL(10,2),
  ADD COLUMN "expected_currency" TEXT,
  ADD COLUMN "first_half_reached_at" TIMESTAMP(3),
  ADD COLUMN "fully_paid_at" TIMESTAMP(3),
  ADD COLUMN "access_blocked_at" TIMESTAMP(3),
  ADD COLUMN "access_unlocked_at" TIMESTAMP(3);

UPDATE "courses"
SET "pricing_mode" = 'ONE_TIME'::"CoursePricingMode"
WHERE "pricing_mode" = 'FREE'::"CoursePricingMode";

UPDATE "enrollments" AS e
SET
  "expected_total_amount" = (
    SELECT p."base_amount" + p."registration_fee"
    FROM "payments" AS p
    WHERE p."enrollment_id" = e."id"
    ORDER BY p."created_at" ASC, p."id" ASC
    LIMIT 1
  ),
  "expected_currency" = (
    SELECT p."currency"
    FROM "payments" AS p
    WHERE p."enrollment_id" = e."id"
    ORDER BY p."created_at" ASC, p."id" ASC
    LIMIT 1
  )
WHERE EXISTS (SELECT 1 FROM "payments" AS p WHERE p."enrollment_id" = e."id");

UPDATE "enrollments" AS e
SET
  "expected_total_amount" = c."price" + c."registration_fee",
  "expected_currency" = c."currency"
FROM "training_sessions" AS ts
JOIN "courses" AS c ON c."id" = ts."course_id"
WHERE e."training_session_id" = ts."id"
  AND e."expected_total_amount" IS NULL
  AND c."price" IS NOT NULL;
