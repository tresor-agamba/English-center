# NVA — Phase 2 Gupshup, simulation uniquement

Date : 16 octobre 2026. Référence : docs/gupshup-phase1-contracts.md.

## Résultat

Les composants de transport, normalisation, vérification et corrélation simulés sont implémentés. **239 tests isolés réussis, zéro échec, zéro ignoré et zéro annulé.** Aucun raccordement aux routes, à la configuration active ou aux workers de l’application.

Aucun code préexistant n’a été modifié. Les empreintes des fichiers existants sous src, tests et prisma, de .env, package.json et package-lock.json sont identiques avant/après intervention. Les assertions existantes restent intactes.

## Fichiers créés

| Fichier | Responsabilité |
|---|---|
| src/services/providers/gupshupSimulation.js | Transport mémoire à réponses prédéfinies ; journal de requêtes accessible uniquement en mémoire |
| src/services/providers/gupshupTransport.js | Sender compatible NVA pour texte et modèles, identifiants canoniques et erreurs |
| src/services/providers/gupshupEventNormalizer.js | Validation et conversion des événements V2 sans I/O |
| src/services/providers/gupshupWebhookVerifier.js | Refus explicite de tout webhook tant que son authentification n’est pas établie |
| src/services/providers/gupshupMemoryCorrelation.js | Prototype mémoire d’inbox, bindings et alias, réservé à la simulation |
| tests/gupshupPhase2.test.js | 37 tests isolés de contrats, de sécurité et d’injection dans les services existants |
| Le présent rapport | Périmètre, résultats et limites |

Rapports de vérification : output/gupshup-phase2-before.json, output/gupshup-phase2-isolated.json, output/gupshup-phase2-isolated.log et output/gupshup-phase2-invariants.json.

**Fichiers préexistants modifiés : aucun.** Aucun script npm n’est ajouté ou modifié. La nouvelle suite a été sélectionnée explicitement pour cette validation.

## Contrat du transport simulé

createGupshupTransport exige mode=simulation et une instance créée par createGupshupSimulation. Un objet doté arbitrairement d’une méthode request, global.fetch ou une fonction réseau injectée n’est pas accepté comme simulation. Le mode live et NODE_ENV=production sont refusés. Il n’existe aucun fallback vers fetch.

Les requêtes sont des objets conservés en mémoire : URL sous le domaine réservé gupshup.invalid, en-tête apikey=simulation-only, aucun véritable identifiant ou secret. Aucun appel HTTP n’est effectué, y compris vers ce domaine.

Les deux méthodes respectent les signatures d’injection des services NVA :

```text
sendTextMessage({ phoneNumber, text, idempotencyKey }, options?)
sendTemplateMessage({ phoneNumber, templateName, templateLanguage,
                      templateParameters, idempotencyKey }, options?)
  → Promise<{ providerMessageId }>
```

La configuration est fixée à la création ; le second argument historique des services est compatible mais ne permet pas de remplacer le transport ou la configuration simulée. Les formulaires reproduisent le contrat étudié, sans envoyer une clé locale comme si le fournisseur garantissait son echo.

Texte : entrée validée, chaîne internationale, longueur maximale 4096 ; simulation de réponse HTTP 200/status=submitted avec messageId. Modèles : application, nom métier, langue, approbation APPROVED, activation, identifiant et ordre/nombre de paramètres validés ; réponse simulée 202/status=success ou submitted selon les variantes retenues en phase 1. Aucun modèle réel approuvé n’est prétendu disponible. Les options réelles de preview restent hors contrat implémenté.

Identifiant canonique : gupshup:<applicationKey>:<submissionId encodé>. Un succès de transport ne signifie jamais delivered/read.

Erreurs compatibles avec classifySendError existant :

- 400/401 avec un corps de rejet cohérent : échec non réessayable, acceptation rejetée.
- 429 avec rejet explicite et sans identifiant d’acceptation : réessayable par le service appelant, sans retry interne.
- Timeout logique simulé, panne réseau simulée, 5xx, réponse incohérente, 2xx sans ID : DELIVERY_UNCERTAIN, aucun renvoi automatique.

