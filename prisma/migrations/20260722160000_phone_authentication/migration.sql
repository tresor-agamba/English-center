-- DropIndex
DROP INDEX "users_email_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "email",
DROP COLUMN "password",
DROP COLUMN "phone",
ADD COLUMN "password_hash" TEXT NOT NULL,
ADD COLUMN "phone_number" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");
