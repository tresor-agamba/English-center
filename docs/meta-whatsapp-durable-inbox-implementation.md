# NVA — Implémentation contrôlée de l’inbox Meta

Date : 16 octobre 2026. Référence : docs/meta-whatsapp-durable-inbox-design.md.

## 1. Résultat et périmètre réel

Le socle applicatif de l’inbox est développé : authentification d’octets bruts, normalisation minimale, chiffrement, repository Prisma injecté, acceptation de lot transactionnelle, déduplication inter-version, callbacks non corrélés, baux/fencing, traitement transactionnel, barrière des entrants en attente et expiration des payloads.

**Ce socle n’est pas une inbox PostgreSQL opérationnelle aujourd’hui.** Les quatre modèles ne sont pas déclarés dans schema.prisma, les tables n’existent pas par cette intervention et le client généré n’est pas modifié. Les opérations ont été exercées seulement contre un backend de test en mémoire. Aucun accès à une base, worker démarré, API appelée ou route/poller raccordé.

L’acceptation de haut niveau et le dispatch simulé exigent mode=isolated, NODE_ENV=test et un scope environment=test. Le mode réel est refusé. Les méthodes du repository sont des primitives internes nécessitant une connexion explicitement injectée ; elles ne sont pas une entrée HTTP et ne doivent jamais être exposées directement à un appelant non authentifié.

## 2. Fichiers créés et modifiés

| Fichier créé | Rôle |
|---|---|
| src/services/metaInboxProtocol.js | Contrat de normalisation, projection minimale, identité canonique, HMAC versionnés, streamKey et chiffrement AES-256-GCM. |
| src/services/metaInboxService.js | Authentification HMAC des octets copiés, validation complète du compte/lot, puis acceptation ; aucune activation réelle. |
| src/repositories/metaInboxRepository.js | Unité transactionnelle Serializable, verrous, manifeste, événements/variantes, claims, fences, résolution, réveil exact et expiration. |
| src/services/metaInboxDispatcher.js | Application de statuts via la politique existante sur le client transactionnel ; interface d’effet entrant injectée et refus conservateur sans adaptateur. |
| tests/helpers/metaInboxMock.js | Backend de contrat : transactions sérialisées, rollback, horloge contrôlée, pannes de création/commit. |
| tests/metaInbox.test.js | 39 nouveaux tests sans base. |
| output/meta-whatsapp-durable-inbox-isolated.log | Journal de la sélection isolée finale. |
| docs/meta-whatsapp-durable-inbox-implementation.md | Présent rapport et propositions de schéma/migration. |

**Aucun fichier préexistant modifié.** En particulier : aucun changement des services métier, du webhook réel, des workers existants, de leurs assertions, des composants Gupshup, du design de référence, de schema.prisma, des 44 migrations, de .env ou des dépendances.

## 3. Fonctionnalités implémentées

### Acceptation et isolation

- Signature Meta HMAC-SHA256 vérifiée en temps constant sur une copie des octets reçus, avant parsing utile ou stockage.
- WABA et Phone Number ID doivent correspondre au scope capturé ; le scope du service doit aussi correspondre à celui du repository.
- Le repository vérifie endpoint, environnement, applicationKey, Meta App ID, compte, numéro, versions et état désactivé sous verrou.
- Limites : 1 MiB par corps, 512 éléments par lot, identifiants et clés bornés sans troncature. Un élément invalide fait refuser tout le lot avant stockage.
- Aucun singleton Prisma, dotenv, fetch, transport Meta/Gupshup, timer ou logger de payload importé par les nouveaux composants. Le dispatcher importe uniquement la politique de livraison pure existante.

L’unité transactionnelle commence par SELECT de l’endpoint FOR UPDATE, puis contrôle sa configuration. La première implémentation sérialise **toutes les opérations d’un même endpoint**, y compris acceptation et effet. C’est plus conservateur que l’optimisation par flux du design ; cela simplifie la preuve d’ordre et limite le débit. Une optimisation exige de vrais tests de concurrence et ne doit pas supprimer le verrou sans remplacement correct.

