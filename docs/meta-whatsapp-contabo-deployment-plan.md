# Préparation Contabo — Meta WhatsApp, réception seule

Date : 19 octobre 2026. Audit local et plan seulement. Aucun accès VPS/PostgreSQL/Meta, migration, installation, modification de `.env`, activation ou test réseau effectué. Le serveur Contabo réel n'a pas été inspecté.

## Décision et blocages

Le socle local est prêt pour une réception de test, pas pour une activation directe dans le processus NVA de production.

- `src/services/metaInboxRuntime.js` refuse `NODE_ENV=production`, exige `META_INBOX_ENVIRONMENT=test`, et impose `127.0.0.1:55432/nva_whatsapp_test` avec `nva_meta_inbox_ingress`.
- `src/services/metaInboxService.js` impose également un scope test et un environnement non production en mode durable. Changer seulement le runtime ne suffirait pas.
- Ne pas changer `NODE_ENV` de l'application de production ou supprimer ces gardes pour faire fonctionner le webhook. Une adaptation production explicite, revue et testée, reste nécessaire.
- Premier palier recommandé : service de réception autonome, utilisateur Linux et base de staging dédiés sur le VPS, sans import du serveur métier et sans liaison à sa base. La base et les clés Windows ne sont pas automatiquement présentes sur Contabo. Si le VPS ne peut garantir cette isolation, utiliser un environnement distinct avant la production.
- Le premier palier peut conserver les gardes actuelles uniquement dans un véritable service de test non production, avec son propre `NODE_ENV=development` et son endpoint `environment=test`. Ce n'est pas un mode de déploiement de la base métier de production.

## 1. Inventaire des fichiers concernés

Ce tableau inventorie les composants locaux à prendre en compte. Sans commit de référence de la version actuellement déployée sur Contabo, il est impossible d'attester quels fichiers diffèrent effectivement de cette version. Avant release, établir un diff entre deux commits explicites ; ne pas copier tout le répertoire local.

| Groupe | Fichiers |
| --- | --- |
| Entrée HTTP | `src/routes/whatsappWebhookRoutes.js`, `src/controllers/metaInboxWebhookController.js`, montage dans `src/app.js` |
| Inbox | `src/services/metaInboxRuntime.js`, `metaInboxService.js`, `metaInboxProtocol.js`, `src/repositories/metaInboxRepository.js` |
| Traitement futur, à ne pas démarrer | `src/services/metaInboxDispatcher.js`, `metaInboxPrismaAdapter.js` |
| Transport/statuts existants | `src/services/whatsappCloudApiService.js`, `whatsappWebhookService.js`, `whatsappDeliveryPolicy.js`, `src/controllers/whatsappWebhookController.js` |
| STOP et concurrence | `src/services/whatsappSubmissionCoordinator.js`, `whatsappPreferenceService.js`, `whatsappConversationService.js`, `whatsappDeliveryService.js`, `whatsappConversationDeliveryService.js`, `whatsappProspectFollowUpService.js` |
| Configuration et processus | `src/config/whatsappConfig.js`, `src/server.js`, `src/jobs/whatsappWorkerControl.js`, `whatsappDeliveryPoller.js`, `processWhatsAppDeliveries.js` ; auditer aussi les tâches de rappels/notifications existantes |
| Prisma/dépendances | `prisma/schema.prisma`, les 44 migrations historiques, `package.json`, `package-lock.json`, `scripts/generatePrismaClient.js` |
| Déploiement existant dans le dépôt | `ecosystem.config.cjs`, `deploy/nginx/nva.conf.example`, `docs/VPS_DEPLOYMENT.md`, `docs/PRODUCTION_READINESS.md` |
| Tests Meta | `tests/metaInbox.test.js`, `metaInboxPrismaAdapter.test.js`, `metaInboxWebhookController.test.js`, `metaWebhookRoute.test.js`, `metaWhatsAppConsolidation.test.js`, `metaInboxPostgres.integration.test.js`, `metaInboxIngressRole.integration.test.js`, helpers associés et tests WhatsApp de non-régression |
| Références SQL | `docs/meta-whatsapp-prisma-migration-review.md`, `docs/sql/meta-inbox-ingress-role.sql`, `tmp/meta-whatsapp-transaction-ddl-review.sql` |

