# NVA WhatsApp V3 — validation finale avant déploiement

> Suivi : les trois anomalies applicatives ci-dessous sont corrigées et validées dans le [rapport des corrections V3](nva-whatsapp-v3-corrections-report.md). Ce document conserve les preuves et décisions historiques ; le bilan technique actuel est celui du rapport des corrections. Les prérequis opérationnels de cible restent à attester.

Date : 26 octobre 2026, Africa/Kinshasa. Ce rapport remplace la conclusion de préparation du rapport de livraison V3.

## Décision : NO-GO pilote en l’état, même avec les relances désactivées

Les tests métier et les contrôles de compilation réussissent. Toutefois, un **blocage SQL du candidat de déploiement** a été reproduit sur PostgreSQL réel : les droits du rôle worker documenté ne couvrent pas les colonnes que V3 écrit lors de la réception d’un message, même lorsque les relances sont désactivées. Deux autres anomalies concernent les affirmations commerciales générées et certains choix de langue.

Il n’y a eu aucun déploiement, push GitHub, accès Contabo, modification du `.env` réel ou migration sur une base existante. Aucun appel réel à OpenAI, Meta ou SMTP. Les consultations de documentation publique sont distinctes des appels aux API métier.

## Résultats des douze vérifications demandées

| Point | Résultat | Preuve et limite |
| --- | --- | --- |
| 1. PostgreSQL local dédié | **Réussi pour les parcours métier ; anomalie ACL reproduite** | Cluster neuf, PostgreSQL 16.15, `127.0.0.1:59432`, base `nva_whatsapp_v3_test`, données synthétiques uniquement ; voir isolation ci-dessous |
| 2. Réception simulée → réponse préparée | **Réussi** | Entrée WhatsApp simulée via le service transactionnel réel, messages persistés, réponse `QUESTION_AI_PENDING` commitée, appel Responses simulé puis réponse `QUEUED` préparée dans PostgreSQL. Aucun envoi. L’HTTP signé et le worker Meta sont également couverts dans les suites isolées ; le laboratoire SQL V3 ne prétend pas être un échange HTTP réel avec Meta |
| 3. `gpt-4.1-mini` et Responses | **Compatibilité documentaire et contrat local vérifiés** | Modèle exact dans la requête simulée, `/v1/responses`, `instructions`, entrée texte JSON, `text.format.json_schema`, schéma strict, `store:false`, aucun outil. Accès du compte, disponibilité effective, latence et sortie du modèle non testés |
| 4. Règles commerciales NVA | **Faits officiels synthétiques corrects ; garde du texte généré insuffisante** | Catalogue réel Prisma, formation publiée à 60 USD, trois niveaux/180 USD, cinq essais inclus, acompte/solde de 30 USD, certificat de 20 USD et total 200 USD ; groupes ouverts lus en SQL. Conditions non propagées à Excel. Trois affirmations inventées restent acceptées par le service, voir A2 |
| 5. Naturel, politesse, persuasion et variété | **Partiel, qualité réelle non vérifiée** | Instructions adéquates et exemples synthétiques courts, courtois, avec une question. Les mocks imposent leurs propres réponses : ils ne démontrent ni la persuasion ni l’absence de répétitions de `gpt-4.1-mini`. Aucune évaluation réelle du modèle sans autorisation |
| 6. Français/anglais | **Partiel : anomalie reproductible** | `in English` et `Parlez-moi en anglais` fonctionnent ; préférence EN conservée après `OK` en SQL. `English please` et `Je préfère l’anglais` restent détectés FR depuis une préférence FR, voir A3 |
| 7. Inscription sécurisée | **Réussi sur le périmètre vérifié** | Intention d’inscription sort de QUESTION_AI, propose les options existantes site/WhatsApp, sans nouvel appel IA, sans création automatique d’Enrollment ni validation administrative par le modèle. Les validations complètes du workflow existant sont aussi couvertes par la non-régression |
| 8. Relances, consentement, STOP, dossiers et doublons | **Réussi avec le rôle métier du laboratoire ; ACL du worker bloquante** | Consentement daté/versionné, retrait durable, absence d’envoi avant 48 h, report après nouvel entrant, inscrits/dossiers PENDING exclus, template non vérifié bloqué, deux traitements concurrents : une seule soumission simulée. Contraintes uniques et déduplication vérifiées en PostgreSQL |
| 9. Relances désactivées et tests sans envoi réel | **Réussi** | Valeurs par défaut `false`/simulation `true`. Worker désactivé : aucun claim. Simulation : aucun appel de vérification Meta ni sender. Tests isolés protégés par `whatsappIsolationGuard`; laboratoire : `global.fetch` interdit, expéditeurs injectés et zéro tentative externe comptabilisée |
| 10. PM2 et scripts | **Fichiers vérifiés ; noms actifs non vérifiables localement** | Le fichier racine déclare `english-center`, le candidat hérite de ce nom et déclare `nva-meta-inbox-worker-candidate`. Aucun de ces noms n’est une preuve de processus actif. PM2 absent de la commande locale ; aucun inventaire Contabo demandé/exécuté. Anomalie documentaire antérieure corrigée, voir A4 |
| 11. Suites, Prisma et EJS | **Réussi** | 73/73 V3, 415/415 non-régression, 9/9 PostgreSQL, schéma Prisma valide, 164 vues EJS compilées. Suites recouvrantes : ne pas additionner les comptes comme tests uniques |
| 12. Rapport, anomalies et risques | **Livré** | Présent document, preuves JSON et journaux dans `output/nva-v3-final-validation/` |

