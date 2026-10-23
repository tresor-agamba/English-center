# Chatbot WhatsApp NVA — accueil et demandes d’inscription

Rapport du 22 octobre 2026. Travail local uniquement ; aucun déploiement, push GitHub, accès Contabo, appel Meta réel, envoi ou activation de worker. Aucun secret Meta/OpenAI modifié et aucune intervention NovanceTech.

## Résultat

Le moteur whatsappConversationEngine existant accueille, informe, invite à l’inscription puis propose le formulaire officiel ou une demande assistée. Le parcours assisté demande l’accord de collecte, recueille les coordonnées et exige une confirmation de transmission. La demande reste distincte d’une inscription officielle jusqu’à la confirmation administrative.

L’extension est désactivée par défaut en base (admissionsEnabled=false). L’activer dans la configuration du contenu ne change pas WHATSAPP_ENABLED ni WHATSAPP_WORKERS_ENABLED : ces deux flags restent false. Les scénarios enregistrés, leurs révisions et leurs UUID ne sont pas modifiés.

## Audit préalable et réutilisation

Voir [audit préalable](whatsapp-admissions-audit.md). La route publique réelle GET/POST /register est définie dans src/routes/registrationRoutes.js. Le lien fourni est exactement https://www.newvisionacademy.org/register ; il n’a pas été vérifié par une inscription réelle sur le site de production.

Le formulaire administratif utilise déjà registrationService. Le corps de sa transaction a été extrait en createRegistrationInTransaction(tx, data), et les effets après commit regroupés dans completeRegistrationSideEffects. Les contrôleurs publics existants continuent d’utiliser le même createRegistration/createStudentEnrollment ; leurs politiques de session, groupe, niveau, placement et paiement sont conservées.

La conversion d’une demande compose ce même corps métier avec la mise à jour de la demande et son audit dans une transaction Serializable. Un verrou de demande et les verrous destinataire existants protègent les clics concurrents. Une inscription déjà existante peut être associée sans prendre une nouvelle place, même si la session est devenue pleine ; aucune réactivation d’une inscription annulée n’est forcée. Un compte inactif est refusé. Les relances non engagées de la conversation sont annulées et celle-ci est liée au compte lorsque cela ne remplace pas un autre utilisateur déjà associé.

## Parcours réalisé

- Accueil NVA en ligne, mission et cours interactifs ; menu liste « Voir les options » à cinq entrées : Formations, Tarifs, Horaires, Inscriptions et Conseiller.
- Déclencheurs bonjour, bonsoir, salut, hello, menu et accueil. Lorsque l’extension est active, elle possède ces entrées communes. Les scénarios personnalisés restent accessibles via leurs autres déclencheurs et leurs identifiants inchangés. Un test couvre un scénario existant utilisé après le parcours d’admission.
- Formations et descriptions publiées ; prix réellement actifs par niveau lorsque la formation est structurée par niveaux, sans total automatique des trois niveaux ; séances/durée/fréquence calculées depuis les données disponibles.
- Horaires provenant des sessions ouvertes et des groupes non complets ; traduction Friday/Saturday en vendredi/samedi et des autres jours en français. Aucun ajout arbitraire des trois créneaux suggérés.
- Invitation partagée OUI/NON, réponses textuelles oui/non uniquement dans cette question active, puis En ligne/Par l’admin. Les UUID de présentation ne remplacent pas l’identifiant métier stable des options.
- Avant collecte : explication et bouton J’accepte. Nom et prénom, numéro WhatsApp prérempli et à confirmer, e-mail, niveau souhaité (Débutant/Intermédiaire/Avancé/Je ne sais pas).
- Récapitulatif et boutons CONFIRMER/MODIFIER ; commandes modifier, corriger, annuler et menu. Les salutations ne répètent pas la promotion pendant la collecte. La prise en charge humaine reste prioritaire ; la reprise retrouve le contexte en cours. STOP efface le brouillon du moteur et conserve le mécanisme de désinscription.
- Confirmation seule : création de la demande et notification IN_APP aux administrateurs, dans la transaction du message entrant. Aucun compte, inscription, consentement commercial ou envoi n’est créé par cette confirmation.

L’identifiant transmis aux clics comporte une clé stable de fonction et un jeton de présentation. Un clic ancien est refusé ; les numéros utilisent l’ordre des choix réellement affichés. Les messages Meta et les confirmations conservent la déduplication native existante.