Les documents anciens décrivent des étapes intermédiaires : certains indiquent encore un rôle NOLOGIN ou un client sans Meta, désormais dépassés par les preuves locales plus récentes. Ils ne prouvent jamais l'état de Contabo.

### Dépendances

Le code de réception utilise les dépendances déjà déclarées : Express `^5.1.0`, `pg ^8.23.0`, `@prisma/client 6.19.3`, Prisma CLI `6.19.3` (devDependency), et `node:crypto`. Aucun SDK Meta ou service de tunnel n'est nécessaire sur le VPS disposant déjà de HTTPS. Aucune nouvelle dépendance n'est nécessaire à ce plan ; l'écart exact du lockfile avec la release Contabo demeure à établir.

Ne pas transférer `node_modules`, un moteur Prisma Windows ou un binaire PostgreSQL Windows. Construire dans une release isolée compatible Linux. Le générateur déclare `native`, `windows`, `debian-openssl-3.0.x` : vérifier OS, architecture, libc et OpenSSL réels. Un build Linux natif est préférable. Prévoir le CLI Prisma pendant le build avant de retirer éventuellement les devDependencies. La génération n'applique aucun SQL.

## 2. Persistance et privilèges

| Modèle Prisma | Table |
| --- | --- |
| `MetaWebhookEndpoint` | `meta_webhook_endpoints` |
| `MetaWebhookReceipt` | `meta_webhook_receipts` |
| `MetaWebhookEvent` | `meta_webhook_events` |
| `MetaWebhookReceiptItem` | `meta_webhook_receipt_items` |

Le SQL approuvé crée aussi une séquence `meta_webhook_events_enqueue_order_seq`, les fonctions et triggers de garde/manifeste. La preuve locale recense 86 colonnes, 4 PK, 4 FK, 7 UNIQUE, 7 CHECK, 25 index et 7 triggers, dont 3 différés. Les seules déclarations Prisma ne remplacent pas ce SQL technique.

Artefact local relu : `tmp/meta-whatsapp-transaction-ddl-review.sql`, SHA-256 `5700356024669fef66a3b58aa63f0c0a6a0e297b864617543c40f109eac0bb42`. Pour une future release, promouvoir ce SQL dans un artefact versionné et revu, avec empreinte et procédure de traçabilité ; un fichier `tmp` ne doit pas être l'autorité de déploiement. Vérifier les prérequis et objets réels de la cible avant toute application.

Les 44 migrations locales ne prouvent pas les migrations appliquées au VPS. Le SQL Meta local a été appliqué hors `_prisma_migrations` : ne pas rejouer ou marquer arbitrairement cette opération. Définir séparément la stratégie de migration officielle et de réconciliation des environnements avant toute production. Les six `Provider*` demeurent dans le schéma source ; aucun diff global, `db push`, reset ou migration générale ne doit les créer involontairement.

Compte d'ingestion distinct : LOGIN/SCRAM, CONNECT sur sa seule base, USAGE sur son schéma, SELECT endpoint et UPDATE(id) pour FOR UPDATE, SELECT/INSERT receipts/events/items, UPDATE limité aux colonnes exigées par acceptation/déduplication/conflit, USAGE de la seule séquence et EXECUTE de la fonction de verrouillage. Référence précise : `docs/sql/meta-inbox-ingress-role.sql`, à adapter à la cible validée, jamais rejouer aveuglément le CREATE ROLE ou le nom de base test sur une production. Aucun privilège métier, administrateur, CREATE, TEMP, DELETE, TRUNCATE ou GRANT OPTION ; auditer aussi PUBLIC, propriétaires, memberships et fonctions. Pas de RLS assurant une séparation de comptes : garder une base/rôle séparés pour le premier palier.

Le compte ingress ne peut provisionner/activer les endpoints ni appliquer les effets conversationnels STOP. Un principal de traitement différent serait nécessaire ultérieurement, sous autorisation séparée. Aucun élargissement automatique des ACL métier.

