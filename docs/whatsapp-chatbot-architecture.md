# Analyse technique préalable

Dashboard : Express 5, EJS et styles communs NVA. PostgreSQL avec Prisma 6.19.3.
Les routes /admin/whatsapp utilisent requireAdmin : session valide, utilisateur actif, rôle ADMIN et changement de mot de passe obligatoire. La protection CSRF globale précède les routes administratives.

Modèles existants : WhatsAppPreference, WhatsAppDelivery, WhatsAppConversation, WhatsAppConversationMessage, WhatsAppCommercialConsentEvent et WhatsAppProspectFollowUp. MetaWebhookEndpoint/Receipt/Event/ReceiptItem assurent réception durable, chiffrement, corrélation et déduplication.

Chaîne logique : webhook signé → Meta Inbox → dispatcher → adaptateur Prisma transactionnel → whatsappConversationService → whatsappConversationEngine. Le runtime de production est réception seule ; l'adaptateur est optionnel, sans branchement automatique au runtime.

Le moteur traite déjà STOP, consentement, transfert humain, pause/reprise et catalogue. publicCourseService et registrationService fournissent tarifs, sessions et horaires. L'administration dispose de l'historique, des filtres conseiller, de la pause/reprise et des réponses manuelles avec contrôles de consentement, fenêtre de service et idempotence.

L'extension réutilise ce moteur et ces conversations. Elle ajoute règles/FAQ et paramètres persistés, simulateur sans envoi et sélection de FAQ officielles par OpenAI. Aucun changement du webhook ni du runtime de production, aucun accès à NovanceTech. Migrations livrées sans exécution.
