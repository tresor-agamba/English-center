# Meta Inbox : réception production explicitement autorisée

## Résultat et périmètre

Le runtime conserve le chemin de test Windows et ajoute un chemin production fermé par défaut. Aucune connexion PostgreSQL, opération sur Contabo, migration, modification de `.env`, activation ou appel fournisseur n'a été effectué pour cette intervention. L'existence des quatre tables sur Contabo est une information fournie par l'utilisateur, non une vérification distante.

## Contrat de configuration

| Paramètre | Test Windows, inchangé | Production Contabo |
| --- | --- | --- |
| `META_WHATSAPP_INBOX_ENABLED` | `true` pour accepter | `true` pour accepter |
| `META_INBOX_PRODUCTION_AUTHORIZED` | ne donne aucun droit supplémentaire | doit être exactement `true` |
| `META_INBOX_ENVIRONMENT` | `test` | `production` |
| `NODE_ENV` | doit être différent de `production` | exactement `production` |
| URL obligatoire | `META_INBOX_DATABASE_URL` | `META_INBOX_DATABASE_URL` |
| Hôte | exactement `127.0.0.1` | exactement `127.0.0.1` |
| Port explicite | `55432` | `5432` |
| Base | `nva_whatsapp_test` | `english_center` |
| Rôle | `nva_meta_inbox_ingress` | `nva_meta_inbox_ingress_prod` |

Aucun fallback vers `DATABASE_URL`, aucun hostname alternatif, socket Unix, fragment ou paramètre de requête fourni dans l'URL. Mot de passe requis et encodage URL vérifié. Le runtime ajoute uniquement ses propres paramètres Prisma `schema=public`, pool 4, délais connexion/pool 5 secondes. Les erreurs exposées au webhook restent génériques.

En production, `WHATSAPP_ENABLED=true` ou `WHATSAPP_WORKERS_ENABLED=true`, y compris avec une casse différente, font refuser la composition. Cette version prépare volontairement une réception seule ; le traitement conversationnel et les envois ultérieurs demanderont une nouvelle revue. Ne pas changer `NODE_ENV` de NVA pour contourner les restrictions.

`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` et `META_INBOX_APP_ID` doivent être des identifiants décimaux positifs, sans espace, limités à 64 caractères. `META_INBOX_ENDPOINT_ID` est un UUID, `META_INBOX_APPLICATION_KEY` une clé locale validée. En production, `WHATSAPP_APP_SECRET` et `WHATSAPP_VERIFY_TOKEN` doivent chacun comporter au moins 32 caractères après trim. Utiliser leurs véritables valeurs ; ce contrôle de forme ne confirme pas leur provenance chez Meta.

Le repository exige ensuite que l'endpoint persistant corresponde exactement au scope environnement/application/App ID/WABA/Phone Number ID et aux versions de clés. HMAC SHA-256 sur les octets bruts et validation WABA/Phone Number ID restent inchangés. Un reçu accepté signifie COMMIT inbox terminé, pas message métier traité.

### Clés durables

Variables obligatoires :

- `META_INBOX_LOOKUP_KEYS_JSON`, `META_INBOX_LOOKUP_KEY_VERSION` ;
- `META_INBOX_STREAM_KEY_HEX`, `META_INBOX_STREAM_KEY_VERSION` ;
- `META_INBOX_ENCRYPTION_KEYS_JSON`, `META_INBOX_ENCRYPTION_KEY_VERSION` ;
- `META_INBOX_AUTH_KEY_VERSION` pour versionner le secret d'authentification.

Chiffrement et HMAC de déduplication utilisent les mêmes primitives et règles de rotation qu'avant : clés distinctes de 32 octets, versions persistantes, anciennes clés nécessaires conservées, refus des versions incompatibles. Ne jamais régénérer ces clés au redémarrage. DPAPI Windows n'est pas un format de secrets Linux ; fournir un coffre/chargeur Linux adapté, hors Git, logs et arguments. Aucune implémentation de coffre Linux ou export de clés n'est effectuée ici.

## Contrôles SQL avant écriture

En production, chaque transaction du repository commence par vérifier l'identité effectivement retournée par PostgreSQL : base, rôle connecté, IPv4 et port. Un nom d'utilisateur correct dans une URL ne suffit pas.

Le rôle doit être LOGIN, NOINHERIT, sans membership ni attribut d'administration (SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS). Le contrôle refuse CREATE/TEMP effectifs sur la base, CREATE sur public, propriété d'objets applicatifs, accès aux autres tables/vues/séquences du schéma public, opérations Meta interdites et UPDATE/INSERT de colonnes non autorisées. Les permissions héritées de PUBLIC sont incluses via les fonctions de privilèges PostgreSQL ; les GRANT OPTION de relations/colonnes sont également contrôlés.

