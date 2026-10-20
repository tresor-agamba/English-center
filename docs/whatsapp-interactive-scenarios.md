# Menus interactifs et scénarios NVA

## Accès et utilisation

Ouvrir /admin/whatsapp/chatbot/scenarios avec un compte administrateur actif. La rubrique « Menus et scénarios » apparaît dans la navigation WhatsApp existante.
Créer un scénario inactif, définir ses déclencheurs texte et sa priorité, puis ajouter ses nœuds et ses options. Le nœud initial est identifié par son identifiant lisible, par exemple accueil. Les identifiants des options sont des UUID créés une seule fois, distincts des libellés. Modifier un libellé ne change pas son UUID. Retirer puis recréer une option crée une nouvelle identité.

Formats : boutons de réponse rapide (1–3), menu de liste (1–10 lignes dans une section), réponse texte prédéfinie. Les libellés sont limités à 20 caractères pour les boutons et 24 pour les lignes. Chaque option propose : terminer, transférer au conseiller, consulter le catalogue NVA ou rejoindre un nœud du même scénario / d'un autre scénario. Pour une transition externe, copier l'UUID du scénario depuis son URL d'édition et saisir son nœud cible.
Le catalogue existant reste responsable des formations, tarifs, horaires, essais et inscriptions. Aucun scénario n'exécute du JavaScript, du SQL, un webhook arbitraire ou une collecte implicite de consentement.

Conditions autorisées : cours sélectionné, accord commercial déjà acquis, prospect non inscrit ; valeur oui/non. Les conditions peuvent filtrer une option ou contrôler un nœud. Le chemin de refus peut transférer au conseiller, terminer ou rejoindre un autre nœud. Les conditions sont vérifiées de nouveau au clic, même si l'option avait été affichée.
Les chemins automatiques locaux en boucle sont refusés à la sauvegarde ; les transitions inter-scénarios sont limitées à 12 étapes par message. Au maximum 40 nœuds par scénario et 100 scénarios. Les réponses texte peuvent précéder un menu, dans la limite globale du corps interactif de 1024 caractères.

Les modifications sont protégées par un numéro de révision : deux administrateurs ne peuvent pas silencieusement écraser leurs changements. Désactiver un scénario retire ses menus du parcours réel. Le simulateur peut tester les scénarios inactifs.

## Identité et sécurité des clics

Le webhook normalisé conserve button_reply.id / list_reply.id et leur titre. Le moteur décide sur l'identifiant, jamais sur le titre. Un titre affiché « STOP » ne remplace pas une action configurée ; le texte STOP saisi par l'utilisateur conserve sa priorité absolue.
Chaque affichage associe l'UUID stable d'option à un jeton de présentation aléatoire dans l'identifiant transmis à Meta. Ce jeton n'est pas un nouvel identifiant métier : il protège contre les clics d'un ancien menu. L'état de conversation mémorise scénario, révision, nœud, ordre visible des options et expiration à 24 heures. Un menu modifié, désactivé, expiré ou une option devenue inapplicable ne peut plus être exécuté. Les réponses numériques suivent exactement l'ordre présenté, y compris les options filtrées.
STOP, opt-out, suspension et transfert humain restent traités avant les scénarios par whatsappConversationEngine. Le transfert réutilise l'action HUMAN_HANDOFF et ses annulations de réponses / relances existantes. Les menus ne peuvent pas recueillir ou réactiver un consentement à la place du mécanisme officiel existant.

## Simulateur

Sélectionner le scénario de départ et cliquer Recommencer. Définir si nécessaire le contexte fictif : prospect, accord commercial, identifiant de cours sélectionné. Cliquer sur une option pour poursuivre ou saisir un numéro. Tester aussi menu, STOP et conseiller. Les 30 derniers tours sont conservés uniquement dans la session administrateur. Les actions et réponses sont affichées ; aucun message, consentement, livraison ou conversation métier n'est créé. Les consultations du catalogue sont en lecture seule. Le simulateur ne fait aucun appel OpenAI.
Il utilise le même moteur et le même service de scénarios que le parcours réel, avec des scénarios inactifs rendus disponibles uniquement pour ce test administrateur. Après une sauvegarde modifiant une révision, recommencer la simulation.

