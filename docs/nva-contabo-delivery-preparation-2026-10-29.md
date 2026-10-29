# Livraison NVA sur Contabo — préparation du 29 octobre 2026

Ce document remplace les listes partielles des guides précédents. **Aucune commande serveur ci-dessous n'a été exécutée. Aucun push ni déploiement autorisé par cette préparation.** L'autorisation de publication GitHub et celle de déploiement restent distinctes.

## État local contrôlé

- Base : `main`, commit `5c465e1c066f044fff601615849ebe76c3334157`. La référence `refs/heads/main` a été interrogée directement sur GitHub et était identique avant création du commit.
- Inventaire initial exhaustif Git : 15 fichiers suivis modifiés, 8 fichiers non suivis, index vide. Tous appartiennent au chatbot NVA, à ses tests ou à sa documentation. Aucune modification NovanceTech.
- Git portable retrouvé sous `tmp/git-repair-tools/mingit/cmd/git.exe`, version 2.56.0.windows.2. Il n'est pas livré.
- Contrôles : noms de fichiers sensibles interdits, motifs de clés et URL avec identifiants, comparaison des candidats avec les valeurs de secrets du `.env` local sans les afficher, revue des différences et des nouveaux fichiers. Aucune correspondance réelle détectée. Quatre URL de tests localhost portent le mot de passe factice `synthetic` ; ce ne sont pas des identifiants de production.
- Aucun `.env`, `.env.*`, clé privée, sauvegarde, donnée, journal, répertoire `tmp`, `output`, `.aws` ou `.codex` dans les changements à commiter. Le modèle `.env.example` déjà suivi reste inchangé.
- `git diff --check` validé ; seule une ligne vide terminale superflue a été retirée d'un test pendant la préparation.
- Tests relancés : audit 49/49, conversation 105/105, livraison/régression 416/416. Total de 570 résultats de tests, sans prétendre qu'ils sont tous distincts. Aucun test réel Meta/OpenAI/PostgreSQL.
- Aucun changement de dépendance ni de schéma Prisma : aucune migration ajoutée. Aucun changement d'environnement ou de configuration PM2 prévu.

Le périmètre exact et les empreintes Git des fichiers livrés sont dans `deploy/whatsapp-chatbot/nva-ai-delivery-manifest.json`. Le manifeste et le présent rapport complètent les 23 fichiers initiaux, soit **25 fichiers** pour le commit proposé. Les journaux de contrôle restent dans `tmp/nva-delivery-*.txt/json`, exclus de Git.

## Commit et publication GitHub

État de préparation : branche locale créée, 25 fichiers indexés et empreintes de leurs contenus contrôlées. Aucun changement hors index ni fichier non suivi à livrer ne subsiste. Le commit n'est pas encore créé : Git ne dispose d'aucun nom ni e-mail d'auteur configuré et cette identité a été demandée au propriétaire. Les fichiers sont prêts ; ne pas inventer une identité pour franchir cette étape.

La branche de livraison prévue est `release/nva-whatsapp-ai-20261029`. Le commit doit contenir uniquement les 25 chemins du manifeste, sans ajout global. Son parent est la base synchronisée ci-dessus. L'identité de commit doit être confirmée par le propriétaire lorsqu'elle n'est pas configurée ; aucune identité d'auteur ne doit être inventée.

Après création du commit, relever son SHA et vérifier le contenu :

```powershell
$Git = 'D:\English-center\tmp\git-repair-tools\mingit\cmd\git.exe'
Set-Location D:\English-center
& $Git status --short --untracked-files=all
& $Git show --format=fuller --stat HEAD
& $Git diff-tree --no-commit-id --name-only -r HEAD
& $Git diff HEAD^ HEAD --check
$ReleaseCommit = (& $Git rev-parse HEAD).Trim()
```

Avant toute publication, refaire la vérification distante : un contrôle antérieur n'est pas un verrou sur GitHub. Les commandes suivantes sont **préparées, non exécutées par ce dossier** :