Les erreurs retournées ne contiennent pas le corps fournisseur, le destinataire ou une URL authentifiée. Les timeouts sont des résultats de mock ; aucun délai réel ni mécanisme réseau de timeout de production n’est implémenté.

Une opération locale déjà en cours ou acceptée partage sa promesse pour une même clé et un même payload ; une répétition ne consomme pas une seconde réponse du mock. Les erreurs permanentes et incertaines restent mémorisées. Un rejet temporaire explicite libère uniquement la tentative, pour un nouvel appel décidé par le service ; le fingerprint du payload reste contrôlé. Cette protection est limitée à l’instance en mémoire, sans prétendre garantir l’idempotence Gupshup ou une reprise après redémarrage.

## Normalisateur V2

normalizeGupshupEvent reçoit un objet de fixture, une application attendue et receivedAt explicite. Il n’authentifie pas la provenance. Contrôles : version 2, application exacte, types/champs, timestamps numériques valides, taille maximale de 1 Mio et profondeur maximale pour l’identité canonique.

Prise en charge :

- Texte entrant → id WhatsApp stable, from, text.body et timestamp converti des millisecondes en secondes.
- button_reply/list_reply → titres vers la structure interactive correspondante ; quick_reply possède sa propre forme text. postbackText n’est pas injecté arbitrairement dans le moteur.
- Date absente ou future → aucune date inventée pour ouvrir une fenêtre de service.
- sent/delivered/read/failed → statut normalisé, dates/provenance et IDs distincts Gupshup/WhatsApp ; codes d’erreur bornés et préfixés.
- enqueued → événement transport et apprentissage d’alias, sans conversion en SENT.
- Types inconnus, médias hors portée et autres événements → unsupported, conservés dans le prototype sans action métier ni téléchargement.

La clé de déduplication est calculée à partir d’un JSON canonique : un changement d’ordre des propriétés ne crée pas un nouvel événement. Des changements réels de données ou de timestamp peuvent produire une autre clé ; l’idempotence des effets métier reste nécessaire.

Les fixtures interactives implémentent les formes convenues pour les tests ; la conformité de tous les variants réellement émis par le futur produit/compte doit encore être confirmée avant activation. La provenance du timestamp d’enveloppe est conservée : il ne devient pas une preuve supplémentaire de l’heure d’émission utilisateur.

## Vérification des webhooks

verifyGupshupWebhook lève toujours GUPSHUP_WEBHOOK_AUTH_UNAVAILABLE avec statut 503, quel que soit le mode ou les prétendues preuves fournies. Aucun bypass de test, signature HMAC inventée, confiance dans app/User-Agent/URL ou drapeau verified n’est introduit.

Aucune route Express Gupshup, exemption CSRF ou réception HTTP réelle n’a été ajoutée. Le normalisateur peut être testé directement sur des fixtures ; il ne rend pas une requête réelle authentique.

## Corrélation et réception mémoire

createGupshupMemoryCorrelation expose bind, receive, process et inspect, en mode simulation uniquement :

- bind associe fournisseur/application, ID Gupshup, alias WhatsApp facultatif, type de livraison, ID local et numéro de tentative.
- Les conflits d’alias ou changements de livraison/tentative pour un même binding sont refusés avant réassociation.
- receive conserve une copie de l’événement et déduplique sa réception ; inspect retourne également une copie.
- Un événement sans binding reste WAITING_CORRELATION ; aucun rapprochement par téléphone, contenu ou heure.
- Un callback précoce attend aussi ready=true, représentant la disponibilité du binding local ; il reste WAITING_BINDING jusque-là.
- Les alias WhatsApp peuvent être appris depuis une soumission connue, puis servir à traiter un statut sans gsId.
- process transmet uniquement le callback normalisé et le binding à un handler injecté ; il n’appelle aucun sender ni service réel par défaut.
- Une prise en charge false n’est pas assimilée à un succès ; une exception laisse l’événement retraitable. Deux traitements concurrents du même événement ne déclenchent pas deux handlers simultanés dans ce prototype.
- Les événements unsupported/inbound sont RETAINED, pas exécutés comme actions métier.

