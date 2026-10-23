# NVA — Validation technique PostgreSQL du chatbot WhatsApp

Date du bilan : 23 octobre 2026, Africa/Kinshasa.

## Résultat et décision

**Les parcours d’inscription et d’administration testés fonctionnent sur PostgreSQL réel après trois corrections locales.** Résultats finaux : **27 contrôles d’intégration inscriptions/dashboard réussis, 8 contrôles Meta Inbox réussis, 372 tests locaux réussis et 163 modèles EJS compilés**. Six captures du dashboard, sur deux largeurs, ne présentent pas de débordement horizontal.

**Ce résultat n’autorise pas un déploiement automatique.** Les migrations Prisma seules ne créent pas les tables Meta Inbox. Le SQL Meta existant a été appliqué et testé séparément, uniquement dans le laboratoire. Le diff entre migrations et schéma Prisma demeure non vide : modèles Provider déclaratifs non migrés, différences de clés étrangères et de valeurs par défaut/index. Il faut délimiter et revoir le paquet réellement destiné à Contabo, sans appliquer un diff global.

Aucune base de production n’a été utilisée. Aucun envoi WhatsApp, worker de production, déploiement Contabo, modification de NovanceTech ou push GitHub. Aucun secret affiché. Aucun changement des règles de paiement, de blocage pédagogique ou de délivrance des certificats. Aucun nouveau fichier de migration créé.

## 1. Isolation et bases utilisées

| Élément | Valeur vérifiée |
| --- | --- |
| PostgreSQL | 16.15, distribution Windows déjà présente localement |
| Cluster créé pour cette validation | `D:\English-center\output\postgres-validation\cluster` |
| Écoute | IPv4 `127.0.0.1` seulement |
| Port initial | 55442 ; devenu réservé par Windows après reprise de l’environnement |
| Port final | 56432, distinct de 5432 ; aucune utilisation d’une instance existante |
| Première base | `nva_admissions_validation`, migrations et constat avant corrections |
| Seconde base neuve | `nva_admissions_validation_v2`, migrations réappliquées et validation après corrections |
| Propriétaire du cluster de laboratoire | `nva_validation_owner`, utilisé uniquement pour créer les bases/rôles et vérifier le répertoire du cluster |
| Migrateur | `nva_validation_migrator`, propriétaire des objets de test, sans superuser/CREATEDB/CREATEROLE |
| Application | `nva_validation_app`, DML et séquences, sans propriété, CREATE ou TRUNCATE |
| Réception Meta | `nva_validation_ingress`, NOINHERIT, droits de réception par colonne, sans accès aux données métier |

Les scripts d’intégration n’importent pas dotenv. Ils suppriment les configurations héritées de base, Meta, WhatsApp, OpenAI et autres canaux concernés, puis fixent une URL locale explicite. Le contrôle préalable vérifie hôte, port, nom de base et, pour les scripts métier, le répertoire du cluster. Les appels externes par fetch sont refusés ; seuls les appels HTTP vers le serveur Express lié à `127.0.0.1` sont permis dans le test du dashboard. Aucun serveur NVA de production n’a été démarré ou contacté.

Les commandes Prisma peuvent annoncer le chargement du `.env` par leur CLI ; leur processus recevait explicitement la variable DATABASE_URL du laboratoire, prioritaire sur celle du fichier. Le fichier `.env` n’a pas été modifié. Aucun dump ni donnée de production n’a servi aux fixtures.

Les données sont synthétiques : comptes de validation, adresses `example.test`, formation à 60 USD et créneaux vendredi/samedi conformes aux valeurs demandées. Le cluster utilise une authentification locale trust pour ce laboratoire jetable ; cette configuration ne doit jamais être copiée en production.

**État final : cluster de laboratoire arrêté par pg_ctl, port 56432 sans réponse.** Les bases et données synthétiques sont conservées sur disque pour revue. Les points Meta créés pour les tests ont tous été désactivés. Les flags d’envoi et de workers étaient false dans les processus de validation. Le paramètre admissionsEnabled a été activé uniquement dans les fixtures PostgreSQL, pas dans une configuration de production.

Preuve d’identité : [isolation.json](../output/postgres-validation/isolation.json).

