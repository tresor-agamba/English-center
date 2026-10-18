# NVA — Revue de migration Prisma de l’inbox Meta WhatsApp

Date : 16 octobre 2026. **Proposition pour revue, non exécutable comme une autorisation.**

## 1. Résultat de l’audit et périmètre

Cette intervention produit uniquement ce document. Aucun code, schéma, migration historique, client généré, configuration ou base modifié. Aucun test ni worker lancé ; aucun accès PostgreSQL, appel fournisseur ou commande Prisma. Les 355 tests isolés réussis sont le résultat de l’intervention précédente, pas une validation SQL effectuée ici.

Références : `meta-whatsapp-durable-inbox-design.md`, `meta-whatsapp-durable-inbox-implementation.md`, `meta-whatsapp-prisma-integration-plan.md`, schéma source, 44 migrations SQL, schéma et déclarations TypeScript du client généré, repository et adaptateur Meta préparés.

### Comparaison précise des artefacts locaux

| Artefact | Constat |
|---|---|
| `prisma/schema.prisma` | 75 modèles : 69 modèles historiques et 6 Provider*. Aucun MetaWebhook*. |
| `prisma/migrations` | 44 fichiers migration.sql ; aucune création des 6 tables Provider* ni des 4 tables Meta. Les tables correspondant aux 69 modèles historiques sont référencées par les CREATE TABLE de l’historique. |
| `node_modules/.prisma/client/schema.prisma` | 69 modèles. Aucun Provider*, aucun MetaWebhook*. |
| Client réel de l’application | `src/utils/prisma.js` importe `@prisma/client`, résolu vers `node_modules/@prisma/client/default.js`, qui réexporte `.prisma/client/default`. Lecture statique seulement : le singleton n’a pas été chargé/instancié. |
| Versions locales et dépendances déclarées | Prisma et @prisma/client **6.19.3**. Générateur prisma-client-js sans output personnalisé ; binaryTargets native/windows/debian-openssl-3.0.x. Pas de configuration Prisma spécifique dans package.json. |
| Enums et configuration | 60 enums identiques entre source et copie générée ; generator et datasource identiques après normalisation des espaces. Datasource PostgreSQL avec référence DATABASE_URL ; aucune valeur de secret lue/affichée. |
| WhatsAppProspectFollowUp | Présent dans les deux schémas et son getter existe dans index.d.ts. L’ancienne absence du delegate n’est pas la divergence actuelle. |
| Propositions Meta | 4 modèles documentaires seulement ; repository utilisant les futurs delegates. Le client actuel ne peut pas exécuter ce repository sur une base réelle. |

Les différences entre les modèles communs du source et du client généré sont **exactement cinq champs relationnels inverses** :

| Modèle existant | Champs présents seulement dans le source |
|---|---|
| User | `providerReconciliationAudits ProviderReconciliationAudit[]` |
| WhatsAppDelivery | `providerDeliveries ProviderDelivery[]` |
| WhatsAppConversationMessage | `providerDeliveries ProviderDelivery[]`, `providerInboundEvents ProviderWebhookEvent[]` |
| WhatsAppProspectFollowUp | `providerDeliveries ProviderDelivery[]` |

Aucun champ scalaire, index ou contrainte des 69 modèles communs ne diffère entre ces deux copies après normalisation des espaces. Ces cinq relations inverses n’ajoutent pas de colonne dans les tables métier ; les FK se trouveraient dans les futures tables Provider*. Cela ne valide pas pour autant l’identité sémantique complète du schéma avec le résultat d’un replay SQL : sans base, aucune introspection, replay des migrations ou vérification du catalogue appliqué n’est possible. Ne pas transformer l’inventaire des 44 fichiers en attestation de 44 migrations réellement appliquées aujourd’hui.

### Les six divergences Provider*

| Modèle source | Table non créée par les migrations locales | Dépendances principales proposées |
|---|---|---|
| ProviderApplication | provider_applications | Périmètre provider/environnement/application ; parent des livraisons et événements. |
| ProviderDelivery | provider_deliveries | Application ; cible message/notification/relance ; activeAttempt avec FK composite cyclique vers les tentatives. |
| ProviderSendAttempt | provider_send_attempts | Livraison/application ; uniques de tentative, operationKey, submissionId et canonicalId. |
| ProviderMessageAlias | provider_message_aliases | Tentative ; événement source facultatif ; unique application/type/externalId. |
| ProviderWebhookEvent | provider_webhook_events | Application ; tentative et message entrant facultatifs ; dédup, baux, identifiants Gupshup/WhatsApp. |
| ProviderReconciliationAudit | provider_reconciliation_audits | Événement/tentative/utilisateur facultatifs. |

Le commentaire de tête du schéma identifie ces déclarations comme phase 4A sans migration appliquée. Leur présence dans une base réelle n’est ni confirmée ni exclue par cet audit hors base. Le cycle ProviderDelivery/ProviderSendAttempt et leurs contraintes appartiennent à une revue Gupshup séparée ; aucun de ces objets n’est nécessaire à l’inbox Meta.

### Empreintes de référence

| Artefact | SHA-256 |
|---|---|
| schema.prisma | `a7051df24bca10ec6eb338da5a39370c96c2c3469ce5132d6f182d345f8f826a` |
| Schéma du client généré | `39ebb909e0494601ec87902e3f0fbaec95195b3962dad9c394f2484f03381fe7` |
| Manifeste des 44 migrations | `fb28b862e78fc0c0b77ca483ff3dfa42b85d38c52dcfab77fef79f9081f7d967` |

Manifeste : chemins relatifs `prisma/migrations/<nom>/migration.sql` triés, concaténation UTF-8 des lignes `chemin + espace + sha256(octets) + LF`, puis SHA-256. Les empreintes source/migrations sont identiques à celles du rapport précédent.

## 2. Stratégie de réconciliation et isolation Meta

**Ne pas produire une migration par diff global du schéma de 75 modèles.** Un outil qui compare ce schéma à l’historique chercherait également à créer les six Provider*, leurs FK et index. Cela dépasserait le périmètre autorisé.

Stratégie recommandée après autorisation distincte :