## Réserves métier à ne pas masquer

1. Les 5 essais proviennent de accessLimits : LEGACY_STAGED autorise cinq séances, FULL_PAYMENT zéro. Le texte ne promet donc pas cinq essais pour une formation non éligible. L’accueil évoque les formations éligibles si au moins une formation publiée les autorise ; il ne garantit aucune place.
2. 60 USD n’est jamais écrit en dur comme source de vérité. Les tests vérifient 60 USD quand le catalogue le confirme et 75 USD lorsqu’il contient 75. Aucun prix réel de la base locale ou Contabo n’a été lu pendant cette intervention : aucun écart réel ne peut être affirmé. Contrôler les prix administratifs avant activation.
3. Les jours vendredi/samedi et les horaires 10h–11h30, 16h–17h30 et 18h–19h30 ne sont affichés que s’ils existent et sont disponibles. Une session sans ces créneaux n’est pas présentée autrement pour reproduire le texte demandé.
4. 16 séances, 1h30, deux séances/semaine et huit semaines sont affichés quand les règles/données consultées les justifient. Une information absente n’est pas inventée ; des créneaux hétérogènes ne donnent pas un résumé unique trompeur.
5. La collecte accepte un numéro international valide. Le système de comptes étudiants existant ne prend actuellement en charge que les mobiles congolais +243 éligibles à phone.util : une conversion avec un autre numéro est refusée clairement, sans créer de compte. Cette limitation n’a pas été contournée.
6. L’évaluation administrative doit choisir le niveau correspondant à la session ; « Je ne sais pas » n’est jamais converti automatiquement en niveau définitif par OpenAI.

Les introductions et questions sont modifiables. Les textes configurables refusent les chiffres hors « 100 % », devises, jours et essais explicites qui doivent provenir des champs calculés. Le marqueur {{trialOffer}} est obligatoire dans la promotion. Les contenus restent à relire par un administrateur ; ils ne modifient jamais les prix ou les règles du catalogue.

## Dashboard et routes

Toutes les routes ci-dessous sont derrière requireAdmin et la protection CSRF globale. Les réponses contenant les données des prospects utilisent Cache-Control:no-store.

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | /admin/whatsapp/admissions | Liste paginée (50), recherche nom/e-mail/numéro, statut et tri date. |
| GET | /admin/whatsapp/admissions/:id | Coordonnées, consentement, source, responsable, historique, compte existant et formulaire prérempli. |
| POST | /admin/whatsapp/admissions/:id/update | Prise en charge, correction ou annulation avec audit de l’administrateur. |
| POST | /admin/whatsapp/admissions/:id/convert | Confirmation humaine et conversion transactionnelle/idempotente. |
| GET/POST | /admin/whatsapp/admissions/content | Activation locale du parcours et édition des contenus. |
| GET/POST | /admin/whatsapp/admissions/simulator | Simulation cliquable et saisie textuelle, sans effets métier. |

La liste affiche nom, WhatsApp, e-mail, niveau, date Kinshasa, source, statut et administrateur responsable. Les statuts sont En attente, En cours de traitement, Inscrit et Annulé. La conversation d’origine reste accessible depuis la demande.

Le formulaire « Inscrire cet étudiant » recherche les comptes par téléphone ou e-mail, affiche les correspondances à l’administrateur et propose jusqu’à 100 sessions réellement ouvertes, avec les groupes disponibles. Un e-mail déjà attribué à un autre numéro bloque l’opération : aucune fusion automatique de comptes. La session, ses capacités et les droits de l’administrateur sont revérifiés dans la transaction. Les coordonnées peuvent être corrigées avant la confirmation.

Les doubles clics sur la même demande renvoient l’inscription déjà associée. Des demandes distinctes pour le même étudiant/session peuvent réutiliser l’inscription existante. Une erreur lors de l’inscription, de la mise à jour de la demande ou de son audit annule l’ensemble : la demande n’est pas faussement marquée « Inscrit ».

Pour un nouveau compte, la confirmation administrative existante affiche une fois le mot de passe temporaire et exige son changement ; il ne figure ni dans le message WhatsApp préparé ni dans les événements d’audit. La confirmation destinée à l’étudiant reste un brouillon sur la demande. Aucun message WhatsApp n’est mis en file ou envoyé par cette conversion ; les rappels existants sont synchronisés après commit, sous leurs règles habituelles.

