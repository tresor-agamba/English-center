# Fusion Contabo / architecture IA NVA — 29 octobre 2026

## Résultat et périmètre

Fusion fonctionnelle réalisée manuellement dans le worktree isolé :

```text
D:\English-center\tmp\nva-contabo-ai-integration-20261029
branche : integration/nva-contabo-ai-20261029
base : bd2fe8ba90bae8620db8615dd5dde84c0a02babf
```

Les modifications sont **non commitées et non indexées**, prêtes à relire. Aucun push, accès Contabo, déploiement, commande Git destructive, changement d'identifiant ou modification de `.env`. Aucun changement NovanceTech. PowerShell, Node.js, Git et exécutables Windows natifs uniquement ; aucun Ubuntu ni WSL.

Le checkout d'origine reste sur `release/nva-whatsapp-ai-20261029` au commit de référence. Ses seuls fichiers non suivis restent les trois patchs fournis. `main` reste à `5c465e1c066f044fff601615849ebe76c3334157` ; les références release et intégration restent à `bd2fe8ba90bae8620db8615dd5dde84c0a02babf`. Aucun commit ajouté.

## Préservation et analyse des trois patchs

Copies, état initial et analyse structurée conservés dans :

```text
D:\English-center\tmp\nva-merge-preservation-20261029
```

| Patch d'origine | SHA-256 |
| --- | --- |
| `nva-server-changes-20261029-150012.patch` | `6046c076273306fd32b2ab1f6559abb8351f0fe57c0b005edcd6b46a3b57cb88` |
| `previous-merge-staged.patch` | `4784a78ae4fb55618752dbd139d6a42bb965732664c5e4ca75869693e3054f28` |
| `previous-merge-unstaged.patch` | `f5cb4da1b2a0ff001239a6e7b2f011fe60d0f17f9ed931df18d02d0be5d2d2cb` |

Les sept fichiers du patch serveur ont les mêmes cibles Git que l'ancienne fusion indexée, complétée par son patch non indexé pour l'accueil. Les bases diffèrent parfois : l'accueil serveur part de `6d4ed27`, l'ancienne fusion de `9506332` ; le moteur serveur part de `d404312`, l'ancienne fusion de `668c2a8`.

La chaîne d'accueil est `9506332 → 8ce2b1d → e5be9a2`. Le dernier patch contient aussi une ancienne variante de `whatsappAdmissions.test.js`, absente du patch serveur. Ce ne sont donc pas trois ensembles à additionner.

Vérification supplémentaire : les neuf transformations des anciens patchs indexé/non indexé ont été reconstituées **en mémoire**, depuis leurs blobs Git de départ, puis leurs empreintes de résultat comparées aux cibles annoncées : neuf correspondances. Aucun de ces patchs n'a été appliqué aveuglément au worktree. Détails dans `patch-analysis.json`.

## Arbitrages par composant

| Composant | Apports conservés / adaptés | Changements rejetés ou devenus inutiles |
| --- | --- | --- |
| `whatsappAdmissionJourney.js` | Accueil distinct du menu explicite de retour ; deux boutons au premier accueil uniquement ; salutation courte sans rejouer l'accueil en mode historique IA désactivée ; collecte conservée. Le menu ultérieur demandé par « menu » propose catalogue, inscription et question, avec les jetons existants. | Troisième bouton ajouté au premier accueil ; répétition des deux boutons après chaque salutation ; remplacement global par le long texte promotionnel de production. |
| `whatsappAdvisorPolicy.js` | Un mot isolé anglais/français conserve la langue courante ; demandes explicites de langue toujours respectées ; enrichissement du vocabulaire français pour les questions sur durée/formation. Les raccourcis Hello/Hi/Thanks de la référence restent présents. | Remplacement complet du détecteur par des règles répétées ; retour au prompt de production exigeant un PLAN sans prose dans le parcours actif. |
| `whatsappConversationEngine.js` | Indication backend `isFirstContact`, en plus des marqueurs persistants ; reconnaissance de Hey, sans doubler les détecteurs. Une indication true ne peut pas forcer un nouvel accueil si l'état prouve déjà le contraire. | Salutations/remerciements avant OpenAI ; réintroduction des racines d'inscription comme autorisation ; réécriture de refus en « Je veux m'inscrire ». |
| `whatsappConversationService.js` | Recherche d'un message préexistant dans la même conversation sous le verrou du destinataire, avant insertion du message courant ; transmission du résultat au moteur. | Aucun changement du webhook, de la signature, de la transaction d'inscription ou des autorisations. |
| `whatsappQuestionAIService.js` | Jours de semaine traduits séparément FR/EN, avec liste blanche et filtrage des groupes complets/inactifs ; durée approximative en mois ajoutée au fait existant sur les semaines. | Remplacement du fait de durée supprimant les valeurs exactes 3 niveaux / 16 séances / 90 minutes / 48 séances ; suppression de contraintes ou modification de schéma de réponse. |
| `whatsappNaturalAdvisorPolicy.js` | Consignes de production utiles reportées dans le prompt réellement actif : prix des trois niveaux, total certificat inclus, durée distincte des horaires, références de suivi et minimum de faits pertinents. | Catalogue de fragments comme moteur principal, schema `opening/followUp` imposé aux réponses naturelles, détection de sujet par mots-clés en priorité sur le modèle. |