## Isolation du laboratoire PostgreSQL

Le dernier passage concluant se trouve dans :

`output/nva-v3-final-validation/run-1793045732053/`

Le lanceur n’accepte aucune URL de connexion fournie par l’environnement. Il crée un nouveau répertoire de cluster pour chaque exécution, vérifie que le port est libre avant démarrage, puis atteste en SQL le rôle propriétaire, l’adresse IPv4 loopback, le port et le répertoire `data_directory`. Il refuse toute base métier préexistante dans ce cluster neuf avant de créer la base V3. Il n’utilise aucun dump ni ancienne base de laboratoire.

Les identifiants temporaires sont générés en mémoire, expurgés des journaux et non enregistrés dans un `.env`. L’HBA n’autorise que les rôles du laboratoire en loopback. Le rôle d’exécution métier n’est ni propriétaire ni superuser, n’a pas CREATE/TRUNCATE/CREATEDB/CREATEROLE/BYPASSRLS ; il reçoit des droits DML explicitement destinés aux fixtures. Ces droits ne sont pas présentés comme les ACL de production.

Les migrations du dépôt et le DDL Meta revu existant ont été appliqués uniquement à cette base neuve. La nécessité du DDL Meta séparé confirme que `prisma validate` et un `migrate deploy` seuls ne prouvent pas la présence de tous les objets du runtime Meta. Aucune migration nouvelle n’a été produite et aucun diff global n’a été appliqué.

Le cluster final a été arrêté proprement. `stop.log` indique `server stopped` et `cluster/postmaster.pid` est absent. Les autres clusters démarrés pendant les mises au point du laboratoire ont aussi été arrêtés ; ils sont conservés hors ligne avec leurs journaux. L’installation PostgreSQL incomplète du PATH a été écartée au profit des binaires 16.15 déjà vérifiés présents localement. Aucun service Windows PostgreSQL existant n’a été redémarré ou modifié.

### Preuves principales

- `identity.json` : fraîcheur, identité du serveur et répertoire du cluster.
- `migrations.json` / `migrations.log` : migrations appliquées dans le laboratoire uniquement.
- `postgres-tests.log` : neuf tests réussis, aucun ignoré.
- `business-evidence.json` : droits du rôle métier, réponses synthétiques identifiées comme telles, contrat `gpt-4.1-mini`, messages préparés et zéro tentative de transport externe.
- `worker-acl-probe.json` : reproduction réelle du défaut de droits du script worker.
- `result.json` : `SQL_TESTS_PASS_WITH_WORKER_ACL_BLOCKER`, et non un GO global.
- `stop.log` : arrêt contrôlé.