1. Ajouter uniquement les quatre blocs Meta au schéma principal : 79 modèles au total, avec Provider* et leurs cinq relations inverses intégralement conservés. Aucun nouveau champ dans les 69 modèles existants.
2. Créer ultérieurement une migration **SQL explicite et revue**, avec une liste fermée d’objets Meta. L’appendice SQL ci-dessous est cette proposition, uniquement dans le présent Markdown. Aucun répertoire ajouté sous prisma/migrations.
3. Un futur déploiement de migrations doit appliquer l’historique approuvé et ce SQL, pas synchroniser l’ensemble du schéma déclaratif. La génération d’un client n’applique pas du DDL ; inversement, un client généré depuis les 79 modèles exposerait aussi des delegates Provider* dont les tables pourraient rester absentes. Interdire leur usage ne peut pas reposer sur leur seule absence du client.
4. Pour les prochains diffs de développement, préparer un **schéma de migration projeté** distinct, sous autorisation : les 69 modèles historiques vérifiés + 4 Meta, sans les 6 déclarations Provider* et leurs cinq champs inverses, soit 73 modèles. Cette projection ne supprime rien du schéma principal ni du code Gupshup. Elle doit être reproductible, contrôlée en CI et cohérente avec le résultat des migrations ; ne pas copier aveuglément un client généré comme source d’autorité.
5. Décider séparément si le client applicatif futur est généré depuis le schéma principal de 79 modèles ou cette projection de 73. Dans les deux cas, tester les imports existants ; les nouveaux delegates Meta doivent pointer vers les tables Meta exactes. Aucun besoin de prendre cette décision pour exécuter un SQL automatique aujourd’hui : aucune exécution autorisée ici.
6. Réconcilier Gupshup ultérieurement par décision explicite : migration propre si les modèles doivent vivre en SQL, conservation documentaire/projection si différés, ou retrait formel après validation Meta. Ne pas déclarer fictivement ses migrations appliquées, supprimer des modèles ou réinitialiser une base pour éliminer l’écart.

Une migration Meta peut être additive et limitée sans que le schéma principal soit pour autant entièrement réconcilié. Documenter cette divergence persistante dans les outils de release. Une validation du schéma Prisma ne certifie ni le SQL additionnel, ni la sûreté STOP/envoi.

## 3. Modifications Prisma proposées — non appliquées

Les quatre blocs complets ci-dessous reprennent le rapport d’implémentation, avec les champs de purge des variantes. PK UUID applicatives : `@default(uuid())` est un défaut Prisma, pas une obligation d’extension UUID PostgreSQL. `enqueueOrder` utilise une séquence BIGINT via BIGSERIAL. Noms et types correspondent au repository préparé.

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

Aucune relation vers les modèles Provider*, ni FK targetId vers les tables métier. Les deux FK de ReceiptItem partagent endpointId et visent les uniques composites parents ; leur validation par Prisma 6.19.3 et les opérations réellement générées restent à tester après autorisation. Le client transactionnel de l’inbox doit transmettre exactement le même tx au moteur et au marquage.

Les CHECK, index partiel mono-périmètre, fonctions et triggers SQL suivants ne sont pas représentés intégralement par ces blocs Prisma. Les conserver explicitement dans la future migration et dans sa revue de drift ; ne pas régénérer une migration qui les effacerait. Les index Prisma généraux sont conservés dans ce premier candidat ; les index partiels de file/baux envisagés par le design sont des optimisations futures à mesurer, pas ajoutées en double sans preuve.

## 4. SQL proposé pour revue — jamais exécuté

**Candidat PostgreSQL 16, non validé par un serveur.** Il crée seulement quatre tables Meta, la séquence implicite de enqueueOrder, leurs index/contraintes et des fonctions/triggers Meta. Aucun ALTER sur table métier, aucun objet Provider*, aucun INSERT d’endpoint, GRANT, secret ou activation. Le schéma cible explicite est public, à confirmer dans la future cible autorisée. Pas de IF NOT EXISTS qui masquerait un objet préexistant incompatible. Pas d’extension nécessaire.

