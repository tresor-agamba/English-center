# Fiabilité du chatbot NVA V2 — rapport final

Dernière mise à jour : **24 octobre 2026**. Modifications locales uniquement, sans API IA, déploiement ou message WhatsApp réel. Les mesures intermédiaires du 23 octobre sont conservées ci-dessous pour traçabilité.

## Résultat et décision

Après les dernières corrections, le nouveau corpus réservé à l’acceptation donne **207 reconnaissances exactes sur 216 messages, soit 95,83 %**. Le seuil de 80 % est dépassé sur cette mesure synthétique séparée. Les sept reproductions historiques sont corrigées, ainsi que les deux erreurs critiques découvertes lors de la première mesure de fiabilité. Les dix diagnostics historiques et **487 tests isolés** passent.

**Recommandation : NO-GO pour la production.** La mesure finale ne détecte plus d’erreur critique parmi ses seize cas critiques ; neuf erreurs de reconnaissance restent toutefois présentes. Les tests PostgreSQL complets et l’alignement des paramètres métier réels restent à valider. Le score global ne lève pas ces réserves. Voir la section 9 pour la mesure et les corrections du 24 octobre.

## 1. Analyse des 89 erreurs initiales

Le [rapport de validation](nva-whatsapp-v2-validation.md) a été lu intégralement. Les 89 erreurs du résultat historique 127/216 ont été examinées et regroupées. Pour chacune, l’[analyse détaillée](nva-whatsapp-v2-failure-analysis.md) conserve la question originale, l’attendu inchangé, l’ancienne détection, la catégorie, une cause probable et la correction appropriée. La version exploitable par outil est [ce fichier JSON](../output/nva-v2-reliability-failure-analysis.json).

| Catégorie | Erreurs | Cause principale |
| --- | ---: | --- |
| Formules conversationnelles | 28 | Expressions courtes ancrées ; salutations, remerciements et retours naturels non reconnus. |
| Couverture sémantique | 25 | Synonymes et combinaisons de mots manquants. |
| Frontières lexicales | 8 | Sous-chaînes : renseignements/enseigner, débutant/début, recommencer/commencer. |
| Dialogue contextuel | 7 | Choix ordinal limité à quelques formes exactes. |
| Catalogue et information | 6 | Demande de liste confondue avec information générale. |
| Parcours d’inscription | 6 | Ordre des mots et séparation insuffisante entre méthode, inscription et suivi. |
| Chevauchement de sujets | 3 | Mention contextuelle prise pour une deuxième question. |
| Spécialisation du certificat | 3 | Coût du document confondu avec certification, prix ou paiement du cours. |
| Escalade sensible | 3 | Responsable, personne réelle ou incident de paiement insuffisamment reconnus. |

Aucune réponse attendue des deux anciens corpus n’a été modifiée. Les [résultats initiaux 127/216](../output/nva-v2-holdout-final.json) et leurs empreintes restent conservés. Ces 216 messages ont servi au développement des corrections et ne constituent plus la mesure indépendante finale.

## 2. Statut des sept anomalies

| Anomalie | Cause et correction | Statut local |
| --- | --- | --- |
| CTX02 — choix du second | Résolution des ordinaux avec contexte de sélection de méthode ; variantes premier/première/second/seconde/deuxième et nombres. Les refus passent avant ce choix. | Reproduction corrigée ; nouveau corpus contextuel : 8/8. |
| CTX03 — mauvais tarif de formation | Résolution de formation séparée de l’intention : titre/slug complet prioritaire, mots distinctifs, sélection persistante, puis clarification si nécessaire. Prix actif lu au catalogue ; dates de validité et devise contrôlées. | Reproduction informatique à 90 USD corrigée ; aucun repli silencieux à 60 USD. |
| CTX04 — négation ignorée | Priorité explicite au refus et à l’annulation ; effacement du brouillon, arrêt des sollicitations d’inscription, reprise possible sur demande explicite. | Reproduction corrigée et sept formulations de refus testées ; couverture encore incomplète, voir REF01. |
| CTX05 — prix omis avec inscription | Composition des réponses d’information avant la présentation des deux méthodes, au lieu d’un retour immédiat vers l’inscription. | Reproduction prix + inscription corrigée ; certains messages composites plus complexes restent imparfaits. |
| CTX06 — nom classifié comme question | Un nom plausible au stade NAME est traité comme donnée ; les vraies questions conservent le brouillon et permettent de reprendre. Protection aussi dans le moteur historique avant sa détection de transfert. | « Jean International » passe à PHONE ; question de certificat pendant la collecte également testée. |
| BUS01 — essai contraire à la politique | Règles commerciales rattachées au parcours anglais à trois niveaux et seize séances ; offre soumise à la politique d’accès. L’accueil supprime la promotion si aucun anglais éligible n’est publié. | FULL_PAYMENT ne promet plus cinq séances gratuites ; les autres formations n’héritent pas de cette promesse. |
| BUS02 — certificat après un niveau | L’éligibilité vérifie désormais tous les numéros de niveaux configurés, pour le même étudiant et la même formation, avec inscriptions confirmées, sessions terminées et progression requise. | Un ou deux niveaux et un numéro répété échouent ; trois niveaux distincts achevés passent. Règle simple conservée pour une formation simple. Validation PostgreSQL réelle encore requise. |

