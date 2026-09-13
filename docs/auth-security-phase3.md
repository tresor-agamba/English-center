# Sécurisation de l’authentification NVA — Phase 3

## A. Analyse initiale

Les rapports Phase 1 et Phase 2, le schéma Prisma, les services de récupération, les routes/contrôleurs ADMIN, `requireAdmin`, `validateSession`, CSRF, le logger, les notifications, les templates, la sidebar et les tests ADMIN ont été examinés avant modification.

L’application possède un routeur par module, monté dans `src/app.js` derrière `requireAdmin`. Les contrôleurs utilisent les services Prisma et rendent des vues EJS avec le header/footer communs. Le middleware ADMIN sélectionne le shell privé et la navigation active. Les listes utilisent une pagination simple avec `count`, `take`, `skip` et des liens GET. Les succès passent par une redirection avec un code de message ; les erreurs sont transmises au gestionnaire global.

`validateSession` charge l’utilisateur en base, vérifie son activité, son rôle et `authVersion`, puis `requireAdmin` exige un ADMIN actif sans changement de mot de passe obligatoire. CSRF protège déjà les mutations. Le logger structuré `logger.audit` est utilisé depuis la Phase 2 ; les autres audits persistés du projet sont spécifiques à leurs modules. Les notifications existantes comprennent annonces et compteur des notifications non lues, mais aucun mécanisme spécifique aux demandes de récupération.

Le shell ADMIN historique est principalement français et ne charge pas le script i18n public. Les nouvelles vues utilisent donc des messages FR/EN rendus côté serveur selon le mécanisme de langue existant : `documentLanguage`, alimenté par `lang=fr|en` puis le cookie `nva-language` (anglais par défaut dans ce mécanisme). Il n’y a pas de deuxième administration ni de nouveau framework i18n global.

## B. Fichiers modifiés

Nouveaux fichiers :

- `src/controllers/adminPasswordResetRequestController.js`
- `src/routes/adminPasswordResetRequestRoutes.js`
- `src/utils/passwordResetRequestMessages.js`
- `views/admin/password-reset-requests/index.ejs`
- `views/admin/password-reset-requests/show.ejs`
- `tests/authSecurityPhase3.test.js`
- `docs/auth-security-phase3.md`

Fichiers adaptés :

- `src/services/passwordResetRequestService.js`
- `src/app.js`
- `views/admin/_sidebar.ejs`
- `public/js/admin.js`
- `public/css/admin.css`

Cela représente 12 fichiers de code, vues, tests et documentation, dont sept nouveaux. Le script temporaire `tmp/auth-phase3-ui-check.cjs`, les captures et les journaux sont des artefacts de validation locale.

**Migration créée : NON. Migration appliquée : aucune en Phase 3.** Le modèle Phase 2 possède déjà les statuts, `reviewedById` et `reviewedAt`. Le champ `reason` reste absent : la décision et son auteur suffisent au périmètre demandé ; aucun texte libre de rejet ni migration supplémentaire n’est nécessaire. Aucun schéma ou enregistrement de la base principale locale n’a été modifié.

## C. Routes ADMIN

| Méthode | Route | Comportement |
| --- | --- | --- |
| GET | `/admin/password-reset-requests` | Liste paginée, PENDING par défaut |
| GET | `/admin/password-reset-requests/:id` | Détail |
| POST | `/admin/password-reset-requests/:id/approve` | PENDING → APPROVED |
| POST | `/admin/password-reset-requests/:id/reject` | PENDING → REJECTED |

Le module est monté derrière le `requireAdmin` existant, après `validateSession` et CSRF. Aucune action de décision n’est exposée en GET. Les pages du module ont `Cache-Control: no-store` et `Referrer-Policy: no-referrer`.

Les identifiants doivent être des entiers strictement positifs dans la plage PostgreSQL Int. Les identifiants invalides donnent 400 ; une demande inexistante donne 404 ; une décision impossible donne 409. Les messages métier sont traduits et le gestionnaire global continue de masquer les erreurs techniques.

