-- Legacy rows remain intact and unlinked; application code rejects them.
-- Unknown historical credential versions must not authorize recovery.
ALTER TABLE "password_reset_requests" ADD COLUMN "auth_version_at_request" INTEGER;
ALTER TABLE "password_reset_tokens" ADD COLUMN "request_id" INTEGER;
CREATE UNIQUE INDEX "password_reset_tokens_request_id_key" ON "password_reset_tokens"("request_id");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "password_reset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
