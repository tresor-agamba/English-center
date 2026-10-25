# Validation fonctionnelle NVA WhatsApp V2

Date : 23 octobre 2026 — périmètre local, transports simulés, aucune intervention en production.

## Décision : NO-GO pour un déploiement contrôlé

Les parcours guidés testés fonctionnent, mais les critères conversationnels et certains engagements métier ne sont pas suffisamment fiables. Le nouveau corpus de validation donne **127 ensembles d’intentions exacts sur 216, soit 58,80 %**, sous l’objectif de 80 %. Sept des dix diagnostics complémentaires de conversation/cohérence métier échouent encore. Le succès des tests de régression ne lève pas ces blocages.

Trois catégories de défauts ont été corrigées localement : menus invalides pour des titres longs ou identiques après troncature ; perte du brouillon face à une réponse ambiguë aux étapes de sélection ; absence de revérification du groupe à la confirmation. Les règles du classificateur n’ont pas été modifiées pour améliorer le score de validation.

## Méthode et portée des preuves

- Réexécution des 410 tests annoncés avant modification : 410 réussites, aucun échec.
- Douze nouveaux tests de parcours et de limites, avec services applicatifs réels et bases en mémoire injectées.
- Un parcours complet traverse la réception signée, l’inbox, le worker existant, le moteur, le service de demande, la persistance simulée et le constructeur Cloud API. Le fetch du transport est remplacé par un mock.
- Dix diagnostics supplémentaires vérifient des comportements attendus et conservent leurs échecs. Leur script retourne effectivement le code **1** tant que des anomalies restent ouvertes.
- Nouveau corpus de 216 messages, distinct du fichier de développement, étiqueté avant sa première exécution. Aucune réutilisation exacte après normalisation, aucun doublon interne. Le corpus et le classificateur sont identiques entre les mesures initiale et finale.

Le garde `whatsappIsolationGuard.cjs` interdit le client PostgreSQL applicatif et les appels fetch réels. Les tests HTTP existants emploient un serveur local. Les noms, e-mails, numéros, sessions et identifiants employés sont fictifs. **Aucune session de production n’a été interrogée : leur existence réelle sur Contabo n’est pas certifiée par ce rapport.** Aucune migration, connexion PostgreSQL réelle, modification de configuration de production, activation de worker, livraison Meta réelle ou émission de certificat.

## Fonctionnalités contrôlées

| Fonctionnalité | Résultat et portée |
| --- | --- |
| Accueil unique | Validé sur les salutations reconnues et Menu, y compris contacts répétés et état sérialisé. Les formulations naturelles longues restent inégalement reconnues par les deux moteurs. |
| Trois boutons principaux | Validé : Nos formations, M’inscrire, Poser une question. Les identifiants pilotent les réponses même si le libellé entrant est modifié. |
| Boutons contextuels | Validés : essai, tarifs, horaires et suite de conversation ; conformité locale du payload contrôlée. |
| Questions libres | Réponses exactes sur les formulations couvertes ; couverture insuffisante sur le nouveau corpus. |
| Intentions multiples | Prix + début et autres questions d’information testées ; prix + inscription perd la réponse sur le prix, anomalie CTX05. |
| Contexte | Tarif puis durée, question pendant la collecte, sérialisation/reprise et pause humaine validés. Plusieurs choix ordinaux, négations et données ressemblant à des intentions échouent. |
| Tarifs, essai, paiement | Textes conformes aux montants officiels dans le scénario anglais. Mauvais périmètre produit et promesse d’essai incompatible avec FULL_PAYMENT encore reproductibles. |
| Certification | Texte prudent, trois niveaux et frais supplémentaires annoncés ; cohérence du service d’éligibilité non acquise, voir BUS02. |
| Sessions dynamiques | Services métier appelés, dates provenant des fixtures ; sessions fermées, complètes, expirées et formation non publiée exclues par `validateSession`. Disponibilités de production non vérifiées. |
| Deux méthodes d’inscription | Site et WhatsApp, par boutons et formulations explicites, validés dans les deux sens. Certaines expressions ordinales restent non comprises. |
| Consentement | Collecte soumise à acceptation, confirmation finale séparée ; `consentAt`, version et événement d’audit vérifiés. Aucun enregistrement avant la confirmation. |
| Enregistrement | Demande PENDING unique, préférence formation/session et notification administrative vérifiées avec le vrai service et une base simulée. |
| Validation administrative | Tests existants : rôle, CSRF HTTP, conversion par le service partagé, doublons de comptes, sessions fermées, concurrence simulée et rollback. Aucun compte créé directement par le bot. |
| Statut annoncé | Le worker envoie le statut PENDING réellement retourné, sans annoncer une inscription confirmée. Aucun Enrollment créé dans le parcours WhatsApp simulé. |
| Transfert humain | Pause effective, silence du bot, reprise explicite et conservation du brouillon validés ; aucune prétention de prise en charge effective par un conseiller. |

