# NVA — Préparation de l’intégration Prisma/PostgreSQL de l’inbox Meta

Date : 16 octobre 2026. Références relues : `meta-whatsapp-durable-inbox-design.md` et `meta-whatsapp-durable-inbox-implementation.md`.

## 1. Résultat et périmètre

L’adaptateur transactionnel entrant NVA est préparé et testé sans base. Il réutilise le corps transactionnel du moteur existant pour écrire message entrant, conversation, consentements, annulations et réponses QUEUED avec le **même TransactionClient** que le marquage inbox. Il n’est raccordé à aucune route, aucun worker ni poller. Il ne possède aucun transport.

**355 tests isolés réussis, 0 échec**, dont 14 nouveaux. Ces résultats prouvent les contrats exercés sur mocks, pas les propriétés transactionnelles de PostgreSQL. Aucune connexion PostgreSQL, API fournisseur, migration, génération du client Prisma ou activation effectuée. Les quatre modèles restent des propositions documentaires ; `schema.prisma` reste inchangé.

Les réservations atomiques réelles, MVCC, contraintes différées, récupération après crash et coordination STOP/réseau sont encore à valider dans une phase expressément autorisée. L’inbox n’est pas déclarée prête pour production.

## 2. Architecture de persistance

```text
Réception future, actuellement NON raccordée
  signature sur octets bruts + compte/numéro autorisés + validation complète
  → normalisation minimale et chiffrement
  → repository.accept : transaction Serializable
      endpoint verrouillé → flux triés → receipt + événements + manifeste
  → commit confirmé → reçu durable ; futur ACK HTTP seulement ensuite

Traitement explicite, actuellement uniquement exercé sur mock
  repository.claim → bail token/génération
  repository.process : transaction Serializable
    contrôle endpoint/bail/flux
    dispatcher(tx,event,payload,heureDB)
      STATUS → politique CAS existante avec delegates tx
      INBOUND → adaptateur lié à endpointId → moteur NVA avec même tx
    nouveau contrôle du fence et de l’heure DB → marquage inbox
  → commit effet + marquage ensemble

Envoi sortant : chemin séparé ; jamais appelé par cet adaptateur.
```

Le repository sérialise aujourd’hui **toutes** les opérations d’un endpoint par `FOR UPDATE`, puis prend les verrous advisory transactionnels de flux. Cela inclut le claim, le traitement et la purge ; ce n’est pas une implémentation optimisée `SKIP LOCKED`. Cet ordre conservateur simplifie l’exclusion et la recherche entre versions de clés mais limite le débit. Le supprimer exige une autre preuve et des tests multi-processus.

Les requêtes SQL brutes restent paramétrées. Horloge DB via `clock_timestamp()` pour baux/fences, isolation Serializable, timeout de transaction 5 s. Trois tentatives maximum de l’unité transactionnelle sur P2034/P2002, uniquement lorsque les effets sont SQL et rejouables. Aucun appel réseau dans cette unité. Le mock ne parse ni n’exécute ces requêtes.

## 3. Quatre modèles et contraintes proposés

Le bloc Prisma complet du rapport d’implémentation reste la référence des colonnes. Aucune cinquième table n’est nécessaire à cette préparation. Types : UUID pour identités internes, chaînes exactes pour IDs Meta, `Bytes` pour empreintes/ciphertexts, `BigInt` pour séquence et générations, `Timestamptz(3)` pour instants techniques. Aucun secret dans les tables.

