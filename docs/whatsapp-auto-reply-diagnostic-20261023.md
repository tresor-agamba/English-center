# Diagnostic et correction locale des réponses WhatsApp NVA — 23 octobre 2026

> Suite de validation : [validation SQL et PostgreSQL du worker](whatsapp-worker-sql-validation-20261023.md). Elle remplace les limites de validation locale ci-dessous : droits réduits testés sur PostgreSQL réel, correction des comparaisons UTC, 41 contrôles SQL et 399 tests locaux réussis. Les vérifications Contabo restent bloquantes ; aucune autorisation de production n'en découle.

## Conclusion

**Correction locale réalisée ; NON PRÊT POUR LE DÉPLOIEMENT sans validation des prérequis ci-dessous.** Aucun accès Contabo, changement de production, migration, envoi WhatsApp réel ou push GitHub effectué. Les observations sur la configuration du serveur proviennent des informations de l'opérateur ; les processus réellement présents sur Contabo n'ont pas été inspectés.

Le HTTP 200 du webhook confirme la réception durable, pas l'exécution du chatbot ni l'envoi d'une réponse. Changer seulement `processing_enabled` ne résout pas les raccordements manquants.

## Causes confirmées dans le code et la configuration communiquée

| Cause | Emplacement | Conséquence |
|---|---|---|
| Route raccordée à la réception durable uniquement | `src/routes/whatsappWebhookRoutes.js:12`, `src/services/metaInboxRuntime.js:60` | Aucun appel du moteur dans la requête HTTP, intentionnellement. |
| Aucun ordonnanceur Meta raccordé avant cette correction | `src/server.js:20`, `src/jobs/whatsappWorkerControl.js:11` | Le démarrage existant lance uniquement le poller historique de livraison ; aucun consommateur des événements Meta `READY`. Le dispatcher et l'adaptateur existaient sans composition de démarrage. |
| `processing_enabled=false` communiqué pour l'endpoint | `src/repositories/metaInboxRepository.js:124`, `:163` | `claim()` et `process()` refusent le traitement. Les événements peuvent rester `READY`. |
| Anciens drapeaux WhatsApp à `false` | `src/jobs/whatsappWorkerControl.js:11` | Les anciennes files sortantes ne sont pas consommées. |
| Coexistence avec les anciens workers volontairement interdite | `src/services/metaInboxRuntime.js:11` | Les passer à `true` en production avec Meta Inbox déclenche `META_INBOX_OUTBOUND_MUST_BE_DISABLED`. Cette restriction est conservée. |
| Barrière Meta nécessaire avant soumission | `src/services/whatsappSubmissionCoordinator.js`, fonction `engageSubmission` | Le chemin historique sans barrière explicite refuse les soumissions lorsque l'inbox est active. |
| Rôle ingress volontairement limité | `docs/sql/meta-inbox-production-ingress-role.sql` | Il ne peut ni réclamer les événements ni écrire les conversations métier. Ne pas lui donner les permissions du worker. |

## Corrections et chemin d'exécution

Nouveau processus autonome `src/jobs/processMetaInbox.js`, commande `npm run whatsapp:meta-inbox`. **Il n'est pas démarré par le serveur HTTP**, ni ajouté automatiquement à PM2.

`src/services/metaInboxWorkerService.js:24` compose le dépôt Meta, `claim()` / `process()`, le dispatcher existant, `metaInboxPrismaAdapter` et le moteur de conversation existant. L'événement, le message entrant, l'état de conversation, les actions et la réponse `QUEUED` sont traités dans la même transaction. Les boutons et listes conservent leurs identifiants stables. Les demandes d'admission utilisent le service existant ; le worker ne crée pas directement de comptes ou d'inscriptions.

La phase d'envoi (`:68`) réutilise `whatsappConversationDeliveryService` et `whatsappCloudApiService.sendConversationMessage`, avec une configuration explicite propre au worker. Les variables historiques restent à `false`. Ce processus autorisé séparément ne transforme pas le runtime HTTP en expéditeur. La barrière `repository.canSubmitIn` est raccordée à la transaction de soumission (`:97`). STOP, désinscription, fenêtre client, contrôle conseiller et annulation restent appliqués.

Seules les réponses automatiques `wa-reply:<wamid>:0` et accusés de transfert `wa-handoff:<wamid>:0` liés à un événement entrant `PROCESSED/APPLIED` du même endpoint sont sélectionnés. Vérification supplémentaire du flux cryptographique et du destinataire. Les envois manuels, notifications, relances commerciales et messages d'autres endpoints restent exclus. Le seuil UTC obligatoire exclut les événements et réponses historiques de l'envoi. Le mode traitement seul peut néanmoins créer des réponses historiques en base : vérifier les volumes et conserver un seuil d'envoi fixé avant de l'activer.