## Circuit d'envoi et repli

whatsappConversationService persiste le corps textuel numéroté et le payload interactif JSON dans la réponse en attente. whatsappConversationDeliveryService utilise le transport Cloud API existant, les mêmes barrières de soumission, consentement, contrôle humain, fenêtre de service de 24 heures et corrélation idempotente.
Un refus explicite de format (codes 100, 131009 ou validation locale INVALID_INTERACTIVE) prépare un repli texte pour un prochain passage du worker. Le payload est supprimé, le corps numéroté conservé, et une tentative supplémentaire au maximum est autorisée. Avant cet envoi, les contrôles de STOP, transfert humain et fenêtre de service sont effectués de nouveau.
Un timeout, une erreur 5xx, un résultat incertain ou un retour contradictoire ne déclenchent jamais un repli automatique : un second message risquerait de doubler le premier. Les erreurs d'authentification, de permission et les fenêtres expirées ne sont pas contournées par un envoi texte. Les 429 confirmés gardent la politique de retry existante.
Les payloads sont construits selon les formats Meta documentés :
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/ActionObject/
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/RowObject/

## Migration et préparation

Migration additive : prisma/migrations/20261020140000_add_whatsapp_interactive_scenarios/migration.sql.
Elle ajoute WhatsAppScenario et deux colonnes à whatsapp_conversation_messages : interactive_payload et text_fallback_pending. Aucune donnée existante n'est supprimée. Elle doit suivre la migration du module chatbot précédent. Le client Prisma a été généré localement ; aucune migration n'a été exécutée contre une base de données.
Avant de démarrer la nouvelle release, appliquer les migrations approuvées sur une base locale dédiée et vérifier CRUD, réception interactive et persistance réelle. Le PostgreSQL local étant incomplet lors de cette session, les tests SQL réels restent à effectuer. Ne jamais appliquer les migrations du dépôt en bloc sans examiner les travaux précédents non déployés.

Le runtime Meta Inbox de production reste réception seule ; aucun worker ni branchement de traitement / d'envoi n'est activé par ce changement. Le dispatcher et l'adaptateur existants peuvent transporter les nouvelles données vers le moteur lorsqu'un traitement explicitement autorisé est configuré. Aucun appel réseau n'est ajouté à l'adaptateur transactionnel.
L'ID de clic fait maintenant partie du contenu sémantique normalisé et chiffré. Une ancienne réception interactive, auparavant stockée sans ID, peut être signalée comme conflit lors d'une nouvelle livraison du même événement contenant cet ID. Garder le traitement désactivé pendant le déploiement, surveiller les événements nécessitant revue et ne jamais réinjecter les anciens événements comme nouvelles conversations. Le système conserve ses identités wamid et ses barrières de déduplication ; les anciens clics sans ID ne déclenchent pas de scénario.

WHATSAPP_ENABLED=false et WHATSAPP_WORKERS_ENABLED=false restent inchangés. Aucune variable supplémentaire n'est requise. Aucun envoi ou déploiement en production sans autorisation explicite.
Retour arrière : maintenir les flags false, désactiver les scénarios, restaurer la release NVA précédente et son client Prisma. Conserver les tables / colonnes additives ; ne pas effacer l'historique ni réinitialiser les réceptions Meta. Les corps textuels numérotés restent lisibles.

## Vérification

npm run test:whatsapp:scenarios : tests isolés, sans accès Prisma réel, sans pg et sans réseau, OpenAI et Meta simulés. Couverture : limites et validation, UUID stables, clics / numéros, conditions, transitions, cycles, expiration, révisions, consentement, STOP, pause, transfert, persistance simulée, déduplication, payload Cloud, refus format, repli, timeout et autorisations / CSRF.
node scripts/previewWhatsAppScenarios.js : rendu Edge sans serveur de production, tests de formulaire avec ajout d'option et renommage, captures à 390 / 1440 px dans output/whatsapp-scenarios.
node node_modules/prisma/build/index.js validate et node scripts/validateEjs.js : schéma et vues.