| Modèle/table | Colonnes et rôle | Contraintes et relations |
|---|---|---|
| `MetaWebhookEndpoint` / `meta_webhook_endpoints` | UUID ; environment/applicationKey ; metaAppId/wabaId/phoneNumberId ; flags false par défaut ; versions d’identité, normalisation, lookup et flux ; createdAt/disabledAt. | PK id ; uniques `(environment,applicationKey)` et `(environment,metaAppId,wabaId,phoneNumberId)` ; identité du compte immuable après réception ; versions/format/environnement contrôlés. |
| `MetaWebhookReceipt` / `meta_webhook_receipts` | UUID/endpoint ; receivedAt/storedAt ; digest de requête et versions lookup/authentification ; octets ; compteurs item/new/duplicate/conflict ; expiresAt. | FK endpoint RESTRICT ; unique `(endpointId,id)` nécessaire aux FK composites ; CHECK compteurs ≥ 0, somme égale à itemCount ; manifeste complet au commit. Le digest de requête n’est pas unique et ne déduplique pas les effets. |
| `MetaWebhookEvent` / `meta_webhook_events` | UUID/endpoint ; enqueueOrder BigInt ; kind/ID/statut/temps Meta ; identityKey/contentDigest/correlationKeyHash/streamKey et versions ; payload chiffré ; premières/dernières dates ; state/outcome/reason ; compteurs/reprise ; bail/token/owner/génération ; résultats/cible indicative/conflits ; échéances et purge. | FK endpoint RESTRICT ; unique enqueueOrder ; unique `(endpointId,id)` ; unique `(endpointId,identityVersion,lookupKeyVersion,identityKey)` ; pas d’unique sur nativeMessageId seul ; targetKind/targetId sans FK polymorphe métier, cible à revérifier. |
| `MetaWebhookReceiptItem` / `meta_webhook_receipt_items` | UUID/endpoint/receipt/event ; positions entry/change/item et collection ; disposition ; observedContentDigest ; variante chiffrée/version ; createdAt/expiresAt/conflictPayloadExpiresAt/payloadPurgedAt. | FK composites `(endpointId,receiptId)` et `(endpointId,eventId)` vers les uniques parents, RESTRICT ; unique `(endpointId,receiptId,entryIndex,changeIndex,collection,itemIndex)` ; aucune association inter-endpoint. |

### Index à conserver et à compléter en SQL après autorisation

| Usage | Index proposé |
|---|---|
| Receipts et purge | `(endpointId,storedAt,id)` ; `(expiresAt,id)`. |
| File éligible | Index Prisma général `(endpointId,state,nextAttemptAt,enqueueOrder)` ; comparer par EXPLAIN avec un index partiel `(endpointId,nextAttemptAt,enqueueOrder,id)` pour READY/RETRY_WAIT/UNCORRELATED. |
| Baux | `(endpointId,state,leaseExpiresAt)` ; index partiel `(endpointId,leaseExpiresAt,id)` pour PROCESSING si utile. |
| Ordre et barrière | `(endpointId,streamKey,enqueueOrder)` ; id peut être ajouté pour une pagination stable ; enqueueOrder est déjà unique. |
| Corrélation | `(endpointId,nativeMessageId,state)` et `(endpointId,correlationKeyHash,state)` ; variantes partielles UNCORRELATED à mesurer, sans multiplier les index sans justification. |
| Exploitation/rétention | `(endpointId,state,firstReceivedAt,id)`, `(payloadExpiresAt,id)`, `(tombstoneExpiresAt,id)`. |
| Manifeste | `(endpointId,eventId,createdAt)` ; `(expiresAt,id)`. |

Les index généraux et partiels ne sont pas tous nécessaires simultanément : retenir la sélection mesurée dans la future migration. Vérifier les bornes UTF-8 et tailles d’index avec les identifiants maximums. Les HMAC de 32 octets évitent un index unique sur du texte arbitraire.

### CHECK, triggers et invariants à traduire explicitement

- États, kinds, dispositions, collections et outcomes sur listes fermées ; compteurs/positions ≥ 0, versions positives, HMAC exactement 32 octets. Receipt : requestBytes entre 1 et 1 MiB et itemCount final entre 1 et 512.
- Bail entièrement renseigné **si et seulement si** PROCESSING, génération positive en PROCESSING, owner borné ; après résultat/retry/purge, token/owner/expiration nuls. Génération jamais diminuée par les chemins autorisés.
- Cohérence des dates et résultats : PROCESSED/IGNORED avec processedAt ; FAILED avec failedAt ; EXPIRED avec purge explicite ; ne pas interdire un failedAt historique conservé après une reprise. Horloges de réception applicatives et DB distinctes : ne pas imposer naïvement storedAt ≥ receivedAt sans politique de dérive.
- Payload et version d’encryption présents ensemble pour les états rejouables ; après purge, ciphertext et version nuls avec payloadPurgedAt renseigné. La version du contenu d’origine n’est pas un secret. TombstoneExpiresAt ≥ payloadExpiresAt.
- STATUS exige ID/statut ; INBOUND exige ID et flux exploitables pour le contrat connu. Cohérence streamKey/streamKeyVersion et targetKind/targetId. Un repère de cible n’autorise aucune mutation.
- Variante CONFLICT : soit ciphertext + version + échéance présents et pas encore purgés, soit purge datée et ciphertext/version nuls. Interdire ciphertext sur une occurrence ordinaire. Permettre les champs d’expiration/audit conservés après purge.
- FK composites contre les manifestes inter-endpoint. Une FK ne filtre pas un SELECT : le repository garde le scope dans toutes ses requêtes. RLS non supposée active.
- Un trigger d’immutabilité devra protéger le compte/environnement/application d’un endpoint déjà utilisé et les identités d’événements. Le repository revalide une configuration capturée mais cela ne suffit pas contre un UPDATE SQL direct réétiquetant l’historique.
- Prévoir un index unique partiel limitant à un endpoint métier actif globalement dans cette première architecture mono-périmètre ; sa définition exacte doit inclure la convention disabledAt/flags approuvée et les cas de rotation. Les uniques par environnement seuls permettraient test et production dans la même base métier, ce qui est interdit pour l’activation initiale.

