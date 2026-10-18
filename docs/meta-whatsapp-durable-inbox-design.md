# NVA — Conception d’une inbox durable Meta WhatsApp Cloud API

Date : 16 octobre 2026. **Conception uniquement.** Aucun code, schéma, migration, configuration ou base modifié. Les 302 tests isolés sont le résultat historique de la consolidation ; aucun test exécuté ici.

## 1. Décision et périmètre

Créer une inbox technique dédiée à Meta, indépendante des modèles Provider* et des composants Gupshup. Les tables WhatsApp existantes continuent de représenter les conversations, messages, consentements et livraisons ; elles ne deviennent pas un stockage de webhooks arbitraires.

La réception HTTP authentifiée, le traitement de l’inbox et l’envoi sortant sont trois responsabilités distinctes. Le worker d’inbox ne possède aucun transport Meta et n’appelle jamais sendTextMessage/sendTemplateMessage : il peut produire une réponse QUEUED par le service conversationnel existant, mais seul le circuit sortant autorisé peut l’envoyer.

Proposition : **quatre nouveaux modèles Prisma**, décrits ci-dessous sans les déclarer dans schema.prisma : MetaWebhookEndpoint, MetaWebhookReceipt, MetaWebhookEvent, MetaWebhookReceiptItem. Les quatre sont nécessaires pour séparer le périmètre de confiance, l’acceptation atomique d’un lot, l’identité dédupliquée d’un événement et les occurrences/variantes de cet événement dans plusieurs lots. Aucun registre de tentatives d’envoi, modèle de messages ou table d’alias Gupshup n’est introduit dans cette proposition.

Garanties visées après implémentation/migration/tests autorisés :

- Un HTTP 200 d’acceptation signifie que **tous les éléments acceptés du lot** sont durables, ou que leur tombstone durable existe déjà ; pas qu’ils sont appliqués au métier.
- Reprise au moins une fois, avec effets métier idempotents et statuts monotones ; aucune promesse d’exactement une fois de bout en bout.
- Conservation des callbacks non corrélés dans les limites de rétention approuvées.
- Aucune corrélation par numéro, texte ou proximité temporelle ; identifiants Meta natifs conservés exactement.

Ne sont pas garantis : réception d’un événement que Meta n’a jamais présenté avec succès, rétention infinie, corrélation sans preuve commune, ordre chronologique réel des événements fournisseur, rappel d’un message déjà transmis, absence de perte lors d’une destruction de stockage sans restauration adaptée.

## 2. État du code audité et frontières à préserver

Références locales : docs/meta-whatsapp-consolidation-report.md et les services actuels.

| Composant | État actuel | Évolution future nécessaire |
|---|---|---|
| whatsappWebhookService.createWebhookReceiver | Signature sur octets bruts, validation du lot, WABA et Phone Number ID ; appelle ensuite processPayload | Après validation, appeler l’acceptation transactionnelle d’inbox, sans effet métier synchrone. |
| whatsappWebhookController.receive | HTTP 503 si non corrélé/non pris en charge | Après migration et bascule autorisée : 200 dès commit intégral, même si traitement différé ; erreurs d’acceptation restent non acquittées. |
| whatsappConversationService.processInboundMessage | Ouvre sa propre transaction Serializable avec retries ; message entrant, moteur, consentement et réponses dans cette transaction | Extraire un exécuteur transactionnel réutilisable, en conservant le wrapper public et toutes ses décisions. Ne pas imbriquer simplement deux $transaction. |
| whatsappDeliveryPolicy.applyDeliveryStatus | CAS, monotonie, résultat détaillé applied/ignored/uncorrelated/invalid | Utiliser le modèle du client transactionnel pour pouvoir coordonner statut et marquage d’inbox. |
| Trois applyStatus métier | Corrélation native puis clé locale ; API booléenne et detailed | Ajouter un chemin technique ciblé transactionnel, sans modifier les transitions ni les règles d’envoi. |
| whatsappWorkerControl | Envoi désactivé sans opt-in ; refus en environnement de test | Préserver ce verrou ; ajouter ultérieurement une activation distincte et désactivée par défaut pour l’inbox. |

Les modèles existants ont des clés globales : numéro unique de conversation et identifiants uniques par table de messages/livraisons. **L’isolation des nouvelles tables ne rend pas le moteur multi-compte.** Première activation : un seul périmètre métier NVA WABA/numéro/environnement dans ces tables. Plusieurs comptes indépendants nécessiteraient une autre étude et autorisation.

## 3. Architecture proposée

```text
POST /webhooks/whatsapp
  → limites de taille/encodage ; capture du corps et de l’heure locale de réception
  → canal et périmètre autorisés ; HMAC ; validation intégrale du lot et du compte
  → découpage des éléments ; identité sémantique ; minimisation ; chiffrement
  → transaction : receipt + events dédupliqués + receiptItems/variantes
  → commit intégral confirmé → HTTP 200

Worker inbox, explicitement autorisé
  → réservation courte avec bail/token/génération
  → transaction d’effet : vérification du bail + sérialisation de flux
  → service métier existant avec client transactionnel
  → résultat appliqué/ignoré/non corrélé/échoué + marquage inbox
  → commit

Sender NVA existant, séparément autorisé
  → protections actuelles + barrière technique des entrants en attente
  → réservation/consentement/contrôle humain/fenêtre/backoff inchangés
  → transport Meta
```

Le GET de vérification ne crée aucune receipt et n’est pas une preuve d’authentification d’un POST. Les corps non authentifiés, comptes incorrects et lots invalides sont refusés sans stockage du corps. Le champ app/compte contenu dans le JSON ne sélectionne jamais seul le secret ou le périmètre autorisé.

Un événement bien formé mais non pris en charge peut être **accepté durablement pour revue**, sans être appliqué. Cela doit être distinct d’un événement malformé, qui fait refuser le lot entier avant insertion. Le contrat initial reste limité aux enveloppes messages avec WABA/Phone Number ID validés ; pas d’ouverture automatique de nouveaux abonnements.

## 4. Modèles Prisma proposés