### Lots atomiques et déduplication

Une transaction écrit receipt, événements nouveaux ou réutilisés et un receiptItem pour chaque occurrence. Les totaux du manifeste sont contrôlés avant commit. Le résultat accepted=true n’est retourné qu’après résolution de la transaction. Une panne au milieu du lot ou au commit ne retourne pas de reçu de succès et ne déclenche aucun fallback mémoire/fichier.

L’identité distingue un entrant par son ID Meta natif ; un statut par ID/statut/timestamp fournisseur ; une erreur sans identifiant par sa projection technique. Le hash d’un lot et les indices de tableaux ne servent pas à dédupliquer les effets. Tous les IDs Meta sont conservés exactement.

Une répétition identique incrémente receiptCount et conserve l’original, ses premières dates et sa rétention. Une contradiction crée une variante chiffrée dans le manifeste, gèle un événement ouvert pour revue et invalide son bail. Un effet déjà terminé n’est pas prétendument annulé : son résultat historique reste, avec hasConflict/reviewRequired.

Les versions de clés historiques sont recherchées sous le même verrou. Le digest de contenu est recalculé avec la version de l’événement retrouvé. Une clé historique manquante ou une version de flux changée alors que des entrants restent ouverts fait refuser l’opération ; aucune création d’une nouvelle identité pour contourner ce problème.

### Traitement et reprise

- READY à l’admission pour les contrats connus ; FAILED pour les événements bien formés non pris en charge. RECEIVED reste prévu dans la proposition de schéma, mais cette version normalise avant commit et ne nécessite pas une étape asynchrone séparée de promotion.
- Claim avec token/génération et expiration ; les baux abandonnés sont repris par claim, sans cache de processus.
- Ordre des entrants par streamKey/enqueueOrder ; un entrant antérieur ouvert, en erreur ou expiré bloque le dépassement. Pagination des candidats pour éviter qu’un long flux bloqué masque les autres.
- Relecture du bail après verrou de flux et contrôle de l’heure à la fin de l’effet. Un bail devenu périmé fait rollback des effets SQL et du marquage.
- Effet et résultat inbox dans la **même transaction injectée**. Aucun traitement métier indépendant n’est présenté comme fenced.
- Erreurs : rollback, RETRY_WAIT technique borné ; dix échecs consécutifs ou déchiffrement invalide conduisent à FAILED. Les délais techniques n’affectent pas retryDelay métier ni attempts des envois.

Les transactions de stockage/effet peuvent être reprises au maximum trois fois sur P2034/P2002, uniquement avec des effets transactionnels. Les callbacks représentant une soumission simulée ne sont jamais repris automatiquement. Le timeout de transaction est fixé à 5 secondes ; le bail vaut 30 secondes par défaut, paramétrable entre 1 et 60 secondes. Aucun renouvellement de long traitement, scheduler ou boucle de worker de production n’est ajouté.

### Callbacks et compatibilité métier

Le dispatcher rassemble les candidats des trois circuits, par ID natif et clé explicite. Aucun candidat → UNCORRELATED ; plusieurs candidats ou identifiants contradictoires → FAILED ; une cible certaine → politique existante applyDeliveryStatus avec le modèle du tx, detailed=true. Les statuts CANCELLED/READ et les transitions CAS gardent leurs protections. Aucun rapprochement par numéro ou heure.

wake recherche seulement des identifiants exacts et replannifie les événements encore conservés. Le claim reprend aussi les UNCORRELATED à échéance, assurant un balayage sans dépendre d’un signal en mémoire. Cette version utilise une échéance simple de 30 secondes ; le calendrier gradué et le jitter proposés dans le design restent à compléter avant production.

Pour les entrants, le service NVA existant n’est **pas** appelé depuis une transaction externe qui provoquerait une transaction imbriquée. Le nouveau dispatcher attend un inboundTransaction(tx,message,context) audité. Sans cet adaptateur, il termine FAILED/TRANSACTION_ADAPTER_REQUIRED et laisse la barrière fermée. Les tests injectent uniquement des effets en mémoire. L’extraction du corps transactionnel NVA, avec ses clocks de réception/traitement et les échéances de consentement, reste une étape séparée avant activation.

