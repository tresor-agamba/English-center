# Validation de l’intégration PostgreSQL — chatbot NVA V2

Actualisation du 25 octobre 2026 : la [validation finale du relais Meta et des ACL](nva-whatsapp-v2-final-readiness.md) ajoute le DDL Meta complet et les vrais rôles restreints au laboratoire. Les résultats et dépendances SQL du candidat courant y sont documentés ; les blocages de connexion et limites de couverture ci-dessous sont conservés comme historique.

Dernier état : voir l’[audit de préproduction](nva-whatsapp-v2-preproduction-audit.md), incluant la sonde SQL de droits du worker, les deux nouveaux cas e-mail et les limites de couverture du DDL Meta. Les résultats ci-dessous conservent les étapes historiques ; aucune compatibilité de production n’est certifiée.

**Actualisation du circuit administratif, 24 octobre 2026 :** le [rapport administratif](nva-whatsapp-v2-admin-validation.md) complète et remplace les limites de conversion HTTP/concurrence/vérification e-mail décrites ci-dessous. Les suites finales passent : **492 tests isolés, 7 tests SQL existants et 18 tests SQL/HTTP administratifs**, zéro échec. Le laboratoire et ses 47 migrations sont inchangés ; ses droits de lecture des dépendances de confirmation/rappels ont été complétés. GO laboratoire, NO-GO production maintenu pour les prérequis explicités dans ce nouveau rapport.

## Mise à jour — laboratoire rétabli le 24 octobre 2026

**GO pour le laboratoire local et les six scénarios SQL exécutés. NO-GO pour un déploiement : la validation complète reste inachevée.** Cette mise à jour remplace la conclusion de blocage de connexion figurant dans l’audit historique conservé ci-dessous.

### Diagnostic et choix

- PostgreSQL **16.15** est disponible. L’installation sous `C:\Program Files\PostgreSQL\16` contient les exécutables mais pas `share/postgres.bki` : elle ne permettait pas d’initialiser un cluster. Une distribution portable **déjà présente** dans les téléchargements contient le catalogue complet. Aucun logiciel installé.
- Un serveur écoute sur `127.0.0.1:5432` (PID observé 16072). L’erreur **28P01** signifie que ce serveur refuse les identifiants de test configurés. Elle ne permet pas de distinguer un mot de passe obsolète, un mauvais rôle ou une autre configuration d’authentification. Aucun mot de passe ni rôle de cette instance n’a été réinitialisé.
- L’ancien laboratoire `127.0.0.1:56432` ne présente pas d’écoute et son cluster historique n’a pas de `postmaster.pid`. **ECONNREFUSED** provient de l’absence de serveur acceptant les connexions sur cet endpoint. Ce cluster n’a pas été redémarré ni modifié.
- Les inventaires de services/processus accessibles depuis le bac à sable ne fournissent pas de liste exploitable : l’absence de service Windows n’est pas démontrée. Aucun Docker CLI ni installation Docker accessible n’a été trouvé ; aucun conteneur PostgreSQL n’est attesté.
- Prisma utilise `env("DATABASE_URL")`. Le lanceur dédié ne lit pas `.env` et fournit une surcharge limitée aux processus enfants. La configuration applicative et la variable de production restent intactes.

### Laboratoire retenu

| Élément | Valeur vérifiée |
| --- | --- |
| Adresse | `127.0.0.1:58432`, écoute exclusivement en boucle locale |
| Base | `nva_whatsapp_v2_test` |
| Cluster neuf | `D:\English-center\output\nva-whatsapp-v2-postgres-20261024\cluster` |
| Moteur | PostgreSQL 16.15, binaires portables préexistants |
| Migration | `nva_v2_test_migrator`, propriétaire de cette seule base ; non superutilisateur, sans création de base/rôle ni réplication |
| Exécution | `nva_v2_test_runner`, droits DML sur les seules tables nécessaires aux scénarios ; sans création de tables, TRUNCATE ni modification des migrations |
| Authentification | SCRAM pour les deux comptes ; mots de passe aléatoires renouvelés en mémoire à chaque lancement, jamais sauvegardés |

Le compte de bootstrap `nva_v2_lab_owner` utilise `trust` uniquement en boucle locale dans ce **cluster synthétique dédié**. Cette configuration sert à recréer les comptes éphémères sans fichier de secrets ; elle n’est pas un modèle de configuration de production. Les autres connexions sont rejetées par le HBA. Aucun service système créé. Le démarrage a nécessité une exécution hors bac à sable après une erreur de jeton restreint Windows ; aucune installation ni élévation administrative du système effectuée.