Ces dictionnaires sont destinés à une future traduction Prisma et migration SQL, **pas à une application immédiate**. Conventions : PK UUID générées par l’application, identifiants Meta en String exactes, instants techniques DateTime @db.Timestamptz(3), Bytes pour HMAC/ciphertext, BigInt pour compteurs/générations volumineux, suppression explicite. Aucun token ou secret dans les modèles.

### 4.1 MetaWebhookEndpoint — périmètre de confiance

Table proposée : meta_webhook_endpoints.

| Champ | Type Prisma / SQL | Usage |
|---|---|---|
| id | String UUID PK | Identité interne immuable. |
| environment | String VARCHAR(16) | test/staging/production ; jamais fourni librement par le webhook. |
| applicationKey | String VARCHAR(64) | Clé interne stable non secrète. |
| metaAppId | String VARCHAR(64) | ID Meta applicatif attendu, issu de configuration contrôlée. |
| wabaId / phoneNumberId | String VARCHAR(64) | Identifiants natifs exacts ; chiffres, pas conversion en Number. |
| inboxEnabled / processingEnabled | Boolean DEFAULT false | Acceptation et traitement indépendants, soumis aussi aux contrôles de configuration. |
| normalizationVersion | Int SMALLINT | Projection de payload connue. |
| identityVersion | Int SMALLINT | Convention d’identité de l’événement. |
| lookupKeyVersion | String VARCHAR(64) | Référence de version de clé HMAC, aucun matériau secret. |
| streamKeyVersion | String VARCHAR(64) | Version de la clé d’ordonnancement, distincte du lookup et stable pendant la vie des flux ouverts. |
| createdAt / disabledAt | DateTime / DateTime? | Audit technique. |

Uniques : (environment,applicationKey), (environment,metaAppId,wabaId,phoneNumberId). L’identité de compte ne peut pas être réétiquetée après première réception : créer un nouveau périmètre pour une bascule. CHECK des valeurs autorisées, formats numériques et versions positives ; immutabilité via repository et garantie SQL à concevoir dans la migration. Pas de colonne de secret HMAC Meta ; les références de configuration ne suffisent pas à autoriser une activation.

### 4.2 MetaWebhookReceipt — acceptation d’une requête complète

Table proposée : meta_webhook_receipts. Une ligne par requête **acceptée** ; une nouvelle présentation peut donc créer une nouvelle receipt sans créer de nouvel événement.

| Champ | Type | Usage |
|---|---|---|
| id / endpointId | UUID PK / UUID FK | Périmètre validé au bord HTTP. |
| receivedAt / storedAt | DateTime | Arrivée locale fiable / date serveur de stockage ; ne remplacent jamais le temps Meta. |
| requestDigest | Bytes, 32 octets | HMAC technique des octets reçus, sans persister le corps ni la signature. |
| digestKeyVersion | String VARCHAR(64) | Résolution de la clé nécessaire à la vérification du digest. |
| authenticationKeyVersion | String VARCHAR(64) | Version opaque du secret applicatif réellement vérifié, jamais sa valeur. |
| requestBytes | Int | Contrôle de volumétrie, borne existante 1 MiB. |
| itemCount / newCount / duplicateCount / conflictCount | Int | Résumé de ce qui est durable dans cette transaction. |
| expiresAt | DateTime | Échéance de purge technique, prolongée selon les dépendances. |

Relation Endpoint ; unique (endpointId,id) pour les FK composites. Index (endpointId,storedAt,id), (expiresAt,id) et éventuellement (endpointId,requestDigest) non unique pour diagnostic. **Ne pas dédupliquer les effets sur le hash d’une requête entière** : les lots peuvent changer de découpage ou d’ordre.

Une receipt n’a pas d’état « métier traité » : l’état appartient aux événements. L’existence de la ligne committée prouve l’acceptation de son manifeste, pas l’émission effective de la réponse HTTP au fournisseur. CHECK : compteurs >= 0 et somme new+duplicate+conflict=itemCount. Le nombre réel de receiptItems est vérifié dans la transaction, et par contrainte différée/contrôle d’intégrité à décider lors de la migration ; un CHECK ne compte pas seul les lignes d’une autre table.

### 4.3 MetaWebhookEvent — unité durable de traitement et tombstone

Table proposée : meta_webhook_events.

| Champ | Type | Usage |
|---|---|---|
| id / endpointId | UUID PK / UUID FK | Identité interne et périmètre. |
| enqueueOrder | BigInt, séquence DB unique | Ordre technique de file, pas une date ni un ordre Meta. |
| kind | String VARCHAR(24) | INBOUND, STATUS, PROVIDER_ERROR, UNSUPPORTED. |
| nativeMessageId | String? VARCHAR(512) | ID Meta exact, sans préfixe/reconstruction Gupshup ; nul pour certains événements techniques. |
| nativeStatus | String? VARCHAR(64) | Valeur fournisseur ; interprétation limitée aux statuts connus. |
| occurredAt / occurredAtSource | DateTime? / String? VARCHAR(32) | Temps Meta facultatif et provenance/unité. |
| identityVersion / lookupKeyVersion | Int SMALLINT / String VARCHAR(64) | Convention et clé d’identité versionnées. |
| identityKey / contentDigest | Bytes, 32 octets chacune | HMAC d’identité distinct du HMAC de projection pertinente. |
| correlationKeyHash | Bytes?, 32 octets | Index d’une clé locale explicite si fournie ; valeur exacte dans le payload chiffré. |
| streamKey | Bytes?, 32 octets | HMAC du périmètre/expéditeur entrant, uniquement pour ordonnanceur/barrière ; pas une preuve de corrélation d’une livraison. |
| streamKeyVersion | String? VARCHAR(64) | Version nécessaire pour retrouver le même flux et le même verrou. |
| firstReceivedAt / lastReceivedAt / storedAt | DateTime | Dates locales immuables/actualisées de réception. |
| receiptCount | BigInt DEFAULT 1 | Occurrences acceptées, pas compteur d’effets. |
| normalizedPayloadCiphertext | Bytes? | Projection minimale suffisante au handler retenu, chiffrée. |
| encryptionKeyVersion / normalizationVersion | String? VARCHAR(64) / Int SMALLINT | Déchiffrement et interprétation versionnés. |
| state | String VARCHAR(32) | États décrits en section 5. |
| effectOutcome / reasonCode | String? VARCHAR(32) / String? VARCHAR(100) | APPLIED, DUPLICATE, NONE ; raison sur liste fermée. |
| processingAttempts / consecutiveFailures | Int DEFAULT 0 | Compteurs techniques séparés des tentatives d’envoi. |
| nextAttemptAt | DateTime? | Reprise planifiée, pas un scheduledFor métier. |
| leaseToken / leaseOwner / leaseExpiresAt | UUID? / String? VARCHAR(64) / DateTime? | Bail de worker. |
| leaseGeneration | BigInt DEFAULT 0 | Fence croissant, jamais remis à zéro. |
| processedAt / failedAt / uncorrelatedSince | DateTime? | Dates des résultats. |
| targetKind / targetId / observedAttempt | String? VARCHAR(16) / Int? / Int? | Repères techniques du message/livraison trouvé ; **indices d’audit**, jamais autorisation de réutiliser ce lien. |
| hasConflict / reviewRequired | Boolean DEFAULT false | Détection durable d’un même événement au contenu contradictoire. |
| payloadExpiresAt / tombstoneExpiresAt | DateTime | Deux rétentions distinctes. |
| payloadPurgedAt | DateTime? | Purge réellement effectuée, pas supposée à l’échéance. |