Les baux expirés sont repris. Les erreurs métier provoquent rollback puis attente et nouvelles tentatives bornées. Les erreurs de sérialisation Prisma `P2010/40001` et deadlock `40P01` sont désormais reconnues par le dépôt (`src/repositories/metaInboxRepository.js:39`). Les erreurs de droits ne sont pas requalifiées en erreurs transitoires. Une indisponibilité après démarrage entraîne un nouvel essai au poll suivant ; un échec de prérequis au démarrage ferme le client et termine en erreur. Le superviseur doit gérer ce dernier cas avec délai, sans boucle rapide.

Un rejet explicite 429 suit le délai existant. Un timeout ou résultat ambigu n'est pas renvoyé aveuglément. Les soumissions abandonnées sont marquées `DELIVERY_UNCERTAIN`, uniquement dans le périmètre Meta du worker. Les callbacks réconcilient les statuts existants. Une garantie absolue « exactement une fois » entre PostgreSQL et Meta n'est pas possible : une acceptation Meta suivie d'une panne de persistance nécessite rapprochement, pas réémission automatique.

Les journaux du worker contiennent des actions fixes, codes sûrs et compteurs, sans numéro, texte, payload, URL de connexion ou token. Ne pas activer les traces SQL ou capturer les objets d'environnement dans le superviseur.

## Fichiers de cette correction

Nouveaux :

- `src/config/metaInboxWorkerConfig.js` : activation séparée, cible SQL explicite, rôle dédié, clés existantes et seuil d'envoi.
- `src/services/metaInboxWorkerService.js` : composition, identité SQL, traitement et livraison bornés.
- `src/jobs/processMetaInbox.js` : CLI et arrêt propre.
- `tests/metaInboxWorker.test.js` : 26 contrôles de composition isolés.
- `docs/sql/meta-inbox-production-worker-role.sql` : proposition de droits, **non exécutée et pas encore validée sur PostgreSQL réel**.
- Le présent rapport.

Modifiés :

- `src/repositories/metaInboxRepository.js` : reconnaissance des erreurs de concurrence SQL.
- `src/services/whatsappPreferenceService.js` : STOP ne sélectionne plus toutes les colonnes utilisateur ; les coordonnées nécessaires sont explicitement sélectionnées, sans hash de mot de passe, compatible avec un rôle restreint.
- `tests/helpers/metaInboxMock.js` : délégués et transactions nécessaires aux contrats du worker ; les anciens tests gardent leur exigence Serializable par défaut.
- `package.json` : commandes du worker et des tests, extension de la suite de publication.
- `.env.example` : nouvelles options désactivées par défaut.

Aucune migration Prisma ou règle de paiement, blocage pédagogique ou certification modifiée. Aucun fichier `.env` réel modifié.

## Validation effectuée

`npm.cmd run test:whatsapp:meta-worker` : 144 réussites lors du premier passage ciblé, avant l'ajout du contrôle STOP pour étudiant existant.

`npm.cmd run test:whatsapp:release` : **398 tests réussis**, zéro échec, zéro ignoré, dont les **26 nouveaux contrôles** du worker. Résultat local : `output/meta-worker-release-tests.log`. Le preload d'isolation interdit les connexions PostgreSQL applicatives et les appels réseau non simulés.

Parcours couverts : Bonjour/menu principal ; formations, tarifs, horaires et inscriptions ; identifiants boutons/listes ; traitement seul puis envoi ; arrêt du traitement par endpoint ; doublons ; reprise après redémarrage et bail expiré ; indisponibilité PostgreSQL simulée ; rôle SQL rejeté ; STOP avant envoi et STOP pour étudiant existant ; transfert conseiller ; erreur de transaction et reprise ; 429 ; timeout ambigu ; soumission abandonnée ; exclusion des anciens messages ; configuration modifiée ; fermeture CLI. Le vrai service Cloud est exercé avec un `fetchImpl` simulé.

**Limites :** le backend de ces tests est un mock transactionnel, pas PostgreSQL. Les 35 contrôles PostgreSQL antérieurs et 372 tests antérieurs ne valident pas les nouveaux droits du worker. Faire une répétition sur PostgreSQL isolé avec le rôle réellement restreint, les triggers et le schéma de production comparé avant autorisation. La livraison réelle et le processus existant sur Contabo ne sont pas vérifiés.

## Configuration nécessaire, sans secrets

