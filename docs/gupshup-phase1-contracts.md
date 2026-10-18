# NVA — Phase 1 : contrats de l’intégration WhatsApp Gupshup

Date de revue : 15 octobre 2026. Statut : spécification proposée, sans implémentation ni activation. Les décisions NVA ci-dessous sont distinctes des garanties documentées du fournisseur. L’analyse d’architecture de la conversation précédente sert de référence ; aucun fichier de rapport Gupshup préexistant n’a été trouvé dans docs/output.

## 1. Périmètre et décisions

Base de non-régression : les 14 scénarios PostgreSQL NVA ont réussi après régénération Prisma et correction des horloges de tests. Cela ne constitue pas encore une validation Gupshup.

| Sujet | Décision proposée | Certitude / condition |
|---|---|---|
| Produit | WhatsApp Self-Serve / Messaging API, endpoints wa/api/v1 | Famille documentée ; vérifier ensuite sa disponibilité pour l’application retenue, sans mélanger Enterprise, Partner, Passthrough ou Marketing Lite |
| Entrée fournisseur | Enveloppes JSON version=2 | Format documenté ; autre version refusée explicitement |
| Première portée | Texte sortant, modèles texte approuvés, texte entrant et réponses interactives prises en charge | Pas de téléchargement de média, campagne ou gestion de compte dans cet adaptateur |
| Sortie fournisseur | Service NVA → sender injecté → adaptateur Gupshup | Réutilise le point d’injection actuel |
| Authentification sortante | apikey en en-tête HTTPS, jamais dans une URL ou un navigateur | Documentée |
| Authentification entrante | Contrat obligatoire ; mécanisme concret non retenu faute de preuve suffisante | **Bloquant pour toute activation publique** |
| Identifiant sortant canonique | Namespace fournisseur/application + identifiant Gupshup de soumission | Décision NVA, pas un format imposé par Gupshup |
| Callbacks | Réception durable, résolution d’alias, puis politique NVA existante | Nécessaire pour préserver corrélation et statuts |
| Réessais réseau de l’adaptateur | Aucun retry automatique interne | La politique métier actuelle reste seule responsable |
| Bascule fournisseur | Explicite, un fournisseur d’envoi actif par périmètre d’application | Aucune bascule automatique après timeout ou erreur |

Les endpoints documentés sont POST https://api.gupshup.io/wa/api/v1/msg pour le texte de session et POST https://api.gupshup.io/wa/api/v1/template/msg pour les modèles. La version v1 des endpoints ne doit pas être confondue avec la version 2 des enveloppes de webhook. Sources : [S1], [S2].

## 2. Contrats NVA actuellement utilisés

### Entrée et moteur conversationnel

whatsappConversationService.processInboundMessage reçoit notamment :

```text
{ id, from, timestamp?, type, text?: { body }, interactive?: {
    button_reply?: { title }, list_reply?: { title }
} }
```

id sert à la déduplication persistante ; from est une chaîne de chiffres internationaux sans signe + ; timestamp est une chaîne de secondes Unix. Le service conserve un providerTimestamp uniquement si valide et non futur, sinon null : une date absente ne doit pas fabriquer une nouvelle fenêtre de service.

Le moteur interne handleMessage reçoit text, messageId, state, publicAppUrl et allowCommercialFollowUpConsent ; il retourne state, text et actions. L’adaptateur fournisseur ne doit jamais créer lui-même une action de consentement ou une transition humaine.

Le retour de processInboundMessage contient ignored, duplicate, queuedResponses et, lorsque pertinent, conversationId. La normalisation ne doit pas modifier la sémantique de ces résultats.

### Sender et livraison

Les services de conversation, notification et relance injectent déjà un sender :

```text
sendTextMessage({ phoneNumber, text, idempotencyKey }, { config })
sendTemplateMessage({ phoneNumber, templateName, templateLanguage,
                      templateParameters, idempotencyKey }, { config })
    → Promise<{ providerMessageId: string }>
```