## 2. Migrations, intégrité et SQL

### Migrations Prisma

Les **47 migrations présentes dans le dépôt** se sont appliquées avec `prisma migrate deploy` sur chacune des deux bases neuves. Aucun `migrate reset`, `db push`, seed global ou `npm test` n’a été utilisé. `prisma validate` réussit. `prisma migrate status` indique un historique à jour.

Les 47 checksums en base correspondent aux fichiers locaux et les migrations sont toutes terminées, sans rollback enregistré. L’audit de release effectué sur cet historique **de test** donne zéro migration en attente et zéro blocage de checksums. Cela ne remplace pas l’examen de l’historique Contabo.

Les trois migrations récentes du module sont :

1. `20261020120000_add_whatsapp_chatbot_admin` ;
2. `20261020140000_add_whatsapp_interactive_scenarios` ;
3. `20261022120000_add_whatsapp_admission_requests`.

La dernière crée WhatsAppAdmissionRequest et WhatsAppAdmissionEvent, leurs index et contraintes, et ajoute admissionsEnabled/admissionContent aux paramètres. Les trois corrections décrites plus bas n’exigent aucune migration supplémentaire.

### Vérifications réellement effectuées

- **41 contraintes** inventoriées sur les tables admissions, événements, scénarios et Meta : toutes validées.
- **21 index** inventoriés sur les tables examinées : tous valides et prêts.
- **7 triggers Meta non internes** : tous activés après application du SQL Meta séparé.
- Rejets SQL vérifiés : sourceMessageId dupliqué, seconde demande ouverte dans une conversation, conversation inexistante, niveau invalide, statut invalide et statut ENROLLED sans enrollmentId.
- Persistance des événements de consentement, de prise en charge, de correction des coordonnées et d’inscription.
- Sessions HTTP effectivement stockées dans PostgreSQL, dans `http_sessions`.

Preuves : [schema-integrity.json](../output/postgres-validation/schema-integrity.json), [migration-audit.json](../output/postgres-validation/migration-audit.json), [historique v2](../output/postgres-validation/migration-history-v2.json).

### SQL Meta distinct des migrations

Sur une base créée uniquement par les 47 migrations, les quatre tables `meta_webhook_endpoints`, `meta_webhook_receipts`, `meta_webhook_events`, `meta_webhook_receipt_items` sont absentes. Le dépôt dispose du DDL [meta-inbox-schema-reviewed.sql](sql/meta-inbox-schema-reviewed.sql), mais ce fichier n’est pas une migration Prisma.

Il a été exécuté en transaction uniquement sur la base v2, après vérification de son identité. Les tables, contraintes, fonctions et triggers ainsi créés ont permis les tests Meta PostgreSQL réels. Son empreinte et sa date d’application sont dans [meta-sql-application.json](../output/postgres-validation/meta-sql-application.json). L’historique Prisma reste à 47 migrations : ce supplément n’y a pas été artificiellement inscrit.

La procédure de livraison doit donc vérifier si Contabo possède déjà ce schéma et ces protections. Si ce n’est pas le cas, la revue DBA et le mode de livraison/versionnement de ce SQL sont un prérequis. **Ne pas présumer que migrate deploy suffit à installer Meta Inbox.**

### Diff Prisma restant

Avant le SQL Meta, le diff proposait dix tables absentes. Après son application, il reste notamment :

- six tables `provider_*`, déclarées dans le schéma avec une note « declarations only », sans migration correspondante ; elles n’ont pas été créées pour faire artificiellement disparaître le diff ;
- `http_sessions`, table du stockage des sessions gérée hors du schéma Prisma ; elle a été préparée par le propriétaire pour permettre un rôle applicatif sans DDL ;
- des différences de clés étrangères : les FK admissions de la migration ont ON UPDATE NO ACTION implicite, alors que Prisma attend ON UPDATE CASCADE ;
- des écarts historiques sur les FK académiques/financières, certains defaults updated_at et noms d’index.

`migrate status` à jour **ne signifie donc pas** absence de drift. Les contrôles métier ne mettent pas en évidence de corruption, mais l’intégrité globale schéma/migrations n’est pas déclarée parfaite.

