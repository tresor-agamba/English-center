# Audit final de préproduction — chatbot NVA V2

**Actualisation du 25 octobre 2026 :** le [rapport de levée des blocages](nva-whatsapp-v2-final-readiness.md) remplace les réserves HUM-01 et de couverture SQL/ACL pour le candidat local courant. Le relais manuel et les rôles restreints ont été finalisés/testés, avec scripts SQL candidats durcis et nouvelle fonction de consentement. Les prérequis opérationnels de production restent ouverts ; aucune activation autorisée.

Le script 06 ne se limite plus au GRANT additif décrit dans cet audit historique : il restreint aussi les INSERT du worker. La fonction de consentement doit être préparée avant ces ACL et le code courant ; suivre l’ordre du rapport final, sans appliquer les anciens grants seuls.

Date : **24 octobre 2026**, Africa/Kinshasa. Périmètre : sources locales, rapports existants, tests avec transports simulés et laboratoire `127.0.0.1:58432/nva_whatsapp_v2_test`. L’instruction de poursuivre l’implémentation a été intégrée : les corrections locales décrites ci-dessous font partie du candidat audité.

## 1. Résumé exécutif et décision

**NO-GO pour un déploiement contrôlé. GO pour poursuivre la recette isolée.** Les parcours testés fonctionnent, mais la chaîne Meta réelle, les droits restreints complets, le relais manuel du conseiller et la compatibilité de la cible restent insuffisamment démontrés. La réussite des tests ne certifie ni la sécurité globale ni la production.

Les six rapports demandés ont été consultés, puis leurs conclusions rapprochées des sources. Les anciens chiffres 58,80 %, 487 et les anciens blocages PostgreSQL sont historiques : les mesures et réserves actuelles figurent ici et dans les derniers rapports administratif/PostgreSQL. Le corpus conversationnel actuel reste **207/216 = 95,83 %**, synthétique, avec neuf erreurs connues et seize cas critiques réussis ; ce n’est pas un taux de réussite commerciale en production.

Les exécutions finales donnent **510 tests isolés réussis**, **27 tests d’intégration PostgreSQL/HTTP réussis**, **6 tests supplémentaires de configuration/readiness exécutés avec le laboratoire**, et **une sonde SQL de droits de colonne réussie**. Zéro échec dans ces exécutions finales. Les comptes incluent les parents Node ; le corpus et la sonde SQL ne sont pas additionnés aux tests.

Aucun accès Contabo/Meta authentifié, modification de configuration réelle, migration de production, changement PM2 réel, envoi WhatsApp/e-mail réel, installation de logiciel ou altération de données étudiantes réelles. Le fichier PM2 existant à la racine est conservé ; un **candidat distinct** est préparé, sans activation.

## 2. Anomalies classées par criticité

P0 = critique ; P1 = élevée/bloquante pour l’activation ; P2 = modérée ; P3 = amélioration. Aucune exploitation P0 confirmée dans le périmètre examiné ; cela ne démontre pas l’absence de faille.

