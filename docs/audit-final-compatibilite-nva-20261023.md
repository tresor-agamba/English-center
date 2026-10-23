# Audit final de compatibilité avant déploiement — NVA

Date : 23 octobre 2026. Périmètre : code local, 47 migrations Prisma, SQL externe et preuves de validation PostgreSQL conservées dans le workspace.

## 1. Conclusion : NON PRÊT POUR LE DÉPLOIEMENT

**NON PRÊT POUR LE DÉPLOIEMENT.** Les 35 contrôles d’intégration et 372 tests locaux réussis prouvent les parcours testés, mais pas la compatibilité avec la base Contabo actuelle. Cette dernière n’a pas été interrogée pendant cet audit. Aucun export récent de son schéma, historique ou catalogue n’a été fourni.

Trois conditions restent à lever : établir la version exacte du SQL Meta sur Contabo et sa procédure de livraison ; délimiter les écarts Prisma sans appliquer un diff global ; vérifier l’historique, les permissions et les données officielles de la cible. L’absence de ces preuves est bloquante, même si aucune corruption n’a été constatée dans le laboratoire.

Cet audit n’a exécuté aucun SQL, ni sur la production ni sur le laboratoire. Aucune migration, modification du code applicatif, changement des mécanismes de paiement/blocage, activation WhatsApp/worker, opération NovanceTech, sauvegarde distante, redémarrage, transfert ou push. Seuls ce rapport, deux scripts de diagnostic **en lecture seule** et des inventaires locaux ont été créés. Les procédures ci-dessous sont proposées pour exécution ultérieure par l’opérateur ; aucun déploiement ne doit commencer sans autorisation explicite.

## 2. Sources et niveau de preuve

- `prisma/schema.prisma` et les 47 fichiers `prisma/migrations/*/migration.sql` actuels.
- Les sept fichiers SQL externes inventoriés plus bas, ainsi que les extraits et preuves historiques associés.
- Les résultats PostgreSQL du 23 octobre : [rapport de validation](whatsapp-postgres-validation-20261023.md), [historique testé](../output/postgres-validation/migration-history-v2.json), [intégrité](../output/postgres-validation/schema-integrity.json), [diff final](../output/postgres-validation/schema-diff-final.txt).
- Les contrôles statiques de cet audit : [inventaire SQL et colonnes](../output/final-deployment-audit/sql-inventory.json), [comparaison des checksums locaux](../output/final-deployment-audit/migration-local-comparison.json), [revue statique des diagnostics](../output/final-deployment-audit/diagnostic-static-review.json).

Les 47 fichiers de migration correspondent encore aux checksums de l’historique testé : **zéro différence**. Le DDL Meta canonique correspond également à l’empreinte du fichier appliqué dans le laboratoire. Ces comparaisons portent sur des preuves locales conservées ; elles ne renseignent pas l’état de Contabo.

## 3. Inventaire du SQL extérieur aux migrations Prisma

### Fichiers et risques de réexécution

