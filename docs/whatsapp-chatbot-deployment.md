# Module WhatsApp Chatbot NVA

## Fonctionnement local

URL : /admin/whatsapp/chatbot (compte ADMIN actif). Six rubriques : aperçu, messages, FAQ, IA, conversations et paramètres. Les conversations et réponses manuelles réutilisent les services existants.
Les règles proposent plusieurs déclencheurs par mots entiers, une priorité 0–1000, activation, modification, suppression et simulateur. Limite de 100 règles ; toutes les règles initiales sont inactives. Les formulaires utilisent CSRF et échappement EJS.

Tarifs, horaires, sessions, essais et inscriptions restent réservés au moteur du catalogue. Une réponse statique ne peut pas remplacer ces intentions ni STOP, consentement, transfert humain ou une sélection de cours en attente. Les paramètres permettent de suspendre globalement les réponses métier ; les commandes de sécurité restent traitées.
OpenAI sélectionne exclusivement une FAQ approuvée, jamais un texte libre. Le catalogue est traité avant le recours IA. En cas de refus, quota, délai ou erreur, le moteur propose un conseiller. La qualité des FAQ reste à valider par l'administration : ne pas y saisir de prix ou de disponibilités périssables.
Le simulateur ne crée aucun message, livraison, consentement ni conversation. Son option OpenAI fait un appel externe et réserve une unité de quota.

## Variables serveur

- WHATSAPP_ENABLED=false et WHATSAPP_WORKERS_ENABLED=false pendant développement, tests et préparation du déploiement.
- NVA_CHATBOT_AI_ENABLED=false par défaut ; autorisation serveur distincte des paramètres du dashboard.
- OPENAI_API_KEY : secret serveur uniquement, jamais dans les vues ou les logs.
- OPENAI_MODEL : identifiant de modèle autorisé sur le compte, obligatoire pour appeler l'API.
- NVA_CHATBOT_AI_DAILY_CALL_LIMIT=50 : de 1 à 1000 réservations par jour UTC, partagées en PostgreSQL.
- DATABASE_URL : base locale dédiée ; ne jamais utiliser la base de production pour les tests.
- PUBLIC_APP_URL : URL officielle déjà utilisée par le moteur.

L'appel utilise Responses, store:false, au plus 1000 caractères de question et 20 FAQ tronquées à 600 caractères, 64 tokens de sortie, aucun retry automatique et un délai HTTP de 1200 ms. Le quota compte aussi les erreurs et retries SQL pour éviter de sous-estimer les dépenses. C'est un plafond de volume, pas une garantie monétaire : fixer aussi un budget et les permissions du projet OpenAI. Référence : https://developers.openai.com/api/docs/guides/text

## Contrat Meta Inbox

Le runtime de production reste réception seule. L'adaptateur transactionnel peut appliquer les règles persistées avec son tx, mais n'appelle jamais OpenAI ni le client Prisma racine. L’IA reste disponible dans le simulateur de FAQ ; la finalisation des réponses persistées est effectuée hors transaction et reste subordonnée à l’autorisation serveur. Le runtime Meta demeure réception seule et une autorisation distincte serait nécessaire pour traiter ou envoyer en production. Aucun worker Meta ni envoi automatique n'a été activé.
Correction de préparation : le moteur transactionnel réserve désormais uniquement une réponse de repli AI_PENDING. La réservation de quota et l’appel OpenAI ont lieu après commit, dans whatsappChatbotAICompletionService. Ce service revalide conversation, dernier entrant et FAQ avant mise à jour. Le parcours historique l’appelle après son commit ; le circuit de livraison existant le réutilise après le commit Meta lorsque ce circuit sera explicitement autorisé. Aucun worker supplémentaire ni envoi n’est activé. Voir whatsapp-production-readiness-report.md et whatsapp-production-operator-runbook.md.

## Installation sur une base locale isolée

1. Créer/configurer une base PostgreSQL de développement dédiée et vérifier son identité avant toute migration. Ne pas réutiliser DATABASE_URL de production.
2. Examiner l'état des migrations : le dépôt contient aussi des travaux Prisma précédents. Ne pas appliquer toutes les migrations sans revue.
3. Appliquer la migration 20261020120000_add_whatsapp_chatbot_admin dans l'environnement local préparé ; elle ajoute uniquement trois tables et trois réponses inactives. Elle ne modifie aucune conversation existante.
4. Générer le client avec node scripts/generatePrismaClient.js, puis démarrer le serveur avec les deux flags WhatsApp à false.
5. Consulter le dashboard, créer une réponse inactive, tester, activer uniquement cette règle, puis vérifier STOP, conseiller et catalogue au simulateur.

## Tests isolés sans base ni réseau

node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappChatbot.test.js tests/whatsappHumanHttp.test.js tests/whatsappConversationEngine.test.js tests/metaInboxPrismaAdapter.test.js

Le garde bloque tout accès Prisma réel, pg et fetch global. Les tests IA utilisent un fetch injecté. Validation schéma : node node_modules/prisma/build/index.js validate. Aucune migration ou fixture de production ne doit être exécutée pour ces tests.

## Déploiement Contabo — seulement après autorisation explicite

Préparer un commit/release et une sauvegarde vérifiée de la base et de la release NVA. Revoir les migrations déjà appliquées et les déclarations Prisma non déployées. Garder les flags WhatsApp false, laisser le webhook https://www.newvisionacademy.org/webhooks/whatsapp et son rôle de réception inchangés. Appliquer uniquement les migrations approuvées, générer le client de la release, redémarrer uniquement NVA, puis vérifier connexion admin, CSRF, configuration, simulateur et réception Meta. Ne jamais redémarrer ou modifier NovanceTech. L'activation des envois demande une autre autorisation explicite.

## Retour arrière

Désactiver l'IA serveur et les réponses dans les paramètres, garder les flags d'envoi false. Restaurer la release NVA précédente et son client Prisma, puis redémarrer uniquement son processus. Conserver les trois nouvelles tables : elles sont additives et ignorées par l'ancienne release. Ne supprimer aucune conversation ni réception Meta. Une suppression des nouvelles tables ne doit être envisagée qu'après sauvegarde et validation, si aucune release active ne les utilise. Ne pas réinitialiser la base et ne pas modifier les migrations déjà appliquées.

## Validation et limites

Les 47 tests ciblés et 161 tests de non-régression ont réussi avec le garde isolé. Le client Prisma a été généré, le schéma validé et les 158 vues EJS compilées. Le rendu a été vérifié dans Edge à 390 et 1440 pixels, sans débordement horizontal. Les aperçus sont dans output/whatsapp-chatbot. La tentative de démarrer une instance PostgreSQL temporaire a échoué : installation locale incomplète (postgres.bki absent et erreur de jeton restreint). Aucun serveur temporaire ni aucune migration SQL ne sont exécutés. L'application SQL et un essai complet sur PostgreSQL local dédié restent à effectuer avant qualification de déploiement. Aucun appel réel OpenAI ni envoi WhatsApp n'est nécessaire pour valider les tests fournis.