**Manifeste : ajustement applicatif effectué.** À l’insertion de la receipt, tous les compteurs, dont itemCount, valent zéro ; après insertion et comptage des items, une seule mise à jour fixe les valeurs finales. Le CHECK immédiat `new+duplicate+conflict=itemCount` peut ainsi rester vrai à chaque instruction. Le minimum itemCount > 0 doit être vérifié **au commit**, pas par un CHECK immédiat qui rejetterait l’insertion préparatoire. Les bornes immédiates restent 0..512.

Un CHECK ne peut pas compter les enfants. La future contrainte de complétude doit être un **constraint trigger DEFERRABLE INITIALLY DEFERRED**, sur modifications pertinentes de receipt/items, qui relit les valeurs finales : nombre et dispositions des items, somme des compteurs et minimum final. Elle doit aussi imposer qu’un événement nouvellement créé ait son occurrence NEW au commit initial, sans interdire la purge ultérieure de son manifeste après rétention. Ce dernier invariant exige une distinction insertion/purge et une revue SQL, pas une contrainte qui exige éternellement un parent receipt vivant. Les changements concurrents du même manifeste doivent prendre le verrou du parent ; le trigger de validation ne remplace pas ce protocole.

La purge des items exige de revoir cette contrainte : tant que la receipt subsiste, supprimer une partie de son manifeste rendrait ses totaux historiques incohérents. Plan conservateur : purger **la receipt et tous ses items éligibles ensemble**, sous verrous, lorsque plus aucune occurrence protégée ne la retient ; conserver les événements/tombstones indépendants. Le trigger différé doit accepter un parent effectivement supprimé dans la même transaction. La suppression de métadonnées n’est pas encore implémentée.

## 4. Adaptateur transactionnel préparé

Fichier : `src/services/metaInboxPrismaAdapter.js`.

```js
// Composition future, non présente dans les routes/jobs actuels :
const inboundTransaction = createMetaInboxPrismaAdapter({
  endpointId: configuredEndpointId,
  conversationService: auditedConversationService,
});
const effect = createMetaInboxDispatcher({ inboundTransaction });
// repository.process(lease, effect) uniquement après migrations/tests/autorisation.
```

Contrat : `inboundTransaction(tx, message, {endpointId, firstReceivedAt, processedAt})`. Le scope doit correspondre à l’endpoint capturé et les dates doivent être finies, avec traitement non antérieur à la réception. L’adaptateur refuse le client racine doté de `$transaction`. Ce contrôle de forme n’est pas une authentification de transaction : le callable est interne et ne doit pas être exposé à HTTP. L’intégrité de l’événement provient de l’acceptation authentifiée et du repository, pas d’un objet context fourni par un utilisateur.

`whatsappConversationService` partage maintenant son corps SQL entre :

1. Le wrapper historique `processInboundMessage(message)`, qui conserve sa transaction Serializable, ses retries et son comportement synchrone.
2. `processInboundMessageInTransaction(tx,message,context)`, qui utilise exclusivement le tx reçu, n’ouvre ni ne commit de transaction et n’intercepte pas P2002/P2034.

L’adaptateur doit laisser une erreur SQL sortir : PostgreSQL peut avoir déjà invalidé la transaction. Il ne recherche donc pas un doublon après P2002 dans cette même transaction. L’unité inbox entière doit rollback puis éventuellement recommencer. Après épuisement des retries de stockage, le repository prévoit une transaction technique distincte RETRY_WAIT/FAILED ; aucun succès métier n’est inventé.

Un ID natif déjà présent n’est ignoré qu’après vérification de la direction INBOUND, de la conversation/expéditeur et du texte normalisé. Une contradiction provoque `META_INBOX_NATIVE_IDENTIFIER_CONFLICT`, pas une association par proximité. Ce contrôle n’est pas une comparaison exhaustive de tous les attributs historiques : la preuve complète du contenu reste celle de l’identité/projection inbox. Il ne rend pas les tables métier globales multi-WABA. Une collision persistante finira en revue après retries bornés ; une classification permanente plus directe reste à envisager.