| Référence | Criticité | Constat et état |
| --- | --- | --- |
| DEP-01 | P1, ouvert | Versions Linux/Node/PM2/PostgreSQL, schéma, historique de migrations, ACL, catalogue et processus réels Contabo non observés. Impossible de déduire les migrations nécessaires de la seule base neuve. |
| META-01 | P1, ouvert | Les quatre tables `meta_webhook_*` et leurs fonctions/triggers sont hors des 47 migrations Prisma. Le laboratoire actuel de cette mission applique les migrations métier, pas le DDL Meta complet ni les rôles ingress/worker de production. Les tests SQL actuels ne valident pas la chaîne webhook → worker sous ces rôles. Des preuves historiques existent, mais ne suffisent pas pour le candidat courant. |
| HUM-01 | P1, ouvert | Le mode Meta exige `WHATSAPP_ENABLED=false` et exclut les messages manuels de son expédition. Or `queueManualReply` exige encore `configProvider().enabled`, issu du canal historique. Le transfert/pause fonctionne, mais la réponse du conseiller depuis le dashboard est indisponible dans ce mode. **Ne pas réactiver l’ancien expéditeur pour contourner ce défaut.** Définir et tester un chemin manuel dans l’unique périmètre d’envoi autorisé, ou un relais alternatif réel avant activation. |
| ACL-01 | P1, corrigé localement | `recordConfirmed` reconfirme une demande avec `confirmationDraft`, absent du GRANT UPDATE de colonne prévu pour le worker. Colonne ajoutée au script de création du rôle ; script additif séparé préparé pour un rôle déjà existant. Une transaction SQL reproduit ce droit sur une fixture, puis annule rôle et données. Aucun GRANT exécuté en production. |
| MAIL-01 | P1, prérequis ouvert | La preuve e-mail bloque effectivement la création de compte, mais la délivrabilité SMTP et l’accès HTTPS à la page de vérification ne sont pas testés avec un destinataire réel autorisé. Sans eux, le circuit s’arrête légitimement avant approbation. |
| BIZ-01 | P1, ouvert | Le discours sur le solde avant la fin du niveau ne précise pas le blocage d’accès partiel après dix séances. Portée exacte de l’essai, frais de certificat et horaires/catalogue réels à rapprocher. Aucune règle comptable ni donnée historique modifiée pour aligner un texte. |
| OPS-01 | P1 opérationnelle, corrigée dans les artefacts locaux | L’aide `nva_restart_disabled` ne neutralisait que les flags historiques/IA. Elle refuse désormais des flags Meta actifs dans son fichier d’entrée et écrase aussi les valeurs Meta héritées. **Elle n’arrête pas un autre processus worker déjà vivant** : le plan doit l’identifier et l’arrêter séparément, après autorisation. |
| SEC-01 | P2, atténué localement | Le logger conservait des e-mails/téléphones synthétiques et les effets secondaires d’inscription utilisaient `console.error(error.message)`. Masquage des coordonnées/champs d’identité, suppression du diagnostic détaillé Prisma et passage par le logger structuré. Ce filtrage n’est pas une preuve d’anonymisation de tout texte libre ou de tous les journaux historiques. |
| MAIL-02 | P2, corrigé localement | Un événement tardif d’échec d’un ancien e-mail pouvait invalider le nouveau code. Les événements de consommation/échec sont maintenant corrélés par `challengeId`. Une expiration persistée invalide est refusée explicitement. Deux scénarios PostgreSQL supplémentaires passent. |
| OPS-02 | P2, candidat préparé et arrêt corrigé | Le fichier PM2 racine ne déclare que le web, sans attente IPC de disponibilité et avec `kill_timeout=20s`. Un candidat séparé web/worker attend `ready` et prévoit 130s. Le worker interrompt maintenant les nouvelles prises au signal, au lieu de finir tout un lot avant d’engager sa fermeture. L’arrêt réel PM2/Linux et ses délais restent à mesurer. |
| DEP-02 | P2, ouvert | `npm audit --omit=dev --ignore-scripts --json` a terminé avec code 1 sans métadonnées de vulnérabilités exploitables. **Audit de dépendances non concluant**, pas « zéro vulnérabilité ». Aucun paquet mis à jour ou installé. |
| DATA-01 | P2, ouvert | Les durées d’expiration sont présentes et `expirePayloads()` existe, mais aucun appel périodique de cette fonction n’a été trouvé dans le worker/les jobs examinés. La purge des conversations/demandes, l’accès aux logs, leur rotation et leur rétention doivent être définis et vérifiés. |
| UX-01 | P3, connu | Catalogue/listes limités à dix choix sans pagination ; neuf erreurs du corpus ; identification de l’anglais par titre/slug/structure ; heures `00:00` pouvant être non renseignées. Recette du catalogue réel requise. |

Les corrections locales ne ferment pas les prérequis d’exploitation ni ne donnent l’autorisation d’appliquer les artefacts au serveur.

## 3. Sécurité : garanties et limites