## Données et sécurité

La saisie partielle est conservée dans l’état JSON de la conversation pour la reprise, après l’accord de collecte. Sa validité est de 24 heures ; une nouvelle activité purge un brouillon expiré. Annuler/menu effacent la saisie du parcours, STOP l’efface également. Ce délai ne constitue pas une purge physique de tous les messages entrants ou des sessions : leur rétention suit le système existant et doit être fixée avant exploitation.

La demande est créée uniquement au clic final CONFIRMER. Une demande encore ouverte dans la même conversation est actualisée après une nouvelle confirmation, avec audit, plutôt que doublonnée. La contrainte SQL partielle autorise une seule demande ouverte par conversation. Les historiques d’actions ne recopient pas les coordonnées : ils gardent l’acteur, l’heure, le type d’action et des métadonnées minimales.

La notification interne ne contient ni téléphone ni e-mail. Aucune donnée de collecte n’est transmise à OpenAI dans ce parcours et OpenAI ne peut appeler aucune opération de conversion. Le simulateur conserve des données fictives dans la seule session administrateur et affiche l’action ADMISSION_REQUEST comme simulée sans l’exécuter.

## Migration additive

prisma/migrations/20261022120000_add_whatsapp_admission_requests/migration.sql :

- Deux colonnes sur WhatsAppChatbotSettings : admissionsEnabled=false et admissionContent JSON facultatif.
- WhatsAppAdmissionRequest et WhatsAppAdmissionEvent, leurs index, clés étrangères et contraintes.
- Unicité du message source et unicité partielle d’une demande ouverte par conversation.
- Cohérence SQL entre le statut ENROLLED et la présence de enrollmentId.
- BEGIN/COMMIT explicites pour cette nouvelle migration. Aucun DROP/DELETE/TRUNCATE, aucune suppression ou réécriture de scénario, conversation ou inscription.

Le client Prisma a été généré et le schéma validé ; aucune migration n’a été appliquée à une base existante. L’installation PostgreSQL locale vérifiée ne fournit toujours pas postgres.bki à l’emplacement attendu. La preuve SQL réelle, la restauration et la vérification des droits restent donc manuelles.

Les clés étrangères RESTRICT préservent les demandes : la suppression ultérieure d’une conversation ou inscription référencée peut être refusée. Prévoir une politique d’archivage/rétention plutôt qu’une suppression de données pendant le déploiement. Le rôle d’application doit avoir les droits minimaux sur les deux tables/séquences et les nouvelles colonnes ; le rôle de réception Meta doit rester sans accès métier.

## Fichiers créés et modifiés pour cette extension

Créés :

- docs/whatsapp-admissions-audit.md et docs/whatsapp-admissions-implementation.md.
- src/services/whatsappAdmissionJourney.js et src/services/whatsappAdmissionService.js.
- src/controllers/adminWhatsAppAdmissionController.js.
- views/admin/whatsapp/admissions.ejs, admission.ejs, admission-content.ejs et admission-simulator.ejs.
- tests/whatsappAdmissions.test.js et scripts/previewWhatsAppAdmissions.js.
- prisma/migrations/20261022120000_add_whatsapp_admission_requests/migration.sql.

Modifiés :

- prisma/schema.prisma : modèles, relations et paramètres additifs.
- src/services/registrationService.js : composition transactionnelle et effets partagés, liste des sessions disponibles, refus des comptes inactifs, réutilisation explicite d’inscriptions existantes uniquement pour cette conversion.
- src/services/whatsappConversationEngine.js et whatsappConversationService.js : état du parcours, priorité après sécurité et persistance de l’action confirmée dans la transaction entrante.
- src/routes/adminWhatsAppRoutes.js et views/admin/whatsapp/_chatbot-nav.ejs : routes/navigation.
- public/css/admin.css : styles limités aux pages des demandes.
- tests/whatsappHumanHttp.test.js, whatsappConversationPersistence.test.js et whatsappDeploymentPreparation.test.js.
- package.json : commandes de test ; aucune dépendance ajoutée.
- scripts/auditWhatsAppRelease.js : nouvelle migration incluse dans l’ensemble autorisé.
- deploy/whatsapp-chatbot/01-readonly-audit.sql et 02-optional-module-grants.sql : objets et droits de l’extension.
- docs/whatsapp-production-operator-runbook.md et whatsapp-production-readiness-report.md : actualisation et indication de version historique.
- output/whatsapp-readiness/release-manifest.json : ancien candidat du 20 octobre signalé comme dépassé pour ce périmètre.