Uniques : (endpointId,id), (endpointId,identityVersion,lookupKeyVersion,identityKey). L’unique nativeMessageId seule serait **incorrecte** : un même message sortant produit plusieurs statuts et les variantes temporelles ne doivent pas être écrasées.

targetKind/targetId n’introduisent pas de FK vers une table métier polymorphe. Cela évite des relations inverses et des blocages de suppression métier pour ce seul repère ; le handler doit relire/vérifier la cible à chaque traitement. Une cible disparue ne rend jamais admissible une association heuristique. Les identifiants internes restent soumis aux contrôles applicatifs et aux CHECK de cohérence de kind/id.

Index proposés :

- Partiel (endpointId,nextAttemptAt,enqueueOrder,id) pour READY/RETRY_WAIT/UNCORRELATED éligibles.
- Partiel (endpointId,leaseExpiresAt,id) pour PROCESSING.
- (endpointId,streamKey,enqueueOrder,id) pour ordonnancement des entrants et blocage des envois.
- Partiels (endpointId,nativeMessageId) et (endpointId,correlationKeyHash) pour UNCORRELATED.
- (endpointId,state,firstReceivedAt,id) pour exploitation ; (payloadExpiresAt,id), (tombstoneExpiresAt,id) pour rétention.

CHECK obligatoires : états/kinds/outcomes fermés, compteurs non négatifs, empreintes de 32 octets, versions positives ; bail complet seulement en PROCESSING et génération > 0 ; payload et référence de clé requis pour tout traitement réexécutable ; résultat/date cohérents pour PROCESSED/IGNORED/FAILED/EXPIRED ; STATUS exige identifiant/statut exploitables ; rétention du tombstone >= rétention du contenu. Les CHECK/index partiels devront être explicités en SQL dans une future migration ; un schéma Prisma seul ne suffit pas.

### 4.4 MetaWebhookReceiptItem — manifeste, occurrences et variantes

Table proposée : meta_webhook_receipt_items.

| Champ | Type | Usage |
|---|---|---|
| id / endpointId / receiptId / eventId | UUID PK / UUID / UUID / UUID | Liens techniques, même périmètre aux deux extrémités. |
| entryIndex / changeIndex / itemIndex | Int | Position dans le lot, jamais utilisée comme identité de l’événement. |
| collection | String VARCHAR(16) | messages/statuses/errors. |
| disposition | String VARCHAR(16) | NEW, DUPLICATE, CONFLICT. |
| observedContentDigest | Bytes, 32 octets | Empreinte de la projection reçue cette fois. |
| conflictPayloadCiphertext / encryptionKeyVersion | Bytes? / String? VARCHAR(64) | Variante contradictoire seulement, chiffrée et isolée du handler automatique. |
| createdAt / expiresAt | DateTime | Audit et purge dépendante. |

FK composites (endpointId,receiptId) → Receipt(endpointId,id) et (endpointId,eventId) → Event(endpointId,id), onDelete/onUpdate RESTRICT. Unique (endpointId,receiptId,entryIndex,changeIndex,collection,itemIndex) ; index (endpointId,eventId,createdAt), (expiresAt,id). CHECK positions >= 0 ; digest 32 octets ; CONFLICT exige ciphertext/version et interdit tout traitement métier de cette variante.

Le manifeste relie chaque élément accepté à son événement, même en cas de doublon dans le même lot. Une variante contradictoire n’écrase pas l’original : elle reste conservée pour revue, et le lot n’est acquitté qu’après sa conservation. Une répétition du même conflit peut créer une nouvelle occurrence ; quota/limite de taille et rétention bornent cette volumétrie. Un afflux dépassant les capacités doit être refusé avant acquittement, pas transformé en perte silencieuse.

## 5. États et sens exact des résultats

| État | Sens | Reprise |
|---|---|---|
| RECEIVED | Accepté durablement, pas encore validé par le dispatcher versionné. | Dispatcher, même worker ou étape locale. |
| READY | Contrat connu et traitement autorisé en attente. | Réservation à échéance. |
| PROCESSING | Réservé avec bail et fence. | Propriétaire actuel ; reprise si expiration. |
| UNCORRELATED | Callback valide sans cible certaine. | Réveil exact + balayage jusqu’à rétention. |
| RETRY_WAIT | Échec technique temporaire ; aucun succès métier confirmé. | Backoff technique borné. |
| PROCESSED | Résultat métier confirmé ou événement technique explicitement observé. | Terminal, sauf revue contrôlée distincte. |
| IGNORED | Décision explicite sans mutation métier : doublon, statut dominé, annulation. | Terminal, avec raison. |
| FAILED | Événement non pris en charge, conflit, échec permanent ou limite de retry. | Revue, pas boucle automatique. |
| EXPIRED | Contenu non disponible/expiration décidée avant résolution. | Pas de replay sans contenu ; tombstone conservé. |

