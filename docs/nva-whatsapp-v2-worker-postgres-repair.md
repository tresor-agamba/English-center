# Correction PostgreSQL du worker NVA V2

25 octobre 2026. **Corrections locales et recette uniquement. Aucune connexion Contabo, mutation de production, modification d'identifiant ou émission WhatsApp.** Les diagnostics Contabo cités sont ceux fournis par le propriétaire, pas des mesures exécutées ici.

## Causes et niveau de certitude

`ONLINE` signifie que PM2 supervise un processus ; ce n'est pas la réussite de `worker.ready()`. Le CLI ne notifie `ready` qu'après la vérification SQL et celle de l'endpoint. Un processus relancé en boucle peut apparaître ONLINE entre deux échecs.

Les trois booléens fournis `SENDER_FORBIDDEN`, `STATUS_FORBIDDEN`, `EVENT_FORBIDDEN` sont incompatibles avec le rôle prévu : le worker ne peut attribuer un message à un conseiller, décider du statut d'une admission ou fabriquer librement un événement administratif. `has_column_privilege` inclut les droits de table et PUBLIC ; `has_any_column_privilege` inclut aussi les GRANT de colonne. Un rôle NOINHERIT n'élimine ni PUBLIC ni les droits directs. L'absence de memberships fournie exclut l'appartenance constatée, pas ces deux autres sources.

**La provenance exacte des GRANT de production n'est pas connue** : aucune sortie ACL/grantor n'a été fournie. Une ancienne version ou un octroi manuel large est plausible, pas démontré. Le script 10 identifie les sources sans les modifier. Le script 06 ancien révoquait seulement l'INSERT de table : il laissait subsister les UPDATE larges et les GRANT de colonne. Le bootstrap actuel de rôle est déjà restreint ; il refuse de recréer un rôle existant et ne peut pas servir de réparation.

La fonction de consentement est un objet SQL additionnel **hors des 47 migrations Prisma**. La migration admissions crée les tables, la séquence et `confirmationDraft`, mais pas cette fonction. Appliquer les migrations ne l'installe donc pas. Son absence rend l'appel par signature texte à `has_function_privilege` susceptible de lever 42883 ; les privilèges excessifs et cette absence doivent être corrigés, pas masqués.

Le garde conserve ses exigences d'identité/cible et d'isolement. Il utilise maintenant `to_regprocedure` et COALESCE : fonction absente => refus `META_WORKER_DATABASE_IDENTITY_REJECTED`, sans exception 42883. Ce changement n'autorise aucun privilège supplémentaire et ne remplace pas l'installation réelle.

## Fonction et correction

La fonction réelle conserve les événements `CONSENT_CONFIRMED` / `RECONFIRMED` seulement, un objet JSON limité à 4096 octets, la notice `admissions-v1` et une demande PENDING/PROCESSING. Elle n'écrit ni statut, ni compte, ni inscription, ni preuve e-mail ; l'événement inséré n'a pas d'adminId. Elle ne constitue pas une preuve cryptographique du consentement : le webhook signé, le moteur et les données de demande assurent le contexte amont. La metadata n'est pas une décision administrative.

SECURITY DEFINER et objets qualifiés `public`, search_path fixé à pg_catalog, aucun SQL dynamique dans la fonction. Son propriétaire approuvé doit lire la demande, insérer dans les événements et utiliser la séquence ; ces droits restent chez ce propriétaire, pas chez le worker. Un verrou FOR SHARE conserve la demande ouverte contre une décision concurrente jusqu'à la fin de la transaction. Aucun hash étudiant, mot de passe ou création de compte n'est nécessaire.

