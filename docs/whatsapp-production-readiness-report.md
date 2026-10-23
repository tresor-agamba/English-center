> Rapport historique du 20 octobre. Pour l’extension du 22 octobre (demandes consenties et conversion), voir [rapport actuel](whatsapp-admissions-implementation.md). La release candidate du 20 octobre ne contient pas cette extension.

﻿# Rapport de préparation au déploiement — NVA WhatsApp

Date : 20 octobre 2026, Africa/Kinshasa. Audit local et correction d’intégration uniquement. Aucune connexion SSH, aucun accès à PostgreSQL Contabo, aucune installation distante, migration, modification de production, activation ou intervention NovanceTech.

**Décision : préparation locale terminée ; déploiement conditionné aux contrôles opérateur ci-dessous. Mise en service de l’automatisation : non autorisée et non préparée comme action automatique.** Le dossier ne certifie pas l’état réel du VPS.

## 1. Résultat de l’audit de raccordement

| Liaison | Constat et preuve locale | Limite réelle |
| --- | --- | --- |
| Scénarios → moteur existant | whatsappConversationService construit createScenarioService avec le tx et le transmet à whatsappConversationEngine. Le moteur traite d’abord STOP, opt-out, consentement, pause et conseiller. | Nécessite les tables du module et les droits du rôle métier. |
| Boutons et listes → identifiant stable | metaInboxProtocol conserve button_reply.id / list_reply.id ; conversationService transmet interactionId. L’option est résolue par UUID et jeton du menu, indépendamment du libellé. | Un ancien événement enregistré avant cette conservation peut ne pas contenir d’ID. |
| Meta Inbox → scénarios | Tests signés réels du protocole local : acceptation → stockage chiffré simulé → claim/process → dispatcher → adaptateur Prisma → moteur → réponse interactive persistée → clic → transfert humain, pour bouton et liste. Les doublons ne reproduisent pas les effets. | Backend contractuel en mémoire, pas PostgreSQL/Meta réels. |
| Runtime production → traitement | Le runtime expose acceptRaw, ready et close ; il n’expose pas de worker de traitement métier. Le dispatcher/adaptateur sont des composants disponibles, pas un branchement lancé au démarrage. | Le VPS demeure réception seule : aucun chatbot actif à annoncer après simple déploiement du dashboard. |
| Livraison → politique existante | Le circuit existant conserve fenêtre de service, barrières de soumission, idempotence, contrôle humain, consentement et repli texte. | L’ingress actif exige une barrière de soumission explicitement scopée. Le runtime production refuse aussi les deux flags d’envoi actifs. |

Aucun second moteur, nouveau worker, nouvelle route produit ou nouvelle capacité fonctionnelle n’a été ajouté dans cette phase. Les ajouts sont des corrections d’intégration, tests et outils opérateur.

## 2. Correction OpenAI hors transaction PostgreSQL

Le problème confirmé était un appel OpenAI depuis le parcours historique alors que sa transaction Serializable était encore ouverte. Il est corrigé :

1. Dans la transaction entrante, le moteur détermine l’éligibilité et persiste une réponse de repli avec failureCode=AI_PENDING. Aucun appel réseau ni réservation de quota via le client racine n’a lieu dans cette transaction.
2. Après commit, whatsappChatbotAICompletionService revendique cette réponse par une mise à jour conditionnelle AI_PENDING → AI_PROCESSING. Le parcours historique l’appelle après commit ; le circuit de livraison existant offre le même point de finalisation après traitement Meta. Aucune boucle ou tâche de fond nouvelle n’est créée.
3. La réservation quotidienne de quota et l’appel HTTP OpenAI se déroulent hors transaction et sans verrou destinataire conservé.
4. Une courte transaction finale verrouille le destinataire et relit le contrôle humain/STOP, le dernier message entrant, l’activation globale et la FAQ. Une réponse devenue obsolète est annulée ; une FAQ modifiée/désactivée n’est pas publiée. Seul un texte de FAQ encore approuvé peut remplacer le repli.
5. Les appels concurrents ne produisent qu’une revendication ; un propriétaire interrompu libère le repli après deux minutes sans nouvel appel API. Une erreur de finalisation SQL annule la réponse. Les transactions d’ingress ne sont jamais rejouées pour un échec après commit.

