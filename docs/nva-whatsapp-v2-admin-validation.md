# Validation administrative des inscriptions WhatsApp NVA V2

Actualisation : l’[audit de préproduction](nva-whatsapp-v2-preproduction-audit.md) documente les corrections ultérieures de corrélation des codes e-mail, de journaux et de droits du worker, ainsi que le blocage du relais manuel en mode Meta. Ses résultats finaux et prérequis complètent ce rapport historique de validation administrative locale.

Date : **24 octobre 2026**, Africa/Kinshasa. **GO pour le circuit administratif testé en laboratoire ; NO-GO pour la production.** Aucun déploiement, accès Contabo, modification de configuration de production ou envoi WhatsApp/e-mail réel effectué. Aucun logiciel installé, aucune nouvelle migration.

## Architecture retenue et audit initial

Le circuit existant est conservé : `WhatsAppConversation` → `WhatsAppAdmissionRequest` → `WhatsAppAdmissionEvent` → service partagé `registrationService.createRegistrationInTransaction` → `User` STUDENT et `Enrollment`. La demande ne constitue ni une réservation de place ni une inscription. Aucune seconde base d’inscriptions ni table parallèle créée.

Les écrans et routes existaient déjà sous `/admin/whatsapp/admissions`. Ils permettent la recherche, le filtrage, la consultation, la correction d’identité, l’affectation et la conversion. Le tableau de bord et sa navigation sont réutilisés. Les préférences de formation/session/groupe sont issues des événements de consentement existants, et non de colonnes fictives. La liste affiche désormais les noms de formation et de session résolus, ou leur identifiant si l’objet n’existe plus.

L’authentification existante `validateSession` recharge le compte et contrôle son activité, son rôle et `authVersion`. `requireAdmin` réserve les écrans/actions aux administrateurs actifs ayant terminé le changement de mot de passe obligatoire. Les formulaires utilisent le middleware CSRF existant et les pages administratives sont `no-store`. Les services revérifient également l’acteur pour les décisions. `list/get` restent des méthodes internes protégées par les routes, pas des API publiques.

L’audit a confirmé une lacune : la collecte validait le **format** de l’e-mail, sans preuve d’accès à cette adresse. La conversion créait jusque-là un compte immédiatement. Cette lacune est corrigée pour le circuit WhatsApp : l’approbation exige une preuve e-mail liée à la demande et à ses coordonnées exactes.

## Fonctionnement effectivement implémenté

| Opération | Statut réel et effets |
| --- | --- |
| Consentement et confirmation du prospect | PENDING, consentement daté/versionné, message source unique, préférences et notification interne aux administrateurs ; aucun compte ni Enrollment |
| Prise en charge | PROCESSING et `assignedAdminId` ; un autre administrateur ne peut plus modifier/décider |
| Demande de complément | PROCESSING, événement `INFORMATION_REQUESTED`, motif obligatoire et brouillon ; aucune inscription |
| Refus | CANCELLED, administrateur responsable, motif obligatoire, événement CANCELLED et brouillon ; aucun compte ni Enrollment |
| Approbation | ENROLLED seulement après création/réutilisation réussie du compte et de l’Enrollment, `convertedById`, lien Enrollment et événement ENROLLED dans la même transaction |

Les statuts Prisma/SQL existants PENDING, PROCESSING, ENROLLED, CANCELLED sont conservés. Aucun statut REJECTED ou NEEDS_INFO incompatible ajouté : le motif et l’événement distinguent le refus et la demande de complément. Le prospect n’est jamais annoncé inscrit au stade PENDING/PROCESSING. Le statut de l’Enrollment reste celui calculé par les règles NVA, par exemple TRIAL_ACTIVE : l’approbation administrative n’implique pas un paiement intégral ni l’éligibilité au certificat.

### Vérification e-mail et comptes étudiants

L’administrateur déclenche l’envoi d’un code via le **prestataire e-mail existant**. Le prospect saisit le numéro de demande et le code sur `/whatsapp/admission-email`. Le code n’est placé ni dans une URL ni dans l’interface administrative.

