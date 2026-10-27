# NVA V3 — rapport de livraison locale du 26 octobre 2026

> État actuel : voir le [rapport des corrections V3](nva-whatsapp-v3-corrections-report.md). Les blocages applicatifs ont été corrigés ; le GO opérationnel reste conditionné aux preuves de cible et d’exploitation.

> Conclusion remplacée par la [validation finale V3](nva-whatsapp-v3-final-validation.md) : NO-GO pilote en l’état. Cette validation reproduit un défaut d’ACL du worker, des affirmations non fondées acceptées et un choix de langue incomplet. Un nom PM2 déclaré localement n’atteste pas le nom effectif sur Contabo.

## Périmètre et audit initial

Travail exclusivement dans `D:\English-center`. Aucun accès Contabo, déploiement, migration SQL, changement du `.env` réel ou activation des envois. NovanceTech n’a pas été modifié. Aucun appel réel OpenAI ou Meta dans les tests.

L’application existante utilise Express/CommonJS, Prisma/PostgreSQL et des vues EJS. Le webhook passe par `whatsappWebhookRoutes` et `whatsappWebhookController`. La réception historique et l’inbox Meta durable convergent vers `whatsappConversationService` et `whatsappConversationEngine`. L’inbox ajoute les événements persistants, la vérification du compte, le traitement transactionnel et une barrière contre les STOP non encore appliqués.

Avant cette évolution :

- `whatsappQuestionAIService` utilisait déjà Responses, mais uniquement pour sélectionner trois identifiants de faits ; aucun texte conversationnel généré n’était envoyé.
- `whatsappQuestionAICompletionService` réservait un appel après commit, limitait l’historique à six messages et revalidait le contexte avant publication.
- `whatsappChatbotOpenAIService` sélectionnait une FAQ approuvée hors du mode question. Ce service est conservé.
- L’entrée « Poser une question » persistait `QUESTION_AI`. Les commandes de menu, d’inscription, STOP et conseiller avaient priorité.
- `whatsappAdmissionJourney` proposait site ou WhatsApp ; `whatsappAdmissionService` conservait les validations e-mail et administratives.
- Le consentement marketing était déjà un événement séparé avec date, source, preuve et version de notice. Les relances existantes étaient à 24 h et 72 h après consentement, en français.
- Les conversations, événements de consentement et relances avaient déjà des tables, des clés uniques et des états de livraison. L’administration était déjà protégée par les autorisations ADMIN existantes.
- `publicCourseService.listPublished` sélectionne les formations publiées non archivées, leurs tarifs actifs, frais de certificat et structure. `registrationService.listSessionsForPublicRegistration` fournit les sessions et groupes ouverts ; ces composants sont réutilisés.
- Les suites isolées existantes couvrent moteur, réception, sécurité, admissions, reprises, livraison et concurrence simulée.

## Fonctionnalités livrées

### Conseiller commercial

Les instructions maintenables dans `whatsappAdvisorPolicy` demandent une conversation courte, chaleureuse et adaptée aux objectifs, au niveau, au budget et aux horaires du prospect, généralement avec une seule question. Elles interdisent la pression, les promesses inventées et toute validation administrative.

La réponse structurée contient `language`, `factIds` et `reply`. Le texte peut désormais être conversationnel. Les faits viennent du catalogue et des sessions NVA ; les identifiants inconnus sont rejetés. Un contrôle local refuse les liens, coordonnées, nombres sans support dans les faits sélectionnés et certaines affirmations de confirmation ou de garantie. Les frais de certificat présents en base priment sur le barème commercial de référence. Le mode en ligne n’est affirmé que s’il est publié pour les formations considérées. Les conditions d’anglais général ne sont produites que pour la structure correspondante.

La langue FR/EN est conservée dans `engineState.preferredLanguage`, y compris pour les réponses courtes. Les formulations explicites permettent de changer de langue. Les replis utilisent aussi cette préférence. L’historique reste limité aux six derniers messages textuels du même mode et de la même conversation, hors messages d’un administrateur.

Les protections existantes sont conservées : `store:false`, aucun outil, aucun droit d’écriture pour le modèle, timeout, réservation atomique du budget quotidien avant chaque tentative, absence de retry API automatique, repli et annulation d’une réponse devenue obsolète. Le plafond du timeout accepte maintenant 10 000 ms.

Les noms déclarés par les formulations prises en charge, adresses e-mail, téléphones, liens et secrets reconnaissables sont masqués avant l’envoi à OpenAI. L’identifiant WhatsApp n’est pas inclus dans la requête. La détection de données personnelles par expressions régulières reste imparfaite ; les utilisateurs sont invités à ne pas partager leurs coordonnées dans ce mode.

