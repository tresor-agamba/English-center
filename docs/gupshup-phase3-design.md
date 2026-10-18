# NVA — Phase 3 : conception de la persistance et de la sécurité Gupshup

Date : 16 octobre 2026. **Conception uniquement ; aucune implémentation, migration ou activation.** Références locales : gupshup-phase1-contracts.md, gupshup-phase2-simulation-report.md et les six fichiers de phase 2. Les résultats 14/14 PostgreSQL et 239/239 isolés sont les résultats historiques, pas de nouvelles exécutions.

## 1. Architecture retenue pour la proposition

```text
Webhook → authentification spécifique à l’application → validation V2
        → transaction courte : déduplication + inbox persistante → commit → 204
Inbox worker → réservation avec bail/fencing → résolution des alias/essai
             → service NVA existant → confirmation de traitement

Service NVA → réservation métier inchangée → coordinateur d’essai persistant
            → transport unique → association de la réponse → acceptation NVA
```

La réception durable, le retry d’un événement et l’envoi d’un message sont trois opérations distinctes. Un worker d’inbox n’a jamais la responsabilité de rejouer une requête d’envoi. Le coordinateur ne remplace pas les règles d’éligibilité, les claims ou les compteurs NVA.

Le prototype mémoire n’est pas promu en stockage de production par simple remplacement de Map : il lui manque transactions, contraintes, baux multi-processus, reprise et rétention. Son drapeau ready ne peut pas être accepté comme preuve d’un binding réel.

Deux conditions restent bloquantes : authentification acceptable confirmée pour l’application NVA ; stratégie explicite pour les cas de réponse perdue sans identifiant commun. Le second point peut être traité par un état non résolu sûr, mais jamais présenté comme une corrélation garantie.

## 2. Audit des structures existantes

Audit statique de prisma/schema.prisma et des migrations, notamment 20260726060000_add_whatsapp_delivery, 20261009140000_add_whatsapp_conversations et 20261009150000_add_whatsapp_prospect_follow_ups. **Aucune connexion PostgreSQL réalisée : le catalogue réel n’a pas été réaudité pendant cette conception.** Le dépôt contient 44 fichiers de migration SQL.

| Structure | Réutilisation | Limite |
|---|---|---|
| WhatsAppConversation | Conversation, état humain, liens utilisateur, contexte moteur | phoneNumber unique globalement, aucune application/fournisseur |
| WhatsAppConversationMessage | Message interne, ID entrant, idempotencyKey sortante, état et attempts | providerMessageId unique dans cette table, un seul identifiant ; pas de registre de tous les essais |
| WhatsAppDelivery | Notification sortante, déduplication, scheduledFor, statut/attempts | Même limite d’identifiant ; aucune provenance fournisseur figée |
| WhatsAppProspectFollowUp | Relance liée au consentement, échéance, statut et compteur | Même limite ; ne pas détourner consentEventId en corrélation transport |
| WhatsAppCommercialConsentEvent | Preuve de consentement et déduplication des décisions | Ne doit pas servir d’inbox technique ou accueillir des événements fournisseur non vérifiés |
| WhatsAppPreference | Préférences et opt-in/opt-out utilisateur | Un opt-in fournisseur ne remplace pas cette règle métier |
| Audits CenterSettings/Financial/Academic/Backup et OralSessionEvent | Patrons locaux d’horodatage/audit à examiner | Sémantique métier et relations différentes ; pas de réutilisation comme queue générique |

Les contraintes actuelles de direction/statut des messages et les uniques provider_message_id/idempotency_key sont à conserver. Les champs processingStartedAt des livraisons appartiennent à leur traitement métier ; ils ne doivent pas être réutilisés comme bail d’inbox. Aucun modèle existant n’est modifié dans cette intervention.

**Limite d’isolation importante :** isoler les nouvelles tables par application ne rend pas le moteur existant multi-tenant. Les conversations et préférences restent globales. Première activation proposée : un seul périmètre NVA de numéro/application réceptionnaire ; aucune exploitation simultanée de plusieurs comptes indépendants dans ces mêmes modèles. Un véritable multi-compte nécessiterait un projet séparé et une nouvelle autorisation.

## 3. Modèles PostgreSQL proposés

Ce sont des dictionnaires de données, **pas du DDL à exécuter**. Noms Prisma conceptuels ; noms SQL définitifs à fixer lors de la revue de migration.

Conventions : UUID générés par l’application, sans imposer d’extension PostgreSQL ; instants techniques TIMESTAMPTZ(3), UTC ; compteurs non négatifs ; valeurs d’état fermées via CHECK ou enums dédiés. Les nouveaux instants de bail/échéance sont explicites et indépendants de @updatedAt. PK UUID sur chaque objet ; index uniques composites nécessaires aux FK d’isolation. Les tables existantes conservent leurs types et timestamps actuels.

