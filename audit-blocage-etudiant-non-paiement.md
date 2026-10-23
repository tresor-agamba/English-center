# Audit technique NVA — Blocage étudiant pour non-paiement

Date : 22 octobre 2026. Périmètre : code local dans D:\English-center, sans vérification de la version déployée sur Contabo.

Audit en lecture seule des sources. Seul ce rapport est créé. Aucun fichier source, modèle Prisma, migration, compte, paiement ou donnée PostgreSQL n’a été modifié. Aucun service démarré/redémarré, aucun déploiement ni envoi. Aucune intervention sur NovanceTech. Les références de lignes ci-dessous concernent le code local examiné.

## A. Conclusion principale

**Le non-paiement déclenche un blocage pédagogique par inscription, pas un blocage complet du compte étudiant.** Un compte étudiant actif, muni d’identifiants valides et ayant satisfait au changement obligatoire de mot de passe, peut se connecter et consulter son dashboard, ses formations, son calendrier, son profil et ses paiements. Les leçons, les fichiers pédagogiques privés et la jonction aux cours historiques sont contrôlés côté serveur.

**Ce blocage n’est toutefois pas uniforme sur toutes les fonctionnalités.** Les devoirs et plusieurs évaluations se fondent sur le statut enregistré, sans recalcul du paiement. Une tentative écrite déjà créée reste modifiable et soumissible après passage de l’inscription à PAYMENT_REQUIRED. Les contenus déjà téléchargés et les liens externes déjà obtenus ne sont pas révoqués par NVA.

Le cas commercial « cinq séances gratuites, puis minimum 30 USD sur un niveau à 60 USD » correspond à la politique LEGACY_STAGED. Le seuil réel est **50 % du montant historique attendu sur l’inscription**, pas une constante de 30 USD. Les 30 USD donnent accès uniquement jusqu’à la séance 10 ; le solde complet est requis pour les séances 11 à 16. La politique FULL_PAYMENT n’offre ni essai ni palier à 50 %.

### Réponses sur le compte

| Question | Comportement prouvé |
| --- | --- |
| Connexion en situation de non-paiement ? | Oui si compte actif et identifiants valides. authenticate ne consulte aucun paiement : src/services/authService.js:8–15. |
| Dashboard accessible ? | Oui : src/app.js:170 ; src/middlewares/requireStudent.js:1–12 ; src/controllers/studentController.js:11–14. Le dashboard recalcule aussi des accès, sans refuser son affichage pour dette. |
| Blocage complet possible ? | Oui, indépendamment du paiement : User.isActive=false refuse la connexion et termine une session existante ; utilisateur supprimé ou authVersion/rôle changé invalident aussi la session. src/middlewares/validateSession.js:24–37. |
| Qui désactive le compte ? | L’action administrative toggleStatus utilise studentService.setActive : src/controllers/adminStudentController.js:178–182 ; src/services/studentService.js:114–116. Aucun appel de cette désactivation n’a été identifié dans les parcours de paiement/présence examinés. |
| Niveau auquel le blocage s’applique ? | Enrollment.status et résultat de calculateTrialAccess, alimentés par les présences et Payment.SUCCESS de cette inscription. Ni User.isActive ni AcademicEnrollment.status ne sont modifiés par ce calcul. |
| Redirection après connexion ? | Changement obligatoire de mot de passe, puis /student pour un étudiant, ou /enroll?session=… si une session est demandée. Aucun branchement financier : src/controllers/authController.js:47–55. |

## B. Tableau des accès

Hypothèses des deux colonnes : compte actif ; inscription historique LEGACY_STAGED ; montant attendu 60 USD ; cinq à neuf présences comptées ; formation publiée lorsque requis ; ressources et évaluations attribuées, publiées et disponibles. La colonne « sans paiement » suppose le statut PAYMENT_REQUIRED effectivement recalculé ; la seconde un cumul Payment.SUCCESS admissible de 30 USD. Les restrictions de dates, prérequis et nombre de tentatives restent applicables. Après dix présences, 30 USD ne suffisent plus.