- **09** installe/remplace la fonction dans une transaction, sous propriétaire explicitement confirmé et contrôlé (propriétaire des tables ou DBA). Refus d'un propriétaire existant différent ; refus de droits PUBLIC/ingress sur la fonction. Aucune réattribution automatique de propriétaire.
- **06** retire INSERT/UPDATE directs de table **et de toutes les colonnes** des trois relations concernées, puis restitue seulement les colonnes runtime déjà prévues. Retrait des droits directs de séquence des événements ; consentement via EXECUTE. Les droits administratifs de statut/auteur/affectation/conversion restent refusés. Aucun droit des autres rôles ni PUBLIC n'est révoqué.
- Si PUBLIC, ownership, une appartenance ou un octroi par un autre grantor empêche le résultat : erreur et **ROLLBACK**, sans correction globale improvisée. PostgreSQL n'a pas de DENY par rôle pour neutraliser PUBLIC. Il faudra un plan DBA séparé, protégeant explicitement tous les utilisateurs dépendants avant une éventuelle correction partagée.
- **07** reste conditionnel pour le rôle web réel ; ne pas lui substituer le worker. Pas de changement nécessaire du schéma Prisma, des mots de passe, des tables ou des migrations historiques.

09 et 06 sont deux transactions ordonnées : une fonction installée mais un 06 refusé n'autorise aucun redémarrage. Le worker doit rester arrêté pendant l'opération. Ne pas inclure ces fichiers dans une transaction externe en supposant que leurs COMMIT seront ignorés.

## Fichiers concernés

| Fichier | Modification |
| --- | --- |
| `src/services/metaInboxWorkerService.js` | Recherche de fonction absente sans 42883, garde toujours fermé. |
| `docs/sql/whatsapp-admission-worker-consent-function.sql` | Verrou partagé sur la demande ouverte contre une décision concurrente. |
| `deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql` | Réparation des droits de table et de colonne, restauration des listes runtime, assertions, délai de requête. |
| `deploy/whatsapp-chatbot/09-install-admission-consent.sql` | Installation transactionnelle, contrôle cible/propriétaire et ACL de fonction. |
| `deploy/whatsapp-chatbot/10-worker-grant-provenance-readonly.sql` | Diagnostic ACL table/colonne/grantor/PUBLIC/membership/default grants, sans secret. |
| `scripts/checkMetaInboxWorkerReady.js` | Sonde ready seule, envoi forcé faux, aucun polling/runOnce, fermeture après succès/échec. |
| `tests/metaInboxWorkerReadinessCheck.test.js` | Contrat de la sonde sans DB ou transport. |
| `scripts/validateNvaWorkerPermissionRepair.js` | Reproduction et réparation sur le seul laboratoire gardé ; données et rôle sonde annulés. |
| Ce rapport | Preuves, risques et procédure Contabo soumise à autorisation. |

Les services de conversation, admissions et le bootstrap de rôle existants ont été examinés : l'INSERT restreint de demande omet déjà les décisions et l'auteur ; les événements prospect passent déjà par la vraie fonction. Ne pas remplacer ces chemins par des GRANT larges. Aucun changement de logique commerciale ou d'interface administrative.

## Recette réellement exécutée

| Exécution | Résultat / preuve |
| --- | --- |
| Suites isolées ciblées worker/Meta/admissions/HTTP/livraison/préparation | **145/145**, aucun ignoré ; `output/nva-worker-postgres-repair-isolated.log`. Sous-ensemble de release, ne pas additionner. |
| Suite release isolée | **412/412**, zéro échec/ignoré ; `output/nva-worker-repair-release.log`. Chatbot historique/V2, sécurité webhook, moteur, livraison, administration et admissions couverts. |
| Nouvelle sonde ready | **2/2**, zéro échec/ignoré ; `output/nva-worker-readiness-check.log`. |
| Lanceur laboratoire complet | **46/46** contrôles Node (parents inclus) : métier 7, admin 20, readiness 6, Meta SQL/relais/ACL 13 ; 47 migrations compatibles. `output/nva-worker-repair-full-lab.log` et journaux `output/nva-whatsapp-v2-postgres-20261024/*-tests.log`. |
| Nouvelle réparation SQL | **13/13** contrôles ; `output/nva-worker-postgres-repair-results.json` et `.log`. |
| Diagnostic de provenance 10 | Exécuté par psql sur la base laboratoire, transaction READ ONLY et COMMIT réussis ; `output/nva-worker-grant-provenance-lab.log`. Ne décrit pas les ACL Contabo. |

