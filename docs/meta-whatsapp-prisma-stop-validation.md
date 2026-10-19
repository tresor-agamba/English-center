# Client Prisma Meta et validation STOP/envoi

18 octobre 2026, Kinshasa. **Client finalis? ; activation bloqu?e par une course STOP/envoi d?montr?e.**

## Impl?mentation

- Ajout ? prisma/schema.prisma des quatre mod?les MetaWebhookEndpoint, MetaWebhookReceipt, MetaWebhookEvent et MetaWebhookReceiptItem, issus de la revue approuv?e. Les noms de FK et de la contrainte enqueue_order sont explicitement align?s sur le catalogue existant. Les 86 colonnes scalaires sont repr?sent?es. CHECK, index partiels et triggers diff?r?s restent g?r?s par le SQL d?j? appliqu?.
- Tous les blocs source pr?existants sont pr?serv?s ? l'identique ; les six Provider* restent d?clar?s, sans op?ration SQL les concernant. Aucune migration ni DDL pendant cette intervention.
- G?n?ration locale : node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma. Prisma 6.19.3, 79 mod?les ; delegates metaWebhookEndpoint, metaWebhookReceipt, metaWebhookEvent, metaWebhookReceiptItem disponibles avec findMany/findUnique/create/upsert/update/updateMany. Aucune installation. Le CLI a lu .env selon son comportement habituel ; DATABASE_URL ?tait surcharg?e en m?moire par une URL fictive de g?n?ration sur 55432. Aucun changement de .env.
- Client g?n?r? sous node_modules/.prisma/client, import? par @prisma/client. Les v?ritables op?rations du repository ont ?t? exerc?es avec ce client.
- Correction src/repositories/metaInboxRepository.js:51 : pg_advisory_xact_lock(... )::text AS locked. Prisma ne d?s?rialise pas void (P2010 confirm? au premier essai). La projection ne change ni le verrou acquis ni sa dur?e transactionnelle.
- Nouveau fichier tests/metaInboxPostgres.integration.test.js : cible explicite et identit? v?rifi?e avant les fixtures, clients ind?pendants, transport inject?, fetch/http/https interdits, aucun worker lanc?.

## R?sultats

**PostgreSQL : 18 r?ussis / 19, 1 ?chec, 0 ignor? ; 1 924,8737 ms.**
**Isol?s : 96 r?ussis, 0 ?chec ; 780,1606 ms.**

| Sc?nario PostgreSQL | R?sultat |
|---|---|
| real client persists encrypted events and committed receipt manifests | OK |
| deduplication persists two receipts but only one event | OK |
| atomic batch rolls back all rows after an injected storage failure | OK |
| concurrent duplicate acceptance has one event and no silent loss | OK |
| uncorrelated callback remains durable then is applied after exact correlation | OK |
| late callbacks cannot regress READ status | OK |
| effect error rolls back business effect and records retry state | OK |
| independent connection sees no uncommitted business update | OK |
| STOP committed before send prevents the injected transport call | OK |
| pending STOP blocks the repository simulated submission protocol | OK |
| STOP during preparation is seen by the delivery final database check | OK |
| STOP after final read must prevent a newly submitted send (activation requirement) | ?CHEC : attendu 0 soumission, observ? 1 |
| STOP during an already engaged mock network call prevents subsequent sends | OK |
| simultaneous STOP messages produce one revoked state and no sends | OK |
| two concurrent workers cannot acquire the same event lease | OK |
| two concurrent delivery calls perform only one simulated submission | OK |
| STOP acceptance waits for an existing simulated reservation and blocks the next one | OK |
| expired lease is reclaimed by a fresh client and old owner is fenced | OK |
| durable pending STOP survives producer disconnect and blocks another sender | OK |

Les premiers passages ont r?v?l? puis permis de corriger la projection void et des d?fauts de fixtures : identit? Meta r?utilis?e malgr? une unicit? conserv?e apr?s d?sactivation, processingStatus obligatoire sur les messages entrants. Les comparaisons de catalogues/donn?es ont ?t? normalis?es en UTC et les dates du manifeste JSON d?s?rialis? normalis?es pour comparaison. Aucune contrainte ni assertion m?tier n'a ?t? affaiblie. Les erreurs SQL de s?rialisation rencontr?es lors des tests concurrents sont prises en charge par les retries transactionnels existants ; les effets r?seau simul?s ne sont pas automatiquement rejou?s.

## Course bloquante confirm?e

Dans whatsappConversationDeliveryService.js:46, le service lit le message et la conversation. Le test suspend le retour de cette deuxi?me lecture **apr?s son ex?cution r?elle en base**. Un STOP est ensuite accept? et enti?rement trait? par le moteur NVA dans la transaction inbox : OPTED_OUT est ?crit et COMMIT effectu?. Le test lib?re la lecture ancienne. Le service appelle pourtant sender ? la ligne 63 : une soumission simul?e apr?s prise en compte du STOP, contre z?ro attendu. L'assertion reste en ?chec.