| Fonctionnalité | Sans paiement après essai | Paiement validé de 30 USD | Preuve dans le code |
| --- | --- | --- | --- |
| Connexion / session | Autorisées ; aucune vérification financière dans l’authentification | Identiques | authService.js:8–15 ; validateSession.js:24–37 |
| Dashboard /student | Visible ; état de paiement affiché, accès aux cours calculé | Visible ; accès partiel, pas intégral | studentController.js:11–14 ; studentDashboardService.js:31–68 |
| Profil / mot de passe | Consultation et modification autorisées | Identiques | studentRoutes.js:19–21 ; studentController.js:52–97 |
| Notifications : lecture / actions utilisateur | Autorisées pour l’utilisateur authentifié ; aucun blocage financier global | Identiques | app.js:184 ; routes/notificationRoutes.js ; requireAuthenticated.js:1–8 |
| Liste et détail des formations | Visibles ; état des paliers, paiements et séances consultables | Visibles ; palier partiel affiché | studentCourseService.js:36–54,57–113 ; views/student/courses/show.ejs:2–11 |
| Calendrier et métadonnées des séances | Visibles ; bouton rejoindre retiré si refus d’accès | Visibles ; rejoindre seulement les séances autorisées et dans la fenêtre | studentScheduleService.js:4–62 ; views/student/schedule/index.ejs:9 |
| Détail d’une séance historique | Page et métadonnées visibles ; support lié non chargé si hasCourseAccess=false | Support lié chargé ; ne tient pas compte à ce stade de la position propre à cette séance | studentClassMeetingService.js:13–59 ; views/student/class-meetings/show.ejs:11–12 |
| Rejoindre un cours historique, URL directe /class-meetings/:id/join?enrollment=… | Refus serveur, HTTP 403 ; lien privé non retourné | Autorisé jusqu’à la position 10, de 30 minutes avant le début jusqu’à la fin, si SCHEDULED | trialAccessService.js:259–325 ; classMeetingController.js:3–28 |
| Plan pédagogique /courses/:enrollmentId/learn | Visible : modules/leçons publiés, métadonnées et progression ; liens vers contenus masqués | Visible, contenus accessibles selon prérequis | learningAccessService.js:54–115,126–176 ; views/student/learning/index.ejs:4,11 ; _lesson-item.ejs:1 |
| Contenu d’une leçon, vidéo / lien externe présenté par la leçon | Refus serveur 403, même par URL directe | Accessible : pas de correspondance imposée entre leçon et positions 6–10 des séances | learningAccessService.js:174–199 ; views/student/learning/lesson.ejs:4–5 |
| Marquer/démarquer une leçon ; activité/progression POST | Refus par getLesson | Autorisé sous conditions de complétion ; activité bornée | learningAccessService.js:232–265 ; studentRoutes.js:13–16 |
| Documents pédagogiques privés, téléchargement direct | Refus serveur via getLesson, contrôle d’appartenance et de publication | Accessible si leçon déverrouillée | lmsResourceService.js:45–51 ; studentController.js:157–161 |
| Documents / vidéos externes ou copie déjà téléchargée | Nouvelle découverte via leçon bloquée ; URL déjà connue/copie non révoquée par NVA | Accessible, sous contrôle éventuel du fournisseur externe | views/student/learning/lesson.ejs:4–5 ; student/class-meetings/show.ejs:11 |
| Liste des devoirs, notes publiées | Aperçu autorisé, y compris note publiée et statut ; pas d’ouverture du détail | Détail et instructions accessibles | assignmentAccessService.js:18–38,40–68,71–101 ; views/student/assignments/index.ejs:4 |
| Soumettre/modifier un devoir par POST direct | Refus 403 si statut PAYMENT_REQUIRED ; pas de recalcul financier | Autorisé si délai et correction le permettent | assignmentAccessService.js:71–75,122–141 |
| Évaluation orale enregistrée : liste, détail, nouvelle tentative, audio envoyé, soumission | Retirée/refusée par statut actif enregistré | Autorisée selon dates/quotas | recordedOralAssessmentService.js:7 ; recordedOralAttemptService.js:8–57,85–96,126–149,170–197 |
| Ancienne tentative orale / résultat publié / réécoute | Consultation possible par propriétaire ; réécoute si allowPlayback ; pas de contrôle financier | Identique | recordedOralAttemptService.js:65–82,200–205 ; oralAudioAccessService.js:24–30 |
| Évaluation écrite : liste, détail, commencer une tentative | Refus/absence de liste par statut enregistré | Autorisé selon disponibilité et quotas | writtenAttemptService.js:7–26,39–88 |
| Tentative écrite déjà créée : lire, répondre, soumettre | **Encore autorisé**, même si PAYMENT_REQUIRED ; reste soumis à DRAFT, expiration et réponses obligatoires | Autorisé | writtenAttemptService.js:119–129,149–178,181–219,222–231 |
| Audio Listening d’une tentative écrite existante / résultat publié | Accessible au propriétaire sans contrôle de paiement | Identique | writtenMediaService.js:33–40 ; writtenAttemptService.js:234–243 |
| Oraux en direct : liste, détail, instructions et résultats publiés | Visibles aux participants ; ne vérifient pas le paiement | Identiques | liveOralAccessService.js:21–63 |
| Rejoindre un oral en direct, GET ou POST | Refus si inscription PAYMENT_REQUIRED ; contrôle du statut enregistré, pas de recalcul | Autorisé si participant, statut et fenêtre adéquats | liveOralSessionService.js:8 ; liveOralAccessService.js:66–83 ; studentLiveOralRoutes.js:7–8 |
| Inscription académique, groupe, enseignants, séances, présences | Page accessible indépendamment du palier ; montre ACTIVE/SUSPENDED/COMPLETED | Identique ; absence de passerelle financière | academicService.js:240–248 ; studentAcademicRoutes.js:4 ; views/student/academic/index.ejs:4–10 |
| Historique des paiements / création de tentative / preuve / reçu | Accessibles selon propriété et état ; dette n’interdit pas de payer | Accessible ; solde encore dû | studentRoutes.js:18 ; paymentRoutes.js:11–17 ; paymentService.js:129–174 ; manualPaymentService.js:279–295 |
| Finances : factures, paiements et reçus PDF | Accessibles au propriétaire ; distincts du palier historique | Identiques ; un paiement de ce module ne débloque pas ce palier | simpleFinanceController.js:17–26 ; simpleFinanceService.js:82–125 |
| Certificats déjà émis : consulter / télécharger PDF | Autorisés pour un certificat ISSUED appartenant à l’étudiant ; dette actuelle non recontrôlée | Identiques | certificateService.js:200–210 ; studentCertificateController.js:3–18 |
| Nouvelle émission de certificat | Pas une action étudiante de déblocage par 30 USD ; éligibilité académique et frais distincts, émission administrative | Les 30 USD ne suffisent pas à garantir un certificat | certificateService.js:49–76,129–134 ; studentCertificateRoutes.js:4–6 |