| Fichier | Rôle / preuve disponible | Réexécution et dépendances |
| --- | --- | --- |
| `docs/sql/meta-inbox-schema-reviewed.sql` | DDL Meta canonique. Application de test confirmée dans `output/postgres-validation/meta-sql-application.json`. Des preuves historiques existent aussi pour une autre instance locale. | **Non idempotent** : CREATE TABLE/FUNCTION/INDEX/TRIGGER et ADD CONSTRAINT sans IF NOT EXISTS. Échec si objets existants. Pas de BEGIN/COMMIT propre ; doit être enveloppé dans une transaction externe avec arrêt à la première erreur. |
| `tmp/meta-whatsapp-transaction-ddl-review.sql` | Copie de revue, **identique octet pour octet** au DDL canonique. Les anciens rapports la référencent. | Ne pas la traiter comme une deuxième migration à appliquer. Rejouer les deux fichiers provoquerait des collisions sur les mêmes objets. |
| `docs/sql/meta-inbox-ingress-role.sql` | Rôle de test `nva_meta_inbox_ingress`, NOLOGIN, et grants par colonne sur `nva_whatsapp_test`. Preuve historique de commit et privilèges dans `output/meta-ingress-role-evidence.json`. | CREATE ROLE non rejouable ; nom de base de test fixé ; pas de transaction/arrêt sur erreur intégrés. **Interdit tel quel pour Contabo**. Les tables, la séquence et la fonction Meta doivent déjà exister. |
| `docs/sql/meta-inbox-production-ingress-role.sql` | Proposition de rôle `nva_meta_inbox_ingress_prod`, NOLOGIN. Aucun élément consulté ne prouve son application en production. | Transaction et ON_ERROR_STOP présents ; refuse un rôle déjà existant, un schéma incomplet ou des privilèges PUBLIC incompatibles. Cible fixée à `english_center`, socket administratif ou `127.0.0.1:5432`. Pas un script de réparation d’un rôle existant. |
| `deploy/whatsapp-chatbot/02-optional-module-grants.sql` | Grants optionnels pour règles, paramètres, budget IA, scénarios, demandes et événements d’admission ; pas de DDL Meta. Les ACL de laboratoire ont été préparées séparément. | GRANT répété est normalement cumulatif, mais le script ne prouve pas que les privilèges sont minimaux : il ne retire pas d’anciens droits. Il contient **deux transactions** ; la première peut être commitée si la seconde échoue. Dépend des trois migrations récentes et d’un rôle applicatif existant. Ne fournit pas à lui seul tous les droits métier/Meta. |
| `deploy/whatsapp-chatbot/01-readonly-audit.sql` | Diagnostic historique : tables/colonnes, historique, présence des triggers et accès du rôle ingress. | Lecture seule ; aucune installation. Arrête sur historique absent. Ne compare pas à lui seul toutes les définitions ou ACL. |
| `output/whatsapp-acl-grant-options.sql` | Diagnostic historique de droits GRANT OPTION sur un ancien laboratoire. | Malgré son nom, **ne contient aucun GRANT** : SELECT de catalogues dans une transaction READ ONLY. Commentaire de cible, sans garde d’identité suffisante pour un outil de production. Utiliser les nouveaux diagnostics. |

Le fichier `output/postgres-validation/schema-diff-final-DO-NOT-APPLY.sql` est un **diff généré non exécuté**, et non une migration autorisée. Les blocs SQL dans les rapports historiques et les appels SQL synthétiques des scripts/tests ne constituent pas d’autres migrations de production. Les scripts de validation ont notamment préparé des rôles, des grants et `http_sessions` dans le laboratoire ; aucune preuve n’étend ces opérations à Contabo.

Empreinte SHA-256 du DDL Meta canonique et de sa copie :

```text
5700356024669fef66a3b58aa63f0c0a6a0e297b864617543c40f109eac0bb42
```

### Tables, colonnes et objets Meta

| Table | Colonnes | Contenu structurel |
| --- | --- | --- |
| `meta_webhook_endpoints` | 14 | Périmètre/application/compte Meta, flags inbox/processing, versions, dates de création et désactivation. |
| `meta_webhook_receipts` | 13 | Endpoint, dates, empreinte de requête, version d’authentification, taille, compteurs NEW/DUPLICATE/CONFLICT et expiration. |
| `meta_webhook_events` | 43 | Identité native, ordre de file, empreintes, flux, payload chiffré, état/résultat, reprises, bail/génération, conflits et rétention. |
| `meta_webhook_receipt_items` | 16 | Manifeste receipt/event, position dans le webhook, disposition, empreinte observée, variante chiffrée et expiration. |

**86 colonnes scalaires** sont présentes des deux côtés, sans colonne manquante dans le rapprochement statique SQL/Prisma. Leur liste et leurs définitions SQL sont fournies dans l’inventaire lié en section 2. Le diff PostgreSQL conservé après application du DDL ne signalait pas de différence sur ces quatre tables. Les champs UUID sont générés par Prisma/application ; aucun défaut SQL UUID ni extension de chiffrement n’est créé par ce script.

Le DDL contient :

- quatre clés primaires, sept contraintes UNIQUE, quatre FK internes à Meta et sept CHECK, soit **22 contraintes nommées** ;
- **14 CREATE INDEX explicites**, en complément des index des PK/UNIQUE ;
- une séquence implicite BIGSERIAL `meta_webhook_events_enqueue_order_seq` ;
- sept fonctions PL/pgSQL SECURITY INVOKER, avec search_path fixé ;
- sept triggers, dont trois triggers de contraintes différés vérifiant le manifeste et l’occurrence NEW.