Le sender ne retourne pas delivered, read ou skipped. Il retourne une acceptation transport vérifiée ou lève une erreur structurée. Les services conservent les décisions d’éligibilité, claim atomique, attempts, fenêtre de service, auteur humain et backoff.

Les champs d’erreur reconnus par classifySendError sont code, retryable, acceptanceRejected et uncertain. Les valeurs doivent être explicites ; une erreur inconnue reste incertaine.

### Callback métier

```text
applyStatus({ id, status: sent|delivered|read|failed,
              timestamp?, biz_opaque_callback_data?, errors?: [{ code }] })
    → Promise<boolean>
```

id doit être l’identifiant canonique déjà associé à la livraison. Le champ historique biz_opaque_callback_data est une clé de corrélation interne facultative : il ne faut pas prétendre que Gupshup le transmet. La politique utilise une comparaison conditionnelle et conserve la monotonie des statuts ; elle peut lever WHATSAPP_STATUS_CONFLICT après contention.

### Templates NVA

whatsappTemplates.js associe des clés de notifications à des noms métier, langue fr et paramètres ordonnés. Les deux modèles de relance sont configurés séparément. Ces noms ne sont pas des identifiants Gupshup ; le mapping doit être externe au moteur métier.

## 3. Contrats fournisseur vérifiés

### 3.1 Texte sortant

Requête encodée en application/x-www-form-urlencoded, valeurs JSON sérialisées pour message ; source et destination restent des chaînes dans NVA pour éviter toute conversion numérique destructive. Champs channel=whatsapp, source, destination, src.name, message. Objet de texte : type=text et text. Source : [S1].

Les options de prévisualisation présentent des noms différents entre pages de documentation ; leur encodage exact doit être fixé par un exemple officiel propre à l’endpoint avant de promettre l’équivalence de preview_url=false. Ne pas copier silencieusement le champ Meta. Cette option ne doit pas devenir une condition d’acceptation de message non documentée.

Pour l’endpoint texte documenté : succès HTTP 200 avec status=submitted et messageId non vide. Un 2xx sans identifiant exploitable n’est pas une livraison réussie : le résultat est incertain. Aucun autre statut de réponse ne doit être accepté simplement parce qu’il ressemble à success. Source : [S1].

### 3.2 Modèle texte

Même authentification sortante et encodage formulaire. template contient id et params ; src.name, source et destination sont requis. La page de référence décrit HTTP 202, status=success et messageId ; une autre référence de modèles illustre submitted. Retenir une liste de schémas autorisés **par endpoint et version**, chacun justifié par une référence, et refuser les formes ambiguës sans renvoi automatique. Sources : [S2], [S9].

Catalogue local proposé :

```text
{ provider, applicationKey, businessTemplateName, language,
  providerTemplateId, approvalStatus, parameterNamesInOrder,
  category, enabled, verifiedAt }
```

La langue et le nombre/ordre des paramètres doivent correspondre au modèle réellement approuvé ; aucun fallback vers un autre template ou un texte libre hors fenêtre. APPROVED doit être vérifié avant activation puis invalidé lors d’un événement de désactivation/pause. Les IDs et approbations du compte NVA sont inconnus : aucune requête d’inventaire n’a été faite. Sources : [S8], [S10].

### 3.3 Entrants V2

L’enveloppe comprend app, timestamp, version, type et payload. Pour type=message : payload.id représente l’identifiant WhatsApp entrant, source l’expéditeur et payload le contenu spécifique. Le timestamp d’enveloppe est présenté en millisecondes. Source : [S3].

Mapping NVA : payload.id → id stable ; payload.source → from validé ; texte → text.body ; bouton/liste → interactive.button_reply.title ou interactive.list_reply.title après validation de leur sous-format documenté. Ne pas traiter un postback arbitraire comme du texte métier non vérifié. Les formes quick_reply et button_reply doivent avoir des fixtures distinctes, pas un alias supposé.

