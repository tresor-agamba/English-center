# Unification locale de l’accueil WhatsApp — 23 octobre 2026

## Diagnostic avant correction

- Ancien accueil : chaîne littérale « Bonjour et bienvenue à New Vision Academy ! Je peux vous renseigner… » dans la branche GREETING de `src/services/whatsappConversationEngine.js`.
- Accueil officiel : fonction locale `menu()` dans `src/services/whatsappAdmissionJourney.js`. Elle utilise `DEFAULTS.welcome` surchargé par `settings.admissionContent`, la promotion calculée depuis le catalogue et les cinq options existantes. Le corps interactif et son repli numéroté sont générés par `send()`.
- Cause reproductible : sans admission active, « bonjour » exact appelle déjà `menu()`. Avec un état d’admission MENU ou DONE, cette salutation retombait sur le moteur et sa chaîne ancienne. Les variantes de salutations reconnues par le moteur pouvaient également manquer la liste exacte du parcours d’admission. Un premier message inconnu n’était pas dirigé vers l’accueil.
- Priorité : admissions, scénarios configurables, règles MESSAGE/FAQ, puis moteur et éventuel repli IA. Chaque résultat termine le traitement ; ces services ne lancent pas plusieurs réponses en parallèle. Les règles et scénarios stockés peuvent définir d’autres textes, mais leur contenu de production n’a pas été consulté.
- Persistance : `whatsappConversationService.js` compose ces services dans la transaction du worker, vérifie `providerMessageId`, verrouille le destinataire et crée au plus une réponse avec la clé `wa-reply:<wamid>:0`. Le moteur rejette également les identifiants déjà traités. `metaInboxRuntime.js` interdit la coexistence avec les expéditeurs historiques activés. L’inventaire réel des processus et les automatismes externes Meta/WhatsApp n’ont pas été inspectés.

## Correction appliquée

La correction recommandée et appliquée réutilise `menu()` sans changer sa construction, son texte, sa promotion ni ses options :

- Le moteur transmet l’intention au parcours d’admission. GREETING appelle `menu()` en l’absence d’admission active ou depuis MENU/DONE, avant les scénarios et règles susceptibles de répondre à cette salutation.
- Les saisies, consentements et confirmations d’inscription restent prioritaires pendant une collecte active. STOP, transfert et pause restent traités avant l’accueil.
- Un premier contact inconnu appelle le même `menu()` seulement après les commandes métier, sélections de formation, scénarios et règles. Un échange déjà engagé ne reçoit pas cet accueil supplémentaire.
- La chaîne d’accueil ancienne est supprimée. Si les admissions sont désactivées ou absentes, le moteur utilise le menu textuel historique existant pour GREETING et MENU ; aucun parcours désactivé n’est activé par cette correction.

Fichiers modifiés : `src/services/whatsappAdmissionJourney.js`, `src/services/whatsappConversationEngine.js`, `tests/whatsappAdmissions.test.js`, `tests/whatsappConversationEngine.test.js` et ce rapport. Aucun changement du worker, des configurations, des secrets ou du schéma de données.

## Validation

`npm.cmd run test:whatsapp:release` : **401 tests réussis, 0 échec, 0 ignoré**. Journal : `output/welcome-release-tests.log`.

Les régressions comparent exactement le texte et le corps interactif à Menu, avec un contenu personnalisé, pour Bonjour, Salut, Hello et des variantes, sans état puis depuis MENU/DONE. Elles vérifient les cinq options et l’absence de réponse/actions au rejeu du même identifiant. Un premier contact inconnu reçoit ce même accueil ; une demande de tarifs reste une demande de tarifs et un échange existant reste dans son contexte.

La suite couvre aussi collecte/confirmation/modification/annulation d’inscription, boutons et listes, scénarios personnalisés, STOP, conseiller, persistance, doublons, livraison et worker Meta. Son garde d’isolation interdit les connexions applicatives PostgreSQL et les appels réseau non simulés. Cette exécution ne valide donc pas la livraison réelle ni les processus de production.

Aucun déploiement, envoi WhatsApp réel, modification de tokens/identifiants ou suppression de conversations effectué.
