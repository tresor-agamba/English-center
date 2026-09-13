# Sécurisation de l’authentification NVA — Phase 1

## Périmètre

Cette phase renforce l’authentification existante. Elle n’ajoute aucune demande de récupération, décision ADMIN, OTP, intégration SMS/WhatsApp ou interface de gestion des demandes. Aucun modèle métier de formation, paiement ou progression n’est modifié.

## A. Fichiers concernés

Nouveaux fichiers :

- `src/services/passwordService.js`
- `src/middlewares/validateSession.js`
- `src/utils/sanitizeUrl.js`
- `prisma/migrations/20260909180000_add_user_auth_version/migration.sql`
- `tests/authSecurityPhase1.test.js`
- `docs/auth-security-phase1.md`

Fichiers modifiés :

- Schéma et configuration : `prisma/schema.prisma`, `src/app.js`.
- Authentification : `src/services/authService.js`, `src/controllers/authController.js`, `src/services/passwordResetService.js`.
- Autorisations : `src/middlewares/requireAuthenticated.js`, `src/middlewares/requireAdmin.js`, `src/middlewares/requireStudent.js`, `src/middlewares/requireTeacher.js`.
- Logs : `src/middlewares/requestContext.js`, `src/middlewares/errorHandler.js`, `src/services/loggerService.js`.
- Mots de passe étudiants : `src/controllers/adminStudentController.js`, `src/controllers/studentController.js`, `src/services/studentService.js`, `src/services/studentProfileService.js`.
- Mots de passe enseignants : `src/controllers/adminTeacherController.js`, `src/controllers/teacherController.js`, `src/services/teacherService.js`.
- Création initiale et session d’inscription : `src/controllers/registrationController.js`, `src/services/registrationService.js` (sélection des champs de sécurité uniquement pour ce dernier).
- Comptes de développement et fixtures : `prisma/seed.js`, `scripts/prepareResponsiveAudit.js`.
- Formulaires : `views/auth/change-password.ejs`, `views/auth/reset-password.ejs`, `views/admin/students/_form.ejs`, `views/admin/students/show.ejs`, `views/admin/teachers/form.ejs`, `views/admin/teachers/show.ejs`, `views/teacher/profile.ejs`, `views/student/profile/show.ejs`, `views/public/registration/new.ejs`.
- Traductions : `public/js/i18n.js`.
- Tests existants adaptés : `tests/studentModule.test.js`, `tests/publicStudentRegistration.test.js`.

## B. Migration

La migration ajoute uniquement `users.auth_version INTEGER NOT NULL DEFAULT 0`, exposé comme `User.authVersion` dans Prisma. Elle conserve les utilisateurs et les autres tables.

La cible de test vérifiée est `localhost:5432/english_center_test`, distincte de `localhost:5432/english_center`. Aucun identifiant secret n’est reproduit ici.

Le client Prisma a été généré et la migration appliquée à la base de test. La base principale et la production n’ont pas été migrées. Avant d’utiliser ce code avec une autre base : sauvegarder PostgreSQL, puis appliquer les migrations avec `npx prisma migrate deploy` dans l’environnement explicitement choisi. Ne pas utiliser `db push` ni `migrate reset` pour cette mise en service.

## C–E. Version, sessions et rôles

La connexion et l’inscription enregistrent une projection explicite de l’utilisateur avec `authVersion`, sans hash du mot de passe.

Après le middleware de session, `validateSession` recharge une projection minimale de l’utilisateur. Il refuse les versions absentes ou invalides, comptes supprimés/désactivés, versions différentes et changements de rôle. Il détruit alors la session, efface `connect.sid` et redirige vers `/login`. Une erreur de base n’autorise aucun accès par défaut.

Les middlewares ADMIN, STUDENT et TEACHER réutilisent `req.authenticatedUser`. Ils ne dupliquent pas la requête de validation. Les anciennes sessions ADMIN ne suffisent plus à conserver un droit retiré en base.