Le circuit de livraison attend cette finalisation avant de revendiquer l’envoi. Ses contrôles d’envoi restent ensuite applicables. L’adaptateur Meta n’utilise toujours que son tx et ne fait aucun HTTP. En réception seule avec workers désactivés, cette présence dans le code ne lance aucun appel de traitement Meta ou d’envoi.

Secrets serveur inchangés : OPENAI_API_KEY, OPENAI_MODEL, NVA_CHATBOT_AI_ENABLED et NVA_CHATBOT_AI_DAILY_CALL_LIMIT. Aucun secret lu n’est affiché. Le transport existant conserve store:false, un délai de 1200 ms, 64 tokens de sortie et une sélection parmi au plus 20 FAQ. Aucun modèle n’est choisi arbitrairement : le compte et le modèle configuré restent à tester. [Documentation officielle OpenAI](https://developers.openai.com/api/docs/guides/text).

## 3. Migrations Prisma

| Migration | Effet | Revue locale |
| --- | --- | --- |
| 20261020120000_add_whatsapp_chatbot_admin | Trois tables : règles, paramètres et budget IA ; index ; trois réponses initiales désactivées. | CREATE/INSERT uniquement, aucun changement de donnée métier existante. |
| 20261020140000_add_whatsapp_interactive_scenarios | Table WhatsAppScenario, index ; ajout nullable interactive_payload et booléen text_fallback_pending=false à whatsapp_conversation_messages. | Additif ; aucun DROP, DELETE, TRUNCATE ou renommage. |

Les fichiers historiques n’ont pas été modifiés. Aucun nouveau schéma/migration n’est requis pour le correctif OpenAI : les marqueurs utilisent failure_code existant. Le schéma Prisma est valide. Cela ne prouve pas que les migrations s’appliquent à Contabo.

L’audit offline scripts/auditWhatsAppRelease.js compare l’historique exporté, les checksums et les migrations attendues. Sans historique distant, il retourne volontairement un blocage ; le fichier output/whatsapp-readiness/migration-audit.json l’indique. Il accepte les différences de fins de ligne LF/CRLF des mêmes octets SQL, pas des changements de contenu.

**Ne pas exécuter migrate deploy tant que l’ensemble des migrations en attente n’est pas approuvé.** Prisma 6 applique les migrations en attente et ne certifie pas le drift du schéma réel. Le schéma du dépôt contient aussi Provider* et Meta* déclarés sans migration locale correspondante : ne pas utiliser un diff global, db push, migrate dev/reset ou seed pour compléter la production. [Référence Prisma v6](https://docs.prisma.io/docs/orm/v6/reference/prisma-cli-reference).

Les deux nouvelles migrations n’encadrent pas explicitement leur DDL dans une transaction commune. Tester l’échec et le temps de verrouillage sur la restauration isolée ; un échec réel nécessite un diagnostic DBA et un constat de l’état partiel avant reprise. Aucun reset ou migrate resolve forcé n’est préparé.

## 4. Dossier opérateur et commandes exactes

Le [runbook opérateur](whatsapp-production-operator-runbook.md) fournit les commandes pour :

- construire, hacher et transférer l’archive NVA sans secrets ni fichiers privés ;
- vérifier le nom et le cwd du seul processus PM2 NVA ;
- sauvegarder PostgreSQL en format custom, contrôler l’intégrité et sauvegarder le code/.env sous permissions privées ;
- exporter l’historique Prisma et effectuer l’audit SQL en lecture seule ;
- installer avec npm ci --include=dev et générer le client Linux avec Prisma 6.19.3 ;
- restaurer dans une nouvelle base isolée et y répéter les migrations avant production ;
- configurer les credentials OpenAI dans l’éditeur local sans activation ;
- appliquer les seules migrations revues, copier le code en préservant les données et redémarrer exclusivement NVA avec les deux flags WhatsApp et l’IA serveur à false ;
- tester health/ready, l’accès administrateur et les simulateurs, puis restaurer la release précédente sans effacer les données.

Les paramètres Contabo seront renseignés par l’utilisateur, comme demandé. Les commandes supposent PM2 et PostgreSQL local via sudo/postgres ; elles refusent un nom/cwd NVA incohérent. Le nom english-center vient du fichier ecosystem.config.cjs, pas d’une inspection du VPS. L’utilisateur doit saisir le nom effectivement installé. Un déploiement systemd ou une base distante demande une adaptation, pas l’exécution aveugle du runbook.

Fichiers prêts à relire :

- deploy/whatsapp-chatbot/01-readonly-audit.sql : identité de base, historique, objets, colonnes, droits d’ingress et triggers, sans écriture.
- deploy/whatsapp-chatbot/02-optional-module-grants.sql : droits minimaux sur les nouveaux objets si le rôle métier n’en est pas propriétaire ; usage DBA manuel uniquement, rôle d’ingress/Novance refusé.
- deploy/whatsapp-chatbot/operator-functions.sh : contrôles de cible, wrapper Prisma restreint/expurgé et redémarrage du seul NVA avec environnement contrôlé ; aucun déploiement au chargement.

Le pg_dump custom doit être validé par une restauration, pas uniquement par pg_restore --list. La restauration normale de retour arrière est celle du code ; restaurer le dump par-dessus la production ferait perdre les écritures postérieures et n’est pas autorisé ici. [pg_dump PostgreSQL 16](https://www.postgresql.org/docs/16/app-pgdump.html), [pg_restore PostgreSQL 16](https://www.postgresql.org/docs/16/app-pgrestore.html).

## 5. Risques et compatibilité

| Priorité | Risque | Contrôle requis avant exploitation |
| --- | --- | --- |
| Bloquant | Historique, rôle de migration, base/port et release Contabo inconnus. | Export readonly, contrôle de cible, checksums, inventaire entre release actuelle et candidat. |
| Bloquant | PostgreSQL local incomplet ; aucun DDL réel ni essai de restauration n’a été exécuté dans cette intervention. | Répétition sur une base restaurée et autorisée ; conservation de ses preuves. |
| Bloquant pour chatbot actif | Runtime Meta uniquement récepteur, rôle sans droits métier, traitement/egress non câblés en production. | Maintenir ce palier ; projet d’activation séparé, autorisation distincte et barrière scoped, sans élargir le rôle d’ingress. |
| Élevé | ACL par défaut PUBLIC ou héritées donnant aux rôles d’ingress accès aux nouvelles tables. Le runtime revérifie l’absence de privilèges métier et peut refuser la réception. | Audit après migration, avant reprise ; aucune attribution métier à ingress. |
| Élevé | Rôle d’application distinct du propriétaire des nouvelles tables/séquence, ou droits existants limités par colonne. | Vérifier CRUD et séquence, ainsi que INSERT/UPDATE des deux nouvelles colonnes. Grants minimaux optionnels après revue DBA. |
| Élevé | Modèles Meta*/Provider*, CHECK/triggers/index manuels absents de l’historique Prisma. | Comparaison du catalogue et des scripts SQL déjà approuvés ; aucun diff global appliqué. |
| Élevé | Conservation nouvelle des IDs interactifs changeant le digest sémantique d’une redélivrance d’un ancien événement sans ID. | Pas de réinjection/réinitialisation. Revue des conflits ; leur éventuel blocage de flux est conservateur mais peut retarder le traitement. |
| Élevé | DDL partiel, verrous sur whatsapp_conversation_messages, charge réception pendant maintenance. | Mesurer sur copie, coordonner la fenêtre NVA/ingress existante, sauvegarde vérifiée et arrêt en cas d’échec. |
| Élevé | Variables PM2 périmées prenant le pas sur le .env ; flags d’envoi réactivés par erreur. | Redémarrage ciblé avec environnement NVA chargé en mémoire et trois flags false ; aucun --update-env global. |
| Élevé | Changement de cwd/storage/logs, remplacement global de Node/PM2, fichiers privés écrasés. | Copie en place sans --delete, exclusions explicites, sauvegarde PRIVATE_STORAGE_ROOT, runtime compatible NVA sans toucher NovanceTech. |
| Moyen | Réponses et marqueurs AI_PENDING/AI_PROCESSING en attente, backlog réception ancien ou réponses déjà queued. | Inventorier avant toute future activation ; ne pas rejouer les réponses historiques. Le worker reste fermé ici. |
| Moyen | Menu expiré, révision changée, option conditionnelle devenue fausse, session de simulation existante. | Invalidation prévue ; recommencer le menu ou la simulation. Pas de migration des états JSON nécessaire. |
| Moyen | Modèle OpenAI non disponible, quota, 64 tokens insuffisants pour certains modèles, délai 1200 ms trop court. | Test facturable séparé et approuvé ; conserver le repli. Le budget d’appels n’est pas un plafond financier garanti. |
| Moyen | Données personnelles possibles dans le texte envoyé à OpenAI, malgré absence de téléphone dans les métadonnées et store:false. | Valider les FAQ, le contenu et la politique de données du compte avant activation ; aucun secret dans frontend/logs. |
| Moyen | Repli interactif impossible après résultat ambigu ou hors fenêtre de service. | Ne pas tenter un deuxième envoi ; conserver les règles existantes, reprise manuelle encadrée. |
| Moyen | Code local comprenant des travaux non déployés étrangers au module, absence de commit de référence VPS. | Revue complète du candidat et de son manifeste ; l’archive n’est pas un diff approuvé. |
| Moyen | Retour de code sans effacement des fichiers ajoutés, perte de données en cas de restauration complète. | Ancienne release + ancien client Prisma ; conserver tables/colonnes additives et historique Meta ; pas de restauration destructive automatique. |

## 6. Vérifications exécutées et limites

- Suite release isolée : **342 tests réussis**, aucun échec, ignoré ou annulé ; logs dans output/whatsapp-readiness/test-results.txt. Elle reprend la couverture existante et ajoute chaîne Meta signée bouton/liste, finalisation IA hors transaction, concurrence, changements STOP/FAQ pendant HTTP, audit des migrations et fermeture des workers en production avec un flag false.
- Validation Prisma : réussie ; 159 vues EJS compilées.
- Les blocs Node embarqués du helper Bash sont compilés par les tests. Bash/WSL est inaccessible dans ce sandbox Windows : bash -n doit encore être exécuté sur la cible Linux, comme prévu dans le runbook. Le helper n’a jamais été exécuté sur un serveur réel.
- Aucun appel OpenAI/Meta réel, aucune connexion SQL/SSH distante, aucune migration, aucune fixture de production, aucune activation de worker. Les tests SQL contractuels ne prouvent pas les ACL ni les triggers réels.
- Aucun numéro d’IP, chemin de production ou nom réel de processus n’est inventé ; l’utilisateur les renseignera.

Le dossier est prêt pour la revue opérateur et la répétition sur copie. Les blocages restants sont l’inventaire réel Contabo, la restauration/validation SQL, les ACL, la revue de la release de référence et les preuves Linux. La réception seule peut être conservée lors d’un déploiement approuvé du dashboard ; la présence du code ne vaut pas autorisation d’activer le chatbot, OpenAI ou les envois.
