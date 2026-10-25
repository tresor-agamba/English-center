# Implémentation locale NVA WhatsApp V2

## Architecture et périmètre

Le webhook, l’inbox et le worker existants restent les seuls points d’entrée. `whatsappConversationService` conserve l’orchestration transactionnelle et la livraison existante. Le parcours commercial reste soumis au réglage existant `admissionsEnabled` ; aucun réglage enregistré n’a été activé.

`whatsappCommercialIntents.js` fournit normalisation, synonymes, corrections bornées par distance de Levenshtein, détection de plusieurs intentions et réponses commerciales officielles. Il n’appelle aucune API. Les admissions exploitent ces résultats ; les scénarios et règles historiques continuent à fonctionner. Les inconnus V2 utilisent un repli déterministe avant tout ancien repli IA, avec transfert après trois échecs consécutifs. Une substitution ultérieure du fournisseur d’intentions peut être faite sans changer le transport ou l’inscription.

## Fonctionnalités implémentées

- Accueil officiel unique pour Menu et salutations, trois boutons avec clés internes stables et jetons empêchant le rejeu d’anciens choix.
- « Poser une question », réponses libres et boutons contextuels ; questions multiples sur les sujets commerciaux et sessions.
- Communication officielle anglais : 60 USD par niveau, 180 USD pour trois niveaux, certificat 20 USD, total 200 USD ; cinq essais inclus dans les seize séances ; minimum 30 USD et solde avant la fin ; 24 heures par niveau, 72 heures au total ; aucune accréditation inventée.
- Dates, niveaux, horaires et disponibilités obtenus des services métier existants, sans dates de session codées en dur.
- Deux méthodes d’inscription explicites, saisie libre du choix et compréhension de « la deuxième » dans le contexte de sélection.
- Collecte consentie, validation d’identité, formation active, session et groupe disponibles, récapitulatif et correction. Une question pendant la collecte conserve le brouillon ; le passage au site efface ce brouillon.
- En l’absence de session, possibilité d’une demande à examiner par un conseiller, clairement dépourvue de session réservée. Aucune promesse de notification WhatsApp automatique.
- Préférence formation/session/groupe conservée dans l’historique administratif ; nouvelle validation métier dans la transaction d’enregistrement. Aucun compte ou mot de passe créé par le chatbot.
- Le message envoyé après enregistrement utilise le statut effectivement retourné par le service, y compris au rejeu d’une demande déjà traitée.
- Expiration contrôlée à la lecture ; durée configurable à la construction du parcours (`conversationTtlMs`, 24 heures par défaut, de 1 minute à 7 jours). Reprise et pause humaine existantes conservées.
- Réponses dépassant 1 024 caractères envoyées en texte avec choix numérotés, plutôt qu’un corps interactif tronqué.

## Fichiers

Créés :

- `src/services/whatsappCommercialIntents.js`
- `tests/whatsappCommercialV2.test.js`
- `tests/fixtures/nvaCommercialEvaluation.cjs`
- `docs/nva-whatsapp-v2-audit.md`
- `docs/nva-whatsapp-v2-implementation.md`

Modifiés :

- `src/services/whatsappAdmissionJourney.js`
- `src/services/whatsappAdmissionService.js`
- `src/services/whatsappConversationEngine.js`
- `src/services/whatsappConversationService.js`
- `views/admin/whatsapp/admission.ejs`
- `tests/whatsappAdmissions.test.js`
- `tests/whatsappHumanHttp.test.js`
- `tests/metaInboxWorker.test.js`
- `package.json`

Les journaux locaux de validation sont dans `output/nva-v2-release-tests.log` et `output/nva-v2-evaluation.log`. Aucun nouveau paquet installé. Aucun fichier de migration ou schéma Prisma modifié : les préférences utilisent les événements JSON existants.

## Tests et mesure

Commandes reproductibles :

```powershell
npm.cmd run test:whatsapp:v2
npm.cmd run test:whatsapp:release
```

Le garde `whatsappIsolationGuard.cjs` interdit PostgreSQL applicatif et les appels fetch réels. Les tests couvrent les nouveaux choix, interruptions, consentement, sessions devenues indisponibles, préférence transactionnelle, absence de création avant confirmation, transfert, absence d’appel IA V2 et corpus de reconnaissance. La suite existante couvre en plus sécurité du webhook, doublons, livraison, erreurs et parcours administratifs.

Exécution finale : **410 tests réussis, 0 échec, 0 ignoré** pour `test:whatsapp:release`, incluant les huit tests V2. Vérification de syntaxe Node des modules nouveaux/modifiés et compilation EJS de la vue d’admission réussies.

Corpus local de 210 questions : **207 ensembles d’intentions exacts sur 210, soit 98,57 %** après corrections. Trois erreurs conservées et visibles dans le diagnostic : « Quel tarif pour commencer ? », « À très bientôt », « Mon ordinateur ne démarre plus ». Cette mesure concerne le classificateur ; elle ne mesure ni la pertinence intégrale des réponses ni la réussite commerciale.

Le corpus est écrit séparément, sans génération combinatoire, mais a servi au développement. **Une évaluation indépendante sur au moins 200 questions de prospects réels, anonymisées et non utilisées pour régler les règles, reste à constituer.** Aucun résultat de terrain ou objectif indépendant de 80 % n’est revendiqué.

## Limitations et travail ultérieur

- Les choix de formation, session et groupe sont limités aux dix premiers résultats du service pour respecter les listes Meta. Prévoir une pagination pour les catalogues plus grands. Le texte du catalogue public reste limité aux premières formations.
- Le suivi de statut à la demande oriente vers un conseiller ; il ne révèle pas un dossier à partir d’un numéro ou d’un e-mail déclaré sans vérification.
- L’expiration supprime le brouillon lors du prochain traitement ; aucun nouveau traitement de purge périodique ou changement de rétention des messages historiques n’est ajouté.
- La sélection est une préférence et ne réserve aucune place. L’administrateur vérifie à nouveau disponibilité, identité, droits et modalités lors de la conversion.
- Le contenu d’accueil personnalisé ancien est conservé en base mais n’est plus utilisé pour l’accueil officiel V2. L’interface d’édition de ces anciens champs n’a pas été refondue.
- Les montants officiels anglais sont des règles de communication fournies dans la mission. Tout écart réel du catalogue ou de la politique d’accès doit être revu avant activation ; les règles comptables existantes n’ont pas été changées.
- La compatibilité et les migrations déjà requises par les travaux antérieurs restent celles des rapports existants. Aucun test PostgreSQL réel ni test Meta réel n’a été exécuté pendant cette intervention.

## Préparation d’un déploiement ultérieur

Ne rien déployer à partir de ce rapport seul. Revoir d’abord l’audit de compatibilité Contabo existant et ses diagnostics en lecture seule, confirmer le catalogue, les règles commerciales, le schéma et le worker actif. Répéter les tests sur une préproduction représentative avec transports simulés et vérifier le parcours administratif complet. Préparer le paquet et le retour arrière selon le runbook existant, sans migration globale ou activation d’anciens workers. Obtenir ensuite une autorisation explicite sur ce paquet concret avant tout déploiement, redémarrage ou envoi WhatsApp réel.

Aucun secret, token, `.env`, identifiant Meta, paramètre PM2 ou donnée de production modifié.