Les [dix diagnostics historiques](../output/nva-v2-reliability-diagnostics.json) passent, contre trois sur dix avant correction. « Corrigée » signifie ici que la reproduction et les tests ciblés passent localement ; cela ne signifie pas que toutes les formulations possibles sont couvertes.

## 3. Architecture et règles commerciales

Le webhook, le worker, l’envoi, la déduplication, les transactions d’admission et les contrôles administratifs existants sont réutilisés.

- `whatsappCommercialIntents` : normalisation, familles lexicales bornées, cadres composés, correction approximative bornée et détection multiple. `analyzeMessage` expose intentions, indices lexicaux, score heuristique et besoin de clarification.
- `whatsappCommercialPolicy` : résolution de formation et informations commerciales limitées au produit concerné. Un titre complet l’emporte sur un simple mot partagé entre plusieurs formations ; une ambiguïté demande une précision.
- `whatsappCommercialResponder` : priorité des commandes sensibles, sélection contextuelle de méthode, questions pendant la collecte, assemblage des réponses, conservation du produit choisi et clarification avec reprise de la question initiale.
- `whatsappAdmissionJourney` conserve les étapes consentement/identité/formation/session/groupe/récapitulatif ; `whatsappConversationEngine` conserve STOP, pauses, déduplication et services historiques.
- `certificateService` vérifie le parcours académique avant d’autoriser l’éligibilité ; le paiement, l’émission et la validation administratifs restent distincts.

Le seuil de reconnaissance vaut 0,75. Les indices explicites valent normalement 0,95, les corrections approximatives sont plafonnées à 0,80 et un indice générique sans sujet précis vaut 0,40 puis retourne UNKNOWN. **Ces scores sont des heuristiques, pas des probabilités calibrées.** Une ambiguïté de produit est clarifiée même si l’intention elle-même est reconnue.

Pour le parcours anglais identifié par langue, structure LEVEL_BASED, trois niveaux et seize séances, les tests confirment : 60 USD par niveau lorsque le prix publié correspond ; 16 séances de 1 h 30, 24 heures par niveau ; cinq séances incluses au niveau 1 et onze restantes ; minimum 30 USD puis solde de 30 USD avant la fin ; trois niveaux, 48 séances et 72 heures ; certificat NVA après les trois niveaux et 20 USD supplémentaires. Aucune reconnaissance internationale ou accréditation n’est affirmée.

Les autres formations utilisent leurs prix actifs et leurs frais de certificat publiés lorsqu’ils sont disponibles. À défaut, le bot demande une vérification humaine. Il ne transpose ni 60 USD, ni 20 USD, ni les 72 heures ou l’essai anglais. Si le prix anglais publié diffère de 60 USD, le bot donne le prix réellement publié au lieu d’inventer un tarif ; cette divergence reste à arbitrer avant activation.

Le champ de frais de certificat a été ajouté à la projection du catalogue public existant. Aucun nouveau modèle ni migration n’est nécessaire. Les montants effectifs de certification restent configurables dans le service existant et doivent être rapprochés des 20 USD officiels sur la cible. Le seuil d’accès partiel historique de dix séances n’a pas été modifié : sa cohérence avec la communication du solde avant la fin doit également être confirmée.

## 4. Séparation développement / première mesure (23 octobre)