Captures et journaux locaux : output/whatsapp-admissions/.

## Tests et simulation

Suite complète locale isolée : **367 tests réussis**, zéro échec, ignoré ou annulé. Schéma Prisma valide et **163 vues EJS** compilées. Trois vues (liste/détail/contenus) rendues avec des données fictives dans Edge à 390 et 1440 pixels, sans débordement ; confirmation administrative non cochée par défaut.

```powershell
npm run test:whatsapp:admissions
npm run test:whatsapp:release
node scripts/previewWhatsAppAdmissions.js
node node_modules/prisma/build/index.js validate
node scripts/validateEjs.js
```

Les tests bloquent Prisma réel, pg et fetch global. Ils couvrent l’accueil et les cinq options, les jours français, les tarifs 60/75 USD et l’absence de total global, l’éligibilité des essais, les boutons et numéros, le lien /register, consentement/collecte/validation/correction, absence de persistance avant confirmation, abandon/reprise, création idempotente et notification interne, dashboard et permissions, CSRF, conversion avec le véritable corps métier, réutilisation de compte et d’inscription, concurrence, session fermée, compte inactif, rollback, transfert humain, non-envoi et scénarios antérieurs. Le test HTTP du simulateur va jusqu’à la confirmation sans créer de demande ou d’inscription réelle.

Sur une base locale isolée après application de la migration :

1. Se connecter avec un ADMIN actif ; ouvrir /admin/whatsapp/admissions/content et relire les contenus. Garder le parcours désactivé hors simulation tant que le catalogue n’est pas vérifié.
2. Ouvrir /admin/whatsapp/admissions/simulator et cliquer Recommencer. Le simulateur fonctionne même lorsque le parcours est désactivé.
3. Cliquer Formations, Tarifs ou Horaires puis OUI ; essayer En ligne et vérifier /register.
4. Recommencer, choisir Inscriptions → OUI → Par l’admin → J’accepte. Saisir uniquement des coordonnées fictives, confirmer le numéro, l’e-mail et le niveau, utiliser MODIFIER puis CONFIRMER.
5. Vérifier l’action simulée ADMISSION_REQUEST. La liste réelle des demandes ne doit pas changer.
6. Tester NON, annuler, menu, STOP, conseiller et reprendre bot ; tester un ancien bouton et un oui isolé hors contexte.
7. Pour une preuve d’écriture SQL, utiliser exclusivement une base de test dédiée et un message synthétique traité par le service de conversation, jamais le webhook de production. Vérifier demande, notification, audit et rollback avant un essai de conversion avec une session de test ouverte.

## Préparation Contabo, sans exécution

Le [runbook opérateur actualisé](whatsapp-production-operator-runbook.md) contient les commandes de sauvegarde, transfert, installation, audit, répétition sur restauration, application, redémarrage ciblé et retour arrière. Il inclut maintenant les trois migrations du module ; l’archive préparée le 20 octobre ne contient pas cette extension et doit être reconstruite depuis le code courant après revue.

Avant toute application : vérifier l’historique distant et les checksums avec auditWhatsAppRelease.js, approuver uniquement les migrations réellement en attente, restaurer la sauvegarde sur une cible isolée, tester la conversion et les contraintes SQL, vérifier les ACL/triggers et exécuter bash -n sur Linux. Ne pas employer migrate dev/reset, db push, seed ou un diff global du schéma pour compléter le VPS.

Un nouveau candidat local est préparé dans output/whatsapp-admissions/nva-admissions-candidate-20261022.tar.gz, avec son empreinte SHA-256 et son manifeste. Il exclut .env, node_modules, storage et les journaux ; il reste à revoir par rapport à la release Contabo et ne vaut pas autorisation de déployer.

Le nouveau paramètre n’utilise aucune variable d’environnement supplémentaire. admissionsEnabled est activé explicitement depuis le dashboard une fois les sources contrôlées. WHATSAPP_ENABLED=false, WHATSAPP_WORKERS_ENABLED=false et les paramètres Meta/secrets ne changent pas. Le runtime Meta reste réception seule, comme lors de la phase précédente ; une activation réelle du traitement/envoi est une intervention distincte.