La validité du timestamp entrant est figée à la réception. Un timestamp futur ne devient pas exploitable après attente ; les doublons ne remplacent pas cette première décision. Le contexte distingue firstReceivedAt et processedAt. Aucune reconstitution de fenêtre de service depuis l’heure tardive d’un worker.

### Confidentialité et rétention

Les textes/expéditeurs et clés de corrélation utiles sont chiffrés. Les payloads n’incluent ni profils/contacts, ni destinataire redondant des statuts, ni prix, ni détails libres des erreurs, ni enveloppe HTTP brute. Les erreurs non liées contiennent seulement leur code borné. Les types inconnus sont minimisés et ne sont pas reconstruisibles intégralement : leur conservation n’est pas présentée comme une archive brute.

HMAC de lookup, clé de stream et clés AES sont distincts ; les buffers sont copiés à la construction. L’AAD lie endpoint, type/UUID d’objet, digest et version de chiffrement. Aucun secret/signature/token/payload n’est journalisé. Les IDs Meta natifs restent des pseudonymes sensibles, pas des données anonymes.

L’expiration est implémentée par lots de 100 payloads : contenu traité/ignoré à 24 h, contenu ouvert à 30 jours, variante contradictoire à 30 jours. La purge réelle du ciphertext est marquée ; le tombstone reste. Un entrant non résolu expiré reste bloquant, plutôt que rouvrir implicitement les envois faute de pouvoir appliquer son STOP.

La suppression des receipts/manifeste/tombstones à 7/90 jours n’est pas activée : leur plan de purge dépendant et sa validation restent à réaliser. Les échéances sont enregistrées, pas présentées comme une suppression déjà automatisée. Aucun cron de purge lancé.

## 4. STOP : garanties, courses et frontière réelle

### Ce qui est implémenté

inspectBarrier retourne une observation et **dispatchAuthorized=false dans tous les cas**. Une lecture blocked=false n’est donc jamais un permis transférable vers un fetch ultérieur.

Le repository possède un protocole simulateDispatch exclusivement isolé. Acceptation, traitement et réservation/soumission **mock** utilisent le même verrou d’endpoint et le même verrou de flux ; la barrière consulte les entrants ouverts/échoués/expirés, les conflits et les événements non pris en charge dont le flux est inconnu. Un blocage ne réclame aucune livraison et ne consomme aucune tentative.

Deux ordres sont vérifiés :

1. STOP committé avant la frontière simulée : aucun appel au submitter mock et aucune réservation.
2. Frontière simulée déjà franchie : la réception suivante attend la section exclusive ; le STOP bloque ensuite les opérations futures. Aucun rappel rétroactif n’est prétendu.

Après traitement d’un STOP, l’inbox ne suffit plus : les autorisations métier existantes doivent continuer à être vérifiées. Le test injecte un retrait de consentement dans le même tx et vérifie que le submitter reste non appelé après ouverture de la seule barrière technique.

### Ce qui n’est pas garanti par des mocks

Une transaction SQL courte qui vérifie puis retourne un permis laisserait une course entre commit et écriture réseau. Le code **ne fournit pas** un tel permis réel. La transaction de simulation maintenue pendant un callback mock n’est pas proposée comme stratégie HTTP de production.

Une garantie portant sur un STOP déjà **accepté durablement** peut être ordonnée par un verrou partagé. Une garantie portant sur les tout premiers octets reçus par un autre serveur, avant authentification/persistance, ne découle pas d’un verrou de base. Cette différence doit être acceptée explicitement dans le contrat d’activation ; aucun programme ne doit annoncer que le mock prouve une absence globale d’envoi après toute arrivée physique d’un STOP.

### Coordination à valider avant un sender réel