Chaque changement de mot de passe d’un compte existant incrémente atomiquement la version. Les anciennes sessions sont refusées à leur prochaine requête. Les changements effectués depuis un profil ou `/change-password` détruisent également la session courante et imposent une nouvelle connexion. Une requête déjà autorisée et en cours n’est pas annulée rétroactivement.

Le store PostgreSQL, le cookie HttpOnly/SameSite et la durée de huit heures sont conservés. Il n’est pas nécessaire de modifier la table `http_sessions` : la révocation logique précède sa purge habituelle.

## F. Politique de mot de passe

`passwordService` centralise `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_COST = 12`, la validation, le hash bcrypt et la comparaison. Les nouveaux mots de passe ne peuvent pas dépasser 72 octets UTF-8, afin d’éviter la troncature bcrypt. Aucun minimum nouveau n’est imposé à la comparaison de connexion : les comptes disposant d’un ancien mot de passe de huit caractères restent utilisables.

Les formulaires utilisent la constante exposée par Express. Les traductions sont alignées sur dix caractères.

`/change-password` est réservé à `mustChangePassword === true`, après validation de session. Les changements volontaires des profils exigent le mot de passe actuel ; cette exigence a également été ajoutée au profil enseignant.

Les mots de passe temporaires ADMIN entraînent `mustChangePassword = true`. Le parcours enseignant applique désormais explicitement ce comportement lors d’une création ou d’un reset ADMIN. Un reset par token ou la finalisation du mot de passe temporaire remet ce champ à `false`.

## G. Tokens existants

`PasswordResetToken` est conservé sans second modèle. Les tokens restent générés avec `crypto.randomBytes(32)` et stockés uniquement sous forme de SHA-256. Leur durée actuelle de trente minutes est conservée.

L’émission et la consommation verrouillent le compte afin de sérialiser les opérations concurrentes. Le hash du nouveau mot de passe est calculé avant la transaction. La consommation vérifie de nouveau `usedAt` et `expiresAt` après acquisition du verrou. Consommation, changement du hash, incrément de version et invalidation des autres tokens appartiennent à une seule transaction. Un compte inactif ne peut pas être réinitialisé.

Tous les autres chemins de changement invalident également les tokens non consommés. Le champ `usedAt` conserve la convention existante d’invalidation ; aucun nouveau statut n’est ajouté.

## H. Logs et erreurs

Les chemins de reset sont remplacés par `/reset-password/[REDACTED]` dans les logs de requête, erreurs et métadonnées, y compris les URL encodées. Les champs sensibles imbriqués sont supprimés ; les valeurs sensibles étiquetées dans les chaînes et les hashes bcrypt sont masqués. Le script de préparation des comptes d’audit n’imprime plus leur mot de passe.

Le contrôleur de récupération n’affiche que les erreurs métier reconnues. Les erreurs techniques imprévues passent par le gestionnaire global et un message public générique. La réponse publique de demande reste identique pour un compte trouvé ou absent ; aucun état administratif n’est exposé.

Les réponses de récupération et de changement forcé reçoivent `Cache-Control: no-store` et `Referrer-Policy: no-referrer`. Les autres protections Helmet et CSRF sont conservées.

## I–K. Vérifications

Le nouveau fichier de tests vérifie les exigences A–R : connexion des trois rôles, anciennes versions et sessions sans version, comptes désactivés/supprimés, ADMIN rétrogradé, incrément et révocation multi-session, invalidation des tokens, double consommation concurrente, expiration avant consommation et rollback, changements ADMIN et profils, mot de passe temporaire, CSRF, headers, politique et masquage des secrets.

Le test unitaire de `requireAdmin` a été adapté pour exiger l’utilisateur chargé par le middleware central, et refuse désormais une simple session déclarant le rôle ADMIN.

Le test de confirmation à l’inscription utilise désormais deux mots de passe de dix caractères différents et vérifie séparément le refus d’un nouveau mot de passe de huit caractères.