### 3.1 ProviderApplication — périmètre immuable

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id | UUID NOT NULL PK | Identité interne du périmètre |
| provider | VARCHAR(16) NOT NULL | gupshup ou meta, valeur fermée |
| environment | VARCHAR(16) NOT NULL | test, staging ou production |
| application_key | VARCHAR(64) NOT NULL | Clé interne ASCII stable, non secrète |
| external_app_id | VARCHAR(128) NULL | ID externe une fois vérifié |
| external_app_name | VARCHAR(128) NOT NULL | Nom attendu du contrat fournisseur |
| api_family | VARCHAR(32) NOT NULL | Ex. messaging-wa-v1 |
| webhook_version | SMALLINT NOT NULL | 2 pour le périmètre Gupshup étudié |
| auth_method | VARCHAR(32) NOT NULL DEFAULT reject | reject ou shared-header-confirmed après validation |
| secret_reference | VARCHAR(200) NULL | Référence vers le gestionnaire de secrets, jamais le secret |
| auth_confirmed_at | TIMESTAMPTZ(3) NULL | Date de preuve opérationnelle, pas une autorisation en soi |
| inbound_enabled / outbound_enabled | BOOLEAN NOT NULL DEFAULT false | Deux activations indépendantes, contrôlées |
| created_at / updated_at | TIMESTAMPTZ(3) NOT NULL | Audit technique |

Uniques : (provider, environment, application_key) ; external_app_id unique par provider/environment lorsqu’il est renseigné ; nom externe unique par provider/environment dans le périmètre V2. CHECK : inbound_enabled implique auth_method != reject, secret_reference et auth_confirmed_at non nuls. Ce CHECK ne remplace pas la preuve de fonctionnement ni la validation de configuration.

provider, environment et application_key deviennent immuables après le premier événement/essai. La bascule crée un nouveau périmètre plutôt que de réétiqueter l’historique. Tous les accès utilisent un application_id déterminé par configuration authentifiée, jamais uniquement le champ app du JSON reçu.

### 3.2 ProviderDelivery — lien typé avec la livraison NVA

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id | UUID PK | Référence locale technique |
| application_id | UUID NOT NULL FK ProviderApplication | Fournisseur/application figés pour cette livraison |
| delivery_kind | VARCHAR(16) NOT NULL | conversation, notification ou followUp |
| conversation_message_id | INTEGER NULL FK WhatsAppConversationMessage | Cible conversation |
| notification_delivery_id | INTEGER NULL FK WhatsAppDelivery | Cible notification |
| follow_up_id | INTEGER NULL FK WhatsAppProspectFollowUp | Cible relance |
| active_attempt_id | UUID NULL | Essai actuellement autorisé pour les callbacks |
| created_at / updated_at | TIMESTAMPTZ(3) NOT NULL | Audit |

CHECK : exactement une des trois FK cible non nulle et cohérente avec delivery_kind. Trois uniques partiels sur chaque FK cible non nulle, **sans application_id**, empêchent une même livraison interne d’être rattachée à deux applications. Unique (application_id,id) pour les FK descendantes. La référence conversation doit désigner un message OUTBOUND : contrôle repository transactionnel, éventuellement trigger de contrainte à concevoir ; une simple FK ne vérifie pas sa direction.

active_attempt_id référence un essai de cette même application et de ce même ProviderDelivery par FK composite, ajoutée après création des deux tables concernées ; une FK vers l’essai d’une autre livraison est interdite.

### 3.3 ProviderSendAttempt — journal des tentatives transport

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id | UUID PK | Identifiant d’essai interne |
| application_id / delivery_ref_id | UUID NOT NULL | FK composite ProviderDelivery(application_id,id) |
| attempt_number | INTEGER NOT NULL | Numéro observé après claim NVA ; > 0 |
| operation_key | VARCHAR(128) NOT NULL | Clé technique stable de l’essai, pas une clé API |
| payload_digest | BYTEA NOT NULL | Empreinte de la demande canonique, 32 octets |
| state | VARCHAR(24) NOT NULL | PREPARED, DISPATCHING, ACCEPTED, REJECTED, UNCERTAIN, CANCELLED |
| submission_id | VARCHAR(512) NULL | ID Gupshup, opaque, non réécrit |
| canonical_id | VARCHAR(1700) NULL | ID canonique compatible avec providerMessageId existant |
| dispatch_token | UUID NULL | Jeton propriétaire du dispatch, non journalisé |
| prepared_at | TIMESTAMPTZ(3) NOT NULL | Avant appel HTTP |
| dispatch_started_at / response_received_at | TIMESTAMPTZ(3) NULL | Franchissement de la frontière réseau / retour |
| accepted_at / rejected_at / uncertain_at | TIMESTAMPTZ(3) NULL | Résolution observée |
| http_status | SMALLINT NULL | 100–599 si présent |
| error_code | VARCHAR(100) NULL | Code technique borné, pas de réponse brute |
| rejection_is_definitive | BOOLEAN NOT NULL DEFAULT false | Preuve d’un rejet avant acceptation |
| created_at / updated_at | TIMESTAMPTZ(3) NOT NULL | Audit |

Uniques : (application_id,delivery_ref_id,attempt_number), (application_id,operation_key), (application_id,submission_id) si renseigné, (application_id,canonical_id) si renseigné ; unique (application_id,delivery_ref_id,id) pour active_attempt_id. CHECK octet_length(payload_digest)=32 et cohérence des états/dates : ACCEPTED exige un submission_id/canonical_id ; DISPATCHING exige dispatch_started_at/token ; aucun UNCERTAIN réinterprété comme REJECTED sans preuve explicite et audit.