**Ce stockage n’est pas durable.** Un redémarrage perd toutes ses données. Il ne garantit ni transaction SQL, ni bail multi-processus, ni exactly-once. Il prépare les contrats d’une réception durable sans simuler une garantie de production inexistante.

Le routage du callback reçoit deliveryKind/deliveryId/attemptNumber ; un futur coordinateur devra s’assurer qu’il s’agit du bon essai actif et que le binding de la livraison est effectivement disponible. Le drapeau ready du mock ne prouve pas cet état dans une base réelle.

## Tests et non-régression

Exécution directe de node --test avec liste explicite : les 12 fichiers déjà sélectionnés par test:whatsapp:isolated, tests/whatsappFixtureClock.test.js et tests/gupshupPhase2.test.js. Aucun npm test, test PostgreSQL ou runner de préparation/reset exécuté.

Résultat final : **239/239 réussis**, dont **37 nouveaux tests Gupshup**, les 198 tests de la sélection WhatsApp existante et les 4 tests d’horloge. Code 0 ; durée Node 829,6122 ms. Les premières erreurs de développement des nouveaux modules ont été corrigées avant cette validation finale ; aucun test existant n’a été ajusté.

Couverture nouvelle : texte, modèles et mapping de paramètres, payload invalide, numéros de type incorrect, mode réel refusé, faux transport refusé, replay/concurrence locale sans double envoi, erreur permanente/temporaire, timeout/panne/5xx/réponse ambiguë, V2/interactifs/temps, absence de consentement inventé, webhook toujours refusé, inconnus conservés, JSON réordonné, callback précoce, perte de réponse non corrélable, conflit d’alias, isolation d’applications, handler indisponible et replay.

Deux tests utilisent réellement les fabriques NVA avec des repositories mémoire et le sender simulé : le service conversation conserve un seul worker gagnant ; le service de relance envoie avec consentement GRANTED et annule avec REVOKED sans atteindre le transport. Un autre test injecte les callbacks normalisés dans applyDeliveryStatus existant et confirme que READ ne régresse pas après sent/delivered/failed.

Les suites HTTP existantes utilisent uniquement leurs serveurs locaux de test et leurs mocks ; aucun service Meta ou Gupshup n’est contacté. Les modules fournisseurs nouveaux n’importent ni réseau, ni PostgreSQL, ni Prisma. Les singletons historiques importés dans certains tests ne sont pas connectés.

## Points bloquants et proposition de stockage futur

1. Authentification entrante : mécanisme officiel acceptable toujours non établi. Toute activation webhook reste refusée.
2. Réponse HTTP perdue : sans binding ni identifiant client renvoyé de manière garantie, certains callbacks ne sont pas associables. Ils restent en attente ; aucun rapprochement spéculatif ou renvoi.
3. Réception durable et mapping : indispensables avant une intégration opérationnelle, non fournis par le mock mémoire.
4. Modèles réellement approuvés, variantes d’événements, provenance temporelle et contrat de réponse du produit choisi : à confirmer avant compte réel.

Proposition pour une phase ultérieure, soumise à autorisation : modèles persistants ProviderWebhookEvent, ProviderSendAttempt et ProviderMessageAlias décrits dans le document de phase 1 ; unicités par fournisseur/application/identifiant, relations locales contrôlées, attente de corrélation, bail de traitement, reprise, rétention et protection des payloads. Leur mise en œuvre nécessiterait une revue de schema.prisma, une migration dédiée, une génération client et une revue de permissions — **aucune de ces actions n’a été réalisée**.

## Point d’arrêt

La phase 2 simulée est livrée sans activation. Aucun fichier métier préexistant, assertion existante, migration, base, permission, .env, HBA ou rôle modifié. Aucun accès à PostgreSQL 5432 ou 55432, aucun véritable identifiant, aucun appel Meta/Gupshup, aucun reset ni déploiement.

Attente de l’autorisation de l’utilisateur avant toute intégration durable, évolution de schéma ou activation réelle.