Le dispatcher transmet désormais endpointId. Il continue à rassembler les cibles de statut dans les trois circuits et à appeler la politique CAS avec les delegates du tx. UNCORRELATED reste distinct d’applied ; ambiguïté ou contradiction ne permet aucune mutation. Aucun wake ou traitement de callback ne lance un sender.

### Horloges, consentement et services appelés

- firstReceivedAt conserve la première réception durable, même après replay ; elle ancre receivedAt, les décisions temporelles du moteur et le consentedAt de planification 24/72 h.
- processedAt représente le début effectif du traitement fourni par l’inbox et alimente processingStartedAt/processedAt du message. Le contrôle du bail relit séparément l’heure DB à la fin ; le processedAt métier n’est pas une preuve de date de commit ni de durée de traitement.
- Le timestamp Meta ne remplace jamais une date manquante ; sa validité figée à réception est transmise par le dispatcher. Un timestamp futur à réception ne devient pas utilisable parce que le worker a attendu.
- Le catalogue et l’inscription lisent via le tx existant ; leurs critères de disponibilité emploient encore leur heure actuelle. Le backlog ne recrée pas un ancien état de catalogue. Les annulations des follow-ups et préférences gardent leurs propres dates de traitement. Aucune horloge unique artificielle n’est appliquée à tout le système.
- Le test différé confirme la planification originale 24/72 h depuis réception, même si l’échéance est passée au traitement ; **cela n’autorise pas l’envoi**. Fenêtre de service, consentement courant, contrôle humain, validité du modèle et backoff doivent toujours être revérifiés par le circuit sortant.

Les factories permettent des dépendances injectées ; seules des dépendances SQL utilisant le tx sont admissibles dans cette unité retryable. Les services catalogue/inscription, schedule/cancel des follow-ups et préférence opt-out actuels acceptent ce tx. Ne pas injecter de transport ou de fonction à effet externe. Une future évolution de ces dépendances impose une nouvelle revue.

## 5. STOP et concurrence : garanties et limites

### Courses à considérer

| Ordre observé | Résultat nécessaire et limite |
|---|---|
| STOP authentifié mais transaction d’acceptation non committée | Aucun acquis durable ne peut être annoncé. Un autre nœud peut avoir déjà franchi sa frontière d’envoi ; la seule réception d’octets ne donne pas un ordre global. |
| STOP durable avant la frontière logique de dispatch | Bloquer toute relance/notification pertinente sans consommer de tentative, tant qu’un entrant bloquant reste ouvert. Cela exige une coordination partagée avec tous les senders, pas une simple lecture. |
| STOP durable, traitement en attente/retry/échec/expiration | Barrière fermée ; ne pas dépasser un entrant antérieur du flux. Un flux inconnu de contrôle doit bloquer le périmètre. La purge ne vaut pas autorisation. |
| STOP appliqué dans l’unité de travail | Conversation OPTED_OUT, révocation, préférence et annulations admissibles atomiques avec le marquage inbox. Après commit, les autorisations métier restent obligatoires même si la barrière technique s’ouvre. |
| Réservation sortante avant STOP, HTTP pas encore commencé | Une réservation seule ne donne aucun droit irrévocable d’envoyer. Relecture et exclusion jusqu’à la frontière réseau nécessaires ; un report technique ne doit pas être compté comme une tentative. |
| HTTP déjà engagé puis STOP | Impossible de rappeler les octets soumis. STOP bloque les opérations suivantes ; le résultat du premier envoi peut être incertain. Pas de second POST automatique. |
| Crash après effet avant marquage ou après marquage avant commit | La transaction commune doit tout annuler ou tout committer. À prouver réellement en interrompant des connexions/processus. |
| Ancien worker reprend après expiration/reprise du bail | Fence token/génération et heure courante empêchent sa validation. Un callback d’effet hors du tx contournerait cette garantie et est interdit. |

### Coordination proposée, non implémentée

Maintenir le refus de dispatch réel dans ce socle. `inspectBarrier` reste une observation avec `dispatchAuthorized:false` ; aucun permis stocké/exporté ne doit être utilisé plus tard pour un fetch.

Avant bascule asynchrone, préparer un coordinateur qui détient une porte advisory de **session sur une connexion physique dédiée**, de la dernière vérification jusqu’à la soumission contrôlée et l’enregistrement sûr de son résultat. Les transactions SQL restent courtes. Prisma utilise un pool : des `$queryRaw` séparés sur un client racine ne garantissent pas la même session et ne conviennent pas pour ce verrou. Un pooler transactionnel est incompatible avec cette exigence sans autre architecture.