Préfixe de tous les services cités dans ce tableau : src/services/. Contrôleurs : src/controllers/. Routes : src/routes/. Montage commun étudiant et protection : src/app.js:170–177. Chaque POST reste soumis aux protections de session/CSRF applicables, qui ne remplacent pas un contrôle financier.

## C. Fonctionnement des cinq séances gratuites

### Comptage réel

calculateTrialAccess charge les séances non annulées de la TrainingSession, triées par startsAt puis id, et ne conserve que les seize premières en politique historique. Il dénombre les identifiants distincts des séances correspondantes ayant une présence PRESENT et dont startsAt est déjà passé. ABSENT, EXCUSED, séances annulées et présences futures ne sont pas comptés (trialAccessService.js:60–91,110–113).

**Ce ne sont ni cinq connexions, ni cinq clics sur « rejoindre », ni cinq téléchargements, ni cinq jours.** Le simple accès au lien ne crée pas de présence dans canAccessClassMeeting. Les saisies de présence administratives/enseignantes historiques passent par attendanceService.recordAttendance ou recordAttendanceBatch, qui enregistrent la présence puis recalculent les droits dans la transaction (attendanceService.js:23–39,43–63,66–98). La fin d’essai est donc automatique une fois les données de présence suffisantes, mais dépend de leur saisie correcte. Une présence peut compter dès le début de séance : aucune condition endsAt passée n’est requise dans ce calcul.

