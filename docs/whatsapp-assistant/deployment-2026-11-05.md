# Déploiement et retour arrière — exécution manuelle uniquement

Le serveur n’a pas été inspecté depuis cet environnement. Les commandes ci-dessous sont adaptées aux chemins indiqués mais doivent être précédées de la comparaison et de la revue des noms/scripts PM2. Ne lancer aucune commande sur NovanceTech. Ne pas utiliser `pm2 restart all`, `git reset --hard`, `git clean` ou une migration en production.

## Préparation locale

Créer une branche/commit revu contenant seulement les changements souhaités, sans secrets et en préservant les modifications antérieures. Ne pas empaqueter `.env.example` supprimé, les backups ou tout le répertoire de travail sans revue. Les fichiers applicatifs concernés par cette intervention :

```
src/config/nvaAssistantPrompt.js
src/services/whatsappAdmissionJourney.js
src/services/whatsappConversationEngine.js
src/services/whatsappConversationService.js
src/services/whatsappQuestionAIService.js
src/services/whatsappQuestionAICompletionService.js
src/services/whatsappAdvisorPolicy.js
src/services/whatsappCommercialResponder.js
src/services/whatsappRegistrationTransition.js
```

Les tests modifiés/ajoutés : `tests/whatsappNaturalAssistant.test.js`, `tests/whatsappQuestionAI.test.js`, `tests/metaInboxWorker.test.js`. AdvisorPolicy conserve ses modifications antérieures ; deux préférences explicites de langue (« en français », « en anglais ») ont été corrigées. Les tests Admissions, AdvisorV3, V3Corrections et ConversationPersistence ont aussi été adaptés au nouveau contrat et aux données persistantes.

Commandes de validation (Node installé normalement ; sur cette machine, le binaire direct est `/snap/node/current/bin/node`) :

```bash
npm ci --ignore-scripts --no-audit --no-fund
npx prisma generate
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test --test-isolation=none tests/whatsappNaturalAssistant.test.js tests/whatsappQuestionAI.test.js tests/metaInboxWorker.test.js
npm run test:whatsapp:release
npm run test:whatsapp:v3
```

Aucun changement de dépendance ni de schéma livré. Le test des valeurs de déploiement désactivées utilise le fichier PM2 candidate existant ; `.env.example`, déjà supprimé, n’est pas recréé.

## Inspection Contabo sans modification applicative

À exécuter dans une session opérateur déjà connectée au bon serveur :

```bash
cd /home/agamba/apps/nva
pwd
hostname
node --version
npm --version
git branch --show-current
git rev-parse HEAD
git status --short
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{for(const p of JSON.parse(s)){if(["nva","nva-whatsapp-worker"].includes(p.name))console.log(JSON.stringify({id:p.pm_id,name:p.name,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path,status:p.pm2_env.status}));}})'
```

Cette sortie filtre les informations PM2 ; ne pas copier le JSON brut, qui contient les variables et secrets. Si les noms diffèrent, identifier manuellement les seuls processus dont le chemin est `/home/agamba/apps/nva`. Confirmer quel script exécute l’inbox durable et quel processus assure réellement la livraison.

Pour comparer une révision candidate déjà disponible dans le dépôt serveur :

```bash
NVA_CANDIDATE_SHA='<SHA_COMPLET_REVU>'
git cat-file -e "$NVA_CANDIDATE_SHA^{commit}"
git diff --stat HEAD "$NVA_CANDIDATE_SHA" -- src tests
git diff HEAD -- src/services/whatsappAdmissionJourney.js src/services/whatsappAdvisorPolicy.js src/services/whatsappConversationEngine.js src/services/whatsappConversationService.js src/services/whatsappQuestionAIService.js
```

Ne pas afficher les fichiers `.env`. Toute différence serveur non sauvegardée doit être conservée et fusionnée dans la candidate, dans une copie de travail isolée. Ne pas appliquer automatiquement un checkout par-dessus des changements locaux. Contrôler les réglages actifs côté application et worker sans imprimer de clé : modèle, timeout, quota, flags, droits SQL, paramètres Meta et base dédiée NVA.

## Sauvegarde et application après autorisation explicite

Prérequis : révision candidate testée, modifications serveur intégrées, aucun échec de régression inexpliqué, tests conversationnels de préproduction satisfaisants. Les commandes ci-dessous ne sont pas une autorisation de déployer.

```bash
cd /home/agamba/apps/nva
NVA_CANDIDATE_SHA='<SHA_COMPLET_REVU>'
NVA_APP_PROCESS='nva'
NVA_WORKER_PROCESS='nva-whatsapp-worker'
NVA_BACKUP_DIR="/home/agamba/backups/nva-assistant-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$NVA_BACKUP_DIR"
git rev-parse HEAD > "$NVA_BACKUP_DIR/base-sha.txt"
git diff --binary HEAD -- src > "$NVA_BACKUP_DIR/server-src.patch"
tar -czf "$NVA_BACKUP_DIR/src-before.tgz" src
git status --short > "$NVA_BACKUP_DIR/status.txt"
printf '%s\n' "$NVA_BACKUP_DIR"
```