Transitions principales : RECEIVED → READY/FAILED ; READY/RETRY_WAIT/UNCORRELATED à échéance → PROCESSING ; PROCESSING → PROCESSED/IGNORED/UNCORRELATED/RETRY_WAIT/FAILED. Un bail PROCESSING expiré peut être repris avec nouvelle génération ; une entrée au contenu expiré n’est jamais réservée. Toute reprise depuis FAILED exige une procédure autorisée et une trace d’exploitation ; aucune interface de réconciliation manuelle libre n’est incluse ici.

Le reçu HTTP et l’état métier ne sont pas confondus. Pour les compteurs : received = événements ou occurrences selon métrique nommée ; applied = mutations confirmées ; ignored = décisions sans effet ; unresolved = UNCORRELATED ; failed = échecs terminaux. Un doublon reconnu après crash peut terminer IGNORED/DUPLICATE sans affirmer qu’aucun effet historique n’a eu lieu. PROVIDER_ERROR peut terminer PROCESSED avec effectOutcome=NONE et raison OBSERVED_TECHNICAL_ERROR, jamais applied.

Un conflit met hasConflict/reviewRequired à true. Si l’événement est encore ouvert, il est gelé en FAILED et son bail invalidé transactionnellement. S’il avait déjà terminé, conserver son état/résultat historique et signaler la revue ; ne pas prétendre annuler un effet déjà committé. Le worker vérifie ce drapeau sous verrou avant effet ; la variante n’est jamais utilisée pour remplacer une décision antérieure.

## 6. Acceptation atomique et HTTP

1. Limites HTTP, corps brut et horodatage de réception ; HMAC valide et compte autorisé.
2. Valider **tout le lot**, y compris bornes des identifiants, types, tailles et nombre d’éléments ; aucun appel métier.
3. Décomposer les messages/statuts/erreurs ; produire identité et projection pertinente versionnées ; préparer le chiffrement. Échec de chiffrement : aucun acquittement.
4. Ouvrir une transaction courte, verrouiller les flux concernés dans un ordre déterministe, créer receipt et tous les items ; insérer ou résoudre les événements sur l’unique ; compter doublons et conflits atomiquement.
5. Vérifier le manifeste et commit ; retourner HTTP 200 vide seulement après confirmation.

Première implémentation proposée, adaptée au volume NVA à mesurer : verrouiller aussi la ligne Endpoint FOR UPDATE avant les verrous de flux, les recherches d’identité et les insertions. Cette sérialisation des acceptations d’un périmètre permet une recherche/association atomique même entre versions de clés. Revalider sous ce verrou les versions/configurations employées avant transaction ; si elles ont changé, annuler et repréparer, sans acquitter. Tous les récepteurs doivent connaître la même liste de clés historiques encore nécessaires ; une version manquante interdit l’acceptation plutôt que créer des doublons. Le coût est un débit d’acceptation limité par endpoint : mesurer la contention, et ne remplacer ce verrou par une stratégie plus fine qu’avec preuve de déduplication inter-version.

Échec DB, erreur d’un élément, indisponibilité de clé ou capacité insuffisante : rollback complet et réponse non 2xx adaptée ; aucun fallback fichier/Map. Commit potentiellement réussi mais réponse perdue : le lot pourra revenir ; les uniques d’événements neutralisent le double effet, la nouvelle receipt décrit la nouvelle occurrence. Ne pas marquer « HTTP envoyé » comme une preuve que le fournisseur l’a reçu.

Après ce futur raccordement, un callback UNCORRELATED déjà durable ou un élément unsupported admis pour revue **ne provoque plus 503 à lui seul**. La réponse reconnaît la réception, et non le résultat du worker. Ce changement n’est applicable qu’après existence et validation réelle du stockage ; le comportement consolidé actuel reste inchangé aujourd’hui.

## 7. Identité et idempotence

### Identité sémantique, pas position ni hash de lot

| Kind | Tuple canonique d’identité v1, dans le périmètre endpoint |
|---|---|
| INBOUND | kind + ID Meta entrant natif. Ni date de réception ni position dans le tableau. |
| STATUS | kind + ID Meta sortant natif + statut natif + timestamp fournisseur exact normalisé, ou marqueur absent fixe. |
| PROVIDER_ERROR | kind + identifiants/temps réellement disponibles + projection technique canonique ; sans identifiant distinct fiable, adresser par contenu et conserver les occurrences sans déduire une livraison. |
| UNSUPPORTED | En-tête d’événement/ID natif s’il existe ; sinon projection minimale canonique adressée par contenu. Aucun effet métier automatique. |

Les objets sont canonicalisés avec clés triées, types/encodage explicites et limites de profondeur. Le HMAC d’identité utilise une clé de lookup dédiée ; ce n’est pas le secret Meta ni une nouvelle signature fournisseur. Les IDs natifs ne sont ni tronqués, ni lowercasés, ni décodés/réencodés en identifiants Gupshup. Toute borne dépassée fait refuser l’admission avant acquittement.

Le contentDigest porte sur les données **pertinentes pour le handler** : expéditeur/type/texte ou titre interactif/timestamp pour un entrant ; ID/statut/timestamp/clé de corrélation et codes d’erreur exploités pour un statut. Ne pas traiter un changement de prix ou autre métadonnée non utilisée comme une nouvelle autorisation métier. L’enrichissement de champs pertinents exige une règle versionnée ; pas de fusion arbitraire.

Même identité + même projection : incrémenter receiptCount, enregistrer l’occurrence, ne pas réveiller un état terminal, conserver les premières dates et le payload initial. Même identité + projection contradictoire : variante chiffrée et conflit explicite. Un statut dont le timestamp change peut former une autre identité ; la politique monotone métier doit encore neutraliser les doubles effets.

Pour les erreurs sans ID, on ne peut pas distinguer parfaitement deux occurrences indépendantes au contenu identique : le manifeste conserve leurs occurrences et aucune action de livraison n’est déduite du seul regroupement. Un même hash n’est pas une preuve de causalité.

### Versions et rotation des clés