Proposition conservatrice : un coordinateur de dispatch détient un verrou de session advisory sur une **connexion physique dédiée**, avant les derniers contrôles, pendant le claim métier et jusqu’au franchissement de la frontière réseau et à l’enregistrement du résultat. Les transactions SQL restent courtes ; la connexion/verrou de session peut survivre entre elles. Ce verrou ne doit pas être pris via des requêtes Prisma dispersées dans un pool, sans garantie de rester sur la même session.

Tous les producteurs doivent respecter une hiérarchie identique. Une adaptation possible est d’ajouter une porte advisory de périmètre, prise en transaction par l’ingestion **avant** Endpoint FOR UPDATE et prise en session par le dispatch avant ses transactions. Puis flux, puis lignes métier/événement. Sans cette porte préalable, un sender tenant un flux pourrait attendre un endpoint déjà tenu par une ingestion attendant ce flux : **cycle de verrouillage à éviter**. Cette coordination de session n’est pas implémentée/raccordée dans cette étape.

Sous cette porte : vérifier les entrants persistés bloquants ; appliquer les derniers contrôles de consentement/STOP/état humain/fenêtre ; effectuer le claim existant ; interdire les permis exportés ; invoquer une seule opération de transport contrôlée ; conserver le résultat incertain en cas de coupure/timeout ; libérer la session seulement avec une procédure de fin sûre. Un crash après claim ou appel peut laisser PROCESSING/DELIVERY_UNCERTAIN et ne doit jamais permettre un nouveau POST automatique.

La perte de connexion de verrou impose arrêt/annulation conservatrice du transport et résultat incertain ; une annulation réseau ne prouve pas qu’aucun octet n’a été transmis. Tout STOP accepté après une frontière de dispatch déjà engagée ne peut annuler rétroactivement ce dernier. Les risques de verrou long, délai Meta, crash et perte de session exigent des tests PostgreSQL/multi-processus et une revue du point de linéarisation.

**Condition bloquante : ne pas activer les entrants asynchrones avec des senders actifs avant cette validation.** Le webhook synchrone existant n’est pas remplacé aujourd’hui ; aucune nouvelle fenêtre de STOP différé n’est introduite dans le chemin actif.

## 5. Modèles Prisma proposés — texte documentaire seulement

La proposition conserve les quatre modèles du design, sans nouvelle table de messages ni relation polymorphe vers le métier. Les noms de delegates utilisés par le repository sont metaWebhookEndpoint, metaWebhookReceipt, metaWebhookEvent et metaWebhookReceiptItem.

Les déclarations ci-dessous sont une base de revue **non ajoutée à schema.prisma, non générée, non validée contre PostgreSQL**. Les CHECK et index partiels énumérés ensuite doivent compléter toute future migration.