Hiérarchie conservatrice proposée : porte de périmètre d’abord, endpoint ensuite, flux triés, lignes événement/métier en ordre stable. L’ingestion prend la même porte **transactionnelle avant Endpoint FOR UPDATE** ; le sender la prend en session avant ses transactions. Ainsi, pas de sender tenant un flux qui attend un endpoint détenu par une ingestion attendant ce flux. Une porte globale par endpoint réduit le débit mais permet d’inclure les contrôles dont le flux n’est pas déterminable. Formaliser la clé advisory et les domaines pour ne pas confondre porte et verrou de flux.

Sous la porte : relire entrants persistés bloquants, état courant du consentement/STOP/contrôle humain/fenêtre, puis effectuer la réservation métier existante et une seule soumission contrôlée. Pas de retry automatique de cette section réseau. Ne pas maintenir une transaction Prisma 5 s pendant un HTTP potentiellement lent ; la connexion dédiée porte le verrou entre les transactions.

**Limite irréductible :** la frontière doit être définie comme l’engagement exclusif local de dispatch, pas comme l’arrivée physique Meta. Un STOP attendant la porte pendant un envoi n’est pas encore accepté durablement ; l’ACK ne doit pas précéder le commit. La perte de connexion de verrou ne prouve pas qu’un HTTP est annulé : interrompre conservativement, classer l’acceptation incertaine et empêcher une nouvelle soumission. Un verrou DB ne fence pas le fournisseur. La fenêtre de coupure session/réseau et la libération sûre doivent être testées/revues ; aucune garantie absolue n’est revendiquée ici.

Tous les circuits doivent participer, y compris notifications (`whatsappDeliveryService`), conversations (`whatsappConversationDeliveryService`), relances (`whatsappProspectFollowUpService`), déclenchements manuels et tout accès direct à `whatsappCloudApiService`. Les mutations concurrentes de préférences, consentements et contrôle humain doivent respecter le protocole ou être sérialisées de façon équivalente. Les workers/pollers restent indépendamment désactivés sans opt-in.

**Les mocks sérialisent artificiellement les transactions. Ils ne prouvent ni MVCC, ni locks advisory, ni absence de deadlock, ni exclusion réseau.** Les tests STOP ajoutés prouvent l’emploi du moteur réel et son rollback commun dans le contrat de mock. L’activation reste bloquée sur la coordination réelle.

## 6. Déduplication, reprise, confidentialité et rétention

Identité native versionnée : entrant par ID ; statut par ID/statut/temps ; erreur technique selon projection minimale. Toutes les versions lookup requises sont recherchées sous verrou avant création. Une contrainte incluant lookupKeyVersion ne suffit pas seule à dédupliquer entre versions. Conserver les clés historiques tant que tombstones/événements en dépendent ; streamKey distinct, rotation interdite pendant les flux ouverts sans procédure de drainage/rekey.

Réponse d’acceptation perdue : une nouvelle receipt décrit la retransmission, l’événement identique n’est pas réappliqué. Contenu contradictoire : original inchangé, variante chiffrée et revue ; les événements ouverts sont gelés et leur bail invalidé. La séquence enqueueOrder peut avoir des trous ; l’ordre garanti est celui de l’acceptation sérialisée, pas l’ordre Meta universel.

Baux : token aléatoire, génération croissante, expiration DB ; reprise par claim. Contrôle au début et à la fin de l’effet. Pas de renouvellement de long traitement, scheduler ou worker ajouté ici. Les erreurs techniques ont un retry distinct des tentatives métier ; plafonnement à dix échecs consécutifs. UNCORRELATED : réveil exact + balayage durable indispensable, actuellement délai simple 30 s ; calendrier gradué/jitter/supervision du design à compléter.

Callbacks précoces sans cible : conserver UNCORRELATED ; après écriture du providerMessageId, wake exact facultatif accélérateur et balayage obligatoire. Réponse HTTP perdue sans identifiant commun vérifiable : aucune corrélation garantie, aucun rapprochement par numéro ou heure, aucun nouvel envoi automatique. Statuts tardifs/READ/CANCELLED restent soumis à la politique monotone existante.