Conserver ce chemin pour le rollback. La sauvegarde `src` couvre les fichiers non suivis ; le patch seul ne le fait pas. Les chemins et scripts PM2 doivent avoir été validés avant les commandes suivantes. Planifier l’interruption des seuls processus NVA pour éviter une lecture de fichiers partiellement remplacés :

```bash
pm2 stop "$NVA_WORKER_PROCESS"
pm2 stop "$NVA_APP_PROCESS"
git restore --source="$NVA_CANDIDATE_SHA" --worktree -- src/config/nvaAssistantPrompt.js src/services/whatsappAdmissionJourney.js src/services/whatsappConversationEngine.js src/services/whatsappConversationService.js src/services/whatsappQuestionAIService.js src/services/whatsappQuestionAICompletionService.js src/services/whatsappAdvisorPolicy.js src/services/whatsappCommercialResponder.js src/services/whatsappRegistrationTransition.js
node --check src/config/nvaAssistantPrompt.js
node --check src/services/whatsappQuestionAIService.js
node --check src/services/whatsappConversationEngine.js
node --check src/services/whatsappAdmissionJourney.js
node --check src/services/whatsappQuestionAICompletionService.js
node --check src/services/whatsappAdvisorPolicy.js
node --check src/services/whatsappConversationService.js
pm2 restart "$NVA_APP_PROCESS"
pm2 restart "$NVA_WORKER_PROCESS"
pm2 logs "$NVA_WORKER_PROCESS" --lines 80 --nostream
```

Aucune installation ni migration de production nécessaire pour ces changements. Les variables doivent déjà être définies dans la configuration réellement utilisée. Modifier une configuration de secrets ou recharger l’environnement suit le mécanisme serveur existant ; ne pas remplacer le fichier PM2 par `ecosystem.config.cjs`, dont le nom historique est `english-center`, ni par le fichier candidate désactivé.

Vérifier le healthcheck déjà utilisé par l’application, la réception du numéro pilote, les deux boutons, une conversation complète et les catégories de logs. Les tests d’intégration ne doivent pas créer de données métier de production. Aucun script de seed ni de reset de base.

## Retour arrière

Utiliser le chemin imprimé pendant la sauvegarde ; arrêter si ce chemin ou les archives ne sont pas vérifiables. Restaurer uniquement les neuf fichiers applicatifs, pas tout `src` ni un autre service :

```bash
cd /home/agamba/apps/nva
NVA_BACKUP_DIR='<CHEMIN_SAUVEGARDE_VERIFIE>'
NVA_APP_PROCESS='nva'
NVA_WORKER_PROCESS='nva-whatsapp-worker'
tar -tzf "$NVA_BACKUP_DIR/src-before.tgz"
pm2 stop "$NVA_WORKER_PROCESS"
pm2 stop "$NVA_APP_PROCESS"
tar -xzf "$NVA_BACKUP_DIR/src-before.tgz" src/services/whatsappAdmissionJourney.js src/services/whatsappConversationEngine.js src/services/whatsappConversationService.js src/services/whatsappQuestionAIService.js src/services/whatsappQuestionAICompletionService.js src/services/whatsappAdvisorPolicy.js src/services/whatsappCommercialResponder.js
pm2 restart "$NVA_APP_PROCESS"
pm2 restart "$NVA_WORKER_PROCESS"
pm2 logs "$NVA_WORKER_PROCESS" --lines 80 --nostream
```

Si `src/config/nvaAssistantPrompt.js` ou `src/services/whatsappRegistrationTransition.js` existait avant la mise à jour, restaurer également ces fichiers depuis l’archive. S’il était nouveau, le laisser non référencé est sans effet ; sa suppression n’est pas nécessaire au rollback. Il n’y a aucun rollback SQL. L’état persistant supplémentaire `welcomeSentAt` et le mode IA sont compatibles avec la lecture historique, mais les réponses déjà envoyées ne sont pas annulables. Les réponses encore en attente peuvent suivre l’ancien générateur après rollback : surveiller leur traitement.

## Complément : transition inscription (prompt 2026-11-05.2)

Le déploiement doit inclure ensemble Engine, ConversationService, QuestionAIService, QuestionAICompletionService, AdmissionJourney, CommercialResponder, RegistrationTransition et le prompt .2. Ne pas remplacer uniquement le prompt ou le service OpenAI : la décision structurée exige son consommateur transactionnel et son schéma validé. Le modèle configuré doit supporter les sorties structurées JSON Schema. Aucun nouveau secret, réglage obligatoire ni migration SQL. Vérifier en préproduction la séquence « Comment je peux m’inscrire ? » → « Oui » → « Via WhatsApp », puis celle via le site. La commande explicite d’inscription fonctionne sans OpenAI. Le fichier `registration-transition-2026-11-05.md` décrit les limites de diagnostic de production et `registration-test-results.json` les résultats actuels. Le rollback restaure aussi CommercialResponder pour garder ses appels compatibles avec AdmissionJourney.
