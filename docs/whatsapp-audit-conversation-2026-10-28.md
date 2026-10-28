# Audit et correction du chatbot NVA — 28 octobre 2026

## Diagnostic

Le parcours local est : contrôleur webhook et validation de signature → ingestion WhatsApp / inbox durable selon la configuration → transaction de conversation et verrou du destinataire → moteur → admission, scénarios, règles ou IA différée → message sortant durable → livraison Meta. La conversation conserve les identifiants traités, le cours choisi, les questions en attente, la collecte et le mode IA.

Deux défauts sont démontrables dans le code local :

1. `src/services/whatsappConversationEngine.js:245` : auparavant, la branche `QUESTION_AI` précédait les admissions sans exception pour les salutations ou remerciements. « Bonjour » était donc traité comme une question IA avec les six messages récents (`whatsappQuestionAICompletionService.js:37`). Le modèle pouvait sélectionner de nouveau le fait relatif à l’essai gratuit. Ce routage est une cause démontrée ; sans traces de production, l’attribution de chaque incident réel au modèle reste à confirmer. « Hi » manquait également dans les deux classificateurs.
2. `src/services/whatsappCommercialResponder.js:13` : une formation explicitement reconnue pouvait restaurer `pendingIntents` même lorsque le message actuel exprimait une nouvelle question. Le moteur reprenait alors réellement l’ancien sujet. La restauration est maintenant réservée aux clarifications sans nouveau sujet reconnu.

L’accueil existant (`whatsappAdmissionJourney.js:56`) renvoyait la même présentation aux contacts initiaux et récurrents. Les salutations sont maintenant traitées avant le mode IA, après STOP, consentement, pause et transfert humain. Les étapes de collecte restent intactes (`:69`). Le menu existant conserve sa génération de jetons et sa validation Meta ; les trois boutons sont S’inscrire, Menu (ouvre le catalogue), Poser une question.

Les réponses différées vérifiaient déjà le dernier message entrant, le mode actif et la stabilité du catalogue avant publication (`whatsappQuestionAICompletionService.js:31–54`). Aucun cache d’ancienne réponse n’a été identifié dans ce parcours. Ces contrôles ne sont pas supprimés. Une salutation quittant le mode IA rend sa réponse antérieure inéligible.

## Fichiers modifiés

- `src/services/whatsappConversationEngine.js` : intentions sociales et priorité déterministe.
- `src/services/whatsappAdmissionJourney.js` : accueil initial, accueil de retour, boutons et préservation des coordonnées.
- `src/services/whatsappCommercialIntents.js` : reconnaissance de Hi.
- `src/services/whatsappCommercialResponder.js` : nouvelle question prioritaire sur le sujet en attente.
- `tests/whatsappAdmissions.test.js` : assertions adaptées à la distinction initial / retour et au nouveau message.
- `tests/whatsappSocialRouting.test.js` : régressions de routage, salutations répétées, remerciements, collecte et changement de sujet.

Les tarifs, sessions, validations administratives, vérification e-mail, protections de soumission, consentements et budgets IA ne sont pas modifiés. Aucune modification de NovanceTech ni migration SQL.

## Validation exécutée

```powershell
npm.cmd run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappSocialRouting.test.js tests/whatsappAdmissions.test.js tests/whatsappQuestionAI.test.js tests/whatsappV3Corrections.test.js
```

Résultats : **415/415** et **101/101**, zéro échec (les suites se recoupent). Journaux : `tmp/whatsapp-audit-release.txt`, `tmp/whatsapp-audit-tests.txt`.

Couverture : premier contact, salutation après question IA, salutations répétées, remerciement, changement de sujet, contexte du cours, clics des trois boutons et jetons expirés, inscription et collecte en cours, indisponibilité / délai / budget IA, doublons, consentements, STOP et transfert humain. Les tests existants couvrent aussi concurrence des complétions, changement de mode et modification du tarif pendant HTTP.

## Limites et risques

Validation isolée avec adaptateurs simulés ; aucun appel réel Meta/OpenAI ni test PostgreSQL de production. Un essai sur un numéro de préproduction reste nécessaire. Les règles commerciales sont inchangées : leur exactitude dépend toujours du catalogue publié.

Un premier message contenant une question métier explicite conserve la réponse ciblée existante ; le message complet accueille les salutations et premiers contacts non reconnus. Les messages de retour sont courts. Les réglages d’admission doivent être activés pour obtenir les boutons de ce parcours. La présentation initiale est définie dans le menu existant, comme auparavant, indépendamment du champ administratif `welcome`.

**Contabo n’a pas été consulté : l’égalité ou la divergence local / production n’est pas établie.** Git n’est pas disponible dans le PATH de cette session ; aucun statut Git initial fiable n’a pu être relevé. Les modifications ont été ciblées sans restauration globale. Aucun déploiement ni synchronisation effectué.

## Déploiement proposé, uniquement après autorisation

1. Sur Contabo, identifier le chemin NVA et les processus web/worker réels avec `pm2 list`, puis relever `git status --short` et `git rev-parse HEAD` si le répertoire utilise Git. Comparer les fichiers concernés (diff / sommes SHA-256) avec la copie locale, sauvegarder les versions du serveur et résoudre toute divergence avant transfert. Ne pas utiliser de copie globale avec écrasement ni `git reset --hard`.
2. Transférer uniquement le correctif relu et les tests dans un répertoire de validation, puis exécuter :

```sh
npm run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappSocialRouting.test.js tests/whatsappAdmissions.test.js tests/whatsappQuestionAI.test.js tests/whatsappV3Corrections.test.js
```

3. Après validation et application du correctif dans le chemin NVA confirmé, redémarrer chaque processus NVA concerné : `pm2 restart NOM_NVA_VERIFIE`. Le nom doit être remplacé par celui relevé sur place ; conserver l’environnement actuel. Aucune migration et aucun changement des flags IA ne sont requis.
4. Vérifier les boutons et les onze scénarios demandés sur un numéro autorisé, surveiller les journaux sans exposer les coordonnées ni secrets. En cas de régression, restaurer seulement les fichiers sauvegardés et redémarrer les mêmes processus.