Le diff détaillé a été généré **sans exécution** : [résumé final](../output/postgres-validation/schema-diff-final.txt). Le fichier `schema-diff-final-DO-NOT-APPLY.sql` est uniquement une pièce de diagnostic. Il contient des suppressions/recréations et **ne doit pas être appliqué**, notamment à cause de la table de sessions et des composants déclaratifs hors périmètre.

## 3. Parcours WhatsApp réellement persisté

Le test a traversé : **bonjour → Tarifs par réponse de liste → OUI par bouton → Par l’admin → consentement → nom → confirmation du numéro → e-mail → niveau → confirmation finale**.

Les libellés des clics injectés diffèrent volontairement des textes visibles : le routage se fait bien par identifiant. Le service de conversation, le moteur existant, les services catalogue et inscription lisent/écrivent PostgreSQL réel.

Constats :

- aucune demande ni inscription avant la confirmation finale ;
- après confirmation : demande PENDING réellement commitée avec coordonnées et consentVersion `admissions-v1`, événement et notification administrative ;
- aucun compte étudiant ni Enrollment créé lors de cette seule confirmation ;
- un message Meta répété ne crée pas de seconde demande ou notification ;
- les réponses sont préparées en base, mais aucune n’est transmise à Meta.

Le second groupe de tests a exercé **la chaîne durable complète** : acceptRaw avec signature HMAC synthétique, réception et événement chiffré, claim explicite de l’événement, traitement transactionnel, dispatcher, adaptateur Prisma, moteur de conversation et enregistrement de la demande. Ces opérations sont des appels ponctuels de test, pas le démarrage d’un worker.

Les tests vérifient également le rejet d’une mauvaise signature sans écriture, la déduplication durable, puis STOP : conversation OPTED_OUT, événement de retrait et annulation de toutes ses réponses QUEUED. Les points Meta synthétiques sont désactivés en fin de scénario.

Preuves : [résultats admissions](../output/postgres-validation/admissions-results.json), [résultats Meta](../output/postgres-validation/meta-results.json), [transcription commerciale](../output/postgres-validation/commercial-transcript.json).

## 4. Dashboard et autorisations

Contrôles HTTP sur Express réel, avec connexion par mot de passe synthétique et sessions PostgreSQL :

| Contrôle | Résultat |
| --- | --- |
| Liste et détail des demandes | HTTP 200 ; coordonnées réellement présentes ; Cache-Control no-store |
| Anonyme | Redirection vers la connexion |
| Étudiant sur une page/action admin | HTTP 403 |
| POST sans jeton CSRF | HTTP 403 |
| Prise en charge | PENDING → PROCESSING, administrateur affecté et événement enregistré |
| Correction des coordonnées | Écriture et événement IDENTITY_EDITED |
| Conversion sans confirmation explicite | HTTP 400 ; aucune inscription créée |
| Bouton « Inscrire cet étudiant » | Formulaire réel, session/groupe/niveau requis et confirmation initialement décochée |
| Conversion valide | Création d’un compte STUDENT avec changement de mot de passe requis et d’un Enrollment dans le système existant |
| Liaison de l’inscription | Bonne session, bon groupe, montant historique 60 USD, statut TRIAL_ACTIVE, demande ENROLLED et brouillon de confirmation |
| Conversion répétée | Même compte, même inscription ; pas de doublon |
| Deux conversions concurrentes | Après correction, deux appels aboutissent avec une seule inscription pour ce compte/session |
| Demande clôturée | Édition refusée, HTTP 409 |
| Annulation | Demande CANCELLED ; conversion ultérieure refusée |
| Simulateur | Consultation et premier échange HTTP sans création de demande réelle supplémentaire |

La création est bien celle de l’Enrollment historique, via `registrationService.createRegistrationInTransaction`, et non une inscription fictive dans le simulateur. Cela ne signifie pas qu’une nouvelle AcademicEnrollment du module académique séparé est automatiquement créée.

### Permissions SQL

Le rôle applicatif a exercé le parcours avec ses droits DML/séquences, sans être propriétaire des objets, superuser ou détenteur de CREATE/TRUNCATE. Une tentative CREATE TABLE a été effectivement refusée.