| Corpus | Utilisation | Résultat |
| --- | --- | --- |
| 210 questions initiales | Développement et non-régression | 209/210 dans le dernier passage de la suite. |
| 216 questions de l’audit | Référence historique, puis développement pour cette mission | Avant : 127/216, 58,80 %. Après : 212/216, 98,15 %. Ce résultat après correction n’est pas indépendant. |
| [232 nouveaux messages](../tests/fixtures/nvaReliabilityFinalHoldout.cjs) | Première mesure séparée, ensuite devenue corpus de développement le 24 octobre | **215/232, 92,67 %** au premier passage ; résultats conservés avant corrections supplémentaires. |

Le corpus final contient 192 messages répartis sur les 24 catégories historiques, huit refus, seize messages multi-intentions, huit choix contextualisés et huit réponses ambiguës. Aucun doublon interne ni chevauchement textuel après normalisation avec les corpus de 210 et 216 questions. Les synonymes et les intentions communes ne sont évidemment pas indépendants au sens sémantique.

Ce corpus est synthétique, écrit séparément après l’implémentation des corrections. Il n’est ni une collecte de clients réels, ni une évaluation externe en aveugle. La mesure porte sur `detectIntents`, pas sur le taux de conversion ou la réussite de toutes les conversations. Les données attendues sont figées ; le détail des erreurs est conservé sans réétiquetage.

Empreinte SHA-256 du corpus final : `00cb4f766ec9def8c40277b7943a3fbc184151eea71b0dc4251ea87b6744f330`.

Empreinte du classificateur mesuré : `7abb3935cfa04635ea371d0a994c5b97fe9f08adab71df3d8e3e962bb740934c`.

## 5. Première mesure détaillée, conservée avant corrections supplémentaires

| Indicateur | Résultat |
| --- | --- |
| Reconnaissance exacte de l’ensemble d’intentions | 215/232 — **92,67 %** |
| Précision micro | 94,09 % |
| Rappel micro | 96,37 % |
| F1 micro | 95,22 % |
| Vrais positifs / faux positifs / faux négatifs | 239 / 15 / 9 |
| Messages en échec exact | 17 |
| Messages d’intention connue retournant UNKNOWN | 3 |
| Messages nécessitant une clarification, annotés à l’avance | 8/8 retournent UNKNOWN |
| Réponses courtes contextualisées | 8/8 exactes |
| Refus du corpus final | 7/8 reconnus |
| Cas préannotés critiques, refus et ordinaux | 1 échec sur 16 |
| Erreurs critiques après revue des confusions de canal/refus | **2** |

Les métriques micro incluent UNKNOWN. Un message est exact uniquement si son ensemble prédit est égal à l’ensemble attendu ; les intentions parasites comptent donc comme erreurs. La précision par intention peut être retrouvée par TP/(TP+FP), et le rappel par TP/support, dans les [résultats complets](../output/nva-v2-reliability-final232.json).

| Intention | Support attendu | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: |
| GREETING | 8 | 8 | 0 | 0 |
| MAIN_MENU | 8 | 8 | 0 | 0 |
| TRAINING_INFORMATION | 8 | 8 | 0 | 0 |
| TRAINING_LIST | 9 | 9 | 0 | 0 |
| TEACHING_METHOD | 10 | 9 | 5 | 1 |
| FREE_TRIAL | 10 | 10 | 1 | 0 |
| ENGLISH_TRAINING | 8 | 7 | 0 | 1 |
| PRICING | 14 | 13 | 0 | 1 |
| UNKNOWN | 16 | 15 | 3 | 1 |
| PAYMENT_TERMS | 10 | 8 | 0 | 2 |
| SESSION_START_DATE | 11 | 11 | 2 | 0 |
| TRAINING_DURATION | 11 | 11 | 0 | 0 |
| TRAINING_SCHEDULE | 12 | 11 | 0 | 1 |
| AVAILABLE_SESSIONS | 9 | 9 | 0 | 0 |
| REGISTRATION | 10 | 10 | 2 | 0 |
| CERTIFICATION | 10 | 10 | 0 | 0 |
| CERTIFICATE_COST | 10 | 10 | 0 | 0 |
| ONLINE_LEARNING | 10 | 10 | 1 | 0 |
| REGISTRATION_WEBSITE | 12 | 12 | 1 | 0 |
| REGISTRATION_WHATSAPP | 12 | 11 | 0 | 1 |
| REGISTRATION_STATUS | 8 | 8 | 0 | 0 |
| HUMAN_ADVISOR | 8 | 8 | 0 | 0 |
| THANKS | 8 | 8 | 0 | 0 |
| GOODBYE | 8 | 8 | 0 | 0 |
| REFUSAL | 8 | 7 | 0 | 1 |