Deux index partiels sont essentiels : un seul endpoint actif dans toute la base (`meta_endpoint_one_active_key`), et une seule occurrence NEW conservée par événement (`meta_receipt_new_event_key`). Les CHECK contrôlent notamment les valeurs d’état, digests, compteurs, baux et cohérence payload/résultat. Les triggers interdisent des changements d’identité/historique, protègent la rétention et vérifient les manifestes au commit. **Quatre tables présentes sans ces objets ne suffisent pas à certifier l’installation.**

Le DDL Meta est autonome vis-à-vis des tables métier : ses quatre FK sont internes au sous-schéma Meta. En revanche, le traitement d’un événement vers le moteur exige les tables de conversation, consentement, notifications, catalogue et admissions issues des migrations historiques/récentes. Les grants ingress exigent au préalable les objets Meta ; les grants du dashboard exigent leurs migrations applicatives.

### Conflits et limites de livraison

Les 47 migrations locales ne contiennent aucune création de table `meta_webhook_*` ni `provider_*`. Il n’y a donc pas de double création Meta entre l’historique actuel et le DDL externe. Le risque apparaît si ce DDL est rejoué sur une cible déjà partiellement/totalement équipée, ou si une future migration englobe les mêmes objets sans reprise de leur historique.

Lancer le DDL canonique directement en autocommit présente deux problèmes : SET LOCAL perd sa portée et une erreur peut laisser un schéma partiellement créé. Ajouter seulement IF NOT EXISTS ne résoudrait pas la compatibilité d’objets existants. Il faut comparer les définitions et prévoir une évolution additive/versionnée, après revue DBA, sans modifier rétroactivement les migrations appliquées.

Le rôle de réception en production doit rester séparé du rôle métier. Le script proposé refuse notamment l’héritage de CREATE/TEMP ou d’accès métier via PUBLIC. Un serveur PostgreSQL peut avoir de tels grants existants : **ne pas révoquer PUBLIC globalement sans étude d’impact sur les autres services**. Aucun changement concernant NovanceTech n’est autorisé par cet audit.

## 4. Écarts Prisma et gravité

| Référence | Écart / constat | Gravité et effet | Correction ou décision nécessaire |
| --- | --- | --- | --- |
| C1 | Structure, historique, données et ACL Contabo non observés | **Bloquant pour la décision de déploiement.** On ne peut garantir ni migrations en attente ni absence de schéma partiel. | Exécuter les diagnostics en lecture seule, comparer les résultats et répéter sur restauration isolée. |
| C2 | Meta modélisé dans Prisma, absent des 47 migrations | **Élevée** pour réception/traitement Meta : migrate deploy seul laisse les tables manquantes si elles n’existent pas déjà. | Vérifier la présence et les définitions ; faire approuver le mode de livraison/versionnement du SQL Meta. Pas de migration créée ici. |
| C3 | Six modèles Provider déclaratifs sans tables dans l’historique | **Élevée si activés ou si diff global appliqué** ; pas une dépendance du parcours Meta validé. | Conserver ces composants sans les déployer implicitement ; confirmer que le périmètre ne sollicite pas le store Gupshup durable. Celui-ci référence réellement ces modèles. |
| C4 | `http_sessions` gérée par connect-pg-simple, absente du schéma Prisma | **Critique si diff global appliqué**, car le diff propose DROP TABLE. Si table absente et rôle app sans CREATE, le démarrage peut aussi échouer. | Préserver la table, ses droits et son index d’expiration. La préparer par propriétaire si nécessaire, après autorisation ; ne pas donner CREATE global à l’application par facilité. |
| C5 | Six FK admissions : ON UPDATE NO ACTION implicite dans le SQL contre CASCADE attendu par Prisma | **Moyenne**, non bloquante pour les CRUD observés à identifiants immuables ; bloque une prétention d’alignement strict. | Décider la référence voulue ; si nécessaire, nouvelle évolution limitée et revue. Ne pas éditer la migration déjà appliquée. |
| C6 | Autres FK académiques/financières divergentes ; le diff propose au total 37 reconstructions de FK existantes | **Moyenne à élevée** si ces reconstructions sont exécutées sans analyse des actions/verrous/données. | Comparer chaque définition réelle, notamment ON UPDATE/DELETE. Hors changement automatique pour le chatbot. |
| C7 | Defaults supplémentaires en base sur updated_at, lesson_resources.public_id et lessons.position | **Faible pour les appels Prisma testés** ; changements potentiellement incompatibles avec d’anciens inserts SQL. | Conserver tant que leurs producteurs et dépendances ne sont pas inventoriés. Aucun DROP DEFAULT automatique. |
| C8 | Index partiel des leçons représenté comme @@unique non partiel dans Prisma | **Écart de représentation, pas preuve d’unicité manquante. Élevée pour un diff aveugle** : création proposée sous un nom déjà utilisé. | Préserver l’index SQL et son prédicat ; revue séparée de la représentation. |
| C9 | Noms d’index différents sur lesson_progress et training_session_teachers | **Faible** si colonnes/prédicats/validité équivalents. Le nom long historique subit aussi la limite PostgreSQL d’identifiant. | Comparer les définitions, pas seulement les noms ; ne pas renommer pour faire disparaître un avertissement. |
| C10 | ACL du VPS et droits effectifs PUBLIC/memberships inconnus | **Élevée**, refus du runtime ou exposition de données si mauvais rôle. | Auditer les droits effectifs, colonnes, séquences et fonctions. Les grants optionnels ne sont ni une preuve de moindre privilège ni une installation complète. |
| C11 | Cible Meta runtime figée : 127.0.0.1:5432 / english_center / nva_meta_inbox_ingress_prod | **Élevée si l’architecture Contabo diffère.** Alias localhost, autre port/base/rôle ou URL avec paramètres sont refusés. | Vérifier l’adéquation sans publier l’URL ni changer automatiquement ces garde-fous. |
| C12 | Catalogue réel et sessions éligibles non vérifiés | **Élevée fonctionnellement** : mauvais tarif, essai ou absence de créneau possible malgré tests verts. | Contrôler valeurs publiques, politique d’accès et places, puis confronter au service officiel de publication/inscription. |

