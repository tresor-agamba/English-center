# Sécurisation de l’authentification NVA — Phase 4

## A. Analyse initiale

Analyse rédigée avant modification du code. Les rapports Phase 1–3, le schéma, les services de mot de passe/demande/reset, les contrôleurs et routes, les middlewares de session/ADMIN, l’audit et les tests existants ont été examinés.

Le modèle PasswordResetToken contient userId, tokenHash unique, expiresAt et usedAt, sans relation avec PasswordResetRequest. La génération publique a été retirée en Phase 2 : forgot-password et requestReset créent uniquement PENDING. Les tests historiques fabriquent directement un token aléatoire de 32 octets, encodé base64url (43 caractères), avec SHA-256 hexadécimal et expiration de 30 minutes. La primitive hashToken et la durée existent dans passwordResetService.

GET /reset-password/:token vérifie actuellement le format, le hash, usedAt et expiresAt, mais pas une demande approuvée ni l’activité du compte. POST valide la confirmation dans le contrôleur puis appelle resetPassword. Ce dernier calcule bcrypt avant la transaction, verrouille User, revendique le token conditionnellement et appelle passwordService.replacePasswordHash. Cette primitive utilise bcrypt coût 12, la politique 10 caractères/72 octets UTF-8, incrémente atomiquement authVersion, invalide tous les tokens non utilisés et permet mustChangePassword=false. Les sessions sont ensuite refusées par validateSession ; requireAdmin utilise l’identité rechargée en base.

Les primitives de hash, verrou utilisateur, remplacement du mot de passe, session, CSRF, headers no-store/no-referrer et masquage sanitizeUrl seront conservées. Il faut ajouter une liaison explicite unique token/demande, refuser les tokens historiques non liés, revérifier la chaîne Request/User/Token sous verrou, finaliser COMPLETED dans la même transaction et isoler l’émission brute dans une fonction interne strictement test. Le calcul bcrypt restera avant le verrou, afin de ne pas bloquer PostgreSQL pendant ce calcul ; les validations décisionnelles seront répétées dans la transaction.

Décisions de périmètre : aucune émission sur forgot-password ou APPROVE ; aucune livraison réelle ; aucune route d’émission ; une seule émission par demande ; APPROVED reste APPROVED après expiration, avec token définitivement expiré et sans réémission dans cette phase. Les tokens anciens non liés restent stockés, mais ne donnent plus accès au reset. Les fixtures des anciens tests devront représenter une demande approuvée. Le reset temporaire ADMIN historique reste distinct et conserve mustChangePassword=true.

## B. Fichiers modifiés

Neuf fichiers :

- `prisma/schema.prisma` : liaison et version d’authentification de la demande.
- `prisma/migrations/20260910200000_link_password_reset_token_to_request/migration.sql` : migration additive.
- `src/services/passwordResetService.js` : émission interne de test, validation stricte, consommation et audit.
- `src/services/passwordResetRequestService.js` : capture de la version lors de la création PENDING.
- `src/controllers/authController.js` : un lien invalide ne réaffiche plus le formulaire lors d’une erreur de saisie du mot de passe.
- `tests/helpers/passwordResetTokenFixture.js` : fixtures de demandes approuvées utilisant l’émission réelle.
- `tests/authSecurityPhase1.test.js` : GET doit désormais refuser un compte inactif ; le test conserve la vérification d’absence de mutation.
- `tests/authSecurityPhase4.test.js` : 60 cas dédiés.
- `docs/auth-security-phase4.md` : ce rapport.

Les routes, templates, politiques de mot de passe, middlewares de session, service d’audit et scripts de production restent ceux du projet. Le client Prisma a été régénéré. Les scripts et journaux sous `tmp/auth-phase4-*` sont des artefacts de validation locale.

## C. Modèle / migration

Migration **20260910200000_link_password_reset_token_to_request**, additive :

