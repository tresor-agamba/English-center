# WhatsApp Cloud API

English-center utilise des modèles pour les notifications transactionnelles et les relances commerciales, ainsi que des réponses texte du chatbot dans la fenêtre de service. Les modèles doivent être approuvés côté Meta. Les notifications `IN_APP` restent la source principale et fonctionnent lorsque WhatsApp est désactivé.

## Configuration

Copier les variables de `.env.example`. Activer `WHATSAPP_ENABLED=true` seulement après avoir renseigné la version Graph API, le Phone Number ID, le token d’accès, le token de vérification et le secret de l’application. Aucun secret ne doit être commité.

Dans Meta for Developers, créer une application Business, ajouter WhatsApp, récupérer le Phone Number ID, puis configurer :

- URL de callback : `https://votre-domaine/webhooks/whatsapp`
- token de vérification : valeur privée de `WHATSAPP_VERIFY_TOKEN`
- champ webhook : `messages`
- secret de signature : `WHATSAPP_APP_SECRET`

Le canal activé exige aussi `WHATSAPP_BUSINESS_ACCOUNT_ID`, correspondant à l'identifiant WABA dans `entry[].id`, et `WHATSAPP_PHONE_NUMBER_ID`, correspondant à `changes[].value.metadata.phone_number_id`. Ces deux identifiants numériques sont obligatoires, y compris en mode simulé (utiliser alors des valeurs factices). Au démarrage, une configuration activée incomplète est refusée ; le canal désactivé n'exige pas de secrets.

Les requêtes POST sont refusées avec HTTP 403 lorsque le canal est désactivé, 401 lorsque la signature est absente ou incorrecte, 400 lorsque l'événement est malformé, 403 lorsque le compte ou le numéro destinataire diffère, et 503 lorsque la configuration activée est invalide. Une erreur de traitement après validation retourne 500. La signature HMAC SHA-256 est vérifiée sur le Buffer brut ; une clé absente ou vide n'est jamais utilisée. Les corps compressés sont refusés par le parseur JSON afin de ne pas vérifier des octets décompressés. L'événement est reparsé depuis les octets authentifiés et tout le lot est validé avant l'appel des services de persistance. Les GET de vérification sont également refusés lorsque le canal est désactivé.

Tests de réception isolés, sans dotenv, migration, base réelle ni appel Meta :

```bash
node --test tests/whatsappWebhookSecurity.test.js
```

Cette suite monte uniquement le routeur WhatsApp dans un serveur HTTP local et remplace les services de persistance par des mocks. Elle ne démarre pas l'application NVA ni ses workers. Son succès ne constitue pas une validation de production.

Créer et faire approuver les modèles listés dans `src/config/whatsappTemplates.js`, initialement en langue `fr`. Le nombre et l’ordre des variables doivent correspondre à la configuration du projet.

## Consentement

Un numéro de profil ne vaut jamais consentement. L’utilisateur doit accepter explicitement le canal, ou un administrateur doit enregistrer une source autorisée. Un retrait annule les livraisons futures sans supprimer l’historique ni les notifications internes.

## Exécution

```bash
npm run whatsapp:process
```

Cette commande traite un lot des trois circuits puis s’arrête. Elle peut être lancée par cron. Le serveur NVA lance également un poller toutes les 10 secondes. Avec `WHATSAPP_ENABLED=false`, aucun envoi n'est pris en charge. Les réclamations atomiques en base protègent contre deux workers concurrents ; le verrou du poller est seulement local au processus.

## Fiabilité et réconciliation

Les notifications et relances sont sélectionnées uniquement en `PENDING`, les réponses du chatbot en `QUEUED`, à échéance et sous le plafond `WHATSAPP_MAX_ATTEMPTS`. La prise en charge atomique passe la ligne en `PROCESSING` et incrémente son compteur ; une expiration ou une annulation découverte après cette prise en charge peut donc consommer une tentative sans appel au fournisseur.

- Un rejet permanent reste `FAILED`, sans reprise automatique.
- Un HTTP 429 constitue le seul rejet temporaire actuellement autorisé pour une reprise automatique : le transport indique explicitement l'absence d'acceptation (`acceptanceRejected`). Les délais sont 1 minute, 5 minutes puis 30 minutes selon la tentative, sans dépasser le plafond configuré.
- Un timeout, une réponse perdue, un HTTP 5xx, une exception de transport inconnue ou une erreur de persistance après succès deviennent `FAILED` avec `failureCode=DELIVERY_UNCERTAIN`. Aucun nouvel envoi automatique n'est autorisé.
- Un `PROCESSING` abandonné depuis plus de 15 minutes devient également incertain, même si le plafond de tentatives est atteint. Il n'est jamais remis automatiquement en attente.

