# NVA WhatsApp V2 — OpenAI dans « Poser une question »

26 octobre 2026, Africa/Kinshasa. Implémentation et tests **locaux uniquement**. Aucun déploiement Contabo, redémarrage PM2, changement de configuration de production, appel OpenAI réel ou message WhatsApp réel. `NVA_AI_ENABLED=false` dans l'exemple de configuration ; aucun secret ajouté au dépôt.

## Architecture et périmètre

L'inspection a confirmé le moteur V2, le parcours d'admission, le contexte JSON `engineState`, la file de messages PostgreSQL et le worker Meta existants. L'ancien service OpenAI sélectionnait une FAQ approuvée pour une question inconnue. Le nouveau parcours est indépendant et utilise exclusivement le mode explicite QUESTION_AI ; aucune nouvelle route webhook, base, table, migration, dépendance npm ou instance worker.

1. Le bouton existant, validé par son identifiant et son contexte, conserve `mode: QUESTION_AI` et `questionAIStartedAt` dans `engineState`. Il invite à poser la question, indique qu'une aide IA peut être utilisée et demande de ne pas partager de coordonnées. Cliquer ne déclenche pas d'appel API.
2. Les textes suivants produisent une réponse sûre avec le marqueur `QUESTION_AI_PENDING` dans la transaction de réception. Les inscriptions, « Menu », « Nos formations », leurs équivalents anglais, STOP et conseiller sont interceptés avant la branche IA. L'inscription passe par les deux méthodes/consentements/contrôles V2 existants.
3. Une fois le message Meta traité et la transaction validée, le chemin de livraison habituel revendique le marqueur `QUESTION_AI_PROCESSING` par mise à jour conditionnelle. Le chemin historique peut aussi terminer la réponse **après** son commit. Aucune transaction SQL ni verrou destinataire n'est conservé pendant HTTP.
4. Le service de complétion lit les formations publiées et les sessions ouvertes par `publicCourseService` et `registrationService`, avec le client déjà injecté. La sélection et les contraintes de disponibilité restent celles des services métier. Il ne transmet ni client Prisma ni outil au modèle.
5. L'API Responses reçoit un instantané limité de faits publics bilingues et les six derniers messages texte au maximum, de **la même conversation**, depuis l'entrée dans ce mode. Les champs de compte, prospect, coordonnées, consentement et brouillon d'inscription ne sont pas transmis. L'historique reste dans les tables existantes ; pas de conversation distante ou `previous_response_id`.
6. OpenAI choisit une langue et jusqu'à trois identifiants de faits sous schéma JSON strict. Le service refuse les sorties incomplètes, invalides ou avec identifiants inconnus, puis assemble les phrases FR/EN autorisées. **Aucune prose libre produite par le modèle n'est envoyée.** Cette conception offre des réponses commerciales courtes et contextuelles, sans lui permettre d'inventer une date, un prix, une reconnaissance ou un compte bancaire. Sa pertinence de sélection reste à évaluer avec le modèle réel.
7. Avant publication, le catalogue est relu pour invalider un instantané qui a changé. Une courte transaction, sous le verrou destinataire existant, revérifie mode, contrôle humain, dernier message, début du mode et activation du chatbot. STOP, relais, menu ou nouvelle question intervenus pendant HTTP annulent la réponse devenue obsolète. La livraison conserve les contrôles Meta, fenêtre de service, idempotence et exclusivité existants.

L'activation historique `NVA_CHATBOT_AI_ENABLED` ne déclenche plus automatiquement une recherche FAQ sur les questions inconnues reçues hors mode. Les helpers historiques restent pour leur simulation administrative/tests ; les anciens marqueurs de livraison libèrent seulement leur repli sûr, sans OpenAI (PROCESSING récent attend son propriétaire, ancien récupéré après 120 s). Le test historique de commit a été adapté au nouveau mode explicite, au lieu de conserver un appel implicite contraire au périmètre demandé.

## Connaissances commerciales

