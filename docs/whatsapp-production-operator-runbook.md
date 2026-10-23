> Mise à jour du 22 octobre 2026 : inclut désormais la migration 20261022120000_add_whatsapp_admission_requests. Consulter également whatsapp-admissions-implementation.md. L’archive du 20 octobre ne contient pas cette extension.

﻿# Préparation NVA — commandes Contabo à exécuter manuellement

Ce document ne déclenche aucune action. Les commandes de sauvegarde, migration, copie finale et redémarrage sont réservées à l’opérateur après validation et autorisation. Aucun chemin, utilisateur ou processus réel Contabo n’a été vérifié. Ne jamais remplacer un arrêt de procédure par une suppression de table ou une réinitialisation Prisma.

## 1. Préparer et transférer le candidat depuis Windows

Dans PowerShell, à la racine D:\English-center :

```powershell
$NvaArchive = Join-Path (Get-Location) 'output\whatsapp-readiness\nva-release.tar.gz'
New-Item -ItemType Directory -Force (Split-Path $NvaArchive) | Out-Null
& tar -czf $NvaArchive --exclude=.env --exclude=node_modules --exclude=.git --exclude=storage --exclude=logs --exclude=tmp --exclude=output src views public prisma scripts deploy docs tests images logo package.json package-lock.json ecosystem.config.cjs .env.example
if ($LASTEXITCODE -ne 0) { throw 'Archive refusée' }
Get-FileHash -LiteralPath $NvaArchive -Algorithm SHA256
$NvaSsh = Read-Host 'Alias SSH NVA ou utilisateur@hôte validé'
scp -- $NvaArchive ('{0}:nva-release.tar.gz' -f $NvaSsh)
ssh -- $NvaSsh
```

Le candidat contient tout le code du dépôt NVA autorisé par cette liste, pas un diff avec le VPS : examiner les changements étrangers au module avant acceptation. Aucune clé, .env, base, logs, node_modules ou fichier privé storage n’est transféré. L’empreinte SHA-256 doit être comparée sur Contabo. Ne pas utiliser git pull, une copie du répertoire complet ou une mise à jour globale de Node/PM2 sans inventaire de l’existant.

## 2. Renseigner la cible dans une session Bash de l’utilisateur NVA

Utiliser le compte Linux qui gère déjà le processus NVA. Les commandes PostgreSQL ci-dessous supposent un PostgreSQL local accessible par le rôle postgres via sudo et socket Unix ; si ce n’est pas l’installation réelle, arrêter et adapter avec le DBA.

```bash
set -euo pipefail
umask 077
read -r -p 'Chemin absolu du projet NVA : ' NVA_APP_DIR
read -r -p 'Nom exact du processus PM2 NVA : ' NVA_PROCESS
read -r -p 'Base PostgreSQL NVA (attendu english_center) : ' NVA_DB
read -r -p 'Port PostgreSQL local (attendu 5432) : ' NVA_PGPORT
read -r -p 'Répertoire socket PostgreSQL local : ' NVA_PG_SOCKET
read -r -p 'Répertoire privé de sauvegarde hors projet : ' NVA_BACKUP_ROOT
NVA_APP_DIR=$(realpath -- "$NVA_APP_DIR")
test -d "$NVA_APP_DIR"
[[ "$NVA_PGPORT" =~ ^[0-9]+$ ]]
[[ "$NVA_DB" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]
[[ "$NVA_BACKUP_ROOT" = /* ]]
test "$NVA_APP_DIR" != /
case "$NVA_APP_DIR" in *Novance*|*novance*) exit 1;; esac
NVA_BACKUP_ROOT=$(realpath -m -- "$NVA_BACKUP_ROOT")
case "$NVA_BACKUP_ROOT/" in "$NVA_APP_DIR/"*) exit 1;; esac
NVA_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NVA_BACKUP="$NVA_BACKUP_ROOT/$NVA_STAMP"
NVA_STAGE="$(dirname "$NVA_APP_DIR")/nva-candidate-$NVA_STAMP"
mkdir -m 700 -p "$NVA_BACKUP"
mkdir -m 700 "$NVA_STAGE"
sha256sum "$HOME/nva-release.tar.gz"
# Comparer exactement avec l’empreinte Windows avant extraction.
tar -tzf "$HOME/nva-release.tar.gz" > "$NVA_BACKUP/candidate-files.txt"
# Examiner la liste : aucun chemin absolu, '..', .env, storage ou lien sortant.
tar -xzf "$HOME/nva-release.tar.gz" --no-same-owner -C "$NVA_STAGE"
bash -n "$NVA_STAGE/deploy/whatsapp-chatbot/operator-functions.sh"
source "$NVA_STAGE/deploy/whatsapp-chatbot/operator-functions.sh"
nva_check_context
```

