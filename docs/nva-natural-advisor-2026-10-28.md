# Refonte conversationnelle NVA — 28 octobre 2026

## Audit et périmètre

Le projet existant est conservé : webhook signé → inbox durable / ingestion historique → transaction et verrou par destinataire → moteur → message sortant durable → livraison Cloud API. Les tests existants couvrent les signatures, doublons, STOP, consentements, transferts humains, concurrence et soumissions d'admission.

Le moteur priorisait les réponses commerciales par mots-clés. Le mode QUESTION_AI nécessitait un clic ; son API Responses sélectionnait des identifiants de faits et de fragments préécrits. Les salutations contournaient l'IA. L'accueil proposait trois boutons et pouvait être contourné par une première question métier. Aucun cache de réponse ancienne n'a été identifié.

Prisma conserve déjà `WhatsAppConversation.engineState` (JSON), les messages entrants/sortants et le budget IA journalier. Le contexte est relu uniquement pour la conversation courante. Aucune nouvelle table ni migration nécessaire.

## Implémentation

- `whatsappConversationEngine.js` : accueil avant les questions d'un contact vierge ; `welcomeSentAt` persistant ; conversation IA libre après l'accueil, y compris salutations et remerciements. STOP, consentement, pause, conseiller et collecte déterministe restent prioritaires. Le cours choisi reste conservé pour les relances autorisées.
- `whatsappAdmissionJourney.js` : exactement deux boutons initiaux, `📝 S'inscrire` et `💬 Poser une question`. Actions internes `registration` et `question` conservées ; les identifiants de transport portent toujours un jeton anti-rejeu, volontairement variable. Accueil anglais si détecté. Les menus d'inscription existants restent disponibles.
- `whatsappNaturalAdvisorPolicy.js` : consignes pour des réponses rédigées librement, courtes, FR/EN, ancrées dans les faits officiels, sans question de relance systématique.
- `whatsappQuestionAIService.js` : schéma strict `{language, reply, factIds, action}` ; aucune liste de formulations à choisir dans la requête. Vérification des références, nombres, liens et certaines affirmations sensibles ; action limitée à NONE / REGISTER. Le décodeur historique reste compatible avec les plans anciens, sans exposer leur prose supplémentaire. Fréquence officielle de deux séances hebdomadaires ajoutée.
- `whatsappQuestionAICompletionService.js` : traitement REGISTER dans la transaction finale après nouvelle vérification du contexte ; ouverture des méthodes d'inscription existantes et sauvegarde atomique des boutons et de leur état. Aucune création d'inscription par l'IA. Journal de décision sans contenu de conversation ni secret.
- `whatsappAdvisorPolicy.js` : langue anglaise reconnue pour les salutations courtes explicites.
- Tests et script `test:whatsapp:natural` ajoutés ; fixtures des anciennes suites adaptées pour distinguer les prospects existants des nouveaux contacts et supprimer l'ancien troisième bouton.

Les sessions et créneaux viennent toujours des services publics de l'application. Les conditions générales d'anglais restent limitées au cours correspondant et aux règles publiées. Les frais et disponibilités ne sont pas écrits par le modèle dans les données métier.

## Persistance, confidentialité et coûts

L'accueil et son marqueur sont enregistrés avec la réponse durable dans la transaction existante. Les contacts possédant déjà un état de conversation ne reçoivent pas rétroactivement la présentation. Le tout premier message reçoit l'accueil ; s'il contenait une question, le prospect peut ensuite la poser librement.

Les six derniers messages texte du même prospect, depuis le début du mode IA, sont utilisés. Coordonnées évidentes et secrets sont masqués avant envoi ; ce masquage ne constitue pas une anonymisation exhaustive de texte libre. `store:false`, absence d'outils métier, budget atomique, délai borné et absence de retry API sont conservés. Les réponses devenues obsolètes pendant HTTP sont annulées ; les faits sont relus avant publication.

Les garde-fous de prose ne prouvent pas la véracité sémantique de toute phrase générée. Un essai réel de préproduction FR/EN reste indispensable. Une indisponibilité, réponse invalide ou limite atteinte produit le message explicite d'indisponibilité existant.

## Configuration

### Prompt professionnel fourni après la refonte

Le prompt « NVA AI Assistant » fourni par l'utilisateur est intégré dans `whatsappNaturalAdvisorPolicy.js` : identité transparente de conseiller virtuel, accompagnement pédagogique et commercial, compréhension contextuelle, mise en forme WhatsApp, absence de pression, sécurité des inscriptions et recentrage des questions générales. Le contrat JSON et les actions serveur existants restent imposés. La langue reste FR/EN conformément au parcours implémenté ; aucune prise en charge supplémentaire n'est revendiquée.