Les conditions particulières ne sont fournies que pour un cours identifié comme **anglais général**, publié, structuré en trois niveaux de seize séances. Un cours Excel ou un autre anglais ne reçoit pas automatiquement ces conditions.

- 3 niveaux ; 16 séances de 90 minutes par niveau, 48 séances au total.
- Prix publié de 60 USD par niveau : 180 USD pour les trois niveaux ; certificat NVA supplémentaire de 20 USD ; total 200 USD.
- Pour la politique d'essai correspondante : 5 séances gratuites incluses dans les 16 du niveau 1 ; au moins 30 USD pour continuer à la 6e séance, solde de 30 USD avant la fin du niveau.
- Certificat délivré par NVA après les trois niveaux, sous réserve des conditions administratives ; aucune reconnaissance internationale ou équivalence externe affirmée.

Si le tarif publié n'est plus 60 USD ou si la politique d'accès ne correspond pas, les faits financiers/essai spécifiques ne sont pas proposés comme si rien n'avait changé. Le tarif public valide reste dynamique. Les autres formations reçoivent leur tarif publié et un renvoi à NVA pour les modalités non établies. Aucun moyen de paiement n'est inventé. Les sessions/créneaux proviennent du service d'inscription : groupes actifs non complets uniquement ; aucune réservation promise. Au plus trois sessions par cours sont présentées au modèle : le résultat n'est pas un inventaire exhaustif de tout le catalogue.

La règle existante de restriction d'accès partiel à dix séances n'a pas été modifiée par cette mission. Le rapprochement métier déjà ouvert entre les échéances annoncées et les règles d'accès effectives reste nécessaire avant production. Le texte IA ne doit pas être considéré comme une modification de la politique financière du LMS.

## Configuration et consommation

| Variable | Valeur par défaut / rôle |
| --- | --- |
| `NVA_AI_ENABLED` | `false`. Le seul interrupteur du nouveau parcours, distinct des autorisations Meta d'envoi. |
| `OPENAI_API_KEY` | Vide ; fournir depuis le mécanisme de secrets approuvé, jamais Git/log/test. Les tests génèrent une valeur d'autorisation fictive et utilisent un transport simulé. |
| `OPENAI_MODEL` | Vide, obligatoire pour appeler l'API. Choisir et qualifier explicitement un modèle compatible Responses + sorties structurées ; aucun choix silencieux. |
| `NVA_AI_TIMEOUT_MS` | 4000 ms ; entier de 250 à 8000. Timeout avec abort et borne d'attente même si un transport injecté ignore le signal. |
| `NVA_AI_MAX_OUTPUT_TOKENS` | 256 ; entier de 64 à 512. Concerne la petite réponse JSON du modèle, pas la longueur du message WhatsApp final. |
| `NVA_AI_DAILY_CALL_LIMIT` | 50 ; entier de 1 à 1000, partagé par jour UTC dans `WhatsAppChatbotAiBudget`. |

Configuration absente/invalide : aucun appel. Le bouton reste utilisable ; avec l'interrupteur faux, les questions gardent le moteur déterministe V2. Si le mode IA est demandé mais l'API n'est pas configurée, est saturée, échoue ou refuse une réponse : message de repli invitant à réessayer ou joindre un conseiller. Les erreurs SQL/contexte annulent la réponse plutôt que publier un résultat non vérifié.

Une réservation atomique et **committée séparément** consomme une unité du quota avant toute requête. Échecs/timeouts restent comptés ; pas de retry API automatique ni remboursement après rollback métier. Une réponse déjà revendiquée ne provoque pas un second appel. Un propriétaire crashé laisse seulement le corps de repli préécrit, récupérable après 120 s. Le quota n'est pas un budget monétaire : un prospect peut consommer toute la part journalière ; pas de quota individuel ajouté.

Bornes de données : six cours maximum, trois sessions/cours, quatre créneaux/session ; refus au-delà de 80 faits ou 24 000 octets de JSON de faits. Question limitée à 1 800 caractères, six échanges à 600 caractères chacun ; schéma et instructions ajoutent un coût fixe. Réponse WhatsApp limitée à 1 600 caractères. Aucun outil payant, recherche web ou conservation de fil distant.