Pour Meta, les réceptions signées ont été stockées par un **autre client Prisma connecté au rôle ingress limité**, puis traitées par le rôle applicatif. Le rôle ingress a uniquement les droits de tables/colonnes nécessaires au dépôt de réception, USAGE sur sa séquence et accès à la fonction de verrouillage. L’absence d’accès aux utilisateurs, demandes d’inscription, DELETE/TRUNCATE et DDL a été vérifiée. Les ACL de production n’ont pas été lues ni modifiées ; les noms et la configuration des rôles de laboratoire ne sont pas une prescription de credentials de production.

### Vérification visuelle

Liste, détail et textes administrables : six captures à 1440 px et 390 px ; aucune page ne dépasse horizontalement son viewport. La liste bureau et le formulaire mobile ont également été inspectés visuellement. Captures : [liste bureau](../output/postgres-validation/list-1440.png), [détail mobile](../output/postgres-validation/detail-390.png). Le générateur de captures n’a enregistré ni mot de passe ni page de remise d’identifiants temporaires.

## 5. Informations commerciales et paiement

| Information demandée | Validation |
| --- | --- |
| Anglais 100 % en ligne | Présent à l’accueil |
| Formation certifiante après trois niveaux | Mention des trois niveaux/48 séances, certificat conditionnel et aucun certificat après un seul niveau |
| 60 USD par niveau | Lu depuis Course.price/currency ; présent dans Tarifs |
| 16 séances par niveau | Lu depuis la structure historique ; présent dans Tarifs et Formations |
| Vendredi et samedi | Créneaux SQL en Friday/Saturday traduits en français |
| Cinq essais inclus dans le premier niveau | Texte précisé localement ; essais inclus dans les seize séances, pas cinq séances supplémentaires |
| Minimum 30 USD après essai | Texte ajouté par calcul de 50 % du prix courant pour une formation LEGACY_STAGED à 60 USD |
| Pas d’invention d’un minimum fixe | Test de prix à 75 USD : minimum calculé 37.50 USD ; pas de promesse d’essais/palier pour FULL_PAYMENT |

Les données de référence de cette validation sont les fixtures PostgreSQL conformes aux informations fournies par l’utilisateur, lues par les services officiels de l’application. **Elles ne prouvent pas les valeurs actuellement configurées dans le catalogue Contabo**, auquel aucun accès n’a été fait.

La règle pédagogique existante a aussi été exécutée sur les données synthétiques réelles : cinq présences PRESENT bloquent sans paiement ; 29 USD SUCCESS restent insuffisants ; 29+1 USD SUCCESS font passer à PARTIAL_ACCESS avec nextSessionLimit=10. Les paiements ont été créés directement comme fixtures de test, sans encaissement ni prestataire externe. Le calcul et les règles de paiement n’ont pas été modifiés.

Limites commerciales conservées : le paiement de 30 USD n’ouvre pas les seize séances ; il ouvre jusqu’à la dixième, puis le solde est requis. Le minimum des inscriptions existantes repose sur leur montant historique, potentiellement différent du prix courant communiqué à un prospect. L’essai historique reste calculé **par Enrollment**, sans nouvelle limitation globale de l’offre au seul premier niveau. Le texte précise l’inclusion dans le premier niveau, mais aucune règle empêchant un autre essai sur une autre inscription n’a été ajoutée. Voir aussi l’[audit du blocage pédagogique](../audit-blocage-etudiant-non-paiement.md).

## 6. Anomalies trouvées et corrections locales

### Conversions concurrentes

Avant correction : un appel concurrent échouait avec Prisma P2010, SQLSTATE 40001 (`could not serialize access due to concurrent update`). Le service ne réessayait que P2034/P2002 ; l’erreur d’une requête SQL brute échappait donc au mécanisme de reprise.

Correction dans `src/services/whatsappAdmissionService.js` : reconnaître P2010 seulement pour SQLSTATE 40001/40P01, conserver la limite de trois tentatives et renvoyer une erreur métier 409 si les conflits persistent. Les autres erreurs SQL ne sont pas assimilées à un conflit réessayable. Le test concurrent sur base neuve passe après correction et ne crée qu’une inscription.

### Communication des essais et du seuil

