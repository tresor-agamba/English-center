# Sécurisation de l’authentification NVA — Phase 2

## A. Analyse initiale

Avant modification, GET `/forgot-password` affichait le formulaire email/téléphone. POST utilisait le rate limiter existant puis `passwordResetService.requestReset`. Cette fonction normalisait l’identifiant, exigeait un email, générait un token aléatoire, invalidait les anciens tokens et enregistrait son hash dans `PasswordResetToken` sous verrou transactionnel. Elle retournait une livraison `EMAIL_PENDING` contenant le token brut. Le contrôleur ignorait cette livraison, mais un token utilisable existait déjà en base.

Ont été examinés : le schéma Prisma et ses relations User/PasswordResetToken, les routes et contrôleurs d’authentification, les services de mot de passe, la validation des sessions, CSRF, les headers, le rate limiter, les templates et traductions, le runner de test et son garde-fou, les tests concernés et le rapport Phase 1.

`findValid`, `resetPassword`, le hash des tokens, leur durée de trente minutes, la politique de mot de passe, les connexions et l’invalidation `authVersion` sont conservés. Le contrôleur de demande et `requestReset` sont adaptés. Les tests Phase 1, CSRF et inscription NVA qui obtenaient un token via une demande utilisent désormais une fixture explicite de token existant, sans retirer leurs vérifications de consommation, expiration ou révocation.

## B. Fichiers modifiés

Nouveaux fichiers :

- `src/services/passwordResetRequestService.js`
- `prisma/migrations/20260910120000_add_password_reset_requests/migration.sql`
- `tests/authSecurityPhase2.test.js`
- `tests/helpers/passwordResetTokenFixture.js`
- `docs/auth-security-phase2.md`

Fichiers adaptés :

- `prisma/schema.prisma`
- `src/services/passwordResetService.js`
- `src/controllers/authController.js`
- `views/auth/forgot-password.ejs`
- `views/auth/login.ejs`
- `public/js/i18n.js`
- `scripts/validatePublicI18n.js`
- `tests/authSecurityPhase1.test.js`
- `tests/csrfProtection.test.js`
- `tests/nvaRegistrationCompletion.test.js`

## C. Modèle Prisma

`PasswordResetRequest` est mappé sur `password_reset_requests`. Il contient `id`, `userId`, `status` (PENDING par défaut), `requestedAt`, `reviewedAt`, `completedAt`, `reviewedById`, `createdAt` et `updatedAt`. Les dates de revue/finalisation et l’auteur de la revue sont initialement nuls.

L’enum prépare PENDING, APPROVED, REJECTED, COMPLETED, EXPIRED et CANCELLED. Seul PENDING est écrit par le nouveau parcours. Aucune expiration automatique n’est promise : `expiresAt` et `reason` sont omis tant que leur politique métier n’est pas définie.

Les relations nommées `PasswordResetRequester` et `PasswordResetReviewer` évitent toute ambiguïté entre les deux liens vers User. La suppression du demandeur supprime ses demandes ; la suppression d’un éventuel reviewer met ce lien à null. Les index portent sur `(userId, status)`, `status` et `requestedAt` ; le premier couvre également les recherches par `userId` seul.

## D. Migration

Migration additive : `20260910120000_add_password_reset_requests`. Elle crée uniquement l’enum, la nouvelle table, ses index et ses clés étrangères. Elle ne supprime aucune table/colonne et ne modifie ni utilisateur, ni mot de passe, ni token existant.

Application effectuée uniquement sur `localhost:5432/english_center_test` avec `isolatedEnvironment()` et `prepare()` de `scripts/runWithTestDatabase.js`. Le garde-fou existant vérifie la distinction avec DATABASE_URL et le nom de test ; une assertion supplémentaire impose exactement `english_center_test`. Le client Prisma a été régénéré et `migrate deploy` a confirmé l’application de la migration. Aucun `migrate reset`, `db push`, déploiement ou migration de la base principale/VPS n’a été exécuté.

## E. Workflow PasswordResetRequest

Le contrôleur normalise le type de l’entrée et délègue au service. Le service refuse silencieusement les entrées non textuelles, vides, trop longues ou les téléphones invalides, normalise le téléphone selon la fonction NVA existante et l’email en minuscules. Il ne tronque pas un identifiant trop long vers un autre compte.

