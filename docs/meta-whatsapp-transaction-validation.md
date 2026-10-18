# NVA ? Validation transactionnelle du SQL Meta sur PostgreSQL

Date : 17 octobre 2026. Ex?cution : 2026-10-17T15:44:20.080Z ? 2026-10-17T15:44:22.126Z. Dur?e du processus de validation : 2046 ms.

## 1. R?sultat

**Validation r?ussie : 17 contr?les sur 17.** Le SQL propos? s?ex?cute sur PostgreSQL 16.15, les objets et contraintes attendus sont pr?sents dans la transaction, les insertions fictives valides passent et les rejets pr?vus sont observ?s.

**ROLLBACK confirm?, aucun COMMIT envoy?.** Une nouvelle connexion READ ONLY confirme l?absence de persistance logique des objets Meta et des donn?es fictives. Les 44 migrations, les 69 tables m?tier pr?existantes, leurs catalogues examin?s et les 63 s?quences pr?existantes sont identiques avant/apr?s.

Aucune migration Prisma cr??e/appliqu?e. L?essai ne constitue pas une autorisation d?application d?finitive ou d?activation du canal.

## 2. Identit? et pr?contr?les

| Contr?le | R?sultat |
|---|---|
| H?te / port | **127.0.0.1:55432** |
| Base | **nva_whatsapp_test** |
| Version serveur | **16.15**, server_version_num 160015 |
| R?pertoire r?el | **D:/NVA-WhatsApp-Test/data** |
| Identifiant syst?me | **7696610946073769572** |
| R?cup?ration en cours | false |
| Utilisateur SQL existant | nva_whatsapp_test_admin |
| Contr?le syst?me avant connexion | PID 9292, bon ex?cutable/cluster, seule ?coute 127.0.0.1:55432 |
| Migrations avant DDL | 44 r?ussies, checksums conformes aux 44 fichiers locaux |
| Objets pr?existants Meta/Provider | Aucun nom correspondant dans les relations utilisateur ; aucune fonction meta_inbox_* |

Les identit?s ont ?t? compar?es aux constantes attendues avant toute instruction DDL. L?historique des migrations a ?t? v?rifi? avant le DDL et apr?s ROLLBACK. Aucun param?tre de production utilis?.

Le secret du compte existant a ?t? obtenu via DPAPI, en m?moire uniquement, puis transmis au processus enfant sans URL ni argument contenant un mot de passe. Aucun .env charg?/modifi? ; variables PG*, URLs de base h?rit?es et NODE_OPTIONS exclus du processus de lancement. Aucun client Prisma, service applicatif ou worker import?.

## 3. SQL utilis? et limitation du p?rim?tre

Documents examin?s :

- docs/meta-whatsapp-prisma-migration-review.md ;
- docs/meta-whatsapp-durable-inbox-design.md.

Empreinte SHA-256 du bloc SQL exact de la revue, avant adaptation des limites de transaction :

```text
709c4a31500a15d833a62999352fc640f3e741d9ab2d665f520978a7219d7f32
```

Le BEGIN initial et le COMMIT final du bloc documentaire ont ?t? **retir?s**, sans modifier le corps DDL. Le script ouvre lui-m?me une seule transaction d?essai et la termine obligatoirement par ROLLBACK. Aucun COMMIT, m?me conditionnel, ne figure dans le chemin d?ex?cution du script.

Corps effectivement utilis? : tmp/meta-whatsapp-transaction-ddl-review.sql, SHA-256 :

```text
5700356024669fef66a3b58aa63f0c0a6a0e297b864617543c40f109eac0bb42
```

Le corps comporte **38 instructions** : 36 instructions de cr?ation/contraintes/index/fonctions/triggers et 2 SET LOCAL de timeouts. Les instructions ont ?t? d?coup?es en respectant cha?nes, identifiants, commentaires et blocs dollar-quoted, puis contr?l?es par une liste ferm?e. Seules les quatre tables Meta, leurs index et fonctions/triggers Meta et les timeouts locaux sont admis. Les ALTER TABLE visent seulement les tables Meta nouvellement cr??es.