- Code cryptographiquement aléatoire de 32 octets ; seule son empreinte SHA-256 est conservée dans un événement EMAIL_CHALLENGE.
- Expiration après 30 minutes ; dernier code émis uniquement ; consommation unique protégée par verrou SQL. Renvoi limité à une fois par minute pour la demande, avec les limiteurs HTTP existants.
- La preuve EMAIL_VERIFIED est liée au numéro de demande et à l’identité normalisée complète. Toute correction d’identité impose une nouvelle vérification. La preuve d’approbation expire après sept jours.
- Code incorrect, expiré, consommé, demande clôturée ou événement d’échec de livraison : refus de validation. La page publique ne révèle aucune coordonnée.
- L’indisponibilité SMTP bloque la vérification et donc l’inscription. Les erreurs de transport sont remplacées par un message générique.
- Aucun champ global `User.emailVerified` n’a été inventé : la preuve est propre à cette demande WhatsApp. Le parcours public historique est hors périmètre de cette modification.
- Si un compte existe au même téléphone, son e-mail doit correspondre exactement à l’adresse vérifiée ; aucune réaffectation d’adresse ou fusion automatique. L’activité, le rôle STUDENT, l’unicité e-mail, les sessions et les doublons restent contrôlés par le service partagé.
- Les mots de passe des nouveaux comptes sont aléatoires, hachés via le service existant et soumis au changement obligatoire. Le mot de passe d’un compte existant reste intact. Une vérification e-mail ne vaut pas une preuve d’identité civile ; l’administrateur reste responsable de ses contrôles de coordonnées avant confirmation.

Le modèle d’événements JSON existant suffit : aucune migration, aucun secret de production et aucun identifiant SMTP de test stocké dans Git. Les codes de test restent dans une boîte e-mail en mémoire ; aucun prestataire externe n’est appelé.

### Transactions et concurrence

La conversion conserve ses transactions Serializable, ses verrous de destinataire partagés, le verrou de ligne de la demande, les retries bornés et le service commun d’inscription. Les mises à jour administratives verrouillent également la demande et utilisent le contrôle de version existant (`updatedAt`/statut). Un conflit de sérialisation devient un message 409 demandant le rechargement.

Une double approbation est idempotente : le second appel retourne l’Enrollment existant. Une course approbation/refus produit une seule décision terminale. Deux prospects concurrents pour la dernière place ne peuvent pas créer deux inscriptions dans le scénario exécuté. L’annulation transactionnelle inclut compte, Enrollment, statut et événements de décision. Les CHECK, clés étrangères et index uniques installés restent actifs.

### Messages préparés et Meta

`confirmationDraft` prépare les messages correspondant aux quatre situations : demande reçue/en attente, informations nécessaires, refus motivé et inscription enregistrée après commit. Aucun de ces changements ne met automatiquement un message en file d’envoi WhatsApp.

Pour les inscriptions WhatsApp, l’écran de confirmation ne propose plus le lien `wa.me` qui plaçait les identifiants dans une URL. Le mot de passe temporaire reste visible uniquement dans l’écran administratif protégé, sans cache, pour remise sécurisée. Le brouillon WhatsApp ne contient pas de mot de passe.