Les premiers passages ont révélé des erreurs de préparation des fixtures : date de fin manquante, formation incomplète donc correctement exclue du catalogue public, puis horloge simulée incompatible avec la revalidation de l’heure SQL. Les fixtures ont été corrigées sans modifier le code applicatif ; les traces restent conservées. Le dernier passage utilise des messages synthétiques antidatés pour représenter l’inactivité, tandis que la soumission est autorisée à l’heure réelle du serveur.

## A1 — Bloquant : droits du worker insuffisants, même relances désactivées

Source du contrat de droits : `docs/sql/meta-inbox-production-worker-role.sql`, lignes 66–68.

Sur `whatsapp_prospect_follow_ups`, les droits UPDATE publiés couvrent les statuts et callbacks, mais pas :

- `scheduled_for` ;
- `template_name` ;
- `template_language` ;
- `attempts` ;
- `accepted_at`.

Le service V3 écrit les trois premières colonnes lors de chaque réception dans `whatsappConversationService.js`, lignes 206–213. La branche teste `config48.followUp48h`, qui est activé dans la configuration V3, et **ne teste pas** `prospectFollowUpsEnabled`. PostgreSQL vérifie les droits de colonne même lorsqu’aucune ligne ne correspond au WHERE.

Reproduction sur une nouvelle identité NOLOGIN/NOINHERIT du laboratoire, avec exactement la liste de colonnes UPDATE extraite du script canonique, aucune propriété ni autre attribution :

```sql
UPDATE public.whatsapp_prospect_follow_ups
SET scheduled_for = clock_timestamp()
WHERE false;
-- PostgreSQL : 42501 (insufficient_privilege)
```

Cette instruction ne modifie aucune ligne. Elle démontre que le paquet de droits documenté est incompatible avec l’écriture V3. **Un worker utilisant ces ACL peut échouer dès le traitement entrant**, pas seulement à l’envoi d’une relance. Les droits effectifs du serveur restent inconnus et pourraient différer : aucune affirmation n’est faite sur une panne actuelle de production.

Avant GO : préparer une correction locale ciblée du parcours désactivé et/ou des ACL strictement nécessaires, avec revue des privilèges, puis rejouer le parcours entier sous le rôle worker réellement prévu, sans droits métier élargis. Aucune correction ou attribution de droits n’a été appliquée pendant cette validation.

## A2 — Bloquant pour le conseiller commercial libre : affirmations inventées acceptées

Le prompt exige des faits officiels. Cependant, `validateReply` contrôle surtout les nombres, liens et certaines formulations littérales ; il ne vérifie pas la correspondance sémantique entre le texte et les faits sélectionnés.

Les trois sorties suivantes, renvoyées volontairement par un fournisseur **simulé** avec `factIds: []`, sont acceptées telles quelles par `createQuestionAIService.answer` :

| Sortie synthétique | Risque |
| --- | --- |
| « Vous pouvez payer par PayPal. » | Moyen de paiement non confirmé |
| « Notre certificat est reconnu dans le monde entier. » | Reconnaissance non attestée |
| « Votre dossier est accepté, bienvenue parmi nos étudiants. » | Confirmation verbale qui contourne la liste de formulations interdites |

Ces réponses n’ont pas été envoyées à un prospect et ne proviennent pas de `gpt-4.1-mini`. Aucun paiement ou Enrollment n’est créé par ces textes. La preuve porte sur l’acceptation par le contrôle applicatif, pas sur la probabilité qu’un modèle les produise. Cela empêche toutefois d’affirmer que le système bloque les promesses inventées conformément au cahier des charges.

Avant GO du conseiller : renforcer la construction/validation des affirmations commerciales, ajouter ces cas au jeu d’acceptation et traiter explicitement les confirmations administratives paraphrasées. Une simple liste élargie de mots interdits ne prouverait pas l’exactitude de tout texte généré.

