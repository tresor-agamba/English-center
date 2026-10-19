# Coordination STOP / soumission Meta

18 octobre 2026, Kinshasa. **30 tests PostgreSQL r?ussis, 0 ?chec ; 297 tests isol?s r?ussis.** Route r?elle et workers toujours d?sactiv?s.

## Cause et correction

Le service conservait une lecture de consentement pendant qu'un STOP pouvait ?tre valid?, puis appelait le transport sans autorisation atomique commune. Le sc?nario original est conserv? avec la m?me assertion z?ro soumission et passe d?sormais.

Nouveau module src/services/whatsappSubmissionCoordinator.js : verrou consultatif transactionnel PostgreSQL dans un espace de cl?s stable par destinataire normalis?, ind?pendant des processus et des cl?s de chiffrement. Le num?ro sert ? coordonner les droits d'envoi, jamais ? corr?ler des callbacks. Tous les destinataires d'un lot sont verrouill?s dans un ordre d?terministe.

R?ception durable de l'inbox, traitement entrant et retrait explicite des pr?f?rences prennent ce verrou. Les trois services sortants (conversation, relance commerciale, notification) ex?cutent apr?s leur pr?paration une transaction courte READ COMMITTED qui acquiert le verrou, relit les droits et l'?tat courant, contr?le la barri?re inbox puis inscrit par CAS le marqueur SUBMISSION_ENGAGED dans failure_code. Les ?tats autoris?s, tentatives et identifiants fournisseur sont v?rifi?s ; une incoh?rence de version des cl?s inbox interdit l?engagement plut?t que de masquer une barri?re. READ COMMITTED garantit une nouvelle lecture apr?s une ?ventuelle attente de verrou. Aucun retry automatique d'un engagement dont le COMMIT est ambigu.

Le transport est appel? **apr?s retour de la transaction**, sans transaction SQL ouverte. Un endpoint inbox actif impose une barri?re explicitement li?e ? son scope ; en son absence, l'engagement est refus?. Les contr?les humains, consentements, fen?tres de service et backoff existants restent pr?sents. Les annulations STOP ne remplacent pas le marqueur d'un envoi d?j? engag? dans les circuits relance/notification.

## R?gle de coordination et limite explicite

Le **COMMIT de SUBMISSION_ENGAGED est le point d'engagement durable**, pas la preuve qu'un octet HTTP a ?t? ?mis. Un STOP dont la transaction d'enregistrement ou d'application est d?j? valid?e emp?che tout nouvel engagement correspondant : la barri?re bloque un entrant en attente, et le retrait appliqu? bloque l'autorisation m?tier. La garantie suppose ces chemins coordonn?s ; une ?criture SQL administrative directe ou un appel direct au transport contourne le protocole et n'est pas une voie d'exploitation admise.

Un engagement valid? avant le STOP reste un cas distinct : son appel peut commencer physiquement ou se terminer **apr?s** l'enregistrement du STOP. Cette fen?tre entre le COMMIT et le r?seau existe encore et est document?e/test?e s?par?ment, sans assouplir le test original o? le STOP pr?c?de l'engagement. Le protocole ne garantit pas ? z?ro premier octet HTTP apr?s tout COMMIT STOP ?, n'annule pas un appel r?seau et ne pr?tend pas ? une transaction atomique PostgreSQL/Meta. Maintenir une transaction pendant HTTP est explicitement ?vit?.

| ?tat | Preuve / comportement |
|---|---|
| En attente | QUEUED/PENDING, aucun droit d'appeler le r?seau |
| R?serv? | PROCESSING, failure_code nul, aucun engagement durable ; CAS final obligatoire |
| Engag? durablement | PROCESSING + SUBMISSION_ENGAGED, transaction valid?e ; une seule invocation dans le chemin normal |
| R?seau commenc? | Observation du transport, distincte de la preuve SQL ; impossible ? reconstituer s?rement apr?s crash sans r?ponse |
| STOP re?u | Requ?te authentifi?e re?ue, sans pr?sumer sa persistance |
| STOP enregistr? | COMMIT du re?u/?v?nement inbox ; barri?re tant qu'il est en attente |
| STOP appliqu? | OPTED_OUT / consentement r?voqu? dans la transaction m?tier ; nouvel engagement refus? |
| R?sultat incertain | FAILED + DELIVERY_UNCERTAIN ; pas de renvoi automatique, r?conciliation par identifiant exact/callback |

## Crashs, reprise et non-duplication

La r?servation et l'engagement sont distinguables avant r?cup?ration. La r?cup?ration existante, conservatrice, classe les PROCESSING abandonn?s en DELIVERY_UNCERTAIN, y compris lorsqu'aucun r?seau n'a probablement commenc?. Elle ne remet pas ces lignes en file. Un ancien worker ne peut plus engager une r?servation r?cup?r?e : ?tat et compteur de tentative doivent correspondre.