## 3. Configuration et clés Linux

Paramètres Meta réels : `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_INBOX_APP_ID`. Ne pas substituer `META_APP_SECRET`. `WHATSAPP_ACCESS_TOKEN` n'est pas nécessaire à la réception seule.

Scope : `META_INBOX_ENDPOINT_ID`, `META_INBOX_APPLICATION_KEY`, `META_INBOX_ENVIRONMENT`, `META_INBOX_AUTH_KEY_VERSION`, `META_INBOX_DATABASE_URL`.

Clés : `META_INBOX_LOOKUP_KEYS_JSON` / `META_INBOX_LOOKUP_KEY_VERSION`, `META_INBOX_STREAM_KEY_HEX` / `META_INBOX_STREAM_KEY_VERSION`, `META_INBOX_ENCRYPTION_KEYS_JSON` / `META_INBOX_ENCRYPTION_KEY_VERSION`. Trois clés distinctes de 32 octets, générées par CSPRNG, avec versions persistantes et sauvegarde chiffrée. Les versions doivent correspondre aux endpoints et événements ; ne pas remplacer une clé à chaque redémarrage. Rotation et maintien des anciennes clés doivent respecter les contraintes des streams ouverts et de déduplication.

**DPAPI Windows n'est pas un coffre portable Linux.** Ne pas copier les `.clixml` et présumer qu'ils sont utilisables sur le VPS. Pour un nouvel environnement isolé, générer de nouvelles clés Linux sans transférer de fixtures Windows. Si un transfert de données chiffrées devient nécessaire, prévoir explicitement un export contrôlé sous le compte Windows d'origine puis un ré-enveloppement dans le coffre Linux, sans fichier clair/log/argument ; opération distincte non autorisée ici.

Recommandation conditionnelle : credentials systemd (`LoadCredentialEncrypted` si version et configuration compatibles), consommés par un loader dédié à développer. L'application actuelle lit l'environnement, pas directement ces fichiers : la simple création d'un coffre ne raccorde pas les secrets. Sinon, gestionnaire de secrets disponible sur le VPS avec injection au processus ; en dernier choix, fichier privé hors release/repo, répertoire 0700 et fichier 0600 appartenant au compte de service, avec sauvegarde chiffrée et chargeur contrôlé. Ne pas modifier le `.env` existant ni placer les valeurs dans PM2, Git, arguments, tickets ou logs. Les variables d'environnement restent accessibles aux processus autorisés : elles ne remplacent pas le contrôle d'accès du compte Linux.

Garder `META_WHATSAPP_INBOX_ENABLED=false`, `WHATSAPP_ENABLED=false`, `WHATSAPP_WORKERS_ENABLED=false` jusqu'aux étapes autorisées. Au stade réception, seul le premier flag devient true dans le processus dédié. Ne pas appliquer globalement ces réglages à d'autres services sans revue de leurs usages existants.

## 4. Informations Contabo nécessaires

Demander uniquement des informations non secrètes, pas les mots de passe, tokens, `.env`, `pm2 env`, dump complet de configuration ou `nginx -T` non expurgé :

1. Distribution/version Linux, architecture, libc, OpenSSL, espace disque/RAM et limites disponibles.
2. Versions Node/npm, chemin d'installation, version Prisma/client installée, méthode de build et installation des devDependencies.
3. Commit/artifact actuellement déployé, branche/release cible, emplacement de l'application, utilisateur Unix, procédure réelle de déploiement et CI/CD éventuelle.
4. PostgreSQL : version réelle, topologie, base/port destinés au test isolé, propriétaire, extensions/permissions nécessaires, migrations appliquées et checksums, présence éventuelle d'objets Meta/Provider. Toutes vérifications SQL nécessitent une autorisation ultérieure ; aucun accès au port 5432 dans cette préparation.
5. Gestionnaire de processus réel (PM2/systemd/Docker/autre), services/cron/timers et workers actifs, ports internes libres ; ne pas supposer PM2 parce qu'un exemple existe dans le dépôt.
6. Reverse proxy réel, nom de domaine/chemin retenu, certificat/renouvellement HTTPS, WAF/limites/timeouts, politique de logs et éventuelle journalisation des corps.
7. Coffre disponible, version systemd si pertinent, procédure de sauvegarde et preuve de restauration, maintenance et retour arrière.
8. Véritables App ID, WABA/Phone Number ID, souscription applicative WABA et droits de configuration Meta à confirmer hors conversation sensible. App Secret à saisir uniquement par canal sécurisé.