- `PasswordResetToken.requestId Int? @unique`, colonne `request_id`, référence `PasswordResetRequest.id` avec suppression en cascade et relation inverse `resetToken`. Une demande possède au plus un token ; les anciens tokens ont requestId=null.
- `PasswordResetRequest.authVersionAtRequest Int?`, colonne `auth_version_at_request`. Les nouvelles demandes enregistrent la version du compte sous le verrou utilisateur déjà utilisé en Phase 2. Les demandes historiques conservent null : leur fraîcheur n’est pas supposée.

La capture de version empêche qu’une ancienne approbation non encore utilisée autorise une récupération après un changement de mot de passe. Elle complète l’invalidation des tokens existants fournie par Phase 1. Aucun backfill, changement d’utilisateur, mot de passe ou ancienne migration ; aucune suppression de ligne existante.

La migration et la génération Prisma ont utilisé `isolatedEnvironment()` et `prepare()` du runner, avec assertion du nom exact **english_center_test**. Le journal Prisma confirme l’application. PowerShell a classé le message Prisma sur stderr comme NativeCommandError ; une lecture SQL indépendante a confirmé `current_database() = english_center_test` et `finished_at` non nul dans `_prisma_migrations`, code de sortie 0. Journaux : `tmp/auth-phase4-migration.log` ; contrôle : `tmp/auth-phase4-verify-migration.cjs`. Aucun reset, db push, déploiement VPS ni migration de la base principale/production.

## D. Génération token

`preparePasswordResetForTest(requestId)` est une opération interne explicite, sans route. Elle exige NODE_ENV=test, des identités DATABASE_URL/TEST_DATABASE_URL identiques, un hôte local et le nom exact english_center_test ; elle revérifie `current_database()` sur la connexion transactionnelle avant toute écriture. Elle refuse donc aussi le mode development ordinaire pour ne pas risquer d’utiliser la base principale. Le garde-fou est évalué à chaque appel, pas seulement à l’import.

Après verrouillage User puis Request, elle relit la demande, le compte et la version. Elle exige APPROVED, completedAt=null, un compte actif STUDENT/TEACHER, la cohérence userId et la même authVersion. Tout état historique sans version est refusé. Elle refuse également toute demande possédant déjà un token, même utilisé ou expiré.

Le secret utilise `crypto.randomBytes(32).toString('base64url')` : 256 bits aléatoires, 43 caractères. Seul SHA-256 hexadécimal est stocké. createdAt et expiresAt partagent le même instant de référence, avec exactement 1 800 000 ms d’écart. Une nouvelle émission invalide les autres tokens non utilisés de cet utilisateur dans la même transaction.

La fonction retourne `{ token, requestId, userId, expiresAt }` uniquement au code interne de test, après commit. Aucun secret n’est retourné à forgot-password, APPROVE, une route publique ou une route ADMIN. Aucune copie brute dans la base, les sessions ou l’audit. Le token existe dans la mémoire des tests le temps du scénario ; aucun fichier de livraison brute n’est créé. Il n’existe pas encore d’émetteur de production utilisable.

## E. Liaison Request/User/Token

Le token référence explicitement une demande et un utilisateur. La FK garantit l’existence de la demande ; l’index unique empêche un second token lié à la même demande. Le service vérifie en plus que `request.userId === token.userId`, que la relation chargée correspond à requestId et que le compte lié est admissible. Les champs userId/requestId/token envoyés dans le formulaire ne sélectionnent jamais le compte à modifier : seul le token du chemin résolu en base le fait.

Les relations sont revérifiées après acquisition des verrous. Les tests altèrent volontairement les liens en base pour prouver le refus des associations incohérentes ; ces opérations directes sont exclusivement des fixtures de test. L’accès arbitraire en écriture à la base reste hors du modèle d’autorisation applicatif : il pourrait aussi modifier APPROVED ou un mot de passe directement.

## F. Consommation

GET et POST `/reset-password/:token` réutilisent le contrôleur et le template existants. `findValid` refuse format incorrect, hash inconnu, usedAt renseigné, expiration atteinte, liaison absente, état différent d’APPROVED, completedAt non nul, compte inactif/supprimé/non admissible ou version obsolète. Le refus public reste « Ce lien est invalide ou expiré. », sans raison technique.