## D. Interface ADMIN

La sidebar comporte un lien « Demandes de récupération » dans Configuration, avec état actif sur la liste et le détail. Aucun compteur supplémentaire ni requête à chaque page ADMIN n’a été ajouté.

La liste affiche ID, prénom/nom, téléphone, rôle, date de demande, statut, date de revue et auteur de la décision. Les six statuts disposent d’un filtre et d’un libellé lisible. Le filtre par défaut est PENDING ; un filtre inconnu est refusé. La pagination reprend le mécanisme des listes existantes : dix lignes par page, total, précédent/suivant et bornage de la page demandée. L’ordre est décroissant sur `requestedAt`, puis `id` pour départager les dates égales.

Le détail affiche l’identité, les contacts disponibles, le rôle, l’activité, les dates et le reviewer. Les formulaires sont présents uniquement pour PENDING. L’approbation est masquée lorsque le compte est inactif ou son rôle n’est plus admissible ; le rejet reste possible. Une demande traitée n’a plus d’action de décision.

Les confirmations utilisent le dialogue natif simple déjà employé dans l’administration, avec un gestionnaire limité aux formulaires `data-admin-confirm`. Les messages sont des attributs EJS échappés, sans injection de texte dans du JavaScript inline. Annuler le dialogue ne soumet pas le formulaire. Sans JavaScript, les POST restent protégés côté serveur, mais le dialogue de confirmation n’est pas affiché.

Les traductions FR/EN couvrent les nouvelles vues, les statuts, actions, confirmations, succès et erreurs métier. Les liens FR/EN de la liste et les liens/formulaires internes préservent `lang`. Le reste du shell ADMIN et ses erreurs globales conservent leur comportement linguistique historique.

Les styles sont limités au nouveau module. Les labels mobiles et valeurs restent visibles ; le minimum de largeur hérité du tableau ADMIN est neutralisé pour ce tableau sur mobile. Les cartes du détail se réorganisent selon la largeur. Les templates échappent toutes les valeurs utilisateur et conservent labels, titres, `scope`, messages de statut et boutons clavier.

## E. Service métier

`passwordResetRequestService` expose désormais `listPasswordResetRequests`, `getPasswordResetRequestById`, `approvePasswordResetRequest` et `rejectPasswordResetRequest`, en plus de la création Phase 2 inchangée.

Les projections Prisma sont explicites : aucun hash, token, session ou secret n’est chargé pour les vues. La liste charge moins de coordonnées que le détail. Le contrôleur se limite au chargement, au rendu, aux redirections et à la traduction des erreurs métier.

Une décision reçoit l’identité ADMIN issue de `req.authenticatedUser`, jamais le reviewer transmis par le formulaire. Le service revérifie en base activité, rôle ADMIN, absence de changement forcé et version d’authentification après verrouillage. Les champs `status` et `reviewedById` fournis par un client ne pilotent pas la décision.

## F. Transitions de statut

Seules PENDING → APPROVED et PENDING → REJECTED sont possibles. La décision écrit ensemble `status`, `reviewedById` et `reviewedAt` ; Prisma actualise `updatedAt`. `requestedAt` et `completedAt` sont préservés.

APPROVED, REJECTED, COMPLETED, EXPIRED et CANCELLED sont tous définitifs pour les actions Phase 3, y compris une deuxième approbation. Une tentative retourne 409 sans remplacer la première décision.

Avant APPROVE, le demandeur doit encore être actif et STUDENT ou TEACHER. Un compte inactif ou devenu ADMIN entraîne un refus explicite, sans transition automatique. Son rejet reste autorisé pour clôturer la demande. La suppression du demandeur cascade déjà sur ses demandes selon le schéma Phase 2 : leur consultation ou traitement retourne alors 404.

