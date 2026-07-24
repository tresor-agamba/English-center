-- AlterTable
ALTER TABLE "courses"
ADD COLUMN "slug" TEXT,
ADD COLUMN "short_description" TEXT,
ADD COLUMN "level" TEXT,
ADD COLUMN "duration" TEXT,
ADD COLUMN "objectives" TEXT,
ADD COLUMN "target_audience" TEXT,
ADD COLUMN "prerequisites" TEXT,
ADD COLUMN "price" DECIMAL(10,2),
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "training_mode" TEXT;

-- Existing courses receive a stable, collision-free fallback slug.
UPDATE "courses"
SET "slug" = 'formation-' || "id"
WHERE "slug" IS NULL;

ALTER TABLE "courses" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");
