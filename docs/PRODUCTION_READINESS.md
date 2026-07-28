# Préparation à la production

Cette documentation prépare un futur VPS sans effectuer le déploiement.

## Variables obligatoires

Copier `.env.example` vers un fichier secret hors Git. En production, `SESSION_SECRET` doit être aléatoire et contenir au moins 32 caractères. Configurer `DATABASE_URL`, `PUBLIC_APP_URL` en HTTPS, `PRIVATE_STORAGE_ROOT`, `TRUST_PROXY`, `PG_DUMP_PATH`, `PG_RESTORE_PATH` et les limites de sauvegarde.

Exécuter avant chaque mise en production :

```bash
npm ci
npx prisma migrate deploy
npm run production:check
npm test
```

## PM2

`ecosystem.config.cjs` démarre une seule instance, impose une limite mémoire de 512 Mo et laisse PM2 gérer les redémarrages. Créer le dossier `logs` avec des droits réservés au compte de service.

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Le mode cluster reste désactivé car les sessions et opérations internes ne sont pas encore distribuées.

## Exemple Nginx

```nginx
server {
  listen 80;
  server_name example.org;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  server_name example.org;
  # ssl_certificate et ssl_certificate_key sont configurés sur le VPS.
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 15s;
    proxy_read_timeout 120s;
  }
  location ^~ /storage/private/ { deny all; return 404; }
}
```

Limiter l’accès SSH, activer le pare-feu, HTTPS et la rotation des journaux. Le répertoire privé et les sauvegardes doivent appartenir uniquement au compte de service.

## Exploitation

Surveiller `/health` de façon externe. Consulter `/admin/system/health` et `/admin/system/backups` uniquement avec un compte administrateur. Une réponse publique de santé ne révèle ni version, ni base, ni chemin local.

Pour un arrêt, envoyer `SIGTERM` à PM2. L’application cesse d’accepter de nouvelles connexions, attend les opérations critiques dans la limite configurée, ferme Prisma et journalise la fin.