Le STOP d?j? trait? avant r?servation bloque l'envoi. Un STOP pendant la pr?paration, avant la derni?re lecture, est ?galement vu. Pour un appel d?j? engag?, le test permet la fin de cet appel simul? et v?rifie qu'aucun second envoi n'est effectu?. Cela ne prouve ni annulation d'une requ?te d?j? transmise ni livraison exactement une fois.

Le protocole simulateDispatch de l'inbox bloque un STOP en attente et partage r?ellement les verrous PostgreSQL : un test observe wait_event_type=Lock sur la connexion qui tente d'accepter le STOP pendant une r?servation simul?e. Cela ne s?curise pas le service d'envoi actuel, qui n'utilise pas ce protocole. simulateDispatch reste interdit hors du mode isol? de test et ne doit pas ?tre raccord? au transport r?el.

**Correction ? concevoir avant activation :** faire participer r?ception/acceptation, traitement STOP et tous les circuits de soumission sortante ? une m?me coordination explicite, avec fronti?re d'autorisation et soumission d?finie, fences de propri?taire et traitement durable des r?sultats incertains. Une simple lecture suppl?mentaire ne ferme pas la course. Ne pas r?essayer automatiquement un appel r?seau dont l'acceptation est incertaine. Aucun changement de d?cision m?tier ou de service d'envoi n'a ?t? appliqu? ici.

## ?tat final contr?l? en READ ONLY

- Identit? : PostgreSQL 16.15, 127.0.0.1:55432, nva_whatsapp_test, D:/NVA-WhatsApp-Test/data, identifiant 7696610946073769572, hors r?cup?ration. Aucun red?marrage pendant cette intervention.
- Compte existant nva_whatsapp_test_admin, propri?taire des objets Meta. Le runner historique ne dispose pas d'INSERT sur Meta ; aucun GRANT ni changement de r?le effectu?. Les essais ne constituent pas une validation des permissions d'un futur compte de service minimal. Secrets DPAPI utilis?s uniquement en m?moire.
- 44 migrations SQL inchang?es, checksums en base et fichiers conformes ; historique _prisma_migrations non modifi?. Le SQL Meta pr?c?demment appliqu? reste ? r?concilier avec la tra?abilit? Prisma, sans migration g?n?rale incluant Provider*.
- Catalogues, contraintes, colonnes, fonctions et triggers inchang?s par rapport au pr?contr?le. Aucun objet Provider*, index invalide ou contrainte non valid?e. Aucun FATAL/PANIC observ? dans le journal de d?marrage courant.
- Contenu des 69 tables m?tier revenu ? son empreinte initiale ; les sept tables de fixtures sont vides. Seuls les enregistrements m?tier fictifs de cette suite ont ?t? supprim?s lors du nettoyage cibl?.
- Traces Meta fictives conserv?es par respect des triggers de r?tention : meta_webhook_endpoints=55, meta_webhook_events=41, meta_webhook_receipt_items=47, meta_webhook_receipts=47. Tous les endpoints sont d?sactiv?s, inbox_enabled et processing_enabled faux. Aucune purge forc?e. Les cl?s de chiffrement sont synth?tiques et limit?es ? l'ex?cution ; ces traces ne sont pas destin?es ? un futur traitement r?el.
- Les s?quences suivantes ont avanc? normalement pendant les insertions fictives et n'ont pas ?t? r?initialis?es : meta_webhook_events_enqueue_order_seq, whatsapp_commercial_consent_events_id_seq, whatsapp_conversation_messages_id_seq, whatsapp_conversations_id_seq.
- Sch?ma source SHA-256 : 1fdcd113ff9970844e4cac99e4cf07e043b12a415796065b1554f78891c01761. Empreinte du sch?ma g?n?r? normalis? : 07814ed8aa1d08e455d1c4ee048313108f53ec393bc920928d3631f7323fed0f.

## Reprise et limites

Les essais d?montrent une persistance apr?s fermeture de la connexion productrice, une relecture par un nouveau client et la reprise d'un bail rendu expir? avec rejet de son ancien propri?taire. Ils ne red?marrent pas Windows/PostgreSQL et ne constituent pas un test de panne physique. Les cl?s restent inject?es dans le processus de test ; la conservation et rotation des cl?s r?elles rel?vent d'une configuration s?curis?e distincte.

Avant la route r?elle : r?soudre et retester la course bloquante, approuver le compte de service minimal, r?concilier la tra?abilit? du sch?ma, fournir les cl?s et identifiants s?curis?s, valider configuration/signatures/comptes et exploitation/r?tention. La route r?elle reste non raccord?e, le service d'acceptation reste limit? aux tests, aucun worker r?el ni canal activ?. Aucun appel Meta/Gupshup, message r?el, port 5432, production ou d?ploiement.

Preuves : output/meta-inbox-postgres-full.log, output/meta-inbox-postgres-tests.json, output/meta-prisma-final-readonly.json, output/meta-prisma-client-verification.json, output/meta-inbox-prisma-isolated.log.
