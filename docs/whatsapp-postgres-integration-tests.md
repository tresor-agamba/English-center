# Tests d’intégration PostgreSQL WhatsApp

Ce document décrit l’exécution de `tests/whatsappPostgres.integration.test.js` sur une base de test dédiée. La suite ne charge pas dotenv, n’applique aucune migration, ne démarre aucun worker et ne contacte pas WhatsApp Cloud API.

## Prérequis

- Une base réservée aux essais, nommée exactement `nva_whatsapp_test`, sur un endpoint vérifié manuellement comme test et exécutant PostgreSQL 16.x. Le schéma Prisma ne fixe pas lui-même de version PostgreSQL; la suite cible la version 16 de l’environnement préparé et refuse une autre version.
- Les migrations du dépôt déjà appliquées à cette base par un rôle migrateur distinct, puis le client Prisma généré à partir du schéma courant. Ces étapes ne sont pas exécutées par la suite.
- Un rôle d’exécution nommé `nva_whatsapp_test_runner`, sans privilèges élevés, propriétaire de la base, d’un schéma ou de tout autre objet de la base, ni appartenance/héritage d’un autre rôle. Il doit avoir uniquement `CONNECT`, `USAGE` sur `public`, les permissions nécessaires sur les sept tables vérifiées par le test et `USAGE` sur les séquences d’identifiants requises. Le précontrôle s’appuie sur `pg_shdepend` pour la propriété des objets et sur `aclexplode` pour détecter les options `GRANT OPTION` sur base, schémas, relations, colonnes et séquences. Il rejette aussi les privilèges superuser, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, CREATE/TEMP de base, CREATE ou USAGE sur les autres schémas, grants de colonne, privilèges inattendus et memberships. Une erreur de catalogue ou un résultat impossible à inspecter fait échouer le précontrôle.
- L’URL explicite et les identités attendues doivent être fournies au processus par un gestionnaire de secrets. Ne pas réutiliser l’URL de production. Aucun rôle n’est créé ni modifié par la suite.

Les migrations sont appliquées séparément par un rôle migrateur limité à cette base, par exemple avec `npx prisma migrate deploy`. Le client peut ensuite être généré avec `npx prisma generate`. Après chaque évolution du schéma, vérifier les migrations et les privilèges. Ne pas employer de script de reset, `migrate reset`, `db push` ou seed.

## Vérification de cible avant toute écriture

Le test exige les variables de processus suivantes, sans fallback sur `.env` :

- `NVA_WHATSAPP_TEST_DATABASE_URL` : URL PostgreSQL explicite;
- `NVA_WHATSAPP_TEST_EXPECTED_URL_HOST` et `NVA_WHATSAPP_TEST_EXPECTED_URL_PORT` : endpoint de l’URL;
- `NVA_WHATSAPP_TEST_EXPECTED_SERVER_ADDRESS` et `NVA_WHATSAPP_TEST_EXPECTED_SERVER_PORT` : adresse et port retournés par PostgreSQL.

Il compare d’abord la base, le rôle, l’hôte et le port configurés aux valeurs fixes attendues, puis vérifie `current_database()`, `current_user`, l’adresse, le port et la version majeure 16 du serveur. Il inspecte ensuite les attributs et memberships du rôle, ses droits effectifs et options de délégation sur la base, les schémas, tables, colonnes et séquences, l’absence de propriété d’objets, et exige que les tables WhatsApp de la base soient vides. Tout échec arrête le hook préalable avant les scénarios et avant les écritures. Les erreurs de connexion n’affichent pas l’URL.

Le gestionnaire de secrets ou le lanceur sécurisé injecte les cinq variables dans le processus PowerShell ou Node. Ne placez pas l’URL dans la ligne de commande, un fichier du dépôt, l’historique du shell ou une sortie de diagnostic.

## Commande

Depuis `D:\English-center`, dans le processus qui a reçu les variables ci-dessus :

```powershell
node --test tests/whatsappPostgres.integration.test.js
```

Cette commande n’a pas été exécutée pendant la revue des garde-fous. Ne la lancez qu’après validation humaine de la destination et du rôle. Évitez `npm test`, `npm run test:responsive` et `npm run test:db:reset` : les runners concernés peuvent exécuter `prisma migrate reset`.

## Scénarios, appels réseau et nettoyage

Les tests réservent des numéros synthétiques en contrôlant au préalable les conversations, les colonnes utilisateur `phoneNumber` et `whatsappNumber`, et `WhatsAppPreference.phoneNumber`. Une collision arrête le scénario; aucun enregistrement préexistant n’est réutilisé. Les identifiants des conversations et conseillers créés sont conservés en mémoire pour le nettoyage. Celui-ci revérifie l’identifiant et le numéro avant chaque suppression, ne supprime jamais une ligne dont l’identité a changé, continue les autres suppressions après une erreur et fait échouer le hook final en signalant les erreurs collectées. Les suppressions sont ciblées par identifiant exact; les relations des conversations enlèvent leurs messages, événements de consentement et relances associés.

Le service de livraison reçoit un expéditeur simulé. La suite appelle directement l’envoi d’un message synthétique au moyen de cet expéditeur injecté, couvre l’échec permanent `FAILED`, vérifie la réponse `{ failed: true, retryable: false }`, un seul essai et l’absence de nouvel essai; elle ne lance pas le worker `processPending`. L’expéditeur de relances échoue volontairement s’il est appelé; les statuts `SENT`, `DELIVERED` et `FAILED` des relances sont simulés par le traitement de callbacks avec des identifiants factices. Il n’y a ni requête réseau vers WhatsApp ni message réel. Sont couverts la persistance après reconnexion, les statuts de livraison, la déduplication concurrente, le consentement et son retrait, les relances, le transfert à un conseiller et les lectures admin.

La suite vérifie des services d’administration directement, mais ne teste pas les routes HTTP WhatsApp. Le projet contient une suite CSRF HTTP existante, mais elle couvre une autre route admin et s’appuie sur l’application et ses sessions en base. Aucun test HTTP WhatsApp isolé n’a été ajouté ici : il reste à couvrir l’authentification admin, CSRF et autorisations des routes avec un harness HTTP dédié, après vérification de ses besoins de session et de privilèges. Ne désactivez pas ces protections pour les tests.

Aucun `deleteMany` non filtré, reset, `db push` ou seed n’est utilisé. Cette suite ne prouve pas le comportement réel de WhatsApp Cloud API. Le premier lancement doit rester sur la base dédiée après revue indépendante de son endpoint, de son rôle et de ses grants effectifs.