L’unique inclut lookupKeyVersion pour permettre une rotation contrôlée ; cela ne suffit pas à dédupliquer entre versions. À la réception, chercher les clés d’identité dérivées de **toutes les versions encore actives pour la fenêtre de tombstones** avant de créer sous la version courante. Garder les anciennes clés jusqu’à expiration des entrées correspondantes, ou effectuer un rekey transactionnel autorisé et vérifié. Sinon une rotation fabriquerait de nouveaux événements pour des doublons anciens. Ne pas changer identityVersion/normalizationVersion sans stratégie de compatibilité et tests de replay.

Comparer aussi les contentDigest avec la **même version de clé que l’événement retrouvé** : calculer la projection reçue sous cette version, au lieu de comparer deux HMAC issus de clés différentes. observedContentDigest du receiptItem utilise la version de son événement lié. Un changement de projection de normalisation demande une comparaison compatible ou une revue, pas une déclaration automatique de conflit.

La clé de stream est distincte et sa rotation n’est pas une simple rotation de lookup : elle changerait l’ordre, le verrou et la barrière de STOP. Interdire une bascule tant qu’un flux entrant ouvert ou une transaction de traitement/dispatch ancienne subsiste. Procédure à autoriser : arrêt contrôlé des acceptations/traitements/envois, drainage ou rekey vérifié des flux concernés, clôture des anciens propriétaires et bascule atomique de streamKeyVersion, puis reprise avec une seule version active d’ordonnancement. Si le drainage est impossible, rester arrêté ou concevoir un mécanisme de compatibilité ; ne pas laisser deux versions devenir deux flux indépendants pour un même expéditeur.

## 8. Corrélation des callbacks de livraison

1. Vérifier endpoint et statut connu, puis chercher l’ID Meta exact dans les trois circuits NVA.
2. Rassembler les candidats, au lieu de prendre aveuglément le premier trouvé. Plusieurs cibles possibles = FAILED/AMBIGUOUS_TARGET, sans mise à jour métier.
3. À défaut, utiliser uniquement la valeur exacte de biz_opaque_callback_data réellement reçue et sa correspondance avec une clé locale existante, dans le périmètre autorisé.
4. Si ID fournisseur et clé locale désignent des cibles différentes, ou si la cible a déjà un autre ID fournisseur : conflit de corrélation pour revue, pas réaffectation.
5. Relire l’état, l’ID et le compteur de la cible dans la transaction d’effet ; appeler la politique existante. Une cible annulée reste annulée ; une preuve DELIVERED/READ suit uniquement les transitions déjà admissibles.

Les repères targetKind/targetId ne sont pas un cache d’autorisation. La corrélation métier actuelle n’est pas isolée multi-WABA ni garantie par tentative : la première activation reste mono-périmètre. Le HMAC streamKey d’un expéditeur sert seulement à sérialiser ses entrants et empêcher un dispatch alors qu’un contrôle est en attente ; il ne doit jamais associer un callback à une livraison.

| Situation | Résultat sûr |
|---|---|
| Callback avant retour HTTP d’envoi, clé locale connue | Traiter par clé exacte via les règles existantes ; la mise à jour ACCEPTED du sender ne doit pas écraser un statut plus fort. |
| Callback précoce sans clé locale exploitable | UNCORRELATED durable ; réveil après écriture du providerMessageId. |
| Callback après réponse | Recherche native exacte, politique monotone et idempotente. |
| Réponse HTTP d’envoi perdue, clé locale reçue | Corrélation possible sur preuve exacte ; aucun nouvel envoi. |
| Réponse perdue sans preuve commune | UNCORRELATED ; demeure non résolu jusqu’à preuve ou expiration. |
| Callback répété/après redémarrage | Même événement/tombstone ou nouvelle occurrence, sans second effet. |
| Callback d’une ancienne tentative ambiguë | FAILED/revue ; ne pas l’attacher à la tentative courante par proximité temporelle. |
| Cible supprimée ou références devenues incompatibles | Motif explicite, non résolu/revue selon nature ; ne pas créer une livraison depuis le callback. |

Réveil : après commit de l’acceptation d’une livraison, signal transactionnel logique par requête des événements UNCORRELATED sur ID natif/clé exacte. Une notification en mémoire ou LISTEN/NOTIFY peut accélérer, mais ne constitue pas la preuve durable : un balayage périodique indexé reste obligatoire pour couvrir le crash avant notification. Les recherches et wake-ups ne lancent jamais un sender.

Proposition de balayage non corrélé : 30 s, 2 min, 10 min, puis toutes les heures, avec jitter borné et échéance de rétention. Il s’agit d’un calendrier technique à approuver ; il ne remplace ni ne modifie retryDelay métier. L’absence de cible n’est pas une erreur d’envoi et ne consomme pas attempts de la livraison.

## 9. Concurrence, interruption et transaction d’effet

### Réservation

Sélection courte FOR UPDATE SKIP LOCKED à échéance, puis état PROCESSING, token aléatoire, owner technique, leaseGeneration+1 et processingAttempts+1. Horloge PostgreSQL cohérente pour les baux, jamais updatedAt des tables métier. Réservation plafonnée et indexée par endpoint. Après crash, les PROCESSING expirés sont repris avec un nouveau token/génération.

La transaction d’effet reverrouille la ligne événement et vérifie état/token/génération, absence de conflit et bail encore valide avec une lecture courante de l’heure DB **après acquisition du verrou**. Toute écriture de fin et prolongation est conditionnelle à ce fence. Un ancien worker ne peut ni confirmer ni modifier une ligne reprise par un nouveau propriétaire.

Ordre des acquisitions : ingestion Endpoint → flux triés → événements triés ; transaction d’effet flux → événement, après une lecture préparatoire non verrouillante pour déterminer le flux. Si cette lecture n’est plus cohérente sous verrou, abandonner et recommencer. La transaction courte de claim ne prend que ses verrous d’événement et commit avant de demander un verrou de flux. Ne pas conserver un verrou d’événement puis attendre un flux déjà détenu par une ingestion qui attend ce même événement. Les statuts sans flux entrant utilisent les verrous/CAS de leur cible exacte et un ordre déterministe ; les erreurs techniques ne prennent aucun verrou de conversation supposée.