Erreurs critiques identifiées le 23 octobre, puis corrigées le 24 octobre (section 9) :

- **REF01** : « Je décline votre proposition d’inscription » → REGISTRATION au lieu de REFUSAL. Le bot risque de proposer les méthodes malgré ce refus ; aucun compte ou enregistrement n’est créé sans consentement et confirmation séparés.
- **CANAL01** : « Restons sur WhatsApp pour m’inscrire sans ouvrir de site » → REGISTRATION_WEBSITE au lieu de REGISTRATION_WHATSAPP. La négation portant sur un canal doit encore être analysée.

Autres limites observées : « solder » non reconnu comme paiement ; certaines formulations de prix ou d’horaire singulier non reconnues ; début de niveau mentionné dans une question d’essai pris pour une date ; mot enseignement/méthode produisant une intention parasite ; télévision « à distance » prise pour une demande d’apprentissage ; omission d’un sujet dans deux messages composites. Les 17 échecs avec attendus et prédictions figurent intégralement dans le JSON. Ils n’ont pas été ajoutés aux règles pour gonfler la mesure finale.

## 6. Tests exécutés

| Commande / contrôle | Résultat | Preuve |
| --- | --- | --- |
| `npm.cmd run test:whatsapp:release` | 410 réussites, 0 échec | [journal](../output/nva-v2-reliability-regression.log) |
| Tests fonctionnels + fiabilité | 23 réussites, 0 échec : 12 existants + 11 nouveaux | [journal](../output/nva-v2-reliability-scenarios.log) |
| Intégration de cible, coordination, horloge, consolidation Meta et PDF du certificat | 52 réussites, 0 échec | [journal](../output/nva-v2-reliability-extra-regression.log) |
| Diagnostics historiques | 10/10, code 0 | [résultats](../output/nva-v2-reliability-diagnostics.json) |
| Évaluation finale | 215/232 | [résultats](../output/nva-v2-reliability-final232.json) |
| Syntaxe Node des sept modules applicatifs concernés | Réussie | `node --check` |
| Suite globale `npm test` | **Non exécutée jusqu’aux tests** : lanceur arrêté, code 1 | [journal expurgé](../output/nva-v2-reliability-all-tests-attempt-redacted.log) |

Total des trois suites isolées : **485 tests réussis, aucun échec ni test ignoré**. Ce total ne comprend pas la suite PostgreSQL globale et ne remplace pas les 17 erreurs de reconnaissance révélées par la mesure finale.

Les onze nouveaux tests couvrent refus/reprise, ordinaux et négation, prix et certificat de plusieurs formations, tarif manquant, FULL_PAYMENT, questions multiples, nom « International », clarification, parcours de certification incomplet/complet, formation simple et titre exact face à des mots partagés. Le parcours worker complet existant et les tests de livraison continuent à utiliser un transport Meta simulé.

La tentative PostgreSQL a été limitée à une identité de test distincte de la base applicative et à un endpoint local. Le contrôle direct a reçu `28P01` (authentification refusée). `npm test` a généré le client Prisma puis son lanceur de préparation/reset de test s’est arrêté avec une erreur du moteur de schéma ; la suite globale n’a pas démarré et aucune réussite de reset/migration n’est revendiquée. Aucun reset ni aucune migration de production n’a été exécuté.

Une tentative de création d’un laboratoire neuf sous `output/nva-reliability-postgres` a également échoué : fichiers d’installation nécessaires absents et erreur de jeton restreint Windows. Aucun cluster de cette tentative n’a démarré. Il faut un PostgreSQL de test isolé fonctionnel pour conclure sur les transactions réelles, la nouvelle requête académique et tous les tests du dépôt. Les journaux d’essai ont été expurgés des valeurs sensibles avant référencement.

Commandes reproductibles, sans activation de transport :

```powershell
npm.cmd run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappV2FunctionalValidation.test.js tests/whatsappV2Reliability.test.js
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappIntegrationTarget.test.js tests/whatsappSubmissionCoordinator.test.js tests/whatsappFixtureClock.test.js tests/metaWhatsAppConsolidation.test.js tests/certificatePdf.test.js
node --require ./tests/helpers/whatsappIsolationGuard.cjs scripts/validateNvaV2Conversations.js output/nva-v2-reliability-diagnostics.json
node --require ./tests/helpers/whatsappIsolationGuard.cjs scripts/evaluateNvaV2Holdout.js output/nva-v2-reliability-final232.json tests/fixtures/nvaReliabilityFinalHoldout.cjs
node scripts/analyzeNvaV2Failures.js
```