| Variable | Valeur initiale / rôle |
|---|---|
| `META_INBOX_WORKER_ENABLED` | `false` ; activation du processus après autorisation |
| `META_INBOX_WORKER_PRODUCTION_AUTHORIZED` | `false` ; seconde autorisation explicite en production |
| `META_INBOX_WORKER_DATABASE_URL` | Secret privé distinct, sans fallback ; production exactement `127.0.0.1:5432/english_center`, rôle `nva_meta_inbox_worker_prod` |
| `META_INBOX_WORKER_BATCH_SIZE` | `20`, entre 1 et 50 |
| `META_INBOX_WORKER_POLL_MS` | `2000`, entre 1000 et 60000 |
| `META_INBOX_SEND_ENABLED` | `false`, indépendant du traitement |
| `META_INBOX_SEND_PRODUCTION_AUTHORIZED` | `false`, autorisation supplémentaire pour envoyer |
| `META_INBOX_SEND_NOT_BEFORE` | Date UTC ISO, obligatoire avant envoi, fixée au démarrage approuvé ; pas de date ancienne pour vider le backlog |

Conserver `WHATSAPP_ENABLED=false` et `WHATSAPP_WORKERS_ENABLED=false`. Réutiliser sans rotation les clés de chiffrement, de lookup, de stream et leurs versions. Le worker reçoit les mêmes identifiants de scope, configuration Meta, réglages commerciaux et URL publique nécessaires que NVA, avec sa propre URL SQL. Ne pas partager ni afficher son fichier privé. L'IA reste contrôlée par ses drapeaux existants ; aucune activation OpenAI dans cette correction. Si elle est déjà autorisée, son appel reste hors transaction via le service de complétion existant.

Le rôle proposé a CONNECT, USAGE, SELECT catalogue et permissions ciblées de traitement/conversation. Il ne possède aucun objet, aucun rôle hérité, ni CREATE/TEMP, DELETE/TRUNCATE ou écriture utilisateurs/inscriptions/paiements. Il ne peut pas activer `processing_enabled`. Un cluster accordant TEMP/CREATE ou des droits excessifs par PUBLIC provoque un refus ; demander un plan DBA compatible avec les autres applications, sans révoquer globalement des droits à l'aveugle. Le script crée un rôle NOLOGIN et refuse de remplacer un rôle déjà existant ; le provisionnement du mot de passe et LOGIN est une étape distincte autorisée, via saisie interactive.

## Déploiement futur, uniquement après autorisation

1. Exécuter les diagnostics en lecture seule du rapport `audit-final-compatibilite-nva-20261023.md` : historique/checksums Prisma, objets Meta/triggers, table des sessions HTTP, prix/horaires/sessions officiels. Ne pas mélanger le nouveau script de rôle (écriture) avec les diagnostics. Les blocages de ce rapport restent ouverts jusqu'à vérification réelle.
2. Sauvegarder PostgreSQL, schéma, historique des migrations, code et configuration privée avec la section 3 de `whatsapp-production-operator-runbook.md`. Vérifier l'empreinte du dump et sa restauration sur une base isolée. Garder les données personnelles du dump hors sorties partagées. Ne pas réinitialiser Prisma ni supprimer la table des sessions HTTP.
3. Préparer une release NVA isolée, sans remplacer le dossier actif : transfert contrôlé puis `npm ci --include=dev`, `node scripts/generatePrismaClient.js`, `npm run test:whatsapp:release`. Les archives historiques ne contiennent pas cette correction : générer un nouveau candidat revu. Ne pas installer globalement Node/PM2. Aucun changement NovanceTech.
4. Répéter la composition sur PostgreSQL de test avec les droits proposés, callbacks, STOP et redémarrage ; contrôler les privilèges et les temps SQL. Aucun SQL de rôle n'a été appliqué ici. L'étape d'installation de droits ci-dessous nécessite une autorisation distincte après validation DBA ; ne pas exécuter l'ensemble du SQL Meta historique sur des objets existants.
5. Après validation et sauvegarde, installer uniquement les droits manquants approuvés. La commande future pour un rôle inexistant est :

   ```bash
   sudo -u postgres psql -X --dbname=english_center --set=ON_ERROR_STOP=1 \
     --file="$NVA_RELEASE/docs/sql/meta-inbox-production-worker-role.sql"
   ```

   `$NVA_RELEASE` désigne le chemin absolu validé de la nouvelle release. Si le script refuse la cible, un rôle existant ou PUBLIC, arrêter ; ne pas contourner ses contrôles. Provisionner le secret via la procédure interactive indiquée dans ce script, puis le stocker dans un fichier privé hors dépôt (mode 600). Ne pas mettre l'URL SQL dans les arguments de commande. Aucune migration nouvelle requise par cette correction ; toute divergence Prisma reste à résoudre séparément.
