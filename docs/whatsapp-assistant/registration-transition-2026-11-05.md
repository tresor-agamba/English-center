# Correction de la transition IA → inscription — 5 novembre 2026

## Diagnostic établi et limite de production

Le code de travail a été tracé de `whatsappConversationService.executeInboundTransaction()` à `whatsappConversationEngine.handleMessage()`, `whatsappQuestionAICompletionService.completeReply()`, `whatsappQuestionAIService`, puis `whatsappAdmissionJourney.resolve()` et `whatsappCommercialResponder.respond()`.

Les causes vérifiées sont :

1. Une proposition d’inscription formulée par l’IA restait un texte. Aucun état métier ne signalait qu’une réponse affirmative était attendue. Dans la génération historique, `whatsappAdvisorPolicy.QUESTIONS.register` contient précisément « Souhaitez-vous découvrir les parcours d’inscription sécurisés via “M’inscrire” ? ». Son rendu n’enregistrait aucune transition.
2. La priorité donnée à la conversation libre interceptait `Oui` avant `whatsappAdmissionJourney` et sa gestion de l’étape `INVITE`. `Oui` redevenait une question IA, dont toute erreur de configuration, quota, transport, réponse vide ou non conforme donnait le fallback. Ce texte de secours ne prouve pas à lui seul une erreur OpenAI particulière.
3. `Via WhatsApp` et `Via le site`, en état libre, pouvaient aussi être interceptés par la branche IA. Dans le parcours métier, certaines réponses textuelles étaient traitées par CommercialResponder, tandis que les boutons utilisaient les helpers de Journey : le contenu et l’état résultants divergeaient (notamment site : METHOD contre DONE).
4. Dans la version locale avant cette correction, une demande explicite « Je veux m’inscrire » rejoignait déjà le parcours officiel avec les réglages d’admission activés. Son échec exact en production n’est pas reproduit ici comme une erreur API. Le texte « Je ne peux pas vérifier cette information actuellement » se trouve dans `whatsappQuestionAIService.js.backup-duration` ; le fallback du service actif localement a déjà une autre formulation. Cela démontre l’origine possible du texte historique, pas quelle version tourne sur Contabo. Sans révision active, réglages et logs serveur, prétendre identifier son erreur HTTP exacte serait infondé.
5. Un parcours d’admission désactivé pouvait laisser tomber la commande vers des réponses génériques. Il est maintenant signalé explicitement, avec un log `NVA_REGISTRATION_UNAVAILABLE`, sans prétendre à une panne OpenAI.

## Reproduction et traces

Les tests persistent les vrais messages et états dans le mock transactionnel commun du dépôt. Une instance neuve de ConversationService est créée pour chaque message : la continuation ne dépend pas d’une variable en mémoire. Le parcours de réception utilise `processInboundMessageInTransaction()`, et la complétion utilise le véritable service OpenAI avec un transport simulé.

| Entrée / contexte | Parcours corrigé | Appels OpenAI |
|---|---|---:|
| « Comment je peux m’inscrire ? », après un historique réaliste | METHOD : site ou WhatsApp | 0 |
| « Oui », après ce choix | METHOD : précise les deux choix | 0 |
| « Je veux m’inscrire », à nouveau | METHOD, aucune confirmation administrative | 0 |
| « Oui », après l’ancienne proposition IA déjà envoyée | METHOD via compatibilité de l’invitation récente | 0 |
| « Je suis intéressé », après une présentation | Décision structurée START_REGISTRATION ; METHOD backend | 1 simulé |
| Question libre → offre IA → « Oui » | OFFER_REGISTRATION persisté, puis METHOD | 1 pour l’offre, 0 pour Oui |
| « Via WhatsApp », ou bouton correspondant | CONSENT de collecte | 0 |
| « Via le site », ou bouton correspondant | DONE et URL officielle | 0 |
| Demande explicite après une erreur OpenAI sur les tarifs | METHOD ; l’erreur antérieure n’empêche pas la navigation | 0 supplémentaire |

L’ancien défaut de routage de Oui est établi par l’ordre des branches auditées ; la séquence corrigée et la reprise de son état historique sont exécutées dans les tests. Aucun appel OpenAI réel ni message Meta réel n’est envoyé.

## Corrections

`whatsappRegistrationTransition.js` définit une liste fermée d’intentions et les transitions backend. Les commandes d’inscription et les canaux explicites passent avant la génération libre. Les refus, demandes de statut, collecte de coordonnées, STOP et reprise humaine conservent leurs contrôles. Les mots d’inscription dans une réponse libre ne sont pas utilisés pour valider une admission.

Le service OpenAI expose `decide()`, utilisé dans le chemin de complétion de production. Il génère en une seule requête une réponse naturelle et un champ `intent` : NONE, OFFER_REGISTRATION, START_REGISTRATION, REGISTRATION_WEBSITE ou REGISTRATION_WHATSAPP. La requête impose un JSON Schema strict ; le backend revalide exactement les deux clés, les types, la longueur et l’énumération. Des clés SQL, une intention administrative ou un JSON incomplet sont refusés. `answer()` reste disponible pour les consommateurs historiques de texte ; il ne pilote aucune action.

Ces intentions ne permettent que d’ouvrir le choix de méthode, montrer le site ou demander le consentement de collecte. Le texte du modèle est remplacé par celui du parcours officiel lorsqu’une transition est exécutée. Aucun consentement, inscription, email vérifié, paiement ou décision administrative ne peut être créé par ce mécanisme.