**APPROVE ne crée aucun PasswordResetToken, ne livre aucun lien, ne change aucun mot de passe et ne modifie pas authVersion.** Le service de consommation des tokens existants reste conservé.

## G. Concurrence

La transaction identifie la demande, puis verrouille les lignes User du reviewer et du demandeur en ordre croissant d’ID. Elle réutilise `passwordService.lockUser`, partagé avec les phases 1 et 2. Cet ordre évite les inversions de verrou entre décisions concurrentes.

Après acquisition, l’ADMIN et la demande sont relus, puis l’admissibilité du demandeur est vérifiée avant approbation. La mutation utilise `updateMany` avec `id` et `status: PENDING`. Une seule ligne doit être modifiée ; sinon la tentative échoue. Une décision concurrente ne peut donc pas écraser la première. Les bornes de transaction restent à dix secondes pour l’acquisition et l’exécution.

La création Phase 2 et les décisions suivent le même verrou utilisateur : une création ultérieure peut produire une nouvelle PENDING après une décision, conformément à la règle Phase 2. Une erreur métier dans la transaction provoque un rollback. Aucun verrou JavaScript ou contrôle frontend ne sert de garantie métier.

## H. Droits ADMIN

Les visiteurs anonymes sont redirigés vers `/login`. STUDENT et TEACHER sont refusés. Un ADMIN désactivé, rétrogradé ou dont `authVersion` a changé perd l’accès avec son ancienne session. Les décisions revérifient aussi ces informations en transaction, même si l’état change après le middleware.

Les formulaires APPROVE/REJECT incluent `csrfField()` et sont soumis en POST. Les tests imposent `CSRF_ENFORCE=true` et vérifient le refus des tokens CSRF absents ou incorrects. L’absence de bouton n’est jamais utilisée comme autorisation serveur.

Le limiteur existant de `/forgot-password` reste inchangé. Aucune nouvelle dépendance, notification, API externe ou voie de récupération de compte ADMIN n’a été introduite.

## I. Audit

Après commit, le logger standard produit `PASSWORD_RESET_REQUEST_APPROVED` ou `PASSWORD_RESET_REQUEST_REJECTED`, au niveau AUDIT. Les métadonnées contiennent `requestId` (ID de la demande métier), `userId` (demandeur), `adminId` (reviewer). Le logger ajoute son `timestamp` ISO et l’action selon son format existant.

Les tentatives refusées n’émettent pas de faux événement de décision. Aucun mot de passe, hash, token, cookie, email ou téléphone n’est transmis à cet audit. Les erreurs HTTP continuent d’employer le gestionnaire et le masquage existants.

Comme l’audit Phase 2, il s’agit du logger structuré existant, pas d’une nouvelle table transactionnelle. Une interruption entre commit et écriture du log peut laisser une décision en base sans événement de log ; `reviewedById` et `reviewedAt` restent enregistrés avec la décision. Aucun nouveau système parallèle d’audit n’a été construit.

## J. Tests ajoutés

`tests/authSecurityPhase3.test.js` contient **39 sous-tests**, soit 40 tests comptabilisés par Node avec le parent. Ils couvrent :

- Liste, détail, navigation, identités/contacts, projections sans secrets et absence d’injection HTML.
- Droits GET et POST pour ADMIN, STUDENT, TEACHER, anonyme, ADMIN inactif/rétrogradé et version révoquée.
- Approbation et rejet HTTP, bon reviewer, date, ignorance des champs décisionnels fournis par le client.
- Absence de token, conservation du mot de passe, de `mustChangePassword` et d’`authVersion`.
- Refus des deux actions pour les cinq statuts non PENDING, double APPROVE et concurrence entre deux ADMIN.
- Compte supprimé, compte désactivé, rôle devenu ADMIN, acteur de service invalide et revérification après verrou.
- Les six filtres, pagination bornée, identifiants invalides/inexistants, CSRF et refus du GET de mutation.
- Audits des deux décisions, unicité de l’audit en concurrence, métadonnées et absence de secrets.
- Parcours Phase 2 après une décision, FR/EN, connexion et dashboard ADMIN.