La nouvelle recette connecte uniquement `127.0.0.1:58432/nva_whatsapp_v2_test` et vérifie le répertoire exact du cluster. Adaptations explicites : nom DB/port, rôle sonde aléatoire, expansion des commandes psql et transaction externe de nettoyage à la place des BEGIN/COMMIT des fichiers. Elle exécute le vrai SQL d'identité du service, pas une approximation de sa requête. Les tests reproduisent la fonction absente et les trois permissions interdites ; testent réparation répétable, rollback en présence de PUBLIC table/colonne et membership, installation, consentement réel sans admin, refus des actions administratives et demandes terminales, nettoyage du rôle/demande. Des trous de séquence sont possibles dans cette base fictive.

La recette complète vérifie aussi décisions concurrentes, échecs transactionnels, comptes vérifiés et relais. Elle ne prouve ni le contenu des autres modules sur Contabo ni la compatibilité de chaque intégration extérieure. Aucun test réel Meta/SMTP ou signal PM2 Linux exécuté. La nouvelle protection de verrouillage reste à mesurer sur une restauration représentative sous contention réelle.

Reproduction locale :

```powershell
$env:NVA_WORKER_REPAIR_LAB='isolated-permission-repair'
node scripts/validateNvaWorkerPermissionRepair.js
Remove-Item Env:NVA_WORKER_REPAIR_LAB
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/metaInboxWorkerReadinessCheck.test.js
```

## Procédure Contabo exacte — NE PAS EXÉCUTER sans autorisation distincte

Les chemins, service libpq existant et propriétaire doivent être confirmés ; aucune URL/mot de passe dans les commandes. Lancer les commandes une par une et arrêter au premier code non nul. Ne pas faire de déploiement global, Prisma migrate deploy, modification Meta ou action PM2 globale. Les artefacts candidats doivent être revus par empreinte, transférés uniquement après autorisation hors du répertoire actif. Le code corrigé requiert ensuite une promotion ciblée autorisée ; pas de remplacement silencieux des fichiers actifs.

### 1. Préconditions et preuves

Inventorier les processus par le lot [lecture seule](nva-whatsapp-v2-contabo-inspection.md), confirmer que le nom `nva-whatsapp-worker` désigne bien le worker Meta NVA en échec et non un service historique encore fonctionnel. Vérifier absence de second sender, endpoint/numéro Meta de test, rôles effectifs et environnement PM2 vs dotenv. Si arrêter ce processus interromprait un service actif non couvert par l'autorisation : ne pas poursuivre.

```bash
NVA_APP_DIR=/chemin/absolu/nva-confirme
NVA_SQL_DIR=/chemin/absolu/candidat-revu/deploy/whatsapp-chatbot
NVA_DB_SERVICE=service_libpq_DBA_existant_confirme
NVA_CONSENT_OWNER=proprietaire_tables_ou_DBA_approuve
NVA_APP_ROLE=role_web_reel_confirme
PGOPTIONS='-c default_transaction_read_only=on' psql -X -w "service=$NVA_DB_SERVICE" \
 -v expected_database=english_center -v nva_worker_role=nva_meta_inbox_worker_prod \
 -f "$NVA_SQL_DIR/10-worker-grant-provenance-readonly.sql"
```

Exécuter aussi 03/05/08 du préflight avec ces rôles pour l'historique, propriétaires, ACL et consentement. Conserver ces sorties **en privé** avec les permissions/grantors d'origine. Confirmer la source exacte des privilèges avant correction ; le présent rapport ne prétend pas l'avoir mesurée.

### 2. Sauvegardes et confinement de l'opération

Après autorisation de maintenance ciblée, arrêter uniquement le worker identifié, pour qu'une relance automatique ne commence pas à envoyer dès que les ACL deviennent valides :

```bash
pm2 stop nva-whatsapp-worker
```

Le web, l'administration et les autres services restent en place. Confirmer l'arrêt avec l'inspection de PID. Si un expéditeur historique dépend de la même base, conserver la réserve de coexistence du préflight : un endpoint Meta actif bloque son chemin sans barrière Meta. Ne pas promettre sa continuité sans topologie attestée.

Dans un répertoire privé **hors release et Git**, sauvegarder la release précédente, les fichiers SQL/code concernés, définition PM2/configuration protégées et références de clés. Ne pas afficher ni partager les fichiers contenant des secrets. Pour une nouvelle sauvegarde DB et le schéma/ACL (commandes futures, pas exécutées ici) :

