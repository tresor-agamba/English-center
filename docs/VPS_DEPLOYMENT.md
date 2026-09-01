# Déploiement NVA sur un futur VPS Ubuntu

Ce document est un runbook préparatoire. Aucun VPS, DNS, certificat, pare-feu ou accès public n'a encore été validé. Choisir une version Ubuntu LTS encore supportée au moment du déploiement.

## Prérequis et utilisateur Linux

Créer un utilisateur de déploiement non-root, propriétaire du code, de `logs` et de `storage/private`. N'utiliser `sudo` que pour les paquets et services système. Installer Node.js compatible avec le lockfile, npm, Git, PM2 et le client PostgreSQL de même version majeure que le serveur.

## PostgreSQL

Créer une base et un utilisateur dédiés NVA avec un mot de passe robuste et les permissions limitées à cette base. PostgreSQL doit écouter sur localhost ou un réseau privé ; ne pas ouvrir le port 5432 sur Internet. Placer la chaîne `DATABASE_URL` uniquement dans le fichier d'environnement protégé du VPS.

## Environnement

Copier `.env.example` vers un fichier non versionné lisible uniquement par l'utilisateur de service. Renseigner au minimum `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT`, `DATABASE_URL`, un `SESSION_SECRET` aléatoire d'au moins 32 caractères, `PUBLIC_APP_URL=https://DOMAIN`, `TRUST_PROXY=1` et `PRIVATE_STORAGE_ROOT`.

Les paramètres WhatsApp restent optionnels tant que le canal est désactivé. `TEST_DATABASE_URL` et `CSRF_ENFORCE` sont réservés aux tests. Ne placer aucun secret dans PM2, Git ou le template Nginx.

## Installation et Prisma

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run production:check
```

Ne jamais utiliser `prisma migrate dev` ou `prisma migrate reset` en production.

## PM2

Créer `logs` avec des droits privés, puis démarrer une seule instance :

```bash
mkdir -p logs
chmod 700 logs storage/private
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

Une seule instance est retenue car les jobs, fichiers locaux et verrous applicatifs n'ont pas été validés en cluster. Installer et configurer `pm2-logrotate` sur le VPS, avec rétention et taille adaptées ; ce module n'est pas une dépendance applicative.

## Nginx et HTTPS

Copier `deploy/nginx/nva.conf.example`, remplacer `DOMAIN_PLACEHOLDER` et `PORT`, puis valider avec `nginx -t`. L'architecture attendue est client HTTPS → Nginx → Node HTTP sur `127.0.0.1`. La limite Nginx de 25 Mo couvre le plus grand upload NVA, limité à 20 Mo, avec l'enveloppe multipart.

Après propagation DNS :

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d DOMAIN
sudo certbot renew --dry-run
```

N'activer une politique HSTS longue qu'après validation durable de HTTPS et de tous les sous-domaines concernés.

## Pare-feu

Vérifier d'abord que SSH fonctionne et qu'une seconde session peut être ouverte. Ensuite seulement :

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw status verbose
sudo ufw enable
```

Ne pas autoriser 3000 ni 5432 publiquement.

## Health checks et smoke tests

- `GET /health` : liveness Node, réponse publique minimale.
- `GET /ready` : readiness PostgreSQL, HTTP 503 si la base est indisponible.
- `/admin/system/health` : détails réservés à l'administrateur.

Après déploiement, vérifier `/`, `/login`, `/health`, `/ready`, une route privée sans session, une 404, puis login/logout avec chaque rôle.

## Sauvegardes et fichiers privés

Les dumps PostgreSQL ne couvrent pas `storage/private`. Sauvegarder séparément :

- `backups` ;
- `oral-audio` ;
- `payment-proofs` ;
- `settings`.

Copier les dumps et une archive/synchronisation chiffrée des fichiers privés vers un stockage off-site distinct du VPS. Conserver la politique applicative actuelle de 30 sauvegardes/30 jours et ajouter une conservation off-site quotidienne, hebdomadaire et mensuelle selon la capacité choisie. Tester périodiquement une restauration isolée.

## Déploiement et mise à jour

```bash
git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
npm run production:check
pm2 reload ecosystem.config.cjs --env production
curl --fail https://DOMAIN/health
curl --fail https://DOMAIN/ready
```

Ne jamais écraser `.env`, supprimer `storage/private`, forcer Git ou réinitialiser la base dans un script de déploiement.