Les intentions d’inscription quittent l’IA et passent au workflow existant. Les trois menus restent présents. Aucun paiement ni inscription n’est confirmé par le modèle.

### Consentement et suivi

Dans « Poser une question », écrire `relances` ou `follow ups` affiche une notice explicite. Répondre `OUI RELANCES` ou `YES FOLLOW UPS` l’accepte. Une acceptation non sollicitée ou issue d’une ancienne notice ne vaut pas nouveau consentement. La notice V3 est `lead-follow-up-48h-v3`. Le simple contact ne vaut jamais consentement.

STOP, unsubscribe et plusieurs formulations naturelles d’arrêt en français/anglais passent avant l’IA, enregistrent le retrait et bloquent l’automatisation. Le retrait utilise les mécanismes existants de préférence et d’annulation. Les anciennes notices 24/72 h ne sont pas réutilisées pour autoriser le nouveau parcours.

L’intérêt est conservé via les champs existants `selectedCourseId` et `selectedCourseSlug`. La langue, le dernier entrant, le statut d’inscription, les preuves de consentement et la livraison réutilisent les structures existantes, sans nouveau profil contenant nom, e-mail ou téléphone dupliqué.

### Relance à 48 heures

Une seule relance V3 est créée par conversation, avec clé unique `wa-prospect-follow-up:v3:<conversationId>:48h`. Ce choix est volontairement conservateur : aucun réarmement automatique après un envoi ou une annulation terminale.

Chaque nouveau message reporte l’échéance d’une relance encore en attente et sans tentative à sa réception locale + 48 h. Juste avant l’envoi, le dernier entrant est relu et l’inactivité est recalculée. La fenêtre de service des réponses ordinaires reste gérée par le service existant à partir de l’horodatage fournisseur ; la relance emploie toujours un template, jamais du texte libre OpenAI.

Conditions vérifiées : intérêt enregistré, état BOT_ACTIVE, absence de STOP/pause, preuve de consentement V3 actuelle et identique à celle de la relance, absence d’inscription et de demande PENDING/PROCESSING/ENROLLED, délai atteint et activité de moins de 90 jours. Les inscriptions sont cherchées par numéro et, lorsque disponible, par compte lié.

Avant tout envoi réel, une lecture de `/<WABA_ID>/message_templates` vérifie nom, ID configuré, langue, catégorie MARKETING et statut APPROVED. La vérification exige un corps statique sans variable ni autre composant. Une erreur ou un statut non confirmé bloque l’envoi. Aucun template n’a été déclaré approuvé sur la base des tests simulés.

Le claim atomique, la clé unique et le marqueur durable de soumission existants empêchent les soumissions concurrentes. La dernière autorisation est relue sous verrou PostgreSQL du destinataire. Dans le worker Meta, la relance vérifie aussi le compte, le dernier événement entrant traité, la date minimale d’activation et la barrière des événements en attente. Le sender historique reste bloqué lorsqu’une inbox active exige sa barrière dédiée.

Un résultat réseau ambigu ou une soumission abandonnée devient terminal/incertain, sans renvoi aveugle. Seul un refus clairement confirmé comme retryable, tel qu’un 429, permet une reprise. Cela privilégie l’absence de doublons, avec risque assumé de relance non livrée après un crash. La clé de corrélation Meta n’est pas une garantie d’idempotence du fournisseur.

### Administration et conservation

La fiche administrative existante affiche maintenant langue, formation d’intérêt et demande d’inscription en attente, en complément des consentements, dernière activité et états de relance déjà visibles. Les contrôles d’autorisation et CSRF existants sont conservés.

Politique proposée : après 90 jours sans activité, purger le contenu conversationnel et la mémoire commerciale des prospects sans compte, sans dossier d’admission et sans conseiller affecté. Le service de maintenance annule les relances non engagées et conserve l’état d’opposition. Il traite 100 conversations au maximum par exécution, sous les mêmes verrous de destinataire. Il n’est pas planifié automatiquement.

```sh
npm run whatsapp:prospects:cleanup             # aperçu, aucune écriture
npm run whatsapp:prospects:cleanup -- --apply  # purge explicite sur la base choisie
```

La purge ne supprime pas les dossiers pédagogiques, admissions, preuves de consentement, identifiants de livraison ou la clé de téléphone nécessaire au respect d’un STOP. Revue annuelle des preuves et métadonnées : supprimer les références devenues inutiles selon la politique NVA, les obligations applicables et les liens de conservation. Une demande d’effacement complète nécessite une revue administrative des relations Prisma/Meta et des sauvegardes ; ce script ne prétend pas effectuer cet effacement. Les sauvegardes doivent appliquer la politique de conservation NVA et les oppositions doivent être réappliquées après restauration.