Temps : conserver la valeur source et sa provenance dans l’événement normalisé ; convertir des millisecondes valides en chaîne de secondes pour NVA. Si la date fiable manque ou est future, ne pas la remplacer par Date.now pour ouvrir la fenêtre. Le timestamp d’enveloppe décrit la réception fournisseur, pas nécessairement l’émission initiale par l’utilisateur : l’utilisation comme temps de référence NVA doit être explicitement documentée et testée ; une provenance plus précise sera privilégiée si disponible sur le contrat retenu.

Types hors portée : classement unsupported, conservation minimale et absence d’action métier. Aucun téléchargement d’URL de média reçu par le webhook.

### 3.4 Statuts et identifiants V2

La documentation distingue identifiants Gupshup et WhatsApp, donne gsId comme alias pour les accusés et indique que gsId peut manquer au-delà d’une semaine. Les notifications peuvent être désordonnées. Les événements enqueued peuvent fournir whatsappMessageId ; les variantes failed exigent de distinguer identifiant de soumission et alias. Source : [S4].

| Événement fournisseur | Traitement NVA proposé |
|---|---|
| enqueued | Apprendre les alias, enregistrer le fait transport ; ne pas le transformer en SENT |
| sent | Appeler applyStatus avec sent et l’ID canonique |
| delivered | Appeler applyStatus avec delivered |
| read | Appeler applyStatus avec read |
| failed | Appeler applyStatus avec failed et un code normalisé, après résolution certaine de l’essai |
| deleted / inconnu | Conserver/classer sans régression de statut ni suppression métier |

ACCEPTED reste une soumission, pas une livraison. Un enqueued reçu avant la réponse ne doit pas être injecté comme sent ; l’acceptation sera traitée par le chemin de soumission/association prévu.

### 3.5 Erreurs et règles de réessai

Deux mécanismes distincts : réessais de transport des callbacks par Gupshup et réessais d’envoi NVA. La documentation demande un 2xx vide ; un dépassement de dix secondes entraîne une nouvelle tentative fournisseur, mais le calendrier complet et la durée maximale ne sont pas établis par les pages consultées. Ne pas supposer qu’un événement sera rejoué indéfiniment. Source : [S5].

| Observation | Sens établi | Décision NVA proposée |
|---|---|---|
| 400 avec rejet valide | Destination ou paramètres/application invalides [S1, S2] | retryable=false, uncertain=false ; erreur de configuration ou d’entrée, pas de boucle |
| 401 valide | Authentification sortante refusée [S1, S2] | Échec sans retry automatique, alerte sans secret |
| 429 valide sur l’endpoint documenté | Limite de débit [S1] | Réessayable seulement si la réponse prouve le rejet avant acceptation ; sinon incertain |
| Timeout, coupure, 5xx, 2xx sans messageId ou corps inexploitable | Acceptation non établie | uncertain=true, retryable=false, DELIVERY_UNCERTAIN |
| Code d’événement 1002 | Destinataire absent de WhatsApp [S6] | Callback failed, aucune reprogrammation automatique |
| 1003 | Solde insuffisant [S6] | failed et alerte d’exploitation ; pas d’envoi en boucle |
| 1004–1007 | Familles d’échecs de template/opt-in [S6] | failed ; ne pas contourner consentement ou fenêtre |
| Code inconnu | Signification non vérifiée | Conserver le code de manière bornée ; aucun retry ajouté par supposition |

Un code 500 dans un événement fournisseur n’est pas nécessairement le statut HTTP 500 d’une requête d’envoi. Les codes Meta éventuellement encapsulés exigent leur propre catalogue avant interprétation ; aucune règle globale « erreur temporaire = retry ».

La politique NVA existante reste : backoff 60 s / 300 s / 1 800 s selon tentative, plafond configuré, retries uniquement pour rejet temporaire confirmé. Le sender ne dort pas et ne rejoue pas la requête. Une erreur asynchrone failed n’est pas transformée en exception de sender pour déclencher un nouveau retry.