Ne pas lancer `npm test` sur un environnement non vérifié : le lanceur existant prépare/réinitialise sa base de test. Utiliser un laboratoire dédié sans données existantes, des accès vérifiés et des transports simulés.

## 7. Fichiers créés et modifiés

Application — créés :

- `src/services/whatsappCommercialPolicy.js`
- `src/services/whatsappCommercialResponder.js`

Application — modifiés :

- `src/services/whatsappCommercialIntents.js`
- `src/services/whatsappAdmissionJourney.js`
- `src/services/whatsappConversationEngine.js`
- `src/services/certificateService.js`
- `src/services/publicCourseService.js`

Tests et preuves :

- Créés : `tests/whatsappV2Reliability.test.js`, `tests/fixtures/nvaReliabilityFinalHoldout.cjs`, `scripts/analyzeNvaV2Failures.js`, `docs/nva-whatsapp-v2-failure-analysis.md`, ce rapport et les artefacts `output/nva-v2-reliability-*`.
- Modifiés : `scripts/evaluateNvaV2Holdout.js` pour mesurer un corpus explicite, FP/FN et erreurs critiques ; `scripts/validateNvaV2Conversations.js` pour choisir un fichier de sortie séparé.
- Modifiés : `tests/whatsappCommercialV2.test.js` pour fournir les champs de tarif publié requis dans sa fixture ; `tests/whatsappAdmissions.test.js` pour vérifier un accueil sans promesse d’essai interdite. Aucun attendu de corpus n’a été changé. La génération du client Prisma a actualisé les artefacts locaux dans `node_modules`, sans changement de schéma.

Aucun nouveau paquet installé, aucun changement de `.env`, PM2, token, droits Meta, schéma Prisma ou fichier de migration. Aucun accès au catalogue de production ni confirmation de ses dates, tarifs ou frais actuels.

## 8. Limites et conditions avant GO

1. REF01 et CANAL01 ont été corrigés le 24 octobre et un autre corpus de 216 messages a été réservé à la nouvelle mesure. Les neuf erreurs de cette dernière mesure restent à traiter ; réserver encore un autre corpus si elles servent à ajuster les règles.
2. Faire passer la suite complète sur PostgreSQL de laboratoire, en particulier l’éligibilité multi-niveaux, la concurrence, la capacité des groupes et la conversion administrative. Les mocks ne prouvent pas la requête SQL réelle.
3. Confirmer sur une préproduction représentative les identités de formations, les tarifs, les politiques d’essai, les frais de certificat et l’échéance effective d’accès partiel. L’identification du parcours anglais repose encore sur la langue du titre/slug et la structure ; un identifiant métier explicite serait plus robuste.
4. Traiter les autres erreurs de compréhension sans compromettre la clarification. Les familles de règles restent déterministes et leurs scores ne sont pas calibrés sur une population de prospects.
5. Conserver les réserves de l’audit de compatibilité Contabo : schéma, rôles, SQL Meta, sauvegarde/restauration et procédure de retour arrière. La pagination au-delà de dix choix, la rétention des brouillons expirés et les limites des messages restent celles du rapport précédent.

**Objectif mesuré du classificateur dépassé sur le nouveau corpus ; validation opérationnelle et métier encore incomplète. NO-GO pour un déploiement contrôlé auprès de prospects.** Aucun déploiement ni envoi réel n’a été effectué.

## 9. Suite de l’implémentation — 24 octobre 2026

### Corrections complémentaires

- **REF01 corrigée** : les familles « je décline », « nous déclinons » et « je rejette » sont traitées comme refus avant l’inscription. Cette priorité vaut aussi pendant la collecte d’identité : ces phrases ne sont plus enregistrées comme un nom.
- **CANAL01 corrigée** : une analyse dédiée rattache « sans », « pas », « ni » ou un rejet au canal mentionné. Un site exclu ne prend plus la priorité sur un WhatsApp choisi positivement, et inversement. Les mentions sont examinées par segments, en tenant compte des connecteurs.
- Lorsque les deux canaux restent proposés sans choix explicite, le classificateur retourne UNKNOWN avec une ambiguïté de méthode ; le parcours présente une clarification neutre. Il ne choisit pas un canal à la place du prospect.
- Un refus conserve son effet après une question incomprise : le bot ne réintroduit pas automatiquement une invitation d’inscription. Une nouvelle demande explicite permet de reprendre.