GET ne consomme pas le token et ne change aucun statut. POST vérifie la confirmation et conserve la politique Phase 1 : minimum dix caractères, maximum 72 octets UTF-8, bcrypt coût 12. Une erreur de saisie conserve le formulaire seulement si le lien est encore valide. Après succès, aucun token ne figure dans le HTML de confirmation. Les tokens historiques requestId=null sont définitivement refusés, même avec un hash connu et une date encore valide.

## G. Transaction

Le calcul bcrypt précède la transaction : aucun compte n’est modifié à ce stade. Toutes les conditions sensibles sont ensuite vérifiées dans PostgreSQL, avec `maxWait=10000` et `timeout=10000` :

1. Résoudre le token valide puis verrouiller User et Request, dans cet ordre.
2. Résoudre de nouveau le token et vérifier la même identité token/user/request et son admissibilité.
3. Revendiquer la ligne par updateMany conditionnel sur id, userId, requestId, usedAt=null et expiresAt>maintenant ; exiger exactement une ligne.
4. Appeler `passwordService.replacePasswordHash` avec la même transaction, compte actif et mustChangePassword=false. Cette primitive incrémente authVersion et invalide tous les autres tokens non utilisés.
5. Effectuer APPROVED → COMPLETED avec completedAt, par updateMany conditionnel et exactement une ligne ; conserver la décision ADMIN et ses dates.

Une exception ou une condition échouée annule toutes les mutations. Les tests injectent une erreur après le changement du hash et un échec de transition finale ; mot de passe, authVersion, token et demande retrouvent tous leur état précédent. Aucun audit de succès n’est émis lors du rollback.

## H. Concurrence

Les phases 1–3 utilisent déjà le verrou User. Émission et consommation le partagent et verrouillent ensuite la demande. Deux émissions pour la même demande sont sérialisées, avec une contrainte unique SQL supplémentaire. Une seule retourne un secret et produit l’audit d’émission.

Deux POST simultanés sur le même token ne peuvent pas gagner : la seconde consommation relit l’état après le verrou puis échoue génériquement, sans nouvel incrément de version. Le test HTTP impose deux sessions CSRF distinctes et constate une réponse 200, une réponse 400 et un seul audit de finalisation.

L’expiration et le statut sont relus sous verrou ; les tests injectent leur modification après la première lecture. Aucune garantie ne dépend de l’interface ou d’un verrou JavaScript.

## I. authVersion / sessions

La primitive Phase 1 incrémente authVersion exactement une fois à chaque reset réussi. `validateSession` détruit les anciennes sessions à leur prochaine requête, comme auparavant ; deux sessions antérieures et une nouvelle connexion sont vérifiées. Une requête déjà autorisée et en cours n’est pas interrompue rétroactivement.

mustChangePassword=false après récupération par token, puisque l’utilisateur vient de choisir son mot de passe. Les resets temporaires ADMIN existants restent distincts, exigent ensuite le changement forcé et continuent d’invalider les tokens/sessions. Aucun nouveau moyen pour ADMIN de choisir le mot de passe ou de consulter le secret n’est ajouté.

## J. Logs / headers / audit

Les headers `Cache-Control: no-store` et `Referrer-Policy: no-referrer`, CSRF et le rate limiter existants sont conservés. Les pages de reset n’exposent pas de canonical/og:url contenant le secret ; le service worker existant exclut les routes d’authentification de son cache.

Le logger standard produit après commit `PASSWORD_RESET_TOKEN_ISSUED` et `PASSWORD_RESET_COMPLETED`, avec action, level=AUDIT, timestamp, requestId métier et userId uniquement. Il ne reçoit ni token, tokenHash, password, passwordHash, cookie ni session ID. Les tests capturent les logs réels de GET/POST et les audits pour vérifier leur absence. `sanitizeUrl` continue de remplacer les chemins de reset, y compris encodés deux fois, par `[REDACTED]`.

Comme aux phases précédentes, cet audit est un logger après commit, sans outbox transactionnelle. Un arrêt entre commit et log peut laisser une mutation sans événement ; une erreur de log ne restaure pas une transaction déjà validée. Aucun second système d’audit n’a été créé. Les logs d’un futur reverse proxy devront appliquer la même politique avant toute mise en production ; aucun proxy/VPS n’a été modifié ici.