Les trois circuits transmettent une clé dans `biz_opaque_callback_data` afin de retrouver la ligne lorsque l'identifiant fournisseur n'a pas été enregistré. Cette clé est une corrélation, pas une garantie de déduplication chez Meta. Un callback authentifié peut réconcilier une ligne incertaine vers `SENT`, `DELIVERED` ou `READ`. Les mises à jour conditionnelles empêchent les callbacks concurrents de dégrader un état plus avancé ; un `failed` ne remplace pas `DELIVERED` ou `READ`. Une preuve de livraison ou de lecture pour le même identifiant fournisseur peut également corriger un callback d'échec précédent. Les annulations restent terminales.

La relance administrative reste disponible pour les nouveaux rejets permanents identifiés, sans identifiant fournisseur et sous le plafond d'essais. Les résultats incertains et les anciens échecs dont la sûreté n'est pas démontrée sont refusés et nécessitent une revue. Les anciennes lignes `FAILED` ne sont ni modifiées ni automatiquement reclassées par cette évolution.

La fenêtre de 24 heures est calculée depuis le plus récent horodatage fournisseur valide des messages entrants, pas depuis `lastMessageAt` qui reste l'activité locale affichée dans l'administration. Les nouveaux messages sans horodatage fiable, ou avec une date future, ne fabriquent pas de fenêtre à partir de l'heure de réception. Les dates de remplacement déjà enregistrées par une ancienne version ne peuvent pas être distinguées des dates fournisseur sans revue des données historiques.

Tests isolés, sans base réelle ni appel Meta :

```bash
node --test tests/whatsappDeliveryReliability.test.js tests/whatsappConversationDelivery.test.js tests/whatsappProspectFollowUp.test.js tests/whatsappConversationPersistence.test.js tests/whatsappWebhookSecurity.test.js tests/whatsappConversationEngine.test.js tests/whatsappAdminConversations.test.js tests/whatsappPreferenceOptOut.test.js
```

Une annulation ne peut pas rappeler un appel réseau déjà transmis. Une ligne incertaine sans callback peut rester sans résultat confirmé. Cette politique réduit les doublons au prix de certains envois non repris ; elle ne garantit pas une livraison exactement une fois. Les propriétés de concurrence PostgreSQL et les callbacks réels doivent encore être vérifiés en intégration contrôlée. Aucune migration n'est nécessaire à cette évolution.

Pour les tests locaux, utiliser `WHATSAPP_FAKE_MODE=true` avec des valeurs factices pour le token de vérification et le secret. Ce mode ne réalise aucun appel réseau et est refusé en production.

## Rotation et arrêt

Pour tourner le token, créer le nouveau token côté Meta, remplacer `WHATSAPP_ACCESS_TOKEN`, redémarrer uniquement le worker, vérifier un envoi, puis révoquer l’ancien token. Pour désactiver immédiatement le canal, définir `WHATSAPP_ENABLED=false`.

## Relances commerciales des prospects

Le consentement aux relances commerciales est distinct de la préférence du formulaire d'inscription, qui concerne les informations liées à l'inscription. Le chatbot propose l'accord uniquement lorsqu'une demande d'information commerciale est en cours et que les deux noms de modèles de suivi sont configurés. Le prospect doit répondre exactement `OUI RELANCES` après cette demande. Un message entrant ordinaire ne vaut pas accord.

Créer dans WhatsApp Manager deux modèles de catégorie Marketing, en français, sans variable, faire approuver leur contenu par Meta, puis configurer leurs noms exacts dans `WHATSAPP_PROSPECT_FOLLOW_UP_24H_TEMPLATE` et `WHATSAPP_PROSPECT_FOLLOW_UP_72H_TEMPLATE`. Tant que les deux noms ne sont pas renseignés, le chatbot ne demande pas cet accord et aucune relance n'est planifiée. Le code ne peut pas vérifier l'approbation Meta : elle doit être confirmée dans WhatsApp Manager.

Après un accord valide, les deux envois sont planifiés 24 h et 72 h après son enregistrement. Ils sont annulés au retrait `STOP`, au transfert humain et dès qu'une inscription est enregistrée. Les envois utilisent les modèles approuvés, même si la fenêtre de service est ouverte. La migration additive `20261009150000_add_whatsapp_prospect_follow_ups` doit être appliquée et Prisma Client régénéré avant d'activer cette fonctionnalité.


## Erreurs courantes
- modèle ou langue non approuvé ;
- Phone Number ID incorrect ;
- token expiré ;
- signature webhook invalide ;
- consentement absent ;
- numéro non conforme à E.164 ;
- paramètres différents de ceux du modèle approuvé.

Les payloads, tokens, numéros complets et liens privés de réunion ne doivent jamais être journalisés.