Les faits officiels d'anglais général incluent désormais la durée indicative de 8 semaines par niveau, environ 24 semaines si les sessions se suivent sans interruption, et les créneaux habituels fournis. Ces créneaux sont explicitement distincts des sessions ouvertes : leurs dates, horaires effectifs et places restent issus des services actualisés. Les horaires habituels ne sont pas étendus aux autres formations.

Validation de cette intégration : **104/104** tests conversationnels et **416/416** tests de livraison, sans appel externe. Journaux : `tmp/nva-professional-prompt-tests.txt` et `tmp/nva-professional-prompt-release.txt`. Aucun déploiement ni changement de secret ou de schéma.

Activer les réglages existants `enabled` et `admissionsEnabled` du chatbot, puis fournir côté serveur :

```dotenv
NVA_AI_ENABLED=true
OPENAI_API_KEY=<secret existant, ne pas copier dans les rapports>
OPENAI_MODEL=<modèle existant compatible Responses et Structured Outputs>
NVA_AI_TIMEOUT_MS=4000
NVA_AI_MAX_OUTPUT_TOKENS=256
NVA_AI_DAILY_CALL_LIMIT=50
```

Délais admis : 250–10000 ms ; sortie : 64–1024 tokens ; plafond quotidien partagé : 1–1000 appels. Aucun changement automatique de configuration, modèle ou secret n'a été effectué. `NVA_CHATBOT_AI_ENABLED` appartient au sélecteur FAQ historique et ne pilote pas ce parcours. Les réglages webhook/worker existants restent nécessaires.

Le schéma Responses suit la [documentation officielle OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Validation

Journaux locaux dans `tmp/nva-refonte-*.txt`. Les suites se recoupent ; leurs totaux ne doivent pas être additionnés comme des tests uniques.

- Livraison : `npm run test:whatsapp:release` — 416 tests réussis, dont persistance de l'accueil après reconstruction du service et doublon.
- Conversation : `npm run test:whatsapp:natural` — 102 tests réussis.
- Régressions supplémentaires V2, contrats DB, préparation, scénarios et coordination — 53 tests réussis.
- `npm test` tenté : génération Prisma réussie, puis erreur du moteur de schéma lors de l'accès à PostgreSQL de test. La suite générale n'a pas atteint les tests. Aucun résultat PostgreSQL réel n'est revendiqué.

Les tests ciblés utilisent le garde-fou d'isolation interdisant le client Prisma réel et tout transport externe. Aucun appel réel Meta/OpenAI, aucune connexion Contabo et aucun déploiement. NovanceTech n'a pas été modifié.

## Préparation Contabo, sans exécution

Git n'est pas disponible dans le PATH local ; il n'a pas été possible de certifier le diff contre HEAD. Des changements antérieurs existaient déjà. Comparer impérativement les versions locales, GitHub et celles du serveur avant tout transfert. Le guide `whatsapp-contabo-safe-sync-2026-10-28.md` décrit les précautions ; sa liste de six fichiers concernait l'ancien correctif et ne suffit pas pour cette refonte.

Sur le serveur, commandes d'inventaire en lecture seule :

```sh
pm2 list
cd /CHEMIN_NVA_CONFIRME
git status --short
git rev-parse HEAD
git diff -- src/services/whatsappConversationEngine.js src/services/whatsappAdmissionJourney.js src/services/whatsappQuestionAIService.js src/services/whatsappQuestionAICompletionService.js src/services/whatsappAdvisorPolicy.js package.json
```

Sauvegarder les fichiers NVA concernés et la base selon la procédure existante. Préparer une copie de validation distincte, y fusionner les adaptations Contabo, puis y lancer :

```sh
npm ci
npm run prisma:generate
npm run test:whatsapp:release
npm run test:whatsapp:natural
```

Ne lancer `npm test` que dans un environnement dédié : son script réinitialise la base de test. Aucune migration ajoutée par cette refonte ; ne pas lancer un reset sur le serveur de production.

Après comparaison, revue et autorisation séparée de déploiement, appliquer uniquement les fichiers fusionnés puis redémarrer les seuls processus NVA identifiés :

```sh
pm2 restart NOM_WEB_NVA_CONFIRME
pm2 restart NOM_WORKER_NVA_CONFIRME
```

Si la configuration serveur est modifiée, utiliser le mécanisme de chargement d'environnement propre à ces processus ; ne pas appliquer de configuration PM2 locale globale. Tester un premier contact, les deux boutons, questions libres, suivi, changement de langue, inscription, panne IA et doublons. Retour arrière : restaurer uniquement les fichiers sauvegardés et la configuration NVA correspondante, puis redémarrer ces mêmes processus. Aucune opération globale PM2, copie écrasante ou modification NovanceTech.