## 5. Procédure progressive recommandée

Chaque étape est une proposition soumise à autorisation ultérieure, avec arrêt si sa validation échoue. Aucun ordre ci-dessous n'est exécuté.

### A — Sauvegarde et référence

Identifier les services et la base exacts avant action. Sauvegarder la production par sa procédure existante et cohérente (dump logique avec client compatible ou sauvegarde physique supportée, pas copie à chaud du dossier data). Inclure rôles utiles, code de la release courante, fichiers privés nécessaires et configuration proxy/processus protégée. Vérifier intégrité, capacité disque et restauration en environnement distinct ; une sauvegarde de la base Windows test ne couvre pas Contabo. Fixer l'inventaire avant/après et le plan de coupure du seul webhook.

### B — Secrets et service isolé

Créer ultérieurement le compte Linux de réception, le coffre et le loader, avec clés propres à cet environnement. Définir des chemins de release et un port loopback libre, sans modifier les secrets ou le service NVA existants. Ne pas réutiliser le fichier PM2 actuel, qui lance `src/server.js`. Préparer un point d'entrée réception autonome ; le guide Windows contient un bloc de démonstration mais pas un service Linux exploitable tel quel.

### C — Base Meta

Pour le premier test VPS, provisionner une base de staging réellement isolée et un rôle ingress dédié, après vérification de la topologie. Les garde-fous actuels exigent la cible test indiquée plus haut ; si cette topologie n'est pas possible, adapter les gardes de manière explicite et testée avant tout lancement. Appliquer uniquement le SQL fermé approuvé, dans une transaction, après autorisation, sauvegarde, inventaire et contrôle des objets avant COMMIT. Ne jamais utiliser la base métier existante comme base de staging. Pour une production future, refaire une revue de compatibilité et autorisation de migration ciblée.

### D — Build et code

Préparer une release indépendante avec diff et manifeste de fichiers validés. Examiner les scripts npm et le lockfile avant installation ; installer les dépendances verrouillées dans cette release, puis générer Prisma avec le CLI local 6.19.3 pour Linux. Aucun script de migration ne doit être chaîné à cette opération. Ne pas remplacer le `node_modules` de l'application active. Vérifier les quatre delegates Meta et leurs méthodes, les objets SQL non représentés par Prisma, et l'absence d'usage des Provider*. Conserver l'application et ses routes courantes inchangées. Réserver une adaptation production distincte des deux gardes runtime/service.

### E — Tests internes

Avant exposition : tests isolés ciblés avec transports simulés ; tests SQL uniquement sur la base de staging autorisée. Vérifier HMAC valide/invalide et corps brut, WABA/Phone Number ID, lot atomique, duplications/conflits, COMMIT avant ACK, panne PostgreSQL donnant un échec et non un faux 200, callback inconnu durable, redémarrage/baux, chiffrement et minimisation. Tester l'arrêt du service et sa reprise sans perte après ACK. Tester HTTP sur loopback avec serveur réception seul ; vérifier qu'il n'importe ni dispatcher ni transport ni poller. Aucun `npm test`, test global ou script de préparation/reset de base. La preuve locale de tests réussis ne remplace pas ces validations Linux.

### F — HTTPS, encore bloqué

Adapter uniquement la route webhook dans la configuration réellement utilisée, en conservant le reste du site et les autres vhosts. Sous Nginx, prévoir une correspondance exacte du chemin vers le port loopback du service dédié, sans réécriture des octets/signature, sans cache ou réponse 200 fabriquée, limite 1 MiB cohérente, GET/POST seulement ; pas de failover qui rejoue un POST vers un autre backend. Garder les chemins `/webhooks/whatsapp` et sa variante finale gérés explicitement, sans redirection des POST.

