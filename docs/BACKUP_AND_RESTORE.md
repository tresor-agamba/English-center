# Sauvegardes et restauration

Les sauvegardes utilisent exclusivement `pg_dump` au format custom PostgreSQL. Elles sont enregistrées dans `storage/private/backups`, jamais dans `public`.

## Commandes

```bash
npm run backup:create
npm run backup:list
npm run backup:verify -- <backup-id>
npm run backup:cleanup
```

Chaque sauvegarde reçoit un UUID, un checksum SHA-256 et une entrée d’audit. La vérification contrôle la taille, l’en-tête `PGDMP`, le checksum et, lorsque disponible, `pg_restore --list`.

La politique par défaut conserve 30 sauvegardes pendant 30 jours. La commande `backup:create` peut être appelée par cron ; définir `BACKUP_TYPE=SCHEDULED` pour identifier ces exécutions.

## Restauration

La restauration est désactivée par défaut. Avant toute restauration :

1. arrêter ou mettre l’application en maintenance ;
2. vérifier le dump ;
3. configurer `BACKUP_RESTORE_ENABLED=true` ;
4. définir une longue valeur aléatoire dans `BACKUP_RESTORE_CONFIRMATION` ;
5. fournir la même valeur séparément via `BACKUP_RESTORE_CONFIRMATION_INPUT` ;
6. exécuter `npm run backup:restore -- <backup-id>`.

Le service crée d’abord une sauvegarde `PRE_RESTORE`, prend un verrou exclusif, vérifie le checksum et utilise `pg_restore`. Ne jamais restaurer directement sur la base principale sans fenêtre de maintenance et test préalable sur une base isolée.

En cas d’échec, conserver le dump, consulter les journaux structurés avec le `requestId`, vérifier l’espace disque et tester `pg_restore --list` manuellement.