### Déclenchement et position des séances

- Moins de cinq présences et cumul inférieur à 50 % : FREE_TRIAL, allowed=true, nextSessionLimit=5.
- Au moins cinq présences, moins de dix, cumul inférieur à 50 % : PAYMENT_REQUIRED_50, allowed=false, statut PAYMENT_REQUIRED.
- Au moins 50 %, moins de dix présences : PARTIAL_ACCESS, allowed=true, statut TRIAL_ACTIVE, nextSessionLimit=10.
- Au moins dix présences et moins de 100 % : PAYMENT_REQUIRED_FULL, allowed=false.
- Paiement complet et moins de seize présences : FULL_ACCESS, statut CONFIRMED, limite seize.
- Seize présences : COMPLETED, accès aux contenus et jonction refusé même si payé ; statut calculé CONFIRMED. Le test de fin intervient avant celui du paiement intégral.

Preuves : trialAccessService.js:130–160 ; enrollmentPolicy.js:1–3.

Deux limites coexistent : nombre de présences et **position de la séance dans la session**. Sans paiement, une séance en position 6 est refusée même si l’étudiant n’a que deux présences. Les cinq séances ne forment donc pas un crédit de cinq séances librement choisies. Sans cinq présences enregistrées, l’accès général aux leçons peut rester FREE_TRIAL tandis que le sixième cours live est refusé. canAccessClassMeeting vérifie la position, l’appartenance, l’état SCHEDULED et la fenêtre horaire côté serveur (trialAccessService.js:259–305).

Le compteur est par Enrollment/TrainingSession, pas un compteur global de l’étudiant sur les trois niveaux. Le code ne garantit pas ici un essai unique sur toute la formation. Annuler une séance ou corriger une présence peut réduire le compteur et rouvrir un palier : classMeetingService.cancel:253–261 ; attendanceService:57–60. Les présences AcademicAttendance du module académique séparé ne sont pas utilisées (academicService.js:216–235).

### Moments de recalcul et messages

Le recalcul intervient à la saisie des présences, à la confirmation d’un paiement manuel, lors de la consultation des formations, du calendrier et du dashboard, à l’accès à une leçon/fichier privé et à la jonction d’une séance. Des consultations administratives le déclenchent également. Aucun besoin d’un bouton « débloquer » pour le palier ; aucun worker financier périodique n’est nécessaire à ces contrôles. En revanche, des modules qui ne font que lire le statut peuvent rester décalés jusqu’à un recalcul.

Attention : **calculateTrialAccess n’est pas une lecture pure** : il complète éventuellement expectedTotalAmount/expectedCurrency et écrit Enrollment.status et les horodatages. Il n’a donc pas été exécuté contre PostgreSQL pendant cet audit (trialAccessService.js:95–104,156–170).

Message historique visible : « Votre période gratuite de 5 séances est terminée. Vous devez payer au moins 50 % du prix total pour accéder aux 5 séances suivantes. » Après dix séances : demande de payer le solde pour les six dernières. Preuves : classMeetingController.js:10–18 ; views/student/courses/show.ejs:6–8. Les leçons refusées répondent « Le contenu est réservé aux inscriptions actives. » (learningAccessService.js:176). Le plan montre « Le contenu reste verrouillé jusqu’à l’activation de l’inscription. » (views/student/learning/index.ejs:4). Une notification de paiement requis est créée après les présences si le statut est PAYMENT_REQUIRED (attendanceService.js:35–37,94–96 ; notificationEventService.js:111).

## D. Paiement partiel et réactivation

### Somme admise et seuil

Le calcul additionne uniquement les lignes **Payment.status=SUCCESS**, rattachées à l’inscription, de même devise que expectedCurrency et de même courseId que la formation (trialAccessService.js:81–84,114–126). Il utilise Prisma.Decimal, plafonne le ratio à 100 % et borne le solde à zéro. Plusieurs paiements se cumulent : 20+10 USD réussis valent 30 USD ; 20 réussis +10 en attente ne valent que 20 USD. Aucune conversion USD/CDF n’est faite.