Le coût dépend du modèle configuré : `coût = tokens d'entrée × tarif d'entrée + tokens de sortie × tarif de sortie`, avec les unités tarifaires du fournisseur. À 50 appels/jour et 256 tokens de sortie, la borne de génération demandée est 12 800 tokens/jour ; les tokens d'entrée restent facturés et peuvent dominer. Les limites en caractères/octets ne sont pas un comptage exact de tokens. Aucun montant USD/jour n'est annoncé sans modèle ni tarif validés. Prévoir un projet fournisseur dédié avec limites de dépense et surveillance avant activation.

L'API est appelée avec `store:false`, sans suivi de conversation distant et sans redirection HTTP. Cela ne signifie pas absence de toute rétention fournisseur ; la politique du compte et les journaux de surveillance doivent être examinés avant activation. La documentation officielle précise les sorties structurées et les contrôles de données : [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Data controls](https://developers.openai.com/api/docs/guides/your-data). La conception utilise la [Responses API pour le texte](https://developers.openai.com/api/docs/guides/text), consultée via la compétence OpenAI Docs.

## Sécurité et limites

Le modèle ne reçoit aucun outil SQL, accès réseau NVA, commande administrative ou identité d'autre utilisateur. Il ne décide pas d'inscription, ne crée pas de compte, ne vérifie pas d'adresse e-mail et ne modifie aucune table. Les instructions fixes et les données prospect sont séparées ; seules des références à des faits autorisés sont acceptées en sortie. Une tentative d'injection peut néanmoins perturber le choix d'un fait pertinent : les tests simulés ne prouvent pas le comportement statistique d'un modèle réel.

Un filtre masque les emails, téléphones apparents, liens, secrets usuels et noms introduits explicitement dans les questions/historiques. **Ce filtre n'est pas une anonymisation exhaustive** : un nom libre, une adresse ou un détail personnel inhabituel peut subsister. L'information du prospect, la politique de traitement externe et la rétention doivent être approuvées. Aucun message prospect, corps fournisseur, clé ou prompt n'est ajouté aux logs.

La disponibilité peut changer après le dernier contrôle : le workflow d'inscription doit toujours la revérifier. Le modèle peut sélectionner une mauvaise combinaison de faits valides ; les templates bornent les affirmations mais ne remplacent pas une recette linguistique réelle. Le mécanisme ne transforme pas un canal de test en liste blanche : le confinement des numéros reste un prérequis opérationnel distinct.

## Fichiers modifiés

| Fichier | Rôle |
| --- | --- |
| `src/services/whatsappQuestionAIService.js` (nouveau) | Faits bilingues, minimisation, configuration, transport Responses, timeout, schéma et rendu sûr. |
| `src/services/whatsappQuestionAICompletionService.js` (nouveau) | Revendication persistante, historique isolé, quota, actualisation catalogue, contrôle final et récupération. |
| `src/services/whatsappAdmissionJourney.js` | Entrée QUESTION_AI au bouton et sortie par navigation existante. |
| `src/services/whatsappConversationEngine.js` | Persistance des champs mode/date, priorité navigation/inscription, réponse différée. |
| `src/services/whatsappConversationService.js` | Injection d'environnement, marqueur et complétion historique après commit uniquement. |
| `src/services/whatsappConversationDeliveryService.js` | Complétion IA avant claim d'envoi ; pas d'appel FAQ implicite historique. |
| `src/services/metaInboxWorkerService.js` | Transmission du même environnement au moteur et au service de livraison existants. |
| `.env.example`, `package.json` | Variables désactivées et commande de tests dédiée ; aucune dépendance ajoutée. |
| `tests/whatsappQuestionAI.test.js` (nouveau) | 18 tests du parcours, du transport simulé, du contexte et des protections. |
| `tests/metaInboxWorker.test.js` | Parcours Meta simulé complet, API après commit et livraison unique. |
| `tests/whatsappConversationPersistence.test.js` | Test du commit historique adapté au mode explicite. |
| `tests/whatsappConversationDelivery.test.js` | Anciens marqueurs : repli sûr uniquement, aucun appel FAQ et respect du propriétaire en cours. |
| `tests/whatsappV2MetaReadiness.integration.test.js` | Complétion sur vrai PostgreSQL avec rôle restreint et OpenAI/Meta simulés. |
| `tests/helpers/whatsappIsolationGuard.cjs`, `scripts/runNvaV2PostgresLab.js` | IA désactivée par défaut dans les environnements de non-régression. |
| Ce rapport | Preuves, limites, coûts et conditions d'activation. |