Les montants, séances d'essai, échéances et conditions de certification officiels restent ceux de la référence validée. La nouvelle traduction des jours ne transforme pas les créneaux habituels en sessions disponibles. Les disponibilités restent lues via les services de l'application.

## Points dont la pertinence demande un arbitrage explicite

- **« English », « Français » seuls** : les patchs de production demandent de préserver la langue ; la référence les interprétait comme des demandes de changement. Un mot isolé ne permet pas de savoir si le prospect nomme une formation ou choisit une langue. Arbitrage retenu : conserver la langue et exiger une formulation explicite pour changer. Les tests couvrent les quatre mots sur les deux langues, ainsi que les demandes explicites et les alternatives refusées. Cette politique reste modifiable après décision produit.
- **Présentation promotionnelle longue et mention de cinq essais à l'accueil** : aucune preuve que ce texte soit une exigence éditoriale actuelle. La présentation concise à deux boutons est conservée ; les règles d'essai restent accessibles dans les faits officiels, sans promouvoir les conditions d'anglais à une autre formation.
- **Trois options au menu ultérieur** : c'est un menu explicitement demandé, pas le premier accueil. Il reprend l'accès catalogue utile de Contabo ; aucune salutation ordinaire en mode IA ne l'affiche automatiquement.
- Les patchs prouvent des versions fournies, pas l'état actuel complet de Contabo. Aucune inspection serveur n'a été faite pendant cette fusion.

## Tests et régressions

Le fichier `tests/whatsappContaboMerge.test.js` ajoute neuf tests :

1. Premier contact déterminé avant insertion, reconstruction du service et déduplication.
2. Ancien prospect avec historique mais `engineState` vide : pas de nouvel accueil.
3. Indication `isFirstContact:true` incapable de réinitialiser un accueil déjà enregistré.
4. Premier accueil à deux choix et menu ultérieur distinct, avec clic catalogue backend.
5. Salutations de retour sans répétition des boutons, y compris IA désactivée.
6. Langue persistante pour les mots isolés et changements explicites conservés.
7. Jours FR/EN, exclusion des groupes complets et du texte non reconnu comme jour.
8. Mois/semaines indicatifs, sans perte des nombres exacts de séances.
9. Prompt actif naturel et contexte de suivi réellement transmis à l'appel HTTP simulé.

Les assertions de l'audit de routage restent actives. `whatsappAdmissions.test.js` distingue maintenant l'accueil initial, la salutation de retour et le menu demandé, au lieu d'exiger de rejouer les mêmes boutons. Le mock de persistance prend en charge la nouvelle lecture `findFirst` comme le vrai modèle Prisma.

Le test de préparation de déploiement présentait **déjà un échec au checkout Windows de la référence** : extraction de trois blocs Node d'un fichier `.sh` via une regex exigeant LF. Il normalise maintenant CRLF lors de la lecture avant de compiler ces mêmes trois blocs ; aucune assertion de sécurité n'a été supprimée, aucun script shell exécuté ou changé.

### Suites ciblées, toutes réussies

Depuis PowerShell dans le worktree :

```powershell
npm.cmd run test:whatsapp:contabo-merge
npm.cmd run test:whatsapp:final-audit
npm.cmd run test:whatsapp:natural
npm.cmd run test:whatsapp:release
```

| Suite | Réussites | Échecs |
| --- | ---: | ---: |
| Fusion Contabo | 9 | 0 |
| Audit de routage | 49 | 0 |
| Conversation / prompt | 104 | 0 |
| Livraison / régression | 416 | 0 |

La suite conversationnelle passe de 105 à 104 tests parce que deux anciens tests « mot isolé = changement explicite » sont regroupés dans un test de huit assertions de conservation de langue. Les changements explicites restent testés ; aucune régression n'est cachée par un skip. Les suites se recoupent, ne pas additionner leurs totaux comme des tests uniques.

### Suite générale et comparaison avec la référence

`npm.cmd test` a été tenté dans le worktree : refus avant lancement des tests avec `DATABASE_URL_MISSING`. Aucun `.env` n'a été copié ou modifié pour contourner ce garde-fou. Une tentative de cluster PostgreSQL natif jetable a échoué : erreur de jeton restreint de l'environnement Windows et absence de `C:\Program Files\PostgreSQL\16\share\postgres.bki`. Aucun serveur PostgreSQL jetable n'a démarré. Aucune connexion à une base existante.