```prisma
model MetaWebhookEndpoint {
  id                   String   @id @default(uuid()) @db.Uuid
  environment          String   @db.VarChar(16)
  applicationKey       String   @map("application_key") @db.VarChar(64)
  metaAppId            String   @map("meta_app_id") @db.VarChar(64)
  wabaId               String   @map("waba_id") @db.VarChar(64)
  phoneNumberId        String   @map("phone_number_id") @db.VarChar(64)
  inboxEnabled         Boolean  @default(false) @map("inbox_enabled")
  processingEnabled    Boolean  @default(false) @map("processing_enabled")
  normalizationVersion Int      @default(1) @map("normalization_version") @db.SmallInt
  identityVersion      Int      @default(1) @map("identity_version") @db.SmallInt
  lookupKeyVersion     String   @map("lookup_key_version") @db.VarChar(64)
  streamKeyVersion     String   @map("stream_key_version") @db.VarChar(64)
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  disabledAt           DateTime? @map("disabled_at") @db.Timestamptz(3)
  receipts             MetaWebhookReceipt[]
  events               MetaWebhookEvent[]
  @@unique([environment, applicationKey], map: "meta_endpoint_application_key")
  @@unique([environment, metaAppId, wabaId, phoneNumberId], map: "meta_endpoint_account_key")
  @@map("meta_webhook_endpoints")
}

model MetaWebhookReceipt {
  id                       String   @id @default(uuid()) @db.Uuid
  endpointId               String   @map("endpoint_id") @db.Uuid
  receivedAt               DateTime @map("received_at") @db.Timestamptz(3)
  storedAt                 DateTime @map("stored_at") @db.Timestamptz(3)
  requestDigest            Bytes    @map("request_digest")
  digestKeyVersion         String   @map("digest_key_version") @db.VarChar(64)
  authenticationKeyVersion String   @map("authentication_key_version") @db.VarChar(64)
  requestBytes             Int      @map("request_bytes")
  itemCount                Int      @map("item_count")
  newCount                 Int      @map("new_count")
  duplicateCount           Int      @map("duplicate_count")
  conflictCount            Int      @map("conflict_count")
  expiresAt                DateTime @map("expires_at") @db.Timestamptz(3)
  endpoint MetaWebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  items MetaWebhookReceiptItem[]
  @@unique([endpointId, id], map: "meta_receipt_endpoint_id_key")
  @@index([endpointId, storedAt, id], map: "meta_receipt_time_idx")
  @@index([expiresAt, id], map: "meta_receipt_expiry_idx")
  @@map("meta_webhook_receipts")
}

model MetaWebhookEvent {
  id                          String   @id @default(uuid()) @db.Uuid
  endpointId                  String   @map("endpoint_id") @db.Uuid
  enqueueOrder                BigInt   @unique @default(autoincrement()) @map("enqueue_order")
  kind                        String   @db.VarChar(24)
  nativeMessageId             String?  @map("native_message_id") @db.VarChar(512)
  nativeStatus                String?  @map("native_status") @db.VarChar(64)
  occurredAt                  DateTime? @map("occurred_at") @db.Timestamptz(3)
  occurredAtSource            String?  @map("occurred_at_source") @db.VarChar(32)
  identityVersion             Int      @map("identity_version") @db.SmallInt
  normalizationVersion        Int      @map("normalization_version") @db.SmallInt
  lookupKeyVersion            String   @map("lookup_key_version") @db.VarChar(64)
  identityKey                 Bytes    @map("identity_key")
  contentDigest               Bytes    @map("content_digest")
  correlationKeyHash          Bytes?   @map("correlation_key_hash")
  streamKey                   Bytes?   @map("stream_key")
  streamKeyVersion            String?  @map("stream_key_version") @db.VarChar(64)
  firstReceivedAt             DateTime @map("first_received_at") @db.Timestamptz(3)
  lastReceivedAt              DateTime @map("last_received_at") @db.Timestamptz(3)
  storedAt                    DateTime @map("stored_at") @db.Timestamptz(3)
  receiptCount                BigInt   @default(1) @map("receipt_count")
  normalizedPayloadCiphertext Bytes?   @map("normalized_payload_ciphertext")
  encryptionKeyVersion        String?  @map("encryption_key_version") @db.VarChar(64)
  state                       String   @default("RECEIVED") @db.VarChar(32)
  effectOutcome               String?  @map("effect_outcome") @db.VarChar(32)
  reasonCode                  String?  @map("reason_code") @db.VarChar(100)
  processingAttempts          Int      @default(0) @map("processing_attempts")
  consecutiveFailures         Int      @default(0) @map("consecutive_failures")
  nextAttemptAt               DateTime? @map("next_attempt_at") @db.Timestamptz(3)
  leaseToken                  String?  @map("lease_token") @db.Uuid
  leaseOwner                  String?  @map("lease_owner") @db.VarChar(64)
  leaseExpiresAt              DateTime? @map("lease_expires_at") @db.Timestamptz(3)
  leaseGeneration             BigInt   @default(0) @map("lease_generation")
  processedAt                 DateTime? @map("processed_at") @db.Timestamptz(3)
  failedAt                    DateTime? @map("failed_at") @db.Timestamptz(3)
  uncorrelatedSince           DateTime? @map("uncorrelated_since") @db.Timestamptz(3)
  targetKind                  String?  @map("target_kind") @db.VarChar(16)
  targetId                    Int?     @map("target_id")
  observedAttempt             Int?     @map("observed_attempt")
  hasConflict                 Boolean  @default(false) @map("has_conflict")
  reviewRequired              Boolean  @default(false) @map("review_required")
  payloadExpiresAt            DateTime @map("payload_expires_at") @db.Timestamptz(3)
  tombstoneExpiresAt          DateTime @map("tombstone_expires_at") @db.Timestamptz(3)
  payloadPurgedAt             DateTime? @map("payload_purged_at") @db.Timestamptz(3)
  endpoint MetaWebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  items MetaWebhookReceiptItem[]
  @@unique([endpointId, id], map: "meta_event_endpoint_id_key")
  @@unique([endpointId, identityVersion, lookupKeyVersion, identityKey], map: "meta_event_identity_key")
  @@index([endpointId, state, nextAttemptAt, enqueueOrder], map: "meta_event_queue_idx")
  @@index([endpointId, state, leaseExpiresAt], map: "meta_event_lease_idx")
  @@index([endpointId, streamKey, enqueueOrder], map: "meta_event_stream_idx")
  @@index([endpointId, nativeMessageId, state], map: "meta_event_native_idx")
  @@index([endpointId, correlationKeyHash, state], map: "meta_event_correlation_idx")
  @@index([endpointId, state, firstReceivedAt, id], map: "meta_event_operations_idx")
  @@index([payloadExpiresAt, id], map: "meta_event_payload_expiry_idx")
  @@index([tombstoneExpiresAt, id], map: "meta_event_tombstone_expiry_idx")
  @@map("meta_webhook_events")
}

model MetaWebhookReceiptItem {
  id                       String   @id @default(uuid()) @db.Uuid
  endpointId               String   @map("endpoint_id") @db.Uuid
  receiptId                String   @map("receipt_id") @db.Uuid
  eventId                  String   @map("event_id") @db.Uuid
  entryIndex               Int      @map("entry_index")
  changeIndex              Int      @map("change_index")
  itemIndex                Int      @map("item_index")
  collection               String   @db.VarChar(16)
  disposition              String   @db.VarChar(16)
  observedContentDigest    Bytes    @map("observed_content_digest")
  conflictPayloadCiphertext Bytes?  @map("conflict_payload_ciphertext")
  encryptionKeyVersion     String?  @map("encryption_key_version") @db.VarChar(64)
  conflictPayloadExpiresAt DateTime? @map("conflict_payload_expires_at") @db.Timestamptz(3)
  payloadPurgedAt          DateTime? @map("payload_purged_at") @db.Timestamptz(3)
  createdAt                DateTime @map("created_at") @db.Timestamptz(3)
  expiresAt                DateTime @map("expires_at") @db.Timestamptz(3)
  receipt MetaWebhookReceipt @relation(fields: [endpointId, receiptId], references: [endpointId, id], onDelete: Restrict, onUpdate: Restrict)
  event MetaWebhookEvent @relation(fields: [endpointId, eventId], references: [endpointId, id], onDelete: Restrict, onUpdate: Restrict)
  @@unique([endpointId, receiptId, entryIndex, changeIndex, collection, itemIndex], map: "meta_receipt_position_key")
  @@index([endpointId, eventId, createdAt], map: "meta_receipt_item_event_idx")
  @@index([expiresAt, id], map: "meta_receipt_item_expiry_idx")
  @@map("meta_webhook_receipt_items")
}
```