### Effet et marquage dans une transaction commune — cible préférée

- Statuts : client transactionnel vers la politique CAS existante, puis PROCESSED/IGNORED/UNCORRELATED dans la même transaction.
- Entrants : exécuteur du corps transactionnel existant avec le même tx, sans nouveau $transaction imbriqué ; message entrant, moteur, consentement, annulations et réponse QUEUED restent atomiques avec le résultat inbox.
- Aucun HTTP ni déchiffrement distant lent sous verrou : le contenu est déchiffré/préparé avant, puis état/empreinte/fence revérifiés sous transaction. Catalogue/inscription utilisés par le moteur doivent rester des accès via le même tx, comme aujourd’hui.

Cette extraction est une **future modification technique à approuver et tester**, pas une capacité déjà présente. Conserver le wrapper actuel pour les autres appelants et les retries Serializable autour de toute la transaction d’effet, pas autour d’un fragment déjà committé. Plafonner durée/timeout transactionnels et distinguer SQL transitoire d’erreur permanente. Une lease ne fence pas automatiquement un effet exécuté dans une transaction indépendante.

Un mode transitoire « effet idempotent puis marquage » aurait une fenêtre de crash : message déjà créé/statut déjà appliqué mais inbox non terminée. Le replay peut alors être ignoré grâce aux uniques/CAS existants, sans compter une seconde application. Ce mode ne doit être activé qu’après preuve d’idempotence par scénario ; **ne pas le présenter comme équivalent à l’atomicité commune**, ni comme solution aux actions non idempotentes.

### Ordre des entrants et priorité des contrôles

SKIP LOCKED seul ne sérialise pas deux messages différents d’une même conversation. Proposition sans cinquième modèle : verrou advisory **transactionnel** sur une clé dérivée du streamKey, détenu pendant toute la transaction d’effet. Tous les chemins de réception/traitement participant à cet ordonnancement utilisent le même calcul, la même base et un ordre déterministe de verrous. Une collision de clé advisory peut ralentir deux flux, mais ne doit jamais les fusionner ou servir à corréler leurs données.

L’ingestion prend ce verrou avant attribution d’enqueueOrder ; le worker ne traite que le premier entrant ouvert du flux. Un entrant antérieur PROCESSING/RETRY_WAIT/FAILED bloquant empêche de dépasser ce point. Les messages d’un lot gardent leur ordre relatif déclaré pour ce flux ; des requêtes concurrentes sont ordonnées par l’acceptation sous verrou, pas par une hypothétique chronologie Meta. Une séquence DB peut comporter des trous et n’est pas, seule, un ordre de commit.

**STOP en attente : condition d’activation bloquante.** Une réception devenue asynchrone introduirait un intervalle où STOP est durable mais non encore appliqué. Avant tout dispatch NVA pour ce destinataire, une barrière technique doit refuser/différer l’envoi si un entrant de ce flux reste à traiter ou en échec bloquant. Aucun compteur de tentative ni statut d’envoi ne doit être consommé par ce seul report technique. Au redémarrage, le traitement entrant est rétabli avant autorisation des senders. Si le flux d’un entrant de contrôle ne peut pas être déterminé de manière fiable, bloquer le dispatch du périmètre concerné plutôt que deviner.

La barrière doit s’articuler avec le verrou de flux et le dernier contrôle de consentement/état humain déjà présent. Le seuil de linéarisation (autorisation locale de dispatch) et les courses avec ingestion/administration doivent être explicités et testés. Aucun verrou SQL ne rappelle un POST déjà transmis ; un STOP reçu après cette frontière ne peut annuler rétroactivement l’envoi. Tant que cette barrière et la transaction d’effet n’ont pas été validées, **ne pas basculer les entrants en asynchrone avec des senders actifs**.

### Horloges et retries

Conserver le timestamp Meta original et sa validité au moment de première réception. Un timestamp futur/absent refusé pour ouvrir la fenêtre ne devient pas valide uniquement parce qu’il a attendu dans l’inbox ; ne pas le remplacer par l’heure de traitement. La fenêtre reste celle du dernier entrant fournisseur fiable, et elle est vérifiée au dispatch, même si la réponse a attendu.

Le service actuel utilise now() aussi pour receivedAt, consentement et échéances des relances. Le futur contexte de traitement devra distinguer première réception, temps fournisseur et traitement effectif : ne pas décaler silencieusement le point de départ des relances de 24/72 h à cause d’un backlog. Ces conventions temporelles devront être approuvées avec des tests comparant chemin synchrone et différé ; ne pas injecter une unique fausse horloge pour toutes les opérations.

Les retries d’inbox concernent seulement le traitement technique : proposition 10 échecs consécutifs, délai exponentiel plafonné avec jitter, puis FAILED et alerte. Une erreur UNCORRELATED suit son balayage propre. Les délais, plafonds et compteurs de livraison existants sont inchangés. Une panne DB ou un crash d’inbox ne remet jamais une livraison incertaine en attente d’envoi.

## 10. Sécurité, minimisation et rétention

### Données acceptées et données exclues

- Ne persister qu’après HMAC valide, configuration de compte autorisée et validation du contrat. Ni corps ni token/header d’une requête rejetée.
- Aucun access token, verify token, app secret, valeur de signature, cookie, en-tête d’autorisation ou URL avec identifiants dans les modèles ou logs.
- Ne pas stocker l’enveloppe HTTP complète. Le digest de requête est un HMAC ; ce n’est pas une preuve indépendante de signature vérifiable sans le secret, et pas un journal juridique complet.
- Pour un entrant connu : ID, expéditeur et seules données nécessaires au moteur actuel, dans le payload chiffré ; pas de copie de contacts/profile ni d’attachement binaire. Le moteur n’a pas besoin de télécharger un média pour ce design.
- Pour un statut : ID natif, statut, timestamp, clé locale éventuelle et codes d’erreur utiles. recipient_id, prix et détails textuels inutilisés sont exclus.
- Pour errors : codes techniques bornés et références exactes disponibles ; pas de titres/détails libres par défaut.
- Pour unsupported : métadonnées minimales connues et raison de revue, sans effet métier. **La minimisation peut empêcher de reconstruire un futur type inconnu intégralement** : ne pas annoncer la conservation complète de tous les champs fournisseur. Si une capsule brute chiffrée est demandée, elle nécessite une autorisation de confidentialité séparée, une taille et une rétention explicites.