### Migrations et résultats réels

Le lanceur [runNvaV2PostgresLab.js](../scripts/runNvaV2PostgresLab.js) vérifie l’adresse, le port, le rôle, le répertoire exact et l’absence de bases étrangères avant toute écriture. `prisma validate` et les **47 migrations** via `prisma migrate deploy` ont réussi. Aucun `reset`, `db push` ou seed global exécuté. Les données fictives incluent formation à trois niveaux, session de niveau 1, horaires/groupe, administrateur, prospect et étudiant ; les niveaux sont des champs/enum, pas une table indépendante.

La [suite PostgreSQL](../tests/whatsappV2Database.integration.test.js) s’exécute avec les vrais services et de vraies transactions Prisma, sans transport WhatsApp :

| Scénario SQL | Résultat |
| --- | --- |
| Catalogue, prix 60/90 USD, frais de certificat 20/12 USD, exclusion des formations non publiées | Réussi |
| Sessions/groupes disponibles ; exclusion d’une session annulée, pleine ou hors délai | Réussi |
| Parcours conversationnel, e-mail invalide puis valide, consentement daté, préférences et demande PENDING accessible aux lectures administratives | Réussi |
| Message source répété : une seule demande ; aucun Enrollment avant conversion | Réussi |
| Étudiant existant, service d’inscription partagé, unicité utilisateur/session, prix figé | Réussi |
| Session inexistante, rollback forcé, unicité SQL du message source et index unique partiel des demandes ouvertes | Réussi |

**7 tests réussis (un parent et six sous-tests), 0 échec, 0 ignoré.** Les fixtures sont annulées transactionnellement. Le contrôle final confirme zéro ligne dans les neuf tables métier inspectées et l’absence des trois privilèges interdits ci-dessus. Une seconde exécution du lanceur a également réussi, sans migration à réappliquer. Journaux expurgés et inventaires : [identité](../output/nva-whatsapp-v2-postgres-20261024/identity.json), [migrations et rôles](../output/nva-whatsapp-v2-postgres-20261024/schema-and-roles.json), [tests SQL](../output/nva-whatsapp-v2-postgres-20261024/business-tests.log), [contrôles finaux](../output/nva-whatsapp-v2-postgres-20261024/final-checks.json). Le répertoire `output` est exclu de Git.

La régression isolée a été rejouée après ces changements : **410/410** tests de release et **80/80** tests complémentaires, soit **490 réussites, 0 échec**. Preuves : [release](../output/nva-v2-lab-release.log) et [compléments](../output/nva-v2-lab-isolated-extra.log). Ces résultats sont distincts des sept tests PostgreSQL.

### Reproduction locale

Le cluster dédié reste démarré à la fin de cette intervention. Depuis la racine du projet :

```powershell
$env:NVA_V2_LAB_AUTHORIZED = 'local-new-synthetic-cluster'
node scripts/runNvaV2PostgresLab.js
Remove-Item Env:NVA_V2_LAB_AUTHORIZED
```

Pour un redémarrage ultérieur, utiliser `pg_ctl.exe` dans `C:\Users\AGAMBA tresor\Downloads\postgresql-16.15-5-windows-x64-binaries\pgsql\bin`, avec `-D` pointant exclusivement vers le cluster neuf ci-dessus, `-l` vers son fichier voisin `postgres.log`, et `-w start`. L’arrêt de ce seul laboratoire utilise le même répertoire et `-m fast -w stop`. Aucune URL secrète à fournir. Sans activation explicite, le test d’intégration reste ignoré.

### Limites et décision

Le blocage d’infrastructure est levé. Les contrôles d’administration exécutés couvrent la lecture des demandes et le service partagé d’inscription ; **ils ne valident pas encore la conversion administrative complète via HTTP**, les contrôles d’accès de ce parcours sur SQL, les effets après commit, ni les courses concurrentes de capacité entre plusieurs clients. La certification multi-niveaux et les paiements n’ont pas été validés de bout en bout sur SQL par cette suite. Les divergences métier précédemment relevées (seuil de paiement après dix séances, portée de l’essai, frais configurables, vérification de propriété de l’e-mail et horaires non renseignés) restent à arbitrer/tester. Aucun échec SQL rencontré dans les scénarios exécutés.