Deux compléments techniques au dictionnaire initial sont proposés sur ReceiptItem : conflictPayloadExpiresAt et payloadPurgedAt. Ils permettent de conserver les métadonnées du conflit 90 jours tout en supprimant son ciphertext à 30 jours. Sans ce marqueur, le CHECK « conflit exige ciphertext » empêcherait sa purge. Le CHECK futur doit permettre **ciphertext+clé présents OU purge datée**, avec échéance de contenu explicite. Aucun cinquième modèle ni modèle métier modifié.

## 6. Migration proposée, non créée

Une nouvelle migration additive devra, sous autorisation :

1. Créer les quatre tables, UUID applicatifs, séquence enqueueOrder et types natifs. Conserver les 44 fichiers existants intégralement.
2. Créer les PK/uniques et les FK composites RESTRICT. Ne pas rendre nativeMessageId unique : plusieurs statuts doivent coexister.
3. Ajouter les CHECK : formats/valeurs fermés et versions positives ; empreintes 32 octets ; compteurs non négatifs ; manifeste new+duplicate+conflict=itemCount ; états/baux/dates/outcomes cohérents ; streamKey/version ensemble ; contenu réexécutable chiffré ; références polymorphes seulement indicatives ; rétention et marqueurs de purge cohérents.
4. Ajouter une vérification différée/contrôle d’intégrité du nombre effectif de receiptItems : un CHECK de receipt ne compte pas les lignes filles. Le contrôle applicatif existe déjà mais ne suffit pas contre une écriture SQL directe.
5. Définir des index partiels SQL pour queue éligible, PROCESSING expirables et UNCORRELATED. Les index ordinaires illustrés dans Prisma sont une représentation initiale, pas une optimisation déjà validée.
6. Garantir l’immuabilité du périmètre et le mode mono-compte : les tables métier restent globales. Une contrainte/configuration empêchant plusieurs endpoints actifs partageant ce périmètre métier est nécessaire ; ne pas supposer que les FK techniques créent un multi-tenant.
7. Réviser les plans, timeouts/verrous, permissions minimales et purge dépendante sur base dédiée expressément autorisée ; générer seulement alors le client avec les quatre delegates. Aucun backfill d’enveloppes historiques ni identifiant Meta réencodé.