## 4. Interfaces à implémenter, sans changer les règles métier

### Adaptateur pur de transport

```text
createGupshupTransport({ config, fetchImpl, templateCatalog })
  .sendTextMessage(data, options)     → { providerMessageId }
  .sendTemplateMessage(data, options) → { providerMessageId }
```

Contrat compatible avec le sender NVA. Validation locale avant réseau ; hôte HTTPS fixé par configuration contrôlée, jamais issu du webhook. Pas de redirection authentifiée vers un hôte arbitraire. Clé uniquement en en-tête. Fake mode et transport simulé réservés aux tests ; configuration incomplète refusée explicitement. Aucun objet de réponse brut ou message d’erreur fournisseur contenant des données personnelles dans les logs.

Le transport reste sans accès aux décisions de consentement ou statuts. Il n’appelle ni processPending ni une seconde requête pour résoudre un résultat ambigu.

### Normalisateur sans effets de bord

```text
normalizeGupshupEvent(validatedPayload, verifiedApplication)
  → { kind: inbound|status|template|transport|unsupported,
      provider: gupshup, applicationKey, externalIds,
      occurredAt?, occurredAtSource, receivedAt,
      deduplicationKey, data }
```

Validation de version/type, limites de tailles et chaînes, champs obligatoires et unités temporelles. Aucune base, aucun réseau, aucun consentement produit. Aucun faux emballage Meta prétendument signé : le contrôle cryptographique et l’identité d’application sont propres à l’entrée Gupshup.

### Vérificateur de webhook

```text
verifyGupshupWebhook({ rawBody, headers, trustedTransportContext }, config)
  → { verified: true, applicationKey, authenticationMethod }
  ou erreur structurée 401/403/503
```

**Contrat de résultat retenu, mécanisme réel non confirmé.** Les références officielles consultées décrivent HTTPS et une restriction d’IP possible, sans fournir un contrat HMAC utilisable pour cette famille. Aucun en-tête de signature, algorithme ou secret de webhook n’est inventé. Sources : [S5], [S7].

apikey prouve seulement l’authentification de NVA lorsqu’il appelle l’API ; app, source et User-Agent sont falsifiables dans une requête entrante. Le vérificateur doit refuser l’activation si aucune méthode d’authentification acceptable n’a été établie. Une signature créée par notre propre proxy authentifie uniquement le proxy ; elle ne prouve pas rétroactivement l’origine Gupshup sans contrôle amont.

Si un header secret configurable, une signature ou mTLS est confirmé pour le produit retenu, spécifier ensuite le header exact, le calcul éventuel sur corps brut, la rotation et la gestion du rejeu. Une liste d’IP seule nécessite une décision de sécurité explicite et un processus de mise à jour ; aucun support n’a été contacté pour la récupérer.

### Réception HTTP

Proposition : route distincte POST /webhooks/whatsapp/gupshup. Vérification avant tout effet métier ; 1 Mio maximum comme le cadre actuel, contrôle du type de contenu et de l’encodage, conservation du corps brut si nécessaire. Auditer l’ordre des routes : le montage Meta actuel couvre /webhooks/whatsapp.

Après validation : insertion durable transactionnelle → commit → 204 vide. Si stockage indisponible : réponse non-2xx, aucun acquittement de succès. Doublon déjà conservé : 204 sans retraitement simultané. L’événement unsupported authentifié peut être conservé puis acquitté sans action métier. Les fautes d’authentification ne sont pas stockées avec leur corps brut.

L’exemption CSRF reste circonscrite aux routes webhook authentifiées ; les contrôles administrateurs, sessions et CSRF des interfaces humaines restent actifs.

## 5. Corrélation durable et callbacks précoces

### Identifiant canonique et essais