## Vérification des règles commerciales

| Règle demandée | Résultat de la conversation anglaise |
| --- | --- |
| 60 USD par niveau | Présent ; total trois niveaux 180 USD et total avec certificat 200 USD. |
| 16 séances de 1 h 30 | Présent ; 24 heures par niveau. |
| Trois niveaux | Présent ; 48 séances et 72 heures au total. |
| Cinq séances incluses dans le niveau 1 | Présent ; onze séances restantes explicitement indiquées. |
| Minimum 30 USD pour poursuivre après l’essai | Présent ; correspond à 50 % de 60 USD. |
| Solde avant la fin des seize séances | Présent ; aucune possibilité de payer après la dernière séance annoncée. |
| Certificat après trois niveaux | Présent, sous conditions administratives ; aucune accréditation ou reconnaissance internationale revendiquée. |
| Certificat : 20 USD supplémentaires | Présent. Le montant effectif configurable dans le service de certification n’a pas été vérifié sur la cible. |

Ces validations portent sur **le discours**, pas sur l’alignement complet des règles de paiement et de certification de l’application. `courseStructureService.accessLimits()` conserve un seuil partiel de dix séances pour LEGACY_STAGED. `certificateService.applicableFee()` permet des frais de session, de formation ou une configuration générale ; il ne garantit pas partout 20 USD. Ces paramètres et leur compatibilité avec la mission doivent être revus avant activation, sans les modifier aveuglément.

## Parcours simulés

| Parcours | Résultat |
| --- | --- |
| Prospect intéressé | Accueil → catalogue → essai → WhatsApp → consentement → nom/téléphone/e-mail/niveau → formation → session → récapitulatif → confirmation → PENDING. Réexécution du même message : aucun second envoi ou demande. |
| Prospect hésitant | Questions successives sur prix, durée, essai, paiement et certificat ; aucune demande créée par la simple hésitation. Les reformulations non reconnues ne sont pas toutes bien clarifiées. |
| Plusieurs questions | Tarifs + date de début répond aux deux. Prix + inscription ne répond qu’à l’inscription : échec maintenu. |
| Changement de sujet | Question de certificat pendant la saisie du téléphone ; réponse et brouillon conservés, puis reprise du téléphone. |
| Changement de méthode | Site → WhatsApp → collecte → site → WhatsApp ; brouillon effacé lors du passage au site et nouveau consentement demandé. |
| Information incorrecte | E-mail invalide refusé, aucun enregistrement ; correction permet la poursuite. Les tests existants couvrent aussi identité, téléphone et comptes en doublon. |
| Abandon/reprise | Annulation efface le brouillon ; nouvelle inscription possible. Interruption sans annulation et avant expiration : reprise depuis l’état JSON. Après expiration : aucune confirmation sur l’ancien état. |
| Conseiller | Demande de transfert, silence automatique, reprise explicite ; STOP reste prioritaire. |
| Session/groupe indisponible | Session fermée entre affichage et choix refusée. Groupe rempli après choix désormais refusé avant émission de l’action d’admission. Le service revalide encore dans la transaction. |

Traces synthétiques : [prospect intéressé](../output/nva-v2-interested-transcript.json), [parcours du worker et payloads](../output/nva-v2-worker-transcript.json).

## Évaluation indépendante des fixtures de développement

Le fichier [nvaCommercialHoldout.cjs](../tests/fixtures/nvaCommercialHoldout.cjs) contient 192 messages mono-intention répartis sur 24 catégories, huit messages multi-intentions, huit réponses nécessitant une clarification et huit choix contextualisés. Les formulations sont écrites spécifiquement pour cette validation, sans expansion combinatoire.