Aucun CREATE Provider*, ALTER de table m?tier existante, DROP, GRANT/REVOKE, seed applicatif ni modification d?historique. Aucun SQL pr?par? r?par? ou corrig? automatiquement pendant l?essai : le corps correspond ? la revue approuv?e.

## 4. Cr?ation et catalogues v?rifi?s dans la transaction

| Table cr??e provisoirement | Mod?le |
|---|---|
| public.meta_webhook_endpoints | MetaWebhookEndpoint |
| public.meta_webhook_receipts | MetaWebhookReceipt |
| public.meta_webhook_events | MetaWebhookEvent |
| public.meta_webhook_receipt_items | MetaWebhookReceiptItem |

Contr?les de catalogue r?ussis :

- **86 colonnes**, chacune compar?e au bloc Prisma documentaire pour son nom SQL, type et nullabilit? : UUID, BIGINT/INTEGER/SMALLINT, BOOLEAN, BYTEA, VARCHAR born?s et TIMESTAMPTZ(3).
- **4 cl?s primaires**, sur id, une par table.
- **4 cl?s ?trang?res**, toutes internes au p?rim?tre Meta ; actions ON DELETE/ON UPDATE RESTRICT. Deux liens simples endpoint, deux liens composites de ReceiptItem vers Receipt/Event avec endpoint_id partag?.
- **7 contraintes UNIQUE**, en plus des cl?s primaires et des deux index uniques partiels : scope endpoint, compte, uniques composites parents, identit? versionn?e, enqueue_order et position de manifeste.
- **7 contraintes CHECK** : param?tres d?endpoint, compteurs/empreinte de receipt, valeurs d??v?nement, bail, payload, r?sultat et valeurs/variante de receiptItem.
- **25 index**, tous indisvalid=true et indisready=true. Ce nombre inclut les index des PK/UNIQUE, les index de recherche/r?tention et les deux index uniques partiels (un endpoint actif ; une occurrence NEW par ?v?nement).
- **7 fonctions Meta et 7 triggers utilisateur** cr??s par le SQL ; trois triggers de contrainte DEFERRABLE INITIALLY DEFERRED. Ces derniers apparaissent aussi dans pg_constraint sous contype=t, en compl?ment des 22 contraintes de table PK/FK/UNIQUE/CHECK.
- Une nouvelle s?quence BIGSERIAL pour enqueue_order, exclusivement li?e ? la table Meta provisoire ; les s?quences existantes ne sont jamais appel?es par nextval/setval.

Les d?finitions des contraintes/index et m?tadonn?es figurent dans output/meta-whatsapp-transaction-evidence.json. Les tests n?affirment pas couvrir chaque branche de tous les CHECK ou de chaque fonction PL/pgSQL.

## 5. Tests de contraintes et relations

Donn?es exclusivement fictives : UUID al?atoires, identifiants techniques synth?tiques, empreintes de 32 octets et payload factice non personnel. Aucune donn?e m?tier pr?existante utilis?e comme fixture. Les flags d?endpoint sont rest?s false par d?faut ; aucun canal activ?.

Le payload est un placeholder de test SQL, pas un ciphertext destin? ? un vrai d?chiffrement. Cette validation n?exerce pas la cryptographie ou l?authentification d?un webhook.

| # | Contr?le | R?sultat SQL observ? | Validation |
|---|---|---|---|
| 1 | Catalogue : tables, colonnes/types/nullabilit?, contraintes, index et triggers | Accept?/v?rifi? | R?ussi |
| 2 | Insertion valide d?un lot complet dans les quatre tables | Accept?/v?rifi? | R?ussi |
| 3 | Doublon de p?rim?tre endpoint | 23505 | R?ussi |
| 4 | Doublon d?identit? s?mantique ?v?nement | 23505 | R?ussi |
| 5 | R?f?rence endpoint inexistante | 23503 | R?ussi |
| 6 | R?f?rence ?v?nement inexistante | 23503 | R?ussi |
| 7 | CHECK environnement invalide | 23514 | R?ussi |
| 8 | CHECK empreinte de taille incorrecte | 23514 | R?ussi |
| 9 | CHECK ?tat inconnu | 23514 | R?ussi |
| 10 | CHECK bail PROCESSING incomplet | 23514 | R?ussi |
| 11 | R?f?rence de manifeste entre endpoints diff?rents | 23503 | R?ussi |
| 12 | Position de manifeste dupliqu?e | 23505 | R?ussi |
| 13 | Deux occurrences NEW pour le m?me ?v?nement | 23505 | R?ussi |
| 14 | Manifeste incomplet d?tect? en validation diff?r?e | 23514 | R?ussi |
| 15 | ?v?nement cr?? sans occurrence NEW | 23514 | R?ussi |
| 16 | Empreinte de contenu contradictoire dans le manifeste | 23514 | R?ussi |
| 17 | Graphe fictif restant valide avant annulation globale | Accept?/v?rifi? | R?ussi |