nva_check_context capture la liste PM2 en mémoire sans l’afficher, vérifie le nom exact, le cwd réel et package.json=english-center, et refuse un chemin ou nom Novance. Aucune commande `pm2 restart all`, `pm2 reload all`, `pm2 kill`, `pm2 save`, réinstallation globale ou opération Nginx commune n’est requise. Si NVA est géré par systemd, ce runbook PM2 ne s’applique pas : établir l’unité exacte avant toute action.

## 3. Sauvegarder et vérifier PostgreSQL et le code existant

```bash
sudo -u postgres psql -X --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --set=ON_ERROR_STOP=1 --set=expected_database="$NVA_DB" --file="$NVA_STAGE/deploy/whatsapp-chatbot/01-readonly-audit.sql" > "$NVA_BACKUP/sql-before.txt"
sudo -u postgres pg_dump --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --format=custom > "$NVA_BACKUP/database-before.dump"
pg_restore --list "$NVA_BACKUP/database-before.dump" > "$NVA_BACKUP/database-before.contents"
sha256sum "$NVA_BACKUP/database-before.dump" > "$NVA_BACKUP/database-before.sha256"
sha256sum --check "$NVA_BACKUP/database-before.sha256"
sudo -u postgres pg_dump --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --schema-only > "$NVA_BACKUP/schema-before.sql"
tar -C "$NVA_APP_DIR" --exclude='./node_modules' --exclude='./storage' --exclude='./logs' --exclude='./.env' --exclude='./.git' --exclude='./tmp' --exclude='./output' --exclude='./backups' -czf "$NVA_BACKUP/code-before.tar.gz" .
cp -p -- "$NVA_APP_DIR/.env" "$NVA_BACKUP/env-before"
chmod 600 "$NVA_BACKUP/env-before"
sudo -u postgres psql -X -A -t --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --set=ON_ERROR_STOP=1 --command="SELECT COALESCE(json_agg(t ORDER BY migration_name), '[]'::json) FROM (SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations) t" > "$NVA_BACKUP/migrations-before.json"
```

Ne pas afficher env-before, le dump ou les configurations PM2. Utiliser pg_dump de la version majeure du serveur ou une version compatible confirmée ; ne pas remplacer globalement PostgreSQL pour satisfaire ce prérequis. Le dump logique est cohérent pour la base ; sa simple liste n’est pas une preuve de restauration. Sauvegarder séparément les fichiers privés via la procédure NVA existante et vérifier la cohérence base/fichiers pendant une fenêtre de maintenance NVA. Un PRIVATE_STORAGE_ROOT externe doit être explicitement inclus dans cette sauvegarde privée. Garder les sauvegardes hors des répertoires exposés au Web et conserver la configuration/rôles nécessaires à une restauration, sans restaurer les rôles d’autres applications.

## 4. Installer les dépendances et contrôler les migrations sans application

```bash
cd -- "$NVA_STAGE"
node --version
npm --version
npm ci --include=dev
node scripts/generatePrismaClient.js
DATABASE_URL='postgresql://validation:validation@127.0.0.1:1/nva_schema_validation' node node_modules/prisma/build/index.js validate
node scripts/validateEjs.js
node scripts/auditWhatsAppRelease.js --history "$NVA_BACKUP/migrations-before.json"
```

Node local testé : 24.18.0 ; vérifier un runtime compatible isolément pour NVA, sans mettre à jour celui de NovanceTech. Conserver Prisma et @prisma/client à 6.19.3 via le lockfile ; ne pas utiliser un npx qui téléchargerait une version récente. La CLI Prisma est une devDependency, donc `npm ci --omit=dev` ne suffit pas pour migrer.

