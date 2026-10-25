# Audit préalable NVA WhatsApp V2 — 23 octobre 2026

Audit du code local avant modification. Aucun accès à Contabo, PostgreSQL réel, Meta, PM2 ou aux secrets. Le dépôt contient déjà de nombreux travaux WhatsApp ; les rapports historiques ne constituent pas une preuve de l’état de production.

## Architecture constatée

| Besoin | Composants existants réutilisables |
| --- | --- |
| Webhook Meta | `src/routes/whatsappWebhookRoutes.js`, `metaInboxWebhookController.js` : vérification du challenge, réception brute et contrôle de signature |
| Traitement | `src/jobs/processMetaInbox.js`, `metaInboxWorkerService.js`, `metaInboxDispatcher.js`, `metaInboxRuntime.js` : inbox durable, cible contrôlée, traitement transactionnel |
| Livraison | `whatsappCloudApiService.js`, `whatsappDeliveryService.js`, `whatsappConversationDeliveryService.js`, politique et fenêtre de service |
| Réponses automatiques | `whatsappConversationService.js` compose admissions, scénarios, règles configurées et moteur |
| Intentions | `whatsappConversationEngine.js` : normalisation, intentions historiques, contexte et sélection de formation ; questions multiples classées AMBIGUOUS |
| Accueil | `menu()` dans `whatsappAdmissionJourney.js` ; GREETING et MENU partagent déjà ce constructeur à la suite d’une correction locale antérieure |
| Inscription | `registrationService.js` : validations métier, disponibilité, capacité, comptes et transaction d’inscription |
| Demande préalable | `whatsappAdmissionService.js` : demande consentie PENDING, historique, notification interne, validation administrative |
| Transfert | `whatsappHumanHandoffService.js`, état HUMAN_TAKEOVER et interfaces administratives ; pause de l’automatisation |

La route webhook et les workers historiques coexistent dans les sources ; cela ne prouve pas leur activation simultanée. Le runtime contient des gardes de coexistence. Aucun processus réel n’a été inspecté ou réactivé.

## Modèles présents

- Prospects et contexte : `WhatsAppConversation`, `WhatsAppConversationMessage`, `WhatsAppPreference`, consentements et suivis commerciaux.
- Demandes : `WhatsAppAdmissionRequest`, `WhatsAppAdmissionEvent`. Une demande n’est pas une inscription.
- Étudiants : `User` avec rôle STUDENT ; rattachement des inscriptions aux comptes existants.
- Catalogue : `Course`, structure de niveaux et contenu ; `TrainingSession` et groupes/créneaux associés.
- Inscriptions : `Enrollment` et politiques de places/statuts.
- Facturation/paiements : `StudentInvoice`, `StudentInvoiceLine`, `StudentPayment`, `PaymentReceipt`, `Payment`.
- Certification : `CertificateSettings`, `CertificateRequest`, `CertificatePayment`, `Certificate`.
- Configuration du bot : `WhatsAppChatbotSettings`, `WhatsAppChatbotRule`, `WhatsAppScenario`.

## Écarts identifiés avant intervention

1. L’accueil local unifié utilisait cinq options sous forme de liste, un texte différent de la mission et du contenu personnalisable. Le précédent conflit Bonjour/Menu est décrit dans `whatsapp-welcome-conflict-20261023.md`. Les anciennes règles enregistrées et automatismes Meta réels n’ont pas été consultés.
2. Le moteur historique ne distinguait pas durée, paiement, certificat, début de session et horaires. « Combien » déclenchait souvent PRICE ; plusieurs questions déclenchaient une demande de clarification.
3. L’inscription passait par une invitation OUI/NON puis « En ligne / Par l’admin ». Les expressions « la deuxième » et « je préfère WhatsApp » n’étaient pas prises en charge par ce parcours.
4. La demande collectait identité et niveau, mais aucun choix de formation/session/créneau.
5. Un repli IA existait déjà dans le dépôt. Il ne doit pas être employé par le parcours V2 activé.
6. La communication du minimum de paiement évoquait la dixième séance. La mission exige une explication du solde avant la fin des seize séances sans inventer une autre échéance.

## Modifications et risques retenus

Compléter les admissions existantes et ajouter un module déterministe d’intentions/réponses, sans second webhook ou transport. Conserver les transactions, contrôles de compte, de session, les identifiants dédupliqués, les pauses humaines et la politique de livraison. Stocker la préférence validée dans les métadonnées des événements d’admission existants.

Risques : attentes des tests et boutons de menus anciens ; changement de la communication personnalisée ; divergence entre règles commerciales officielles et catalogue réel ; modification de disponibilité pendant la collecte ; perte d’un brouillon sur changement de méthode ; faux positifs de reconnaissance ; troncature des messages interactifs. Les tests, contrôles de disponibilité répétés et repli texte limitent ces risques. Les politiques effectives de paiement, de certification et de création de compte ne doivent pas être modifiées pour faire correspondre une phrase commerciale.

La compatibilité du schéma Contabo reste à établir selon `audit-final-compatibilite-nva-20261023.md`. Cet audit local n’autorise aucun déploiement ni migration.
