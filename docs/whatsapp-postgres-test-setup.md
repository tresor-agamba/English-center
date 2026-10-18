# Préparation manuelle de PostgreSQL pour les tests WhatsApp

## Situation de cette revue

Aucune URL ni identité PostgreSQL de test n'était fournie au processus. Aucune connexion PostgreSQL, création de base, migration, reset ou suppression de données n'a été exécutée. La suite d'intégration reste non exécutée. Les tests isolés ne remplacent pas cette validation.

## 1. Établir l'isolation

Un administrateur d'infrastructure doit créer une instance PostgreSQL 16 entièrement dédiée et jetable, distincte des instances NVA de développement et de production. Examiner sa configuration, ses volumes, l'endpoint réellement utilisé et les mécanismes réseau de redirection. Ne pas cloner les données de production et ne pas partager un volume existant. Consigner séparément l'hôte et le port client ainsi que l'adresse et le port retournés par le serveur : ils peuvent différer derrière une redirection.

Le nom `nva_whatsapp_test` et une correspondance d'URL ne prouvent pas cette isolation. L'attestation `NVA_WHATSAPP_TEST_ISOLATION_CONFIRMED` doit seulement être fournie après cette revue indépendante. La suite contrôle ensuite l'identité SQL, les privilèges et l'absence de données avant toute écriture. Si une vérification échoue, arrêter ; ne pas vider une base pour contourner le refus.

## 2. Créer les rôles et une base neuve

Les instructions SQL suivantes sont destinées uniquement à cette instance neuve vérifiée, dans une session administrative explicite avec arrêt à la première erreur (`ON_ERROR_STOP` pour psql). Elles ne sont pas exécutées par les tests. L'existence préalable d'un rôle ou d'une base doit arrêter cette création pour revue, sans DROP ni reset.

```sql
CREATE ROLE nva_whatsapp_test_migrator LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE nva_whatsapp_test_runner LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE nva_whatsapp_test OWNER nva_whatsapp_test_migrator;
REVOKE ALL ON DATABASE nva_whatsapp_test FROM PUBLIC;
GRANT CONNECT ON DATABASE nva_whatsapp_test TO nva_whatsapp_test_runner;
```

Configurer les mots de passe par un gestionnaire de secrets ou une saisie interactive sécurisée, jamais dans un script commité ou un argument de commande. Aucun mot de passe n'est proposé ici. Le runner ne doit appartenir à aucun autre rôle ni posséder d'objet.

## 3. Préparer le schéma, manuellement

Dans un processus distinct réservé au rôle migrateur, injecter l'URL de cette base neuve dans `DATABASE_URL` par le gestionnaire de secrets. Vérifier de nouveau la base et l'endpoint avant de lancer `prisma migrate deploy`, puis générer le client Prisma avec le schéma du dépôt. Ne pas utiliser `migrate dev`, `migrate reset`, `db push`, seed, `npm test`, les scripts responsive ou les commandes `test:db:*`.

Les migrations existantes contiennent déjà les modèles WhatsApp nécessaires. Aucune migration applicative supplémentaire n'est requise. Les migrations du dépôt et la génération ne sont pas exécutées par la suite d'intégration. La configuration de l'instance doit permettre plusieurs connexions pour les scénarios concurrents ; ne pas imposer un pool à une seule connexion.

## 4. Accorder les droits minimaux

Se connecter explicitement à `nva_whatsapp_test` comme propriétaire/migrateur, confirmer encore cette identité et la revue de l'instance avant d'appliquer les grants suivants. La base doit être sans données métier et sans fixtures. Aucun droit TRUNCATE, CREATE ou GRANT OPTION n'est accordé au runner.

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nva_whatsapp_test_runner;
GRANT SELECT, INSERT, DELETE ON public.users TO nva_whatsapp_test_runner;
GRANT SELECT ON public.enrollments, public.whatsapp_preferences
  TO nva_whatsapp_test_runner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations
  TO nva_whatsapp_test_runner;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_conversation_messages,
  public.whatsapp_prospect_follow_ups
  TO nva_whatsapp_test_runner;
GRANT SELECT, INSERT ON public.whatsapp_commercial_consent_events
  TO nva_whatsapp_test_runner;
```

Accorder uniquement USAGE sur les séquences d'identifiants des cinq tables suivantes : `users`, `whatsapp_conversations`, `whatsapp_conversation_messages`, `whatsapp_commercial_consent_events`, `whatsapp_prospect_follow_ups`. Identifier leurs noms par `pg_get_serial_sequence('public.<table>', 'id')` plutôt que les deviner. Ne pas accorder SELECT ou UPDATE sur les séquences. Aucune autre table, colonne ou schema ne doit être accessible au runner. Le précontrôle vérifie aussi les droits hérités de PUBLIC et les propriétaires d'objets.

## 5. Injecter les paramètres de test

Fournir les six variables listées dans `whatsapp-postgres-integration-tests.md`, sans modifier le `.env` principal. L'URL doit utiliser le runner et pointer explicitement sur l'instance revue. Ne pas réutiliser le processus migrateur ni son rôle privilégié. La comparaison avec les variables DATABASE_URL et TEST_DATABASE_URL héritées refuse une cible identique, même sous un autre rôle.

## 6. Exécuter séparément

```powershell
npm run test:whatsapp:isolated
# Seulement après préparation et revue de la cible dédiée :
npm run test:whatsapp:postgres
```

Ces deux commandes utilisent une liste explicite de fichiers et ne lancent aucune migration ni reset. La seconde est bloquée si l'attestation ou les paramètres sont absents. La suite ne charge pas le `.env`, n'appelle aucun scan global de worker et interdit fetch ; tous les expéditeurs sont simulés.

## 7. Scénarios préparés et limites

Les 14 scénarios PostgreSQL couvrent création, persistance, reconnexion, mémoire après nouvelle instance de service, contraintes uniques, entrée dupliquée concurrente, deux administrateurs, deux workers, accusé unique, réponse manuelle, reprise du bot avec annulation, STOP et consentement, isolation entre conversations, rejet permanent, reprise temporaire bornée, résultat incertain et callbacks précoces/tardifs/concurrents.

Les données de catalogue utilisées pour le parcours contextuel sont des fixtures en mémoire : les écritures et contraintes de conversation sont PostgreSQL réelles, mais ces tests ne valident pas les tables de formations ni leurs services de lecture réels. Les routes HTTP et sessions sur PostgreSQL, un redémarrage complet du processus NVA et le transport Meta réel restent hors de cette suite. La reconnexion et la création d'un nouveau client/service sont couvertes.

Seules les conversations et utilisateurs synthétiques identifiés par le run sont nettoyés, après vérification de leurs identités ; les enfants de conversation sont supprimés par les cascades existantes. L'identité du serveur est revérifiée avant nettoyage. Une erreur laisse les fixtures pour revue et interdit le prochain lancement si les tables sont non vides. Ne pas supprimer de lignes préexistantes pour passer le précontrôle.

Un résultat favorable ne suffirait pas à déclarer NVA prête pour la production.