Codes attendus : **23505** unique_violation ; **23503** foreign_key_violation, y compris les rejets ?quivalents explicites des triggers de garde ; **23514** check_violation, y compris invariants de triggers. Les diagnostics de trigger attendus incluent META_ENDPOINT_REQUIRED, META_EVENT_REQUIRED, META_RECEIPT_REQUIRED, META_MANIFEST_INCOMPLETE, META_NEW_EVENT_OCCURRENCE_REQUIRED et META_MANIFEST_EVENT_MISMATCH.

Les rejets attendus n?ont pas interrompu la transaction principale : chaque cas n?gatif ?tait encadr? par SAVEPOINT, ROLLBACK TO SAVEPOINT et RELEASE SAVEPOINT. Aucune r?cup?ration improvis?e d?une transaction SQL abort?e.

**Les contraintes diff?r?es ont ?t? r?ellement d?clench?es**, sans COMMIT, par SET CONSTRAINTS ALL IMMEDIATE, puis remises en mode diff?r? lorsque n?cessaire. Cela v?rifie le contr?le du graphe final et les rejets diff?r?s ; un ROLLBACK sans ce d?clenchement n?aurait pas suffi ? les tester.

Total : **17 contr?les r?ussis**, dont 14 rejets n?gatifs attendus ; aucune erreur impr?vue. Il ne s?agit ni des 14 tests applicatifs WhatsApp historiques, ni d?une suite globale, ni de tests r?seau Meta.

## 6. Annulation et nouvelle connexion de v?rification

La transaction d?essai est ouverte explicitement en REPEATABLE READ READ WRITE, ce qui permet uniquement les ?critures transactionnelles autoris?es ? cette mission. Le d?faut de connexion reste READ ONLY ; le mode READ WRITE est limit? ? cette transaction.

La cl?ture a ex?cut? **ROLLBACK**, confirm? sans erreur, puis ferm? cette connexion. Aucune branche de succ?s ne peut effectuer COMMIT. Une erreur impr?vue aurait ?galement conduit ? ROLLBACK/fermeture, puis ? la v?rification de non-persistance.

Une **seconde connexion**, explicitement sur la m?me cible, a commenc? une nouvelle transaction REPEATABLE READ READ ONLY. Son identit? a ?t? rev?rifi?e, avec transaction_read_only=on. Apr?s ses lectures, elle a ?galement ?t? termin?e par ROLLBACK et ferm?e.

| V?rification apr?s annulation | R?sultat |
|---|---|
| Quatre tables Meta | Absentes |
| Relations Meta nouvelles : s?quence/index inclus dans comparaison globale | Absentes |
| Fonctions meta_inbox_* | Absentes |
| Tables Provider*/Gupshup | Absentes |
| Historique Prisma | 44 lignes r?ussies, m?mes m?tadonn?es et checksums |
| Relations, colonnes/defaults, contraintes, fonctions et triggers utilisateur pr?existants examin?s | Identiques ? la photographie initiale |
| Contenu des **69 tables m?tier** | Comptages et empreintes SHA-256 calcul?s c?t? serveur identiques |
| Table _prisma_migrations | Contenu ?galement compar? par empreinte, en plus de son inventaire d?taill? |
| **63 s?quences pr?existantes** | last_value et is_called inchang?s |
| schema.prisma, .env, 44 migrations et document de revue | Empreintes locales inchang?es |