L’audit doit accepter exclusivement les trois migrations du module comme migrations en attente, ou aucune si elles sont déjà correctement appliquées. Il refuse les migrations échouées, manquantes, les sommes différentes et toute autre migration en attente. Ne pas masquer le problème en supprimant des dossiers de migration. Il ne détecte pas à lui seul un drift SQL : comparer schema-before.sql et le catalogue attendu, notamment contraintes/index/ACL/triggers Meta. Des modèles Provider* et Meta* sont présents dans le schéma sans migration correspondante dans l’historique local ; ne jamais générer/appliquer un diff global pour « corriger » cela.

## 5. Répéter sur une restauration isolée avant toute écriture en production

```bash
NVA_REHEARSAL_DB="nva_whatsapp_preprod_${NVA_STAMP//[^0-9]/}"
sudo -u postgres createdb --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --template=template0 "$NVA_REHEARSAL_DB"
sudo -u postgres pg_restore --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_REHEARSAL_DB" --exit-on-error --no-owner --no-privileges < "$NVA_BACKUP/database-before.dump"
install -m 600 /dev/null "$NVA_BACKUP/rehearsal-migration.env"
# Renseigner uniquement DATABASE_URL vers cette base isolée avec un rôle de migration.
nano "$NVA_BACKUP/rehearsal-migration.env"
(
  export NVA_APP_DIR="$NVA_STAGE" NVA_DB="$NVA_REHEARSAL_DB" NVA_MIGRATION_ENV="$NVA_BACKUP/rehearsal-migration.env"
  cd -- "$NVA_STAGE"
  nva_prisma migrate deploy
  nva_prisma migrate status
  npm run test:whatsapp:release
)
```

La copie restaurée contient des données sensibles : accès local uniquement, pas de DNS/proxy public ni de comptes réels pour les tests. --no-owner/--no-privileges vérifie la restaurabilité et la compatibilité DDL mais ne reproduit pas les ACL de production ; les auditer séparément. Un autre processus DBA ne doit pas créer la même base ; si le nom existe, arrêter, ne pas effacer la base existante.

Pour le test applicatif de préproduction, créer un fichier .env propre depuis .env.example dans NVA_STAGE, jamais un lien vers le .env de production : base restaurée, nouveau SESSION_SECRET, port local distinct, HOST=127.0.0.1, SMTP et intégrations de paiement non opérationnels, META_WHATSAPP_INBOX_ENABLED=false, META_INBOX_PRODUCTION_AUTHORIZED=false, WHATSAPP_ENABLED=false, WHATSAPP_WORKERS_ENABLED=false et NVA_CHATBOT_AI_ENABLED=false. Ne pas recopier META_INBOX_DATABASE_URL de production. Lancer manuellement depuis NVA_STAGE :

```bash
# Vérifier les valeurs non secrètes et la cible de la configuration de préproduction avant lancement.
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production node --env-file="$NVA_STAGE/.env" src/server.js
```

Tester le dashboard à travers un tunnel SSH local configuré sur ce port : connexion ADMIN, navigation Chatbot, création/modification d’un scénario inactif, boutons, liste, réponse par numéro, transitions, conditions, conseiller, STOP, reprise, CSRF et droits STUDENT/TEACHER refusés. Ne pas soumettre d’événement fictif au webhook public de production. Les tests signés Meta utilisent uniquement les mocks isolés.

## 6. Configurer OpenAI, sans activation

La clé ne doit être saisie que sur le serveur, dans un fichier protégé ou via le coffre déjà utilisé. Ni clé dans la ligne de commande, ni export collé dans ce chat, ni cat du fichier, ni pm2 env/jlist affiché.

```bash
chmod 600 "$NVA_APP_DIR/.env"
nano "$NVA_APP_DIR/.env"
```

Valeurs à conserver/configurer dans ce fichier :

```dotenv
WHATSAPP_ENABLED=false
WHATSAPP_WORKERS_ENABLED=false
NVA_CHATBOT_AI_ENABLED=false
OPENAI_MODEL=IDENTIFIANT_VALIDE_DU_COMPTE
NVA_CHATBOT_AI_DAILY_CALL_LIMIT=50
# OPENAI_API_KEY : renseigner la valeur réelle dans l’éditeur, jamais dans un document partagé.
```