AES-256-GCM et AAD lient le ciphertext à son endpoint/objet/digest/version. Le nouvel adaptateur ne journalise aucun contenu, numéro, token ou erreur SQL ; les messages d’erreur sont techniques. Payload minimal ; identifiants natifs et HMAC restent pseudonymes sensibles, pas anonymes. Secret manager, sauvegardes, rotation, droits opérateur et absence de logs Prisma contenant les paramètres restent des prérequis d’exploitation.

Rétention proposée conservée : contenus traités/ignorés 24 h, ouverts/variantes 30 jours, receipts ordinaires 7 jours, tombstones et métadonnées de conflit 90 jours minimum proposés. Expiration d’un entrant non résolu reste bloquante. Purge du ciphertext implémentée par lots ; suppression des métadonnées/parents encore à concevoir avec les contraintes de manifeste ci-dessus. Un vieux replay après suppression du tombstone n’est pas garanti sans effet ; définir une politique de revue et de restauration en quarantaine avant activation. Aucun job de rétention démarré.

## 7. Compatibilité et plan de migration — aucune exécution

### Inventaire local

44 fichiers `prisma/migrations/*/migration.sql` présents. Les migrations WhatsApp pertinentes comprennent `20260726060000_add_whatsapp_delivery`, `20261009140000_add_whatsapp_conversations` et `20261009150000_add_whatsapp_prospect_follow_ups`, plus les évolutions utilisateurs et suivi de livraison. Les clés métier sont des Int/SERIAL, les providerMessageId/idempotencyKey/deduplicationKey sont globalement uniques par table, les FK conversation/consent existantes gardent leurs cascades. La nouvelle inbox n’introduit aucune FK vers ces tables : pas de modification de leurs cascades/nettoyages. Les nouvelles dates TIMESTAMPTZ(3) et les anciennes TIMESTAMP(3) nécessitent un contrat UTC explicite et des tests Prisma de round-trip, sans ALTER des anciennes colonnes.

Cet inventaire **ne confirme pas l’état appliqué d’une base** ; aucun accès à `_prisma_migrations` effectué. Les « 44 migrations réussies » restent le contexte historique fourni, à revérifier lors d’une future intervention autorisée.

Schéma source : 75 modèles, aucun MetaWebhook*. Six modèles Provider* existent dans schema.prisma mais aucune instruction CREATE TABLE correspondante dans les 44 migrations examinées : ProviderApplication, ProviderDelivery, ProviderSendAttempt, ProviderMessageAlias, ProviderWebhookEvent, ProviderReconciliationAudit. Leur présence ne prouve pas des tables réellement existantes. **Risque majeur : une génération automatique de migration depuis l’ensemble du schéma peut embarquer ces six tables Gupshup.** Elles sont conservées ; leur divergence doit être examinée séparément, jamais résolue par suppression/reset ou application implicite.

### Séquence proposée après autorisations distinctes

1. Approuver les quatre modèles, CHECK/trigger différé, purge de manifeste, mono-périmètre, horloges et protocole STOP. Examiner explicitement la divergence Provider* sans la modifier automatiquement.
2. Autoriser la modification contrôlée de schema.prisma et la préparation d’une migration **additive limitée aux quatre tables Meta**, séquence enqueueOrder, uniques/FK/index/CHECK/triggers. Revue SQL : aucune table Provider*, ALTER métier, DROP, reset ou changement des 44 migrations antérieures. Ne pas lancer `migrate dev`/`db push` pour « résoudre » une divergence.
3. Vérifier hors base la traduction Prisma et le client local sous cette autorisation. Examiner la stratégie Prisma de représentation des contraintes SQL et de non-régénération ultérieure de contraintes indésirables ; ne pas marquer artificiellement une migration appliquée.
4. Autoriser séparément une cible PostgreSQL dédiée, contrôler version/host/port/base/rôle/data_directory/empreintes et historique. Pas de port 5432 ni production. Préparer une restauration/reprise sûre, sans commande de reset.
5. Appliquer uniquement la migration approuvée, examiner les catalogues/contraintes/index/séquence ; attribuer séparément les permissions minimales autorisées. Rien de cette étape n’est exécuté ici.
6. Exécuter les nouveaux tests PostgreSQL autorisés, puis éventuellement les 14 scénarios historiques sur autorisation explicite avec nettoyage ciblé adapté aux tables techniques.
7. Valider le coordinateur STOP sur connexions physiques et tous les senders. Ensuite seulement envisager un raccordement unique du webhook, commit avant ACK, flags séparés false par défaut, entrants initialement seuls et senders arrêtés.
8. Autoriser séparément configuration réelle et essais Meta. Repli : arrêter les traitements/envois, conserver les événements acceptés et réconcilier sous contrôle ; aucune suppression de tables remplies ni replay aveugle d’envois incertains.