Preuve : `output/nva-v3-final-validation/offline-audit.json`, section `unsupportedClaims`.

## A3 — Choix de langue incomplet

Résultats depuis une préférence FR :

| Demande | Langue détectée |
| --- | --- |
| `English please` | FR — anomalie |
| `Je préfère l’anglais` | FR — anomalie |
| `Parlez-moi en anglais` | EN |
| `in English` | EN |
| `Français` | FR |

La préférence EN se conserve bien pour `OK`, comme vérifié en PostgreSQL. Le choix explicite doit être rendu fiable pour les formulations courantes. En outre, le service ne vérifie pas que la langue déclarée par le modèle correspond à la langue attendue ; cette vérification repose actuellement sur les instructions au modèle.

## A4 — PM2 : déclaration locale, identité active inconnue

| Artefact | Constat |
| --- | --- |
| `ecosystem.config.cjs` | Nom déclaré `english-center`, script `src/server.js` |
| `deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs` | Hérite du nom racine ; worker candidat `nva-meta-inbox-worker-candidate` ; fichier explicitement marqué REVIEW ARTIFACT ONLY |
| `deploy/whatsapp-chatbot/operator-functions.sh` | `nva_check_context` exige `NVA_PROCESS` et un répertoire absolu, vérifie nom unique + cwd réel via l’inventaire PM2 avant toute action ; refuse NovanceTech |
| Rapports opérationnels précédents | L’inspection Contabo n’avait pas été exécutée ; un nom en production ne peut pas en être déduit |
| Poste local | Commande PM2 non disponible ; aucun daemon PM2 n’a été lancé pour cette revue |

La commande antérieure `pm2 reload ... --only english-center` était trop affirmative : elle est retirée du rapport de livraison. Le nom effectif doit être identifié lors d’une inspection serveur autorisée distincte, sans déduire son nom du package ou d’un fichier ecosystem.

Autre écart : le candidat PM2 et `nva_restart_disabled` neutralisent les anciens flags, mais n’imposent pas explicitement les nouveaux `NVA_AI_ENABLED`, `NVA_FOLLOWUPS_ENABLED` et `NVA_FOLLOWUPS_DRY_RUN`. Leurs valeurs peuvent être héritées du fichier ou du processus. Cela ne prouve pas un envoi possible lorsque tous les anciens circuits sont fermés, mais le protocole de déploiement V3 doit forcer et contrôler `NVA_FOLLOWUPS_ENABLED=false` et `NVA_FOLLOWUPS_DRY_RUN=true`, y compris dans l’environnement effectif après démarrage.

Aucun script PM2, shell de déploiement ou collecte Contabo n’a été exécuté. Aucun rôle du serveur n’a été changé.

## Qualité commerciale et compatibilité OpenAI : portée exacte

La documentation officielle du modèle indique le support de Responses et des sorties structurées. Le service utilise un contrat cohérent avec ces possibilités : modèle configurable fixé à `gpt-4.1-mini` dans le laboratoire, schéma JSON strict avec `additionalProperties:false`, trois propriétés obligatoires, budget de sortie, deadline, `store:false` et aucun outil. Les erreurs, les sorties incomplètes et les timeouts sont couverts par les tests de repli.

Ce contrôle ne démontre ni l’accès au modèle pour le compte NVA, ni la validité d’une clé, ni la disponibilité effective de l’alias, ni la qualité de ses générations. Aucun modèle n’a été remplacé. Les 256 tokens de sortie par défaut peuvent conduire au repli sur une réponse trop longue : mesurer cela lors d’un essai réel autorisé.

Les exemples de conversation du laboratoire montrent un chemin fonctionnel et des phrases synthétiques courtoises. Leur variété ne constitue pas une mesure du naturel du modèle : le fournisseur simulé choisit son texte à l’avance et certaines réponses sont volontairement répétées. La qualité persuasive, la gestion d’objections non préparées et l’absence de répétitions restent à évaluer sur un corpus FR/EN après autorisation d’appels réels, avec données synthétiques et sans transport WhatsApp réel.