Le montant historique est initialisé au prix du cours lors de l’inscription (registrationService.js:183–184). Les anciennes inscriptions dépourvues de montant/devise sont complétées au premier recalcul (trialAccessService.js:95–104). Le montant de référence peut donc différer du prix courant ou des 60 USD annoncés : pour un attendu de 100 USD, 30 USD ne suffisent pas ; pour 60 USD, le seuil est exactement 30 USD.

Un paiement positif inférieur à 30 USD peut être accepté comme acompte ; requestedPaymentAmount n’impose pas un minimum de 30, mais refuse un montant nul/négatif/non fini ou supérieur au solde (paymentService.js:153–174). Après l’essai, le blocage reste tant que le cumul admissible est inférieur à 50 %.

### Réactivation

Dans le parcours manuel, « J’ai effectué mon paiement » ne valide pas les droits : declarePayment crée une déclaration à vérifier (manualPaymentService.js:143–170). **Un administrateur doit confirmer le paiement**, puis confirm écrit SUCCESS et recalcule l’accès dans la même transaction Serializable (manualPaymentService.js:229–246). Pour 60 USD attendus et cinq à neuf présences, atteindre 30 USD réactive automatiquement PARTIAL_ACCESS. Aucune seconde action administrative de réactivation n’est requise.

Cette opération ne réactive pas un User.isActive=false, n’enlève pas PLACEMENT_TEST_REQUIRED, ne réactive pas un AcademicEnrollment suspendu et ne contourne ni les dates ni les prérequis. Après dix présences, 30 USD restent insuffisants. Le code contient aussi une simulation de succès hors production ; elle est refusée lorsque NODE_ENV=production (paymentService.js:39–42,263–300). Aucun parcours automatique de confirmation d’un prestataire réel n’est établi par ces fonctions : sa configuration effective reste à vérifier hors de cet audit.

### Refus, annulation, remboursement, invalidation

PENDING, PROCESSING, FAILED, CANCELLED, EXPIRED et REFUNDED ne contribuent pas au cumul. Ces états existent dans le schéma (prisma/schema.prisma:336–344). Un paiement manuel en attente peut être refusé et devient FAILED ; **un SUCCESS ne peut pas être refusé par cette action** (manualPaymentService.js:258–269). Le refus ne retire donc pas un crédit précédemment validé et ne recalcule pas les droits ; le montant en attente ne les avait jamais ouverts.

Si un SUCCESS devait être reclassé REFUNDED/CANCELLED/FAILED par un mécanisme externe autorisé, le prochain recalcul l’exclurait et pourrait rebloquer l’accès. Aucun parcours applicatif de révocation/remboursement de SUCCESS et de recalcul immédiat n’a été identifié dans les écritures Payment examinées. Ne pas confondre existence d’un état Prisma avec existence d’une action métier correspondante. Aucun paiement n’a été invalidé pour vérifier cela.

### Deux comptabilités non raccordées

**StudentPayment n’est pas Payment.** Le module /student/finances utilise StudentInvoice et StudentPayment, rattachés à AcademicEnrollment. simpleFinanceService.recordPayment crée un StudentPayment et actualise le solde de facture, mais ne crée pas de Payment.SUCCESS historique et n’appelle pas calculateTrialAccess (simpleFinanceService.js:82–108). Ainsi, même 30 ou 60 USD enregistrés depuis ce module ne garantissent aucun déblocage du LMS historique. Les reçus prouvent le paiement dans ce module, pas le franchissement du palier historique. Le paiement de certificat est lui aussi séparé (certificateService.js:65–75,97–116).

## E. Fichiers responsables et conditions essentielles

Tous les chemins ci-dessous sont relatifs à D:\English-center ; aucun fichier homonyme d’un autre projet n’a été audité.