### Précisions sur les écarts historiques

Les six modèles déclaratifs sont ProviderApplication, ProviderDelivery, ProviderSendAttempt, ProviderMessageAlias, ProviderWebhookEvent et ProviderReconciliationAudit. Ils ne doivent pas être supprimés ou migrés par effet de bord. Source : commentaire en tête de `schema.prisma` et services dans `src/services/providers/gupshupDurableStore.js`.

`src/config/sessionStore.js` utilise `http_sessions` et createTableIfMissing=true ; `src/server.js` vérifie ce stockage avant l’écoute HTTP. Le diagnostic ne doit pas démarrer l’application pour « voir si elle fonctionne » : cela peut créer la table ou d’autres écritures.

Le diff propose de supprimer les defaults de `assignment_submissions.updated_at`, `assignments.updated_at`, `course_modules.updated_at`, `lesson_progress.updated_at`, `lesson_resources.updated_at`, `lesson_resources.public_id` et `lessons.position`. Leur présence ne contredit pas les parcours Prisma observés, qui fournissent généralement ces valeurs. Leur suppression n’est pas nécessaire pour installer les admissions.

Sur les leçons, la migration `20260727163000_lms_phase5` crée déjà `lessons_course_chapter_id_position_key` **WHERE course_chapter_id IS NOT NULL**, et un autre index pour les leçons sans chapitre. Le schéma déclare @@unique([courseChapterId, position]) ; l’introspection Prisma n’assimile pas cet index partiel à une contrainte globale. Il serait erroné de conclure que la base n’a aucune protection d’unicité.

Enfin, le runtime HTTP Meta actuel est une composition de réception seulement (`metaInboxRuntime.js`). Les 35 contrôles ont explicitement invoqué les étapes de traitement dans le laboratoire. Ils ne prouvent pas qu’un dispatcher de production démarre ou qu’un clic réel produira automatiquement une réponse. L’envoi et les workers restent interdits ; leur raccordement/activation ultérieurs nécessiteront une décision distincte.

## 5. Diagnostics Contabo en lecture seule

Deux fichiers nouveaux sont fournis :

- [03-contabo-readonly-structure.sql](../deploy/whatsapp-chatbot/03-contabo-readonly-structure.sql) : identité, historique/checksums, tables, colonnes, contraintes, index/prédicats, sept triggers et fonctions, droits effectifs des deux rôles ;
- [04-contabo-readonly-catalog.sql](../deploy/whatsapp-chatbot/04-contabo-readonly-catalog.sql) : prix et structure publics, horaires, sessions, places agrégées, flags du chatbot et comptes d’objets de configuration.