```powershell
# Seulement après accord de publication.
& $Git fetch --no-tags origin
if ($LASTEXITCODE -ne 0) { throw 'Vérification distante échouée' }
& $Git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'main distant a divergé : intégrer et retester avant publication' }
& $Git ls-remote --exit-code origin refs/heads/release/nva-whatsapp-ai-20261029
# L'absence de branche renvoie 2. Si elle existe, examiner son SHA et son historique.
# Ne jamais utiliser --force, --force-with-lease ni une refspec préfixée par +.
& $Git push --dry-run origin HEAD:refs/heads/release/nva-whatsapp-ai-20261029
if ($LASTEXITCODE -ne 0) { throw 'Push de contrôle refusé' }
& $Git push --set-upstream origin HEAD:refs/heads/release/nva-whatsapp-ai-20261029
```

Un push normal refuse une mise à jour non fast-forward. En cas de nouveaux commits distants, s'arrêter, intégrer les changements dans une copie de travail préservant les modifications et relancer les trois suites. Ne pas réinitialiser ou réécrire l'historique distant. Publier une branche de revue ne déploie pas le serveur.

## 1. Inventaire Contabo — uniquement après accord d'accès au serveur

Ouvrir une session SSH avec le compte qui possède les processus NVA. Renseigner les chemins et noms **après vérification**, sans reprendre automatiquement ceux d'un ancien guide :

```bash
set -euo pipefail
umask 077
PROD=/CHEMIN_NVA_CONFIRME
test -d "$PROD/.git"
PROD=$(realpath "$PROD")
test "$PROD" != / && test "$PROD" != /home && test "$PROD" != /srv
cd "$PROD"
pm2 list
# Ne pas afficher pm2 env ni exporter pm2 jlist sans filtrage : ils peuvent contenir des secrets.
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{for(const p of JSON.parse(s)){const e=p.pm2_env;console.log(JSON.stringify({name:p.name,id:p.pm_id,cwd:e.pm_cwd,script:e.pm_exec_path,status:e.status}));}})'
git branch --show-current
git rev-parse HEAD
git status --short --untracked-files=all
```

Identifier uniquement le web NVA et son worker. Ne pas toucher aux processus NovanceTech. Si PM2 montre des chemins ambigus ou des workers supplémentaires, arrêter la préparation et documenter leur rôle avant de continuer.

## 2. Sauvegarder l'état serveur exact avant comparaison

Créer une zone privée **hors du répertoire applicatif**. Ces sauvegardes restent sur Contabo ; ne jamais les ajouter au commit ou les publier.

```bash
WORK=$(mktemp -d "$HOME/nva-delivery-20261029-XXXXXX")
chmod 700 "$WORK"
mkdir "$WORK/before" "$WORK/review"
git rev-parse HEAD > "$WORK/before/head.txt"
git status --porcelain=v1 --untracked-files=all > "$WORK/before/status.txt"
git diff --binary > "$WORK/before/worktree.patch"
git diff --cached --binary > "$WORK/before/index.patch"
git ls-files --others --exclude-standard -z > "$WORK/before/untracked.paths"
git ls-files --cached --others --exclude-standard -z > "$WORK/before/source-known.paths"
# Les suppressions locales sont consignées dans status.txt ; ne pas demander
# à tar de lire ces chemins absents. Conserver les liens comme objets de sauvegarde.
node -e 'const fs=require("fs");for(const p of fs.readFileSync(process.argv[1],"utf8").split("\0").filter(Boolean)){try{fs.lstatSync(p)}catch(e){if(e.code==="ENOENT")continue;throw e}process.stdout.write(p+"\0")}' "$WORK/before/source-known.paths" > "$WORK/before/source.paths"
# Sauvegarde physique : les modifications et fichiers non suivis sont conservés,
# indépendamment du fait qu'ils aient été commités sur le serveur.
tar --exclude='.env' --exclude='.env.*' --exclude='*/.env' --exclude='*/.env.*' \
  --exclude='node_modules' --exclude='tmp' --exclude='output' \
  --exclude='public/uploads' --exclude='storage' --exclude='logs' \
  --null -T "$WORK/before/source.paths" -czf "$WORK/before/server-source.tar.gz"
sha256sum "$WORK/before/server-source.tar.gz" > "$WORK/before/server-source.tar.gz.sha256"
sha256sum -c "$WORK/before/server-source.tar.gz.sha256"
```

Les patches peuvent contenir des informations privées provenant du serveur : ne pas les afficher dans un rapport public. L'archive source exclut volontairement `.env`, données et fichiers téléversés ; elle ne remplace pas une sauvegarde des données. Conserver l'environnement actuel, qui n'est pas modifié par cette livraison.