Décision NVA : identifiant sortant canonique, par exemple gupshup:<applicationKey>:<submissionId>. Les composants sont internes/techniques, jamais une clé API. providerMessageId existant reçoit ce canonique ; un registre persistant conserve gsId et identifiant WhatsApp comme alias, avec application, fournisseur, type de livraison, ID local et tentative.

L’identifiant entrant WhatsApp reste stable pour la déduplication actuelle : ne pas ajouter un préfixe différent selon les routes au risque de traiter deux fois le même message reçu via Meta et Gupshup. Phase initiale limitée à un périmètre de numéro/application ; un futur multi-compte exigera une revue des contraintes de déduplication entrante actuelles.

La clé idempotencyKey/deduplicationKey reste une clé locale de demande métier, **pas une garantie fournisseur de non-duplication**. msgid des messages interactifs sert au contexte d’une réponse ; ce n’est pas une preuve de corrélation universelle des accusés. Aucun echo d’une clé client NVA n’est confirmé pour tous les messages.

Les bindings doivent distinguer plusieurs tentatives légitimes d’une même demande. Un callback d’un ancien essai ne doit pas être réécrit sous l’ID du nouvel essai. Toute contradiction avec un essai supposé explicitement rejeté est conservée pour résolution, sans renvoi automatique ni écrasement aveugle.

### Séquence proposée

1. Le service métier acquiert son claim existant, avec le même plafond et filtre temporel.
2. Une couche de coordination du sender crée durablement un essai local, avant l’appel transport. Elle retrouve la livraison par sa clé locale et son type, sans scan par téléphone. Identifiant d’essai unique et compteur observé nécessaires.
3. Le transport appelle une seule fois l’endpoint ; une réponse exploitable fournit submissionId.
4. Le coordinateur associe durablement submissionId/essai, puis retourne le providerMessageId canonique au service, qui conserve son écriture conditionnelle d’acceptation.
5. Les événements sont insérés dans l’inbox dès leur réception authentifiée. Ceux arrivés avant association restent WAITING_CORRELATION.
6. Le traitement attend aussi la disponibilité cohérente du binding sur la livraison ou sa réconciliation conditionnelle avant d’appeler applyStatus. Il évite ainsi qu’un callback change l’ID puis que le retour HTTP le réécrive différemment.
7. Après résolution, appeler le service de statut correspondant au type local, avec le canonique et les données normalisées. Ne pas envoyer aveuglément chaque événement à toutes les tables.

Le contrat du coordinateur doit inclure kind, deliveryId et attemptNumber, acquis à partir du contexte local vérifié. Ce contexte n’est pas actuellement passé explicitement au sender : sa transmission ou sa résolution par repository est un changement d’orchestration à concevoir et tester, **pas une capacité déjà disponible**.

Cas sans réponse HTTP et sans clé client renvoyée : l’événement peut rester impossible à relier à une livraison locale. Le conserver en attente/quarantaine, classer l’envoi DELIVERY_UNCERTAIN et alerter. Ne jamais deviner l’association par numéro, corps ou heure. Ni l’inbox ni la table d’alias ne garantissent à elles seules la résolution de ce cas.

Un délai fournisseur annoncé de quelques secondes dans une page ne remplace pas ce mécanisme ; aucune hypothèse d’ordre ou de délai minimal du réseau n’est requise.

## 6. Réception durable et besoins de migration

Le schéma actuel fournit un seul providerMessageId par livraison, pas d’inbox générique ni de registre multi-alias/essais. **Une évolution de stockage est recommandée pour le périmètre complet**, à autoriser et concevoir séparément. Aucun fichier de migration ni modification schema.prisma réalisé ici.

Modèles conceptuels proposés :