Permissions futures, à justifier par parcours et rôles séparés : ingestion SELECT/INSERT/UPDATE des tables techniques nécessaires à acceptation/dédup ; worker SELECT/UPDATE inbox et droits métier déjà requis ; purge DELETE ciblé avec contraintes/ordre des parents ; USAGE de la nouvelle séquence enqueueOrder. Pas de droits globaux, CREATE, TEMPORARY, GRANT OPTION ni privilèges administratifs. Le tx entrant ne transforme pas un ancien runner aux sept tables en worker doté automatiquement de tous les droits : prévoir un nouvel audit complet de ses lectures/écritures. Aucun GRANT/REVOKE effectué.

## 8. Tests exécutés et validations encore nécessaires

### Isolés exécutés

Inspection des scripts npm, des imports et des dépendances retenues avant exécution. Sélection : les douze fichiers du script `test:whatsapp:isolated`, puis `whatsappFixtureClock`, `gupshupPhase2`, `gupshupDurableStore`, `metaWhatsAppConsolidation`, `metaInbox` et le nouveau `metaInboxPrismaAdapter` (tous sous `tests/*.test.js`).

Commande effective : `node --require ./tests/helpers/whatsappIsolationGuard.cjs --test <les 18 fichiers explicitement sélectionnés>`. La liste intégrale des fichiers de base est celle du rapport d’implémentation, complétée de `tests/metaInboxPrismaAdapter.test.js`.

Le preload refuse le singleton Prisma, la construction d’un client réel, le pilote pg et fetch ; processus enfant avec NODE_ENV=test, WHATSAPP_ENABLED=false et WHATSAPP_WORKERS_ENABLED=false. Les tests HTTP existants utilisent uniquement leurs handlers locaux mockés. Aucun `npm test`, tests/whatsapp.test.js, suite PostgreSQL ou script global exécuté. Aucun import du nouvel adaptateur dans routes/jobs/app.

Résultat ciblé initial : **14/14**, 145,3536 ms. Passage final complet : **355 tests, 355 réussis, 0 échec, 0 ignoré**, **1072,001 ms**. Journal : `output/meta-whatsapp-prisma-integration-isolated.log`.

Les 14 nouveaux cas couvrent : configuration et endpoint étrangers ; refus client racine/dates invalides ; STOP via vrai moteur, annulation des réponses et relances, retrait de préférence dans tx ; rollback après effet et reprise ; consentement différé et échéances du vrai service 24/72 h ; timestamps manquant et futur ; doublon sans second effet ; conflits de texte/expéditeur ; remontée P2002/P2034 sans retry imbriqué ; contrôle humain préservé ; compteurs de receipt compatibles avec le CHECK immédiat proposé. Le helper de mock n’expose plus `$transaction` au tx, comme un Prisma TransactionClient.

### PostgreSQL : tests à créer/exécuter seulement après autorisation

| Domaine | Preuve requise |
|---|---|
| Schéma et client | Quatre delegates, noms/mappings/types exacts, bytea/BigInt/UUID/timestamptz, client tx réel sans `$transaction`, SQL brut paramétré accepté. |
| Contraintes | Uniques natives/versionnées, FK inter-endpoint refusées, CHECK à chaque instruction, trigger différé refusant manifeste incomplet et acceptant la purge transactionnelle cohérente ; immutabilité endpoint ; index partiel mono-périmètre. |
| Atomicité | Panne au milieu du lot, avant/après commit ; crash entre écritures métier et marquage ; ACK jamais émis avant commit ; absence de lignes partielles. |
| Concurrence | Plusieurs connexions/processus, doublons et conflits inter-version, nouvelle conversation concurrente, P2002/P2034 réels et retry de l’unité complète ; aucune lecture après erreur dans tx aborté. |
| Baux/fences | Bail expiré, worker ancien après reprise, expiration pendant effet, horloge DB après attente d’un verrou, rollback des effets si fence invalide, crash/restart sans cache. |
| Ordre et débit | Deux entrants distincts même flux, flux antérieur en retry/échec, lots multi-flux, verrous triés, absence de deadlock, timeout et contention du verrou d’endpoint ; EXPLAIN/volumétrie. |
| STOP et contrôle humain | Tous les ordres de réception/commit/reservation/HTTP ; gate pris avant endpoint ; session physique dédiée, perte de session, transport lent/incertain, mutations administratives ; aucun permis transférable ni nouvelle tentative après ambiguïté. |
| Callbacks | Précoce/tardif/redémarrage, wake perdu puis balayage, absence de preuve commune, candidats multiples, ancienne tentative, cible supprimée, maintien de READ/CANCELLED et aucun second POST. |
| Horloges | Retour UTC, frontière fenêtre24h, demande de consentement valide/expirée à réception, backlog, timestamp initialement futur, état humain actuel, dates 24/72h sans délai artificiel. |
| Rétention/sécurité | Purge du ciphertext et métadonnées dépendantes, contrainte différée en purge, clés historiques/restauration, tombstones, ancien replay, rôles/PUBLIC/absence de droits supplémentaires et de fuite de paramètres. |