Avant application, vérifier aussi une sauvegarde PostgreSQL via le mécanisme NVA existant. Si un service libpq de sauvegarde a déjà été configuré avec les autorisations nécessaires, l'équivalent est :

```bash
# Exemple conditionnel : service et .pgpass déjà configurés en privé.
# Aucun mot de passe ou DATABASE_URL dans les arguments ou dans l'historique shell.
PGSERVICE=nva_backup pg_dump --no-password --format=custom --file="$WORK/before/nva.dump"
pg_restore --list "$WORK/before/nva.dump" > "$WORK/before/nva-dump-contents.txt"
sha256sum "$WORK/before/nva.dump" > "$WORK/before/nva.dump.sha256"
```

Ne pas inventer une connexion de sauvegarde. Si aucun mécanisme validé n'est disponible, le préparer avant déploiement. Une restauration en base isolée reste la vraie vérification d'une sauvegarde ; ne pas restaurer la production pendant cette préparation.

## 3. Récupérer la livraison dans une copie distincte et comparer

Après publication approuvée sur GitHub, toujours après accord d'opération serveur :

```bash
BRANCH=release/nva-whatsapp-ai-20261029
TARGET=SHA_DU_COMMIT_DE_LIVRAISON_VERIFIE
REPO_URL=$(git -C "$PROD" remote get-url origin)
GIT_TERMINAL_PROMPT=0 git clone --no-checkout --single-branch --branch "$BRANCH" "$REPO_URL" "$WORK/review/repository"
CANDIDATE="$WORK/review/repository"
test "$(git -C "$CANDIDATE" rev-parse "origin/$BRANCH")" = "$TARGET"
git -C "$CANDIDATE" switch --detach "$TARGET"
MANIFEST="$CANDIDATE/deploy/whatsapp-chatbot/nva-ai-delivery-manifest.json"
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]));for(const p of m.deliveryPaths){if(p.startsWith("/")||p.split("/").includes("..")||! /^(src\/services\/whatsapp|tests\/|docs\/|deploy\/whatsapp-chatbot\/nva-ai-delivery-manifest\.json$|package\.json$)/.test(p))throw Error("Chemin non autorisé");console.log(p)}' "$MANIFEST" > "$WORK/delivery.paths"
```

Comparer les fichiers du manifeste entre production et candidate **avant tout remplacement**, y compris les fichiers présents sur le serveur mais absents localement. Un simple diff n'attribue pas les changements : utiliser un ancêtre Git commun fiable quand il existe et préserver les adaptations Contabo.

```bash
mkdir "$WORK/before/files" "$WORK/compare"
while IFS= read -r f; do
  mkdir -p "$WORK/before/files/$(dirname "$f")" "$WORK/compare/$(dirname "$f")"
  if test -e "$PROD/$f"; then
    test -f "$PROD/$f" && test ! -L "$PROD/$f"
    test "$(realpath "$PROD/$f")" = "$PROD/$f"
    cp -p -- "$PROD/$f" "$WORK/before/files/$f"
    sha256sum "$PROD/$f" >> "$WORK/before/touched.sha256"
    if diff -u -- "$PROD/$f" "$CANDIDATE/$f" > "$WORK/compare/$f.diff"; then :
    else rc=$?; test "$rc" -eq 1; fi
  else
    printf '%s\n' "$f" >> "$WORK/before/absent.paths"
  fi
done < "$WORK/delivery.paths"
```

Relire les différences dans cette zone privée. Reporter manuellement les adaptations serveur utiles dans la candidate ; ne pas accepter automatiquement toute la version GitHub. Toute nouvelle fusion change la candidate : la retester et enregistrer ses propres empreintes, différentes du manifeste initial si nécessaire.

## 4. Vérifier la candidate

Relire les scripts npm et le garde `tests/helpers/whatsappIsolationGuard.cjs`. Dans la copie candidate, sans `.env` de production ni lien vers `node_modules` de production :

```bash
cd "$CANDIDATE"
node --version
npm ci
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL -u NODE_OPTIONS npm run test:whatsapp:final-audit
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL -u NODE_OPTIONS npm run test:whatsapp:natural
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL -u NODE_OPTIONS npm run test:whatsapp:release
git diff --check
while IFS= read -r f; do sha256sum "$f"; done < "$WORK/delivery.paths" > "$WORK/approved-candidate.sha256"
```