Les IDs externes sont comparés de manière exacte, sans lowercasing ni conversion numérique. Valider des identifiants ASCII visibles bornés à 512 caractères avant construction du canonique afin de borner la taille de ses index ; si un format réel dépasse cette borne, bloquer et revoir le contrat plutôt que tronquer. Le namespace contient provider et application_key. Les anciennes valeurs Meta ne sont ni réencodées ni migrées automatiquement.

### 3.4 ProviderMessageAlias — dictionnaire d’identifiants

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id | UUID PK | Identité technique |
| application_id / attempt_id | UUID NOT NULL | FK composite vers ProviderSendAttempt(application_id,id) |
| alias_type | VARCHAR(24) NOT NULL | gupshup_submission ou whatsapp_message |
| external_id | VARCHAR(512) NOT NULL | ID exact, validation identique aux IDs d’essai |
| learned_from_event_id | UUID NULL | Événement source facultatif, de la même application |
| learned_at | TIMESTAMPTZ(3) NOT NULL | Date locale d’apprentissage |

Unique (application_id,alias_type,external_id). Une collision avec un autre essai est un conflit explicite, jamais un upsert réaffectant l’essai. Toute preuve simultanée gsId/WhatsApp doit résoudre vers un seul essai ; la coexistence d’un alias connu et d’un ID Gupshup contradictoire bloque le traitement.

Unique (application_id,id) sur la table d’inbox et FK composite pour learned_from_event_id. Les deux ID d’un même événement sont associés dans une seule transaction après validation des conflits. Aucun alias n’est appris à partir d’un webhook non authentifié.

### 3.5 ProviderWebhookEvent — inbox et tombstone de déduplication

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id | UUID PK | Identité d’événement |
| application_id | UUID NOT NULL FK ProviderApplication | Isolation |
| event_kind | VARCHAR(24) NOT NULL | inbound, status, transport, template, unsupported |
| source_event_id | VARCHAR(512) NULL | Si le contrat fournit un vrai ID d’événement |
| dedup_version | SMALLINT NOT NULL | Version de la canonicalisation, initialement 1 |
| dedup_key / payload_digest | BYTEA NOT NULL | Deux empreintes 32 octets : identité et contenu |
| external_gupshup_id / external_whatsapp_id | VARCHAR(512) NULL | Index de recherche d’événements non associés |
| normalized_status | VARCHAR(16) NULL | sent/delivered/read/failed pour un événement status |
| occurred_at | TIMESTAMPTZ(3) NULL | Temps externe facultatif |
| occurred_at_source | VARCHAR(32) NULL | Provenance et unité identifiées |
| first_received_at / last_received_at | TIMESTAMPTZ(3) NOT NULL | Horloge locale serveur pour la réception |
| receipt_count | INTEGER NOT NULL DEFAULT 1 | Nombre de reprises identiques, > 0 |
| payload_ciphertext | BYTEA NULL | Payload normalisé minimal chiffré pour traitement |
| encryption_key_reference | VARCHAR(200) NULL | Référence de clé/version, aucun secret en clair |
| payload_expires_at / tombstone_expires_at | TIMESTAMPTZ(3) NOT NULL | Rétention distincte contenu / identité |
| authentication_method | VARCHAR(32) NOT NULL | Méthode vérifiée au bord HTTP |
| credential_version | VARCHAR(64) NOT NULL | Version opaque, jamais la valeur d’en-tête |
| state | VARCHAR(32) NOT NULL | RECEIVED, PROCESSING, WAITING_CORRELATION, WAITING_BINDING, RETRY_WAIT, PROCESSED, QUARANTINED, IGNORED, EXPIRED |
| attempt_id | UUID NULL | FK composite application/essai après association |
| linked_inbound_message_id | INTEGER NULL FK message NVA | Effet entrant facultatif, pas une autorisation de routage |
| process_attempts | INTEGER NOT NULL DEFAULT 0 | Compteur de traitement technique, distinct des envois |
| next_process_at | TIMESTAMPTZ(3) NOT NULL | Échéance technique explicite |
| lease_token | UUID NULL | Jeton de fencing de la réservation |
| lease_generation | BIGINT NOT NULL DEFAULT 0 | Génération croissante |
| lease_owner | VARCHAR(64) NULL | ID technique d’instance, sans donnée utilisateur |
| lease_expires_at | TIMESTAMPTZ(3) NULL | Expiration de bail |
| processed_at / quarantined_at | TIMESTAMPTZ(3) NULL | Audit des transitions |
| resolution_code / last_error_code | VARCHAR(100) NULL | Codes bornés sans payload ou secret |

Uniques : (application_id,dedup_version,dedup_key), (application_id,id). CHECK : empreintes 32 octets, compteurs non négatifs, lease_token, lease_owner et lease_expires_at présents pour PROCESSING et nuls hors PROCESSING ; lease_generation reste non nulle dans tous les états et doit être strictement positive pour PROCESSING, kind/status cohérents, clé de chiffrement présente si ciphertext présent, contenu non nul pour un événement encore traitable. Une transition EXPIRED/QUARANTINED conserve la raison ; expiration de contenu ne doit pas laisser une entrée présentée comme traitable.