| Contrôle | Résultat de l’inspection/tests |
| --- | --- |
| Authentification administrative | `validateSession` recharge le compte ; activité, rôle et `authVersion` vérifiés. `requireAdmin` refuse les autres rôles et impose le changement de mot de passe. Tests SQL/HTTP de révocation, désactivation et mot de passe requis réussis. |
| Autorisation | Routes d’administration protégées ; acteur ADMIN revérifié dans les décisions transactionnelles. Aucun second système d’inscription. Les lectures internes `list/get` dépendent de leur exposition par ces routes. |
| Entrées/injections | Identifiants bornés, normalisation téléphone/e-mail, validation nom/niveau et limites de longueur. Prisma paramétré et `$queryRaw` étiqueté pour les verrous ; pas de SQL métier construit à partir d’une entrée utilisateur dans les admissions examinées. Vues EJS échappées. Pas de garantie générale sur tout le dépôt. |
| CSRF | Contrôle global des POST navigateur ; exemption du webhook monté avant les sessions, remplacée par HMAC. Vérification e-mail publique protégée par CSRF et limiteur ; refus de POST administratif sans CSRF démontré. |
| Webhook | Corps brut conservé, HMAC-SHA256 vérifié par comparaison constante avant parsing/persistance ; contrôle WABA/numéro. Vérification GET séparée de la signature POST. Rejet compression/type incorrect et taille >1 Mo. ACK seulement après acceptation durable. |
| Doublons/idempotence | Message natif, clé d’envoi et demande source uniques ; index partiel d’une demande ouverte par conversation ; contrôle CAS des états. Un reçu API n’est pas une preuve de livraison. Un résultat incertain ne doit pas être renvoyé automatiquement. |
| E-mail | Code aléatoire 256 bits, empreinte uniquement, expiration 30 minutes, usage unique, preuve liée à la demande/identité et limitée à sept jours pour l’approbation. Modification d’identité exige une nouvelle preuve. Échec SMTP ne crée aucun compte. Pas de vérification globale ajoutée au modèle User. |
| Concurrence | Serializable, verrous de ligne/destinataire, retries bornés ; tests de double approbation, approbation/refus et dernière place réussis à deux acteurs. Pas de test de charge multiserveur. |
| Données/secrets | Mot de passe aléatoire haché, changement obligatoire ; compte existant non réaffecté à un autre e-mail. Écrans privés sans cache. Secrets/URL non reproduits dans le rapport. `.gitignore` et packaging excluent les magasins locaux, mais aucun audit exhaustif de l’historique Git ou du coffre réel n’est revendiqué. |
| Journaux | Corrections SEC-01 testées avec données synthétiques ; identifiants techniques et codes d’erreur conservés. Les IP de sécurité et textes libres résiduels exigent une politique d’accès/rétention. Les logs existants ne sont pas purgés par cette mission. |

Sources principales : `src/services/whatsappAdmissionService.js`, `whatsappAdmissionVerification.js`, `metaInboxService.js`, `loggerService.js`, `src/routes/whatsappWebhookRoutes.js`, middlewares `validateSession`, `requireAdmin`, `csrfProtection`, et contrôleurs/vues administratifs.

Le prestataire e-mail impose TLS, validation des certificats, délais et erreurs génériques ; il interdit le transport réel en NODE_ENV=test. Les tests utilisent une boîte en mémoire. Aucun token SMTP/code n’est placé dans une URL. La page e-mail est sans cache et ne révèle pas de coordonnées. La remise du mot de passe temporaire reste une responsabilité administrative ; le lien `wa.me` contenant les identifiants est absent du parcours d’admission WhatsApp.

## 4. Compatibilité Meta WhatsApp et parcours

Le validateur local impose au plus **3 boutons**, libellés **20 caractères**, ou **10 lignes** dans une section avec titres **24 caractères** ; corps interactif au plus **1 024 caractères** et identifiants ASCII bornés à **200 caractères**, volontairement conservateurs. Titres/IDs dupliqués ou payloads invalides sont refusés ; les longs messages utilisent le repli texte. Les réponses `button_reply`/`list_reply` sont résolues par ID et jeton de choix, pas par libellé. Les choix périmés ne déclenchent pas d’action.

La fenêtre repose sur le dernier timestamp entrant fournisseur valide, et non sur la simple heure de réception. Le marqueur d’engagement avant transport, les barrières STOP/prise humaine, les callbacks monotones et la non-reprise d’une livraison incertaine limitent les doublons. Seuls les refus 429 confirmés sont repris selon la politique examinée. L’exactement-une-fois côté fournisseur n’est pas garanti par `biz_opaque_callback_data`.

