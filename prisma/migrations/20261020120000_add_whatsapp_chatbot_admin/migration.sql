CREATE TABLE "WhatsAppChatbotRule" (
 "id" SERIAL PRIMARY KEY, "kind" VARCHAR(16) NOT NULL DEFAULT 'MESSAGE',
 "title" VARCHAR(120) NOT NULL, "triggers" JSONB NOT NULL, "body" VARCHAR(3000) NOT NULL,
 "priority" INTEGER NOT NULL DEFAULT 0, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "chatbot_rule_kind" CHECK ("kind" IN ('MESSAGE','FAQ')),
 CONSTRAINT "chatbot_rule_priority" CHECK ("priority" BETWEEN 0 AND 1000)
);
CREATE INDEX "WhatsAppChatbotRule_kind_enabled_priority_idx" ON "WhatsAppChatbotRule"("kind", "enabled", "priority");
CREATE TABLE "WhatsAppChatbotSettings" ("id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id"=1), "enabled" BOOLEAN NOT NULL DEFAULT true, "aiEnabled" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "WhatsAppChatbotAiBudget" ("day" VARCHAR(10) PRIMARY KEY, "calls" INTEGER NOT NULL DEFAULT 0 CHECK ("calls">=0));

-- Text templates only; catalogue requests remain in the existing engine.
INSERT INTO "WhatsAppChatbotRule" ("kind","title","triggers","body","priority","enabled","updatedAt") VALUES
('MESSAGE','Bienvenue','["bonjour","bonsoir","salut"]','Bienvenue à New Vision Academy ! Découvrez nos formations ou demandez un conseiller.',10,false,CURRENT_TIMESTAMP),
('MESSAGE','Menu principal','["menu","accueil"]','Menu NVA : formations, tarifs, horaires, essai, inscription, conseiller.',10,false,CURRENT_TIMESTAMP),
('FAQ','Présentation de NVA','["qui êtes vous","présentation nva"]','New Vision Academy est un centre de formation en anglais. Écrivez formations pour consulter le catalogue officiel.',10,false,CURRENT_TIMESTAMP);