Chiffrement authentifié des payloads et variantes, par exemple AES-256-GCM avec nonce unique et AAD liant endpoint, événement/receiptItem, version et digest ; clé issue d’un gestionnaire de secrets. Les clés d’encryption, lookup HMAC et Meta sont distinctes. La rotation conserve la capacité de lire l’historique tant que le payload doit rester traitable ; ne pas supprimer une ancienne clé sans politique de rétention/restauration.

Les identifiants natifs sont des données pseudonymes, pas anonymes ; colonnes restreintes, pas d’affichage par défaut, pas d’index par téléphone. streamKey est un HMAC dédié, pas un hash simple de numéro devinable. Aucune donnée de message, numéro complet ou clé locale en métrique/label/log. Journaliser seulement IDs techniques internes, compteurs et motifs fermés ; prévoir des accès opérateurs justifiés.

### Rétention proposée, à approuver

| Donnée | Durée initiale proposée | Précaution |
|---|---|---|
| Payload d’un événement traité/ignoré | 24 h après résultat terminal | Évite une copie prolongée du texte déjà conservé au métier. |
| Payload ouvert/non corrélé/échoué et variantes de conflit | 30 jours après première réception | Alertes avant échéance ; expiration explicite, aucune extension infinie par doublon. |
| Receipt et manifeste ordinaires | 7 jours | Prolonger si un conflit ou une dépendance conservée l’exige. |
| Tombstone d’identité/résultat | 90 jours minimum proposés | Pas de payload ; conserver clé/version et résultat minimal. |
| Métadonnées de revue d’un conflit | 90 jours proposés | La variante chiffrée reste soumise à 30 jours ; pas de reconstitution après purge. |

Ces durées sont des choix de conception, **pas des obligations légales ni une durée garantie de retry Meta**. Elles devront être adaptées aux besoins et validées. Alerter sur l’approche de l’échéance et sur le stock d’événements ouverts ; une prolongation exceptionnelle doit être limitée et justifiée.

Purger un contenu ouvert exige transition EXPIRED et raison dans la même transaction, puis suppression réelle du ciphertext/référence de clé ; le tombstone reste. Les compteurs/doublons ne prolongent pas firstReceivedAt ou une expiration indéfiniment. Avant de supprimer un événement, supprimer explicitement ses receiptItems expirés ; supprimer une receipt seulement lorsque tous ses items peuvent disparaître. RESTRICT évite une purge en cascade accidentelle d’une variante ouverte. Transactions de purge bornées, hors chemins d’envoi.

Après suppression totale d’un tombstone, la protection technique contre un vieux replay est limitée ; l’unicité métier peut encore aider si l’objet existe, mais ne couvre pas une cible supprimée. Les événements trop anciens/inclassables pour être rejoués sans risque doivent aller en revue selon une politique approuvée, sans rejet global des callbacks tardifs légitimes. Absence de timestamp et identités purgées empêchent une garantie parfaite ; cette limite doit être acceptée ou la rétention augmentée.

Backups, restauration et rotation de clés doivent respecter les durées réelles ; une purge en ligne ne supprime pas immédiatement des copies de sauvegarde. Une restauration peut réintroduire des tombstones anciens ou manquer de nouveaux événements : procédure de reprise en quarantaine, senders désactivés, revue des intervalles perdus et des données encore disponibles. Pas de promesse de RPO nul sans politique de sauvegarde/réplication explicitement validée.

### Accès et isolation

Toutes les lectures/écritures sont filtrées par endpoint configuré, jamais seulement par une clé fournie dans le corps. Les FK composites interdisent un manifeste inter-endpoint ; elles ne remplacent pas le contrôle des SELECT. RLS éventuelle : étude séparée, aucune supposée active.

Permissions futures à autoriser séparément : réception SELECT/INSERT/UPDATE limités pour déduplication, worker SELECT/UPDATE inbox et droits métier déjà justifiés pour ses services, exploitation/purge distincte. Usage de la seule nouvelle séquence enqueueOrder nécessaire si ce choix est confirmé. Pas de CREATE, TEMPORARY, GRANT OPTION ou privilège administratif pour les workers. Aucune permission accordée ici.

## 11. Migration proposée — aucune exécution

1. Approuver périmètre mono-compte, quatre modèles, états, conventions temporelles, minimisation et durées ; résoudre le traitement prioritaire des contrôles entrants.
2. Préparer ultérieurement une migration additive des seules quatre tables, PK/uniques/FK composites/index et CHECK ; revoir limites/index UTF-8 et séquence. Ne pas modifier les 44 migrations existantes, les tables métier ou les modèles Provider*.
3. Traduire en Prisma : relations uniquement entre les nouvelles tables, sans relation inverse métier imposée par targetId ; documenter les contraintes SQL non représentables. Aucun backfill de payloads historiques et aucune transformation des identifiants Meta.
4. Autoriser un environnement PostgreSQL dédié, appliquer et tester la migration, les droits minimaux et les plans de requête ; générer le client uniquement dans cette phase autorisée.
5. Implémenter repositories, chiffrement, acceptation et transaction d’effet derrière des activations distinctes false par défaut. Garder la voie actuelle tant que la bascule n’est pas validée ; ne jamais appliquer les deux voies métier pour le même webhook.
6. Préparer les tests crash/races, les dépendances avec STOP et les nouveaux nettoyages de fixtures. La suite historique de 14 tests reste interdite sans nouvelle autorisation.
7. Sous autorisation séparée, basculer l’acceptation HTTP vers l’inbox, senders initialement arrêtés, puis valider la reprise des entrants et autoriser le dispatch contrôlé.
8. Repli : arrêter traitement/send, conserver l’inbox acceptée et la traiter sous contrôle. Ne pas supprimer les tables remplies, revenir à un chemin qui ignore les événements déjà acquittés ou rejouer automatiquement des envois incertains.