## Fichiers modifiés ou ajoutés

| Fichier | Rôle |
| --- | --- |
| `src/services/whatsappAdvisorPolicy.js` | Instructions, langue et contrôles de sortie |
| `src/services/whatsappQuestionAIService.js` | Réponse conversationnelle Responses et faits commerciaux |
| `src/services/whatsappQuestionAICompletionService.js` | Préférence de langue et repli |
| `src/services/whatsappConversationEngine.js` | Langue, intérêt, consentement et arrêt |
| `src/services/whatsappAdmissionJourney.js` | Accès à la notice facultative de relance |
| `src/services/whatsappConversationService.js` | Planification et report de l’échéance |
| `src/services/whatsappFollowUp48Policy.js` | Éligibilité et vérification Meta |
| `src/services/whatsappProspectFollowUpService.js` | Relance V3, simulation, claim et reprise |
| `src/services/whatsappSubmissionCoordinator.js` | Revalidation sous verrou avant soumission |
| `src/services/metaInboxWorkerService.js` | Relance dans le worker Meta avec barrière du compte |
| `src/services/whatsappProspectRetentionService.js` | Purge de contenu après inactivité |
| `src/services/whatsappConversationAdminService.js` | Statut d’admission pour la fiche |
| `src/config/whatsappConfig.js` | Paramètres V3 sûrs par défaut |
| `views/admin/whatsapp/conversation.ejs` | Suivi commercial administratif |
| `scripts/cleanupWhatsAppProspects.js` | Maintenance explicite, simulation par défaut |
| `tests/whatsappAdvisorV3.test.js` | Tests V3 isolés |
| `tests/metaInboxWorker.test.js` | Parcours Meta V3 et report après nouvel entrant |
| `tests/whatsappConversationEngine.test.js` | Attente adaptée à la nouvelle notice |
| `package.json`, `.env.example` | Commandes et configuration documentée |
| `docs/nva-whatsapp-v3-delivery-report.md` | Ce rapport |

## Prisma

Aucune migration Prisma nouvelle nécessaire : langue, intérêt et version de notice tiennent dans le JSON `engineState` existant ; les autres données et contraintes sont déjà présentes. Aucun changement de `schema.prisma`, aucune migration exécutée, aucune base modifiée pendant les vérifications. Les migrations historiques du projet doivent déjà être appliquées dans l’environnement de destination ; ne pas les appliquer en bloc sans examiner leur statut.

## Configuration

| Variable | Valeur par défaut / usage |
| --- | --- |
| `NVA_AI_ENABLED` | `false`, activation manuelle du mode IA |
| `OPENAI_API_KEY` | Secret existant, jamais journalisé |
| `OPENAI_MODEL` | Modèle configurable compatible Responses et sorties structurées |
| `NVA_AI_TIMEOUT_MS` | `4000`, entier entre 250 et 10000 |
| `NVA_AI_MAX_OUTPUT_TOKENS` | `256`, entre 64 et 1024 ; augmenter si réponses incomplètes |
| `NVA_AI_DAILY_CALL_LIMIT` | `50`, entre 1 et 1000 ; quota partagé existant |
| `NVA_FOLLOWUPS_ENABLED` | `false`, activation distincte des relances |
| `NVA_FOLLOWUPS_DRY_RUN` | `true`, aucun claim ni appel Meta ; seul `false` explicite permet l’envoi |
| `NVA_FOLLOWUP_FR_TEMPLATE` | `nva_followup_fr` |
| `NVA_FOLLOWUP_EN_TEMPLATE` | `nva_followup_en` |
| `NVA_FOLLOWUP_FR_TEMPLATE_ID` | Vide, ID Meta réellement approuvé à renseigner |
| `NVA_FOLLOWUP_EN_TEMPLATE_ID` | Vide, ID Meta réellement approuvé à renseigner |

Le token Meta doit autoriser la lecture des templates de la WABA et l’envoi. Les paramètres existants de compte, version Graph et workers restent nécessaires. Le mode Meta conserve ses flags distincts de réception, traitement et envoi ; ne pas activer simultanément le sender historique. Les anciens noms de templates 24/72 h ne sont pas utilisés par la configuration applicative V3. La compatibilité du service avec l’ancien format de configuration injecté est conservée pour les tests et intégrations existantes.

## Templates à créer manuellement dans Meta

Créer deux templates MARKETING avec un seul composant BODY statique, sans variable, bouton, header ou footer. Les noms et IDs restent configurables. La langue doit correspondre exactement à `fr` ou `en`, utilisée par cette version.

**`nva_followup_fr` / `fr` — proposition à soumettre :**