```bash
umask 077
: "${NVA_BACKUP_DIR:?repertoire prive existant requis}"
pg_dump -w --format=custom --file="$NVA_BACKUP_DIR/nva-before-worker-repair.dump" "service=$NVA_DB_SERVICE"
pg_dump -w --schema-only --schema=public --file="$NVA_BACKUP_DIR/nva-before-worker-repair-schema.sql" "service=$NVA_DB_SERVICE"
sha256sum -- "$NVA_BACKUP_DIR/nva-before-worker-repair.dump" "$NVA_BACKUP_DIR/nva-before-worker-repair-schema.sql"
pg_restore --list "$NVA_BACKUP_DIR/nva-before-worker-repair.dump" >/dev/null
```

Exiger des chemins de sortie absents avant ces commandes pour ne pas écraser une sauvegarde. La sauvegarde complète reste privée et peut contenir les données réelles : ne pas la copier dans le laboratoire de développement sans anonymisation/autorisations adaptées. Aucun étudiant n'est modifié par le dump. La lecture du répertoire ne prouve pas une restauration ; exiger la répétition isolée et RPO/RTO acceptés.

### 3. Installation et ACL

Le service DBA doit ouvrir la session sous `NVA_CONSENT_OWNER` ; pas de changement d'identifiant du worker. Examiner l'ancien corps et propriétaire de fonction **en privé** si elle existe, et les grants d'origine. Installation réelle, puis réparation :

```bash
psql -X -w "service=$NVA_DB_SERVICE" -v expected_consent_owner="$NVA_CONSENT_OWNER" \
 -f "$NVA_SQL_DIR/09-install-admission-consent.sql"
psql -X -w "service=$NVA_DB_SERVICE" -f "$NVA_SQL_DIR/06-worker-admission-draft-grant.sql"
```

09 inclut le fichier canonique via chemin relatif : conserver l'arborescence `deploy/whatsapp-chatbot` et `docs/sql`. En cas d'erreur de PUBLIC, héritage ou droits de grantor : ne pas poursuivre, ne pas révoquer PUBLIC globalement. Ne pas relancer un bootstrap CREATE ROLE.

07 n'est nécessaire que si le rôle applicatif manque effectivement d'EXECUTE ou des lectures Meta prévues et si l'ajout a été approuvé :

```bash
psql -X -w "service=$NVA_DB_SERVICE" -v expected_database=english_center \
 -v nva_app_role="$NVA_APP_ROLE" -f "$NVA_SQL_DIR/07-admin-meta-manual-grants.sql"
```

Rejouer 10/05/08 en lecture seule et comparer aux preuves avant. Attendus : trois interdits faux ; fonction présente, propriétaire approuvé, SECURITY DEFINER, search_path conforme, PUBLIC/ingress sans EXECUTE ; worker EXECUTE vrai, identités et autres interdits inchangés faux. Vérifier que les droits web nécessaires sont conservés. Ne pas annoncer un succès sur le seul COMMIT de 06.

### 4. Ready sans transport et redémarrage ciblé

Après promotion ciblée autorisée des fichiers validés, worker PM2 toujours arrêté, depuis le répertoire exact de la release et avec le **même environnement validé que PM2**, exécuter :

```bash
cd -- "$NVA_APP_DIR"
node scripts/checkMetaInboxWorkerReady.js --readiness-only
```

La sonde charge `.env` sans l'afficher, force l'envoi faux, appelle réellement `worker.ready()`, puis ferme ; aucun polling ni envoi. Si PM2 utilise des valeurs différentes, fournir la même configuration approuvée via l'environnement protégé, ne pas supposer l'équivalence. Succès exact : `META_WORKER_READY_SEND_DISABLED`. L'échec n'affiche aucun détail secret. Ce n'est pas un deuxième worker de traitement.

Uniquement après succès, autoriser le redémarrage du seul processus avec envoi encore fermé. Depuis un shell d'opérateur contrôlé, sans variables DB/Meta contradictoires :

```bash
META_INBOX_SEND_ENABLED=false pm2 restart nva-whatsapp-worker --update-env
```