Les permissions de réception/worker/purge devront être limitées aux opérations et colonnes requises, sans GRANT OPTION, CREATE, TEMPORARY ou rôle administratif. L’usage de la seule nouvelle séquence sera à autoriser. Une RLS éventuelle et des accès opérateur nécessitent une conception supplémentaire ; aucune permission ou politique n’est créée ici.

## 7. Tests exécutés

Inspection préalable : scripts npm, imports des suites existantes, nouveaux composants et helper. Le repository et les tests ne chargent aucun client de base réel ; ils passent un backend explicite. La sélection utilise le garde-fou existant whatsappIsolationGuard.cjs, qui interdit les méthodes Prisma par défaut, la construction d’un client réel, le pilote pg et fetch global. Les tests HTTP existants n’utilisent que des serveurs locaux avec handlers mockés.

Commande du passage final :

```text
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappIntegrationTarget.test.js tests/whatsappHumanHandoff.test.js tests/whatsappHumanHttp.test.js tests/whatsappConversationContext.test.js tests/whatsappConversationPersistence.test.js tests/whatsappConversationEngine.test.js tests/whatsappDeliveryReliability.test.js tests/whatsappConversationDelivery.test.js tests/whatsappProspectFollowUp.test.js tests/whatsappWebhookSecurity.test.js tests/whatsappAdminConversations.test.js tests/whatsappPreferenceOptOut.test.js tests/whatsappFixtureClock.test.js tests/gupshupPhase2.test.js tests/gupshupDurableStore.test.js tests/metaWhatsAppConsolidation.test.js tests/metaInbox.test.js
```

Le processus enfant définit NODE_ENV=test, WHATSAPP_ENABLED=false, WHATSAPP_WORKERS_ENABLED=false. Aucun npm test, suite globale, tests/whatsapp.test.js ou suite PostgreSQL exécuté. Les clés et messages des tests sont synthétiques. Les méthodes process/claim sont appelées directement sur le mock ; aucun scheduler ou worker d’application n’est démarré.

Résultat : **341 tests, 341 réussis, 0 échec, 0 ignoré**, dont 39 nouveaux. Durée : **1054,491 ms**. Journal complet : output/meta-whatsapp-durable-inbox-isolated.log.