Les deux flags d’envoi restent false ; configurer les credentials n’autorise pas leur activation. L’IA reste aussi false pour le premier déploiement de préparation. Son activation et un appel facturable réel peuvent être validés séparément, toujours sans activer WhatsApp. Le dashboard exige également son autorisation IA. Le quota est un plafond d’appels, pas une limite monétaire garantie ; configurer les restrictions et budgets du projet OpenAI. store:false ne signifie pas à lui seul une rétention nulle de toutes les données de sécurité du fournisseur.

## 7. Application finale — uniquement après autorisation de déployer

Prérequis : restauration et tests validés, sauvegarde vérifiée, inventaire d’écarts approuvé, aucun accès SQL d’ingress aux nouvelles tables, fenêtre de maintenance NVA acceptée. Les deux migrations sont additives mais ne contiennent pas de BEGIN/COMMIT explicite : un échec peut laisser un DDL partiel ; ne jamais relancer à l’aveugle ou marquer une migration appliquée sans constat SQL. Le DBA doit valider les contraintes de verrouillage/charge sur la copie restaurée.

Créer un fichier de credentials de migration protégé, distinct du compte d’ingress Meta. nva_prisma impose même base/port et hôte local, ne permet que status/deploy et masque les secrets dans les sorties.

```bash
install -m 600 /dev/null "$NVA_BACKUP/production-migration.env"
nano "$NVA_BACKUP/production-migration.env"
# Une seule DATABASE_URL pour la base NVA existante ; ne pas coller sa valeur dans le terminal.
export NVA_MIGRATION_ENV="$NVA_BACKUP/production-migration.env"
cd -- "$NVA_STAGE"
# Refaire l’export de migrations et l’audit si une autre release est intervenue.
node scripts/auditWhatsAppRelease.js --history "$NVA_BACKUP/migrations-before.json"
nva_check_context
# Ne stopper que NVA pendant l’application finale et le remplacement du code.
pm2 stop "$NVA_PROCESS"
# Les migrations sont exécutées depuis le candidat, avec ses fichiers verrouillés.
nva_prisma migrate deploy
nva_prisma migrate status
# Si le rôle de migration diffère du rôle applicatif, auditer les droits avant le redémarrage.
# Lire uniquement le NOM de rôle applicatif, sans afficher sa connexion :
NVA_DB_APP_ROLE=$(node - "$NVA_APP_DIR" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
try { const dir=process.argv[2];const env=require(path.join(dir,'node_modules/dotenv')).parse(fs.readFileSync(path.join(dir,'.env')));process.stdout.write(decodeURIComponent(new URL(env.DATABASE_URL).username)); }
catch {process.exit(1);}
NODE
)
# Facultatif, uniquement si les droits nécessaires sont absents et après validation DBA :
# sudo -u postgres psql -X --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --set=expected_database="$NVA_DB" --set=nva_app_role="$NVA_DB_APP_ROLE" --file="$NVA_STAGE/deploy/whatsapp-chatbot/02-optional-module-grants.sql"
# Prévisualiser, puis comparer précisément l’inventaire de fichiers.
rsync --archive --checksum --dry-run --itemize-changes --exclude='.env' --exclude='node_modules' --exclude='storage' --exclude='logs' --exclude='tmp' --exclude='output' "$NVA_STAGE/" "$NVA_APP_DIR/"
rsync --archive --checksum --exclude='.env' --exclude='node_modules' --exclude='storage' --exclude='logs' --exclude='tmp' --exclude='output' "$NVA_STAGE/" "$NVA_APP_DIR/"
cd -- "$NVA_APP_DIR"
npm ci --include=dev
node scripts/generatePrismaClient.js
node scripts/validateEjs.js
nva_restart_disabled
```

Ne pas ajouter --delete à rsync. Ce remplacement en place est retenu pour préserver le cwd et les chemins relatifs de storage/logs/PM2 existants ; il impose une fenêtre de maintenance et laisse potentiellement des fichiers historiques non référencés. L’inventaire approuvé décide lesquels doivent être retirés dans une autre intervention. Un schéma de releases par symlink peut remplacer cette procédure seulement s’il existe et a déjà été validé sur ce VPS.