## K. Tests ajoutés

`tests/authSecurityPhase4.test.js` comporte **60 cas**, regroupant :

- Émission réservée à APPROVED, aléa 32 octets, hash seul, TTL, unicité, concurrence et contrainte SQL.
- Garde-fous production/development/base non isolée, identifiants incorrects et absence de route de livraison.
- GET et POST, CSRF, headers, erreurs génériques, refus des anciens tokens non liés et des cinq statuts interdits.
- Compte inactif/supprimé/devenu ADMIN, demande supprimée, liaisons croisées et absence de modification d’un autre compte.
- Version historique absente, changement de mot de passe avant émission et révocation de version après émission.
- Politique 10 caractères/72 octets, confirmation différente/absente, limites exactes acceptées, bcrypt 12.
- COMPLETED/completedAt, reviewer conservé, usage unique, autres tokens invalidés, mustChangePassword=false.
- Anciennes sessions révoquées, nouvelle connexion, consommations concurrentes et deux scénarios de rollback.
- Audits exacts sans secrets, logs HTTP masqués, émission absente sur forgot-password et APPROVE, session et page ADMIN sans secret.
- Nouvelle demande avec la nouvelle version après une récupération réussie.

Les tests Phase 1 continuent de couvrir login des trois rôles, changements volontaires étudiant/enseignant et resets temporaires ADMIN ; les phases 2/3 continuent de couvrir création, approbation, rejet et autorisations. La fixture historique fournit désormais une demande APPROVED avec version courante, puis appelle l’émission réelle. Elle reste strictement test-only. L’assertion Phase 1 sur findValid d’un compte inactif a été renforcée : null attendu en GET et usedAt toujours null après refus, au lieu d’autoriser l’affichage du formulaire. Aucun test de sécurité n’a été retiré.

## L. Résultats exacts

Premier passage ciblé : **102/160 réussites**, **58 échecs comptabilisés** (57 cas Phase 4 et leur parent), zéro ignoré/annulé, code de sortie 1, durée **89 460,6329 ms**. Les 99 tests de régression existants passent. La fixture Phase 4 utilisait un numéro +2437, exclu par le validateur NVA (+2438/+2439), donc aucune demande n’était créée et les cas dépendants échouaient. Le préfixe de fixture a été corrigé ; aucun validateur de production n’a été assoupli. Journal : `tmp/auth-phase4-focused.log`.

Lors de la revue, createdAt et expiresAt ont aussi été alignés explicitement sur la même horloge à l’émission. Cela évite de mesurer le TTL depuis le début de la transaction PostgreSQL, utilisé par défaut par CURRENT_TIMESTAMP. Ce point n’est pas présenté comme un échec de test observé : la fixture invalide empêchait alors d’atteindre cette assertion.

Passage Phase 4 isolé après corrections : **60/60 cas**, **61/61 avec parent**, zéro échec/ignoré/annulé, code de sortie 0, durée **50 864,3356 ms**. Journal : `tmp/auth-phase4-isolated.log`. L’assertion de deuxième POST HTTP sur token consommé a ensuite été ajoutée au cas d’usage unique existant.

Relance ciblée finale : **160/160 réussites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **131 802,8121 ms**. Elle comprend les **60/60** cas Phase 4 (61 avec parent), **39/39** Phase 3, **19/19** Phase 2, **19/19** Phase 1, layout ADMIN, module étudiants ADMIN, CSRF et inscription NVA/reset. Journal : `tmp/auth-phase4-verification.log`.

Suite complète : **514/514 réussites**, **2 suites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **335 195,0431 ms**. Journal : `tmp/auth-phase4-full.log`. Le total correspond aux 453 tests de référence Phase 3 plus les 61 tests comptabilisés pour Phase 4 (60 cas et leur parent). Les parcours ADMIN/STUDENT/TEACHER, login, forgot-password, reset-password, changement volontaire/forcé, sessions PostgreSQL et sauvegardes passent. Aucun échec intermittent observé lors de ce passage complet.