| Fichier / lignes | Fonction | Condition ou responsabilité |
| --- | --- | --- |
| src/services/authService.js:8–15 | authenticate | Compte existant, actif et mot de passe valide ; aucune dette examinée. |
| src/middlewares/validateSession.js:24–37 | validateSession | Invalide compte supprimé/inactif, authVersion ou rôle modifié. |
| src/middlewares/requireStudent.js:1–12 | requireStudent | Session, rôle STUDENT, compte actif, mot de passe ; aucun paiement. |
| src/controllers/authController.js:47–55 | login | Redirections de rôle/inscription et changement de mot de passe. |
| src/services/enrollmentPolicy.js:1–5 | constantes | Limites historiques 5/10/16 ; CANCELLED/PAYMENT_FAILED non occupants. |
| src/services/courseStructureService.js:46–48 | accessLimits | LEGACY_STAGED par défaut, sinon FULL_PAYMENT, sans essai/palier. |
| src/services/trialAccessService.js:39–170 | calculateTrialAccess | Comptage, cumul SUCCESS, seuils 50/100 %, calcul et persistance du statut. |
| src/services/trialAccessService.js:259–325 | canAccessClassMeeting | Propriété inscription, session, position, paiement, horaires, URL HTTPS. |
| src/services/attendanceService.js:23–39,66–98 | recordAttendance / Batch | Saisie des présences puis recalcul transactionnel ; notification et rappels. |
| src/services/manualPaymentService.js:229–276 | confirm / refuse | Validation admin, recalcul après SUCCESS ; refus réservé à PENDING. |
| src/services/learningAccessService.js:54–115,155–199,232–265 | enrollmentForLearning / getLearningPath / getLesson / actions | Recalcul des droits ; plan visible, contenu/actions refusés si non autorisés. |
| src/services/lmsResourceService.js:45–51 | studentFile | Contrôle getLesson avant lecture du fichier privé. |
| src/services/assignmentAccessService.js:33–75,122–141 | listForEnrollment / getForStudent / submit | Aperçu PAYMENT_REQUIRED ; détail/actions sur TRIAL_ACTIVE ou CONFIRMED seulement. |
| src/services/recordedOralAttemptService.js:8–29,65–89,126–129 | eligibleContext / requireOwnedAttempt / saveAudioResponse / submit | Éligibilité active pour écrire ; propriété seule pour lire une ancienne tentative. |
| src/services/writtenAttemptService.js:15–26,119–129,149–219 | enrollmentFor / requireOwned / saveResponse / submit | Statut actif au démarrage ; absence de contrôle financier/statut inscription sur tentative existante. |
| src/services/liveOralAccessService.js:21–83 | studentList / studentDetail / studentJoin | Consultation participant ; jonction par statut actif enregistré et fenêtre horaire. |
| src/services/simpleFinanceService.js:82–108 | recordPayment | Enregistrement StudentPayment et facture, pas de passerelle LMS historique. |
| src/services/academicService.js:216–248 | recordAttendance / studentOverview | Présences et inscriptions académiques distinctes, sans calcul des cinq essais historiques. |
| src/services/studentService.js:114–116 | setActive | Désactivation complète administrative du compte, indépendante du paiement. |
| src/services/certificateService.js:200–210 | getForStudent | Certificat ISSUED appartenant à l’étudiant ; pas de nouveau contrôle de dette. |

## F. Anomalies, écarts et risques de contournement

### F1 — Important : continuer une évaluation écrite après le blocage

La création d’une nouvelle tentative exige un statut actif, mais /student/written-attempts/:id, POST /student/written-attempts/:id/responses/:questionId et POST /student/written-attempts/:id/submit utilisent requireOwned, qui vérifie seulement le propriétaire et le mode WRITTEN. L’étudiant bloqué peut continuer son brouillon existant (sous réserve de l’expiration). L’audio Listening est également accessible par le propriétaire. C’est un contournement du blocage pédagogique si celui-ci doit inclure les évaluations en cours, pas un accès au compte d’autrui. Preuves : writtenAttemptService.js:119–129,149–219 ; writtenMediaService.js:33–40 ; studentWrittenAssessmentRoutes.js:10–14.

### F2 — Important : comptabilités et présences séparées

