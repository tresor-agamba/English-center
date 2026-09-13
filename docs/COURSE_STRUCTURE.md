# Formations SIMPLE et LEVEL_BASED — phase NVA

## Contrat métier

Les champs existants `price`, `currency`, `durationValue`, `durationUnit` décrivent toute la formation SIMPLE ou **un seul niveau** LEVEL_BASED. `sessionCount` suit la même portée. Aucun modèle `CourseLevel` ni montant total du parcours n'est stocké.

| Exemple | Structure | Niveaux | Tarif | Durée | Séances | Parcours indicatif |
| --- | --- | --- | --- | --- | --- | --- |
| Excel pratique | SIMPLE | sans objet | 40 USD | 12 heures | 8 | 40 USD, 12 heures, 8 séances |
| Anglais Général | LEVEL_BASED | 3 | 60 USD / niveau | 24 heures / niveau | 16 / niveau | 180 USD, 72 heures, 48 séances |

`courseStructureService.courseTotals` calcule les totaux. Le prix utilise `Prisma.Decimal`; les produits entiers restent exacts au-delà de la précision de `Number`. `publicCoursePresentation.util` et le partiel `course-structure-summary.ejs` partagent la présentation publique. Le prix total est indicatif : « Le paiement s’effectue niveau par niveau. »

## Admin, sessions et inscription

- Le formulaire existant bascule les libellés, affiche le nombre de niveaux et l'aperçu calculé. Le serveur valide indépendamment du JavaScript.
- `numberOfLevels` accepte les entiers positifs jusqu'à la capacité d'un `Int` PostgreSQL, sans plafond métier à trois. `sessionCount` est obligatoire pour LEVEL_BASED et facultatif pour préserver les anciennes formations dont le nombre de séances est inconnu.
- Une session SIMPLE porte `levelNumber = null`. Une session LEVEL_BASED exige `1 <= levelNumber <= numberOfLevels`. Le nom de la session ne détermine jamais ce champ.
- Les groupes restent liés à leur session. Les changements de formation/niveau d'une session inscrite sont refusés. Les modifications de structure, de séances et de règle d'accès sont verrouillées dès qu'il existe des inscriptions ou cohortes. Les niveaux déjà référencés ne peuvent pas être supprimés par réduction du parcours.
- Une inscription à un niveau de 60 USD enregistre `Enrollment.expectedTotalAmount = 60`, jamais 180. Un changement ultérieur du prix du catalogue ne remplace pas ce montant ni les paiements existants.
- Aucun ancien cours n'est automatiquement converti en Anglais Général à trois niveaux. Une conversion exige une configuration explicite et compatible avec les sessions existantes.

## Migration et compatibilité

Migration : `prisma/migrations/20260912190000_add_course_structure/migration.sql`.

Prisma ajoute les enums `TrainingStructure` et `CourseAccessPolicy`, les champs `Course.structureType`, `numberOfLevels`, `sessionCount`, `accessPolicy`, et `TrainingSession.levelNumber`.

Le SQL ajoute uniquement des types, colonnes et contraintes. Il ne contient aucun `DROP`, `DELETE`, `TRUNCATE` ou `UPDATE`. Les anciennes formations reçoivent SIMPLE et LEGACY_STAGED par défaut ; niveaux et séances restent NULL. Les anciennes sessions gardent un niveau NULL, même si leur nom contient « Niveau 3 ». Les prix, durées et tables financières existants ne sont pas réécrits.

Application vérifiée sur la base isolée `english_center_test` avec le lanceur du projet. Ce lanceur refuse la base de développement et les environnements de production. La commande `npm test` réinitialise uniquement la base de test puis applique toutes les migrations. Pour une application additive sans réinitialisation : `npm run test:db:prepare`.

Le test `courseStructureMigration.test.js` applique le SQL réel dans un schéma transactionnel temporaire représentant les anciennes tables, compare toutes les valeurs historiques et annule la transaction. Il couvre Course, TrainingSession, Enrollment, Payment, StudentInvoice et StudentPayment, sans toucher aux tables applicatives.