Les tests Phase 1 existants vérifient les changements de mot de passe, la révocation des sessions et les tokens historiques. Les tests Phase 2 continuent de vérifier la demande publique, la déduplication et son rate limiting. Aucun de ces tests n’a été supprimé ou adapté pour masquer une régression.

## K. Résultats exacts

Premier passage ciblé : **95/99 réussites**, quatre échecs comptabilisés (trois sous-tests et leur parent), zéro ignoré ou annulé, durée **65 987,3198 ms**. Détails et correction en section L.

Relance ciblée : **99/99 réussites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **62 149,0045 ms**. Elle inclut Phase 3 (**39/39 sous-tests**, 40/40 avec parent), Phase 2 (**19/19**, 20/20 avec parent), Phase 1 (**19/19**, 20/20 avec parent), layout ADMIN, module étudiants ADMIN, CSRF et inscription NVA/reset historique.

Premier passage complet (journal historique `tmp/auth-phase3-full.log`) : **393/400 réussites**, **7 échecs**, deux suites, zéro test ignoré ou annulé, durée **712 846,3505 ms**. La connexion PostgreSQL est devenue indisponible : les sept fichiers concernés sont rapports Phase 8, inscription autonome, SEO/accessibilité Lot 8, finances Phase 7, espace étudiant, module étudiants ADMIN et page des évaluations orales étudiantes. Plusieurs tests parents ont échoué avant de lancer leurs sous-tests, d’où un total inférieur au total attendu. Ce passage ne valide pas la suite complète.

Reprise de validation du 10 septembre 2026 : les fichiers Phase 3 étaient déjà présents au début de la reprise. La revue du service, des protections et des vues n’a pas nécessité de modification du code applicatif. La connexion à `english_center_test` a été vérifiée avant les tests. Nouvelle exécution ciblée : **99/99 réussites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **63 528,1355 ms**. Les **39/39** cas Phase 3, **19/19** Phase 2 et **19/19** Phase 1 passent ; Node compte également leurs tests parents. Journal : `tmp/auth-phase3-recheck-focused.log`.

Nouvelle suite complète : **453/453 réussites**, **2 suites**, zéro échec, ignoré ou annulé, code de sortie **0**, durée **314 542,0732 ms**. Journal : `tmp/auth-phase3-recheck-full.log`. Elle couvre notamment les trois phases de sécurité auth, les routes ADMIN, forgot-password, reset-password historique, login, rôles, changement de mot de passe et sauvegardes. Aucune régression restante observée dans cette exécution. Le total comprend les tests parents comptabilisés par Node : 413 tests de référence Phase 2 + 40 tests Phase 3 (39 cas et leur parent).

Les deux nouvelles exécutions utilisent `isolatedEnvironment()` et l’assertion exacte `english_center_test`, sans reset ni migration. Leurs fichiers privés sont isolés dans `tmp/auth-phase3-recheck-private` et `tmp/auth-phase3-recheck-full-private`. Les contrôles statiques ont également été relancés : **152/152** templates, **477/477** clés publiques, **17/17** assets, syntaxe valide du service, du contrôleur, du routeur et du script ADMIN. Les captures existantes de la liste mobile et du détail desktop ont été réinspectées ; la campagne navigateur historique décrite ci-dessous n’a pas été relancée lors de cette reprise.

Validation statique : **152/152** templates EJS compilés, **477/477** clés publiques FR/EN, **17/17** assets de marque ; syntaxe des nouveaux fichiers et des scripts/services modifiés valide. Les clés FR/EN du nouveau dictionnaire serveur sont également comparées par la suite Phase 3.

