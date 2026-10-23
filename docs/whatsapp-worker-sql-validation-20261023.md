# Validation SQL du correctif WhatsApp NVA — 23 octobre 2026

**NON PRÊT POUR LA PRODUCTION.** La validation locale des droits est réussie. La compatibilité du serveur Contabo reste **BLOCKED**, faute d'observation de son schéma, de son historique et de ses ACL. Aucun accès à Contabo ou à sa base, migration de production, envoi WhatsApp réel, déploiement, push GitHub ou modification NovanceTech effectué.

Ce rapport complète et actualise [le diagnostic du correctif](whatsapp-auto-reply-diagnostic-20261023.md) et [l'audit de compatibilité](audit-final-compatibilite-nva-20261023.md). Les preuves locales ne certifient pas la structure actuelle de production.

## Résultats PASS / FAIL / BLOCKED

| Statut | Vérification | Résultat |
|---|---|---|
| **PASS** | PostgreSQL réel isolé | PostgreSQL 16.15, nouvelle instance locale, écoute exclusivement `127.0.0.1:55432`, base fictive `nva_whatsapp_test`. Identité, port, utilisateur et chemin physique vérifiés avant toute préparation. |
| **PASS** | Migrations locales | 47 migrations appliquées sur cette nouvelle base ; checksums identiques aux 47 fichiers actuels, aucune migration inachevée ou annulée. Aucun fichier de migration historique modifié. |
| **PASS** | Structure Meta locale | DDL canonique externe appliqué en transaction : 86 colonnes, 22 contraintes PK/UNIQUE/FK/CHECK, 25 index valides, sept triggers actifs. Les trois contraintes de trigger différé apparaissent en plus dans `pg_constraint`, soit 25 lignes dans ce catalogue. |
| **PASS** | Worker restreint | Traitement réel, réponses QUEUED, soumission simulée, admission et reconfirmation, notifications IN_APP, STOP, conseiller, callbacks des trois circuits et reprise après redémarrage réussis sans superuser ni rôle hérité. |
| **PASS** | Restrictions SQL | Refus effectif des accès aux hashes de mot de passe, paiements pédagogiques, sessions HTTP, écritures utilisateurs/inscriptions/paiements, conversion administrative, modification des templates, activation d'endpoint, insertion d'événement, modification de son payload, DELETE/TRUNCATE et DDL/TEMP. |
| **PASS** | Réception Meta | Script et runtime ingress de production inchangés. Réception signée avec rôle ingress restreint ; refus d'accès métier, aux champs de claim, à l'activation du traitement, au rôle worker, au DDL/TEMP et à DELETE. Aucun rôle métier accordé à ingress. |
| **PASS** | Dates non UTC | Défaut découvert et corrigé ; sélection des réponses récentes et récupération des soumissions anciennes validées avec le fuseau PostgreSQL `Africa/Lagos`, sans changer le fuseau du cluster. |
| **PASS** | Sessions HTTP locales | Table `http_sessions`, colonnes `sid/sess/expire` et index d'expiration conservés. Aucun accès accordé au worker ou à ingress, aucune valeur de session affichée. |
| **PASS** | Configuration | Les huit drapeaux d'activation historiques et nouveaux sont `false` dans `.env.example`. Tests de refus avant connexion, autorisations séparées, cible/identité SQL, conflit avec les anciens workers et seuil UTC. |
| **PASS** | Tests finaux | **41 contrôles PostgreSQL réels réussis** et **399 tests locaux réussis**, zéro échec/ignoré dans la suite finale. Trois scripts de diagnostic lecture seule exécutés avec succès sur le laboratoire. |
| **FAIL** | Alignement strict global Prisma / base reconstruite | Diff non vide : six tables Provider proposées, suppression de `http_sessions`, 37 reconstructions de FK et sept suppressions de defaults, plus écarts d'index. Le diff global n'est pas un script de déploiement sûr. |
| **BLOCKED** | Schéma/historique/ACL Contabo | Non interrogés ; les constats locaux ne disent pas quels objets, droits ou migrations existent réellement sur le VPS. |
| **BLOCKED** | Catalogue et services réels | Prix, horaires, sessions ouvertes, fuseaux, données historiques, processus réellement actifs, réseau et identifiants Meta de production non vérifiés. |
| **BLOCKED** | Recette WhatsApp réelle | Non exécutée conformément aux contraintes. À faire uniquement après levée des autres blocages et autorisation explicite d'envoi. |

Les deux défauts initiaux corrigés sont les grants excessifs et les comparaisons de dates. Ils ne sont plus des échecs des tests finaux. Le **FAIL d'alignement global** ci-dessus reste une limite réelle de l'usage de Prisma pour générer un changement automatique de schéma.

## Vérification des privilèges et corrections

Le script [meta-inbox-production-worker-role.sql](sql/meta-inbox-production-worker-role.sql) a été exécuté dans le laboratoire après substitutions **uniquement** de la base, du port et du nom de rôle. Les grants et les contrôles SQL restent identiques. La version finale complète a aussi provisionné un rôle de contrôle NOLOGIN distinct ; son empreinte figure dans `output/meta-worker-postgres/final-sql-evidence.json`. Ce rôle de contrôle n'est jamais utilisé par le worker.

La création du rôle est transactionnelle, refuse un rôle déjà existant et conserve NOLOGIN jusqu'au provisionnement séparé des accès. Le rôle worker réel de test est LOGIN, NOINHERIT, sans membership, propriété d'objet, superuser, CREATE/TEMP, DELETE/TRUNCATE, REFERENCES ou TRIGGER. Les secrets fictifs utilisés pour les URL de test ne correspondent à aucun compte de production. Les clés de chiffrement de test sont des constantes de fixture ; aucune clé existante n'a été lue ou régénérée.

Réductions apportées au script :

- Retrait d'UPDATE sur `notifications` : le parcours crée une notification et retrouve l'existante sans la modifier ; vérifié avec la reconfirmation réelle d'une admission.
- UPDATE par colonne sur `WhatsAppAdmissionRequest` : uniquement identité, niveau demandé, consentement et `updatedAt`. Le worker ne peut pas marquer une inscription ENROLLED ou affecter un administrateur.
- UPDATE par colonne sur conversations/messages : état du moteur, traitement et livraison ; aucune modification de l'identité du message ou du numéro de conversation existant.
- UPDATE limité sur préférences : révocation du consentement ; sur relances/livraisons : annulations STOP et callbacks, sans modification de template ni création de livraison de notification.
- Budget IA : SELECT/INSERT et UPDATE de `calls` seulement. L'IA reste désactivée pendant cette validation et n'est pas activée par le correctif.
- Refus des accès hérités via PUBLIC aux objets étrangers au périmètre et des privilèges de séquences excessifs. Aucun REVOKE global PUBLIC n'est proposé pour la production. Les restrictions PUBLIC nécessaires au laboratoire ont été appliquées seulement à sa nouvelle base fictive.

SELECT reste nécessaire sur les lignes renvoyées par les services Prisma existants ; les utilisateurs ont une sélection par colonne excluant le hash de mot de passe. INSERT est limité à des tables métier précises. Ces grants ne constituent **pas** une politique RLS de restriction des lignes : la légitimité des transitions, du destinataire et du scope repose également sur les services, transactions, triggers et barrières existants. Les fonctions SECURITY DEFINER accessibles et les rôles hérités du serveur doivent être examinés séparément. Ne pas promettre qu'un compte SQL compromis ne pourrait modifier que les lignes d'une conversation donnée.

Les messages sortants restent limités aux réponses automatiques et accusés de transfert du même endpoint. Les notifications créées sont IN_APP ; les relances, réponses manuelles et notifications WhatsApp restent exclues de l'envoi de ce worker. Les callbacks peuvent néanmoins mettre à jour les trois circuits existants afin de préserver la compatibilité.

## Défaut révélé par PostgreSQL réel : fuseaux et dates

Dans `src/services/metaInboxWorkerService.js`, les colonnes Prisma `created_at` et `updated_at` des messages sont des `timestamp without time zone` représentant les dates UTC de l'application. Les événements Meta utilisent `timestamptz`. La comparaison brute des colonnes de message avec les paramètres Date faisait intervenir le fuseau de la session PostgreSQL. Une réponse récente pouvait rester QUEUED ; la récupération des anciens PROCESSING pouvait aussi être décalée.

Les trois comparaisons brutes sur les dates de messages convertissent désormais explicitement le paramètre via `::timestamptz AT TIME ZONE 'UTC'`. Les comparaisons sur les événements restent en timestamptz. Le laboratoire a confirmé l'envoi simulé d'une réponse récente et la récupération d'un message ancien sans marquer le récent comme abandonné. Aucune conversion des données ni modification globale du fuseau PostgreSQL n'a été effectuée.

Autre correction : les drapeaux historiques sont normalisés avec `trim().toLowerCase()` dans la configuration du worker, conformément au runtime Meta. La valeur ` TRUE ` est refusée aussi en test.

## Preuves et reproduction locale

Fichiers ajoutés : `scripts/prepareMetaWorkerPostgresLab.js`, `scripts/validateMetaWorkerPostgresLab.js`, `deploy/whatsapp-chatbot/05-contabo-readonly-worker.sql` et ce rapport.

Fichiers modifiés : SQL du rôle worker, `src/services/metaInboxWorkerService.js`, `src/config/metaInboxWorkerConfig.js`, `tests/metaInboxWorker.test.js`, note de suivi dans le rapport précédent. Aucune migration ni configuration réelle modifiée ; `.env.example` est seulement vérifié pendant cette étape.

Les scripts de laboratoire ne chargent pas `.env`, n'acceptent aucune URL de base externe et exigent l'opt-in suivant :

```powershell
$env:NVA_META_WORKER_LAB='isolated-worker-validation'
# Une seule fois, sur un cluster NEUF déjà démarré au chemin fixe attendu :
node scripts/prepareMetaWorkerPostgresLab.js
if ($LASTEXITCODE -ne 0) { throw 'Préparation isolée refusée' }
# Réexécutable : conserve les données fictives et désactive les anciennes fixtures.
node scripts/validateMetaWorkerPostgresLab.js
if ($LASTEXITCODE -ne 0) { throw 'Validation isolée échouée' }
npm.cmd run test:whatsapp:release
if ($LASTEXITCODE -ne 0) { throw 'Tests locaux échoués' }
```

Chemin fixe du cluster : `D:\English-center\output\meta-worker-postgres\cluster`. Administrateur fictif : `nva_worker_lab_owner`. La préparation refuse tout autre chemin physique, rôle, port, hôte ou toute base préexistante en dehors de `postgres`. Elle n'est pas un script pour Contabo. La validation bloque les appels réseau et le client Prisma applicatif par défaut. L'appel Cloud utilise le service existant avec transport simulé ; un contrôle vérifie l'absence de transaction SQL du worker pendant cet appel.

Preuves locales ignorées par Git :

- `output/meta-worker-postgres/results.json` et `integration.log` : 41 PASS.
- `output/meta-worker-postgres/release-tests.log` : 399 PASS.
- `output/meta-worker-postgres/setup.json` : historique et cible isolée.
- `output/meta-worker-postgres/final-sql-evidence.json` : empreinte du SQL final testé.
- `output/meta-worker-postgres/readonly-structure.log`, `readonly-catalog.log`, `readonly-worker.log` : diagnostics testés.
- `output/meta-worker-postgres/schema-diff.txt`, `schema-diff-summary.json` : comparaison fraîche.
- `output/meta-worker-postgres/schema-diff-DO-NOT-APPLY.sql` : **analyse seulement, ne jamais appliquer**.

Le cluster a été arrêté proprement après validation. `output/meta-worker-postgres/final-validation.json` conserve les résultats, les empreintes des fichiers validés et la confirmation de cet arrêt. Les anciennes traces d'échecs intermédiaires ne remplacent pas les résultats finaux : les 41 contrôles ont été réexécutés avec succès après correction.

## Écarts Prisma susceptibles de bloquer Contabo

La reconstruction fraîche confirme les écarts de l'audit précédent :

| Écart | Risque / décision |
|---|---|
| Meta présent dans `schema.prisma`, absent des 47 migrations | `migrate deploy` seul ne crée pas les objets Meta. Vérifier tables, contraintes, index partiels, fonctions et triggers réels. Ne pas rejouer le DDL complet sur des objets existants. |
| Six modèles Provider hors historique | Tables manquantes si ces composants sont activés. Ce worker Meta ne les utilise pas. Ne pas les introduire implicitement via un diff global. |
| `http_sessions` hors Prisma | Le diff propose DROP TABLE : risque de perte des sessions et d'échec d'authentification. Préserver la table, sa clé, son index d'expiration et les droits de l'application. |
| Six FK admissions avec ON UPDATE différent | Fonctionnement vérifié avec identifiants immuables, mais pas alignement strict. Toute modification éventuelle doit être additive, versionnée et revue ; aucune édition de migration historique. |
| 37 reconstructions de FK au total | Risques de verrous et de changement de cascades sur les domaines académique/financier. Hors correction automatique du chatbot. |
| Sept defaults et plusieurs index divergents | Ne pas supprimer automatiquement les defaults. Préserver l'index partiel des leçons ; comparer ses colonnes/prédicats, pas seulement le nom. |
| Dates timezone / sans timezone | Comparaisons du worker corrigées ; vérifier les types et réglages réels, ainsi que la provenance des dates historiques. Ne pas réécrire ces données automatiquement. |

Aucune nouvelle migration n'est nécessaire pour le code du worker lui-même. Des migrations applicatives déjà présentes dans le dépôt peuvent manquer sur Contabo : **impossible à déterminer sans son historique**. Ne pas employer `db push`, `migrate reset`, `migrate dev` ou exécuter le diff généré en production.

## Commandes Contabo de diagnostic uniquement

À préparer puis exécuter manuellement par l'opérateur, **pas exécutées ici**. Les trois fichiers doivent être disponibles dans un répertoire de diagnostic séparé du dossier actif. Si l'instance n'est pas accessible par socket local sous `postgres`, arrêter et faire adapter la connexion par le DBA, sans afficher d'URL ou de mot de passe.

```bash
set -euo pipefail
umask 077
read -r -p 'Répertoire absolu contenant les scripts de diagnostic : ' NVA_DIAG_DIR
read -r -p 'Nom du rôle SQL applicatif NVA, sans mot de passe : ' NVA_APP_ROLE
test -f "$NVA_DIAG_DIR/03-contabo-readonly-structure.sql"
test -f "$NVA_DIAG_DIR/04-contabo-readonly-catalog.sql"
test -f "$NVA_DIAG_DIR/05-contabo-readonly-worker.sql"

sudo -u postgres psql -X --dbname=english_center --set=ON_ERROR_STOP=1 \
  --set=expected_database=english_center --set=nva_app_role="$NVA_APP_ROLE" \
  --set=nva_ingress_role=nva_meta_inbox_ingress_prod \
  --file="$NVA_DIAG_DIR/03-contabo-readonly-structure.sql"

sudo -u postgres psql -X --dbname=english_center --set=ON_ERROR_STOP=1 \
  --set=expected_database=english_center \
  --file="$NVA_DIAG_DIR/04-contabo-readonly-catalog.sql"

sudo -u postgres psql -X --dbname=english_center --set=ON_ERROR_STOP=1 \
  --set=expected_database=english_center --set=nva_app_role="$NVA_APP_ROLE" \
  --set=nva_ingress_role=nva_meta_inbox_ingress_prod \
  --set=nva_worker_role=nva_meta_inbox_worker_prod \
  --file="$NVA_DIAG_DIR/05-contabo-readonly-worker.sql"
```

Le premier script vérifie historique/checksums, structure, objets Meta et ACL existantes. Le deuxième lit uniquement le catalogue officiel, les horaires, les sessions et agrégats de disponibilité. Le troisième ajoute les droits effectifs du worker et d'ingress, les permissions par colonne/séquence, les fonctions privilégiées accessibles, les métadonnées des sessions HTTP et les types/fuseaux des dates. Tous utilisent une transaction READ ONLY, des délais et un contrôle de la base attendue. Ils ne démarrent pas NVA, ne chargent pas ses secrets et ne lisent pas les coordonnées ou messages clients.

Un rôle absent est une information à examiner, pas une invitation à le créer immédiatement. Comparer les résultats à la version locale testée. Les droits applicatifs sur `http_sessions` doivent permettre le stockage existant ; ni ingress ni worker ne doivent accéder à cette table. Ne pas partager `.env`, URL SQL, configuration PM2 complète, contenu des sessions, dump ou logs de messages.

## Plan de déploiement progressif — sous autorisations distinctes

1. **Diagnostic sans modification.** Exécuter les commandes ci-dessus ; vérifier le rôle applicatif, l'historique/checksums, le SQL Meta complet, les sessions HTTP, le catalogue, le fuseau et l'absence de consommateur concurrent. Examiner les résultats avant toute décision. Tant que ces points ne sont pas résolus, rester NON PRÊT.
2. **Sauvegarde et répétition.** Après autorisation de préparation, suivre la sauvegarde du [runbook opérateur](whatsapp-production-operator-runbook.md), section 3 : dump custom, schéma, historique Prisma, code et configuration privée hors Web. Vérifier les empreintes et restaurer le dump dans une instance isolée. Répéter les contrôles du worker sur cette restauration anonymisée, sans réseau Meta. Ne pas afficher les données du dump ni restaurer les rôles d'autres applications.
3. **Release isolée et droits.** Préparer un nouveau candidat contenant cette correction, vérifier son empreinte, installer ses dépendances et générer Prisma hors dossier actif. Relancer les tests. Faire approuver chaque migration réellement manquante et les éventuels ajustements SQL séparément. Le script du rôle worker est désormais validé localement, mais refuse d'écraser un rôle existant : auditer ce rôle et établir un correctif spécifique si nécessaire. Aucun élargissement du rôle ingress. Provisionner les secrets du worker via saisie privée, sans rotation des clés Meta.
4. **Traitement seul.** Après autorisation, activer le traitement de l'endpoint exact et démarrer un seul worker dédié avec ses deux autorisations de traitement. Maintenir les deux autorisations d'envoi à false et les anciens drapeaux WhatsApp à false. Le serveur HTTP ne démarre pas ce processus automatiquement. Contrôler les événements PROCESSED, réponses QUEUED, erreurs/reprises et demandes du dashboard, sans envoyer. Examiner le volume historique avant cette phase.
5. **Activation contrôlée des réponses.** Après recette et autorisation explicite, arrêter le nouveau worker proprement, fixer un seuil UTC récent `META_INBOX_SEND_NOT_BEFORE`, activer uniquement les deux drapeaux d'envoi du worker et le redémarrer. Les anciens événements et les messages hors périmètre restent exclus. Ne pas vider l'historique par une date ancienne. Ne pas activer les anciens workers, les relances ou les notifications WhatsApp.
6. **Test réel consenti.** Seulement sous autorisation d'envoi : numéro de recette autorisé, Bonjour → menu → formations/tarifs/horaires → inscription par administrateur → confirmation → demande visible ; contrôler boutons/listes, STOP et conseiller. Vérifier l'acceptation et la délivrance Meta via callbacks, le nombre d'envois et l'absence de doublons. Une erreur de credentials/réseau ou un statut incertain impose arrêt et rapprochement, pas réémission aveugle.
7. **Supervision limitée.** Après validation, superviser le seul processus `nva-meta-inbox-worker` avec délai de redémarrage, compteurs sûrs et arrêt gracieux. Les commandes précises de démarrage autonome et PM2 figurent dans le rapport du correctif. Aucun `restart all`, changement Nginx partagé ou opération NovanceTech. Vérifier les sessions HTTP et les règles de paiement/blocage existantes sans les modifier.
8. **Retour arrière.** Arrêter uniquement ce nouveau worker ; remettre ses autorisations de traitement/envoi à false dans son fichier privé. Sous autorisation DBA, remettre `processing_enabled=false` sur l'endpoint exact en conservant `inbox_enabled=true`. Préserver événements, conversations, admissions, clés et sessions HTTP ; aucun DELETE, down ou restauration aveugle du dump. Rapprocher toute soumission incertaine avec les callbacks. Si le code HTTP a été remplacé dans une opération distinctement autorisée, revenir à sa release précédente et redémarrer uniquement son processus exact selon le runbook.

**Décision finale : NON PRÊT POUR LA PRODUCTION.** Les droits SQL et le raccordement passent sur le laboratoire. La décision de production attend les diagnostics Contabo, leur comparaison et une recette autorisée ; cette mission n'autorise ni leur activation ni le déploiement.