## Runbook de restauration

1. Activer une page de maintenance et arrêter les écritures.
2. Sauvegarder l'état courant de la base et des fichiers privés.
3. Vérifier checksum et contenu du dump sélectionné.
4. Restaurer d'abord dans une base isolée et effectuer les contrôles Prisma.
5. Restaurer la base cible pendant la maintenance.
6. Restaurer les fichiers privés correspondant au même point temporel.
7. Exécuter uniquement `prisma migrate deploy` si le code restauré l'exige.
8. Redémarrer PM2, vérifier `/health` et `/ready`, puis effectuer les smoke tests.

## Rollback

Conserver l'artifact ou commit précédent, le dump pré-déploiement et le snapshot des fichiers privés. Revenir au code précédent, exécuter `npm ci`, puis redémarrer PM2. Une migration Prisma n'est pas automatiquement réversible : restaurer la base pré-déploiement lorsque le schéma n'est pas compatible, au lieu d'improviser une migration inverse.

## Dépannage

- PM2 : `pm2 status`, `pm2 logs --lines 200`.
- Nginx : `sudo nginx -t`, journaux Nginx et code HTTP du proxy.
- PostgreSQL : `/ready`, connectivité locale, espace disque et pool de sessions.
- Prisma : `npx prisma validate`, `npx prisma migrate status`.
- Backup : `npm run backup:verify -- ID` et `pg_restore --list`.

## Checklist opérationnelle finale

Ordre recommandé : provisionner Ubuntu LTS, créer l'utilisateur non-root, installer Git (ou livrer un artifact versionné), Node/npm, PostgreSQL 18 et `postgresql-client-18`, créer la base et son rôle dédié, configurer `.env`, puis exécuter `npm ci`, `prisma generate`, `prisma migrate deploy` et `production:check`. Préparer ensuite les permissions, PM2, Nginx, DNS, Certbot/HTTPS, UFW, smoke tests, sauvegardes et monitoring.

Permissions minimales : `.env` en `600`; `storage/private`, `storage/private/backups` et `logs` en `700`; fichiers privés, dumps et logs en `600`. Tous appartiennent à l'utilisateur de service. Ne jamais utiliser `chmod 777` et vérifier que Nginx ne sert ni `.env`, ni `storage/private`, ni les dumps.

Le fichier PM2 fixe son `cwd` avec `__dirname`, de manière portable, et conserve une seule instance en mode fork. Après validation, exécuter `pm2 save`, puis la commande proposée par `pm2 startup` afin de restaurer le processus après redémarrage du VPS.

Politique UFW attendue : SSH limité aux adresses d'administration lorsque possible, HTTP/HTTPS publics via Nginx, aucun accès public direct à PostgreSQL 5432 ou au port Node 3000.

Smoke tests après VPS : routes publiques `/`, `/formations`, `/login`, `/register`, `/robots.txt`, `/sitemap.xml`, `/health`, `/ready`; login, logout et persistance de session; dashboards et fonctions principales Student/Admin/Teacher; upload autorisé, téléchargement privé, CSRF absent/invalide, dépassement du rate limit, 404 et erreur 500 contrôlée. Ces contrôles ne sont considérés exécutés qu'après installation réelle du VPS et de HTTPS.

Monitoring initial : processus Node, redémarrages PM2, CPU, RAM, disque, PostgreSQL et connexions, croissance de `storage/private`, espace et âge des sauvegardes, erreurs HTTP 5xx, `/health`, `/ready`, expiration du certificat TLS et du domaine. Une alerte externe simple et un test périodique de restauration isolée suffisent initialement.

## Distinction du rollback

Avant chaque déploiement, conserver l'artifact ou commit précédent, un dump pré-déploiement vérifié et le snapshot correspondant des fichiers privés.

**Rollback application :** remettre l'artifact/version précédente, exécuter `npm ci`, régénérer Prisma si nécessaire, redémarrer PM2 et effectuer les smoke tests. Ne pas modifier la base si cette version reste compatible avec le schéma déployé.

**Rollback base de données :** ne jamais tenter aveuglément d'annuler une migration Prisma déjà appliquée avec des données. Restaurer le dump pré-déploiement uniquement pendant une maintenance contrôlée, lorsque l'incompatibilité de schéma le rend réellement nécessaire, avec les fichiers privés du même point temporel.