| Objet | Données minimales et contraintes |
|---|---|
| ProviderWebhookEvent | fournisseur, application, clé de déduplication, type, dates/provenance, payload minimal protégé, état de traitement, compteur, échéance de traitement, bail et erreur technique bornée ; unicité fournisseur/application/dedupKey |
| ProviderSendAttempt | type et ID de livraison, numéro de tentative, fournisseur/application figés, clé locale, état de soumission et ID canonique optionnel ; unicité de l’essai local |
| ProviderMessageAlias | fournisseur/application, type d’identifiant, identifiant externe, essai lié ; unicité fournisseur/application/type/valeur, conflit explicite plutôt que réassociation silencieuse |

Les références aux trois types de livraison doivent avoir une stratégie d’intégrité réelle (relations typées/exclusivité ou équivalent), pas un couple polymorphe incontrôlé. Les états d’inbox sont des états techniques, distincts des statuts de livraison ; ils ne donnent aucun droit d’envoi supplémentaire.

Worker inbox : bail conditionnel pour éviter les traitements simultanés, reprise après crash, retries de traitement bornés, quarantaine et métriques pour les associations absentes. Le retry d’un événement ne rejoue jamais un envoi. Réserver la séquentialité utile des entrants d’une même conversation ; traiter les statuts désordonnés avec la politique monotone existante, sans ordre global artificiel.

Sémantique : réception/traitement au moins une fois et effets idempotents, pas promesse d’exactement une fois. Les services actuels ouvrent leurs propres transactions ; sans refonte de ces limites, effet métier et marquage inbox ne sont pas un commit unique. Après un crash entre les deux, rejouer l’événement et laisser déduplication/CAS empêcher le double effet, puis marquer l’inbox. Un false de applyStatus dû à une association absente n’est pas « traité avec succès ».

Conservation : privilégier payload normalisé minimal, accès restreint, protection du stockage, suppression planifiée des contenus et durée des alias compatible avec les callbacks tardifs. Durées et stratégie de chiffrement à valider selon l’exploitation ; les logs ne contiennent ni payload, ni téléphone complet, ni secret. La rétention exacte n’est pas une garantie publiée par Gupshup.

Une implémentation initiale des encodeurs/normalisateurs purs peut être faite sans migration et sans base, mais elle ne constitue pas une intégration exploitable sans ces garanties de réception/corrélation.

## 7. Sélection du fournisseur et invariants métier

Configuration proposée, noms à finaliser : WHATSAPP_PROVIDER=meta|gupshup, GUPSHUP_APPLICATION_KEY, GUPSHUP_APP_NAME, GUPSHUP_SOURCE, GUPSHUP_API_KEY, version de webhook et configuration d’authentification entrante une fois prouvée. Aucun .env créé ou modifié. Séparer validation Meta et Gupshup : les IDs Meta ne doivent pas être exigés pour envoyer via Gupshup.

La sélection se fait dans la composition des dépendances ; aucun fallback réseau automatique. Le fournisseur/application d’un essai existant reste figé, même si la configuration active change. Les anciens callbacks doivent rester traitables pendant une bascule contrôlée ; ne pas réémettre les ACCEPTED ou DELIVERY_UNCERTAIN. Aucune modification des valeurs historiques Meta n’est nécessaire au simple ajout du fournisseur.

Invariants non négociables : consentement explicite conservé ; un opt-in fournisseur n’équivaut pas à un consentement commercial NVA ; STOP et contrôle humain prioritaires ; claim atomique et compteurs inchangés ; fenêtre de service non étendue ; backoff conservé ; pas de retry après acceptation incertaine ; aucune régression READ/DELIVERED ; déduplication des entrants et réponses maintenue ; transport incapable de contourner ces contrôles.

## 8. Fichiers à créer ou modifier après autorisation