Un STUDENT ou TEACHER actif peut demander une récupération, même sans email. Les enseignants ont une authentification normale et un profil dans l’architecture existante. Les ADMIN sont exclus explicitement de ce parcours public : la future validation administrative ne définit pas encore la récupération d’un compte privilégié ni une séparation des décideurs. Leur authentification et les actions ADMIN existantes restent inchangées. Tous les comptes inactifs sont exclus.

Un compte admissible sans demande PENDING reçoit une nouvelle demande. Dans tous les cas métier, le service retourne exactement `{ accepted: true }` et le contrôleur affiche le même succès générique. Le point d’entrée historique `requestReset` délègue à ce service : il ne retourne plus de livraison et ne crée plus de token. Les tokens déjà présents restent consommables selon les règles Phase 1.

## F. Protection contre les doublons

La transaction verrouille la ligne User avec le helper `passwordService.lockUser` (`SELECT … FOR UPDATE`), relit le rôle et l’état actif, puis cherche une demande PENDING avant création. Les appels concurrents du service pour un même compte se sérialisent. L’historique dans un autre statut est conservé et n’empêche pas une nouvelle demande.

Cette approche réutilise le mécanisme Phase 1 et évite un index unique partiel absent du modèle Prisma. Elle exige que les futurs chemins de création passent par ce service ou prennent le même verrou : une insertion SQL directe ne bénéficie pas de cette garantie. Phase 3 devra respecter le même protocole lors des transitions. L’acquisition et la durée de transaction sont bornées à dix secondes ; la saturation persistante de la base reste une erreur technique.

## G. Sécurité / confidentialité

Aucun lien de reset, token brut, mot de passe, hash, rôle, email ou numéro WhatsApp n’est retourné par le nouveau service. La réponse HTML de succès ne réaffiche pas l’identifiant soumis. Le jeton CSRF du formulaire reste présent : il est distinct d’un token de récupération.

La création n’écrit jamais dans `PasswordResetToken`, ne change pas le mot de passe et n’incrémente pas `authVersion`. Le logger structuré existant produit uniquement `PASSWORD_RESET_REQUEST_CREATED` avec l’identifiant technique `userId`, après commit et seulement pour une création effective. Aucun nouveau système d’audit n’est ajouté.