`OFFER_REGISTRATION` écrit `pendingRegistrationOffer` dans `engineState`, dans la même transaction que la réponse générée. Il contient la clé de la réponse et une expiration de 24 h. Un Oui n’utilise ce marqueur que si cette réponse correspond au dernier message assistant effectivement accepté/envoyé/livré/lu. Les réponses en attente, échouées et humaines sont exclues. Un nouveau sujet invalide le marqueur. Une compatibilité limitée reconnaît une invitation récente déjà envoyée avant l’ajout de ces métadonnées ; un Oui isolé ne suffit pas.

Les contrôles de claim atomique, dernier message entrant, démarrage du contexte IA, état BOT_ACTIVE, paramètres actifs et verrou destinataire sont conservés avant publication. Une décision arrivée après un choix plus récent est annulée. La réponse interactive et l’état métier sont enregistrés ensemble. Aucune nouvelle transaction SQL n’entoure l’appel HTTP.

Textes et boutons appellent les mêmes helpers `method`, `viaWebsite`, `viaWhatsApp` dans AdmissionJourney. CommercialResponder délègue désormais à ces helpers. Les étapes consentement, nom, téléphone, email, niveau, session, groupe, récapitulatif, confirmation finale, vérification email et validation administrative restent celles de l’application.

Prompt : `nva-assistant-2026-11-05.2`. Aucun changement de modèle imposé ; le modèle configuré doit accepter JSON Schema strict. Le contrat suit la [documentation officielle des sorties structurées OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs). Aucune variable d’environnement obligatoire nouvelle, aucune migration.

## Observabilité

- `NVA_REGISTRATION_TRANSITION` : action backend et étape, sans contenu personnel.
- `NVA_ASSISTANT_GENERATION` : corrélation hachée, version, modèle, décision, raison d’erreur (HTTP avec statut, réseau, timeout, quota, configuration, décision invalide), latence et unités.
- `NVA_ASSISTANT_COMPLETION` : réponse OpenAI, navigation backend, fallback ou annulation ; décision et état résultant.
- `NVA_ASSISTANT_NOT_ELIGIBLE`, `NVA_REGISTRATION_UNAVAILABLE` et `NVA_CONVERSATION_PROCESSING_FAILED` : distinguent configuration, fermeture du parcours et erreur de dépendance, sans détails privés.

Il n’y a aucun nouvel appel OpenAI pour une demande explicite, un Oui rattaché à une invitation connue ou un choix de canal. Les formulations libres utilisent la requête de génération existante, sans appel séparé de classification ni nouvelle boucle de retry.

## Fichiers de cette correction

- `src/services/whatsappRegistrationTransition.js` (nouveau)
- `src/services/whatsappConversationEngine.js`
- `src/services/whatsappConversationService.js`
- `src/services/whatsappQuestionAIService.js`
- `src/services/whatsappQuestionAICompletionService.js`
- `src/services/whatsappAdmissionJourney.js`
- `src/services/whatsappCommercialResponder.js`
- `src/config/nvaAssistantPrompt.js`
- `tests/whatsappRegistrationTransition.test.js` (nouveau)
- `tests/whatsappQuestionAI.test.js`, `tests/metaInboxWorker.test.js` : mocks adaptés au contrat structuré.
- `tests/whatsappConversationPersistence.test.js` : navigation canonique activée et persistée au lieu d’un lien générique direct.
- Ce rapport, le complément au plan de déploiement et `registration-test-results.json`.

## Vérification et limites

Les tests obligatoires sont couverts, ainsi que les invitations expirées/non envoyées, le redémarrage du service, les refus, les statuts, la reprise humaine, les JSON invalides et les décisions concurrentes. Les résultats exacts figurent dans `registration-test-results.json`. Les mocks prouvent la transition et ses contrôles, pas la compréhension sémantique réelle du modèle en production. Vérifier la séquence avec le modèle et le numéro de préproduction avant déploiement.

Aucune donnée de production modifiée, aucun déploiement et aucune action NovanceTech. Le déploiement doit prendre l’ensemble des fichiers liés ; voir `deployment-2026-11-05.md`. L’erreur particulière de la commande explicite en production reste à corréler à la révision et aux logs Contabo ; elle n’est pas attribuée arbitrairement à OpenAI.

### Résultats exécutés

553 tests réussis sur 553 dans 28 fichiers, dont 21 nouveaux tests de transition et 41 tests HTTP. Ces derniers ont été exécutés avec autorisation d’écoute locale hors sandbox ; le garde-fou d’isolation base/réseau est resté actif. Le worker, l’inbox durable, la complétion OpenAI simulée et l’envoi Meta simulé sont aussi vérifiés ensemble avec une décision START_REGISTRATION suivie de Via WhatsApp. `git diff --check` et les contrôles de syntaxe réussissent.

Commande des tests prioritaires :

```bash
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test --test-isolation=none tests/whatsappRegistrationTransition.test.js tests/whatsappQuestionAI.test.js tests/whatsappConversationPersistence.test.js tests/metaInboxWorker.test.js
```

Les 27 fichiers de régression de l’audit précédent ont également été réexécutés. Les détails par fichier et les comptes exacts sont conservés dans `registration-test-results.json`. Les résultats précédents `test-results.json` documentent l’étape antérieure de l’audit.