Retour arrière : remettre l’ancien code et son client Prisma, garder les flags false et conserver tables/colonnes et données additives. Ne pas supprimer les demandes ni restaurer un dump par-dessus la production sans une procédure et une autorisation distinctes.

Restent à vérifier : données réelles des tarifs, politique des essais, horaires et disponibilité ; SQL et droits sur PostgreSQL réel ; notifications réellement visibles dans une session NVA connectée ; création d’un compte/inscription sur base isolée et remise de ses accès ; politique de rétention des brouillons/messages ; compatibilité Linux et état actuel du VPS. Aucune intégration Meta en production n’a été testée.


## Complément 19 — Communication sur les formations certifiantes

L’accueil présente les formations d’anglais pratiques, 100 % en ligne et certifiantes. Les réponses Formations, Tarifs et Inscriptions portent la mention « Formation certifiante ». Un certificat NVA peut être délivré à l’issue de la formation, conformément aux conditions de certification définies par l’académie ; sa délivrance n’est pas automatique. Aucune accréditation ni certification internationale n’est annoncée.

Les trois nouveaux textes sont administrables dans Accueil et inscription WhatsApp. Les contenus personnalisés déjà enregistrés restent conservés ; les nouvelles mentions utilisent leurs valeurs par défaut en attendant une personnalisation. La précision complète est mémorisée dans l’état du parcours pour éviter sa répétition à chaque rubrique. Les données catalogue, les cinq séances d’essai sur les formations éligibles, les identifiants interactifs et les scénarios restent inchangés. Le budget du message interactif réserve la place aux conditions, à la promotion et à l’invitation. Aucune migration supplémentaire.

Validation locale : 369 tests WhatsApp réussis et 163 modèles EJS compilés. Aucun déploiement, envoi WhatsApp ou worker activé. Les vérifications Contabo déjà listées restent à effectuer. L’archive candidate du 22 octobre préparée avant ce complément est désormais dépassée : reconstruire une archive depuis le code revu avant transfert.


## Précision obligatoire — Certification après la formation complète

La communication ajoute désormais une règle fixe dans les réponses Formations, Tarifs et Inscriptions : formation complète de trois niveaux, soit 48 séances ; certificat NVA uniquement après les trois niveaux, sous réserve des conditions de certification ; aucun certificat après un seul niveau. Formations présente Niveau 1 → Niveau 2 → Niveau 3, à raison de 16 séances par niveau. Cette règle est indépendante des textes personnalisés enregistrés et reste présente lors des visites suivantes ; seule l’explication complémentaire est dédupliquée. Le dashboard explique cette contrainte.

Les tarifs continuent de provenir du catalogue : le cas NVA à 60 USD par niveau et l’offre de cinq séances d’essai gratuites sont vérifiés par les tests. Aucun prix catalogue ni aucune règle de délivrance des certificats dans l’application n’ont été modifiés. Aucun changement de scénario, identifiant, migration, envoi ou activation de worker.

Validation locale : 371 tests WhatsApp réussis, dont les nouveaux contrôles sur les trois niveaux, 48 séances, condition de certification, absence de certificat après un seul niveau, tarif et essais, contenus personnalisés et messages longs ; 163 modèles EJS compilés. L’archive antérieure reste dépassée et doit être reconstruite avant tout transfert autorisé.


## Validation PostgreSQL réelle — 23 octobre 2026

La validation a maintenant été exécutée sur deux bases neuves dans un cluster PostgreSQL 16.15 local isolé. Après corrections de concurrence (P2010/SQLSTATE 40001) et de communication (essais inclus et minimum calculé), 27 contrôles métier/dashboard et 8 contrôles Meta durables réussissent, ainsi que 372 tests locaux et 163 compilations EJS. Les règles de paiement/blocage/certificats restent inchangées.

Voir le [rapport complet du 23 octobre](whatsapp-postgres-validation-20261023.md) pour les preuves, le SQL Meta appliqué séparément des 47 migrations, les écarts de schéma restants et les prérequis de déploiement. Le laboratoire a été arrêté. Aucun envoi, worker, accès de production, déploiement ou push effectué. L’archive antérieure est dépassée.