Avant correction : Tarifs annonçait les cinq essais sans préciser leur inclusion dans le premier niveau ; aucun montant minimum de 30 USD n’y figurait, bien que le moteur de paiement appliquât déjà 50 %.

Correction dans `src/services/whatsappAdmissionJourney.js` : préciser l’inclusion pour les formations structurées éligibles et afficher le montant à 50 % calculé avec Prisma.Decimal. Aucun changement de Course.price, d’accessPolicy, d’Attendance, de calculateTrialAccess ou des règles de délivrance des certificats.

Un test de régression a été ajouté dans `tests/whatsappAdmissions.test.js` pour 60 USD, prix modifié à 75 USD, essai inclus et exclusion du palier historique pour FULL_PAYMENT.

### Avant/après

- Première exécution métier complète : **24 réussites, 3 échecs** documentés ; fichiers `admissions-results-before-fixes.json` et `admissions-run-before-fixes.log`.
- Nouvelle base v2, après corrections : **27 réussites, zéro échec**.
- Meta durable, après préparation du SQL distinct et correction des attentes du harnais de test sur la valeur stockée APPLIED : **8 réussites, zéro échec**.

Les incidents de préparation Windows (port désormais réservé et récupération du cluster après interruption de l’environnement) ont été résolus uniquement sur le laboratoire. Ils ne constituent pas des incidents NVA en production. Les fixtures et attentes propres au harnais ont été ajustées sans relâcher les contrôles d’identité des anciennes suites PostgreSQL liées à une autre instance.

## 7. Tests, scripts et preuves

| Groupe | Résultat final | Preuve |
| --- | --- | --- |
| Parcours, dashboard, SQL, paiement réel synthétique | 27/27 contrôles | `output/postgres-validation/admissions-results.json` |
| Meta Inbox durable et rôle limité | 8/8 contrôles | `output/postgres-validation/meta-results.json` |
| Suite `test:whatsapp:release` | 372 tests réussis, zéro échec/ignoré | `output/postgres-validation/release-tests.log` |
| Compilation EJS | 163 modèles | `node scripts/validateEjs.js` |
| Vérifications visuelles | 6 pages/tailles sans débordement | `output/postgres-validation/visual-results.json` |
| Migrations | 47 appliquées, checksums correspondants | `schema-integrity.json`, `prisma-migrate-deploy-v2.log` |

Scripts ajoutés :

- `scripts/validateWhatsAppAdmissionsPostgres.js` : cible locale explicitement verrouillée, exige une base de fixtures neuve ; aucun reset automatique. L’exécution courante l’a remplie : une relance ne doit pas servir à effacer les données ou contourner cette précondition.
- `scripts/validateMetaInboxLocalPostgres.js` : nécessite le SQL Meta déjà appliqué et les ACL de réception ; nouveaux points/identités synthétiques, arrêt des points après test.
- `scripts/previewPostgresAdmissions.js` : captures contre la base isolée, identifiants en mémoire, aucune sortie de mot de passe.

Commandes utilisées pour les contrôles indépendants :

```powershell
npm.cmd run test:whatsapp:release
node scripts/validateEjs.js
node scripts/auditWhatsAppRelease.js --history output/postgres-validation/migration-history-v2.json --output output/postgres-validation
```

Les scripts PostgreSQL sont reproductibles après création/revue d’une cible de laboratoire conforme à leurs préconditions, pas contre un DATABASE_URL arbitraire. Les anciennes suites Meta/PostgreSQL attachées à un autre port, cluster et identifiant système n’ont pas été modifiées pour prétendre fonctionner ici.

Les empreintes des sources, tests, scripts, schéma et SQL validés sont conservées dans [validated-files.sha256](../output/postgres-validation/validated-files.sha256). Les rapports de tests contiennent uniquement des données synthétiques. Le dossier output, les clusters, sessions et journaux de validation ne doivent jamais entrer dans l’archive applicative de production.

## 8. Procédure recommandée avant déploiement

Le [runbook opérateur](whatsapp-production-operator-runbook.md) contient les commandes de sauvegarde PostgreSQL, transfert contrôlé, installation, audit des migrations, redémarrage ciblé et retour arrière. Les étapes suivantes complètent ce document avec les résultats de cette validation :