Ils ouvrent une transaction REPEATABLE READ READ ONLY, définissent des délais courts et arrêtent sur erreur/cible incorrecte. Les tables optionnelles absentes sont signalées, pas créées. Le diagnostic catalogue refuse de continuer si les principales colonnes nécessaires ne sont pas installées. Ses indicateurs de session sont des **candidats SQL** : ils ne remplacent pas tous les filtres de `isPublicCourse` et les contrôles métier de l’inscription.

Aucun SELECT de noms d’étudiants, téléphone, e-mail, compte personnel, message, contenu FAQ/scénario, payload chiffré, URL privée de cours, clé, mot de passe ou auth token. Les descriptions ne sont pas affichées : seul un booléen de présence est retourné. Les noms de rôles/objets et les titres publics de formation restent des métadonnées nécessaires à la revue.

### Commandes à exécuter par l’opérateur, pas exécutées ici

Utiliser une connexion libpq **déjà préparée et vérifiée par le DBA**, nommée par exemple nva_audit, avec ses credentials dans le gestionnaire prévu/.pgpass protégé ; ne jamais les passer en argument ou les copier dans ce chat. Le rôle doit pouvoir lire les catalogues et les tables concernées. Aucune attribution de droit n’est incluse dans ces commandes. Les variables ci-dessous ne contiennent que des informations non secrètes.

```bash
set -euo pipefail
umask 077
read -r -p 'Service libpq de diagnostic préconfiguré : ' NVA_AUDIT_SERVICE
read -r -p 'Nom de la base NVA attendue : ' NVA_EXPECTED_DB
read -r -p 'Nom exact du rôle applicatif NVA : ' NVA_APP_ROLE
read -r -p 'Nom exact du rôle ingress Meta attendu : ' NVA_INGRESS_ROLE
read -r -p 'Chemin du candidat NVA revu contenant les scripts : ' NVA_CANDIDATE
[[ "$NVA_AUDIT_SERVICE" =~ ^[A-Za-z0-9_-]+$ ]]
[[ "$NVA_EXPECTED_DB" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]
[[ "$NVA_APP_ROLE" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]
[[ "$NVA_INGRESS_ROLE" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]
NVA_CANDIDATE=$(realpath -- "$NVA_CANDIDATE")
test -f "$NVA_CANDIDATE/deploy/whatsapp-chatbot/03-contabo-readonly-structure.sql"
NVA_AUDIT_DIR="$HOME/nva-audit-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -- "$NVA_AUDIT_DIR"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=2000'
psql -X -w "service=$NVA_AUDIT_SERVICE" \
  -v expected_database="$NVA_EXPECTED_DB" -v nva_app_role="$NVA_APP_ROLE" \
  -v nva_ingress_role="$NVA_INGRESS_ROLE" \
  -f "$NVA_CANDIDATE/deploy/whatsapp-chatbot/03-contabo-readonly-structure.sql" \
  > "$NVA_AUDIT_DIR/structure.txt"
# Examiner d’abord l’identité retournée et les éventuelles absences.
# Si la cible ou la structure est incorrecte : arrêter, ne rien réparer.
psql -X -w "service=$NVA_AUDIT_SERVICE" \
  -v expected_database="$NVA_EXPECTED_DB" \
  -f "$NVA_CANDIDATE/deploy/whatsapp-chatbot/04-contabo-readonly-catalog.sql" \
  > "$NVA_AUDIT_DIR/catalogue.txt"
```

Les scripts ne créent pas eux-mêmes le répertoire distant ni la connexion libpq : les commandes ci-dessus sont un mode opératoire pour l’opérateur. Ne pas lancer le fichier SQL de grants à la place d’un diagnostic.

### Export minimal de l’historique et comparaison hors connexion

Seulement après confirmation de la cible et présence de `_prisma_migrations` :

```bash
psql -X -w -A -t "service=$NVA_AUDIT_SERVICE" -v ON_ERROR_STOP=1 \
  -c "SELECT COALESCE(json_agg(x ORDER BY migration_name),'[]'::json) FROM (SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations) x" \
  > "$NVA_AUDIT_DIR/migrations.json"
cd -- "$NVA_CANDIDATE"
node scripts/auditWhatsAppRelease.js --history "$NVA_AUDIT_DIR/migrations.json" \
  --output "$NVA_AUDIT_DIR/offline-comparison"
```