Un crash apr?s le COMMIT d'engagement, avant HTTP ou pendant HTTP, ne rend jamais l'intention automatiquement rejouable. La perte de disponibilit? est pr?f?r?e ? un double envoi : revue/r?conciliation n?cessaire si aucune preuve exacte n'arrive. Un sous-processus de test a r?ellement ?t? termin? pendant un faux appel suspendu ; un nouveau client retrouve l'engagement, refuse son rejeu puis le r?cup?re comme incertain. PostgreSQL et Windows n'ont pas ?t? red?marr?s.

## Validation

Commande PostgreSQL, avec identifiants DPAPI en m?moire et opt-in de cible explicite : node --test tests/metaInboxPostgres.integration.test.js. **30/30, 2 590,0546 ms**.

Couvre : les 19 sc?narios ant?rieurs (dont l'ancien ?chec), STOP avant r?servation, pendant pr?paration, apr?s derni?re lecture, avant engagement, apr?s engagement mais avant r?seau, pendant r?seau, STOP simultan?s, deux workers, deux processus Node ind?pendants, callbacks pr?coces/tardifs, crashs/r?cup?ration, isolation transactionnelle, absence de transaction SQL pendant le faux transport, absence de rejeu apr?s r?sultat incertain et courses des circuits relance/notification. Les horloges de r?cup?ration sont inject?es pour simuler l'expiration, sans temporisation pour masquer une course.

Commande isol?e : node --require ./tests/helpers/whatsappIsolationGuard.cjs --test [les 12 fichiers du script test:whatsapp:isolated] tests/metaInboxWebhookController.test.js tests/metaInbox.test.js tests/metaInboxPrismaAdapter.test.js tests/metaWhatsAppConsolidation.test.js tests/whatsappSubmissionCoordinator.test.js. **297/297, 1 107,545 ms**. Garde interdisant pg, Prisma r?el et fetch ; scripts inspect?s, aucune suite globale. Les anciens mocks de relances ont ?t? compl?t?s pour comprendre le filtre OR de failureCode, sans modifier leurs assertions. Les mod?les purs sans capacit?s SQL ne simulent pas une preuve transactionnelle ; hors NODE_ENV=test, l'absence de ces capacit?s ?choue ferm?e.

## ?tat de la base et fichiers

Cible rev?rifi?e en READ ONLY : 127.0.0.1:55432 / nva_whatsapp_test, PostgreSQL 16.15, D:/NVA-WhatsApp-Test/data, identifiant 7696610946073769572, compte existant nva_whatsapp_test_admin. Aucune permission modifi?e. Les permissions du futur compte de service restent ? valider distinctement.

44 migrations conformes et catalogues inchang?s ; aucun Provider*, index invalide, contrainte non valid?e ou FATAL/PANIC observ?. schema.prisma (y compris Provider*), .env et les 44 fichiers historiques ont gard? leurs empreintes. Aucun DDL, migration, reset ou suppression de donn?es. Les transactions de tests peuvent annuler leurs seules insertions non valid?es.

Les donn?es fictives de tous les passages sont conserv?es, contrairement au nettoyage de la mission pr?c?dente : enrollments=0, notifications=2, users=2, whatsapp_commercial_consent_events=30, whatsapp_conversation_messages=140, whatsapp_conversations=59, whatsapp_deliveries=2, whatsapp_preferences=2, whatsapp_prospect_follow_ups=2. Les empreintes des lignes pr?existantes des 69 tables m?tier sont pr?serv?es en excluant uniquement les IDs fictifs suivis par le harnais. Tous les endpoints Meta sont d?sactiv?s. Les compteurs de s?quence ont avanc? normalement, sans reset.

Code modifi? : whatsappConversationDeliveryService.js, whatsappProspectFollowUpService.js, whatsappDeliveryService.js, whatsappConversationService.js, whatsappPreferenceService.js, metaInboxRepository.js ; module whatsappSubmissionCoordinator.js cr??. Tests : metaInboxPostgres.integration.test.js ?tendu, helpers/whatsappSubmissionChild.cjs et whatsappSubmissionCoordinator.test.js cr??s, matcher de whatsappProspectFollowUp.test.js compl?t?.

Preuves : output/meta-stop-postgres.log, output/meta-inbox-postgres-tests.json, output/meta-stop-isolated-full.log, output/meta-stop-final-readonly.json.

## Avant activation r?elle

Faire approuver la s?mantique d'engagement durable et ses limites r?seau ; configurer le compte minimal et la barri?re scope/crypto sur chaque circuit ; valider cl?s, supervision des engagements incertains et r?tention ; autoriser s?par?ment le raccordement. Aucun webhook r?el, worker, appel Meta/Gupshup, port 5432, production ou d?ploiement utilis?.