Les nouveaux modules académiques/Finances ne font pas franchir les paliers du LMS historique. Un paiement reçu dans StudentPayment ou cinq présences AcademicAttendance ne modifient pas le cumul Payment.SUCCESS ou le compteur Attendance. Risque : étudiant réellement payé mais toujours bloqué, ou essai jamais consommé dans le LMS. Preuves : simpleFinanceService.js:82–108 ; academicService.js:216–235 ; trialAccessService.js:74–84. Il faut identifier les écrans réellement utilisés en production avant de conclure à un déblocage opérationnel.

### F3 — Important : inscription CANCELLED non refusée par le calcul central

calculateTrialAccess préserve CANCELLED en base en évitant d’écraser son statut, mais **ne force pas allowed=false pour CANCELLED**. Il peut retourner FREE_TRIAL ou FULL_ACCESS. getLesson et canAccessClassMeeting se fondent sur allowed sans rejeter explicitement l’inscription annulée. L’interface du détail formation masque le lien si CANCELLED, mais une URL directe peut passer si les autres conditions sont réunies. Un scénario synthétique CANCELLED sans présence et sans paiement retourne bien allowed=true. Preuves : trialAccessService.js:134–162,259–298 ; learningAccessService.js:115,155–176 ; views/student/courses/show.ejs:50. Ce risque concerne l’annulation, distincte d’un PAYMENT_REQUIRED correctement calculé. PAYMENT_FAILED peut également être recalculé vers un statut actif selon les montants/présences ; ce statut ne constitue pas un verrou absolu.

### F4 — Statuts enregistrés et présentation temporairement incohérents

Devoirs, démarrages d’évaluations et oraux live lisent le statut sans recalcul. Une variation de paiement/présence hors parcours normal ou le passage d’une présence future à passée peut laisser un accès périmé jusqu’à la prochaine consultation recalculante. Le dashboard lance en parallèle les chargements du calendrier, des compteurs et des devoirs : ces derniers peuvent afficher l’état antérieur pendant une requête (studentDashboardService.js:33–49). Les horodatages accessBlockedAt/firstHalfReachedAt/fullyPaidAt sont conservés comme jalons ; ils ne constituent pas la décision d’accès courante (trialAccessService.js:163–168). Un nouveau blocage ne réinitialise pas accessBlockedAt, ce qui limite l’historique des cycles blocage/déblocage.

### F5 — Les paliers live ne segmentent pas les leçons

allowed=true pendant l’essai ou le palier partiel ouvre toutes les leçons publiées/déverrouillées par leurs prérequis, sans les limiter aux séances 1–5 ou 6–10. Le détail d’une séance charge également son support dès hasCourseAccess=true, même si la position de cette séance dépasse nextSessionLimit (studentClassMeetingService.js:43–59). Les liens externes ainsi obtenus peuvent rester utilisables après blocage. La vérification financière des fichiers privés reste, elle, effective à chaque nouvelle requête. La confidentialité et la révocation chez Zoom/Meet ou un hébergeur tiers ne sont pas démontrées par le code NVA.

### F6 — Messages pas toujours conformes à la décision

La notification paymentConfirmed annonce « Votre accès aux cours est réactivé » sans vérifier que le cumul suffit ; une petite somme validée peut laisser le blocage (notificationEventService.js:112 ; paymentService.js:295–298). Les messages historiques « dix séances consommées » sont aussi utilisés pour PAYMENT_REQUIRED_FULL sous FULL_PAYMENT, où aucun essai n’existe (classMeetingController.js:11–13 ; views/student/courses/show.ejs:7). Dans d’autres refus, la formule « cinq séances terminées » peut être inexacte si seule la position dépasse la limite. Ces textes ne modifient pas le contrôle serveur.

### F7 — Essai par inscription et dépendance aux présences

Le système ne prouve pas l’offre de cinq séances uniques pour un étudiant sur toute sa formation. L’absence de pointage permet de conserver l’accès général aux leçons ; la position bloque néanmoins les cours live après la cinquième séance. Corriger/annuler une présence peut rouvrir l’essai. Cela peut être souhaité, mais doit être explicitement compatible avec les règles commerciales.

### F8 — Fin de niveau et disponibilité

