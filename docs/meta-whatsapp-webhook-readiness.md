# Pr?paration du webhook Meta NVA

Rapport du 19 octobre 2026. **Raccordement logiciel termin?, activation r?elle non effectu?e.**

## Permissions PostgreSQL

R?le cr?? sur le seul cluster de test v?rifi? : **nva_meta_inbox_ingress, NOLOGIN**, sans mot de passe ni membre h?rit?. NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS. Aucun CREATE, TEMPORARY ou GRANT OPTION effectif. Aucun objet poss?d? ou droit m?tier accord?.

| Objet | Droits pr?par?s |
|---|---|
| Base nva_whatsapp_test / public | CONNECT / USAGE |
| meta_webhook_endpoints | SELECT, UPDATE(id) uniquement pour FOR UPDATE ; aucune modification des flags autoris?e |
| meta_webhook_receipts | SELECT, INSERT ; UPDATE des quatre compteurs de manifeste |
| meta_webhook_events | SELECT, INSERT ; UPDATE limit? aux compteurs/r?ception, conflit/revue, ?tat/motif/?ch?ance et nettoyage des champs de bail requis par un conflit |
| meta_webhook_receipt_items | SELECT, INSERT |
| meta_webhook_events_enqueue_order_seq | USAGE uniquement |
| meta_inbox_lock_endpoint(uuid) | EXECUTE explicite ; les sept fonctions techniques Meta sont aussi ex?cutables par PUBLIC selon les ACL pr?existantes |

Aucun DELETE/TRUNCATE/REFERENCES/TRIGGER accord?. Aucun droit sur les tables ou s?quences m?tier, ni leurs ACL modifi?es. L'audit inclut les privil?ges PUBLIC (aucun droit m?tier, CREATE/TEMP ou GRANT OPTION h?rit?). Le r?le d'ingestion ne remplace pas un compte de traitement m?tier : la consommation et l'application du STOP n?cessitent un principal distinct ? valider, sans r?utiliser automatiquement l'administrateur. Le scope est filtr? par l'application ; aucune nouvelle politique RLS n'a ?t? ajout?e.

SQL appliqu? dans une transaction v?rifi?e puis COMMIT : docs/sql/meta-inbox-ingress-role.sql. SHA-256 : c8f7618e9e05a48ddf9ba53d5f89ccdb714950612c647cecbc3f29ec76dae88c. Preuve : output/meta-ingress-role-evidence.json.

NOLOGIN est intentionnel : les cinq tests de droits utilisent SET LOCAL ROLE depuis le compte administrateur existant. Ils ne prouvent pas une connexion r?seau avec ce nouveau r?le. LOGIN, secret s?curis? et compatibilit? HBA devront ?tre autoris?s/valid?s s?par?ment ; aucun changement HBA ni identifiant r?el fourni ici.

## Route et barri?re inbox

- Route existante **/webhooks/whatsapp** raccord?e ? metaInboxWebhookController et ? une composition d'ingestion d?di?e, sans dispatcher/worker/sender automatique. Montage avant les sessions, CSRF et middlewares m?tier ; parsing brut JSON propre ? la route, limite 1 Mio, compression refus?e. Les autres chemins sous ce pr?fixe s'arr?tent sur 404.
- **META_WHATSAPP_INBOX_ENABLED=true** est obligatoire et strict. Sans ce flag, GET et POST retournent 503, sans initialiser de client. Aucun fallback vers l'ancien traitement synchrone. Aucun flag n'a ?t? activ? dans .env ou l'environnement contr?l?.
- GET : mode subscribe, comparaison exacte du verify_token, challenge texte. Ce token n'authentifie jamais un POST.
- POST : X-Hub-Signature-256 calcul?e sur les octets originaux, contr?le WABA/Phone Number ID, normalisation du lot entier, persistance atomique et d?duplication avant ACK 200. Signature/compte invalides : 403 ; payload invalide : 400 ; erreur de stockage/configuration : 503, sans diagnostic priv? expos?.
- **L'ACK valide l'acceptation durable du lot, pas l'application du STOP ni la livraison d'une r?ponse.** Le STOP enregistr? mais non trait? garde sa barri?re ; le traitement explicite utilise les transactions NVA existantes. Aucun message de r?ponse n'est envoy? par le webhook.
- Les callbacks sont conserv?s avant acquittement, y compris sans cible connue ; leur traitement ult?rieur peut les marquer UNCORRELATED et les reprendre. Il ne s'agit pas d'une garantie de conservation ?ternelle : disponibilit? PostgreSQL, cl?s de d?chiffrement, reprise et politique de r?tention restent n?cessaires.
- La garantie STOP/envoi conserve sa s?mantique d'engagement durable : un engagement ant?rieur au STOP peut encore commencer/terminer physiquement plus tard ; aucune r??mission automatique d'un r?sultat incertain.

