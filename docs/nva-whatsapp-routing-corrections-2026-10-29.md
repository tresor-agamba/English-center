# Correction du routage conversationnel NVA — 29 octobre 2026

## Résultat

Les cinq tests échoués de l'audit initial passent sans suppression, skip ou affaiblissement de leurs assertions. La suite d'audit étendue passe à **49/49**, la suite conversationnelle à **105/105**, la suite de livraison et régression à **416/416**. Aucun déploiement effectué.

## Causes et corrections

| Échec initial | Cause exacte | Correction |
| --- | --- | --- |
| Question sur les documents d'inscription | Une expression régulière écartait tout message contenant une racine d'inscription du parcours IA, avant de le confier aux règles commerciales. | Les mots d'inscription n'excluent plus un message libre de l'IA. La demande originale est transmise au modèle. |
| Refus suivi d'une demande de prix depuis le menu | Le même routage donnait la priorité à une réponse de refus prédéfinie, qui ignorait la question tarifaire. | La phrase complète passe à l'IA avec l'historique et les faits. Le prompt impose NONE pour les refus et les demandes d'information. |
| Même refus en mode IA | Une seconde expression régulière remplaçait le message complet par « Je veux m'inscrire », supprimant la négation. | Suppression de la détection par racine et de cette réécriture. Le modèle reçoit la négation et la question intactes. |
| Réponse numérique 1 | La branche IA précédait la résolution des choix enregistrés. | Résolution backend prioritaire d'un numéro correspondant à une option proposée dans un menu non expiré. |
| Réponse numérique 2 | Même priorité incorrecte. | Même correction : 2 ouvre FREE depuis l'accueil, sans interprétation IA du choix. |

## Routage final

Les protections STOP, suspension, conseiller humain, consentements et validations existantes restent prioritaires. L'accueil initial est inchangé : deux boutons, état persistant, protection contre les doublons.

Les clics interactifs, numéros et libellés explicitement proposés par un menu valide, confirmations attendues et étapes d'inscription engagées sont traités par le backend. Les commandes de contrôle documentées (`menu`, annulation, demande de consentement aux relances) restent déterministes. Les noms de formations, mots d'inscription, questions et refus libres passent au service OpenAI avant les anciennes règles, lorsque `NVA_AI_ENABLED=true`.

Un nombre hors contexte, hors plage ou reçu après expiration ne déclenche aucune inscription automatique. Un message libre consomme le menu précédent : ses anciens numéros et boutons ne peuvent plus être utilisés pour rejouer le choix. Les options proposées restent enregistrées dans `engineState.admission.options`, avec leur date d'expiration et leurs identifiants de transport validés côté serveur.

Une interprétation structurée REGISTER par le modèle peut uniquement ouvrir le choix officiel entre site et accompagnement WhatsApp. Le nouveau `vetoRegistration` est un **veto**, jamais une autorisation par mot-clé : il bloque notamment une proposition REGISTER incompatible avec un refus, une demande d'information, un report ou un nombre isolé. Le backend relit ensuite l'état courant sous verrou, contrôle le dernier message et les réglages avant d'enregistrer les boutons et leur état atomiquement.

Si le modèle propose malgré tout une action bloquée, le message d'indisponibilité explicite existant est utilisé et une décision `NVA_AI_ACTION_REJECTED / REGISTRATION_VETO` est journalisée sans contenu personnel. Le modèle ne peut ni confirmer un paiement, ni créer une inscription, ni éviter les consentements, la vérification d'identité ou les validations administratives.

## Fichiers modifiés

- `src/services/whatsappConversationEngine.js` : priorités, disparition des deux détecteurs d'inscription par racine et de la réécriture du message, consommation des anciens menus.
- `src/services/whatsappRegistrationActionPolicy.js` : nouveau veto serveur des actions REGISTER incompatibles avec le message actuel.
- `src/services/whatsappQuestionAICompletionService.js` : application du veto avant la transaction finale, journal de refus d'action ; contrôles transactionnels existants conservés.
- `src/services/whatsappNaturalAdvisorPolicy.js` : distinction explicite entre information, refus, ambiguïté et souhait actuel d'inscription.
- `src/services/whatsappAdmissionJourney.js` : texte d'aide aligné sur le nouveau routage ; « Nos formations » et « M'inscrire » ne sont plus annoncés comme commandes déterministes de sortie.
- `tests/whatsappFinalAudit.test.js` : 27 assertions initiales conservées ; 22 cas supplémentaires couvrant les refus dans les deux états, ambiguïtés, nombres hors contexte, jetons périmés après changement de sujet, veto d'une mauvaise classification et demande positive.
- `tests/whatsappQuestionAI.test.js` : ancien test qui imposait une sortie déterministe sur tout mot d'inscription remplacé par deux exigences distinctes : commande de menu déterministe et messages libres transmis au modèle, y compris une demande positive.
- `tests/whatsappSocialRouting.test.js` : vérification renforcée du changement de sujet : ancien état d'admission supprimé et cours courant conservé, plutôt que conservation d'une intention obsolète.
- `docs/nva-whatsapp-final-audit-2026-10-29.md` : annotation de résolution ; constats historiques conservés.
- Le présent rapport.