## Dette technique explicitement conservée

### trialAccess

`LEGACY_STAGED` conserve les 5 séances gratuites, le seuil de 50 % jusqu'à la séance 10 et le paiement complet jusqu'à la séance 16. Il reste le défaut de migration et des anciens appels ne transmettant aucune structure. Les nouvelles créations Admin proposent `FULL_PAYMENT`, qui n'accorde pas d'essai anglais et ouvre l'accès après paiement complet. Les paiements partiels restent enregistrables. L'Admin peut choisir explicitement la règle historique pour une formation de 16 séances.

Phase suivante : remplacer les deux politiques par des paliers configurables, versionnés et figés à l'inscription ; dissocier complètement essai, placement anglais et recouvrement. Le service conserve ses noms historiques et certains libellés de niveau. Les anciens appels programmatiques sans `structureType` utilisent encore la compatibilité historique : ils devront être migrés explicitement avant de changer ce défaut.

### AcademicLevel

L'enum académique reste `LEVEL_1`, `LEVEL_2`, `LEVEL_3`. Un parcours commercial de quatre niveaux peut être créé et publié. La session de niveau 4 est présentée avec une invitation à contacter l'administration ; l'inscription correspondante est refusée avec `ACADEMIC_LEVEL_UNSUPPORTED`. Les niveaux 1 à 3 restent admissibles dans l'inscription par session. La création de cohortes pour un parcours commercial dépassant trois niveaux est refusée avec `UNSUPPORTED_COURSE_LEVELS`.

Phase suivante : modéliser les niveaux académiques extensibles et leurs correspondances avec les sessions commerciales avant d'activer ce workflow au-delà du niveau 3. Aucune conversion silencieuse vers LEVEL_3 n'est permise.

### Gratuité

La publication et le paiement exigent toujours un tarif strictement positif. Les formations gratuites feront l'objet d'une évolution séparée ; cette phase couvre les deux structures payantes.

## Fichiers du périmètre

- Données : `prisma/schema.prisma`, migration ci-dessus.
- Métier : `src/services/courseStructureService.js`, `courseService.js`, `coursePublicationPolicy.js`, `trainingSessionService.js`, `registrationService.js`, `trialAccessService.js`, `academicService.js`, `placementTestService.js`, `publicCourseService.js`, `studentCourseService.js`, `lmsCourseService.js`.
- Contrôleurs : `src/controllers/adminCourseController.js`, `adminSessionController.js`.
- Présentation : `src/app.js` (helper partagé dans les vues), `src/utils/publicCoursePresentation.util.js`, `public/js/course-structure-admin.js`, `main.js`, `i18n.js`.
- Vues : `views/admin/courses/_form.ejs`, `views/admin/sessions/_form.ejs`, `views/admin/sessions/show.ejs`, `views/partials/public-course-card.ejs`, `views/partials/course-structure-summary.ejs`, `views/public/courses/show.ejs`, `views/public/registration/new.ejs`, `views/public/registration/success.ejs`, `views/student/courses/show.ejs`, `views/student/enrollment/confirm.ejs`.
- Tests : `tests/courseStructure.test.js`, `tests/courseStructureMigration.test.js`, `tests/responsive/course-structure.spec.js`.

Le dépôt contient aussi des modifications antérieures liées à l'authentification ; elles ne sont pas attribuées à cette phase.

## Validation

Les résultats finaux et les éventuelles limites de l'environnement sont consignés dans `output/course-structure-validation.md`. Les tests métier couvrent les exemples tarifaires, les bornes, les sessions/groupes, la publication, le catalogue/détail/inscription, l'accès, les paiements, la compatibilité et les formulaires Admin. Les tests Playwright dédiés couvrent la bascule et l'aperçu Admin ainsi que les pages publiques à 320, 390, 768 et 1440 pixels.
