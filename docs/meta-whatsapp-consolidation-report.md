# NVA — Consolidation Meta WhatsApp Cloud API

Date : 16 octobre 2026. Intervention locale sans activation, migration, accès PostgreSQL ou appel API fournisseur.

## Résultat

Les lacunes corrigibles sans base sont traitées : compteurs de webhook exacts, résultat détaillé des callbacks, refus d’acquittement des événements non résolus, observation sûre des erreurs, transport défensif, corrélation sans troncature et activation distincte des workers. **302 tests isolés réussis, 0 échec, 0 ignoré**, dont 36 nouveaux tests ciblés. Durée du passage final : **930,639 ms**.

Les règles de consentement, STOP, transfert humain, fenêtre de service, transitions monotones, réservations et backoff métier sont conservées. La conservation durable des callbacks inconnus reste un besoin non résolu : aucun stockage de remplacement n’a été créé.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| src/services/whatsappWebhookService.js | Résultats détaillés, compteurs distincts, événements non pris en charge, traitement observable de errors, factory de traitement injectable. |
| src/controllers/whatsappWebhookController.js | Journaux structurés sans déclaration globale de persistance ; HTTP 503 pour événements non résolus ; raisons d’erreur sur liste fermée. |
| src/services/whatsappDeliveryPolicy.js | Option detailed purement descriptive ; distinction mutation/ignoré/non corrélé/invalide ; validation propre des noms de statuts. Aucune condition métier ni CAS modifiés. |
| src/services/whatsappConversationDeliveryService.js | Transmission optionnelle de detailed à la politique partagée. Aucun changement du claim ou de l’envoi. |
| src/services/whatsappDeliveryService.js | Même transmission optionnelle. |
| src/services/whatsappProspectFollowUpService.js | Même transmission optionnelle. |
| src/services/whatsappCloudApiService.js | Contrôles locaux, clé de corrélation bornée, erreurs HTTP prudentes, deadline couvrant requête et corps, redirections refusées, erreurs réseau neutralisées. |
| src/config/whatsappConfig.js | workersEnabled lu depuis WHATSAPP_WORKERS_ENABLED, false par défaut. |
| src/jobs/whatsappDeliveryPoller.js | Composition du contrôle de worker ; API start/stop/runOnce conservée. |
| src/jobs/processWhatsAppDeliveries.js | CLI protégé, sans exécution à l’import ; même contrôle d’activation que le poller. |
| tests/whatsappConversationDelivery.test.js | Fixtures de transport rendues explicitement actives, ID synthétique numérique. Aucune assertion changée. |
| tests/whatsappDeliveryReliability.test.js | Fixture de transport explicitement enabled=true. Aucune assertion changée. |

Fichiers créés :

- src/jobs/whatsappWorkerControl.js : contrôle commun injectable pour les tests, processeurs chargés paresseusement.
- tests/metaWhatsAppConsolidation.test.js : 36 tests ciblés.
- tests/helpers/whatsappIsolationGuard.cjs : garde-fou préchargé des tests isolés.
- output/meta-whatsapp-consolidation-isolated.log : journal du passage final.
- docs/meta-whatsapp-consolidation-report.md : présent rapport.

## 1. Callbacks : reçu ne signifie plus appliqué

La politique partagée expose désormais une observation optionnelle :

| outcome | Signification |
|---|---|
| applied | Une mise à jour conditionnelle de statut a effectivement modifié une ligne. |
| ignored | Cible trouvée mais transition volontairement sans effet : doublon, statut plus avancé, annulation, échec terminal ou identifiant incompatible. |
| uncorrelated | Aucune cible trouvée par identifiant fournisseur ni clé de corrélation. |
| invalid | Statut ou identifiant requis non exploitable. |

Sans option detailed, les services gardent leur contrat booléen : true pour applied/ignored, false pour uncorrelated/invalid. Le routeur essaie les trois circuits seulement tant que le résultat reste uncorrelated. Un booléen true issu d’un ancien handler injecté est considéré comme handled/ignored, jamais comme preuve d’une écriture.

Le résumé de processPayload distingue received, applied, uncorrelated, invalid, unsupported, statusesReceived, statuses, statusesIgnored, inbound, duplicates, queuedResponses et providerErrors. **statuses compte désormais les seules mutations de statut**, et non tous les callbacks parcourus. applied inclut aussi les messages entrants nouveaux effectivement traités ; les doublons entrants ne l’incrémentent pas. Les messages entrants ignorés ne sont pas comptés appliqués.

