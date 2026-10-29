# Audit final du chatbot WhatsApp NVA — 29 octobre 2026

> Historique de l'audit avant correction. Les cinq échecs décrits ci-dessous sont désormais corrigés : voir `nva-whatsapp-routing-corrections-2026-10-29.md`. Les 27 assertions d'origine sont conservées et réussissent ; la suite étendue comprend 49 tests réussis.

**Avis : déploiement déconseillé en l'état.** L'audit reproduit cinq échecs sur les exigences de routage. Aucun déploiement, appel réel OpenAI/Meta, changement métier, modification de secret ou migration n'a été effectué. Les seuls changements de cette mission sont les tests, leur script npm et ce rapport. Les défauts constatés restent visibles dans la suite d'audit.

## Résultats des sept vérifications

| Point | Résultat local | Preuve / réserve |
| --- | --- | --- |
| 1. Premier accueil unique avec deux boutons | Conforme sous configuration active | Présentation avant la première question d'un contact vierge, marqueur `welcomeSentAt`, état sérialisable, doublon sans nouvelle réponse. La suite de livraison vérifie aussi sa persistance après reconstruction du service. Titres exacts actuels : `📝 S'inscrire` et `💬 Poser une question` ; si les titres doivent être strictement sans emojis, ils devront être ajustés. |
| 2. Priorité OpenAI pour les questions ordinaires | **Non conforme pour certaines formulations** | Les salutations, tarifs, budget, horaires et certificat passent avant les anciennes règles. Le mot « inscription » suffit toutefois à détourner une demande d'information. Le refus combiné à une question de prix peut aussi perdre son sens. |
| 3. Question directe sans clic | Conforme dans le cas général, avec la réserve du point 2 | Après le seul accueil initial, les questions testées entrent en QUESTION_AI sans clic. Un tout premier message contenant déjà une question reçoit la présentation ; cette première question n'est pas répondue simultanément. |
| 4. Historique récent | Conforme dans le périmètre actuel | Six messages texte au maximum, chronologiques, même `conversationId`, antérieurs au dernier entrant et postérieurs au début du mode IA. Les messages des autres prospects et ceux attribués à un conseiller humain sont exclus. |
| 5. Utilisation du prompt professionnel | Conforme pour les appels conversationnels concernés | Égalité exacte de `request.instructions` avec l'export de `whatsappNaturalAdvisorPolicy.js`, vérifiée sur les requêtes HTTP simulées pour salutation, suivi et anglais. Aucun outil métier envoyé au modèle. Les anciens sélecteurs FAQ ont un autre prompt ; il n'est pas affirmé que tous les appels OpenAI de toute l'application utilisent celui-ci. |
| 6. Secours après erreur API | Conforme pour les erreurs simulées, avec limites de diagnostic | HTTP 401/429/500, erreur réseau, JSON invalide, réponse incomplète et timeout : message explicite d'indisponibilité, invitation à réessayer ou joindre un conseiller, journal `NVA_AI_COMPLETION` avec `outcome: unavailable`. Aucun remplacement par une FAQ métier. Une réponse IA valide est conservée. |
| 7. Backend propriétaire des actions | Conforme pour les clics et validations ; **défaut du repli numérique** | Les identifiants et jetons des boutons sont validés côté serveur. Le consentement précède la collecte. REGISTER ouvre seulement les méthodes officielles ; aucun paiement ni inscription n'est confirmé par le modèle. Mais les réponses numériques proposées par le menu passent à l'IA. |

## Cinq échecs reproductibles

### A. Question informative traitée comme une demande d'inscription

Après l'accueil : `Quels documents faut-il pour l’inscription ?`

Attendu : conversation OpenAI contextualisée. Observé : réponse ADMISSIONS, étape METHOD, ouverture des choix site / WhatsApp. Le test échoue parce que `deferredQuestionAI` est absent.

Cause : `whatsappConversationEngine.js:253` écarte de l'IA tout texte contenant une racine d'inscription. L'admission commerciale interprète ensuite la question comme une inscription. Une distinction entre commande d'action et question informative est nécessaire.

### B. Refus et question de prix après l'accueil

Texte : `Je ne veux pas m’inscrire, juste connaître les prix.`

Attendu : respecter le refus et répondre sur les prix via OpenAI. Observé depuis le menu initial : refus déterministe, étape DONE, sans réponse sur les prix. Le refus est respecté dans ce cas, mais la question est ignorée.

### C. Même refus après activation du mode IA

Accueillir, poser `Quels sont vos tarifs ?`, puis envoyer le même refus et la même question de prix.

Observé : ouverture de METHOD malgré le refus. `whatsappConversationEngine.js:273` reconnaît une racine d'inscription puis `:277` remplace le texte original par `Je veux m’inscrire`. La négation et la question disparaissent. Il s'agit d'une ouverture de parcours indue, pas d'une inscription enregistrée.

### D/E. Réponses numériques du menu d'accueil

Après l'accueil, répondre `1`, puis tester séparément `2` depuis un accueil neuf.

Attendu : le backend résout respectivement l'action `registration` vers METHOD et `question` vers FREE. Observé : `deferredQuestionAI: true` dans les deux cas ; les choix sont transmis à OpenAI.

Cause : la branche conversationnelle de `whatsappConversationEngine.js:255` intervient avant la résolution numérique par `whatsappAdmissionJourney.js`. Les clics interactifs réels fonctionnent ; le repli textuel « Répondez par numéro » fourni à `whatsappAdmissionJourney.js:48` est affecté.

## Tests exécutés

```sh
npm run test:whatsapp:final-audit
npm run test:whatsapp:natural
npm run test:whatsapp:release
```

| Suite | Total | Réussites | Échecs |
| --- | ---: | ---: | ---: |
| Nouvel audit ciblé | 27 | 22 | **5** |
| Conversation / prompt existants | 104 | 104 | 0 |
| Livraison / régressions existantes | 416 | 416 | 0 |

Les suites se recoupent : ne pas additionner leurs totaux comme des tests uniques. Les cinq tests d'audit sont de véritables assertions échouées, sans skip ni TODO. Le script d'audit renvoie donc un code de sortie 1 jusqu'à correction. Les suites précédentes n'incluaient pas ces combinaisons de texte et d'état.

Fichiers : `tests/whatsappFinalAudit.test.js`, script `test:whatsapp:final-audit` dans `package.json`. Journaux : `tmp/nva-final-audit-20261029.txt`, `tmp/nva-final-audit-natural-20261029.txt`, `tmp/nva-final-audit-release-20261029.txt`.

## Limites et conditions avant déploiement

- Tests locaux avec backend contractuel simulé et HTTP injecté ; le garde-fou interdit le client Prisma réel et les transports externes. Cela vérifie les décisions et données émises par le code, pas la qualité sémantique d'une réponse d'un modèle réel, ni la livraison sur un téléphone.
- Ni PostgreSQL réel ni Contabo n'ont été testés pendant cet audit. La suite générale `npm test`, qui réinitialise une base dédiée, n'a pas été relancée. L'erreur du moteur Prisma signalée lors de la mission précédente n'est pas déclarée résolue.
- Aucune comparaison avec les modifications Contabo n'a été réalisée. Les résultats concernent le code local seulement ; NovanceTech n'a pas été modifié.
- Accueil et IA exigent les réglages chatbot/admissions actifs, `NVA_AI_ENABLED=true`, une clé et un modèle valides, et un budget disponible. Un plafond atteint ou une configuration invalide empêche volontairement un appel. STOP, suspension, conseiller humain et collecte sensible restent des exceptions déterministes.
- Le premier accueil ne concerne pas rétroactivement les contacts déjà pourvus d'un état. Les demandes STOP / conseiller humain sont prioritaires même au premier message.
- L'historique est limité au mode IA courant, pas à toute la vie du prospect ; il peut contenir des messages sortants non livrés, car la requête actuelle ne filtre pas `deliveryStatus`.
- Le secours dit « Je ne peux pas vérifier cette information actuellement », sans prétendre donner une réponse vérifiée. Il n'indique ni le fournisseur ni la cause technique précise. Les erreurs HTTP, validations de sortie, timeout et budget épuisé sont regroupés en résultat indisponible ; le diagnostic opérationnel reste sommaire.
- Des protections de prose vérifient références, nombres, liens et certaines affirmations sensibles. Elles ne prouvent pas la véracité sémantique de toutes les phrases. Le décodeur conserve aussi une compatibilité avec les anciens plans de faits préécrits si une sortie de ce format est reçue.

Avant déploiement : corriger les trois causes A–E, faire réussir les 27 assertions d'audit sans affaiblir leurs attentes, relancer les suites existantes, puis valider sur une base et un numéro de préproduction autorisés et comparer les adaptations Contabo.