1. **Revoir le paquet local.** Inclure les deux corrections métier/communication et leurs tests. Exclure le laboratoire, `.env`, clés, storage, journaux et dépendances installées. L’ancienne archive admissions est marquée dépassée ; reconstruire après revue et vérifier SHA-256 avant tout transfert. Aucun push ni transfert effectué ici.
2. **Sauvegarder puis vérifier la restauration.** Effectuer le dump PostgreSQL dans un répertoire privé, contrôler son inventaire et le restaurer sur une instance distincte. Le succès sur une base neuve ne suffit pas à prouver la compatibilité d’une migration sur les données Contabo.
3. **Auditer l’existant en lecture seule.** Version PostgreSQL, identité, rôle applicatif, historique/checksums, tables, colonnes, index, triggers et ACL. Déterminer le sous-ensemble réellement en attente ; ne pas lancer aveuglément les 47 migrations sur une base existante.
4. **Traiter le SQL Meta explicitement.** Vérifier s’il est déjà appliqué ; comparer sa définition et ses protections. Si absent, faire approuver sa livraison/versionnement et ses rôles/grants par le DBA. Ne pas recréer des tables existantes, ni accorder les données métier au rôle de réception.
5. **Délimiter le drift.** Ne pas appliquer le diff global ni créer les composants Provider déclaratifs par effet de bord. Revoir les écarts FK/defaults/index et la table de sessions gérée séparément. Toute régularisation doit être une évolution revue, non un db push.
6. **Répéter sur une restauration isolée.** Installer les dépendances avec le lockfile, générer le client correspondant, appliquer seulement les migrations attendues et le SQL Meta approuvé ; reprendre parcours, concurrence, ACL, sessions et paiement. Contrôler les données officielles : trois niveaux, seize séances par niveau, 60 USD, politique LEGACY_STAGED, créneaux vendredi/samedi et périmètre de l’essai.
7. **Garder l’envoi et les workers désactivés.** Le traitement HTTP local et les appels explicites à la repository ne justifient aucune activation du runtime de production. L’activation du parcours, l’ingestion réelle, le dispatcher et les transports sont des décisions distinctes.
8. **OpenAI, si utilisé ultérieurement.** Configurer sa clé via le gestionnaire de secrets et les budgets/flags appropriés, sans l’afficher. Les tests locaux de déport hors transaction passent dans la suite de release ; aucun appel réel OpenAI ou Meta n’a été effectué dans cette validation PostgreSQL.
9. **Intervention autorisée uniquement.** Après revue, appliquer le paquet validé et redémarrer uniquement le processus NVA identifié dans le runbook, jamais tous les processus ou services communs. Contrôler dashboard et simulateurs avec canaux toujours coupés.
10. **Retour arrière.** Revenir au code précédent et à son client Prisma compatible ; conserver les tables/colonnes et données additives. Ne pas supprimer les demandes ni restaurer un dump sur la base vivante sans procédure et autorisation distinctes.

## 9. Risques résiduels et blocages

**À résoudre avant une décision de mise en production :**

- paquet exact, archive et compatibilité Linux/Node/PM2 non exercés ici ;
- historique et données réelles Contabo non examinés ; pas de répétition sur une restauration anonymisée de l’existant ;
- schéma Meta livré séparément, et drift Prisma à délimiter/faire revoir ;
- ACL et triggers du serveur cible inconnus ; les permissions du laboratoire ne les prouvent pas ;
- catalogue officiel, prix historiques des inscriptions et périmètre de l’essai à confirmer, notamment pour des niveaux ultérieurs ;
- remise des accès temporaires à organiser sans enregistrer ou envoyer le mot de passe en clair par un canal non autorisé ;
- aucune preuve de transport Meta/OpenAI réel, d’approbation de templates ou de disponibilité réseau du VPS ;
- les anomalies du blocage pédagogique déjà documentées dans l’audit séparé ne sont pas corrigées par cette mission.

**Conclusion : validation fonctionnelle locale favorable après corrections ; préparation PostgreSQL démontrée sur laboratoire. La mise en production reste conditionnée aux revues de schéma, données, permissions et paquet cible ci-dessus. Aucun déploiement ni activation n’a été effectué.**