Les statuts déjà traités restent acquittables sans nouvelle mutation. Les annulations ne sont pas rouvertes et READ/DELIVERED ne sont pas dégradés. Aucun compteur de tentative d’envoi ni clé existante n’est réécrit.

### Politique HTTP en l’absence d’inbox

- Lot valide entièrement pris en charge : HTTP 200.
- Au moins un callback non corrélé ou événement bien formé non pris en charge : HTTP 503, après observation du résumé.
- Lot malformé : HTTP 400, validation complète avant toute application.
- Signature incorrecte : HTTP 401 ; compte incorrect : HTTP 403 ; canal désactivé : HTTP 403 ; configuration invalide : HTTP 503.
- Exception de traitement : HTTP 500.

Un lot mixte bien formé peut avoir appliqué ses événements connus avant de retourner 503. Il sera potentiellement présenté à nouveau : les protections d’idempotence et de monotonie existantes restent indispensables. Aucun 503 n’effectue de nouvel envoi sortant.

**Limite explicite :** 503 est une demande de nouvelle présentation, pas une conservation durable, ni une garantie que Meta réessaiera indéfiniment. Si le fournisseur cesse ses présentations ou si aucune corrélation ne devient possible, l’événement peut rester perdu localement. Les journaux de compteurs ne permettent pas de reconstruire un callback. Un événement inconnu peut provoquer des répétitions du lot ; la résolution complète exige une inbox durable et un traitement d’événements non résolus.

## 2. Transport Meta

Un appel direct exige maintenant config.enabled === true, même avec fakeMode. Le faux transport est refusé en production. Avant toute requête réelle éventuelle, la version Graph, le Phone Number ID, le token non vide/sans retour de ligne et la deadline sont contrôlés.

La deadline reste de 10 secondes par défaut ; les tests peuvent la réduire via timeoutMs, jamais l’étendre au-delà de 10 secondes. Elle couvre la réception HTTP **et la lecture du JSON**. Une course explicite avec cette deadline borne aussi un mock qui ignorerait AbortSignal ; le signal d’annulation reste transmis. Aucun retry n’est effectué à l’intérieur du transport. Les redirections HTTP sont refusées pour éviter un changement implicite de destination.

| Résultat | Classification |
|---|---|
| Succès sans erreur fournisseur et avec ID de message | Retour du contrat existant { providerMessageId }. |
| HTTP 4xx avec objet d’erreur/code numérique, sans ID d’acceptation, hors 408 | Rejet confirmé ; non retryable, sauf 429. |
| HTTP 429 avec preuve de rejet structurée | Rejet temporaire ; les services conservent leur backoff existant et leur plafond. |
| HTTP 408, 5xx, corps absent/invalide, succès sans ID ou réponse contradictoire | Résultat incertain, aucun retry automatique. |
| Timeout ou exception réseau | DELIVERY_UNCERTAIN, retryable=false, aucune réémission automatique. |

Les erreurs classifiées exposent un code borné, une catégorie technique et le statut HTTP. Aucun message/details/trace/token retourné par le fournisseur n’est recopié dans leur message. Une exception arbitraire du transport ne peut pas imposer retryable=true en ajoutant ses propres drapeaux ; seul le classement interne d’une réponse est reconnu.

Cette classification est volontairement conservatrice. Elle **n’étend pas** les retries à des codes Meta dits temporaires ou à is_transient=true, et ne modifie pas les délais 1/5/30 minutes. Les pages actuelles du catalogue officiel Meta ont répondu HTTP 429 lors de la consultation : aucune table exhaustive de codes n’a été présentée comme revalidée. Les codes utilisés par les tests sont synthétiques ; leur catégorie est ici déterminée par le statut HTTP et la preuve d’erreur, pas par une nouvelle règle métier par code.

Une réponse fournisseur perdue ou une erreur de persistance après acceptation reste incertaine. La corrélation par callback peut apporter une preuve ultérieure ; sans preuve commune, aucun rapprochement par numéro ou heure et aucun renvoi automatique ne sont autorisés.

## 3. Clés de corrélation

La constante MAX_CORRELATION_LENGTH vaut 512. Une clé fournie doit être une chaîne non vide, avec au plus 512 unités JavaScript **et** 512 octets UTF-8 : borne locale conservatrice. Elle est transmise exactement, sans trim de transformation, conversion implicite ni slice.

Une clé trop longue, vide ou de type incorrect provoque INVALID_CORRELATION_KEY avant toute simulation ou requête réseau. Les deux constructeurs texte/modèle appliquent ce contrat. Une clé absente reste optionnelle afin de préserver les usages existants. Les clés déjà persistées ne sont pas modifiées. Une clé historique devenue non conforme sera refusée, pas tronquée ou migrée automatiquement.