6. Autoriser d'abord le **traitement seul** : worker et autorisation production à true, envois et autorisation envois à false, ancien worker à false. La modification d'endpoint suivante est réservée à un DBA après validation du scope complet et accord explicite ; le rôle worker ne la fait pas :

   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   UPDATE public.meta_webhook_endpoints
   SET processing_enabled = true
   WHERE id = :'endpoint_id'::uuid AND environment = 'production'
     AND application_key = :'application_key' AND meta_app_id = :'meta_app_id'
     AND waba_id = :'waba_id' AND phone_number_id = :'phone_number_id'
     AND inbox_enabled AND disabled_at IS NULL;
   -- Exiger exactement UPDATE 1 ; sinon ROLLBACK. COMMIT seulement après vérification.
   ```

   Les paramètres psql sont les identifiants techniques approuvés, jamais des coordonnées clients. Ce bloc est une modification future, **pas une commande de diagnostic à exécuter maintenant**.
7. Démarrer le nouveau worker au premier plan depuis la release, sous l'utilisateur NVA, avec un Node supportant `--env-file`. `$NVA_WORKER_ENV` désigne le fichier privé hors dépôt :

   ```bash
   cd -- "$NVA_RELEASE"
   node --env-file="$NVA_WORKER_ENV" src/jobs/processMetaInbox.js
   ```

   Garder les sorties privées. Vérifier les compteurs `processed/retrying/failed` et l'apparition de réponses QUEUED sans appel Meta. Une erreur répétée de droits ou de schéma est un arrêt de recette, pas une raison d'élargir les grants. Tester le dashboard existant avec un administrateur autorisé, sans publier les coordonnées. Contrôler que paiement/blocage, sessions HTTP et autres services fonctionnent toujours.
8. Après recette et **autorisation explicite des envois**, arrêter ce worker proprement, fixer `META_INBOX_SEND_NOT_BEFORE` à l'heure UTC approuvée, activer uniquement les deux drapeaux d'envoi et redémarrer ce processus. Le seuil est immuable dans un processus. Envoyer alors un message neuf depuis un numéro de recette consenti ; vérifier menu, listes/boutons, STOP et conseiller. Aucun rattrapage automatique des anciennes conversations.
9. Une fois approuvé, faire gérer ce seul processus par le superviseur existant. Exemple PM2, seulement si le nom est libre et que PM2 gère NVA :

   ```bash
   pm2 start "$NVA_RELEASE/src/jobs/processMetaInbox.js" \
     --name nva-meta-inbox-worker --cwd "$NVA_RELEASE" \
     --node-args="--env-file=$NVA_WORKER_ENV" --restart-delay 10000 --kill-timeout 60000
   ```

   Utiliser un chemin de fichier privé sans espaces pour cet exemple PM2 ; sinon préparer une configuration PM2 avec arguments structurés. Ne pas exécuter `restart all`, `kill`, ou écraser une configuration commune. Le worker réutilise les tables existantes ; aucun redémarrage du serveur HTTP n'est nécessaire pour lancer ce consommateur autonome. Le remplacement éventuel du code HTTP suit sa propre procédure autorisée.

## Retour arrière

1. Stopper **uniquement le nouveau worker** (`Ctrl+C` au premier plan, ou `pm2 stop nva-meta-inbox-worker` après vérification du nom). Attendre l'arrêt propre. Une requête déjà physiquement soumise peut être reçue par Meta ; ne pas la renvoyer.
2. Remettre les nouveaux drapeaux d'activation et d'envoi à false dans son fichier privé, sans changer les clés ou les anciens drapeaux. Sous autorisation DBA, remettre `processing_enabled=false` sur le même endpoint complet. Conserver la réception HTTP et les événements durables ; la file pourra être reprise après correction.
3. Ne supprimer ni événements, ni messages, ni rôle, ni table. Ne pas restaurer aveuglément un dump sur la production : cela perdrait les messages et inscriptions reçus depuis la sauvegarde. Conserver les statuts incertains et rapprocher les callbacks. Aucun down de migration requis.
4. Si le code HTTP a été remplacé par une opération séparément autorisée, revenir à sa release précédente selon le runbook NVA et redémarrer uniquement son processus exact. NovanceTech reste hors périmètre.

## Blocages restants

- État réel du serveur, présence effective d'un consommateur tiers et correspondance du candidat avec le code déployé non contrôlés.
- Écarts Prisma/SQL Meta et conservation des sessions HTTP à confirmer par les diagnostics Contabo déjà préparés.
- Nouveau rôle et permissions à valider réellement sur PostgreSQL isolé ; script fourni à relire par le DBA.
- Configuration privée, volumes historiques, seuil UTC, supervision et autorisations de traitement/envoi à approuver.
- Les tests simulés prouvent le raccordement local ; ils ne prouvent pas la délivrance Meta, les droits réseau ou la validité des identifiants de production.