La méthode `runtime.ready()` effectue ce précontrôle dans une transaction Serializable sans traitement d'événement ; elle ne démarre ni serveur, ni worker. Les transactions de réception refont le contrôle, même après un ready réussi. Le contrôle ne revendique pas un audit exhaustif de tout le cluster : un DBA doit aussi examiner les autres schémas, les droits CONNECT sur d'autres bases et les fonctions accessibles, en particulier SECURITY DEFINER. Les permissions positives manquantes ou des contraintes absentes doivent être vérifiées avant activation ; des mocks ne certifient pas les ACL ou le SQL réel.

Le constructeur valide la configuration avant d'instancier Prisma. Dans la route, une configuration de cible production invalide ou non autorisée retourne 503 aussi pour le GET de souscription. Le GET ne prouve pas la disponibilité PostgreSQL : ready et les tests de persistance restent nécessaires.

## SQL du rôle, à revoir puis exécuter uniquement sous autorisation

Fichier : `docs/sql/meta-inbox-production-ingress-role.sql`. Il ne contient aucune création de table, migration, modification métier ou valeur de secret. Il vérifie la cible, les quatre tables, la séquence, la fonction de verrouillage et les sept triggers de sécurité avant création d'un rôle NOLOGIN. Il s'arrête si le rôle existe déjà ; auditer un rôle existant plutôt que l'écraser.

Permissions préparées :

| Objet | Droits |
| --- | --- |
| `english_center`, schéma `public` | CONNECT, USAGE |
| `meta_webhook_endpoints` | SELECT, UPDATE(id) uniquement pour FOR UPDATE ; le trigger existant garde l'identité |
| receipts/events/receipt_items | SELECT, INSERT |
| receipts | UPDATE des quatre compteurs item/new/duplicate/conflict |
| events | UPDATE des seuls champs réception/conflit et état/revue/bail requis par acceptation |
| `meta_webhook_events_enqueue_order_seq` | USAGE uniquement |
| `meta_inbox_lock_endpoint(uuid)` | EXECUTE |

Aucun GRANT global, ALL, DELETE, TRUNCATE, REFERENCES, TRIGGER, droit de traitement conversationnel ou GRANT OPTION. Aucun changement du propriétaire ou des ACL métier. Les droits d'exécution des autres fonctions et les propriétaires doivent être audités sur la cible.

**Attention PUBLIC :** PostgreSQL peut accorder TEMP à PUBLIC par défaut. Un rôle NOINHERIT hérite néanmoins des droits PUBLIC ; un REVOKE limité au nouveau rôle ne peut pas retirer ces droits hérités. Le SQL et le runtime refusent alors la mise en service. Ce script ne révoque rien à PUBLIC et n'altère pas les autres comptes. Une revue DBA et une autorisation distincte seraient nécessaires avant toute modification des ACL partagées.

Après autorisation, dans une session administrateur explicitement connectée au VPS cible :

```sh
psql --host=127.0.0.1 --port=5432 --dbname=english_center --username=COMPTE_ADMIN_VALIDE --file=docs/sql/meta-inbox-production-ingress-role.sql
```

Puis, uniquement en session interactive protégée :

```sql
SET password_encryption = 'scram-sha-256';
\password nva_meta_inbox_ingress_prod
ALTER ROLE nva_meta_inbox_ingress_prod LOGIN;
```

Le mot de passe provient d'un coffre/générateur sécurisé, sans littéral SQL ou argument shell. HBA doit déjà autoriser cette connexion locale SCRAM : ne pas le modifier automatiquement. Tester ensuite une véritable connexion comme ingress, ready, les droits effectifs et l'absence d'accès métier avant d'exposer la route. Les commandes ci-dessus n'ont pas été lancées.

## Déploiement progressif Contabo