Deux tests supplémentaires, portant sur plusieurs formulations chacun, ont été ajoutés dans `tests/whatsappV2Reliability.test.js`. Le classificateur et le répondeur ont été modifiés ; aucun schéma, transport, worker, configuration de production ou paramètre d’accès n’a été changé pendant cette suite.

### Nouvelle mesure séparée

Le [corpus d’acceptation](../tests/fixtures/nvaReliabilityAcceptanceHoldout.cjs) contient **216 messages** : 200 mono-intention sur 25 catégories, huit choix de méthode contextualisés et huit messages multi-intentions. Les seize messages préannotés critiques sont les huit refus et les huit choix contextualisés. Aucun doublon interne ni chevauchement textuel normalisé avec les trois corpus précédents de 210, 216 et 232 messages.

Ce corpus a été écrit après les corrections, puis mesuré sans ajuster les règles sur ses résultats. Les attendus n’ont pas été modifiés. Il reste synthétique et rédigé par le même intervenant, sans collecte de prospects réels ni validation externe en aveugle. Les corpus antérieurs et leurs résultats initiaux sont conservés.

| Indicateur d’acceptation | Résultat |
| --- | --- |
| Ensembles d’intentions exacts | **207/216 — 95,83 %** |
| Précision micro | 96,52 % |
| Rappel micro | 99,11 % |
| F1 micro | 97,80 % |
| TP / FP / FN | 222 / 8 / 2 |
| Messages non exacts | 9 |
| Cas critiques préannotés | **16/16 exacts** |
| Erreurs critiques refus/canal détectées | 0 |
| Choix contextualisés | 8/8 exacts |
| Intentions connues retournant UNKNOWN | 0 |
| Doublons / chevauchements normalisés | 0 / 0 |

Les comptes par intention, les erreurs et leurs attendus sont dans [les résultats d’acceptation](../output/nva-v2-reliability-acceptance216.json). Le fichier de mesure vérifie désormais l’absence de chevauchement avec le corpus de 232 lorsque celui d’acceptation est utilisé.

Empreinte SHA-256 du corpus : `08d199094f967e6c430c843d22f16c37b3a8ccdda04ad0a92ac25111e2dc83fd`.

Empreinte du classificateur mesuré : `4f10fe491183b022727c5f78fa746aac3987e0b0f41a1d3867899cb17243ea2c`.

### Erreurs restantes

Sept messages contiennent des intentions parasites : montant d’un solde interprété aussi comme prix ; nombre de cours gratuits interprété aussi comme prix ; jours de cours interprétés aussi comme catalogue ; coût d’une attestation interprété aussi comme prix du cours ; enseignement en présentiel interprété aussi comme méthode ; « méthode » d’inscription interprétée comme pédagogie ; horaires de cours en ligne interprétés aussi comme catalogue.

Un remerciement contenant « accueil » est pris pour un retour au menu. Un message demandant à la fois certificat et frais de cours ne conserve que le coût du certificat. Ces neuf erreurs sont conservées dans la mesure ; aucun ajustement n’a été fait pour les masquer. L’absence d’erreur critique sur ce corpus fini ne garantit pas l’absence de tout autre refus ou choix de canal mal compris.

### Dernière non-régression et décision

- Suite WhatsApp existante : **410/410**.
- Parcours fonctionnels et fiabilité : **25/25** — douze tests fonctionnels et treize tests de fiabilité.
- Tests complémentaires : **52/52**.
- Total : **487 réussites, 0 échec, 0 ignoré** dans les trois suites isolées. Les journaux référencés en section 6 correspondent à ces derniers passages ; les nombres de la section 6 décrivent le passage intermédiaire.
- Dix diagnostics historiques : **10/10**, code 0.

Reproduction de la mesure finale :

```powershell
node --require ./tests/helpers/whatsappIsolationGuard.cjs scripts/evaluateNvaV2Holdout.js output/nva-v2-reliability-acceptance216.json tests/fixtures/nvaReliabilityAcceptanceHoldout.cjs
```

**NO-GO maintenu pour la production**, en raison de la validation PostgreSQL et de la cohérence des paramètres métier réels encore non établies. Les deux erreurs critiques connues de la première mesure ne sont plus des blocages ouverts. La poursuite des essais isolés reste possible. Aucun déploiement ou envoi WhatsApp réel effectué.