CSRF, Helmet, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` et le rate limiter des routes restent en place. Le plafond existant est dix requêtes par heure et IP, partagé avec les autres routes utilisant `limits.passwordReset`. Son store est en mémoire : compteurs propres à chaque processus, perdus au redémarrage, sans limitation distribuée entre instances. La politique de proxy existante reste inchangée.

## H. UX / i18n

Le formulaire conserve son label associé, `required`, `autocomplete="username"`, CSRF et le message `role="status"`. La longueur maximale est 254 caractères, également contrôlée côté service. Le message annonce l’enregistrement conditionnel d’une demande et ne promet plus l’envoi d’instructions.

Sept clés `forgot.*` FR/EN couvrent le titre, la confirmation, le retour connexion, les instructions, le label, le bouton et le lien depuis login. La page forgot-password rejoint la validation statique i18n existante. Le français reste le contenu initial et le script i18n existant applique l’anglais selon la préférence.

## I. Tests ajoutés

Le fichier Phase 2 comporte 19 sous-tests : GET/formulaire/headers, création STUDENT/statut/relation/timestamps, téléphone normalisé sans email, email normalisé et déduplication, huit requêtes concurrentes, cinq combinaisons rôle/activité, entrées invalides et compte absent, revalidation sous verrou, historique, compatibilité sans émission et préservation des tokens, réponse publique uniforme sans secrets, CSRF, rate limiting, audit minimal et traductions FR/EN.

Les tests Phase 1 conservent les trois connexions par rôle, changements volontaires et forcés, révocation des sessions, incrément de version, consommation atomique et expiration des tokens. Les tests CSRF et inscription NVA conservent leurs cas de réinitialisation via des fixtures explicites, protégées contre l’exécution hors de la base de test.

## J. Résultats exacts

Relance ciblée après corrections : **81/81 réussites**, zéro échec, ignoré ou annulé, code de sortie 0, durée **62 832,235 ms**. Le fichier Phase 2 apporte **19/19 sous-tests**, soit **20/20** avec le test parent comptabilisé par Node ; le fichier Phase 1 valide également ses **19/19 sous-tests**. La sélection comprend Phase 2, Phase 1, CSRF, inscription NVA, module étudiants ADMIN, inscription publique étudiant, inscription autonome et rate limiter.

Vérifications statiques : schéma Prisma valide, **150/150** templates EJS compilés, **477/477** clés FR/EN validées, **17/17** assets de marque vérifiés ; syntaxe des fichiers JavaScript de production modifiés et des nouveaux tests valide. La cible et l’enregistrement de la migration ont également été vérifiés par une lecture SQL sur la base de test.

Suite complète : **413/413 réussites**, **2 suites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **295 042,8083 ms**. Elle inclut les tests Phase 1/2, connexion et autorisations ADMIN/STUDENT/TEACHER, reset par token existant, changements de mot de passe, inscriptions et sauvegardes. Les cas de sauvegarde signalés intermittents dans le rapport Phase 1 passent lors de cette exécution. Ce résultat concerne la suite Node exécutée par le système de test existant ; les campagnes Playwright séparées n’ont pas été lancées.

Les tests utilisent `isolatedEnvironment()` avec l’assertion exacte du nom `english_center_test`, puis `runNode(['--test', '--test-concurrency=1', ...], env)`. Les fichiers privés sont isolés dans `tmp/auth-phase2-private` pour les tests ciblés et `tmp/auth-phase2-full-private` pour la suite complète. Aucun reset n’est effectué. Journaux : `tmp/auth-phase2-focused.log` (premier passage), `tmp/auth-phase2-verification.log` (relance ciblée), `tmp/auth-phase2-full.log` (suite complète).

## K. Régressions / limitations

Premier passage ciblé : 70/81 réussites, 11 échecs comptabilisés (neuf sous-tests et leurs deux parents), zéro ignoré/annulé, 55 813,4083 ms. Huit cas Phase 1 utilisaient encore `activeToken` attendant `issued.delivery.token` ; la fixture a été corrigée. Les cas concernés sont : G/H/I profil étudiant ; J/K reset atomique ; Q mot de passe temporaire ; expiration et rollback ; resets ADMIN étudiant/enseignant ; profil enseignant ; R CSRF/headers ; politique centralisée. Le neuvième cas était « huit demandes concurrentes donnent une seule PENDING » : Prisma ne pouvait acquérir une transaction dans le délai par défaut de deux secondes. Les bornes de transaction ont été ajustées à dix secondes. Ce sont des problèmes observés pendant cette implémentation, pas des échecs antérieurs supposés ; le journal initial est conservé.

L’uniformité publique concerne les résultats métier, pas une égalisation des temps de réponse. Les erreurs techniques continuent vers le gestionnaire global générique ; une panne de base n’est pas présentée comme un enregistrement réussi. Les demandes PENDING ne sont pas encore expirées ou annulées automatiquement après un autre changement de mot de passe : elles ne confèrent aucun droit et leur revue future devra vérifier leur actualité. Aucun écran de revue ni livraison n’est disponible en Phase 2.

Aucun échec ne reste ouvert après la relance ciblée et la suite complète. Aucun correctif hors périmètre n’a été appliqué aux sauvegardes. La base principale locale et la production restent inchangées ; le nouveau schéma n’y a pas été appliqué.

## L. Préparation Phase 3

Restent à implémenter : listing ADMIN, consultation d’une demande, autorisations et politique de revue, approbation, rejet, alimentation de `reviewedBy`/`reviewedAt`, audit ADMIN et préparation d’un token uniquement après approbation. La revue devra revérifier le rôle, l’activité et l’actualité de la demande sous verrou, et définir le traitement des demandes obsolètes et des comptes privilégiés.

Les statuts et relations sont préparés, sans routes, boutons, interface ou transitions actives. Aucun SMS, WhatsApp, OTP, email réel, fournisseur externe, notification ADMIN complexe ou phase 3/4/5 n’a été ajouté. Aucune production n’a été modifiée.