L'ensemble des fichiers Node `*.test.js` a ensuite été exécuté **sous le garde d'isolation**, avec Prisma et transports externes réels interdits. Une copie intacte de `bd2fe8b`, obtenue par archive Git et extraction ZIP PowerShell dans un dossier séparé, a subi exactement le même contrôle :

```powershell
$nvaTestFiles = @(rg --files tests -g '*.test.js')
& node --require ./tests/helpers/whatsappIsolationGuard.cjs --test --test-concurrency=1 @nvaTestFiles
```

| Exécution élargie isolée | Total | Réussis | Échecs | Ignorés |
| --- | ---: | ---: | ---: | ---: |
| Référence `bd2fe8b` | 846 | 786 | 55 | 5 |
| Fusion | 854 | 795 | 54 | 5 |

Comparaison des titres des tests en échec : **aucun nouvel échec**. Le seul échec disparu est celui des fins de ligne Windows décrit ci-dessus. Les 54 autres échecs sont également présents dans la référence sous ce mode : tests nécessitant Prisma/PostgreSQL, chargement de configuration, vérification de readiness ou fetch interdits par le garde. Ils ne constituent pas une suite générale validée et n'ont pas été désactivés pour présenter un résultat vert.

La certification globale du projet reste donc **incomplète** jusqu'à exécution normale sur un PostgreSQL de test dédié et complet. La comparaison différentielle réduit le risque de régression locale mais ne remplace pas ces tests réels. Aucun appel réel OpenAI/Meta effectué ; la qualité sémantique du modèle et la livraison sur téléphone ne sont pas certifiées ici.

Les journaux et le détail des titres comparés sont dans `D:\English-center\tmp\nva-merge-preservation-20261029` : `baseline-release.txt`, `merged-specific.txt`, `merged-audit.txt`, `merged-natural.txt`, `merged-release.txt`, `full-suite-initial.txt`, `postgres-init.txt`, `all-node-baseline.txt`, `all-node-isolated.txt`, `suite-comparison.json`. Ces fichiers ne sont pas destinés à Git.

## Fichiers modifiés dans l'intégration

- `package.json` : commande de test ciblée de fusion.
- `src/services/whatsappAdmissionJourney.js`.
- `src/services/whatsappAdvisorPolicy.js`.
- `src/services/whatsappConversationEngine.js`.
- `src/services/whatsappConversationService.js`.
- `src/services/whatsappNaturalAdvisorPolicy.js`.
- `src/services/whatsappQuestionAIService.js`.
- `tests/whatsappAdmissions.test.js`.
- `tests/whatsappConversationPersistence.test.js`.
- `tests/whatsappDeploymentPreparation.test.js`.
- `tests/whatsappV3Corrections.test.js`.
- Nouveau `tests/whatsappContaboMerge.test.js`.
- Le présent rapport.

Aucune nouvelle migration, table, dépendance ou variable d'environnement. `isFirstContact` est un paramètre calculé par le backend, pas un champ client de confiance ni une colonne supplémentaire. La requête utilise les droits de lecture déjà nécessaires sur les messages de conversation.

## Revue et suite proposée — sans exécution automatique

```powershell
$gitNva = 'D:\English-center\tmp\git-repair-tools\mingit\cmd\git.exe'
$integrationNva = 'D:\English-center\tmp\nva-contabo-ai-integration-20261029'
& $gitNva -C $integrationNva status --short --untracked-files=all
& $gitNva -C $integrationNva diff --check
& $gitNva -C $integrationNva diff --stat
& $gitNva -C $integrationNva diff -- src/services tests package.json
Get-Content -LiteralPath "$integrationNva\tests\whatsappContaboMerge.test.js" -Encoding UTF8
```

Les fichiers nouveaux sont visibles dans `status`, mais pas dans le diff ordinaire tant qu'ils ne sont pas indexés. La variante fusionnée n'a pas encore de SHA de commit. Le manifeste de livraison hérité de `bd2fe8b` décrit seulement cette référence : il devra être régénéré après revue de la fusion avant toute publication.

Un patch de revue complet, incluant les nouveaux fichiers, est disponible dans `D:\English-center\tmp\nva-merge-preservation-20261029\integration-review.patch`. Il a été vérifié avec `git apply --check --reverse` contre le worktree, sans appliquer ni retirer de changement. `final-verification.json` contient son empreinte et les vérifications de préservation. Ne pas nettoyer les dossiers `tmp\nva-contabo-ai-integration-20261029` et `tmp\nva-merge-preservation-20261029` avant décision : les changements de cette intégration ne sont pas encore commités.

Avant de demander l'autorisation d'un commit final : valider les arbitrages ci-dessus, compléter les tests PostgreSQL, puis relire l'ensemble des changements. Aucune commande de commit, push ou déploiement n'a été exécutée. Ne pas remplacer directement les fichiers du checkout principal ni réappliquer les trois patchs par-dessus cette intégration.