La dernière commande est un traitement de fichiers local au candidat : aucune connexion DB. Il attend seulement les trois migrations récentes du module, ou aucune, après vérification des checksums. Un échec/une autre migration en attente requiert une revue : ne pas éditer `_prisma_migrations`, masquer des dossiers ou employer migrate resolve pour contourner le refus. Ce comparateur n’analyse pas le drift : il complète les deux diagnostics, sans les remplacer.

Pour une comparaison complète des objets, le DBA peut exporter le schéma **sans données**, dans le même répertoire privé :

```bash
pg_dump -w --schema-only --dbname="service=$NVA_AUDIT_SERVICE" \
  --file="$NVA_AUDIT_DIR/schema-only.sql"
sha256sum "$NVA_AUDIT_DIR/schema-only.sql" > "$NVA_AUDIT_DIR/schema-only.sql.sha256"
```

Ne pas afficher ni partager un fichier d’environnement, un inventaire PM2 complet, une URL de connexion ou un dump de données. Le schéma exporté doit rester privé et être examiné avant tout partage. Ne pas lancer de parcours HTTP, service de calcul des droits ou test de paiement sur Contabo pendant cette vérification : plusieurs lectures applicatives écrivent des statuts/horodatages.

### Interprétation attendue des données publiques

- Pour la formation d’anglais concernée : trois niveaux, seize séances par niveau, 48 séances totales, 60 USD par niveau et access_policy=LEGACY_STAGED.
- Minimum pour une **nouvelle** inscription à ce prix : 50 % = 30 USD. Les inscriptions anciennes utilisent leur propre montant historique ; ce diagnostic n’affiche pas leurs données.
- L’essai historique est compté par inscription. L’inclusion annoncée dans le premier niveau ne crée pas une règle globale d’essai unique ; aucune correction des règles n’est proposée automatiquement ici.
- Vendredi/samedi doivent se trouver dans les week_days des sessions/groupes éligibles, avec des heures cohérentes et des places restantes.
- Sessions candidates : OPEN, début futur, échéance non dépassée, places disponibles, formation publiée et niveau compatible. Décompte des places conforme aux statuts occupants TRIAL_ACTIVE, PLACEMENT_TEST_REQUIRED, PAYMENT_REQUIRED et CONFIRMED ; pas de liste d’étudiants.
- Vérifier les personnalisations de communication dans une session d’administration autorisée **sur préproduction** : les diagnostics n’exportent pas les textes, qui pourraient contenir des données ajoutées par un administrateur.

## 6. Sauvegardes avant toute migration autorisée

Les commandes suivantes sont une préparation à exécuter ultérieurement par l’opérateur ; elles n’ont pas été lancées. Elles lisent la base source et écrivent uniquement les archives privées. Utiliser un pg_dump compatible avec la version du serveur, sans mise à jour globale de PostgreSQL ou de NovanceTech.

```bash
# Après vérification de l’identité avec le service libpq prévu pour la sauvegarde.
read -r -p 'Service libpq de sauvegarde NVA préconfiguré : ' NVA_BACKUP_SERVICE
[[ "$NVA_BACKUP_SERVICE" =~ ^[A-Za-z0-9_-]+$ ]]
NVA_BACKUP_DIR="$HOME/nva-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -- "$NVA_BACKUP_DIR"
pg_dump --version
pg_dump -w --format=custom --dbname="service=$NVA_BACKUP_SERVICE" \
  --file="$NVA_BACKUP_DIR/nva-before.dump"
pg_dump -w --schema-only --dbname="service=$NVA_BACKUP_SERVICE" \
  --file="$NVA_BACKUP_DIR/nva-schema-before.sql"
pg_restore --list "$NVA_BACKUP_DIR/nva-before.dump" > "$NVA_BACKUP_DIR/archive-list.txt"
sha256sum "$NVA_BACKUP_DIR/nva-before.dump" "$NVA_BACKUP_DIR/nva-schema-before.sql" \
  > "$NVA_BACKUP_DIR/SHA256SUMS"
```