Corrections de cette intervention : cluster neuf à partir des binaires complets existants ; comptes séparés de migration/exécution ; lanceur à cible fixe et secrets éphémères ; garde du test acceptant le nom demandé ; fonction de diagnostic limitée au cluster pour éviter un droit global de lecture des paramètres. Aucun schéma métier ni migration applicative modifié.

**GO : laboratoire local rétabli et scénarios SQL ci-dessus. NO-GO : déploiement contrôlé tant que les validations restantes ne sont pas closes.** Aucun déploiement, accès Contabo, envoi WhatsApp réel, modification de données étudiantes ou configuration de production.

---

## Audit historique avant rétablissement — conclusions de connexion remplacées ci-dessus

Date : **24 octobre 2026**. Audit de sources, sondes de connexion en lecture seule et tests isolés. Aucun déploiement ni envoi WhatsApp réel.

## Conclusion : NO-GO

**La validation PostgreSQL réelle est bloquée.** La connexion locale de test configurée refuse l’authentification (`28P01`), et le laboratoire local historique est arrêté ou inaccessible (`ECONNREFUSED`). Aucun scénario métier n’a été exécuté sur PostgreSQL pendant cette intervention. Les résultats historiques conservés dans le workspace ne prouvent pas le comportement du code actuel sur une base accessible aujourd’hui.

Les modèles, services, contraintes déclarées et parcours administratifs ont été audités. **490 tests isolés passent**. La nouvelle suite PostgreSQL compte **0 réussite et 1 suite ignorée explicitement**, faute de laboratoire attesté. Il ne s’agit pas d’une validation SQL simulée présentée comme réelle.

Une correction applicative limitée a été effectuée : lorsqu’une formation sélectionnée n’existe plus au moment de l’enregistrement, le service retourne une erreur de validation contrôlée avant toute écriture, au lieu d’une erreur JavaScript sur un objet null. Aucune règle de facturation ni donnée historique n’a été modifiée.

## 1. Connexions effectivement tentées

Le script [probeNvaV2TestDatabase.js](../scripts/probeNvaV2TestDatabase.js) ne contacte jamais `DATABASE_URL`. Il examine seulement `TEST_DATABASE_URL`, après le garde existant de séparation des bases et une restriction aux endpoints locaux, puis l’endpoint explicite du laboratoire historique. Il impose `default_transaction_read_only=on`, des délais courts et ne contient aucun DDL/DML.

| Cible | Contrôle | Résultat actuel |
| --- | --- | --- |
| Base de test configurée | Distincte de l’identité applicative, nom conforme au garde de test, endpoint local | Authentification refusée : `28P01`. Aucune requête SQL métier exécutée. |
| Laboratoire historique | `127.0.0.1:56432`, base de laboratoire nommée explicitement dans le script | Connexion refusée : `ECONNREFUSED`. Aucun serveur de production contacté. |
| Recréation locale | Présence du catalogue de bootstrap de PostgreSQL 16 | `postgres.bki` absent au chemin standard de l’installation existante. Aucune nouvelle initialisation tentée pendant cette mission. |

Preuve : [nva-v2-database-probe.json](../output/nva-v2-database-probe.json), script terminé avec le code **2**. Les URLs, mots de passe et paramètres secrets ne sont pas publiés. Une connexion en lecture seule réussie ne suffirait d’ailleurs pas à attester une base autorisée pour des écritures : il faudrait confirmer son isolation et son identité.

Aucun redémarrage d’une instance existante, changement d’authentification, reset, création de base ou migration effectué. Les anciens essais de laboratoire décrits dans les rapports précédents restent des preuves historiques distinctes.

## 2. Modèles Prisma et relations vérifiés dans les sources

Source : [schema.prisma](../prisma/schema.prisma) et métadonnées du client Prisma généré. Les noms physiques et les contraintes ci-dessous sont des **déclarations locales**, pas un inventaire du serveur actuel.