> Bonjour ! Vous aviez demandé des informations sur les formations New Vision Academy. Souhaitez-vous poursuivre votre projet ou poser une question ? Nous sommes à votre écoute. Pour ne plus recevoir de messages commerciaux, répondez STOP.

**`nva_followup_en` / `en` — proposition à soumettre :**

> Hello! You asked about New Vision Academy courses. Would you like to continue discussing your learning plans or ask a question? We are here to help. To stop receiving marketing messages, reply STOP.

Ces propositions ne sont pas approuvées. Attendre l’approbation réelle, renseigner les IDs correspondants et vérifier les permissions du token. Une suspension/reclassification détectée au moment de l’envoi bloque la relance.

## Vérifications et limites de validation

Les suites sont lancées avec `whatsappIsolationGuard.cjs`, qui interdit le pilote PostgreSQL réel, l’instanciation d’un client Prisma applicatif et les appels réseau non simulés. Résultats détaillés dans `output/whatsapp-v3-tests.txt` et `output/whatsapp-v3-release-tests.txt`.

Résultats finaux : **73/73** tests V3/OpenAI/worker et **415/415** tests de non-régression réussis, aucun échec ni test ignoré. Ces suites se recoupent ; leurs nombres ne s’additionnent pas comme tests uniques. **164 vues EJS compilées** et **schéma Prisma valide**.

Commandes de validation :

```sh
npm run test:whatsapp:v3
npm run test:whatsapp:release
node scripts/validateEjs.js
node node_modules/prisma/build/index.js validate --schema prisma/schema.prisma
```

Couverture : conversations FR/EN, questions de besoin, consignes commerciales sans pression, conditions NVA, frais publiés prioritaires, tarifs inventés rejetés, injections, erreurs/timeout/quota OpenAI, contexte périmé, inscription sécurisée, menus, consentement et retrait, refus d’une ancienne notice, seuil de 48 h, report après nouveau message, absence d’envoi avant échéance, inscrits/dossiers en cours, doublons, deux workers, templates Meta et conservation.

Les tests de concurrence utilisent le contrat simulé et le véritable code de coordination ; ils ne démontrent pas les verrous et permissions d’un serveur PostgreSQL réel. Les validations réelles PostgreSQL sur une base locale dédiée, le rendu visuel de l’interface, la qualité commerciale sur un corpus FR/EN et la compatibilité du modèle OpenAI choisi restent à qualifier avant production. Aucune qualité persuasive mesurée ni approbation Meta réelle n’est revendiquée. Les contrôles locaux ne prouvent pas l’exactitude sémantique de tout texte libre généré : conserver un pilote surveillé et une revue d’exemples.

## Commandes de déploiement proposées — non exécutées

Préparer une release NVA et une sauvegarde vérifiée, puis examiner l’état des migrations sur l’environnement autorisé. Garder `NVA_FOLLOWUPS_ENABLED=false`, `NVA_FOLLOWUPS_DRY_RUN=true` et les flags d’envoi existants désactivés pendant la qualification.

```sh
# Dans le répertoire de la release NVA uniquement :
npm ci
npm run prisma:generate
npx prisma migrate status
# V3 n’ajoute aucune migration. Traiter séparément toute migration historique en attente.
npm run test:whatsapp:v3
npm run test:whatsapp:release
node scripts/validateEjs.js
# Après autorisation et qualification : redémarrer seulement le processus NVA existant.
# Nom PM2 effectif non vérifié : ne pas déduire ce nom du fichier ecosystem.
# Utiliser une inspection autorisée et nva_check_context avant toute commande ciblée.
```

Le worker Meta utilise le point d’entrée existant `npm run whatsapp:meta-inbox`. Garder sa configuration d’identité SQL, de compte, de date minimale et ses autorisations existantes. La relance est désormais traitée dans ce worker lorsqu’elle est explicitement activée ; aucun nouveau processus concurrent n’est requis. Ne pas lancer `whatsapp:process` en parallèle du worker Meta.

Avant activation réelle : valider la base locale dédiée, les droits SQL existants, le modèle OpenAI et les deux templates approuvés ; examiner la simulation, vérifier STOP et les demandes en cours, puis autoriser séparément les envois et les relances. Pour arrêter les relances : remettre `NVA_FOLLOWUPS_ENABLED=false`. Aucun de ces changements n’a été effectué sur un serveur pendant cette mission.

## Références officielles consultées

- [OpenAI Docs — sorties structurées dans Responses](https://developers.openai.com/api/docs/guides/structured-outputs).
- [Meta — gestion et approbation des templates WhatsApp](https://whatsappbusiness.com/blog/manage-message-templates-whatsapp-business-api/). L’exemple historique de version Graph n’est pas repris : le code conserve la version configurée par le projet.