La liste de l’archive et les empreintes ne prouvent pas la restauration. La réussite d’une restauration sur une instance **distincte et isolée**, avec contrôle des contraintes et droits, est indispensable avant décision. Ne pas restaurer dans la production. Conserver aussi, selon la procédure NVA existante, le code/client Prisma précédent, les fichiers privés et la configuration NVA dans le coffre prévu. Les secrets ne doivent apparaître ni dans le rapport ni dans le terminal. L’export logique de la seule base ne suffit pas à restaurer les credentials des rôles ; leur reconstitution sécurisée doit être préparée par le DBA, sans exporter inutilement les rôles d’autres applications.

## 7. Déploiement recommandé, sous autorisation distincte

1. Obtenir et revoir les résultats Contabo ci-dessus. Classer chaque prérequis comme présent/absent/divergent et comparer les checksums. Confirmer la cible figée du runtime Meta.
2. Arrêter le périmètre du paquet : migrations applicatives réellement en attente, SQL Meta éventuel, grants nécessaires, table de sessions, fichiers applicatifs et client généré. Ne pas intégrer les six tables Provider ou un diff global pour faire disparaître des écarts hors périmètre.
3. Établir la stratégie du SQL Meta : si tout existe et correspond, ne pas rejouer CREATE ; si tout est absent, livraison transactionnelle revue ; si l’état est partiel/divergent, correction additive spécifique à faire autoriser. Toute future migration doit tenir compte des objets déjà installés, sans modifier les migrations historiques.
4. Après sauvegarde et contrôle de restauration, répéter ce paquet sur une copie isolée représentant l’état réel. Vérifier les ACL, les contraintes SQL non exprimées par Prisma, la session HTTP, les admissions et les doublons concurrents. Les bases neuves déjà validées ne remplacent pas cette répétition sur l’existant.
5. Reconstituer une archive applicative propre, excluant `.env`, clés, storage, node_modules, journaux, dumps et clusters de laboratoire ; comparer SHA-256. L’archive candidate antérieure est dépassée. Aucune archive n’a été transférée ici.
6. Demander une autorisation explicite sur **ce paquet concret et sa procédure**. Aucun déploiement ne découle de l’audit.
7. Une fois autorisé seulement : installer les dépendances verrouillées dans la release NVA isolée, générer son client Prisma compatible, appliquer exclusivement les étapes approuvées, redémarrer uniquement le processus NVA identifié. Ne pas changer Node/PM2/PostgreSQL globalement, Nginx partagé ou NovanceTech.
8. Maintenir WHATSAPP_ENABLED=false et WHATSAPP_WORKERS_ENABLED=false. Ne pas activer Meta Inbox, le dispatcher ou l’IA de production comme effet de bord du déploiement. Vérifier dashboard et simulateurs sans message réel.
9. Retour arrière : remettre code/client Prisma précédents selon la revue de compatibilité ; conserver les ajouts SQL et données. Aucun DROP des demandes ni restauration du dump sur la base vivante sans procédure de reprise et autorisation séparées.

Le [runbook opérateur existant](whatsapp-production-operator-runbook.md) fournit les opérations de release et leurs gardes. Ses étapes d’écriture ne sont pas autorisées par ce rapport ; elles doivent être adaptées au résultat de l’audit réel et à la livraison SQL Meta retenue.

## 8. Conditions pour reclasser la décision en PRÊT

- Historique Contabo vérifié, sans migration échouée/checksum divergent ou écart non expliqué.
- Tables, colonnes, contraintes, index, sept fonctions/triggers Meta et permissions effectives confirmés ; stratégie de livraison décidée sans réexécution aveugle.
- Table de sessions et droits applicatifs compatibles avec le démarrage.
- Drift Provider/index partiels/FK/defaults explicitement délimité ; aucun diff global prévu.
- Catalogue, horaires, sessions et politique commerciale confirmés pour la formation concernée.
- Sauvegarde et restauration isolée du véritable état cible validées ; paquet final et retour arrière revus.
- Autorisation explicite de déploiement reçue, avec transports et workers toujours désactivés.

**Décision actuelle : NON PRÊT POUR LE DÉPLOIEMENT.** Aucun déploiement ni correction de base n’a été effectué. La validation fonctionnelle locale demeure favorable ; la compatibilité de la cible Contabo reste à établir avec les diagnostics préparés.
