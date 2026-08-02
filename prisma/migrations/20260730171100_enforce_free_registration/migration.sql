UPDATE "courses"
SET "registration_fee" = 0
WHERE "registration_fee" <> 0;

UPDATE "enrollments" AS e
SET "expected_total_amount" = (
  SELECT p."base_amount"
  FROM "payments" AS p
  WHERE p."enrollment_id" = e."id"
  ORDER BY p."created_at" ASC, p."id" ASC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "payments" AS p WHERE p."enrollment_id" = e."id");

UPDATE "enrollments" AS e
SET "expected_total_amount" = c."price"
FROM "training_sessions" AS ts
JOIN "courses" AS c ON c."id" = ts."course_id"
WHERE e."training_session_id" = ts."id"
  AND NOT EXISTS (SELECT 1 FROM "payments" AS p WHERE p."enrollment_id" = e."id")
  AND c."price" IS NOT NULL;