Les tests existants sur mocks restent une non-régression utile ; ils ne remplacent aucun élément de cette matrice.

## 9. Fichiers et contrôle de non-modification

| Fichier | Action |
|---|---|
| `src/services/metaInboxPrismaAdapter.js` | Créé : composition explicite, scope/date, tx externe, aucune activation. |
| `src/services/whatsappConversationService.js` | Modifié : extraction du corps transactionnel partagé, méthode externe dédiée et distinction des horloges ; wrapper historique conservé. |
| `src/services/metaInboxDispatcher.js` | Modifié : endpointId transmis au contrat entrant. |
| `src/repositories/metaInboxRepository.js` | Modifié : itemCount préparatoire à zéro pour le CHECK immédiat de somme. |
| `tests/helpers/metaInboxMock.js` | Modifié : delegates nécessaires au moteur, update/upsert et tx sans méthode `$transaction`. Reste un backend contractuel sans sémantique PostgreSQL. |
| `tests/metaInboxPrismaAdapter.test.js` | Créé : 14 scénarios isolés supplémentaires ; aucune assertion existante changée. |
| `output/meta-whatsapp-prisma-integration-isolated.log` | Créé : résultat du passage final isolé. |
| `docs/meta-whatsapp-prisma-integration-plan.md` | Créé : présent rapport. |

Comparaison SHA-256 des **384 fichiers préexistants protégés** relevés au début : seuls les quatre fichiers modifiés ci-dessus diffèrent ; les 380 autres sont inchangés, dont schema.prisma, les 44 migrations, `.env`, package.json/package-lock.json et les composants Gupshup. Aucun client généré ou dépendance modifié par une commande de cette intervention. Git n’est pas disponible dans le shell ; vérification effectuée par empreintes, sans nettoyage ni écrasement d’autres changements.

Empreinte SHA-256 de schema.prisma :

```text
a7051df24bca10ec6eb338da5a39370c96c2c3469ce5132d6f182d345f8f826a
```

Empreinte du manifeste des 44 migrations :

```text
fb28b862e78fc0c0b77ca483ff3dfa42b85d38c52dcfab77fef79f9081f7d967
```

Calcul reproductible : chemins relatifs `prisma/migrations/<nom>/migration.sql` triés lexicographiquement ; pour chacun, ligne `chemin + espace + sha256(octets) + LF` ; SHA-256 UTF-8 de la concaténation. Aucun secret inclus.

## 10. Risques résiduels et conditions avant activation

1. **Bloquant — STOP/réseau :** coordinateur de session physique absent et non validé ; aucun passage aux entrants asynchrones avec senders actifs.
2. **Bloquant — PostgreSQL non exercé :** contraintes, SQL, rollback, retries/fences, isolation et contention non prouvés par les 355 tests.
3. **Bloquant — migration :** divergence des six Provider* à isoler, modèle/SQL Meta à approuver ; trigger de manifeste compatible avec création et purge à concevoir/tester. Aucune migration générale automatique.
4. **Périmètre :** tables métier globales, activation initiale mono-compte seulement ; borne dans l’adaptateur ≠ isolation multi-tenant complète.
5. **Exploitation :** jitter/balayage, purge finale, revue des échecs permanents, supervision de lag, quotas et procédures de restauration/clés encore à finaliser. Les barrières en échec ne doivent pas être levées automatiquement pour reprendre le trafic.
6. **Réseau :** ni exactement-une-fois, ni rappel rétroactif, ni corrélation sans clé commune ne sont promis. L’inbox ne doit jamais réparer une ambiguïté par réémission.

Point d’arrêt : adaptateur préparé, tests isolés terminés, rapport produit. **Autorisation distincte nécessaire avant modification de schema.prisma, création/application de migration, accès ou tests PostgreSQL, raccordement, configuration réelle ou activation.** Aucun composant Gupshup supprimé.