## Configuration pr?par?e

Composition paresseuse src/services/metaInboxRuntime.js ; aucun fallback vers DATABASE_URL ou le compte m?tier. META_INBOX_DATABASE_URL est limit? ? 127.0.0.1:55432/nva_whatsapp_test et au r?le nva_meta_inbox_ingress, avec pool limit? ? quatre connexions. META_INBOX_ENVIRONMENT=test est impos? et la production est refus?e dans cette phase.

? fournir uniquement apr?s autorisation : META_INBOX_ENDPOINT_ID, META_INBOX_APPLICATION_KEY, META_INBOX_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, META_INBOX_AUTH_KEY_VERSION ; META_INBOX_LOOKUP_KEYS_JSON / META_INBOX_LOOKUP_KEY_VERSION, META_INBOX_STREAM_KEY_HEX / META_INBOX_STREAM_KEY_VERSION et META_INBOX_ENCRYPTION_KEYS_JSON / META_INBOX_ENCRYPTION_KEY_VERSION. Cl?s distinctes de 32 octets et versions coh?rentes avec l'endpoint. Aucun Graph access token n?cessaire ? cette r?ception seule. Les secrets doivent venir d'un m?canisme s?curis?, pas de ce document.

## Tests et v?rifications

- **308 tests isol?s/HTTP r?ussis, 0 ?chec** ; dont 11 nouveaux sc?narios HTTP loopback : GET, activation absente, signature valide/invalide, identit? de compte, conservation des octets apr?s parser applicatif, doublon, STOP, attente de persistance avant ACK, erreur de stockage, recomposition et callback non corr?l?, refus du runtime mal configur?. Dur?e du passage final : 1 496,4861 ms.
- **35 tests PostgreSQL r?ussis, 0 ?chec** : 30 sc?narios existants de persistance/concurrence STOP et cinq tests sous le r?le minimal (STOP sign?, doublon, callback durable, conflit ? conserver, refus effectif des capacit?s hors p?rim?tre). Dur?e : 2 611,4002 ms. Aucun serveur/worker red?marr?.
- La suite historique whatsappWebhookSecurity.test.js teste maintenant explicitement son contr?leur historique, avec ses assertions intactes. Elle ne pr?tend pas v?rifier l'ancienne s?mantique 403/401 sur la nouvelle route d?sactiv?e, dont le contrat 503 est couvert s?par?ment par metaWebhookRoute.test.js.
- La v?rification finale READ ONLY confirme le serveur 16.15, le cluster attendu et l'identifiant 7696610946073769572 ; 44 migrations conformes, ACL m?tier et catalogues examin?s inchang?s hors droits Meta autoris?s ; aucun Provider*. Tous les endpoints sont d?sactiv?s. Les fixtures synth?tiques sont conserv?es, sans suppression/reset.
- .env, schema.prisma et les 44 fichiers de migration inchang?s. Aucun appel Meta/Gupshup, aucun envoi r?el, aucun worker, aucune activation ou d?ploiement. Les URL fictives de port interdit pr?sentes dans les tests sont rejet?es avant construction d'un client ; aucune connexion ? 5432.

Fichiers principaux : src/app.js, src/routes/whatsappWebhookRoutes.js, src/controllers/metaInboxWebhookController.js, src/services/metaInboxService.js, src/services/metaInboxRuntime.js ; tests/metaWebhookRoute.test.js et tests/metaInboxIngressRole.integration.test.js ; fixture de tests/whatsappWebhookSecurity.test.js. Aucun mod?le Provider* modifi?.

Preuves : output/meta-webhook-postgres-tests.log, output/meta-webhook-isolated-full.log, output/meta-ingress-role-tests.json, output/meta-webhook-final-readonly.json, output/meta-webhook-protected-files.json.

## Conditions avant activation

Autorisation explicite, pr?paration des identifiants du r?le NOLOGIN/HBA, validation du principal de traitement m?tier et des droits n?cessaires sans ?largissement automatique, cl?s durables/versionn?es, endpoint et barri?re scope configur?s, reprise/r?tention/supervision pr?tes et exposition HTTPS revue. La route est raccord?e dans le code mais demeure d?sactiv?e ; aucune inscription r?elle chez Meta n'a ?t? effectu?e.