Les opérations seraient encadrées par une transaction DDL lors d’une application future autorisée ; tout échec doit faire rollback et arrêter, sans tenter de réparation automatique. Les fonctions sont SECURITY INVOKER et n’accordent aucun privilège ; étudier séparément les ACL de création par défaut du rôle migrateur avant application. Les fonctions de trigger ne sont pas une interface publique.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public."meta_webhook_endpoints" (
  "id" UUID NOT NULL,
  "environment" VARCHAR(16) NOT NULL,
  "application_key" VARCHAR(64) NOT NULL,
  "meta_app_id" VARCHAR(64) NOT NULL,
  "waba_id" VARCHAR(64) NOT NULL,
  "phone_number_id" VARCHAR(64) NOT NULL,
  "inbox_enabled" BOOLEAN NOT NULL DEFAULT false,
  "processing_enabled" BOOLEAN NOT NULL DEFAULT false,
  "normalization_version" SMALLINT NOT NULL DEFAULT 1,
  "identity_version" SMALLINT NOT NULL DEFAULT 1,
  "lookup_key_version" VARCHAR(64) NOT NULL,
  "stream_key_version" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(3),
  CONSTRAINT "meta_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_receipts" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "stored_at" TIMESTAMPTZ(3) NOT NULL,
  "request_digest" BYTEA NOT NULL,
  "digest_key_version" VARCHAR(64) NOT NULL,
  "authentication_key_version" VARCHAR(64) NOT NULL,
  "request_bytes" INTEGER NOT NULL,
  "item_count" INTEGER NOT NULL,
  "new_count" INTEGER NOT NULL,
  "duplicate_count" INTEGER NOT NULL,
  "conflict_count" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "meta_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_events" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "enqueue_order" BIGSERIAL NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "native_message_id" VARCHAR(512),
  "native_status" VARCHAR(64),
  "occurred_at" TIMESTAMPTZ(3),
  "occurred_at_source" VARCHAR(32),
  "identity_version" SMALLINT NOT NULL,
  "normalization_version" SMALLINT NOT NULL,
  "lookup_key_version" VARCHAR(64) NOT NULL,
  "identity_key" BYTEA NOT NULL,
  "content_digest" BYTEA NOT NULL,
  "correlation_key_hash" BYTEA,
  "stream_key" BYTEA,
  "stream_key_version" VARCHAR(64),
  "first_received_at" TIMESTAMPTZ(3) NOT NULL,
  "last_received_at" TIMESTAMPTZ(3) NOT NULL,
  "stored_at" TIMESTAMPTZ(3) NOT NULL,
  "receipt_count" BIGINT NOT NULL DEFAULT 1,
  "normalized_payload_ciphertext" BYTEA,
  "encryption_key_version" VARCHAR(64),
  "state" VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  "effect_outcome" VARCHAR(32),
  "reason_code" VARCHAR(100),
  "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "lease_token" UUID,
  "lease_owner" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "lease_generation" BIGINT NOT NULL DEFAULT 0,
  "processed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "uncorrelated_since" TIMESTAMPTZ(3),
  "target_kind" VARCHAR(16),
  "target_id" INTEGER,
  "observed_attempt" INTEGER,
  "has_conflict" BOOLEAN NOT NULL DEFAULT false,
  "review_required" BOOLEAN NOT NULL DEFAULT false,
  "payload_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "tombstone_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "payload_purged_at" TIMESTAMPTZ(3),
  CONSTRAINT "meta_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_webhook_receipt_items" (
  "id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "entry_index" INTEGER NOT NULL,
  "change_index" INTEGER NOT NULL,
  "item_index" INTEGER NOT NULL,
  "collection" VARCHAR(16) NOT NULL,
  "disposition" VARCHAR(16) NOT NULL,
  "observed_content_digest" BYTEA NOT NULL,
  "conflict_payload_ciphertext" BYTEA,
  "encryption_key_version" VARCHAR(64),
  "conflict_payload_expires_at" TIMESTAMPTZ(3),
  "payload_purged_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "meta_webhook_receipt_items_pkey" PRIMARY KEY ("id")
);

-- Les UUID sont produits par l'application/Prisma : aucun défaut DB UUID.
ALTER TABLE public.meta_webhook_endpoints
  ADD CONSTRAINT meta_endpoint_application_key UNIQUE (environment, application_key),
  ADD CONSTRAINT meta_endpoint_account_key UNIQUE (environment, meta_app_id, waba_id, phone_number_id),
  ADD CONSTRAINT meta_endpoint_values_check CHECK (
    environment IN ('test','staging','production')
    AND application_key ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND meta_app_id ~ '^[0-9]{1,64}$' AND waba_id ~ '^[0-9]{1,64}$'
    AND phone_number_id ~ '^[0-9]{1,64}$'
    AND normalization_version > 0 AND identity_version > 0
    AND lookup_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND stream_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND (disabled_at IS NULL OR (NOT inbox_enabled AND NOT processing_enabled))
  );
-- Un seul périmètre actif, tous environnements confondus dans CETTE base.
CREATE UNIQUE INDEX meta_endpoint_one_active_key
  ON public.meta_webhook_endpoints ((1))
  WHERE disabled_at IS NULL AND (inbox_enabled OR processing_enabled);

ALTER TABLE public.meta_webhook_receipts
  ADD CONSTRAINT meta_receipt_endpoint_id_key UNIQUE (endpoint_id, id),
  ADD CONSTRAINT meta_receipt_endpoint_fkey FOREIGN KEY (endpoint_id)
    REFERENCES public.meta_webhook_endpoints(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_values_check CHECK (
    request_bytes BETWEEN 1 AND 1048576 AND octet_length(request_digest) = 32
    AND item_count BETWEEN 0 AND 512
    AND new_count BETWEEN 0 AND 512 AND duplicate_count BETWEEN 0 AND 512
    AND conflict_count BETWEEN 0 AND 512
    AND item_count = new_count + duplicate_count + conflict_count
    AND digest_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND authentication_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND expires_at >= stored_at
  );
CREATE INDEX meta_receipt_time_idx ON public.meta_webhook_receipts(endpoint_id, stored_at, id);
CREATE INDEX meta_receipt_expiry_idx ON public.meta_webhook_receipts(expires_at, id);

ALTER TABLE public.meta_webhook_events
  ADD CONSTRAINT meta_event_endpoint_id_key UNIQUE (endpoint_id, id),
  ADD CONSTRAINT meta_event_identity_key UNIQUE (endpoint_id, identity_version, lookup_key_version, identity_key),
  ADD CONSTRAINT meta_webhook_events_enqueue_order_key UNIQUE (enqueue_order),
  ADD CONSTRAINT meta_event_endpoint_fkey FOREIGN KEY (endpoint_id)
    REFERENCES public.meta_webhook_endpoints(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_event_values_check CHECK (
    kind IN ('INBOUND','STATUS','PROVIDER_ERROR','UNSUPPORTED')
    AND state IN ('RECEIVED','READY','PROCESSING','UNCORRELATED','RETRY_WAIT','PROCESSED','IGNORED','FAILED','EXPIRED')
    AND (effect_outcome IS NULL OR effect_outcome IN ('APPLIED','DUPLICATE','NONE'))
    AND identity_version > 0 AND normalization_version > 0
    AND enqueue_order > 0 AND receipt_count >= 1
    AND processing_attempts >= 0 AND consecutive_failures >= 0 AND lease_generation >= 0
    AND octet_length(identity_key) = 32 AND octet_length(content_digest) = 32
    AND (correlation_key_hash IS NULL OR octet_length(correlation_key_hash) = 32)
    AND (stream_key IS NULL OR octet_length(stream_key) = 32)
    AND ((stream_key IS NULL) = (stream_key_version IS NULL))
    AND lookup_key_version ~ '^[a-zA-Z0-9_-]{1,64}$'
    AND (stream_key_version IS NULL OR stream_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND (encryption_key_version IS NULL OR encryption_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND last_received_at >= first_received_at
    AND payload_expires_at <= tombstone_expires_at
    AND ((occurred_at IS NULL) = (occurred_at_source IS NULL))
    AND (occurred_at_source IS NULL OR occurred_at_source = 'meta-seconds')
    AND (native_message_id IS NULL OR length(native_message_id) > 0)
    AND (kind <> 'STATUS' OR (native_message_id IS NOT NULL AND native_status IS NOT NULL AND length(native_status) > 0))
    AND (kind <> 'INBOUND' OR (native_message_id IS NOT NULL AND stream_key IS NOT NULL))
    AND ((target_kind IS NULL AND target_id IS NULL)
      OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_id > 0 AND length(target_kind) > 0))
    AND (observed_attempt IS NULL OR observed_attempt >= 0)
    AND (NOT has_conflict OR review_required)
  ),
  ADD CONSTRAINT meta_event_lease_check CHECK (
    (state = 'PROCESSING' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_owner ~ '^[a-zA-Z0-9_-]{1,64}$' AND lease_expires_at IS NOT NULL AND lease_generation > 0)
    OR (state <> 'PROCESSING' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT meta_event_payload_check CHECK (
    (normalized_payload_ciphertext IS NOT NULL AND octet_length(normalized_payload_ciphertext) > 0
      AND encryption_key_version IS NOT NULL AND payload_purged_at IS NULL)
    OR (normalized_payload_ciphertext IS NULL AND encryption_key_version IS NULL
      AND payload_purged_at IS NOT NULL
      AND (state IN ('PROCESSED','IGNORED','EXPIRED') OR (state = 'FAILED' AND review_required)))
  ),
  ADD CONSTRAINT meta_event_result_check CHECK (
    (state NOT IN ('PROCESSED','IGNORED') OR (processed_at IS NOT NULL AND effect_outcome IS NOT NULL))
    AND (state <> 'FAILED' OR failed_at IS NOT NULL)
    AND (state <> 'EXPIRED' OR payload_purged_at IS NOT NULL)
    AND (state <> 'UNCORRELATED' OR (kind = 'STATUS' AND uncorrelated_since IS NOT NULL))
    AND (state NOT IN ('READY','RETRY_WAIT','UNCORRELATED') OR next_attempt_at IS NOT NULL)
  );
CREATE INDEX meta_event_queue_idx ON public.meta_webhook_events(endpoint_id, state, next_attempt_at, enqueue_order);
CREATE INDEX meta_event_lease_idx ON public.meta_webhook_events(endpoint_id, state, lease_expires_at);
CREATE INDEX meta_event_stream_idx ON public.meta_webhook_events(endpoint_id, stream_key, enqueue_order);
CREATE INDEX meta_event_native_idx ON public.meta_webhook_events(endpoint_id, native_message_id, state);
CREATE INDEX meta_event_correlation_idx ON public.meta_webhook_events(endpoint_id, correlation_key_hash, state);
CREATE INDEX meta_event_operations_idx ON public.meta_webhook_events(endpoint_id, state, first_received_at, id);
CREATE INDEX meta_event_payload_expiry_idx ON public.meta_webhook_events(payload_expires_at, id);
CREATE INDEX meta_event_tombstone_expiry_idx ON public.meta_webhook_events(tombstone_expires_at, id);

ALTER TABLE public.meta_webhook_receipt_items
  ADD CONSTRAINT meta_receipt_position_key UNIQUE (endpoint_id, receipt_id, entry_index, change_index, collection, item_index),
  ADD CONSTRAINT meta_receipt_item_receipt_fkey FOREIGN KEY (endpoint_id, receipt_id)
    REFERENCES public.meta_webhook_receipts(endpoint_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_item_event_fkey FOREIGN KEY (endpoint_id, event_id)
    REFERENCES public.meta_webhook_events(endpoint_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT meta_receipt_item_values_check CHECK (
    entry_index >= 0 AND change_index >= 0 AND item_index >= 0
    AND collection IN ('messages','statuses','errors')
    AND disposition IN ('NEW','DUPLICATE','CONFLICT')
    AND octet_length(observed_content_digest) = 32 AND expires_at >= created_at
    AND (encryption_key_version IS NULL OR encryption_key_version ~ '^[a-zA-Z0-9_-]{1,64}$')
    AND (
      (disposition <> 'CONFLICT' AND conflict_payload_ciphertext IS NULL AND encryption_key_version IS NULL
        AND conflict_payload_expires_at IS NULL AND payload_purged_at IS NULL)
      OR (disposition = 'CONFLICT' AND conflict_payload_expires_at IS NOT NULL
        AND conflict_payload_expires_at <= expires_at
        AND ((conflict_payload_ciphertext IS NOT NULL AND octet_length(conflict_payload_ciphertext) > 0
            AND encryption_key_version IS NOT NULL AND payload_purged_at IS NULL)
          OR (conflict_payload_ciphertext IS NULL AND encryption_key_version IS NULL AND payload_purged_at IS NOT NULL)))
    )
  );
CREATE INDEX meta_receipt_item_event_idx ON public.meta_webhook_receipt_items(endpoint_id, event_id, created_at);
CREATE INDEX meta_receipt_item_expiry_idx ON public.meta_webhook_receipt_items(expires_at, id);

-- Toutes les écritures applicatives prennent d'abord l'endpoint FOR UPDATE.
-- Ces triggers ajoutent des garde-fous, pas un remplacement de cet ordre.
CREATE FUNCTION public.meta_inbox_lock_endpoint(p_endpoint uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM id FROM public.meta_webhook_endpoints WHERE id = p_endpoint FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_ENDPOINT_REQUIRED';
  END IF;
END;
$$;

CREATE FUNCTION public.meta_inbox_endpoint_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.id, NEW.environment, NEW.application_key, NEW.meta_app_id, NEW.waba_id, NEW.phone_number_id)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.application_key, OLD.meta_app_id, OLD.waba_id, OLD.phone_number_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ENDPOINT_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.stream_key_version IS DISTINCT FROM OLD.stream_key_version AND EXISTS (
    SELECT 1 FROM public.meta_webhook_events WHERE endpoint_id = OLD.id
      AND stream_key IS NOT NULL AND (state NOT IN ('PROCESSED','IGNORED') OR has_conflict)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_OPEN_STREAM_VERSION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_endpoint_guard BEFORE UPDATE ON public.meta_webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_endpoint_guard();

CREATE FUNCTION public.meta_inbox_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
    RETURN NEW;
  END IF;
  PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
  IF TG_OP = 'DELETE' THEN
    IF OLD.expires_at > clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_RECEIPT_RETENTION';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.endpoint_id, NEW.received_at, NEW.stored_at, NEW.request_digest,
    NEW.digest_key_version, NEW.authentication_key_version, NEW.request_bytes)
    IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.received_at, OLD.stored_at, OLD.request_digest,
    OLD.digest_key_version, OLD.authentication_key_version, OLD.request_bytes)
    OR NEW.expires_at < OLD.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_RECEIPT_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipts
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_receipt_guard();

CREATE FUNCTION public.meta_inbox_event_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
    RETURN NEW;
  END IF;
  PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
  IF TG_OP = 'DELETE' THEN
    IF OLD.tombstone_expires_at > clock_timestamp()
      OR OLD.has_conflict
      OR (OLD.kind IN ('INBOUND','UNSUPPORTED') AND OLD.state NOT IN ('PROCESSED','IGNORED')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_EVENT_RETENTION_OR_BARRIER';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.endpoint_id, NEW.enqueue_order, NEW.kind, NEW.native_message_id, NEW.native_status,
    NEW.occurred_at, NEW.occurred_at_source, NEW.identity_version, NEW.normalization_version,
    NEW.lookup_key_version, NEW.identity_key, NEW.content_digest, NEW.correlation_key_hash,
    NEW.stream_key, NEW.stream_key_version, NEW.first_received_at, NEW.stored_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.enqueue_order, OLD.kind, OLD.native_message_id, OLD.native_status,
    OLD.occurred_at, OLD.occurred_at_source, OLD.identity_version, OLD.normalization_version,
    OLD.lookup_key_version, OLD.identity_key, OLD.content_digest, OLD.correlation_key_hash,
    OLD.stream_key, OLD.stream_key_version, OLD.first_received_at, OLD.stored_at)
    OR NEW.lease_generation < OLD.lease_generation OR NEW.receipt_count < OLD.receipt_count
    OR NEW.last_received_at < OLD.last_received_at OR NEW.processing_attempts < OLD.processing_attempts
    OR NEW.tombstone_expires_at < OLD.tombstone_expires_at
    OR (OLD.has_conflict AND NOT NEW.has_conflict)
    OR (OLD.payload_purged_at IS NOT NULL AND (
      NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at OR NEW.normalized_payload_ciphertext IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_EVENT_IDENTITY_OR_HISTORY_IMMUTABLE';
  END IF;
  IF NEW.state = 'PROCESSING' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
    IF NEW.lease_generation <> OLD.lease_generation + 1
      OR NEW.processing_attempts <> OLD.processing_attempts + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_LEASE_GENERATION_REQUIRED';
    END IF;
  ELSIF NEW.lease_generation <> OLD.lease_generation THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_UNEXPECTED_GENERATION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_event_guard();

-- Une seule occurrence de création, tant que son manifeste est conservé.
CREATE UNIQUE INDEX meta_receipt_new_event_key
  ON public.meta_webhook_receipt_items(endpoint_id, event_id) WHERE disposition = 'NEW';

CREATE FUNCTION public.meta_inbox_item_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE e public.meta_webhook_events%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.meta_inbox_lock_endpoint(NEW.endpoint_id);
  ELSE
    PERFORM public.meta_inbox_lock_endpoint(OLD.endpoint_id);
    IF TG_OP = 'DELETE' THEN
      PERFORM id FROM public.meta_webhook_receipts
        WHERE endpoint_id = OLD.endpoint_id AND id = OLD.receipt_id FOR UPDATE;
      IF OLD.expires_at > clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ITEM_RETENTION';
      END IF;
      RETURN OLD;
    END IF;
    IF ROW(NEW.id, NEW.endpoint_id, NEW.receipt_id, NEW.event_id, NEW.entry_index, NEW.change_index,
      NEW.item_index, NEW.collection, NEW.disposition, NEW.observed_content_digest, NEW.created_at,
      NEW.conflict_payload_expires_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.endpoint_id, OLD.receipt_id, OLD.event_id, OLD.entry_index, OLD.change_index,
      OLD.item_index, OLD.collection, OLD.disposition, OLD.observed_content_digest, OLD.created_at,
      OLD.conflict_payload_expires_at)
      OR NEW.expires_at < OLD.expires_at
      OR (OLD.payload_purged_at IS NOT NULL AND NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_ITEM_IDENTITY_IMMUTABLE';
    END IF;
  END IF;
  PERFORM id FROM public.meta_webhook_receipts
    WHERE endpoint_id = NEW.endpoint_id AND id = NEW.receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_RECEIPT_REQUIRED';
  END IF;
  SELECT * INTO e FROM public.meta_webhook_events
    WHERE endpoint_id = NEW.endpoint_id AND id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'META_EVENT_REQUIRED';
  END IF;
  IF (NEW.disposition IN ('NEW','DUPLICATE') AND NEW.observed_content_digest <> e.content_digest)
    OR (NEW.disposition = 'CONFLICT' AND (NEW.observed_content_digest = e.content_digest OR NOT e.has_conflict))
    OR (e.kind = 'INBOUND' AND NEW.collection <> 'messages')
    OR (e.kind = 'STATUS' AND NEW.collection <> 'statuses')
    OR (e.kind = 'PROVIDER_ERROR' AND NEW.collection <> 'errors') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_MANIFEST_EVENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meta_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_item_guard();

-- Relecture de la receipt finale, pas de l'image NEW initiale à zéro.
CREATE FUNCTION public.meta_inbox_check_manifest()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  p uuid; r uuid; parent public.meta_webhook_receipts%ROWTYPE;
  total bigint; fresh bigint; duplicates bigint; conflicts bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    p := OLD.endpoint_id;
    IF TG_TABLE_NAME = 'meta_webhook_receipts' THEN r := OLD.id; ELSE r := OLD.receipt_id; END IF;
  ELSE
    p := NEW.endpoint_id;
    IF TG_TABLE_NAME = 'meta_webhook_receipts' THEN r := NEW.id; ELSE r := NEW.receipt_id; END IF;
  END IF;
  SELECT * INTO parent FROM public.meta_webhook_receipts WHERE endpoint_id = p AND id = r FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF; -- purge entière dans la même transaction
  SELECT count(*), count(*) FILTER (WHERE disposition = 'NEW'),
    count(*) FILTER (WHERE disposition = 'DUPLICATE'), count(*) FILTER (WHERE disposition = 'CONFLICT')
    INTO total, fresh, duplicates, conflicts FROM public.meta_webhook_receipt_items
    WHERE endpoint_id = p AND receipt_id = r;
  IF parent.item_count NOT BETWEEN 1 AND 512 OR total <> parent.item_count
    OR fresh <> parent.new_count OR duplicates <> parent.duplicate_count OR conflicts <> parent.conflict_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_MANIFEST_INCOMPLETE';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER meta_receipt_complete
AFTER INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_manifest();
CREATE CONSTRAINT TRIGGER meta_item_complete
AFTER INSERT OR UPDATE OR DELETE ON public.meta_webhook_receipt_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_manifest();

-- Exigé à la création seulement : la purge ultérieure du manifeste reste possible.
CREATE FUNCTION public.meta_inbox_check_new_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.meta_webhook_events WHERE endpoint_id = NEW.endpoint_id AND id = NEW.id)
    AND (SELECT count(*) FROM public.meta_webhook_receipt_items
      WHERE endpoint_id = NEW.endpoint_id AND event_id = NEW.id AND disposition = 'NEW') <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'META_NEW_EVENT_OCCURRENCE_REQUIRED';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER meta_new_event_complete AFTER INSERT ON public.meta_webhook_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.meta_inbox_check_new_event();

COMMIT;
```

### Décisions de compatibilité à ne pas masquer

- UUID sans défaut SQL : tout INSERT hors Prisma doit fournir l’UUID. BIGSERIAL crée une seule nouvelle séquence possédée par la colonne ; nom et ACL à vérifier dans le catalogue futur.
- Un CHECK PostgreSQL accepte UNKNOWN : les contraintes ci-dessus emploient des tests IS NULL/IS NOT NULL explicites là où l’absence serait interdite. Les tests négatifs devront inclure toutes les combinaisons nullables, pas seulement les valeurs ordinaires.
- itemCount = 0 est admis pendant construction ; la contrainte différée impose 1..512 et les totaux réels au commit. Ne pas remplacer cette logique par un CHECK immédiat itemCount > 0.
- Le manifeste d’une receipt encore présente reste complet. La purge future doit supprimer tous ses items admissibles puis leur receipt **dans la même transaction**, sous endpoint/parents verrouillés ; les validations différées acceptent alors la disparition du parent. Pas de suppression partielle committée avec compteurs historiques inchangés.
- Une contradiction ne doit pas empêcher la purge d’un ciphertext après rétention : le CHECK autorise le couple référence nulle/purge datée. Un entrant EXPIRED ou conflictuelle reste bloquant ; son effacement automatique ne doit pas rouvrir les envois.
- Cas vérifié à la lecture du repository : une variante contradictoire reçue après purge d’un événement EXPIRED le remet en FAILED/reviewRequired avec payload original toujours absent. Le CHECK autorise donc aussi FAILED purgé sous revue, sans le rendre rejouable ; le claim actuel exclut FAILED et tout payload purgé. Un CHECK limité à PROCESSED/IGNORED/EXPIRED ferait échouer ce lot valide de conflit. Ajouter ce scénario aux futurs tests PostgreSQL.
- Les triggers de garde prennent des verrous, mais une instruction UPDATE/DELETE peut avoir déjà verrouillé sa ligne avant le trigger. Ils ne peuvent pas réordonner rétroactivement ces acquisitions. Les chemins applicatifs et les futures purges doivent prendre explicitement l’endpoint avant leurs lignes ; tester aussi les deadlocks et refuser les écritures SQL improvisées hors protocole.
- Le SQL ne valide pas une signature, ne calcule pas le HMAC et ne garantit pas qu’un digest correspond au plaintext. Seule l’acceptation authentifiée avec ses clés vérifiées peut alimenter les tables via les rôles prévus.
- Les dates techniques sont TIMESTAMPTZ(3), les dates métier historiques restent TIMESTAMP(3). Aucun ALTER implicite : préciser UTC aux frontières Prisma et tester les conversions/arrondis, les offsets et les horloges divergentes.
- L’index partiel mono-périmètre empêche deux endpoints simultanément activés, mais ne suffit pas à drainer un ancien périmètre désactivé. Une bascule doit traiter ses événements ouverts et interdire toute coexistence des senders ; les tables métier restent globales.
- Ces CHECK sont volontairement compatibles avec les champs historiques conservés lors des transitions (failedAt, uncorrelatedSince, effectOutcome). Ils ne prétendent pas imposer toute la machine d’états ou toutes les autorisations de revue. Les champs targetKind/id restent des indices, pas un registre d’autorisation.

## 5. STOP, envoi externe et tests de concurrence préparés

Les tests ci-dessous sont des spécifications de futurs tests PostgreSQL multi-connexions avec **transport local simulé**, non créés ni exécutés maintenant. Utiliser des barrières déterministes entre opérations, pas des sleep destinés à gagner une course. Les mocks actuels sérialisent artificiellement les transactions ; 355 tests isolés ne prouvent pas ces garanties.

### Protocole nécessaire avant activation

Une simple vérification avant fetch puis commit laisserait une course. Le coordinateur proposé détient une porte advisory de session sur une connexion physique dédiée, de la dernière vérification jusqu’à la soumission contrôlée et à l’enregistrement sûr du résultat. La réception doit prendre la même porte en transaction **avant** endpoint FOR UPDATE, puis les flux triés, puis les lignes. Toutes les entrées d’envoi et les mutations administratives pertinentes doivent respecter cet ordre ou une exclusion équivalente. Le repository actuel ne possède pas encore cette porte de session ; cette migration de stockage ne la fournit pas.

Ne pas prendre le verrou de session par des appels Prisma racine dispersés dans un pool. Un pooler transactionnel ne conserve pas nécessairement la session. Ne pas ouvrir une transaction Prisma 5 s autour d’un HTTP long. Une connexion dédiée utilisée pour porter la porte ne doit pas être redemandée au même pool saturé par le travail qu’elle protège : réserver sa capacité et tester la famine/les timeouts.

La frontière logique est l’engagement local exclusif de soumission, pas l’arrivée physique au fournisseur. Un STOP **durablement accepté avant cette frontière** doit bloquer le dispatch concerné. Des octets de webhook arrivés sur un autre serveur mais pas encore authentifiés/committés ne donnent pas cet ordre global. Un appel réseau déjà engagé ne peut être rappelé par un verrou SQL. La perte de session peut libérer la porte alors qu’un HTTP demeure en vol : annulation conservatrice, résultat incertain et aucun renvoi automatique ; le verrou ne fence pas Meta.

| Test futur et points de synchronisation | Résultat exigé | Limite explicite |
|---|---|---|
| STOP avant réservation : transaction d’acceptation committée ; suspendre son worker ; lancer le sender mock | Barrière fermée, aucun POST mock, aucune tentative/réservation consommée par ce report. | Le test porte sur STOP durable, pas seulement reçu physiquement. |
| STOP pendant réservation : sender suspendu avant/après CAS, réception concurrente sur autre connexion | Ordre déterminé par la porte ; si STOP committé en premier, pas de dispatch. Une réservation n’est pas un permis exportable. | Aucun rollback SQL ne peut annuler un POST déjà effectué. |
| STOP avant soumission : suspendre le sender après sa dernière lecture mais avant la frontière ; lancer ingestion | Montrer l’absence de gap lecture/libération/fetch : l’un attend l’autre. ACK du STOP seulement après son propre commit. | Un STOP attendant la porte n’est pas encore accepté durablement. |
| STOP pendant réseau : transport mock bloqué après engagement ; réception concurrente | Envoi déjà engagé non rappelé ; STOP bloque les suivants après acceptation ; aucune seconde soumission sur timeout. | Impossible de garantir « aucun message après réception physique d’un STOP » dans ce cas. |
| Arrêt du worker inbox avant/après effet et avant/après commit | Effets métier + marquage tous annulés ou tous committés ; reprise sans second consentement/réponse. | Un process tué avant lecture du résultat de commit ne sait pas si le commit a réussi. |
| Arrêt du sender après claim, après frontière et avant retour HTTP | État incertain/procédure de réconciliation ; aucun passage automatique à une nouvelle tentative POST. | Une base et une API externe ne partagent pas une transaction atomique. |
| Reprise après interruption : ancien propriétaire libéré tardivement, nouveau token/génération | Ancien fence refusé ; un seul effet SQL et marquage valide ; contrôler clock_timestamp après attente du verrou. | Pas de preuve avec horloge du mock ou updatedAt seul. |
| Doublons multi-processus, dans un lot et entre versions de clés | Une identité, occurrences conservées, un seul effet ; contradiction en revue ; aucun succès ACK avant commit. | Unique avec lookupKeyVersion seul insuffisant sans protocole inter-version commun. |
| Callback sans cible, précoce/tardif, après redémarrage | UNCORRELATED durable ; wake exact/balayage ; transition monotone après preuve certaine. | Sans ID commun vérifiable, reste non résolu ; jamais corrélation par numéro/heure ni nouvel envoi. |
| Perte de session advisory et timeout réseau simultanés | Arrêt conservateur, absence de re-POST, quarantaine/réconciliation ; vérifier tous les senders. | Abort du client ne prouve pas que Meta n’a pas accepté. |
| Takeover/STOP administration pendant préparation d’envoi | Même coordination ; relecture des autorisations courantes ; aucune fenêtre de contournement. | La nouvelle inbox n’isole pas automatiquement les chemins administratifs existants. |

Préparer aussi : blocage d’un entrant FAILED/EXPIRED/flux inconnu ; lot multi-flux et ordre de locks ; saturation du pool ; perte du signal wake puis balayage ; cible supprimée ; callback READ/CANCELLED ; anciennes tentatives ; droits SQL/PUBLIC ; rollback du trigger différé et purge de manifeste ; restauration sans clés anciennes. Chaque test doit vérifier les lignes et compteurs après commit avec des connexions indépendantes.

## 6. Risques et points à approuver

1. **STOP/envoi bloquant :** aucune implémentation/validation de coordination réelle fournie par le DDL. Interdire la bascule asynchrone avec senders actifs jusqu’à preuve dédiée.
2. **SQL non exécuté :** fonctions PL/pgSQL, triggers différés, contraintes nullables, comportement Prisma et plans de requête restent des candidats. Toute erreur observée ultérieurement impose arrêt et diagnostic.
3. **Divergence Provider* :** migrations/clients futurs doivent employer un périmètre explicite ; le schéma principal reste en avance sur l’historique pour Gupshup. Pas de suppression ou fausse résolution.
4. **Débit :** verrou d’endpoint global, contrôle différé par receipt et recherche des clés anciennes peuvent coûter cher sous lots concurrents. Mesurer tailles maximum et charge de purge ; ne pas supprimer les contraintes pour gagner du débit.
5. **Rétention :** dépendances RESTRICT et événements STOP bloquants imposent revue et quotas. Les triggers protègent la cohérence, pas un calendrier complet de purge/restauration ni un système opérateur de résolution.
6. **Comptes :** nouvel endpoint indépendant techniquement, mais conversations/IDs métier globaux. Première activation mono-périmètre ; aucune promesse multi-WABA.
7. **Confidentialité :** IDs Meta/HMAC pseudonymes ; ciphertext et clés requièrent sauvegardes/rotation coordonnées. Pas de secrets/signatures/brut HTTP dans les modèles ou logs. La purge en ligne ne supprime pas immédiatement les backups.
8. **Schéma SQL étendu :** CHECK/triggers/index partiel non entièrement visibles par Prisma. Conserver des assertions de catalogue et une revue de futurs diffs pour prévenir leur suppression ou conflit.

## 7. Procédure de sauvegarde proposée — à autoriser et exécuter plus tard

1. Confirmer la cible explicite, rôle, port dédié et data_directory, sans valeurs de secrets dans les journaux. Arrêter contrôlément les traitements et bloquer les activations ; ne pas purger une inbox pour faciliter une sauvegarde.
2. Relever empreintes du schéma, des migrations approuvées, version du client, état réel de `_prisma_migrations`, inventaire des tables/contraintes/index et écarts de schéma. Arrêt si historique divergent ou objets Meta préexistants incompatibles.
3. Sauvegarde logique cohérente de **la base dédiée complète**, y compris métier/inbox, historique Prisma et valeurs de séquence ; inventaire séparé des rôles/ACL et configuration, sans exposer de mots de passe. Utiliser des outils PostgreSQL compatibles déjà installés et des secrets en mémoire/stockage protégé, jamais dans une URL de commande affichée. Ne pas inclure toutes les bases par défaut.
4. Conserver séparément et sous contrôle les versions de clés d’encryption/HMAC indispensables, le code/client et les artefacts de release. Une copie sans clé ne permet pas de reprendre les payloads chiffrés.
5. Vérifier empreinte, lisibilité et contenu de l’archive puis faire un essai de restauration dans une cible jetable **expressément autorisée**, senders désactivés et réseau fournisseur bloqué. Ne jamais restaurer automatiquement par-dessus la cible active.
6. Documenter emplacement restreint, durée de conservation, propriétaire, procédure d’accès, RPO/RTO constatés et intervalle éventuellement perdu. Ne pas promettre RPO nul à partir d’un dump logique.

Aucun dump, accès serveur, fichier de secret ou sauvegarde PostgreSQL réalisé par cette intervention.

## 8. Procédure de validation proposée

### Revue hors base avant toute opération

- Vérification textuelle effectuée pendant cette mission : quatre blocs Prisma et quatre CREATE TABLE, **86 colonnes scalaires correspondantes**, quatre références FK toutes internes à Meta, sept fonctions et sept triggers. Absence de placeholder, de DDL Provider*, de DROP/TRUNCATE/GRANT/REVOKE/seed dans le SQL proposé ; longueur des noms d’objets contrôlée. Ce contrôle n’a chargé aucun client Prisma et n’a pas analysé/exécuté le SQL avec PostgreSQL.
- SHA-256 UTF-8 du contenu exact du bloc SQL (entre les délimiteurs Markdown, hors délimiteurs) : `709c4a31500a15d833a62999352fc640f3e741d9ab2d665f520978a7219d7f32`. Les empreintes du schéma source, de la copie générée et du manifeste des 44 migrations sont inchangées à la vérification finale.
- Approuver la liste fermée : 4 CREATE TABLE Meta, 1 séquence implicite, index/contraintes/fonctions/triggers Meta ; aucun objet Provider*, métier, extension, GRANT ou seed d’activation.
- Relire les quatre blocs Prisma, le SQL et leur correspondance champ par champ. Vérifier les noms SQL < 64 octets, les bornes UTF-8 et les defaults application/SQL.
- Revue du trigger de manifeste sur INSERT/UPDATE/DELETE, purge totale d’une receipt et création d’événement sans occurrence NEW ; comparer ses contraintes au repository actuel. Ne pas appeler une revue textuelle une validation PL/pgSQL.
- Autoriser séparément la modification du schéma, création de migration et génération locale. Ne pas lancer les commandes interdites dans cette mission.

### Validation PostgreSQL future sous autorisation distincte

1. Précontrôle identité/versions/host/port/base/rôle/data_directory/historique et sauvegarde vérifiée. Aucun port 5432. Inventorier les objets présents : ne pas présumer que les six tables Provider* sont absentes dans la base réelle.
2. Appliquer seulement le SQL approuvé dans une transaction ; erreur → rollback complet et arrêt. Pas de reset, réparation automatique ou modification des migrations historiques. Ne pas exécuter directement un extrait Markdown comme procédure de production.
3. Contrôler pg_catalog : types/defaults, séquence et ownership, FK et actions RESTRICT, contraintes validées, triggers activés/différables, index uniques/partiels ; comparer aux empreintes et au périmètre attendu. Vérifier qu’aucun endpoint n’a été activé.
4. Tester négativement chaque contrainte, y compris NULL, faux scope, receipt vide/incomplète, événement sans NEW, changements d’identité/génération et purge trop précoce. Tester les transactions complètes attendues et la purge admissible.
5. Générer/valider le client seulement dans l’étape autorisée ; vérifier delegates Meta et compatibilité des 69 modèles historiques, même tx/fencing et date UTC. Auditer les permissions minimales séparément ; ne pas copier les droits d’un migrateur vers le worker.
6. Exécuter la matrice de concurrence avec vrais commits/rollbacks et transport mock ; EXPLAIN et contention. Les 14 tests historiques demandent leur propre autorisation et un nettoyage ciblé adapté, jamais un reset.
7. Constater les tables métier et migrations inchangées hors nouvel historique approuvé. Les anciens fichiers restent à la même empreinte ; une nouvelle migration ne peut pas être présentée comme l’une des 44 historiques.
8. Ne raccorder ensuite le webhook qu’après accord distinct, single writer métier, commit avant ACK et senders d’abord arrêtés. Activation réelle/Meta : dernière autorisation séparée.

## 9. Procédure de retour arrière proposée

**Avant commit DDL :** ROLLBACK de la transaction de migration ; vérifier absence des nouveaux objets et l’état du système. Ne pas improviser une reprise si le résultat du commit est inconnu : inspecter sous autorisation.

**Après commit mais avant tout événement accepté :** arrêter nouveaux composants, conserver le chemin historique. Option privilégiée : laisser les tables Meta vides et désactivées ; le vieux code n’en dépend pas. Un retrait physique exigerait une migration compensatrice distincte revue, vérifiant l’absence de données et supprimant uniquement les dépendances Meta dans l’ordre items → receipts/events → endpoints, triggers/fonctions et séquence possédée. Aucun DROP fourni ou exécuté ici. Ne jamais éditer/supprimer une migration déjà appliquée ou son historique pour simuler ce retrait.

**Après acceptation d’événements :** désactiver traitement et envois de façon coordonnée, préserver inbox, tombstones, clés et sauvegardes. Ne pas revenir à une ancienne voie qui ignorerait des événements déjà acquittés. Réconcilier les événements ouverts, consentements et envois incertains avant reprise. Le retour applicatif n’est pas un rollback des consentements et ne doit pas rejouer des POST.

**Restauration d’une sauvegarde :** procédure de dernier recours séparément autorisée ; restaurer d’abord en quarantaine et évaluer les événements perdus depuis le point de sauvegarde, les callbacks tardifs et les envois déjà acceptés par Meta. Une restauration DB ne retire pas un message livré et peut réintroduire une autorisation antérieure à STOP : senders bloqués jusqu’à réconciliation vérifiée. Aucun retour arrière n’offre exactement-une-fois réseau.

## 10. Point d’arrêt

SQL et modifications Prisma **proposés seulement dans ce rapport**. Aucun fichier dans prisma/migrations, aucun changement de schema.prisma, aucune génération ni opération PostgreSQL. Les composants Gupshup sont conservés.

Attendre une autorisation distincte avant toute modification du schéma, création/application de migration, génération du client, test PostgreSQL ou activation. Les deux blocages restent ouverts : coordination STOP/réseau et réconciliation explicite de l’écart Provider*.