Identité : ID externe d’événement lorsqu’il est documenté ; sinon tuple canonique versionné des IDs, type/statut et temps externe fiable. Pour un message entrant, l’ID WhatsApp constitue la clé métier ; ne pas inclure son heure locale de réception dans l’identité. Conserver une empreinte distincte du contenu : même identité avec contenu contradictoire = quarantaine/alerte, jamais remplacement silencieux. Les répétitions avec données supplémentaires compatibles exigent une règle d’enrichissement explicite. Le hash JSON intégral de la simulation n’est donc pas adopté sans revue comme unique clé sémantique de production.

### 3.6 ProviderReconciliationAudit — décisions contrôlées

| Colonne | Type / nullabilité | Rôle |
|---|---|---|
| id / application_id | UUID PK / UUID NOT NULL | Périmètre |
| event_id / attempt_id | UUID NULL | Au moins une cible ; FK composites d’isolation |
| action | VARCHAR(32) NOT NULL | PROPOSE, APPROVE_BINDING, REJECT_CONFLICT, KEEP_UNRESOLVED, EXPIRE |
| actor_user_id | INTEGER NULL FK User | Acteur humain ; aucune identité arbitraire dans un texte |
| evidence_reference | VARCHAR(200) NULL | Référence vérifiable, non une URL contenant un secret |
| reason_code | VARCHAR(100) NOT NULL | Motivation structurée |
| created_at | TIMESTAMPTZ(3) NOT NULL | Audit append-only |

Pour APPROVE_BINDING : cibles événement/essai, acteur et preuve requis ; contrôle d’autorisation au repository, et double revue recommandée pour une association manuelle. Une entrée d’audit ne réactive pas un envoi. Le rôle applicatif ne modifie ni ne supprime ses décisions historiques ; la purge est une fonction d’exploitation séparée à concevoir, pas un GRANT effectué ici.

## 4. Contraintes transverses, index et suppression

Toutes les FK entre nouvelles tables portent application_id ; l’application doit donc être identique aux deux extrémités. Les uniques référencés doivent être effectivement créés, notamment (application_id,id) sur les essais. Ces contraintes empêchent une association inter-application même si le code oublie un filtre. Les noms de fournisseurs proviennent de ProviderApplication, pas d’une seconde copie modifiable dans chaque ligne.

Les requêtes restent obligatoirement filtrées par application_id. Des FK ne constituent pas une isolation de lecture face à un rôle disposant d’un SELECT global : repositories cloisonnés, authentification de l’application et revue des droits restent nécessaires. Une RLS future peut ajouter une barrière, mais n’est pas supposée active et ne sera pas introduite sans conception de ses sessions et tests dédiés.

Index proposés, en plus des PK/uniques :

- Inbox partiel (application_id,next_process_at,first_received_at,id) sur les états RECEIVED/RETRY_WAIT/WAITING_BINDING éligibles.
- Inbox partiel (application_id,lease_expires_at,id) sur PROCESSING pour reprise.
- Inbox partiel (application_id,external_gupshup_id) et équivalent WhatsApp sur WAITING_CORRELATION ; permet le réveil après apprentissage d’alias sans scan par téléphone.
- Inbox (application_id,state,first_received_at,id) pour exploitation/quarantaine ; index d’expiration du payload puis du tombstone. Aucun index global GIN sur le contenu par défaut.
- Alias (application_id,attempt_id) ; essai (application_id,delivery_ref_id,attempt_number) et partiel (application_id,state,dispatch_started_at) pour les dispatchs interrompus.
- Réconciliation (application_id,event_id,created_at) et équivalent attempt_id.

Indexes partiels, CHECK et FK composites ne sont pas tous exprimables intégralement dans une simple déclaration Prisma ; leur SQL devra être explicite et testé dans la future migration. Les relations inverse Prisma éventuelles seront techniques et additives, pas une modification des règles métier ; aucune déclaration n’est ajoutée aujourd’hui.

Politique de suppression proposée : RESTRICT pour les liens d’historique vers livraisons/essais/applications et pour les alias nécessaires aux événements conservés. Cela préserve les preuves, mais **peut bloquer la suppression actuelle d’un message utilisateur ou le nettoyage de fixtures si ces nouveaux liens existent**. Condition de migration : concevoir une purge/anonymisation explicite des dépendances, et adapter le nettoyage ciblé des futurs tests de persistance, avant activation. Pas de CASCADE silencieux supprimant les événements non résolus ; pas de SET NULL violant « exactement une cible ».

Rétention proposée à faire approuver, non garantie fournisseur : payload traité 7 jours ; payload non résolu/quarantaine 30 jours avec alerte avant échéance ; métadonnées de déduplication, essais et alias 90 jours minimum, prolongés tant qu’un événement dépendant est ouvert ; audit de réconciliation 180 jours. Ce sont des valeurs de départ, pas des obligations ni une preuve de couverture de tous les callbacks tardifs. La purge du payload conserve le tombstone ; la purge d’alias n’est pas autorisée tant qu’une dépendance ouverte existe. Après expiration totale, une vieille reprise peut redevenir inconnue : elle est conservée/quarantainée, jamais rapprochée par heuristique.

## 5. Concurrence, baux et reprise

### Réception HTTP

Authentifier et valider avant insertion. Dans une transaction courte : insert sur unique d’inbox ; en cas de doublon cohérent, incrémenter receipt_count/last_received_at sans changer le payload ni redéclencher un worker parallèle. Commit avant 204 vide. Panne/timeout de commit : ne pas annoncer une réception durable ; une reprise fournisseur rencontrera l’unique si le commit avait réellement réussi. Une réponse après échec d’authentification ne conserve pas le corps brut.

