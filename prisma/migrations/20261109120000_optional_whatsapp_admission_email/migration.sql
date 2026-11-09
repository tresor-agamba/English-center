-- Only WhatsApp admission requests: public registration and account rules are unchanged.
ALTER TABLE "WhatsAppAdmissionRequest" ALTER COLUMN "email" DROP NOT NULL;