Les 39 scénarios couvrent les lots atomiques, erreurs d’écriture/commit, doublons concurrents, variantes, callbacks précoces/tardifs/inconnus, cibles ambiguës, interruption et reconstruction, rollback effet+marquage, baux expirés pendant traitement, STOP en attente et course de réservation, consentement après STOP, absence de second submit mock, timestamp futur, purge, rotation de lookup/stream et données sensibles. Un premier passage a trouvé un masquage du global process par le nom d’une nouvelle fonction interne ; il a été corrigé sans modifier aucune assertion existante. Les passages suivants sont verts.

Le mock sérialise les transactions et restaure les lignes au rollback ; ses traces de submit simulé ne sont pas rollbackées, afin de montrer la limite commit/réseau. Il ne valide ni le SQL, ni les index/FK, ni les sessions advisory, ni le comportement MVCC de PostgreSQL. Recréer un repository contre les mêmes lignes prouve la reprise du contrat, pas une restauration réelle après crash serveur.

## 8. Garanties obtenues et limites

| Sujet | Obtenu à cette étape | Limite / condition restante |
|---|---|---|
| Atomicité de lot | Contrat transactionnel et rollback testés sur mock. | À prouver avec les contraintes et commits PostgreSQL réels. |
| Déduplication | Identité native, versions et variantes testées. | Contraintes SQL et concurrence multi-processus non validées. |
| Effet + marquage | Même tx pour les statuts et les adaptateurs simulés. | Extraction transactionnelle réelle NVA entrante manquante ; le défaut bloque. |
| STOP | Barrière fail-closed et ordres de course simulés, pas de permis réel. | Coordination session/réseau non raccordée ; aucune garantie globale de non-envoi après simple réception physique. |
| Pas de double envoi | Aucun sender dans l’inbox ; un seul claim mock ; aucun retry de submit après commit ambigu. | Un nouveau caller ne peut pas conclure qu’un POST ambigu n’a pas eu lieu. Pas d’exactement une fois réseau. |
| Reprise | Baux/générations et UNCORRELATED persistés dans le backend injecté. | Reprise physique, supervision et lifecycle du worker restent à tester. |
| Confidentialité | Projection minimale, chiffrement/AAD et absence de logs de payload. | Gestionnaire de secrets, sauvegardes, ACL SQL et audit opérationnel à préparer. |
| Rétention | Purge des contenus/variantes et maintien des barrières/tombstones. | Suppression complète des métadonnées, revue humaine et calendrier d’exploitation non implémentés. |
| Isolation | Scope capturé, compte/version contrôlés et requêtes filtrées. | Tables métier globales : activation mono-périmètre seulement ; pas de RLS supposée. |

## 9. Étapes nécessaires avant activation

1. Approuver les propositions de schéma, CHECK et ajustements de rétention ; aucune migration ne peut être déduite comme autorisée par ce rapport.
2. Autoriser séparément modèle Prisma, migration additive, génération client et tests PostgreSQL dédiés.
3. Extraire/valider l’adaptateur transactionnel entrant NVA en conservant consentement, STOP, contrôle humain, horloges et échéances ; tester le parcours réel sans réseau.
4. Définir et tester le coordinateur session/dispatch, les courses multi-processus et le point de linéarisation ; laisser tous les senders arrêtés tant que cette condition reste ouverte.
5. Terminer la politique de retry d’inbox, réveil/balayage, purge dépendante, accès de revue, quotas, clés/rotation et supervision. Confirmer les contrats Meta réels sous autorisation séparée.
6. Raccorder plus tard une seule voie d’acceptation HTTP, puis valider commit avant ACK. Ne pas traiter le même événement par la voie synchrone et l’inbox en parallèle.
7. Autoriser indépendamment tout essai réel, configuration et activation. Gupshup et Provider* restent conservés/inactifs.

Contrôle final par empreintes : **les 378 fichiers préexistants protégés sont identiques** à leur état de début d’intervention. Les six fichiers source/test ci-dessus sont nouveaux ; les 44 migrations restent inchangées. Aucun client Prisma généré ou paquet installé.

**Point d’arrêt : aucune modification de schéma, migration, base, .env, webhook actif ou poller. Aucun test PostgreSQL ni appel Meta/Gupshup. Attente d’autorisation avant toute étape suivante.**