| Domaine | Modèles/champs réels | Relations et contraintes principales |
| --- | --- | --- |
| Formations | `Course` → `courses` ; titre, slug, publication, statut LMS, structure, nombre de niveaux, séances, prix Decimal, devise, périodes tarifaires, frais de certificat, politique d’accès | Slug unique ; relations vers sessions, contenu, inscriptions, paiements et cohortes. Pas de champ générique `isActive` pour la formation : publication/archivage/fermeture et complétude déterminent sa visibilité. |
| Niveaux | `Course.numberOfLevels`, `TrainingSession.levelNumber`, enum `AcademicLevel` (`LEVEL_1` à `LEVEL_3`) ; `AcademicCohort.level` | Numéro de niveau cohérent contrôlé par `validateSessionLevel`. Le schéma ne contient pas un modèle Student ou un modèle Level supposé par le chatbot. |
| Sessions | `TrainingSession` → `training_sessions` ; formation, dates début/fin, échéance, capacité, statut, jours, heures, fuseau | FK formation avec cascade ; niveau positif déclaré dans une migration. Les dates de fin et d’échéance sont obligatoires dans Prisma. |
| Créneaux | `RegistrationGroup` → `registration_groups` ; session, nom, jours, heures, capacité, `isActive` | Nom unique dans une session ; FK session ; migrations : capacité > 0 et fin > début. L’affectation d’un groupe à la bonne session est contrôlée dans le service métier. |
| Autres horaires | `Schedule` → `schedules` | FK formation ; créneaux datés et URL éventuelle. Le parcours d’inscription utilise surtout les champs des sessions et groupes, pas cette table comme source autonome. |
| Étudiants/comptes | `User` → `users`, rôle STUDENT/ADMIN ; téléphone, e-mail optionnel, hash de mot de passe, activité, version d’authentification et changement obligatoire de mot de passe | Téléphone unique ; e-mail nullable unique. Aucun champ `emailVerified` trouvé ni mécanisme de preuve de propriété d’e-mail identifié dans les sources inspectées. |
| Inscriptions du parcours public | `Enrollment` → `enrollments` ; utilisateur, session, groupe, statut, niveau demandé/approuvé, snapshot de prix/devise, dates de paiement | Unique utilisateur/session. FK utilisateur/session ; groupe en suppression Restrict. Une capacité restante n’est pas une contrainte UNIQUE : le service doit la vérifier transactionnellement. |
| Système académique complémentaire | `AcademicCohort`, `AcademicGroup`, `AcademicEnrollment` | Inscription académique unique étudiant/cohorte ; FK avec Restrict. Ce modèle ne doit pas être confondu avec l’Enrollment utilisé par l’inscription WhatsApp existante. |
| Prospects/conversations | `WhatsAppConversation`, `WhatsAppConversationMessage` | Conversation unique par téléphone ; état JSON persistant ; messages et clés de déduplication ; relations vers compte, conseiller et demandes. |
| Demandes WhatsApp | `WhatsAppAdmissionRequest` | FK conversation Restrict ; `sourceMessageId` unique ; consentement daté/versionné ; liens d’attribution et de conversion vers User et lien optionnel Enrollment. Les préférences formation/session/groupe sont conservées dans les événements JSON, pas dans des colonnes relationnelles de la demande. |
| Validation administrative | `WhatsAppAdmissionEvent`, liens `assignedAdminId`, `convertedById`, `enrollmentId` | Historique relié à la demande, acteur éventuel, action et métadonnées ; pas de second modèle administratif créé. |
| Paiements du parcours public | `Payment` | Référence unique ; Decimal ; statut, montant, devise, snapshot de tarification ; FK inscription et formation. |
| Facturation académique complémentaire | `FeeConfiguration`, `StudentInvoice`, `StudentInvoiceLine`, `StudentPayment`, `PaymentReceipt` | Facture numérotée unique, type de ligne unique par facture, clé d’idempotence de paiement unique et reçu unique par paiement. À distinguer de Payment pour le calcul d’accès du parcours public. |
| Certification | `CertificateSettings`, `CertificateRequest`, `CertificatePayment`, `Certificate`, `LessonProgress` | Demande et paiement de certificat liés à une inscription ; conditions académiques et émission administrative distinctes. Frais configurables aux niveaux session/formation/général. |

### Contraintes SQL absentes de la seule représentation Prisma

La migration locale [20261022120000_add_whatsapp_admission_requests](../prisma/migrations/20261022120000_add_whatsapp_admission_requests/migration.sql) déclare notamment :

