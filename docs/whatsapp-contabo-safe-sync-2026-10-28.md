# NVA — préparation de synchronisation Contabo, 28 octobre 2026

**Aucun accès Contabo, transfert, arrêt ou déploiement exécuté.** Les commandes ci-dessous sont une procédure à exécuter ultérieurement, par étapes. Les blocs « application » et « retour arrière » modifient la production et nécessitent une autorisation de déploiement distincte.

## Revue locale

Le fichier `.git/HEAD` référence `refs/heads/main`, dont la référence locale vaut `5c465e1c066f044fff601615849ebe76c3334157`. Git étant absent du PATH et des emplacements Windows habituels, cela ne constitue pas un `git status` : ni le nombre exact de modifications ni leur diff contre HEAD n'ont pu être certifiés.

Le rapport `docs/whatsapp-audit-conversation-2026-10-28.md` liste **six** fichiers, probablement cinq fichiers existants modifiés et un nouveau test (à confirmer avec Git) :

| Fichier | Correction observée / rôle |
| --- | --- |
| `src/services/whatsappConversationEngine.js` | Classification sociale, dont Hi ; salutations et remerciements avant QUESTION_AI, après consentement, pause et transfert humain. |
| `src/services/whatsappAdmissionJourney.js` | Accueil initial et retour ; boutons S’inscrire / Menu / Poser une question ; conservation des étapes de collecte. Le menu remet le mode IA à zéro ; les remerciements conservent le mode courant. |
| `src/services/whatsappCommercialIntents.js` | Hi reconnu comme GREETING. |
| `src/services/whatsappCommercialResponder.js` | Reprise de pendingIntents seulement lorsque le message ne porte pas une nouvelle intention reconnue. |
| `tests/whatsappAdmissions.test.js` | Assertions du menu initial / retour et du parcours existant. |
| `tests/whatsappSocialRouting.test.js` | Régressions sociales, conservation de la collecte, priorité du nouveau sujet. |

Les journaux locaux `tmp/whatsapp-audit-release.txt` et `tmp/whatsapp-audit-tests.txt` confirment 415/415 et 101/101, zéro échec. Ces suites se recoupent. Elles ne prouvent pas la compatibilité avec les adaptations de Contabo. Le test social doit être exécuté séparément : il n'est pas dans `test:whatsapp:release`.

Le périmètre d'exécution est de **quatre services**. Les deux tests servent à la validation hors production ; ils ne sont pas nécessaires au fonctionnement des processus PM2. Aucun changement de dépendances, migration, configuration PM2 ou variable d'environnement n'est requis par ces corrections. La configuration PM2 locale nomme `english-center` : **ne pas la transférer ni l'utiliser sur Contabo**.

Limites du rapport confirmées : tests avec adaptateurs simulés ; absence de validation Meta/OpenAI/PostgreSQL réelle ; boutons conditionnés par les réglages d'admission déjà présents. Ne pas modifier ces réglages dans cette opération. Les textes commerciaux présents dans les fichiers ne doivent pas remplacer des adaptations de production par simple copie intégrale.

## 1. Préparer un paquet local à liste fermée (PowerShell)

Remplacer uniquement l'adresse SSH. Ces commandes sont fournies, pas exécutées. Ne pas compresser le projet entier, les journaux, `.git`, `.env`, `storage`, des exports ou des sauvegardes.

```powershell
Set-Location D:\English-center
$Contabo = 'agamba@ADRESSE_CONTABO'
$Bundle = 'tmp/nva-whatsapp-review-20261028.tar.gz'
$Files = @(
  'src/services/whatsappConversationEngine.js',
  'src/services/whatsappAdmissionJourney.js',
  'src/services/whatsappCommercialIntents.js',
  'src/services/whatsappCommercialResponder.js',
  'tests/whatsappAdmissions.test.js',
  'tests/whatsappSocialRouting.test.js'
)
# Si Git est disponible dans votre terminal : vérifier les écarts avant de poursuivre.
git branch --show-current
git status --short
git diff --stat
git diff -- $Files
git diff --cached -- $Files
# Examiner également le contenu du nouveau test s'il est non suivi.
Get-Content tests/whatsappSocialRouting.test.js -Encoding UTF8
# Relire les six fichiers : aucun secret ou donnée réelle ne doit y figurer.
$Files | ForEach-Object { Get-FileHash -Algorithm SHA256 -LiteralPath $_ }
tar -czf $Bundle -- $Files
if ($LASTEXITCODE -ne 0) { throw 'Création du paquet échouée' }
tar -tzf $Bundle
Get-FileHash -Algorithm SHA256 $Bundle
```