Il s’agit d’un **corpus synthétique de validation séparé**, pas d’une collecte de prospects réels ni d’une expertise externe en aveugle. Les règles avaient déjà été lues lors de l’audit. La distribution équilibrée et les cas difficiles ne permettent pas d’estimer le taux de réussite en production. L’absence de chevauchement est contrôlée contre le fichier d’évaluation de développement de 210 questions ; aucune absence de recouvrement sémantique avec tout le code ou les anciennes spécifications n’est revendiquée.

| Mesure du module `detectIntents` | Résultat final |
| --- | --- |
| Ensembles d’intentions entièrement corrects | 127 / 216 — **58,80 %** |
| Précision micro, UNKNOWN inclus | **61,04 %** |
| Rappel micro, UNKNOWN inclus | **62,95 %** |
| F1 micro | **61,98 %** |
| Prédictions contenant UNKNOWN | 81 |
| Messages d’intention connue retombant sur UNKNOWN | 65 |
| Choix contextualisés | 1 / 8 exact ; **7 échecs** |
| Messages annotés « clarification nécessaire » | 8 / 8 retournent UNKNOWN ; cela ne prouve pas une clarification adéquate par le parcours complet. |
| Doublons internes / chevauchements normalisés | 0 / 0 |

L’exactitude exige l’égalité de l’ensemble attendu et prédit ; elle pénalise donc aussi les intentions parasites. Les métriques micro comptent les vrais/faux positifs et les intentions manquées, et ne doivent pas être confondues avec l’exactitude par message.

Le moteur historique reconnaît certaines expressions que ce module ne reconnaît pas ; le score ci-dessus est celui du **module commercial isolé**, pas un taux de réussite de bout en bout du chatbot. Les parcours et diagnostics intégrés constituent une mesure distincte. Par exemple, le GREETING historique peut reconnaître un « bonjour » suivi d’une phrase alors que le module commercial demande une forme courte.

Confusions principales et exemples :

- GREETING → UNKNOWN : 8 cas ; THANKS → UNKNOWN : 8 cas ; MAIN_MENU → UNKNOWN : 7 cas.
- TRAINING_LIST → TRAINING_INFORMATION : 4 cas ; GOODBYE → UNKNOWN : 4 cas.
- « Les séances offertes s’ajoutent-elles au programme ? » manque l’essai gratuit ; « Une séance prend combien de minutes ? » manque la durée.
- « Le certificat est-il payant séparément ? » ne produit pas la seule intention de coût attendue.
- « Je choisis le second » ne déclenche pas le choix WhatsApp dans la conversation ; il réaffiche la sélection de méthode.

Tous les textes, intentions attendues/prédites, comptes par intention et confusions sont conservés dans [les résultats finaux](../output/nva-v2-holdout-final.json). Le classificateur n’a pas été ajusté sur ce corpus pendant la validation.

Empreinte SHA-256 du corpus : `cdfbea54c6666ee087d87b69eea7fc773a69a176efc0dbffc3ac24f86bff0077`.

Empreinte du classificateur avant et après : `f92351a92b9fae45ad8f3c63ddeadc7446cdaad6d3c4731dd5035e91017cb14a`.

## Anomalies corrigées

| Référence | Défaut constaté | Correction et preuve |
| --- | --- | --- |
| FIX01 | Un ou deux titres de formation dépassant vingt caractères produisaient un bouton invalide et bloquaient la progression au niveau. Des titres tronqués identiques rendaient aussi les menus invalides. | Choix du format liste quand un titre dépasse la limite bouton ; titres de cours numérotés et bornés en points de code Unicode. Tests titres longs, identiques après troncature, Unicode et limite dix choix. |
| FIX02 | Une réponse non reconnue en COURSE/SESSION/GROUP renvoyait DONE et supprimait le brouillon consenti. | Réaffichage du choix courant avec le brouillon et renouvellement des identifiants. Test des étapes COURSE et SESSION ; branche GROUP couverte par le même mécanisme, sans simulation distincte de sa réponse ambiguë. |
| FIX03 | Un groupe devenu complet après le récapitulatif laissait émettre ADMISSION_REQUEST ; le service refusait ensuite l’écriture mais la conversation ne donnait pas le bon retour. | Revérification du groupe avant l’action ; suppression d’une ancienne préférence de groupe lors d’un nouveau choix de formation. Diagnostic CTX08 et test spécifique passent. |