- CHECK des niveaux demandés, de la source WHATSAPP et des quatre statuts de demande ;
- cohérence `(status = ENROLLED) = (enrollmentId IS NOT NULL)` ;
- **index unique partiel** autorisant au plus une demande PENDING/PROCESSING par conversation ;
- unicité du message source et clés étrangères avec les règles de suppression explicites.

L’index partiel et les CHECK ne doivent pas être supposés installés simplement parce que le modèle Prisma existe. Ils doivent être vérifiés dans les catalogues PostgreSQL du laboratoire, puis de la cible autorisée. Aucun `db push` ni diff global n’a été appliqué.

### Enum de session : anomalie importante de fixture

Les valeurs réelles sont **DRAFT, OPEN, FULL, ONGOING, COMPLETED, CANCELLED**. `TrainingSessionStatus.CLOSED` n’existe pas. Une clôture d’inscription peut aussi résulter d’une échéance dépassée : CLOSED est alors un état calculé du service, pas une valeur de la colonne.

Certains tests historiques en mémoire utilisent `status:'CLOSED'`. Ils vérifient bien le refus d’une valeur différente de OPEN, mais cette fixture ne peut pas être insérée telle quelle via Prisma. La nouvelle suite PostgreSQL utilise CANCELLED et une échéance passée. Le même contrôle confirme `DurationUnit.WEEKS`, et non WEEK.

## 3. Services métier partagés et comparaison des données

| Usage | Services réellement réutilisés | Constat de code |
| --- | --- | --- |
| Catalogue public | `publicCourseService.listPublished(tx)`, `coursePublicationPolicy.isPublicCourse` | Les mêmes filtres de publication et de complétude alimentent l’application et le chatbot ; les frais de certificat et fenêtres tarifaires figurent dans la projection publique. |
| Sessions ouvertes | `registrationService.listSessionsForPublicRegistration(tx)` | Session OPEN, date future, échéance non dépassée, formation publiée, niveau compatible et capacité. Le nombre de places utilise les seuls statuts occupants. |
| Session sélectionnée | `getSessionForRegistration`, `validateSession`, `validateGroup` | Nouvelle lecture et validation ; cohérence niveau/formation, session et groupe vérifiée. |
| Présentation commerciale | `whatsappCommercialPolicy`, `whatsappCommercialResponder` | Résolution du produit explicite ou du contexte ; tarif actif de ce produit ; clarification si plusieurs produits correspondent. Conditions anglaises limitées au parcours identifié. |
| Demande | `whatsappAdmissionService.recordConfirmed(tx, input)` | Identité, consentement/version, doublons et préférence session/groupe ; écriture dans la transaction du traitement entrant. |
| Conversion administrative | `createAdmissionService().convert`, `registrationService.createRegistrationInTransaction` | Service d’inscription existant, isolation Serializable, verrou destinataire/demande, vérifications de compte, places et groupe ; rollback et reprise limitée sur conflits. |
| Accès pédagogique | `trialAccessService`, `courseStructureService.accessLimits`, `enrollmentPolicy` | Calcul depuis les inscriptions, présences et paiements confirmés ; ce n’est pas le texte du chatbot qui applique les blocages. |
| Certificat | `certificateService.academicEligibility`, `applicableFee`, `issue` | Achèvement des niveaux configurés pour le même étudiant et la même formation ; frais applicables et émission administrative vérifiés séparément. |

La composition de `whatsappConversationService` transmet le même client transactionnel Prisma aux services de catalogue et de session. Il n’existe pas de deuxième catalogue WhatsApp ni de deuxième service d’inscription ajouté pour cette mission.

**Comparaison effective des valeurs retournées par des requêtes SQL : bloquée.** Seule la convergence des appels de services et des projections a pu être vérifiée dans le code et les tests isolés.

## 4. Parcours d’inscription et sécurité

Le parcours existant couvre M’inscrire → choix site/WhatsApp → consentement de collecte → identité → formation → session/groupe → récapitulatif → confirmation explicite → demande PENDING. Le service revalide la disponibilité avant la demande et lors de la conversion.

La transaction entrante enregistre demande, événement, notification interne, état de conversation et réponse sortante. La réponse reprend le statut réellement retourné. Une demande PENDING/PROCESSING ne devient pas une inscription ENROLLED par la seule confirmation du prospect. La conversion exige une action administrative confirmée et utilise le service existant de création/réutilisation d’inscription.