Valider d'abord la configuration avec `nginx -t` si Nginx est réellement utilisé ; recharger sans arrêter les autres vhosts. Maintenir la route en 503 jusqu'à autorisation de réception. Garder PostgreSQL et Node privés. Configurer les logs du proxy/WAF/APM pour ne pas enregistrer query strings (le GET contient le verify token), corps, signature, numéros, secrets ou fichiers temporaires de corps non protégés. Ne pas appliquer aveuglément le template `deploy/nginx/nva.conf.example` : c'est un exemple complet de site qui pourrait remplacer la configuration de production.

### G — Réception seule

Après revue et autorisation : provisionner l'endpoint réel avec identités/versions exactes, `processing_enabled=false`, puis autoriser uniquement l'acceptation inbox et sa route HTTPS. Démarrer exclusivement le service réception ; conserver les workers/cron/timers d'envoi non activés et les flags sortants false dans ce périmètre. Vérifier aussi les expéditeurs déjà présents sur le VPS : les flags d'un seul service ne désactivent pas les autres processus. Un STOP persiste mais n'est pas appliqué au métier tant que le traitement est arrêté ; ne pas présenter cette phase comme un chatbot conversationnel ou un opt-out global opérationnel.

### H — Test réel sous autorisation séparée

Enregistrer URL/verify token dans la bonne application Meta, souscrire `messages`, confirmer l'association au WABA, puis faire envoyer un seul message depuis un numéro de test autorisé. Vérifier reçu/événement durables dans le bon scope, ACK après COMMIT, absence de réponse et aucune donnée sensible dans les logs. Ne pas utiliser le test de démonstration Meta comme preuve suffisante de réception réelle. La consommation conversationnelle et les envois restent une phase distincte nécessitant compte de traitement, règles métier, supervision et autorisation.

## 6. Risques, arrêt et retour arrière

- Bloquants : configuration VPS inconnue, gardes limités au test, secrets réels absents, loader Linux et point d'entrée autonome non livrés, base isolée non confirmée, traçabilité Prisma à réconcilier.
- Risques : activation involontaire du poller par `src/server.js` si les deux flags sont true, tâches planifiées externes, nouveaux endpoints ou clés incohérents, absence des triggers/checks avec déploiement Prisma seul, création Provider* par diff global, moteurs Linux incompatibles, contention/saturation du VPS, fuite de query strings au proxy.
- Ne pas affaiblir consentement, STOP, contrôle humain, idempotence, réservations ou backoff. L'engagement transactionnel d'envoi ne peut pas annuler un appel réseau déjà engagé ; la phase réception ne prouve aucune garantie d'envoi. Ne pas autoriser un renvoi automatique d'un résultat incertain.
- En cas d'incident : remettre le seul webhook en 503, arrêter uniquement son service et fermer l'acceptation pour son endpoint après autorisation. Conserver événements, clés et traces non sensibles. Revenir au dernier artifact compatible pour ce service ; ne pas supprimer les tables ou événements et ne pas lancer de migration descendante destructive.
- Le retour arrière applicatif ne restaure pas automatiquement les effets SQL ; une restauration production est un plan d'incident distinct, avec évaluation des écritures intervenues depuis la sauvegarde. Ne jamais restaurer toute la base pour annuler simplement une fonctionnalité additive.
- Après rollback, vérifier santé et routes NVA existantes. Un webhook indisponible provoque des réessais fournisseur : dédupliquer à la reprise et surveiller le retard, sans promettre de conservation illimitée côté fournisseur.

## Sources officielles consultées

- Prisma v6/Linux/OpenSSL : https://docs.prisma.io/docs/orm/v6/reference/system-requirements
- Credentials systemd (à confronter à la version installée) : https://www.freedesktop.org/software/systemd/man/256/systemd.exec.html
- Nginx exact locations : https://nginx.org/en/docs/http/ngx_http_core_module.html
- Nginx proxy, conservation du chemin et options de requête : https://nginx.org/en/docs/http/ngx_http_proxy_module.html

**Point d'arrêt : aucune connexion Contabo, migration ou activation. Autorisation et informations VPS requises avant implémentation/déploiement.**