L’implémentation future d’une inbox ne requiert pas de retirer Gupshup. Aucun modèle Gupshup/Provider* n’est réutilisé directement ou supprimé par ce plan.

## 12. Fichiers futurs concernés

À créer, noms indicatifs : src/services/metaWebhookInboxService.js, src/repositories/metaWebhookInboxRepository.js, src/services/metaWebhookEventNormalizer.js, src/services/metaWebhookPayloadCipher.js, src/jobs/metaWebhookInboxWorker.js et tests dédiés. Réutiliser les primitives crypto natives, pas le repository Gupshup ; toute factorisation technique ultérieure exige une revue distincte.

À modifier après autorisation : prisma/schema.prisma et une nouvelle migration additive ; whatsappWebhookService/controller pour le commit avant 200 ; adaptateurs transactionnels de whatsappConversationService et des applyStatus ; configuration/commande d’activation de l’inbox ; composition d’horloges ; barrières techniques des senders et signal de réveil de corrélation. Ces changements ne doivent ni remplacer les contrôles métier ni supprimer leurs assertions.

Les contrats devront distinguer acceptBatch → durableReceiptId/compteurs (pas applied), claim → bail/fence, dispatchEvent → résultat détaillé, wakeExactCorrelation → planification seulement et purgeExpiredPayloads → expiration/tombstone. Aucun de ces contrats ne contient de fonction d’envoi fournisseur.

## 13. Plan de tests avant activation

### Isolés, avec mocks et sans base

- Signature invalide, compte/numéro incorrect, canal désactivé : aucun chiffrement/stockage/effet ; lot invalide complet refusé.
- Décomposition d’un lot mixte ; manifeste exhaustif, doublons dans un même lot, réordonnancement du JSON, nouveau découpage du lot.
- Identité séparée du contenu : entrée répétée, statuts distincts d’un ID, timestamp absent, métadonnée inutilisée, contenu contradictoire, conflit après traitement.
- IDs natifs exacts, limites UTF-8, aucun numéro/heure utilisé pour corréler ; clés absentes/inconnues/contradictoires ; plusieurs cibles candidates.
- Échec chiffrement/commit : pas de 200 ; commit réussi puis réponse perdue : même effet au replay.
- applied/ignored/uncorrelated/failed exacts, erreurs observées sans statut de livraison inventé.
- Token/génération périmés, erreurs techniques et retry inbox sans nouvelle tentative d’envoi ; activation par défaut refusée.
- Payload minimal, chiffrement/AAD, rotation de clés de lookup et chiffrement, absence de secrets/PII dans les logs.
- Horloges : entrée retardée, future à réception puis devenue passée, frontière 24 h, consentement/échéances 24/72 h identiques au contrat attendu.

### PostgreSQL dédiés — autorisation distincte obligatoire

- Uniques/FK/CHECK, doublons et conflits concurrents, rollback du manifeste complet, plusieurs workers sur mêmes/différents événements.
- Bail expiré, ancien worker après reprise, crash avant/après effet et avant/après marquage, récupération par nouveau processus.
- Transaction d’effet sans transaction imbriquée, maintien des garanties Serializable et retries autour de l’ensemble.
- Ordre de flux : deux entrants différents, lot concurrent, message antérieur en retry, blocage de dépassement ; absence de promesse d’ordre fournisseur.
- **STOP/takeover** déjà durable mais pas traité : aucun dispatch au-delà de la barrière autorisée ; course ingestion/sender/admin et absence de compteur consommé par simple report.
- Callback précoce, après acceptation, après redémarrage, sans clé commune, clé exacte reçue après réponse perdue, anciens essais, cible supprimée ; maintien de CANCELLED/READ et absence de double envoi.
- Réveil perdu puis balayage, redémarrage sans cache, rotation croisée des versions sans nouvelle identité involontaire.
- Purge contenu/tombstone/manifeste/variantes, rétention de parents dépendants, reprise après restauration ; permissions et isolation de lecture.
- Rejouer ultérieurement les 14 scénarios existants avec nettoyage ciblé adapté, sans reset ; conserver les 302 tests isolés de référence.

### Essais Meta réels — dernière autorisation distincte

Vérifier compte, abonnement, signature, enveloppes, retour des clés de corrélation et statuts réellement présentés, avec destinataires autorisés et sans activer les files historiques à l’aveugle. Aucun essai réel n’est effectué ou autorisé par le présent document.

## 14. Risques, décisions ouvertes et point d’arrêt

| Risque / décision | Condition avant activation |
|---|---|
| STOP/contrôle humain différé par l’inbox | Barrière de dispatch et ordonnancement validés ; sinon pas de bascule asynchrone avec senders actifs. |
| Effet métier et inbox dans deux transactions | Extraction transactionnelle revue ; mode transitoire seulement avec preuves de replay idempotent. |
| Corrélation impossible/ambiguë | Conservation non résolue et revue, aucune association heuristique ni réémission. |
| Vieux événements après purge/restauration | Rétention, politique de revue et procédure de reprise approuvées ; pas de garantie infinie. |
| Contenu/consentements et minimisation | Clés opérationnelles, accès restreints, projections et durées approuvées. |
| Volumétrie des occurrences et conflits | Quotas, index, alertes de lag, tests de charge et capacité de refus avant ACK. |
| Plusieurs comptes | Interdit dans la première activation avec les tables métier globales actuelles. |
| Catalogue/contrats Meta actuels | Validation officielle et essai du compte sous autorisation ultérieure ; aucune hypothèse d’API de relecture ou garantie de retry ajoutée. |

Sources de cette conception : code et documents locaux examinés, sans consultation du compte, appel Meta ou PostgreSQL. Ce document spécifie des choix NVA ; les délais techniques et durées proposés ne sont pas présentés comme des garanties fournisseur. Les capacités du client Prisma et les propriétés SQL devront être vérifiées à l’implémentation et dans l’environnement autorisé.

**Livrable unique de cette intervention : docs/meta-whatsapp-durable-inbox-design.md. Aucun code, schema.prisma, migration, .env ou composant Gupshup modifié ; aucun test, worker, envoi ou accès à une base lancé. Attente d’autorisation avant toute implémentation.**