Validation visuelle locale Playwright/Edge : **6/6** vues sans débordement du document (liste et détail à 1440, 768 et 390 px), **2/2** confirmations (annulation du rejet, acceptation de l’approbation), **1/1** contrôle de langue anglaise, zéro erreur JavaScript de page. Le contrôle final vérifie aussi la visibilité du lien d’action sur mobile et l’absence de token après l’approbation. Captures inspectées et résultats dans `tmp/auth-phase3-ui/`, bilan dans `tmp/auth-phase3-ui-final2.log`.

Tous les processus applicatifs de validation utilisent `isolatedEnvironment()` du runner existant, avec une assertion supplémentaire du nom exact `english_center_test`, et des répertoires privés isolés sous `tmp/auth-phase3-*-private`. Les tests Node sont exécutés avec `--test --test-concurrency=1`, sans reset ni migration. Journaux : `tmp/auth-phase3-focused.log`, `tmp/auth-phase3-verification.log`, `tmp/auth-phase3-full.log`.

## L. Régressions / limitations

Les trois échecs initiaux étaient « ADMIN inactif : ancienne session refusée », « ADMIN rétrogradé : ancienne session refusée » et « authVersion révoquée : ancienne session refusée ». Chaque test réutilisait sa session après une première requête ayant correctement provoqué sa destruction. Le POST suivant recevait alors 403 CSRF, alors que le test attendait une nouvelle redirection `/login`. La correction prépare deux sessions avant révocation : une pour GET et une pour POST, afin de vérifier réellement le refus de chacune. Aucun contournement CSRF ni changement des middlewares n’a été effectué. Ces échecs sont des erreurs des nouveaux tests, pas une instabilité antérieure supposée.

Le navigateur intégré était indisponible ; le premier lancement Playwright a également échoué avant navigation parce que son binaire Chromium n’était pas installé. La validation a ensuite utilisé Edge déjà installé, sans installation de navigateur. L’inspection des captures a conduit à corriger le label du filtre, l’espacement des cartes et le minimum de largeur hérité des lignes mobiles. Le contrôle initial de débordement du document ne détectait pas ce dernier cas ; il a été complété par une assertion de visibilité de l’action mobile. Les captures finales sont vérifiées.

Limites conservées : pas de motif de rejet, pas de badge PENDING global, pas de notification au demandeur, pas d’expiration automatique et pas de génération/livraison. Une demande approuvée peut coexister avec une nouvelle PENDING selon la règle Phase 2 ; la politique de supersession et de fraîcheur doit être définie avant de rendre une approbation exploitable. Le shell ADMIN historique n’est pas traduit intégralement. Les confirmations natives sont une aide UX et non une barrière de sécurité. L’audit conserve les limites du logger existant décrites en section I.

## M. Préparation Phase 4

La Phase 4 devra définir et implémenter, séparément :

1. Charger une demande APPROVED, revérifier sa fraîcheur, le compte et les autorisations, et traiter les demandes concurrentes ou obsolètes.
2. Générer un PasswordResetToken aléatoire à durée limitée, stocké uniquement sous forme de hash, lié à la demande selon un modèle à concevoir, avec émission idempotente et invalidation des tokens remplacés.
3. Définir le canal et le destinataire vérifié, puis une livraison sécurisée sans exposer le token dans les logs, audits ou pages ADMIN. Choisir la gestion des échecs et reprises de livraison avant de brancher un fournisseur.
4. Consommer le token une seule fois et atomiquement, appliquer la politique de mot de passe Phase 1, changer le hash et incrémenter `authVersion`, invalider les autres accès de récupération et sessions.
5. Passer la demande correspondante à COMPLETED avec `completedAt` dans la transaction appropriée, et auditer la finalisation sans secret.

Le chemin prévu est APPROVED → génération de token → livraison sécurisée → nouveau mot de passe → COMPLETED. **Aucune de ces étapes Phase 4 n’a été implémentée ici.** Le système PasswordResetToken existant est conservé. Aucun email, SMS, WhatsApp, OTP, fournisseur externe, lien final, déploiement VPS, migration production ou modification de données réelles n’a été effectué.