Le contrôleur administratif produit un secret aléatoire, le hache via `passwordService` et impose le changement du mot de passe d’un nouveau compte. Le chatbot ne transmet aucun mot de passe. L’interface administrative existante peut présenter un mot de passe temporaire au seul administrateur après création ; il n’est pas envoyé automatiquement par WhatsApp.

Pour un étudiant existant, le service contrôle rôle, activité, doublon d’inscription et propriétaire de l’e-mail, puis peut mettre à jour les coordonnées. **L’unicité et le format d’un e-mail ne prouvent pas sa propriété.** Aucun défi de vérification d’adresse n’a été identifié dans ce parcours. Il ne faut donc pas présenter la vérification de propriété de l’e-mail comme validée. La demande reste une étape administrative ; l’identité et toute modification d’un compte existant exigent un contrôle approprié avant traitement réel.

### Administration réutilisée

Les routes existantes sous `/admin/whatsapp/admissions` permettent liste, détail, attribution, correction, annulation et conversion. Les vues `admissions.ejs` et `admission.ejs` montrent la demande et son historique/préférence. Elles n’ont pas été remplacées.

`requireAdmin` refuse un rôle incorrect ou inactif et exige le changement du mot de passe lorsque nécessaire. L’application applique la protection CSRF avant ces routes ; le service vérifie à nouveau l’acteur de conversion et d’attribution. Les tests HTTP existants couvrent ces contrôles sur serveur local avec services simulés. **Consultation et conversion HTTP reliées à une vraie base : non validées ici.**

## 5. Scénarios PostgreSQL préparés et statut réel

La suite [whatsappV2Database.integration.test.js](../tests/whatsappV2Database.integration.test.js) est désactivée par défaut. Elle ne charge pas `.env`, n’applique pas de migration, n’exécute pas de reset et ne contacte pas Meta. Une activation explicite exige :

- une URL dédiée `NVA_V2_DATABASE_TEST_URL`, sur `127.0.0.1` et un port non standard différent de 5432 ;
- une base nommée `nva_v2_database_test_…`, sans surcharge de connexion dans l’URL ;
- `NVA_V2_DATABASE_EXPECTED_DIRECTORY`, sous `output`, correspondant au répertoire réel retourné par PostgreSQL ;
- `NVA_V2_DATABASE_TESTS_ENABLED=true` après attestation du laboratoire ;
- une base migrée et dépourvue des données métier contrôlées par le garde. La suite refuse de nettoyer une base existante pour contourner cette condition.

Les fixtures sont créées dans des transactions Serializable qui provoquent volontairement un rollback ; les compteurs des tables concernées sont ensuite comparés à zéro. Le test d’unicité laisse PostgreSQL annuler la transaction en erreur. Les séquences PostgreSQL peuvent avancer malgré le rollback : ce comportement ne constitue pas une donnée métier parasite. **Ce mécanisme de nettoyage est préparé mais n’a pas été observé sur une vraie base pendant cette mission.**

| Scénario demandé | Préparation / preuve disponible | Exécution SQL actuelle |
| --- | --- | --- |
| Formation active/inactive | Nouvelle suite : catalogue, prix propres, projection de certificat et exclusion d’une formation non publiée | Bloquée |
| Session ouverte/annulée/échéance passée | Nouvelle suite : services publics et dates des fixtures | Bloquée |
| Session complète | Nouvelle suite : capacité nulle ; tests existants en mémoire sur places/groupe complets | Bloquée |
| Session sans horaire | Audit : valeurs par défaut `00:00`, jours vides possibles ; contrôle de présentation isolé à étendre, ne pas les présenter comme un créneau confirmé | Non préparé comme assertion SQL complète ; bloqué |
| Tarif absent | `isPublicationReady` exclut une formation sans tarif actif positif ; tests isolés du bot répondent sans inventer de prix | SQL à compléter, bloqué |
| Nouvelle demande / consentement / e-mail invalide | Nouvelle suite : parcours réel du moteur jusqu’au service de demande, refus du mauvais e-mail, aucune demande avant confirmation | Bloquée |
| Prospect déjà enregistré / doublon | Nouvelle suite : même source rejouée, demande unique ; test direct de contrainte UNIQUE | Bloquée |
| Étudiant existant | Nouvelle suite : service partagé réutilisant compte et inscription, snapshot tarifaire | Bloquée |
| Administration : liste/détail | Nouvelle suite : vraies requêtes du service après création de demande ; tests HTTP isolés existants | Bloquée |
| Conversion administrative et concurrence réelle | Workflow audité, tests isolés existants ; les anciennes validations de laboratoire ne sont pas rejouées automatiquement | À rejouer/étendre sur laboratoire ; bloquée |
| Échec de transaction / absence de résidus | Nouvelle suite : rollback volontaire et erreur métier ; compteurs après rollback | Bloquée |
| Refus de consentement | Tests isolés existants ; aucune écriture de demande ni compte | SQL à compléter, bloqué |
| Erreur de connexion | Deux tentatives réelles en lecture seule | Observée : `28P01` et `ECONNREFUSED` |