| Action | Fichier proposé | Portée |
|---|---|---|
| Créer | src/services/providers/gupshupTransport.js | Encodeurs, transport injecté, réponse/erreur normalisée |
| Créer | src/services/providers/gupshupEventNormalizer.js | Validation et conversion sans I/O |
| Créer | src/services/providers/gupshupWebhookVerifier.js | Authentification, implémentation bloquée tant que méthode non établie |
| Créer | src/services/whatsappProvider.js | Composition explicite des senders |
| Créer | src/services/whatsappProviderSendCoordinator.js | Essais locaux et bindings ; pas de nouvelle règle métier |
| Créer | src/services/whatsappProviderInboxService.js | Réception durable, idempotence et attente de corrélation |
| Créer | src/services/whatsappProviderCorrelationService.js | Alias et résolution d’essais |
| Créer | src/jobs/whatsappProviderInboxWorker.js | Traitement inbox, sans réémission de message |
| Créer | src/controllers/gupshupWebhookController.js, src/routes/gupshupWebhookRoutes.js | Entrée HTTP distincte |
| Créer | src/config/gupshupTemplates.js | Mapping par application/langue, sans vrais IDs dans les fixtures |
| Modifier | src/config/whatsappConfig.js | Configuration discriminée par fournisseur |
| Modifier | src/app.js, src/middlewares/csrfProtection.js | Routage, corps brut et exemption strictement ciblée |
| Modifier | Les trois services de livraison | Raccordement des senders/contexte local, sans toucher claims, backoff ou décisions |
| Examiner | whatsappWebhookService.js, worker/CLI existants | Point de dispatch partagé et composition, pas réutilisation de la signature Meta |
| Concevoir plus tard | prisma/schema.prisma et migration dédiée | Inbox/essais/alias, uniquement après autorisation séparée |

Le moteur conversationnel, whatsappHumanHandoffService, whatsappPreferenceService, whatsappServiceWindow et whatsappDeliveryPolicy doivent rester inchangés dans la cible initiale. Toute nécessité découverte de changer leur logique doit être expliquée avant implémentation.

## 9. Plan d’implémentation et tests d’acceptation

1. **Valider cette spécification et fermer les points de contrat** : disponibilité Self-Serve, auth entrante, écho de corrélation éventuel, variantes de réponses, modèles et timestamps.
2. **Implémenter les modules purs**, après autorisation : encodeurs, catalogue synthétique, normalisateur, erreurs ; tests sans réseau ni base.
3. **Tester la frontière de transport avec fetch simulé** : forme exacte URL/headers/formulaire, secret non journalisé, réponse acceptée seulement selon schéma, 400/401/429/5xx, timeout, JSON invalide, 2xx sans ID ; une seule requête par appel, aucune bascule.
4. **Valider le design du stockage**, puis autoriser séparément schéma/migration/permissions et environnement d’essai. Générer un client cohérent et tester les repositories sur une cible dédiée autorisée.
5. **Implémenter l’inbox et le coordinateur** : callback avant réponse, avant association, après association mais avant commit d’acceptation, perte de réponse, alias manquant/conflictuel, ancien essai, événement tardif sans gsId, crash et rejeu. Aucun rapprochement par donnée personnelle.
6. **Implémenter l’authentification HTTP prouvée** : mauvaises preuves, mauvaise application, version inconnue, corps modifié, limites/compression, panne inbox, doublon durable. Aucune action avant authentification/validation ; aucun succès HTTP avant commit.
7. **Non-régression métier** : consentement, opt-out, contrôle humain, fenêtre, réservations concurrentes, backoff et terminalité ; conservation des horloges de test cohérentes. Refaire la suite isolée pertinente, puis les 14 tests PostgreSQL seulement avec autorisation.
8. **Activation fournisseur séparée** : aucun compte réel ni appel externe avant accord ; revue secrets, modèles approuvés, auth webhook, corrélation et bascule. Fake mode interdit en production.

Tests supplémentaires indispensables : conversion ms/secondes sans timestamp futur artificiel ; événements dupliqués et désordonnés ; READ jamais écrasé ; callbacks sans correspondance conservés ; deux workers inbox, deux workers livraison ; absence d’augmentation de tentatives d’envoi lors d’un retry inbox ; réponse incertaine sans retry ; template désactivé sans fallback ; séparation Meta/Gupshup et d’applications ; contrôle des logs sans données sensibles.