Un envoi ultérieur doit passer par les contrôles existants de la conversation : réponse libre dans la fenêtre de service de 24 heures, ou modèle Meta approuvé hors fenêtre. Source officielle consultée le 24 octobre 2026 : [WhatsApp Business Messaging Policy, section 2](https://business.whatsapp.com/policy). Aucun modèle n’a été soumis ou approuvé dans cette intervention et aucune notification réelle n’a été envoyée.

## Laboratoire et tests réellement exécutés

Cible exclusive : **`127.0.0.1:58432/nva_whatsapp_v2_test`**, PostgreSQL 16.15. Le laboratoire était inaccessible au premier essai de cette mission ; il a été redémarré avec ses binaires portables existants. PostgreSQL a effectué sa récupération automatique après un arrêt non propre. Aucun PID/cluster étranger supprimé et aucune autre instance modifiée. Les tests ont ensuite réussi. Le port est en écoute lors du contrôle final ; aucun service Windows installé.

Le lanceur vérifie adresse, port, rôle, répertoire exact et absence de bases étrangères avant les écritures. Les 47 migrations restent appliquées, sans migration en attente. Les mots de passe des rôles de laboratoire sont renouvelés en mémoire. Les droits supplémentaires nécessaires à la confirmation administrative ont été explicitement accordés **dans ce seul laboratoire** : lecture paiements/cours/devoirs et mise à jour des rappels. Le rôle d’exécution reste sans CREATE de schéma, TRUNCATE, superutilisateur ou modification de l’historique Prisma.

La nouvelle suite utilise le vrai routeur administratif, les contrôleurs, les vues EJS, le middleware réel de validation de session, ADMIN, CSRF et Prisma. Une route de connexion réservée au serveur de test crée les sessions fictives ; elle n’est pas ajoutée à l’application. Seul le transport e-mail est remplacé par une boîte en mémoire. Les appels de service hors HTTP omettent les effets secondaires après commit pour cibler les transactions ; le parcours HTTP d’approbation appelle les services réels, avec des fixtures sans devoir ni cours programmé.

| Scénario PostgreSQL administratif | Résultat |
| --- | --- |
| Demande fictive consentie, PENDING, zéro inscription avant décision | Réussi |
| Liste/détail rendus pour un ADMIN, formation/session affichées, absence de cache | Réussi |
| Visiteur non connecté et STUDENT refusés ; POST sans CSRF refusé | Réussi |
| Vérification e-mail puis approbation par HTTP, compte haché, changement obligatoire, liens et audit après commit | Réussi |
| Double approbation et approbations concurrentes | Réussi, un seul Enrollment et un événement ENROLLED |
| Complément puis refus par HTTP, motif/acteur/statut conservés | Réussi |
| Approbation concurrente avec refus | Réussi, une seule décision terminale |
| Session annulée, capacité nulle ou échéance dépassée après dépôt | Réussi, demande PENDING et aucun compte créé |
| Échec de création du compte | Réussi, aucun Enrollment ni changement de statut |
| Échec forcé après création de compte et d’Enrollment dans la transaction | Réussi, rollback complet |
| Administrateur différent du responsable ou compte ADMIN désactivé | Refus confirmé |
| Session administrateur révoquée, version d’authentification périmée ou changement de mot de passe requis | Refus/redirection confirmés par middleware réel |
| Code incorrect, expiré, déjà utilisé ; coordonnées modifiées ; échec de livraison e-mail | Refus confirmé, aucune inscription |
| Compte étudiant existant vérifié et compte avec e-mail différent | Réutilisation sans modification du mot de passe ; refus de réaffectation d’e-mail |
| Deux prospects pour la dernière place | Réussi, une inscription au maximum |

Les données de chaque scénario sont nettoyées par leurs identifiants possédés, dans l’ordre des clés étrangères ; aucun reset ni TRUNCATE. Le contrôle final retrouve **zéro ligne dans les neuf tables métier inspectées**. Les tests précédents utilisent un rollback des fixtures. Les séquences SQL peuvent avoir avancé ; cela est normal pour ce laboratoire synthétique.

| Suite finale | Résultat | Preuve locale |
| --- | --- | --- |
| Release WhatsApp, dont deux nouveaux contrôles de sécurité | **412/412** | [journal](../output/nva-v2-admin-release.log) |
| Compléments fonctionnels, fiabilité et contrats | **80/80** | [journal](../output/nva-v2-admin-extra.log) |
| Intégration PostgreSQL existante | **7/7**, parent compris | [journal](../output/nva-whatsapp-v2-postgres-20261024/business-tests.log) |
| Nouvelle intégration administrative SQL/HTTP | **18/18**, un parent et 17 scénarios | [journal](../output/nva-whatsapp-v2-postgres-20261024/admin-tests.log) |
| Corpus conversationnel d’acceptation, inchangé | **207/216 = 95,83 %**, 16/16 critiques, 8/8 contextuels | [mesures](../output/nva-v2-admin-holdout.json) |
| Compilation des vues EJS | **164 vues OK** | `node scripts/validateEjs.js` |
| Syntaxe des services, contrôleur, route et application | OK | `node --check` |
| Droits et nettoyage final | OK | [inventaire](../output/nva-whatsapp-v2-postgres-20261024/final-checks.json) |

**Total : 492 tests isolés et 25 tests PostgreSQL réussis ; zéro échec, zéro test SQL ignoré dans les exécutions activées.** Le corpus n’est pas additionné à ces totaux. Les neuf erreurs non critiques de reconnaissance connues restent présentes ; aucun changement du classificateur.

Les premiers essais ont révélé des droits manquants du rôle de laboratoire sur les dépendances de l’écran de confirmation et des rappels : corrigés par des GRANT limités au laboratoire. Un test d’échec SMTP a d’abord rencontré le délai de renvoi de 60 secondes : son horloge a été ajustée, sans affaiblir le contrôle applicatif. Les résultats ci-dessus sont ceux des exécutions finales réussies.

## Fichiers créés ou modifiés

- Services : [whatsappAdmissionService.js](../src/services/whatsappAdmissionService.js), nouveau [whatsappAdmissionVerification.js](../src/services/whatsappAdmissionVerification.js).
- Contrôleur et routes : [adminWhatsAppAdmissionController.js](../src/controllers/adminWhatsAppAdmissionController.js), [adminWhatsAppRoutes.js](../src/routes/adminWhatsAppRoutes.js), nouvelle [route de vérification](../src/routes/whatsappAdmissionVerificationRoutes.js), montage dans [app.js](../src/app.js).
- Vues : [liste](../views/admin/whatsapp/admissions.ejs), [détail](../views/admin/whatsapp/admission.ejs), nouvelle [vérification publique](../views/auth/admission-email.ejs), [confirmation existante](../views/admin/students/enrollment-confirmation.ejs) avec traitement spécifique aux demandes WhatsApp.
- Tests et laboratoire : [suite administrative SQL/HTTP](../tests/whatsappV2Admin.integration.test.js), [tests isolés d’admission](../tests/whatsappAdmissions.test.js), [lanceur isolé](../scripts/runNvaV2PostgresLab.js).
- Documentation : ce rapport et actualisation du [rapport PostgreSQL](nva-whatsapp-v2-database-validation.md). Les preuves sous `output` restent hors Git.

## Reproduction et limites restantes

Avec le seul cluster dédié démarré, depuis la racine du projet :

```powershell
$env:NVA_V2_LAB_AUTHORIZED = 'local-new-synthetic-cluster'
node scripts/runNvaV2PostgresLab.js
Remove-Item Env:NVA_V2_LAB_AUTHORIZED
npm.cmd run test:whatsapp:release
node scripts/validateEjs.js
```

Le lanceur exécute successivement les deux suites SQL, sur une base sans fixtures préexistantes. Ne pas remplacer cette commande par un reset générique et ne pas fournir une URL de production. Les scripts de démarrage/arrêt du cluster sont décrits dans le rapport PostgreSQL. Sans les variables de laboratoire, les suites d’intégration restent volontairement ignorées.

**Prérequis avant déploiement contrôlé :** valider l’acheminement SMTP et la page publique de vérification dans un environnement de recette autorisé, avec des destinataires explicitement autorisés ; revoir la remise sécurisée du mot de passe et les accès administratifs ; valider les modèles/fenêtres Meta et le consentement à l’envoi ; arbitrer les divergences métier déjà signalées sur le seuil de paiement après dix séances, la portée de l’essai, les frais de certification et les horaires ; terminer les validations financières/certificat de bout en bout et la compatibilité de la cible/du worker.

Les tests vérifient une concurrence locale réelle à deux acteurs ; ils ne constituent pas un test de charge multi-worker. Les rappels sont appelés avec un catalogue fictif sans contenus à planifier : la livraison et l’exécution future des jobs restent hors validation. Les écrans ont été compilés et rendus dans les tests HTTP, sans recette visuelle navigateur. Aucune validation de la configuration de production, de ses données ou de sa délivrabilité e-mail n’est revendiquée.

**Décision : GO laboratoire pour le circuit administratif documenté ; NO-GO production tant que ces prérequis restent ouverts.**