Les six sous-scénarios de la nouvelle suite sont du code préparé, pas six tests PostgreSQL réussis. Les deux contraintes d’unicité sont isolées : source identique sur des demandes annulées pour éviter l’index partiel, puis sources différentes sur deux demandes ouvertes pour tester cet index. La racine a été **ignorée** faute de configuration attestée ; son exécution réelle devra aussi révéler d’éventuels défauts de fixture ou de requête. L’ensemble de la matrice devra être complété avant GO, notamment concurrence et workflow administratif transactionnel complet.

## 6. Règles de paiement : discours et système effectif

| Règle officielle anglais | Discours du bot | Implémentation de gestion auditée |
| --- | --- | --- |
| 60 USD par niveau | Annoncé pour le parcours anglais lorsque le tarif publié correspond ; autres produits distincts | Snapshot `expectedTotalAmount` depuis le prix réel de session/formation ; montant historique conservé par inscription. Valeurs réelles de la cible non lues. |
| 16 séances de 1 h 30 | 16 séances, 24 heures par niveau ; trois niveaux, 72 heures | Séances et limites configurées ; horaires réels provenant de session/groupe. La durée de 1 h 30 ne doit pas être déduite d’un horaire non renseigné. |
| Cinq premières séances gratuites incluses au niveau 1 | Présent, onze séances restantes ; pas de promesse sous FULL_PAYMENT | LEGACY_STAGED donne cinq séances d’essai. `accessLimits` ne limite pas à lui seul cette gratuité au niveau 1 ; comportement après placement/niveaux supérieurs à vérifier. |
| Minimum 30 USD à partir de la sixième séance | Présent, 50 % de 60 USD | Après cinq présences, moins de 50 % bloque l’accès. Paiements confirmés filtrés par devise et formation. |
| Solde avant la fin du niveau | Présent | **Divergence de précision : après dix séances, `trialAccessService` exige le paiement intégral et bloque sinon.** C’est plus strict que la seule limite avant la seizième séance. Aucun seuil n’a été modifié automatiquement. |
| Certificat après trois niveaux | Présent | Le service vérifie les niveaux configurés et les progressions de la même personne/formation ; nouvelle requête SQL non exécutée ici. |
| Certificat : 20 USD en supplément | Présent pour le parcours anglais identifié | `applicableFee` choisit session, puis formation, puis configuration générale ; configuration par défaut gratuite possible. Les 20 USD doivent être confirmés dans le paramétrage réel. |

Le système académique complémentaire de factures/paiements ne doit pas être assimilé au `Payment` lu par le calcul historique d’accès. Aucun rapprochement de valeurs réelles, aucune correction de montant historique, aucune modification de frais ou politique d’accès effectués.

## 7. Anomalies et corrections

| Point | Conclusion |
| --- | --- |
| Formation supprimée entre sélection et confirmation | **Corrigé localement** : contrôle null explicite dans `recordConfirmed`, erreur 400 avant écriture. Nouveau test isolé réussi. |
| Fixtures de session CLOSED et de durée WEEK | Valeurs incompatibles avec les enums Prisma ; nouvelle suite utilise CANCELLED, échéance passée et WEEKS. Les tests historiques en mémoire ne constituent pas une validation de ces enums sur PostgreSQL. |
| Contraintes SQL spécifiques | Index partiel et CHECK présents dans la migration, non confirmés dans une base actuelle. Blocage de compatibilité. |
| Propriété de l’adresse e-mail | Aucun mécanisme de vérification identifié dans ce parcours ; ne pas revendiquer une validation d’identité à partir du format ou de l’unicité. Contrôle à définir/confirmer avant activation réelle. |
| Paiement intégral après dix séances | Divergence entre formulation commerciale et contrôle d’accès effectif ; décision métier et test nécessaires, sans changement automatique. |
| Frais/éligibilité de certificat | Le discours officiel et les paramètres réels ne sont pas encore rapprochés sur une base ; requête multi-niveaux à valider réellement. |
| Demande = préférence, pas réservation | Une demande n’occupe pas de place ; disponibilités revérifiées lors de la conversion. Cela doit rester explicite pour les prospects et l’administration. |
| Créneau non renseigné | Les chaînes `00:00` sont non vides ; la présentation actuelle peut les afficher sans prouver un vrai créneau. Validation/préparation complémentaire requise. |