## Tests et preuves

| Exécution | Résultat |
| --- | --- |
| `npm.cmd run test:whatsapp:release` | **414 réussis**, 0 échec/ignoré — `output/nva-question-ai-release.log`. Moteur, scénarios, inscriptions, admin, consentement, Meta, livraison et reprise. |
| `npm.cmd run test:whatsapp:question-ai` | **46 réussis**, 0 échec/ignoré : 18 nouveaux tests + 28 worker — `output/nva-question-ai-focused.log`. Les 28 worker sont déjà inclus dans les 414 : ne pas additionner les totaux bruts. |
| Laboratoire PostgreSQL complet | **47 contrôles Node réussis**, 0 échec/ignoré : métier 7, admin 20, readiness 6, Meta/IA 14 (parent inclus). `output/nva-question-ai-postgres.log` et journaux `output/nva-whatsapp-v2-postgres-20261024/*-tests.log`. |

Le laboratoire existant était arrêté : premier essai ECONNREFUSED, puis redémarrage des binaires PostgreSQL portables déjà présents après vérification du cluster exact `output/nva-whatsapp-v2-postgres-20261024/cluster`, port 58432 sur loopback. Une récupération après ancien arrêt non propre a terminé avant la recette. Aucun logiciel système installé. La recette utilise uniquement `nva_whatsapp_v2_test`, réapplique le contrôle des 47 migrations existantes, crée des fixtures fictives et nettoie les fixtures ainsi que le quota de son test. Aucune migration applicative ajoutée. Après les tests, ce seul serveur portable a été arrêté proprement pour rétablir son état initial ; aucun service PostgreSQL système ou distant touché.

Couverts : activation et questions successives ; JSON de contexte persistant ; menu/formations/inscription interceptés ; STOP/conseiller ; isolation inter-conversations ; historique borné ; quota épuisé ; timeout et transport ignorants de l'abort ; erreurs/incomplétude/identifiants inventés ; injection ; langue EN ; prix changé pendant HTTP ; crash/revendications concurrentes ; aucun appel dans les autres menus. Le test SQL prouve la réservation de budget avec les vrais droits du worker, le message QUESTION_AI_PROCESSING committé avant HTTP simulé, la réponse commerciale livrée par le chemin Meta existant et le retour au menu sans nouvel appel.

## Activation ultérieure

**GO implémentation/recette locale ; IA de production désactivée.** Avant activation : autorisation explicite de déployer et d'activer, prérequis Contabo/SQL/repli existants clos, canal/testeurs confinés, validation des règles commerciales réelles, revue du traitement externe des données et du projet OpenAI, modèle compatible qualifié sur questions FR/EN avec fautes, budget fournisseur et seuils approuvés. Le modèle et l'accès du compte n'ont pas été vérifiés par appel réel dans cette mission.

Conserver `NVA_AI_ENABLED=false` jusqu'à cette décision. L'activer n'autorise pas l'envoi Meta et ne remplace pas ses flags de sécurité. La désactivation future remet les nouvelles questions sur le moteur déterministe, sans supprimer de contexte ou consentement ; les réponses différées utilisent le repli ou sont annulées si le contexte a changé. Aucune commande de déploiement, PM2, configuration de production ou envoi réel exécutée ici.