Le fichier .env de préproduction n’est jamais copié dans NVA_APP_DIR. Le redémarrage charge le .env NVA existant en mémoire, force les trois flags false et remplace l’environnement PM2 périmé, sans afficher les secrets. Les paramètres et autorisations de réception Meta déjà en production ne sont pas modifiés. Le runtime de réception ne lance toujours pas de traitement ni d’envoi.

## 8. Vérification après redémarrage

```bash
curl --fail --silent --show-error https://www.newvisionacademy.org/health
curl --fail --silent --show-error https://www.newvisionacademy.org/ready
curl --silent --output /dev/null --write-out '%{http_code}\n' https://www.newvisionacademy.org/admin/whatsapp/chatbot/scenarios
sudo -u postgres psql -X --host="$NVA_PG_SOCKET" --port="$NVA_PGPORT" --dbname="$NVA_DB" --set=ON_ERROR_STOP=1 --set=expected_database="$NVA_DB" --file="$NVA_APP_DIR/deploy/whatsapp-chatbot/01-readonly-audit.sql" > "$NVA_BACKUP/sql-after.txt"
```

Attendu : health/ready 200 ; page admin anonyme redirigée vers login, jamais un éditeur accessible. Dans le navigateur authentifié ADMIN, consulter dashboard/conversations et utiliser seulement le simulateur, idéalement avec les scénarios d’essai déjà présents et inactifs. Ne pas créer de fixtures dans la production pour « tester ». Vérifier le rôle utilisateur normal refusé et la protection CSRF. Vérifier les métriques de réception Meta et l’absence de nouvelle erreur sans afficher les corps/messages, clés ou payloads chiffrés. Ne pas appeler les endpoints de traitement de jobs.

Le GET de challenge Meta ne prouve pas la persistance SQL. Une preuve réelle de réception externe et une campagne Meta de bout en bout nécessitent une procédure approuvée distincte ; elles ne sont pas incluses dans les commandes de préparation.

## 9. Revenir au code précédent sans migration destructive

Si une étape échoue, ne pas démarrer NVA avec un schéma partiellement validé. Après constat de compatibilité additive et décision de retour au code antérieur :

```bash
nva_check_context
pm2 stop "$NVA_PROCESS"
tar -tzf "$NVA_BACKUP/code-before.tar.gz" > "$NVA_BACKUP/rollback-files.txt"
# Restaurer le code en place sans supprimer de fichiers ni de données.
tar -xzf "$NVA_BACKUP/code-before.tar.gz" --no-same-owner -C "$NVA_APP_DIR"
cp -- "$NVA_BACKUP/env-before" "$NVA_APP_DIR/.env"
chmod 600 "$NVA_APP_DIR/.env"
# Dans l’éditeur, imposer à nouveau les trois flags false avant redémarrage.
nano "$NVA_APP_DIR/.env"
cd -- "$NVA_APP_DIR"
npm ci --include=dev
node scripts/generatePrismaClient.js
nva_restart_disabled
curl --fail --silent --show-error https://www.newvisionacademy.org/health
curl --fail --silent --show-error https://www.newvisionacademy.org/ready
```

Conserver les tables/colonnes additives et le journal Prisma. Les corps numérotés demeurent lisibles pour l’ancienne release. Les fichiers ajoutés par le candidat peuvent rester sur disque mais ne doivent pas être référencés par l’ancien code ; comparer l’inventaire avant/après. Ce retour au code n’efface ni les événements Meta ni les conversations reçues depuis la sauvegarde.

Ne pas restaurer le dump par-dessus english_center, ne pas lancer pg_restore --clean, DROP DATABASE, db push, migrate reset, seed ou migrate resolve pour forcer la reprise. Une restauration intégrale n’est pas un retour arrière ordinaire : elle peut perdre les écritures survenues depuis la sauvegarde et demande une autre autorisation. Le dump peut être restauré dans une nouvelle base isolée pour diagnostic, avec les commandes de l’étape 5.