## 8. Tests exécutés pendant cette intervention

| Vérification | Résultat | Preuve |
| --- | --- | --- |
| Sonde PostgreSQL en lecture seule | Deux cibles indisponibles ; code 2 | [résultats](../output/nva-v2-database-probe.json) |
| Suite PostgreSQL ajoutée | **0 pass, 0 fail, 1 skipped** ; aucun sous-scénario exécuté | [journal](../output/nva-v2-database-integration.log) |
| Régression WhatsApp existante | 410/410 | [journal](../output/nva-v2-database-release.log) |
| Parcours fonctionnels et fiabilité isolés | 25/25 | [journal](../output/nva-v2-database-scenarios.log) |
| Contrats et régressions complémentaires | 55/55, dont trois nouveaux contrôles de contrat | [journal](../output/nva-v2-database-extra-contracts.log) |
| Syntaxe des nouveaux scripts/tests | Vérifiée par `node --check` | Contrôle local |

**Total isolé : 490 réussites, aucun échec. Ce total n’inclut aucune réussite PostgreSQL.** La suite globale nécessitant une base n’a pas été relancée avec un reset : les sondes ont déjà établi le blocage, et aucune base n’a été réinitialisée.

Reproduction sans écriture :

```powershell
node scripts/probeNvaV2TestDatabase.js
node --test tests/whatsappV2Database.integration.test.js
npm.cmd run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappV2DatabaseContracts.test.js
```

La deuxième commande doit rester skipped sans activation explicite. Une future exécution d’intégration exige les variables dédiées décrites en section 5, fournies par le gestionnaire prévu ; ne pas copier d’URL avec mot de passe dans un rapport, un argument de commande ou le chat. Le rôle de diagnostic du laboratoire doit pouvoir lire son identité et son répertoire ; aucun droit de production n’est demandé ici. Préparer les migrations uniquement sur ce laboratoire, selon la procédure existante revue, sans exécuter `npm test`/reset sur une base contenant des données à conserver.

## 9. Fichiers de cette mission

- Créés : `scripts/probeNvaV2TestDatabase.js`, `tests/whatsappV2Database.integration.test.js`, `tests/whatsappV2DatabaseContracts.test.js`, ce rapport et les preuves `output/nva-v2-database-*`.
- Modifié : `src/services/whatsappAdmissionService.js`, uniquement le contrôle d’existence de formation avant validation.
- Aucun schéma, migration, paramètre de production, token, worker, configuration PM2 ou envoi modifié.

## 10. Conditions avant GO

1. Fournir un laboratoire PostgreSQL isolé accessible, confirmer identité, répertoire, rôle, absence de données réelles et migrations réellement installées. Ne pas réutiliser les anciens résultats comme preuve actuelle.
2. Exécuter la nouvelle suite puis compléter/rejouer tous les scénarios de la matrice sur PostgreSQL : vrais conflits, rollback, index partiel, disponibilité concurrente, consentement refusé et conversion administrative avec contrôles d’accès.
3. Vérifier que les fixtures sont toutes annulées/nettoyées, puis tester le parcours HTTP d’administration avec la base de laboratoire.
4. Arbitrer la vérification des coordonnées/identité, le seuil de dix séances, la portée de l’essai au niveau 1, les horaires et les frais de certificat. Ne pas modifier les historiques de facturation pour aligner un texte.
5. Reprendre l’[audit de compatibilité Contabo](audit-final-compatibilite-nva-20261023.md) avant toute préparation de déploiement autorisée ; aucun contrôle de production n’a été effectué ici.

**NO-GO maintenu : intégration réelle non validée faute de connexion isolée disponible. Aucun message WhatsApp réel, déploiement sur Contabo ou changement de données d’étudiants réels.**