Le premier passage des neuf tests fonctionnels initiaux donnait cinq réussites et quatre échecs. Après corrections et ajout de trois contrôles : douze réussites. Les règles d’éligibilité, de paiement, le schéma Prisma et les données existantes n’ont pas été modifiés.

## Anomalies ouvertes et risques

| Référence | Importance | Reproduction / conséquence |
| --- | --- | --- |
| CTX02 | Majeure | « Je choisis le second » après les deux méthodes ne sélectionne pas WhatsApp. Formulations contextuelles insuffisamment couvertes. |
| CTX03 | Bloquante | Avec anglais à 60 USD et informatique à 90 USD dans le catalogue simulé, « Quel est le prix de la formation informatique ? » reçoit le tarif anglais. Les réponses commerciales ne résolvent pas correctement la formation explicitement demandée. |
| CTX04 | Majeure | « Je ne choisis pas la deuxième option » ouvre CONSENT pour WhatsApp. La négation n’est pas interprétée. Aucun enregistrement n’est créé à ce stade, mais le choix annoncé est erroné. |
| CTX05 | Majeure | « Quel est le prix et je veux m’inscrire ? » présente les méthodes mais omet le prix. Priorité d’inscription trop forte sur les intentions multiples. |
| CTX06 | Majeure | Le nom fictif « Jean International » reçoit une réponse sur le certificat et reste à NAME. Les mots de données personnelles peuvent être pris pour une intention. |
| BUS01 | Bloquante | Une formation anglaise configurée FULL_PAYMENT reçoit une promesse de cinq séances gratuites. Les réponses fixes et l’accueil ne garantissent pas la cohérence avec la politique réelle de la formation. |
| BUS02 | Bloquante | `certificateService.academicEligibility` renvoie `valid:true` pour une inscription simulée de niveau 1 terminée et toutes ses leçons terminées ; le service ne vérifie pas lui-même trois niveaux achevés. Aucune émission réelle effectuée et les autres contrôles d’émission ne sont pas contournés par ce test. |

Les [diagnostics reproductibles](../output/nva-v2-conversation-diagnostics.json) comptent **3 réussites et 7 échecs sur 10**. BUS02 a été ajouté après le diagnostic initial à neuf cas ; les deux nombres ne doivent pas être comparés sans tenir compte du périmètre.

Autres limites à lever : pagination absente au-delà de dix choix ; catalogue textuel limité aux premières formations ; troncature possible d’un long message texte à 4 000 caractères ; dates des récapitulatifs pas toutes formatées avec le fuseau explicite ; purge du brouillon expiré au prochain traitement seulement ; anciens champs d’accueil modifiables en administration mais ignorés par l’accueil officiel ; vérification de l’alignement des frais de certificat et du seuil partiel de dix séances. Aucun test de charge, restauration de production ou test PostgreSQL réel réalisé ici.

## Contraintes techniques et sécurité

Le validateur local impose trois boutons au maximum, vingt caractères par titre de bouton, dix lignes de liste au maximum, vingt-quatre caractères par titre de ligne, des identifiants distincts et un corps interactif borné à 1 024 caractères. Il est volontairement restrictif. Ces contraintes sont testées sur les payloads réellement construits ; les menus trop longs passent en texte numéroté. Les onze formations du test n’en exposent que dix : conformité du format, mais défaut de pagination maintenu.

La [documentation Meta du SDK archivé](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/) confirme le principe des trois réponses et des identifiants. Les pages Meta actuelles de messages [boutons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages) et [listes](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages) ont retourné HTTP 429 lors de cette vérification. La conformité exhaustive à leur version actuelle n’est donc pas certifiée par cet audit ; aucune limite n’a été élargie sur la base de sources secondaires.

La suite de livraison existante contrôle la fenêtre de service de vingt-quatre heures, les rejets explicites, les limites 429, les réponses serveur incertaines, les délais réseau, le repli texte et la reprise d’un traitement interrompu. Un envoi incertain ne doit pas être rejoué comme s’il avait été refusé : les tests vérifient cette distinction. La réception déduplique les identifiants et le parcours worker final confirme l’absence de second envoi et de seconde demande au rejeu du message final.