Arrêter si une suite échoue ou si les adaptations serveur sont perdues. Aucun nouveau paquet ni migration n'est nécessaire pour cette refonte. Ne pas exécuter `npm test`, `prisma migrate reset` ou un script de nettoyage contre la production. Faire un essai Meta/OpenAI réel uniquement avec un numéro et un environnement de préproduction autorisés.

## 5. Application future — exige l'accord de déploiement

Le rapport, les différences fusionnées, les résultats et le plan de retour arrière doivent être relus avant cette étape. Prévoir une fenêtre de maintenance et empêcher les écritures concurrentes dans les fichiers NVA. Renseigner les seuls processus identifiés :

```bash
WEB=NOM_WEB_NVA_CONFIRME
WORKER=NOM_WORKER_NVA_CONFIRME
cd "$CANDIDATE"
sha256sum -c "$WORK/approved-candidate.sha256"
sha256sum -c "$WORK/before/touched.sha256"
# Vérifier aussi que les fichiers initialement absents sont toujours absents.
if test -f "$WORK/before/absent.paths"; then
  while IFS= read -r f; do test ! -e "$PROD/$f"; done < "$WORK/before/absent.paths"
fi
pm2 stop "$WEB" "$WORKER"
# Recontrôle après arrêt. Si une vérification échoue, reprendre les anciens
# processus sans remplacer les fichiers, puis refaire sauvegarde et comparaison.
sha256sum -c "$WORK/before/touched.sha256"
while IFS= read -r f; do
  test ! -L "$PROD/$f"
  mkdir -p "$PROD/$(dirname "$f")"
  test "$(realpath "$(dirname "$PROD/$f")")" = "$PROD/$(dirname "$f")"
  cp -- "$CANDIDATE/$f" "$PROD/$f"
done < "$WORK/delivery.paths"
cd "$PROD"
sha256sum -c "$WORK/approved-candidate.sha256"
pm2 restart "$WEB" "$WORKER"
pm2 list
```

Les empreintes approuvées sont relatives au répertoire candidate et vérifiées depuis PROD après copie. Les modifications Contabo fusionnées sont conservées ; cette procédure n'effectue aucun `git reset`, `git pull` ou nettoyage global. L'état Git serveur restera éventuellement modifié : documenter l'application et son SHA source, sans commiter d'adaptations contenant des secrets.

Vérifier la route de santé déjà utilisée sur NVA, l'état web/worker, les journaux filtrés et les scénarios : premier accueil unique à deux boutons, questions directes, prix, refus, nombres hors contexte, suivi FR/EN, inscription avec consentement, doublons et indisponibilité IA. Ne pas afficher les environnements PM2. Surveiller la reprise de l'inbox et les livraisons ; les messages incertains ne doivent pas être renvoyés manuellement.

## 6. Retour arrière ciblé

Si remplacement partiel, erreur de redémarrage ou régression, conserver web et worker arrêtés pendant la restauration :

```bash
pm2 stop "$WEB" "$WORKER"
while IFS= read -r f; do
  if test -f "$WORK/before/files/$f"; then
    cp -p -- "$WORK/before/files/$f" "$PROD/$f"
  fi
done < "$WORK/delivery.paths"
# Retirer uniquement les fichiers ajoutés par cette livraison et absents avant elle.
# Le chemin relatif doit être dans la liste validée ; aucune suppression récursive.
if test -f "$WORK/before/absent.paths"; then
  while IFS= read -r f; do
    case "$f" in /*|*..*) exit 1;; esac
    grep -Fxq -- "$f" "$WORK/delivery.paths"
    test ! -L "$PROD/$f"
    rm -f -- "$PROD/$f"
  done < "$WORK/before/absent.paths"
fi
sha256sum -c "$WORK/before/touched.sha256"
pm2 restart "$WEB" "$WORKER"
pm2 list
```

Aucune restauration de base n'est normalement nécessaire : pas de migration dans cette livraison. Ne pas restaurer automatiquement une sauvegarde sur la production, car des inscriptions et messages nouveaux pourraient avoir été créés entre-temps. NovanceTech reste hors périmètre pendant toutes les étapes.