Si Git signale d'autres modifications, les inventorier sans les ajouter au paquet. Si la branche n'est pas main, comprendre pourquoi avant de poursuivre ; ne pas lancer de checkout forcé. Ne pas utiliser `git pull`, `reset --hard`, `clean`, copie globale ou `rsync --delete` sur la production.

## 2. Inventorier et sauvegarder sur Contabo (Bash)

Ouvrir SSH sous le compte qui possède les processus PM2, normalement agamba :

```powershell
ssh $Contabo
```

Dans cette session Bash, conserver les variables jusqu'à la fin :

```bash
set -euo pipefail
umask 077
PROD=/home/agamba/apps/nva
test "$(realpath "$PROD")" = "$PROD"
cd "$PROD"
test "$(git branch --show-current)" = main
git rev-parse HEAD
git status --short
git diff --stat
git diff --cached --stat
pm2 list
# Affichage filtré : ne pas exporter pm2 jlist / pm2 env, qui contiennent des secrets.
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const a=JSON.parse(s);for(const name of ["nva","nva-whatsapp-worker"]){const p=a.filter(p=>p.name===name);if(!p.length)throw Error("Processus absent: "+name);for(const q of p){const e=q.pm2_env;if(e.pm_cwd!=="/home/agamba/apps/nva"||e.status!=="online")throw Error("CWD ou statut incorrect: "+name);console.log(JSON.stringify({name:q.name,id:q.pm_id,cwd:e.pm_cwd,script:e.pm_exec_path,status:e.status}));}}});'

WORK=$(mktemp -d /home/agamba/nva-whatsapp-review-20261028-XXXXXX)
chmod 700 "$WORK"
printf 'Répertoire de travail : %s\n' "$WORK"
mkdir "$WORK/before" "$WORK/local" "$WORK/candidate"
FILES=(src/services/whatsappConversationEngine.js src/services/whatsappAdmissionJourney.js src/services/whatsappCommercialIntents.js src/services/whatsappCommercialResponder.js)
for f in "${FILES[@]}"; do
  test -f "$f" && test ! -L "$f"
  test "$(realpath "$f")" = "$PROD/$f"
  mkdir -p "$WORK/before/$(dirname "$f")"
  cp -p -- "$f" "$WORK/before/$f"
done
sha256sum "${FILES[@]}" > "$WORK/before.sha256"
git rev-parse HEAD > "$WORK/production-head.txt"
git status --short > "$WORK/production-status.txt"
tar -C "$WORK/before" -czf "$WORK/production-before.tar.gz" -- "${FILES[@]}"
tar -tzf "$WORK/production-before.tar.gz"
(cd "$WORK/before" && sha256sum -c "$WORK/before.sha256")
```

Vérifier les scripts PM2 affichés : serveur NVA et worker WhatsApp attendus. Si une vérification échoue, s'arrêter ; ne pas adapter les chemins automatiquement. Les fichiers de production, y compris leurs modifications non commitées, sont sauvegardés tels quels, indépendamment de Git. Garder le chemin WORK pour le retour arrière. La sauvegarde reste sur Contabo, privée, et n'inclut aucun `.env` ni export de base.

## 3. Transférer vers la zone de revue uniquement

Dans un second terminal PowerShell, recopier le chemin WORK affiché :

```powershell
$RemoteWork = '/home/agamba/nva-whatsapp-review-20261028-REMPLACER'
scp $Bundle "${Contabo}:${RemoteWork}/local.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Transfert échoué' }
```

Dans la session Bash initiale :

```bash
sha256sum "$WORK/local.tar.gz"
# Comparer cette empreinte avec celle affichée par Get-FileHash.
tar -tzf "$WORK/local.tar.gz"
# La liste doit être exactement les six chemins de l'étape 1, aucun lien.
tar -tvzf "$WORK/local.tar.gz"
# Après vérification de la liste, des types et de l'empreinte uniquement :
tar --no-same-owner --no-same-permissions -xzf "$WORK/local.tar.gz" -C "$WORK/local"
for f in "${FILES[@]}"; do
  if diff -u -- "$WORK/before/$f" "$WORK/local/$f"; then
    printf 'Identique : %s\n' "$f"
  else
    rc=$?; test "$rc" -eq 1
  fi
done
```

Un diff local/serveur n'indique pas qui a modifié quoi. Pour attribuer les écarts, comparer aussi avec un ancêtre Git commun confirmé si disponible. Un simple HEAD serveur n'est pas nécessairement cet ancêtre. Sans ancêtre fiable, effectuer une fusion manuelle contrôlée.

## 4. Construire la version fusionnée depuis Contabo

La copie candidate part du code **serveur**. Aucun écrasement des quatre services par la copie locale. Examiner au préalable les sources/tests pour s'assurer qu'ils ne contiennent pas de secrets en dur ; ne pas afficher leurs contenus dans un canal public.