Le webhook vérifie également le type et la longueur d’une clé présente avant de transmettre le lot aux services. Une clé de corrélation ne constitue toujours pas une idempotency key garantie côté Meta.

## 4. Événements errors, inconnus et sécurité

Les éléments errors sont comptés et observés via WHATSAPP_PROVIDER_EVENT_ERROR. Seul un code numérique borné est exposé ; toute autre valeur devient UNSPECIFIED. Aucun titre, texte d’erreur, détail, numéro, contenu de message, URL, token ou signature n’est envoyé au logger par ce traitement.

Un événement errors seul bien formé est acquitté après observation, sans prétendre à une conservation durable ni le compter appliqué. Aucune action sur une livraison n’est déduite d’une erreur générale sans identifiant exploitable.

Un statut futur bien formé ou un type entrant non pris en charge est compté unsupported, ne passe pas au handler métier et fait retourner 503. Les types entrants déjà pris en charge restent texte, interactif et médias existants. Un événement malformé dans un lot empêche tout traitement du lot. Les autres fields de souscription ne sont pas ouverts arbitrairement : le contrat reste limité au champ messages avec métadonnées de compte attendues.

La vérification HMAC sur le corps brut, le contrôle WABA/Phone Number ID, le GET de vérification et le refus des corps compressés sont préservés. Les tests existants de sécurité, y compris signature altérée et mauvais compte, continuent de passer. Les raisons d’erreur journalisées par le contrôleur proviennent d’une liste fermée.

## 5. Activation contrôlée

Deux autorisations distinctes sont requises par le poller et le worker CLI :

1. WHATSAPP_ENABLED=true : canal autorisé selon la configuration existante.
2. WHATSAPP_WORKERS_ENABLED=true : traitement automatique explicitement autorisé.

Le second indicateur vaut **false par défaut**. Sous NODE_ENV=test, start et runOnce refusent toujours de démarrer les workers, même lorsque les deux indicateurs sont true. Les tests du chemin positif utilisent uniquement une factory et des processeurs injectés en mémoire, avec horloge d’environnement simulée ; aucun serveur NVA n’est démarré.

Les processeurs métier ne sont chargés qu’après le contrôle, et les indicateurs sont revérifiés entre circuits. Le verrou local contre deux runOnce simultanés reste présent ; il ne remplace pas les claims PostgreSQL. Importer le fichier CLI ne lance plus le worker, ne charge pas dotenv et n’instancie pas Prisma.

**Changement opérationnel volontaire :** un futur déploiement sans opt-in des workers laisse les files en attente. Rien ne les vide ni ne les modifie pour compenser. La configuration réelle doit être autorisée et revue séparément. stop ou une désactivation ne rappellent pas un appel réseau déjà parti ; aucun mécanisme d’annulation rétroactive n’est promis. Les appels de service explicites restent soumis à leurs règles métier, le transport restant protégé par enabled.

Aucun fichier .env modifié et aucune variable du processus applicatif réel changée. Les valeurs de protection utilisées pour les tests sont limitées aux processus de test et à leurs fixtures restaurées.

## 6. Tests exécutés et isolation

Avant exécution : inspection du script test:whatsapp:isolated, des imports des fichiers retenus, des clients/mocks injectés, de la création des serveurs HTTP locaux et des dépendances Prisma transitives. Les services chargent aussi des constantes Prisma ; le garde-fou permet ces constantes mais remplace le constructeur par un refus et le singleton applicatif par des méthodes qui échouent si elles ne sont pas mockées. Le chargement du pilote pg est interdit. global.fetch est interdit ; les tests du transport utilisent exclusivement fetchImpl injecté.

Un premier passage ciblé a été arrêté à l’import par le garde-fou, qui interdisait aussi l’accès aux constantes Prisma. Ce problème du harnais a été corrigé en autorisant uniquement ces exports sans permettre la construction d’un client réel. Aucune connexion ni réparation de base n’a eu lieu.

Commande du passage final, sans script npm ni hook :

```text
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappIntegrationTarget.test.js tests/whatsappHumanHandoff.test.js tests/whatsappHumanHttp.test.js tests/whatsappConversationContext.test.js tests/whatsappConversationPersistence.test.js tests/whatsappConversationEngine.test.js tests/whatsappDeliveryReliability.test.js tests/whatsappConversationDelivery.test.js tests/whatsappProspectFollowUp.test.js tests/whatsappWebhookSecurity.test.js tests/whatsappAdminConversations.test.js tests/whatsappPreferenceOptOut.test.js tests/whatsappFixtureClock.test.js tests/gupshupPhase2.test.js tests/gupshupDurableStore.test.js tests/metaWhatsAppConsolidation.test.js
```