Les empreintes de contenu sont produites sur le serveur ? partir de lignes canonicalis?es par to_jsonb puis de hashes tri?s ; aucun contenu de ligne, message WhatsApp ou donn?e personnelle n?est renvoy?/affich?. La comparaison s?effectue entre deux photographies sous la m?me configuration de session UTC.

Le r?sultat d?montre une **absence de persistance logique** dans les objets/donn?es examin?s. Une transaction annul?e peut n?anmoins g?n?rer WAL, traces de journal, statistiques ou allocations internes d?identifiants : l?essai n?est pas pr?sent? comme une absence d??criture physique sur disque. La s?quence Meta cr??e dans la transaction est supprim?e avec celle-ci, y compris ses valeurs consomm?es lors des essais n?gatifs.

## 7. Anomalies et limites

Aucune anomalie SQL impr?vue d?tect?e. Aucun ajustement du DDL, changement de sch?ma source ou ?largissement de permissions effectu?.

Limites restant ? lever avant une application d?finitive/activation :

1. **R?le d?ex?cution :** l?essai utilise l?administrateur de test existant. Il ne certifie pas les permissions minimales du migrateur ou d?un worker. Ownership, ACL et privil?ges PUBLIC des futurs objets restent ? auditer s?par?ment.
2. **Transactions concurrentes :** les effets DDL/tests ont ?t? ex?cut?s dans une seule transaction, conform?ment ? la mission. Aucun test multi-processus de baux, deadlocks, STOP/r?servation ou fronti?re r?seau n?est d?montr? ici.
3. **Application :** pas d?adaptateur Prisma r?ellement g?n?r? depuis ces mod?les, worker, traitement de webhook ou int?gration m?tier exerc? par cet essai.
4. **Couverture :** cas repr?sentatifs d?unicit?, r?f?rences, isolation, CHECK et contraintes diff?r?es ; pas une preuve exhaustive de toutes les transitions/purges, rotations de cl?s, tailles limites ou combinaisons nullables.
5. **Exploitation :** aucun test de restauration, de crash serveur, de charge ou d?envoi ; aucune garantie exactement-une-fois sur une API externe.
6. **Provider* :** les six mod?les source non migr?s restent inchang?s ; une g?n?ration globale de migration pourrait encore les embarquer.

## 8. Recommandation et point d?arr?t

Le SQL propos? peut passer ? une **revue finale d?application persistante**, sans avoir n?cessit? de correction durant cette validation. Avant une telle application : approuver explicitement le p?rim?tre des quatre mod?les Meta, le r?le/ownership et les ACL, reconfirmer la sauvegarde et la proc?dure de repli, isoler la divergence Provider* dans les outils Prisma et autoriser s?par?ment chaque changement.

La coordination r?elle STOP/envoi et les tests de concurrence restent indispensables avant toute activation asynchrone avec des senders actifs. La r?ussite du DDL ne l?ve pas ce blocage.

Artefacts :

- docs/meta-whatsapp-transaction-validation.md : pr?sent rapport.
- tmp/meta-whatsapp-transaction-ddl-review.sql : corps SQL de revue, hors BEGIN/COMMIT documentaires ; **pas une migration Prisma**.
- tmp/meta-whatsapp-transaction-validation.cjs : script ? transaction d?essai unique, ROLLBACK obligatoire et seconde connexion READ ONLY.
- output/meta-whatsapp-transaction-local-inventory.json, meta-whatsapp-transaction-evidence.json et meta-whatsapp-transaction-file-verification.json : preuves sans secrets ni contenu personnel.

Aucun port 5432, production, .env modifi?, migration Prisma, COMMIT, worker WhatsApp, appel Meta/Gupshup ou message r?el. Aucune ?criture SQL m?tier ; seules les cr?ations et fixtures Meta ?ph?m?res autoris?es ont ?t? effectu?es puis annul?es.

**Point d?arr?t atteint : les deux connexions sont ferm?es, aucun objet Meta n?est conserv?. Attente d?autorisation avant toute migration persistante ou autre modification.**