```bash
cd "$PROD"
test -d node_modules
test -f tests/helpers/whatsappIsolationGuard.cjs
test -f prisma/schema.prisma
# Cette copie reste privée sur Contabo. Elle n'inclut pas .env ou les données.
cp -a src tests "$WORK/candidate/"
mkdir "$WORK/candidate/prisma"
cp -p prisma/schema.prisma "$WORK/candidate/prisma/"
cp -p package.json "$WORK/candidate/"
ln -s "$PROD/node_modules" "$WORK/candidate/node_modules"
# Examiner aussi les différences des deux tests ; préserver leurs adaptations serveur.
for f in tests/whatsappAdmissions.test.js tests/whatsappSocialRouting.test.js; do
  if test -f "$PROD/$f"; then
    if diff -u -- "$PROD/$f" "$WORK/local/$f"; then :; else rc=$?; test "$rc" -eq 1; fi
  fi
done
```

Avec l'éditeur, reporter uniquement les corrections sociales décrites dans la revue, conserver toutes les adaptations serveur et fusionner les assertions utiles. Exemple de commande pour ouvrir chaque paire :

```bash
vim -d "$WORK/candidate/src/services/whatsappConversationEngine.js" "$WORK/local/src/services/whatsappConversationEngine.js"
vim -d "$WORK/candidate/src/services/whatsappAdmissionJourney.js" "$WORK/local/src/services/whatsappAdmissionJourney.js"
vim -d "$WORK/candidate/src/services/whatsappCommercialIntents.js" "$WORK/local/src/services/whatsappCommercialIntents.js"
vim -d "$WORK/candidate/src/services/whatsappCommercialResponder.js" "$WORK/local/src/services/whatsappCommercialResponder.js"
vim -d "$WORK/candidate/tests/whatsappAdmissions.test.js" "$WORK/local/tests/whatsappAdmissions.test.js"
# Si le test social n'existe pas côté serveur, le créer ; sinon le fusionner également.
if ! test -e "$WORK/candidate/tests/whatsappSocialRouting.test.js"; then
  cp -p "$WORK/local/tests/whatsappSocialRouting.test.js" "$WORK/candidate/tests/"
else
  vim -d "$WORK/candidate/tests/whatsappSocialRouting.test.js" "$WORK/local/tests/whatsappSocialRouting.test.js"
fi
```

Ne pas utiliser une commande qui accepte automatiquement tout le fichier local. La décision de fusion est humaine et dépend des écarts encore inconnus. Si une dépendance fonctionnelle manque côté serveur, arrêter et étendre explicitement la revue ; ne pas transférer d'autres modules automatiquement.

Valider la candidate sans démarrer de serveur ou worker. Vérifier le script npm et le garde d'isolation avant exécution, notamment qu'ils interdisent PostgreSQL/Prisma réels et fetch. Si le garde diffère de la version locale examinée, le relire et résoudre cela avant les tests. Ne pas installer de dépendances via le lien node_modules.

```bash
cd "$WORK/candidate"
node --version
node -p 'JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts["test:whatsapp:release"]'
cat tests/helpers/whatsappIsolationGuard.cjs
for f in "${FILES[@]}"; do node --check "$f"; done
env -u NODE_OPTIONS -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL npm run test:whatsapp:release > "$WORK/release-tests.txt" 2>&1
env -u NODE_OPTIONS -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappSocialRouting.test.js tests/whatsappAdmissions.test.js tests/whatsappQuestionAI.test.js tests/whatsappV3Corrections.test.js > "$WORK/targeted-tests.txt" 2>&1
tail -n 12 "$WORK/release-tests.txt"
tail -n 12 "$WORK/targeted-tests.txt"
for f in "${FILES[@]}"; do
  if diff -u -- "$WORK/before/$f" "$WORK/candidate/$f"; then :; else rc=$?; test "$rc" -eq 1; fi
done
sha256sum "${FILES[@]}" > "$WORK/approved-candidate.sha256"
```

Les tests doivent tous réussir ; les effectifs peuvent différer si Contabo possède d'autres tests. Relire le dernier diff : il doit contenir seulement les corrections voulues, sans disparition des adaptations Contabo. C'est ce résultat fusionné et testé qui pourra être autorisé. Ne pas copier de `.env` dans la candidate ; ne pas lancer les scripts PostgreSQL, de nettoyage ou de migration. En cas de fixture manquante, arrêter et préparer une validation isolée adaptée.

## 5. Application future — NE PAS EXÉCUTER maintenant