À seize présences, allowed=false interdit aussi les leçons et fichiers privés même après paiement complet : ce n’est pas un blocage pour dette. L’accès aux archives payées n’est donc pas garanti. Les cours gratuits provoquent PAID_COURSE_REQUIRED dans ce calcul, et un tarif mal configuré peut provoquer une erreur de page plutôt qu’un simple verrou ; plusieurs services de liste ne neutralisent pas ces erreurs (trialAccessService.js:92–107 ; studentCourseService.js:53). Aucune donnée réelle n’a été consultée pour savoir si ces cas existent.

### Contrôles positifs constatés

Pour un statut PAYMENT_REQUIRED recalculé et une inscription non annulée, accéder directement à une leçon, à son fichier privé ou à la jonction du cours historique ne contourne pas le contrôle serveur. Les devoirs et nouvelles évaluations imposent aussi leurs propres contrôles de statut côté serveur. L’audit n’a pas établi de contournement de propriété vers les données d’un autre étudiant. Le service worker exclut les routes étudiantes et fichiers privés de son cache applicatif (public/sw.js:26–36,75–78) ; cela ne retire pas les copies déjà téléchargées ni les contenus enregistrés par l’utilisateur.

## G. Recommandations — non implémentées

1. Décider quel registre fait foi pour les paiements et présences ; définir une passerelle auditée entre Finances/AcademicEnrollment et Payment/Enrollment si les deux systèmes doivent rester actifs. Ne pas créditer deux fois un même versement.
2. Uniformiser la décision d’accès côté serveur pour les opérations pédagogiques, notamment les tentatives écrites existantes ; décider explicitement si les anciens résultats restent consultables après blocage.
3. Refuser explicitement les inscriptions annulées dans les contrôles centraux, et distinguer clairement annulation, placement, dette et fin de niveau.
4. Fixer la portée commerciale de l’essai (par étudiant/formation/niveau), le rôle des absences et la politique d’accès aux archives payées ; décider si les leçons doivent être segmentées par palier.
5. Définir un parcours autorisé de remboursement/invalidation avec recalcul immédiat et journal des cycles de blocage. Adapter les notifications à la décision réelle, pas au seul succès d’un versement.
6. Vérifier en environnement isolé, sur une restauration anonymisée : montant historique 60 USD, politique LEGACY_STAGED, liens des paiements et présences, comptes actifs, contrôle réel des URL et fichiers, 29/30/60 USD, dixième et seizième présences, annulation et remboursement. Aucun de ces tests ne doit être lancé sur les données réelles sans autorisation distincte.

## Validation effectuée et limites de preuve

- Lecture des routes, montage Express, middlewares, contrôleurs, services, modèles Prisma, vues et service worker ; aucun appel HTTP vers une instance NVA.
- Test existant purement statique exécuté : node --test tests/manualPaymentStatic.test.js — **1 test réussi**. Ce fichier lit uniquement les sources.
- Exécution de calculateTrialAccess dans une VM Node avec dépendances injectées, journalisation neutralisée et client en mémoire synthétique — **16 cas réussis**, sans connexion Prisma/PostgreSQL. Cas : 4/5 présences ; 0/29/30/60 USD ; 9/10/16 présences ; PENDING/FAILED ; mauvaise devise/formation ; FULL_PAYMENT ; attendu 100 USD ; placement ; inscription CANCELLED. Cette vérification confirme les branches de calcul, pas les requêtes SQL ni un parcours HTTP réel. Les écritures simulées ne touchent que la mémoire du processus.
- Les tests existants paymentAccessStages, freeTrialAttendance et autres tests d’intégration créent des utilisateurs, paiements et séances en base : **ils n’ont pas été exécutés** pour respecter la mission.
- Les valeurs actuelles de Contabo, l’état des migrations, le branchement des prestataires, les configurations des liens externes et les éventuels triggers SQL ne sont pas vérifiés. Aucune affirmation de conformité des données de production n’est faite.

**Bilan commercial :** la politique historique implémente bien 5 séances, puis 50 % (30 USD si attendu 60 USD), puis 100 % après dix présences. Elle ne bloque pas la connexion. La conformité globale reste partielle : registres séparés, tentatives écrites existantes et annulation présentent des écarts à traiter seulement après autorisation explicite. Aucune correction n’a été réalisée.