Les journaux observés pendant le parcours worker ne contiennent ni nom, ni e-mail synthétique collecté, ni token de transport. Le stockage autorisé des coordonnées dans la demande et la conversation est distinct de ces journaux. Les contrôles HTTP d’administration, CSRF et rôle sont exercés dans la suite existante. Cela ne constitue pas un audit de sécurité exhaustif ni une preuve des droits PostgreSQL actuellement installés sur Contabo.

## Tests exécutés et reproduction

| Vérification | Résultat final | Preuve |
| --- | --- | --- |
| Régression WhatsApp, avant corrections | 410 réussites, 0 échec | [baseline](../output/nva-v2-validation-baseline.log) |
| Régression WhatsApp, après corrections | 410 réussites, 0 échec | [journal final](../output/nva-v2-validation-release.log) |
| Nouveaux tests fonctionnels | 12 réussites, 0 échec | [journal](../output/nva-v2-functional-final.log) |
| Diagnostics fonctionnels/métier hors régression | 3 réussites, **7 échecs**, code 1 | [résultats](../output/nva-v2-conversation-diagnostics.json) |
| Corpus réservé à la validation | 127 / 216 exacts | [résultats](../output/nva-v2-holdout-final.json) |
| Syntaxe du module applicatif modifié | `node --check` réussi | Contrôle local |

**422 tests automatisés réussis dans les deux suites ne signifient pas 422 validations suffisantes pour déployer : les sept diagnostics en échec et le score de reconnaissance restent bloquants.**

```powershell
npm.cmd run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappV2FunctionalValidation.test.js
node --require ./tests/helpers/whatsappIsolationGuard.cjs scripts/evaluateNvaV2Holdout.js output/nva-v2-holdout-final.json
node --require ./tests/helpers/whatsappIsolationGuard.cjs scripts/validateNvaV2Conversations.js
node --check src/services/whatsappAdmissionJourney.js
```

Le script d’évaluation calcule les métriques sans imposer artificiellement 80 % comme critère de sortie. Le script de diagnostics retourne 1 pour signaler les comportements encore incorrects. Les traces ne contiennent que des données de test.

## Fichiers de cette intervention

- Application modifiée : `src/services/whatsappAdmissionJourney.js` uniquement.
- Support de tests modifié : `tests/helpers/metaInboxMock.js`, ajout des modèles nécessaires au parcours de demande en mémoire.
- Créés : `tests/fixtures/nvaCommercialHoldout.cjs`, `tests/whatsappV2FunctionalValidation.test.js`, `tests/helpers/nvaV2ValidationHarness.js`, `tests/helpers/metaInboxWorkerValidationHarness.js`, `scripts/evaluateNvaV2Holdout.js`, `scripts/validateNvaV2Conversations.js` et ce rapport, ainsi que les preuves dans `output/nva-v2-*`.
- Aucun changement de `.env`, PM2, token, permissions Meta, schéma ou migration. Aucun nouveau paquet installé.

## Conditions avant une décision GO

1. Corriger les sept anomalies ouvertes, en particulier la résolution de formation, la politique d’essai et les trois niveaux de certification. Rapprocher la communication des véritables règles de paiement et des frais configurés avec une décision métier explicite pour les divergences.
2. Étendre les reconnaissances et la clarification sans confondre champs de collecte, confirmations, refus et questions. Ce corpus étant désormais public pour le développement, réserver un **autre** corpus avant de revendiquer une nouvelle évaluation indépendante à au moins 80 %.
3. Rejouer les conversations et tests administratifs sur une préproduction représentative utilisant PostgreSQL isolé : concurrence réelle, doublons, rollback, session/groupe fermé entre étapes et permissions du worker.
4. Confirmer les formations, sessions, horaires et tarifs réellement publiés sur la cible, puis lever les réserves de [l’audit de compatibilité Contabo existant](audit-final-compatibilite-nva-20261023.md). Les fixtures locales ne remplacent pas ce contrôle.
5. Vérifier les contraintes Meta actuelles, le paquet candidat, la sauvegarde/restauration et le retour arrière. Toute livraison réelle ou mise en production reste soumise à une autorisation distincte.

**Recommandation finale : NO-GO pour la production, y compris pour un déploiement contrôlé destiné aux prospects. Poursuite possible des corrections et essais en environnement isolé avec transports simulés.**