Références consultées : [OpenAI Docs — GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) et [OpenAI Docs — sorties structurées](https://developers.openai.com/api/docs/guides/structured-outputs).

## Commandes et artefacts de cette validation

Commandes exécutées localement :

```sh
npm run test:whatsapp:v3
npm run test:whatsapp:release
node scripts/validateEjs.js
node node_modules/prisma/build/index.js validate --schema prisma/schema.prisma
node scripts/auditWhatsAppV3FinalOffline.js
node scripts/validateWhatsAppV3PostgresLab.js
```

Le lanceur PostgreSQL nécessite l’accès aux binaires locaux vérifiés et démarre/arrête uniquement un nouveau cluster sous `output/nva-v3-final-validation/`. Les variables de connexion héritées sont retirées du processus des tests et remplacées par des identifiants locaux éphémères. La commande Prisma `validate` est sans connexion SQL ; une URL fictive locale explicite a été fournie au dernier passage, même si Prisma annonce la lecture en mémoire du `.env` existant. Ce fichier n’a pas été écrit.

Journaux globaux :

- `output/nva-v3-final-validation/v3-isolated.txt` : 73 réussites ;
- `output/nva-v3-final-validation/non-regression.txt` : 415 réussites ;
- `output/nva-v3-final-validation/ejs.txt` : `EJS_OK=164` ;
- `output/nva-v3-final-validation/prisma.txt` : schéma valide ;
- `output/nva-v3-final-validation/offline-audit.json` : contrat modèle, anomalies, déclarations PM2 et empreintes sans secrets.

Fichiers ajoutés pendant cette validation : les deux scripts `auditWhatsAppV3FinalOffline.js` et `validateWhatsAppV3PostgresLab.js`, le test `whatsappV3Postgres.integration.test.js` et le présent rapport. Le rapport de livraison antérieur est annoté et sa commande PM2 hypothétique retirée. **Aucun fichier applicatif, migration ou script de droits/déploiement n’a été modifié dans cette intervention.**

## Ce qui reste impossible à certifier avec le seul poste local

- Nom, cwd, utilisateur, runtime et environnement effectif des processus PM2 de Contabo.
- Compatibilité Linux du build exact, permissions SQL effectives du serveur et présence de tous les objets Meta.
- État du compte Meta, approbation réelle des templates, permissions du token et routage du callback.
- Générations effectives de `gpt-4.1-mini`, coût/latence et qualité commerciale mesurée.
- Continuité avec le chatbot actuel, sauvegarde/restauration cible et confinement du pilote aux contacts autorisés.

Les anciens prérequis opérationnels documentés dans `nva-whatsapp-v2-pilot-preflight.md` ne sont pas réputés résolus par cette revue locale. Les templates ne sont toujours pas déclarés approuvés ; les relances doivent rester désactivées.

## Conditions minimales de réexamen du GO

1. Corriger et tester le parcours entrant V3 avec les ACL minimales du worker ; démontrer le traitement entrant lorsque les relances sont désactivées.
2. Renforcer le contrôle des affirmations commerciales et des confirmations administratives paraphrasées.
3. Fiabiliser le choix explicite FR/EN et rejouer les nouveaux cas de validation.
4. Adapter le protocole de déploiement aux flags V3 et au nom PM2 réellement constaté, puis qualifier la release et les droits sur une cible de recette autorisée.
5. Évaluer le modèle réel uniquement après autorisation d’appels OpenAI ; conserver `NVA_FOLLOWUPS_ENABLED=false` et `NVA_FOLLOWUPS_DRY_RUN=true` pendant le pilote envisagé.

**Conclusion explicite : le projet n’est pas prêt pour un déploiement pilote en l’état, même avec les relances automatiques désactivées. Les suites réussies établissent une base technique solide, mais ne lèvent pas les anomalies et le défaut d’ACL reproduit.**
