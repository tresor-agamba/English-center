# Préparation à la production

Cette documentation prépare un futur VPS sans effectuer le déploiement.

## Variables obligatoires

Copier `.env.example` vers un fichier secret hors Git. En production, `SESSION_SECRET` doit être aléatoire et contenir au moins 32 caractères. Configurer `DATABASE_URL`, `PUBLIC_APP_URL` en HTTPS, `PRIVATE_STORAGE_ROOT`, `TRUST_PROXY`, `PG_DUMP_PATH`, `PG_RESTORE_PATH` et les limites de sauvegarde.

Exécuter avant chaque mise en production :

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run production:check
npm test
```

## Sessions PostgreSQL

Les sessions HTTP sont stockées dans PostgreSQL, dans la table technique `http_sessions` créée automatiquement au premier démarrage. `SESSION_POOL_MAX` limite le pool dédié (5 par défaut, valeur autorisée de 1 à 20). Le démarrage et `npm run production:check` échouent si le store n'est pas joignable; aucune bascule vers `MemoryStore` n'est autorisée en production. Les sessions expirent après 8 heures et sont nettoyées automatiquement toutes les 15 minutes environ.

Le store PostgreSQL conserve les sessions lors d'un redémarrage et permet leur partage entre plusieurs processus. Le mode cluster reste désactivé dans ce lot, car les autres opérations internes n'ont pas été auditées pour une exécution distribuée.

## PM2

`ecosystem.config.cjs` démarre une seule instance, impose une limite mémoire de 512 Mo et laisse PM2 gérer les redémarrages. Créer le dossier `logs` avec des droits réservés au compte de service.

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Le mode cluster reste désactivé pour les autres opérations internes non encore auditées en exécution distribuée.

## Exemple Nginx

Le modèle versionné est `deploy/nginx/nva.conf.example`. Il lie Nginx à Node sur
`127.0.0.1`, redirige HTTP vers HTTPS, transmet les en-têtes de proxy, refuse le
stockage privé, active gzip au niveau du proxy et limite les requêtes à 25 Mo.
Remplacer ses placeholders avant `nginx -t` ; ne pas l'utiliser tel quel.

Limiter l’accès SSH, activer le pare-feu, HTTPS et la rotation des journaux. Le répertoire privé et les sauvegardes doivent appartenir uniquement au compte de service.

## Sauvegardes PostgreSQL

Le serveur et les outils `pg_dump` / `pg_restore` doivent avoir la même version majeure. `npm run production:check` refuse désormais une combinaison incompatible avant le lancement d'une sauvegarde. Sur Ubuntu avec PostgreSQL 18, installer le paquet système officiel `postgresql-client-18`, puis renseigner `PG_DUMP_PATH` et `PG_RESTORE_PATH` si les outils ne sont pas résolus sans ambiguïté.

Les dumps NVA utilisent le format custom PostgreSQL, un SHA-256 et une validation par `pg_restore --list`. La table technique `http_sessions` est volontairement exclue : après une restauration majeure, les utilisateurs doivent se reconnecter et `connect-pg-simple` recrée automatiquement la table au démarrage.

Pour tester la chaîne complète sans toucher aux bases active ou de test :

```bash
npm run backup:validate-restore
```

Cette commande crée un dump conservé selon la politique de rétention, restaure dans une base aléatoire `nva_restore_validation_*`, compare des compteurs non sensibles avec Prisma, puis supprime uniquement cette base temporaire après vérification.

Un dump PostgreSQL n'est pas une sauvegarde complète de l'application. Le répertoire `storage/private` doit être sauvegardé séparément sur le VPS, notamment les preuves de paiement, audios, reçus, signatures et autres fichiers privés. Le sous-répertoire contenant les dumps doit lui aussi être répliqué vers un stockage distinct de la machine.

## Exploitation

Surveiller `/health` de façon externe. Consulter `/admin/system/health` et `/admin/system/backups` uniquement avec un compte administrateur. Une réponse publique de santé ne révèle ni version, ni base, ni chemin local.

Pour un arrêt, envoyer `SIGTERM` à PM2. L’application cesse d’accepter de nouvelles connexions, attend les opérations critiques dans la limite configurée, ferme Prisma et journalise la fin.

`POST /register` est limité à 10 tentatives par heure et par adresse IP. Cette limite vise les inscriptions automatisées sans gêner un parcours humain normal. Elle repose sur `TRUST_PROXY=1` derrière l'unique proxy Nginx ; ne jamais exposer directement le port Node.