### Réservation du worker

Transaction courte de sélection FOR UPDATE SKIP LOCKED et mise à jour conditionnelle de l’inbox : état PROCESSING, nouveau lease_token, lease_generation+1, process_attempts+1, échéance de bail et propriétaire. Utiliser une référence temporelle PostgreSQL cohérente pour baux/échéances, pas @updatedAt. Finir la transaction avant un travail lent ; aucun appel fournisseur dans ce worker.

Les transitions finales et renouvellements sont conditionnés par id/application_id/lease_token/génération. Après expiration, un autre worker peut réserver avec un nouveau jeton ; l’ancien n’a plus le droit de marquer PROCESSED. Le verrou local de la simulation ne suffit pas à cette garantie multi-processus.

Pour les statuts : envisager un repository utilisant le modèle Prisma transactionnel pour appliquer la politique existante et le marquage d’inbox sous contrôle du bail dans la même transaction courte. Si cette frontière ne peut pas être conservée sans changement de service, retenir le traitement au moins une fois et les effets idempotents ; ne pas annoncer exactement une fois.

Pour les messages entrants : processInboundMessage ouvre sa propre transaction. Une transaction externe ne peut pas simplement lui passer un client transactionnel sans réexaminer cet appel imbriqué. Plan minimal : effet métier idempotent puis marquage inbox ; crash entre les deux = replay, rejet du doublon par l’ID entrant. Cette idempotence et les cas de conflit doivent être testés avec le vrai service avant activation. Un bail ne fence pas automatiquement un effet hors de sa transaction ; le token protège le marquage et les contraintes métier protègent l’effet.

Séquentialité par conversation : sous le périmètre mono-compte, sérialiser les événements entrants d’un même identifiant d’expéditeur par un verrou de flux séparé, par exemple advisory lock de session détenu sur une connexion dédiée pendant le traitement. Clé technique dérivée par HMAC pour éviter de journaliser le numéro ; fermeture de connexion en cas de crash libère le verrou. Ne pas utiliser un advisory lock transactionnel libéré avant l’appel métier. Cette option doit être validée avec le pool Prisma et les règles de reprise ; sinon prévoir un objet de flux/bail avec fence transactionnel. Ne pas prétendre qu’un simple SKIP LOCKED sur des événements différents préserve l’ordre de la conversation. Le temps d’arrivée ne reconstitue pas un ordre fournisseur non garanti.

Retry technique d’inbox : échéances explicites, délai exponentiel borné et jitter, plafond proposé 10 erreurs de traitement puis quarantaine ; aucune modification du compteur attempts de livraison. WAITING_CORRELATION est réveillé par une association/alias ; balayage de secours peu fréquent jusqu’à la rétention, sans incrémenter un compteur d’envois. Une panne PostgreSQL ne doit jamais déclencher un envoi fournisseur de remplacement.

### Crash autour d’un envoi

Persister PREPARED après le claim métier, puis DISPATCHING avec token avant l’appel réseau ; ne jamais garder une transaction SQL ouverte pendant HTTP. Persister la réponse/binding avant de retourner son ID au service. Un crash après DISPATCHING peut signifier que le fournisseur a reçu le message : aucune reprise automatique du POST. PREPARED abandonné ne doit pas non plus être renvoyé par un nouveau worker en contournant la récupération NVA ; utiliser une procédure de récupération conservatrice et le mécanisme existant d’envoi incertain. Il n’existe pas de transaction atomique entre PostgreSQL et l’API externe.

## 6. Matrice de corrélation

| Cas | Traitement sûr | Limite |
|---|---|---|
| Réponse HTTP normale | Associer submission_id à l’essai exact, créer canonique et alias, puis rendre ce canonique au service | Échec de persistance après acceptation = incertain, jamais renvoi |
| Callback avant réponse | Insérer inbox WAITING_CORRELATION ; apprendre uniquement les alias d’une soumission connue ensuite | Ni le contenu ni le destinataire ne permettent de deviner l’essai |
| Callback après réponse | Résoudre alias/application puis contrôler l’essai actif et le binding réel avant applyStatus | Un ancien essai ne devient pas l’essai actif |
| Réponse HTTP perdue | Essai UNCERTAIN ; garder l’événement en attente tant qu’aucune preuve commune n’existe | L’ID Gupshup du callback peut être inconnu du côté local ; l’inbox ne résout pas cette absence |
| ID Gupshup inconnu | Attendre une réponse/binding ou une preuve officielle de correspondance | Pas de création de livraison métier à partir d’un callback |
| ID WhatsApp inconnu, gsId connu | Après vérification de la paire, associer l’alias WhatsApp au même essai | Collision de paire = quarantaine |
| ID WhatsApp seul inconnu | WAITING_CORRELATION ; rechercher uniquement l’alias exact dans la bonne application | Aucun rapprochement par numéro ou heure |
| Callback répété | Unique inbox + validation du digest ; replay métier idempotent au besoin | Un duplicate contradictoire n’est pas écrasé |
| Callback après redémarrage | Retrouver inbox/alias/essai persistés, reprendre les baux expirés | La conservation doit encore couvrir l’événement |