Ce redémarrage change seulement la configuration d'exécution prévue après autorisation ; il ne modifie pas de mot de passe. Vérifier que les autres variables conservées sont celles approuvées et que la source PM2 de redémarrage conserve aussi l'envoi fermé. Attester le ready IPC, absence de boucle de restart, un seul PID worker et état SQL correct. Pas de `pm2 save` global ni redémarrage web.

Pour les journaux, ne pas publier `pm2 logs` brut : ils peuvent contenir des données historiques. L'opérateur relève le chemin du journal privé et ne retourne que les occurrences de codes connus, comparées avant/après sur une période bornée. Exemple de lecture bornée (aucune ligne de log affichée) :

```bash
node -e 'const f=require("node:fs");let fd;try{fd=f.openSync(process.argv[1],"r");const s=f.fstatSync(fd),b=Buffer.alloc(Math.min(s.size,1048576));f.readSync(fd,b,0,b.length,Math.max(0,s.size-b.length));const t=b.toString();for(const k of ["META_WORKER_START_FAILED","META_WORKER_DATABASE_IDENTITY_REJECTED","META_WORKER_READINESS_FAILED"]){console.log(k+"="+(t.split(k).length-1))}console.log("SAMPLE_BYTES="+b.length)}catch{console.error("LOG_SAMPLE_UNAVAILABLE");process.exitCode=2}finally{if(fd!==undefined)f.closeSync(fd)}' "$NVA_WORKER_ERROR_LOG"
```

Un ancien code dans le dernier Mo n'est pas une nouvelle erreur. Réconcilier dates/rotation en privé. Absence de ces codes n'est pas preuve de ready ; le CLI peut seulement journaliser le code générique START_FAILED.

### 5. Téléphone Meta de test — autorisation d'envoi séparée

Ne pas exécuter maintenant. Maintenir l'envoi fermé tant que l'identité du numéro Meta de test, le confinement des testeurs et la liste consentante ne sont pas attestés. Un numéro réservé aux tests ne filtre pas techniquement les expéditeurs ; le préflight reste applicable. L'ouverture de l'envoi nécessite une configuration approuvée et une action ciblée ultérieure, pas une conséquence automatique de la correction SQL.

Après cette autorisation seulement : un testeur autorisé ouvre la fenêtre de service depuis son téléphone ; vérifier accueil unique, boutons, question tarifaire, consentement, une seule demande PENDING visible en administration et relais humain. Aucun client réel, aucune inscription finale ou compte étudiant annoncé/créé. Stopper à la première sortie non autorisée, duplication, fausse confirmation, erreur ACL, nouveau restart ou traitement concurrent. Aucun message réel n'a été envoyé pendant cette mission.

## Retour arrière et décision

Avant COMMIT, toute erreur annule les modifications de **ce fichier**. Après COMMIT, fermer l'envoi et arrêter le seul worker en cas d'incident ; préserver files, consentements et résultats incertains. Ne pas restaurer automatiquement les anciens grants permissifs pour faire passer l'ancien code : ce serait réintroduire le défaut de sécurité. L'ancien code peut aussi être incompatible avec les INSERT restreints.

Le DBA conserve le schéma/ACL et le corps de fonction antérieurs et prépare sur copie un inverse ciblé par grantor si une régression légitime le nécessite ; pas de replay global du dump de schéma. Restaurer une ancienne fonction seulement si sa sécurité et ses dépendances sont validées. Ne pas supprimer une fonction désormais utilisée ni restaurer toute la base de production pour une correction de permissions. Les données nouvelles et traces doivent être préservées. Repli sûr : worker arrêté, web et administration maintenus ; toute reprise d'un sender historique exige sa compatibilité et son exclusivité démontrées.

**GO correction en laboratoire. NO-GO activation pilote/production à ce stade.** L'application existe déjà en production ; cette décision concerne la promotion de cette correction et l'ouverture du worker V2. Restent : provenance réelle des GRANT, sauvegarde/restauration et inverse validés, propriétaire/cible/environnement confirmés, permissions PUBLIC éventuelles, autorisation de maintenance/transfert/restart et autorisation distincte des essais téléphoniques. Arrêt avant toute modification de Contabo, conformément à la mission jointe.