Les messages administratifs restent des brouillons. Les réponses automatiques Meta natives après cutoff sont distinguées des anciennes files et des messages manuels. La présence d’un nom de template dans une configuration ne prouve pas son approbation par Meta. Aucun modèle réel, quota, compte WABA, token ou version Graph effectivement active n’a été vérifié.

La [politique officielle WhatsApp Business, section 2](https://business.whatsapp.com/policy), consultée le 24 octobre 2026, confirme la fenêtre de réponse libre de 24 heures et l’exigence de modèles approuvés hors fenêtre. La documentation des [boutons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages) et [listes](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages) a renvoyé HTTP 429 pendant cet audit : les limites locales sont contrôlées, **la conformité actuelle complète de plateforme reste à revalider** avant recette Meta. Aucun contenu technique de sources tierces n’est utilisé comme certification.

| Parcours demandé | Verdict local |
| --- | --- |
| Accueil, trois boutons, questions libres et formations | Validés dans les suites avec mocks ; limites conversationnelles du corpus conservées |
| Tarifs, essai, paiement | Textes et sélection de produit testés ; divergence BIZ-01 non levée |
| Horaires et sessions dynamiques | Catalogue réel du laboratoire et indisponibilités testés ; catalogue cible non observé |
| Site et WhatsApp | Deux méthodes, contexte, interruptions et changements testés |
| Consentement et enregistrement | Demande PENDING seulement après confirmation ; aucun compte ni réservation créée par la collecte |
| Approbation, refus motivé, complément | SQL/HTTP réussis ; compte/Enrollment/audit atomiques pour l’approbation, CANCELLED/PROCESSING pour les autres décisions |
| Vérification e-mail | Mauvais code, expiration, rejeu, modification d’identité et erreurs de livraison testés ; livraison réelle non validée |
| Transfert humain | Pause/reprise/conservation du contexte validées ; réponse manuelle du conseiller bloquée dans le mode Meta, HUM-01 |

L’orchestrateur reprend le **statut retourné** par l’admission : une demande PENDING/PROCESSING/CANCELLED ne confirme pas une nouvelle inscription. ENROLLED dépend de l’Enrollment lié et de la transaction terminée ; l’approbation n’annonce ni paiement intégral ni certificat acquis.

## 5. PostgreSQL, Prisma et données existantes

Les **47 migrations locales** sont recensées et leurs empreintes consignées dans [l’audit de sources](../output/nva-v2-preproduction-source-audit.json). Le laboratoire vierge est compatible avec les parcours SQL exercés. Les nouvelles corrections ne modifient aucune migration Prisma, table métier ou facture.

Les index source-message, téléphone utilisateur, utilisateur/session et demande ouverte partielle empêchent les doublons couverts. Les CHECK/FK de demande sont installés par migration, pas seulement déclarés dans Prisma. Le verrouillage par destinataire/ligne et l’isolement Serializable peuvent attendre ou produire des conflits : prévoir surveillance des attentes, deadlocks, timeouts et retries, sans augmenter aveuglément les délais ou la concurrence.

**Écart majeur :** le DDL Meta canonique `docs/sql/meta-inbox-schema-reviewed.sql` est externe à Prisma, non idempotent et sans transaction propre. Tables présentes seules ne suffisent pas : fonctions, triggers différés, index et ACL doivent correspondre. Les modèles Provider* déclarés ne sont pas une autorisation de les créer. Pas de `db push`, diff global, reset ou génération automatique de migration à déployer.

Certaines anciennes migrations suppriment/transforment des colonnes/types : la réussite sur base vide ne justifie jamais leur application à des données existantes. Il faut relever l’historique réel et ses checksums, puis rejouer uniquement les évolutions nécessaires sur une restauration isolée. Les diagnostics en lecture seule `03-contabo-readonly-structure.sql`, `04-contabo-readonly-catalog.sql`, `05-contabo-readonly-worker.sql` existent ; **ils n’ont pas été exécutés sur Contabo**.

La sonde ACL actuelle crée un rôle NOLOGIN temporaire dans une transaction de laboratoire, accorde les colonnes issues du script candidat et écrit `confirmationDraft`. Rôle et fixtures sont annulés. Elle prouve le droit corrigé, **pas l’ensemble des privilèges du worker/ingress de production**, ni leurs gardes d’identité sur le vrai schéma Meta.

Le bootstrap `trust` local, le compte de migration, les données fictives et la fonction de diagnostic du cluster ne doivent jamais être copiés en production. Les neuf tables métier contrôlées sont vides après nettoyage ; l’avancement des séquences est normal.

## 6. Compatibilité Node.js, PM2 et infrastructure

Node local observé : **v24.18.0**, Windows. Prisma CLI/client **6.19.3** ; le lockfile inclut notamment `file-type 22.0.2` exigeant Node >=22 et `nodemailer 10.0.3` exigeant >=20. Se limiter au minimum historique Prisma serait donc insuffisant. Le candidat déclare désormais **`^22.11.0 || ^24.0.0`** dans package.json et le lockfile, sans changer les versions installées. La [documentation Prisma 6](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v6) précise notamment le minimum 22.11 pour Node 22 ; valider le runtime retenu sur Linux et ses dépendances natives, sans mise à jour globale de Node/PM2.

Le fichier racine `ecosystem.config.cjs` reste inchangé : web unique fork, kill 20s, pas d’attente IPC. Le nouveau [candidat PM2](../deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs) sépare web et worker, une instance chacun, annonce/attend `ready`, prévoit 130s et garde traitement/envoi désactivés. Le worker arrêté par signal bloque immédiatement les nouvelles prises, attend l’opération courante puis ferme Prisma. Un démarrage désactivé sort sans boucle de redémarrage continu grâce à `stop_exit_codes:[0]`.

Ce candidat est un artefact de revue, **pas une instruction de démarrer une seconde application**. Les noms/cwd/interpréteurs/délais doivent être rapprochés des processus réels avant emploi. Les délais restent à mesurer sous charge et pendant une indisponibilité SQL ; 130s n’est pas une preuve de fermeture bornée dans toutes les situations. Voir les mécanismes documentés de [fermeture et disponibilité PM2](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/).

Variables à vérifier sans afficher leurs valeurs :

| Groupe | Noms principaux / règle |
| --- | --- |
| Web/sessions | NODE_ENV, HOST boucle locale, PORT libre, DATABASE_URL applicative, SESSION_SECRET robuste, SESSION_POOL_MAX, PUBLIC_APP_URL HTTPS, TRUST_PROXY=1, stockage privé et sauvegardes |
| E-mail | SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM ; page `https://www.newvisionacademy.org/whatsapp/admission-email` accessible ; APP_BASE_URL reste nécessaire au parcours de récupération existant |
| Inbox Meta | META_WHATSAPP_INBOX_ENABLED, META_INBOX_ENVIRONMENT, META_INBOX_PRODUCTION_AUTHORIZED, META_INBOX_DATABASE_URL, META_INBOX_ENDPOINT_ID, META_INBOX_APPLICATION_KEY, META_INBOX_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN ; META_INBOX_LOOKUP_KEYS_JSON/LOOKUP_KEY_VERSION, META_INBOX_STREAM_KEY_HEX/STREAM_KEY_VERSION, META_INBOX_ENCRYPTION_KEYS_JSON/ENCRYPTION_KEY_VERSION et META_INBOX_AUTH_KEY_VERSION, avec le préfixe META_INBOX pour chaque nom abrégé |
| Worker Meta | META_INBOX_WORKER_ENABLED, META_INBOX_WORKER_PRODUCTION_AUTHORIZED, META_INBOX_WORKER_DATABASE_URL, paramètres de lot/poll ; rôle distinct et limité |
| Envoi Meta | META_INBOX_SEND_ENABLED, META_INBOX_SEND_PRODUCTION_AUTHORIZED, META_INBOX_SEND_NOT_BEFORE UTC, WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_API_VERSION ; autorisation séparée de la réception |
| Coexistence | WHATSAPP_ENABLED=false, WHATSAPP_WORKERS_ENABLED=false, NVA_CHATBOT_AI_ENABLED=false ; inventorier aussi cron/timers/processus ayant leur propre environnement |

Les gardes Meta attendent actuellement une base/rôles/port précis (`english_center`, 127.0.0.1:5432 et rôles dédiés). Toute divergence réelle arrête le runtime ; ne pas contourner ces gardes. Le magasin HTTP PostgreSQL `http_sessions` a sa propre préparation : le `SELECT 1` de `/ready` ne vérifie ni ces tables, ni les objets Meta, ni l’état du worker. `/health` atteste seulement la vie du processus.

Générer Prisma et les dépendances natives dans la release Linux isolée ; ne pas transférer node_modules ou moteurs Windows. Prévoir le CLI Prisma pendant le build. Lockfile, OpenSSL/libc/architecture, répertoires de logs, permissions, rotation, HTTPS/reverse proxy, stockage de sessions et plafonds de connexions doivent être vérifiés sur recette représentative. Ne pas utiliser un `npm install` non verrouillé sur l’application active.

## 7. Corrections et tests de cette intervention

Corrections locales : ACL-01, OPS-01, SEC-01, MAIL-02 ; arrêt coopératif du worker et signal de disponibilité ; contrainte Node explicite ; candidat PM2 distinct. Le script additif [06-worker-admission-draft-grant.sql](../deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql) est destiné à un rôle existant et vérifie cible/rôle/colonne ; le script de création reste destiné à une installation neuve et refuse un rôle déjà présent. Aucun des deux n’a été exécuté en production.

Autres fichiers concernés : `src/services/loggerService.js`, `registrationService.js`, `whatsappAdmissionVerification.js`, `metaInboxWorkerService.js`, `src/jobs/processMetaInbox.js`, `src/server.js`, `deploy/whatsapp-chatbot/operator-functions.sh`, package.json/lockfile, lanceur du laboratoire et tests. Le nouveau [auditNvaV2Preproduction.js](../scripts/auditNvaV2Preproduction.js) est hors réseau/DB/PM2 et ne lit pas `.env` ; il conserve un inventaire d’empreintes de sources sélectionnées, pas un manifeste exhaustif de release.

| Exécution finale | Résultat | Preuve |
| --- | --- | --- |
| Release WhatsApp | 412/412 | [journal](../output/nva-v2-preproduction-release-final.log) |
| Compléments fonctionnels/fiabilité/contrats | 80/80 | [journal](../output/nva-v2-preproduction-extra-final.log) |
| Route webhook réellement montée, avec mocks | 12/12 | [journal ciblé](../output/nva-v2-preproduction-targeted-fixed.log) |
| Nouveaux contrôles de préproduction | 6/6 | Même journal : logs, ACL, candidat, readiness worker, arrêt et flags |
| Intégration métier PostgreSQL existante | 7/7 | [journal](../output/nva-whatsapp-v2-postgres-20261024/business-tests.log) |
| Administration SQL/HTTP, avec deux nouveaux cas e-mail | 20/20 | [journal](../output/nva-whatsapp-v2-postgres-20261024/admin-tests.log) |
| Readiness/configuration VPS sur laboratoire | 6/6 | [journal](../output/nva-whatsapp-v2-postgres-20261024/vps-readiness-tests.log) |
| Droit de colonne worker sur SQL | PASS, transaction annulée | [sonde](../output/nva-whatsapp-v2-postgres-20261024/worker-acl-reconfirmation.json) |
| Nettoyage/droits restreints finaux | PASS | [inventaire](../output/nva-whatsapp-v2-postgres-20261024/final-checks.json) |
| Corpus d’acceptation | 207/216, 16/16 critiques | [mesure](../output/nva-v2-preproduction-holdout.json) |
| Syntaxe JS/candidat et compilation EJS | OK, 164 vues | Contrôles locaux |

Un premier appel de `productionVpsReadiness.test.js` avec le garde **interdisant toute DB** échouait sur son `SELECT 1` attendu : mauvais mode d’exécution, conservé dans [ce journal](../output/nva-v2-preproduction-targeted.log). Il a été relancé avec la connexion explicitement isolée et réussit ; son chargement direct de `.env` a été retiré. Aucun test de santé de production n’est revendiqué. Le laboratoire a nécessité un redémarrage après disparition de son écoute ; aucune autre instance modifiée.

L’audit npm est **non concluant** ; ses sorties locales sont conservées dans `output/nva-v2-preproduction-npm-audit*`. Refaire cet audit et l’examen des avis de sécurité du lockfile dans un environnement autorisé. Ne pas lancer automatiquement `npm audit fix`.

## 8. Prérequis et plan détaillé de déploiement — non exécuté

Le plan est préparé, **aucune étape distante exécutée**. Ne pas le démarrer tant que les P1 ouverts ne sont pas levés et qu’une autorisation explicite ne vise pas le paquet exact, les processus et le créneau.

1. **Fermer les prérequis.** Corriger/tester HUM-01 sans second sender ; rapprocher catalogue/paiement/certification ; valider SMTP avec destinataires autorisés ; tester le DDL et les ACL Meta complets sur restauration représentative ; terminer l’audit de dépendances. Définir les modèles Meta nécessaires et leur statut réel, les destinataires de recette et le consentement. Désigner opérateur, responsable de décision et contact d’arrêt.
2. **Inventaire en lecture seule.** Identifier application NVA exacte, chemin réel, gestionnaire de processus, version Node/PM2/OS/libc/OpenSSL, écoute/reverse proxy, services/cron/timers/anciens senders, URL/identité DB et historique/checksums. Capturer les métadonnées utiles de PM2 en mémoire et les expurger ; ne pas publier `pm2 env`, `.env`, `jlist` brut ou configuration Nginx complète. Isoler tout autre service/locataire.
3. **Sauvegarde vérifiée.** Sauvegarder base NVA, code actif, lockfile, configuration protégée et stockage privé nécessaires ; préserver séparément clés de chiffrement, versions et mapping de l’endpoint. Produire empreintes, horodatage/RPO et copie hors serveur. Restaurer sur environnement séparé et vérifier les données/contraintes et la compatibilité du code de retour arrière. Ne pas déclarer une sauvegarde valide sur sa seule création.
4. **Construire une release indépendante.** Paquet avec manifeste/diff/empreinte approuvés ; exclure secrets, clusters, dumps, output, logs et node_modules Windows. Installer via `npm ci` dans la release isolée, génération Prisma 6.19.3 pour Linux et compilation des vues ; pas de migration chaînée. Vérifier runtime accepté et dépendances natives. Ne pas installer d’outil système sans autorisation.
5. **Recette représentative, transports simulés.** Rejouer le circuit complet signé → inbox SQL → rôle worker restreint → moteur → demande → administration, puis fenêtres/STOP/prise humaine/erreurs/reprises/arrêt pendant envoi. Prouver l’absence d’envoi et de copie de secrets de production. Tester les comptes et les données restaurées anonymisées avec contraintes réelles.
6. **Préparer la configuration, sans activation.** Créer les configurations candidates protégées, comparer uniquement noms/présence/formats des variables. Conserver les trois niveaux réception/traitement/envoi séparés et le cutoff UTC explicite. Désactiver les anciens senders dans **tous leurs processus**, pas seulement dans le web. Préparer le bon nom/cwd de chaque processus ; ne pas démarrer le candidat à côté du service actif.
7. **Fenêtre autorisée et évolutions SQL.** Geler le périmètre NVA et contrôler l’identité de la cible. Comparer le statut des migrations et n’appliquer que les évolutions nécessaires déjà testées. S’il manque le DDL Meta, procédure versionnée approuvée, transaction externe et arrêt sur erreur ; ne jamais le rejouer sur des objets partiels sans comparaison. Créer les rôles uniquement s’ils manquent ; pour ACL-01 sur rôle existant, appliquer seulement la réparation additive approuvée. Aucune révocation globale PUBLIC ni migration historique destructive non arbitrée. Journaliser les versions, pas les secrets.
8. **Promotion avec envoi fermé.** Remplacer uniquement la release NVA ciblée ; redémarrer uniquement les processus explicitement identifiés. Vérifier IPC `ready`, `/health`, `/ready`, login/sessions, routes existantes, schéma/ACL et journaux ; le statut PM2 online seul est insuffisant. Tester le signal d’arrêt et la reprise. En cas d’erreur, arrêter la promotion avant tout envoi.
9. **Ouverture progressive autorisée.** Réception, puis traitement, puis envoi uniquement après revue des événements en attente et du cutoff. Une phase réception seule n’applique pas STOP au métier : ne pas la présenter comme un bot opérationnel. Les essais WhatsApp réels exigent une autorisation séparée et des contacts explicitement consentants ; valider trois boutons, liste, réponse libre, demande PENDING, e-mail, approbation/refus/complément et relais humain corrigé. Ne pas réémettre de vieux messages ni utiliser un destinataire étudiant réel par commodité.
10. **Surveillance et clôture.** Observation rapprochée pendant la première heure puis revue quotidienne pendant la période contrôlée. Conserver preuves expurgées de santé, erreurs, latence, backlog, statuts, limites, coûts et décisions. Élargir le périmètre uniquement après critères d’acceptation documentés et validation du responsable.

## 9. Surveillance, critères d’arrêt et retour arrière

Surveiller les logs structurés META_WORKER_BATCH/META_WORKER_ERROR, les erreurs de signature, backlog et âge des événements, RETRY_WAIT/FAILED/review_required, expirations/baux, DELIVERY_UNCERTAIN, erreurs 401/403/429 Meta, indisponibilités SQL/SMTP, échecs de preuve e-mail, doublons, admissions sans lien, conflits et temps de verrouillage. Ajouter des contrôles de fraîcheur du worker et de ses derniers événements : `/ready` ne les remplace pas. Vérifier rotation, espace disque, accès restreints et exécution effective de la rétention.

**Arrêt immédiat de l’envoi** en cas de réponse à un STOP/prise humaine non autorisée, message à mauvais destinataire, envoi en double avéré, confirmation d’inscription sans transaction réussie, fuite de secret/données, cible DB/processus inattendue, conflit de sender, ou incapacité à appliquer le contrôle humain. Suspendre aussi la montée en charge si erreurs auth Meta, échecs SQL, panne SMTP ou backlog hors seuil défini pendant la recette. Les seuils chiffrés de disponibilité/backlog doivent être établis avant le lancement, pas inventés à partir d’un test local.

Retour arrière à préparer et répéter :

1. Fermer le switch d’envoi et arrêter proprement le worker NVA exact ; fermer le traitement si nécessaire. Modifier un fichier seul n’arrête pas un processus déjà vivant : vérifier son environnement effectif sans l’afficher. Ne jamais employer `pm2 stop all`, `restart all`, `kill` ou une action globale commune.
2. Conserver la file, les résultats incertains, les consentements, les audits et les événements de décision. Ne pas remettre automatiquement en QUEUED un message potentiellement accepté. Décider si la réception reste ouverte ; surveiller les réessais Meta et l’accumulation des STOP non traités.
3. Restaurer la release/configuration applicative précédente autorisée, régénérer les dépendances compatibles si nécessaire et redémarrer uniquement NVA avec envoi fermé. Vérifier santé, sessions et routes existantes.
4. Garder les ajouts SQL compatibles. Ne pas supprimer tables/index/contraintes, éditer des checksums ni utiliser `migrate reset/resolve` pour masquer un échec. Si le code précédent est incompatible, maintenir le service fermé et appliquer le plan DBA testé.
5. Une restauration de base de production est une décision séparée avec impact/RPO explicites : elle peut perdre consentements, demandes et décisions apparus après sauvegarde. Préférer la remise en état additive ; sauvegarder les nouveaux événements avant toute restauration autorisée. Vérifier de nouveau déduplication et cutoff avant reprise.
6. Consigner les causes, versions, états de messages et contrôles réalisés ; ne réouvrir l’envoi qu’après correction et nouvelle autorisation.

## 10. Conclusion

Les corrections locales rendent le candidat plus sûr et ses prérequis plus explicites. **NO-GO production maintenu** à cause de HUM-01, de la chaîne Meta SQL/ACL courante non rejouée intégralement sur recette représentative, de la compatibilité Contabo non observée, de la délivrabilité e-mail et des arbitrages métier. Les limites de l’audit de dépendances et de l’exploitation doivent également être closes. Aucun succès de test n’annule ces réserves.

Reproduction locale des vérifications effectuées : `node scripts/auditNvaV2Preproduction.js`, `npm.cmd run test:whatsapp:release`, tests ciblés avec `whatsappIsolationGuard.cjs`, puis `scripts/runNvaV2PostgresLab.js` avec son autorisation et ses variables de laboratoire explicites. Ce lanceur refuse une autre cible. Les scripts SQL/PM2 candidats et le plan ci-dessus restent **non exécutés en production**.