Toutes les exécutions Node utilisent `isolatedEnvironment()` et une assertion du nom exact english_center_test, puis `--test --test-concurrency=1`. Aucun reset ni migration supplémentaire pendant les tests. Les fichiers privés sont isolés sous `tmp/auth-phase4-focused-private` et `tmp/auth-phase4-full-private`.

Contrôles statiques : **152/152** templates EJS, **477/477** clés publiques FR/EN, **17/17** assets de marque. Schéma validé par `prisma validate` dans l’environnement isolé, code de sortie 0. Syntaxe valide des six fichiers JavaScript modifiés/ajoutés (deux services, contrôleur, deux suites et fixture). Aucune modification visuelle ni campagne navigateur supplémentaire n’est nécessaire pour cette phase de workflow ; les routes/formulaires réutilisés sont vérifiés en HTTP.

## M. Régressions / limitations

Les erreurs initiales de fixture sont conservées en section L ; elles ne sont pas attribuées à une instabilité antérieure. **Aucune régression restante observée** après la relance ciblée 160/160 et la suite complète 514/514. Aucun correctif hors périmètre n’a été appliqué aux modules pédagogiques, financiers ou de sauvegarde.

Limites et politiques explicites :

- L’émission brute est disponible uniquement au code interne de test sur la base isolée. Le parcours n’est pas encore livrable automatiquement en production.
- Après expiration, la demande reste APPROVED mais son token ne peut être ni consommé ni régénéré. Une nouvelle demande et une nouvelle approbation sont nécessaires ; aucune tâche de changement automatique en EXPIRED.
- Après invalidation par un autre changement de mot de passe, la version de la demande ne correspond plus et empêche toute émission/consommation. Le statut administratif peut rester APPROVED : il ne constitue pas à lui seul une autorisation exploitable.
- Les demandes historiques avec authVersionAtRequest=null sont conservées mais inexploitables. Un utilisateur doit faire une nouvelle demande. Si une ancienne PENDING bloque la déduplication, ADMIN peut la rejeter avant cette nouvelle demande ; aucun backfill de confiance ni rejet automatique.
- Une nouvelle émission pour le même compte invalide le token précédent. Sa demande reste dans l’historique ; son token existant empêche une réémission. Les autres demandes non encore émises deviennent obsolètes après un changement de version.
- L’unicité repose sur la conservation de la ligne de token et la contrainte unique. Aucune purge de tokens liés n’est ajoutée ; une future rétention devra conserver la preuve d’émission pour ne pas réouvrir une ancienne demande.
- Sans livraison configurée, un secret perdu après commit n’est pas récupérable depuis le hash. Une stratégie de nouvelle demande/livraison devra être définie avant mise en service.

Aucun SMS, WhatsApp, email réel, OTP ou fournisseur ajouté. Aucun déploiement ni modification de données réelles. Le code de consommation de production exige désormais le nouveau schéma ; une future mise en service nécessitera une migration autorisée de cet environnement, qui n’a pas été effectuée ici.

## N. Préparation livraison

Une phase distincte pourra extraire la préparation transactionnelle actuelle derrière un service interne de livraison autorisé. Elle conservera crypto.randomBytes(32), SHA-256, le TTL, les verrous, la liaison et la consommation existante ; le secret brut sera transmis uniquement en mémoire à un transport interne, jamais retourné au contrôleur ADMIN. Il ne suffira pas de retirer le garde-fou de test.

Avant cette activation : définir le destinataire et son canal vérifiés, l’autorisation du worker, les reprises en cas d’échec après commit, l’idempotence, la limitation d’émission, la fraîcheur temporelle des approbations et la rétention. Les secrets ne devront pas apparaître dans les exceptions du fournisseur ou ses logs. La politique de réémission demandera une décision métier et une adaptation explicite de l’unicité actuelle, sans rendre réutilisable un token utilisé/expiré.

Le trajet futur sera APPROVED → préparation interne → livraison au demandeur → GET/POST existants → COMPLETED. Aucun transport, endpoint d’émission, fournisseur ou automatisation de livraison n’est implémenté dans cette Phase 4.