### Callback avant écriture d’acceptation locale

La réponse peut être associée dans les nouvelles tables avant que le service ait écrit son providerMessageId. L’inbox reste WAITING_BINDING tant que la livraison ciblée ne contient pas le canonique et le compteur attendu, ou n’a pas été réconciliée explicitement par CAS sous contrôle de l’essai. Ne pas traiter un applyStatus=false comme une confirmation de succès. Le wake-up doit être déclenché après confirmation persistée, avec un balayage de secours pour un crash avant notification.

Le chemin d’erreur « acceptation fournisseur puis crash » peut laisser le service en FAILED/DELIVERY_UNCERTAIN sans ID. Si l’essai et la réponse étaient déjà persistés, une réconciliation conditionnelle peut poser le canonique sur cette même livraison/ce même compteur, sans refaire l’envoi, puis appliquer le callback via la politique existante. Aucun écrasement d’un autre providerMessageId ou d’un autre compteur ; un conflit reste non résolu. Les états CANCELLED ou consentements retirés ne sont pas rouverts par cette association technique.

Le registre d’essais ne doit pas créer de nouveaux retries. Un callback tardif de tentative antérieure ne doit pas être détourné sous le canonique courant : conserver l’historique de cet essai, vérifier la compatibilité puis appliquer uniquement une transition démontrée admissible. En cas de doute, quarantaine et audit.

## 7. Réconciliation des non-résolus

État UNCERTAIN pour l’essai, WAITING_CORRELATION/WAITING_BINDING ou QUARANTINED pour l’inbox ; ces états ne veulent pas dire « non livré ».

Procédure proposée :

1. Geler toute réémission automatique de cet essai ; exposer seulement des IDs techniques et raisons masquées aux opérateurs autorisés.
2. Chercher une preuve exacte : réponse de soumission déjà persistée, alias appris dans un autre événement authentifié, référence client effectivement renvoyée et documentée pour l’endpoint, ou preuve fournisseur officielle liant sans ambiguïté l’opération locale à l’ID externe.
3. Ne pas considérer comme preuve un rapprochement de téléphone, corps, prix ou proximité temporelle ; même un ID fournisseur observé dans un portail ne prouve pas seul son lien à une tentative locale.
4. Si la preuve existe, contrôle d’application/essai/conflit, revue humaine et écriture transactionnelle alias + décision append-only. Rejouer uniquement le traitement de statut, jamais le POST.
5. Sinon conserver KEEP_UNRESOLVED et attendre/expirer selon la rétention avec notification. Aucune interface « forcer livré » ou « renvoyer car inconnu » n’est incluse dans ce design.

Une consultation future du compte ou du support nécessiterait une autorisation séparée ; aucun appel, contact ou accès de ce type effectué aujourd’hui. Le plan accepte explicitement qu’une corrélation puisse rester impossible.

## 8. Sécurité des webhooks : état des preuves officielles

### Résultat nouveau de la recherche