Résultat de référence avant branchement : 373 tests, 371 réussites et 2 échecs comptabilisés dans LMS Phase 5 à cause d’une indisponibilité PostgreSQL (`localhost:5432`).

Premier passage ciblé : 68 tests, 66 réussites et 2 échecs comptabilisés pour un import `endSession` manquant dans le contrôleur étudiant ; correction effectuée avant la vérification finale.

Premier passage complet après implémentation : 393 tests, 391 réussites et 2 échecs comptabilisés pour l’ancienne donnée de test de confirmation à huit caractères. Les 19 cas de sécurité Phase 1 passent ; le cas LMS en échec dans la référence passe également. La donnée de test a été adaptée à la nouvelle politique sans retirer l’assertion de confirmation.

Dernière suite complète : 393 tests, 390 réussites, 3 échecs comptabilisés (deux sous-tests et leur parent), en 369 652,8135 ms. Les 19 cas Phase 1 et le test d’inscription adapté passent. Les échecs proviennent du fichier existant `tests/productionReadinessPhase10.test.js` : délai dépassé au démarrage d’une transaction Prisma pendant le test de sauvegardes concurrentes, puis verrou encore actif au test de rétention suivant. Le service et le fichier de tests de sauvegarde n’ont pas été modifiés. Ces tests passaient lors du passage complet précédent ; l’échec est intermittent et extérieur aux parcours d’authentification modifiés. Il n’était pas présent dans la référence initiale et n’est donc pas présenté comme un échec initialement observé.

Vérification ciblée finale (Phase 1, sauvegardes et inscription) : **46 tests réussis sur 46, zéro échec, zéro test ignoré ou annulé**, en 45 482,959 ms ; code de sortie 0. Les 19 cas de sécurité Phase 1 passent, ainsi que les sauvegardes et l’inscription. La base de test et le répertoire de fichiers privés sont isolés pour cette relance.

La Phase 1 est implémentée et ses tests sont validés. Aucun échec lié à la Phase 1 ne reste ouvert. La dernière suite complète n’est pas présentée comme entièrement verte : ses échecs intermittents de sauvegarde sont conservés ci-dessus, même s’ils passent lors de la relance ciblée. Aucun correctif hors périmètre n’a été appliqué au module de sauvegarde.

Les exécutions utilisent l’environnement fourni par `isolatedEnvironment()` dans `scripts/runWithTestDatabase.js`, qui vérifie la distinction des bases et remplace `DATABASE_URL` par `TEST_DATABASE_URL` pour les processus enfants. Le nom `_test` a été vérifié en complément. La suite complète a été lancée avec `node --test --test-concurrency=1`. La relance ciblée utilise les mêmes options avec `tests/authSecurityPhase1.test.js`, `tests/productionReadinessPhase10.test.js` et `tests/publicStudentRegistration.test.js`. Les relances complètes et ciblées n’effectuent pas de reset. L’exécution de référence initiale utilisait le runner existant, qui réinitialise uniquement la base de test vérifiée.

Les rapports locaux sont conservés dans `tmp/auth-phase1-baseline.log`, `tmp/auth-phase1-focused.log`, `tmp/auth-phase1-full.log`, `tmp/auth-phase1-final.log` et `tmp/auth-phase1-verification.log`. Les rapports initiaux ont également été nettoyés des URL de tokens.

Vérifications statiques déjà réussies : syntaxe de 28 fichiers JavaScript, compilation de 150 templates EJS, 470 entrées de traduction publique et 17 références d’assets de marque.

## L. Phase 2

Restent volontairement absents : `PasswordResetRequest`, validation ADMIN des demandes, statuts de décision, OTP, livraison SMS/WhatsApp et nouvelle interface ADMIN de récupération. Le mécanisme existant de livraison `EMAIL_PENDING` n’est pas complété dans cette phase. Le rate limiting existant reste inchangé.