1. Identifier version/commit actuellement déployés, Linux/Node/OpenSSL/PostgreSQL, gestionnaire de processus, reverse proxy, tâches existantes et politique de sauvegarde. Sauvegarder et vérifier la restaurabilité. Garder le webhook actuel fermé.
2. Comparer le DDL réel avec `docs/sql/meta-inbox-schema-reviewed.sql` : les quatre tables seules ne prouvent pas la présence des contraintes, index, fonctions, triggers différés et séquence. Ne pas rejouer un CREATE TABLE sur les tables existantes ; arrêter en cas d'écart et préparer une correction SQL séparée et autorisée. Aucun diff général incluant les six Provider*.
3. Revoir le SQL du rôle, les ACL PUBLIC et les fonctions ; provisionner le rôle et son secret seulement sous autorisation. Ne pas utiliser le compte métier ou administrateur comme ingress.
4. Préparer une nouvelle release Linux et construire les dépendances verrouillées, puis générer Prisma 6.19.3 localement à cette release. Pas de transfert de node_modules Windows, aucune migration générale, aucun reset. Vérifier les quatre delegates Meta.
5. Charger secrets et clés depuis le mécanisme sécurisé Linux dans le seul processus prévu, sans modifier le `.env` existant. Garder `META_WHATSAPP_INBOX_ENABLED=false`, `META_INBOX_PRODUCTION_AUTHORIZED=false` et les deux flags sortants false. Le modèle `.env.example` ne contient que des noms et valeurs désactivées.
6. Sous autorisation de validation, vérifier ready dans un processus de précontrôle sans serveur, avec les deux flags inbox explicitement true seulement pour ce processus. Effectuer les tests réels d'ACL/persistance sur une cible autorisée avec des données fictives, sans appel Meta. Cette intervention ne les exécute pas. Ne jamais exécuter les tests d'intégration Windows contre english_center.
7. Préparer l'endpoint `environment=production` et les véritables identités/versions, `inboxEnabled=false`, `processingEnabled=false`. Le rôle ingress ne peut pas modifier les flags de cet endpoint. Préparer un service de réception seul ou un déploiement contrôlé de l'application sans réactiver son poller. Auditer tous les autres processus/cron existants ; les flags d'un processus n'arrêtent pas les autres.
8. Revoir le proxy HTTPS : route exacte `/webhooks/whatsapp`, corps brut inchangé, pas de faux ACK/cache, limite 1 MiB cohérente, aucun log de query string (verify token), corps, signature ou secret. Ne pas remplacer le vhost complet NVA par un exemple. Valider la configuration du proxy puis recharger sans interrompre le site.
9. Seulement après autorisation d'activation : activer l'acceptation de l'endpoint, laisser son traitement false, activer les deux flags inbox dans le processus réception, vérifier ready et GET/POST locaux, puis ouvrir uniquement cette route. Configurer ensuite Meta Developers sous autorisation distincte : URL HTTPS, verify token, champ messages et association WABA.
10. Premier message réel autorisé : vérifier reçu/événement chiffré, déduplication et ACK durable, sans imprimer données personnelles. Aucun envoi ni réponse automatique. Les STOP restent en attente d'application métier ; conserver tout canal sortant désactivé. La consommation et la rétention périodique demanderont un principal/opérateur et une activation séparés.

### Retour arrière

Fermer la route webhook en 503, désactiver les deux flags inbox et l'acceptation de son endpoint sous autorisation, puis arrêter uniquement le service réception concerné. Conserver les événements, clés et données ; revenir au code compatible précédent sans DROP ni reset ni rejeu de migration. Les flags de l'ancien code doivent être désactivés avant le retour arrière pour éviter une configuration production incomprise. Vérifier ensuite la disponibilité de NVA. Une restauration globale de production n'est pas une procédure normale de rollback d'une réception additive. Surveiller les retries Meta et le retard de traitement à la reprise.

## Tests et fichiers

Modifiés : `src/services/metaInboxRuntime.js`, `src/services/metaInboxService.js`, `src/routes/whatsappWebhookRoutes.js`, `.env.example`, `tests/metaWebhookRoute.test.js` (ajout d'un test, assertions historiques conservées).

Créés : `tests/metaInboxProduction.test.js`, `docs/sql/meta-inbox-production-ingress-role.sql`, ce rapport.

Tests exécutés : les 22 suites isolées `meta*.test.js`, `whatsapp*.test.js`, `gupshup*.test.js`, hors `*.integration.test.js` et `tests/whatsapp.test.js`, avec preload `tests/helpers/whatsappIsolationGuard.cjs`. Ce preload bloque le pilote pg, les vrais clients Prisma et fetch. Les tests HTTP utilisent uniquement loopback.

Résultat final : **423 réussis, 0 échec**, durée rapportée 1 364,1665 ms. Journal local ignoré par Git : `output/meta-production-isolated-tests.log`. Une première exécution a révélé que ready ne spécifiait pas Serializable ; ce point a été corrigé. Deux tests supplémentaires vérifient ensuite la fermeture du GET production et le refus du mode test si l'environnement réel devient production. Aucune assertion historique n'a été modifiée.

Couverture nouvelle : production explicitement autorisée, mélange d'environnements refusé, cible/port/rôle/URL invalides, absence de fallback, flags d'envoi, clés/versions, forme des identifiants Meta, véritable identité SQL simulée et privilèges refusés, chiffrement/déduplication/HMAC/scopes production, absence de traitement et préservation de la cible Windows. Les tests historiques couvrent les ACK, erreurs de stockage, callbacks, STOP et autres règles métier avec mocks.

**Limite :** les requêtes d'audit SQL et le script de rôle n'ont pas été exécutés sur PostgreSQL réel dans cette intervention. La compatibilité du catalogue Contabo, les ACL, le coffre Linux, la disponibilité HTTPS et la réception Meta réelle demeurent à valider sous autorisation. Aucun client Prisma, schéma, migration historique, dépendance ou donnée existante modifié.