La documentation **Partner** de création d’un abonnement décrit version=2 ou 3 et un champ meta transmis en en-têtes, avec X-Gupshup-Webhook-Secret comme exemple d’authentification. Cela documente une possibilité de **secret partagé en en-tête**, pas une signature du corps. [Création d’abonnement officielle](https://partner-docs.gupshup.io/reference/setsubscription-api-v3).

La page de mise à jour confirme les en-têtes personnalisés et précise l’appartenance de l’application au compte du token Partner. **Aucun rattachement de NVA à cette capacité n’a été vérifié.** Le fait que l’envoi soit wa/api/v1 n’établit pas à lui seul l’accès à cette gestion d’abonnements. [Mise à jour officielle](https://partner-docs.gupshup.io/reference/put_partner-app-appid-subscription-subscriptionid).

| Proposition | Niveau de preuve | Conclusion NVA |
|---|---|---|
| apikey pour les requêtes sortantes wa/api/v1 | Documenté dans la référence Messaging | N’authentifie pas les webhooks entrants |
| En-tête personnalisé via meta, abonnement Partner V2 | Documenté | Candidat d’authentification, sous réserve de disponibilité et test pour l’app NVA |
| Cette capacité fonctionne pour notre app/abonnement | Non vérifié ; aucune configuration de compte consultée | Maintenir reject et inbound_enabled=false |
| HMAC Gupshup, X-Hub-Signature Meta ou timestamp signé pour cet endpoint | Aucune preuve trouvée dans les références consultées | Aucun mécanisme inventé ; ne pas implémenter une fausse vérification |
| Basic auth/mTLS disponibles dans ce périmètre | Hypothèse non établie | Ne pas les annoncer comme capacités acquises |
| IP autorisées | Pages officielles existent, dont une page Partner dédiée | Complément conditionnel ; confirmer périmètre et maintenance, pas une signature |
| User-Agent, champ app ou URL connue | Aucune preuve d’origine | Jamais suffisants |

La documentation Self-Serve indique la configuration d’une URL de callback, pas une garantie cryptographique de ses requêtes. Les documents Console de « Custom Integrations » décrivent notamment des événements envoyés vers Gupshup : ne pas les utiliser comme preuve d’authentification du sens Gupshup → NVA. [Configuration Self-Serve](https://docs.gupshup.io/docs/set-webhookcallback-url).

### Stratégie candidate, uniquement après confirmation

Secret aléatoire propre à chaque application et environnement, au moins 32 octets générés ultérieurement ; aucun secret généré ou stocké par ce document. Stockage en gestionnaire de secrets ; meta pourra contenir sa valeur côté fournisseur lors d’une opération autorisée. Ne pas réutiliser apikey, token Partner ou secret Meta.

Vérifier exactement un en-tête, longueur attendue et comparaison à temps constant ; refuser valeurs multiples, absentes ou mal formées. Endpoint lié à l’application attendue ; vérifier aussi app/version du payload après authentification. Pas de journalisation d’en-tête, query string ou capture brute de requête par l’application/proxy. Rotation versionnée avec chevauchement bref explicitement limité et révocation.

Le secret en en-tête est un bearer secret : TLS le protège en transit mais il **ne signe pas le corps ni la date**. Il ne protège pas un message rejoué par un détenteur du secret. Déduplication, contrôle d’accès aux secrets, rotation et restriction réseau sont nécessaires ; pas de rejet global des événements anciens qui casserait les callbacks légitimes tardifs. Un proxy ne doit accepter des indications X-Forwarded-For que d’un pair de confiance ; aucun accès direct ne doit contourner cette frontière.

La liste IP officielle Partner peut aider, mais les IP ne doivent pas être copiées aveuglément dans la configuration du produit Self-Serve. Leur périmètre, mises à jour et chemin de proxy doivent être établis. [Source officielle IP](https://partner-docs.gupshup.io/docs/gupshup-ip-allowlisting).

Critère d’acceptation avant activation : preuve de disponibilité pour l’application exacte, configuration contrôlée de l’abonnement V2 puis essai autorisé montrant en-tête reçu, rejet sans/mauvais en-tête et absence de fuite dans les logs. Si cette méthode n’est pas disponible ou n’atteint pas le niveau de sécurité retenu, rester en refus total et étudier une autre capacité officiellement prouvée. Le vérificateur de phase 2 reste inchangé et refuse toujours les webhooks réels.

## 9. Garanties fournisseur et limites utiles au design

La page des webhooks demande une réponse 2xx vide, recommande le traitement asynchrone et décrit un nouvel essai après dépassement de dix secondes ; elle ne donne pas un calendrier exhaustif de reprise. L’inbox est donc nécessaire, sans dépendre d’un nombre illimité de tentatives. [Webhook Key Points](https://docs.gupshup.io/docs/what-is-a-webhook).

Les événements V2 distinguent IDs Gupshup et WhatsApp ; gsId peut manquer sur les événements tardifs au-delà d’une semaine, et l’ordre de notification n’est pas garanti. Le design conserve donc les alias et utilise la politique monotone existante. Aucun echo universel de clé locale NVA n’est prouvé par ces éléments. [Événements V2](https://docs.gupshup.io/docs/message-events).

La référence texte wa/api/v1 documente l’authentification sortante et un identifiant de soumission ; cela ne fournit ni transaction distribuée ni preuve de corrélation après perte de réponse. Aucun appel d’essai n’a été fait. [Texte de session](https://docs.gupshup.io/reference/session-text-message).

## 10. Compatibilité métier et risques

| Invariant | Préservation proposée | Risque à tester |
|---|---|---|
| Consentement/STOP | Aucun opt-in créé par l’inbox ; action via le service existant seulement | Replay ou événement hors compte ne doit pas produire un consentement |
| Contrôle humain | Aucun callback ne reprend BOT_ACTIVE ni ne réactive CANCELLED | Événement tardif après takeover/STOP |
| Backoff | Échéances métier inchangées ; process_attempts de l’inbox distinct | Un retry inbox ne doit pas consommer une tentative de livraison |
| Déduplication | Uniques existants + inbox versionnée + alias exacts | Doublon contradictoire, perte du tombstone après rétention |
| Réservation atomique | Claim existant conservé ; aucun sender lancé depuis l’inbox | Crash entre claim, PREPARED, DISPATCHING et retour |
| Statuts monotones | applyDeliveryStatus/CAS conservé | READ suivi de SENT/FAILED, alias d’un ancien essai |
| Envois incertains | UNCERTAIN n’autorise aucun retry automatique | Perte HTTP et impossible rapprochement local |
| Isolation | Application authentifiée et FK composites | Les tables de conversation actuelles restent mono-périmètre |
| Nettoyage/rétention | Purge explicite avec dépendances connues | RESTRICT peut bloquer une suppression historique |

Les caches de promesses de la simulation ne doivent pas devenir une politique de livraison de production. L’idempotence fournisseur n’est pas garantie par une Map ou un UNIQUE local si deux POST ont déjà quitté le processus. Les hooks de composition et repositories devront transmettre kind/id/attempt exacts sans modifier les règles du moteur.

## 11. Plan de migration proposé — non exécuté

1. Approuver design, mono-périmètre, rétention, stratégie de chiffrement et gestion des suppressions ; fermer les preuves d’authentification.
2. Spécifier les états, FK cycliques, CHECK, uniques partiels et tailles ; revoir l’intégrité des liens existants. Aucun backfill heuristique de l’historique Meta.
3. Préparer une migration **additive** des nouvelles tables, contraintes et index, sans réécriture des messages/consentements ni changement des uniques existants. Distinguer création des tables, des FK de retour et validation finale.
4. Définir les accès futurs minimaux pour réception, worker et exploitation, sans rôle propriétaire/superuser et sans privilège global. Leur création/GRANT et toute RLS feront l’objet d’une autorisation séparée ; rien n’est appliqué maintenant.
5. Tester la migration sur un environnement dédié expressément autorisé, examiner plan/index/verrous, puis générer et valider le client Prisma. Ajouter les champs de relation inverse strictement nécessaires sans changer les colonnes existantes, si la représentation Prisma l’exige.
6. Déployer éventuellement repositories et traitements désactivés ; vérifier restauration après redémarrage et compatibilité. Le passage depuis le prototype mémoire ne transfère aucune « preuve » simulée vers les tables réelles.
7. Autoriser séparément configuration de l’application, secrets, abonnement V2 et essais réels. D’abord un seul périmètre, sans fallback automatique de fournisseur.
8. Repli : désactiver l’entrée/envoi concernés, conserver inbox/essais/alias et traiter l’historique selon preuve ; ne pas supprimer les tables remplies ni remettre les essais incertains en attente d’envoi. La reprise des callbacks anciens nécessite un chemin authentifié maintenu sous contrôle.

L’interdiction actuelle de modifier un modèle, de créer une migration ou de modifier les permissions reste respectée : ce plan est documentaire.

## 12. Plan de tests avant activation

### Tests purs et mémoire

Conserver les 239 tests isolés historiques ; compléter les contrats de clés sémantiques, variantes enrichies, timestamps, erreurs, aliases contradictoires, rotation d’en-tête et statut d’application désactivé. Aucune assertion existante affaiblie.

### Tests PostgreSQL à autoriser ultérieurement

- Insertions inbox concurrentes, JSON réordonné, même ID avec payload contradictoire, propagation des uniques et FK inter-app.
- Deux workers, un seul propriétaire, bail expiré, ancien token rejeté, générations, crash avant/après commit et exception SQL.
- Callback avant réponse, après binding mais avant acceptation, après acceptation, sans gsId, réponse perdue sans clé commune, conflits d’alias, reprise après redémarrage.
- Plusieurs tentatives d’une livraison, callback ancien, compteur changé, cible supprimée, direction de message invalide, refus des associations ambiguës.
- Effet métier validé puis crash avant marquage inbox : duplicate inbound et replay status ne créent pas de double effet.
- READ/DELIVERED monotones, CANCELLED respecté, STOP/takeover prioritaire, backoff inchangé, aucun POST depuis un retry inbox.
- Purge de payload sans perte du tombstone ; alias protégés pendant une attente ; politique RESTRICT et nettoyage ciblé des fixtures réellement fonctionnels.
- Isolation des trois tables cibles, des applications et des environnements ; tests de lecture cloisonnée et de permissions, sans élargissement global.

### Tests de sécurité de la future entrée HTTP

Absence/mauvais/double en-tête, secret d’une autre app, payload app contradictoire, corps trop gros, version inconnue, encodage, type de contenu, proxy contourné, rotation/révocation, indisponibilité de base et panne de chiffrement. Aucune action avant authentification ; aucun 204 avant commit ; aucun secret ni donnée de message en logs. Un mécanisme en en-tête n’est pas testé comme s’il signait le corps.

Rejouer les 14 scénarios métier PostgreSQL uniquement après autorisation avec client et nettoyage adaptés aux nouvelles relations, sans reset. Une réussite isolée ou une migration réussie ne suffit pas à autoriser le webhook réel.

## 13. Conditions obligatoires avant activation réelle

- Authentification disponible et vérifiée pour **l’application et l’abonnement V2 exacts**, avec accord de sécurité sur ses limites.
- Pas de secret dans le code, les tables de payload, les URLs ou les logs ; rotation et gestionnaire de secrets prêts.
- Migration additive, contraintes, index, client Prisma et permissions minimales validés dans l’environnement autorisé.
- Réception durable, traitement au moins une fois et idempotence démontrés après crash/redémarrage ; aucune promesse de corrélation impossible.
- États non résolus visibles, procédure de réconciliation approuvée, rétention/purge et restauration testées.
- Un seul périmètre de conversation compatible avec le schéma métier actuel ; provenance fournisseur figée pour les essais en cours.
- Tests de sécurité et de non-régression réussis ; modèles approuvés et contrats du compte confirmés séparément.
- Autorisation explicite de l’utilisateur pour les appels et l’activation réels. En attendant, refus total des webhooks et transport exclusivement simulé.

## Sources et limites de l’intervention

Sources externes exclusivement officielles Gupshup, consultées le 16 octobre 2026 : création/mise à jour Partner, IP Partner, configuration Self-Serve, Webhook Key Points, événements V2 et texte de session, liés au voisinage de chaque constat. Aucun résultat de blog tiers utilisé. Les capacités Partner ne sont pas extrapolées comme capacités confirmées de NVA.

Seul **docs/gupshup-phase3-design.md** a été créé. Aucun fichier métier/test, schéma, migration, .env, rôle, permission ou HBA modifié. Aucun accès PostgreSQL (5432 ou 55432), appel API Gupshup/Meta, contact support, test ou déploiement. Attente de l’autorisation avant toute implémentation.