Prévoir une courte fenêtre d'indisponibilité ; suspendre les autres éditeurs/déploiements de NVA. Les livraisons entrantes peuvent être retentées par Meta : surveiller leur reprise. Les quatre remplacements ne sont pas atomiques en groupe, donc les deux processus doivent être arrêtés pendant l'opération. Ne jamais utiliser `pm2 restart all`, le fichier ecosystem local ou `--update-env`.

Dans la même session Bash, après autorisation et revue :

```bash
cd "$WORK/candidate"
sha256sum -c "$WORK/approved-candidate.sha256"
cd "$PROD"
sha256sum -c "$WORK/before.sha256"
# Si une empreinte serveur a changé : STOP, nouvelle sauvegarde et nouvelle fusion.
pm2 stop nva nva-whatsapp-worker
# Recontrôler après arrêt, avant toute écriture.
sha256sum -c "$WORK/before.sha256"
for f in "${FILES[@]}"; do
  test ! -L "$PROD/$f"
  test "$(realpath "$PROD/$f")" = "$PROD/$f"
  # Écriture dans le fichier existant : conserve propriétaire et permissions.
  cat "$WORK/candidate/$f" > "$PROD/$f"
done
sha256sum -c "$WORK/approved-candidate.sha256"
pm2 restart nva nva-whatsapp-worker
pm2 list
```

Si une commande échoue après l'arrêt, ne pas reprendre aveuglément : restaurer avec l'étape 6. Ne pas lancer `pm2 save`, `npm install`, `npm ci`, `git pull` ou une migration dans ce déploiement. Les tests fusionnés restent dans WORK pour validation ; seuls les quatre services sont appliqués.

Après redémarrage : contrôler les deux processus et consulter leurs journaux **sur le serveur**, sans exporter les messages, numéros ou secrets. Commandes ciblées :

```bash
pm2 logs nva --lines 50 --nostream
pm2 logs nva-whatsapp-worker --lines 50 --nostream
```

Sur un numéro de test autorisé : premier contact ; question IA puis Bonjour/Hi répétés ; Merci ; ancienne question d'essai puis nouvelle question de durée ; trois boutons ; collecte en cours ; STOP ; transfert humain ; absence de doublons et reprise du worker. Un numéro de préproduction est préférable pour la première validation Meta réelle. Le retour arrière du code n'annule pas les messages déjà envoyés ni les conversations modifiées entre-temps.

## 6. Retour arrière ciblé

Utiliser le WORK de cette opération, pas « la dernière sauvegarde » devinée. Si la session a été fermée, rétablir explicitement PROD, WORK et FILES avec leurs valeurs ci-dessus. Avant restauration, si des modifications ultérieures ont eu lieu, les examiner : ne pas les écraser automatiquement.

```bash
set -euo pipefail
cd "$WORK/before"
sha256sum -c "$WORK/before.sha256"
cd "$PROD"
# Doit correspondre à la candidate appliquée ; sinon revue manuelle obligatoire.
sha256sum -c "$WORK/approved-candidate.sha256"
pm2 stop nva nva-whatsapp-worker
for f in "${FILES[@]}"; do
  test ! -L "$PROD/$f"
  test "$(realpath "$PROD/$f")" = "$PROD/$f"
  cat "$WORK/before/$f" > "$PROD/$f"
done
sha256sum -c "$WORK/before.sha256"
pm2 restart nva nva-whatsapp-worker
pm2 list
```

Cas d'application partielle : le contrôle approved-candidate échouera normalement. Après avoir confirmé qu'aucun autre intervenant n'a modifié NVA, cette variante accepte uniquement des fichiers encore identiques à before ou à candidate :

```bash
cd "$PROD"
(cd "$WORK/before" && sha256sum -c "$WORK/before.sha256")
(cd "$WORK/candidate" && sha256sum -c "$WORK/approved-candidate.sha256")
for f in "${FILES[@]}"; do
  if cmp -s "$PROD/$f" "$WORK/before/$f"; then continue; fi
  if cmp -s "$PROD/$f" "$WORK/candidate/$f"; then continue; fi
  printf 'ARRÊT : fichier divergent ou tronqué à examiner : %s\n' "$f" >&2
  exit 1
done
pm2 stop nva nva-whatsapp-worker
for f in "${FILES[@]}"; do
  test ! -L "$PROD/$f"
  test "$(realpath "$PROD/$f")" = "$PROD/$f"
  cat "$WORK/before/$f" > "$PROD/$f"
done
sha256sum -c "$WORK/before.sha256"
pm2 restart nva nva-whatsapp-worker
pm2 list
```

Un fichier tronqué par une erreur d'écriture exige une inspection avant restauration ciblée ; cette variante s'arrête volontairement dans ce cas. Vérifier ensuite les journaux ciblés et la reprise de NVA. Aucune autre application ni configuration globale du serveur n'est touchée.