Les tests qui reproduisaient les cinq défauts n'ont pas été modifiés pour accepter l'ancien comportement. Les deux autres tests adaptés attendaient précisément des comportements remplacés par la présente mission ; les nouvelles assertions exigent le routage naturel et l'absence d'état obsolète.

## Validation exécutée

```sh
npm run test:whatsapp:final-audit
npm run test:whatsapp:natural
npm run test:whatsapp:release
```

| Suite | Tests | Réussis | Échecs |
| --- | ---: | ---: | ---: |
| Audit corrigé et étendu | 49 | 49 | 0 |
| Conversation / prompt | 105 | 105 | 0 |
| Livraison / régression | 416 | 416 | 0 |

Les suites se recoupent : les totaux ne constituent pas un nombre de tests uniques. Journaux locaux : `tmp/nva-routing-fix-audit.txt`, `tmp/nva-routing-fix-natural.txt`, `tmp/nva-routing-fix-release.txt`.

Les tests de complétion vérifient aussi la transmission du prompt professionnel, du message actuel et des six messages récents de la même conversation, la non-divulgation du contexte d'un autre prospect, le changement de sujet, les erreurs API, le budget, la concurrence et les annulations de réponses obsolètes. Les suites de régression couvrent les parcours d'inscription, les consentements, le webhook et les mécanismes de livraison existants. Aucune modification du dashboard ni de NovanceTech.

## Migrations et configuration

Aucune migration, nouvelle dépendance, modification de secret ou nouvelle variable d'environnement. La configuration existante reste nécessaire : chatbot et admissions actifs, `NVA_AI_ENABLED=true`, clé et modèle Responses compatibles, limites de temps/tokens/appels valides. L'état JSON existant suffit aux menus.

## Risques résiduels

- Validation locale avec base contractuelle simulée et HTTP injecté, sans appel réel OpenAI/Meta ni PostgreSQL réel. Ces tests prouvent le routage et les contrôles, pas la justesse sémantique de toute réponse d'un modèle réel.
- Le veto est volontairement conservateur et ne reconnaît pas toutes les formulations possibles. Il peut rejeter une proposition REGISTER ambiguë ; la réponse sera alors une indisponibilité explicite. Le prospect peut utiliser le menu et son bouton d'inscription. Aucune décision du modèle n'est une validation administrative.
- La priorité donnée à l'IA augmente les appels pour les messages auparavant traités par règle. Le plafond journalier atomique et les délais existants restent appliqués ; aucune augmentation automatique du budget.
- Les choix d'un ancien menu sont invalidés après un message libre. Revenir au menu permet d'obtenir de nouveaux choix.
- L'historique reste limité au mode IA courant et peut inclure des messages sortants non livrés : le filtrage de livraison signalé dans l'audit initial ne fait pas partie de cette correction.
- Le mode historique lorsque l'IA est désactivée conserve les règles existantes. La conformité conversationnelle décrite ici suppose l'activation de l'IA.
- Aucun accès Contabo ni comparaison avec ses adaptations n'a été effectué ; Git reste absent du PATH local. Ne pas écraser les modifications du serveur.

## Instructions de déploiement — non exécutées

1. Sur Contabo, identifier les chemins et processus NVA avec `pm2 list`. Dans le répertoire NVA confirmé, relever `git status --short` et `git rev-parse HEAD` ; comparer les versions locales, GitHub et serveur des fichiers ci-dessus. Sauvegarder les fichiers serveur avant toute fusion. Ne pas effectuer de copie globale ou de réinitialisation Git forcée.
2. Fusionner les corrections dans une copie de validation distincte en préservant les adaptations serveur, puis exécuter les trois commandes de tests ci-dessus. Tester sur une base et un numéro de préproduction autorisés les questions sur l'inscription, les refus en mode IA, les nombres hors contexte, les deux boutons et une inscription complète avec consentement.
3. Après autorisation distincte de déploiement et comparaison réussie, transférer uniquement les fichiers fusionnés concernés. Aucune migration ajoutée par ce correctif. Ne pas exécuter `npm test` en production : son script réinitialise une base dédiée.
4. Redémarrer uniquement les processus NVA identifiés, avec leurs noms réels :

```sh
pm2 restart NOM_WEB_NVA_CONFIRME
pm2 restart NOM_WORKER_NVA_CONFIRME
```

5. Vérifier les parcours et les journaux sans exposer de secrets. En cas de régression, restaurer uniquement les fichiers sauvegardés et redémarrer ces mêmes processus. Ne pas modifier NovanceTech ni employer une commande PM2 globale.