## 10. Points ouverts et risques bloquants

| Point ouvert | Risque / décision attendue |
|---|---|
| Authentification entrante non prouvée | Injection de faux messages/statuts ; interdit d’activer un endpoint métier public sans solution acceptable |
| Écho d’une clé client absent du contrat confirmé | Envoi accepté mais réponse perdue parfois impossible à relier ; conserver l’incertitude plutôt qu’inventer une association |
| Versions/réponses de templates divergentes entre pages | Un parseur trop permissif pourrait déclarer une acceptation incorrecte ; fixtures par contrat |
| Instant original utilisateur vs réception Gupshup | Fenêtre métier potentiellement surestimée lors d’un retard ; préciser provenance, ne pas prendre notre heure de réception comme preuve |
| Alias tardifs et durée de rejeu | Événements non corrélables si suppression prématurée ; rétention à approuver |
| Plafonds et retries de webhook incomplets | Perte si dépendance exclusive aux retries fournisseur ; réception durable nécessaire |
| Modèles approuvés NVA inconnus | Impossible de garantir les relances réelles tant que mapping/langue/paramètres non validés |
| Bascule avec essais en cours | Doubles envois ou callbacks perdus ; pas de fallback automatique |
| Nouveaux stockages de payloads | Exposition de données ; minimisation, protection, contrôle d’accès et rétention requis |

Décisions confirmées : points d’injection NVA, famille d’API candidate documentée, enveloppes V2, distinction des IDs, auth sortante et politiques métier existantes. Décisions de conception proposées : canonique, inbox, essais, alias et composition explicite. Capacités non confirmées : auth entrante, corrélation client complète et contrats exacts du compte futur.

## Sources officielles consultées

Les liens ci-dessous sont de la documentation publique ; aucun endpoint API ni compte Gupshup n’a été appelé. Les fragments de contrats de ce document sont paraphrasés ; aucun exemple contenant de vrais identifiants n’est repris.

- [S1 — Texte de session](https://docs.gupshup.io/reference/session-text-message) et [référence générale](https://docs.gupshup.io/reference/msg) : endpoint, formulaire, authentification, réponses.
- [S2 — Modèle texte](https://docs.gupshup.io/reference/sending-text-template) : template.id/params, codes HTTP et schéma de réponse.
- [S3 — Message entrant](https://docs.gupshup.io/docs/what-is-an-inbound-message) : enveloppe, identifiants, temps et types.
- [S4 — Événements de message V2](https://docs.gupshup.io/docs/message-events) : IDs, gsId, événements et désordre.
- [S5 — Webhook Key Points](https://docs.gupshup.io/docs/what-is-a-webhook) : acquittement, délai et restriction réseau possible.
- [S6 — Erreurs fournisseur](https://docs.gupshup.io/docs/error-and-status-messages) : significations des codes spécifiques.
- [S7 — Configuration du callback](https://docs.gupshup.io/docs/set-webhookcallback-url) : configuration publique, sans preuve suffisante d’un HMAC dans les éléments consultés.
- [S8 — Inventaire des modèles d’une application](https://docs.gupshup.io/reference/get-all-templates-for-an-app) : filtrage par statut, langue, type et catégorie.
- [S9 — Postback text](https://docs.gupshup.io/reference/postback-text-support) : variante submitted et forme de réponse interactive.
- [S10 — Événements de templates](https://docs.gupshup.io/docs/system-events) : approbation, désactivation et pause.

## Intervention réalisée et point d’arrêt

Seul ce document technique a été créé. Aucun code métier/test, schéma, migration, base, permission ou fichier .env modifié. Aucun secret utilisé, aucun appel API Gupshup/Meta, aucun test ni déploiement effectué.

Attente de l’autorisation de l’utilisateur avant toute implémentation. L’approbation du document ne constitue pas une preuve que les points ouverts fournisseur sont déjà résolus.