Le processus enfant définit NODE_ENV=test, WHATSAPP_ENABLED=false et WHATSAPP_WORKERS_ENABLED=false avant chargement. Les cas positifs emploient des configurations et secrets synthétiques, sans accès au compte Meta. Les serveurs de test HTTP écoutent uniquement en loopback, avec handlers métier mockés ; ils ne constituent pas un webhook exposé.

Résultat final : **302/302**, dont **36 nouveaux tests Meta** et les **266 tests isolés préexistants**. Aucun test PostgreSQL, tests/whatsapp.test.js, test global ou responsive n’a été exécuté. Les deux fichiers de tests existants modifiés ne changent aucune assertion : leurs fixtures doivent seulement déclarer l’activation explicite et un identifiant synthétique conforme au nouveau contrôle.

Nouveaux cas : callbacks non corrélés et routage des trois circuits ; distinction mutation/doublon/annulation/invalide ; HTTP 503 des lots mixtes ; erreurs observables sans données sensibles ; signatures et comptes invalides ; types inconnus ; limites de corrélation texte/modèle ; erreurs HTTP/Meta ; timeout avant réponse ou pendant son corps ; exception avec faux drapeaux de retry ; callbacks précoces/tardifs sans second envoi ; canal désactivé ; poller désactivé par défaut/en test ; cycle start/stop sur scheduler mock ; garde-fous d’accès aux drivers et au réseau fetch.

Les tests prouvent les contrats avec mocks et les protections HTTP locales, pas les propriétés concurrentes réelles de PostgreSQL ni le fonctionnement du compte Meta. Le journal complet est conservé dans output/meta-whatsapp-consolidation-isolated.log.

## 7. Vérification des restrictions et limites restantes

Empreintes avant/après des 375 fichiers src/tests/prisma et fichiers de configuration protégés préexistants : le schéma Prisma, les **44 migrations**, tous les modules et tests Gupshup, .env, package.json et package-lock.json sont inchangés. Aucun modèle Provider* supprimé ou modifié. Aucun Prisma generate, accès DB, GRANT/REVOKE, changement HBA, migration, installation, reset, appel API réel ou déploiement effectué.

Restent à traiter sous autorisation :

- **Inbox Meta durable** : réception authentifiée transactionnelle avant acquittement, identité/dedup versionnée, payload minimal protégé, états non corrélés, rétention et reprise. Un simple tableau en mémoire, fichier de payloads ou nouveau champ métier détourné ne répondrait pas au besoin ; aucun n’a été ajouté.
- Les modèles Provider* sont des déclarations non migrées et le repository phase 4A reste Gupshup/simulation. Leur adaptation éventuelle à Meta demande une conception et une autorisation de schéma distinctes ; ne pas les brancher par changement de nom de fournisseur.
- Confirmer les contrats réels des callbacks Meta, dont le retour de biz_opaque_callback_data, les abonnements et la version Graph supportée. Aucun résultat mock ne le confirme.
- Compléter un catalogue d’erreurs officiellement vérifié sans étendre les retries en cas d’acceptation ambiguë.
- L’ancien contrat de corrélation reste lié à la livraison, pas à un registre durable de toutes les tentatives ; ne pas promettre une association garantie d’un callback tardif ambigu.
- L’absence de persistance des événements inconnus, leurs nouvelles présentations et les alertes opérationnelles restent des conditions de fiabilité à résoudre avant une garantie de réception durable.

## 8. Conditions avant activation réelle

1. Approuver les corrections et la politique 503/événements inconnus ; décider explicitement du besoin d’inbox avant production.
2. Autoriser séparément toute conception/migration additionnelle et ses tests PostgreSQL dédiés, sans réinitialisation.
3. Valider le compte, les secrets, leur rotation, la version Graph, les modèles approuvés et l’abonnement webhook exacts dans une intervention autorisée.
4. Examiner les files existantes avant d’autoriser les workers : leur activation peut traiter immédiatement les éléments éligibles.
5. Autoriser un essai contrôlé de bout en bout avec destinataires de test, signature, doublons, statuts, STOP et transfert humain.
6. N’activer les workers et le canal qu’après accord explicite ; conserver Gupshup inactif jusqu’à une décision de retrait séparée.

**Point d’arrêt atteint : aucune migration, aucun test PostgreSQL, aucune configuration réelle et aucune activation ne sont engagés après ce rapport.**
