# Sécurisation de l’authentification NVA — Phase 5

## A. Analyse initiale

Analyse avant modification : package.json, .env.example, configuration, services, contrôleurs, schéma, audit, notifications, templates et tests Phase 1–4 examinés. Aucun Nodemailer, SMTP ou autre provider email n’est présent. Les notifications existantes stockent le contenu et peuvent préparer WhatsApp : elles ne doivent pas recevoir un lien de récupération secret. User.email est optionnel et unique ; téléphone et WhatsApp existent mais aucun champ de langue utilisateur. Les validations email existantes utilisent une adresse simple de 254 caractères maximum. PUBLIC_APP_URL existe pour le site ; APP_BASE_URL sera explicite pour les liens de récupération, sans recours au Host de la requête.

Décision : Nodemailer SMTP standard derrière un provider distinct ; service de livraison dédié ; templates HTML/texte FR (langue utilisateur inconnue), avec variante EN réutilisable. Aucune configuration réelle modifiée. L’émission Phase 4 sera factorisée sans modifier crypto, SHA-256, TTL ni les garanties de consommation. La relation unique token/demande sera conservée : un renvoi remplace le hash de la ligne, jamais le secret brut. Le helper de test Phase 4 conservera son interdiction de réémission.

Stratégie prévue : réserver une tentative sous verrou utilisateur/demande, émettre un token marqué livraison en attente et donc inutilisable, envoyer hors transaction, puis activer le token uniquement après acceptation SMTP et contrôles finaux. Échec : token invalidé, demande APPROVED, état FAILED. Tentatives concurrentes et renvois trop rapides refusés ; tentative interrompue récupérable après un délai borné. L’état SENT signifie acceptation par SMTP, pas preuve de réception en boîte mail.

## B. Architecture de livraison

POST ADMIN → `passwordResetDeliveryService.deliverApprovedResetRequest` → primitive d’émission Phase 4 → template → `emailDeliveryProvider` → SMTP. Le contrôleur ne connaît ni Nodemailer ni le secret. Le service accepte un canal mais refuse tout canal autre que EMAIL. Les enums préparent WHATSAPP/SMS sans leur ajouter d’intégration.

Trois étapes : réservation/émission transactionnelle, envoi hors transaction, finalisation transactionnelle. Aucun verrou PostgreSQL n’est conservé pendant l’attente SMTP. Le statut SENDING et son horodatage empêchent les opérations concurrentes sur le même utilisateur, y compris deux demandes distinctes. Une tentative est identifiée par `deliveryAttempts`, relu à la finalisation pour qu’un ancien worker ne puisse pas agir sur un retry plus récent.

## C. Fichiers modifiés

20 fichiers de production, configuration, tests et rapport :

- `.env.example`, `package.json`, `package-lock.json`.
- `prisma/schema.prisma` et `prisma/migrations/20260911090000_add_password_reset_delivery_tracking/migration.sql`.
- `src/services/passwordResetService.js`, `src/services/passwordResetRequestService.js`.
- Nouveaux : `src/services/passwordResetDeliveryService.js`, `src/services/emailDeliveryProvider.js`, `src/services/passwordResetEmailTemplate.js`, `src/utils/resetDeliveryConfig.js`.
- `src/controllers/adminPasswordResetRequestController.js`, `src/routes/adminPasswordResetRequestRoutes.js`, `src/middlewares/rateLimits.js`.
- `src/utils/passwordResetRequestMessages.js`, `views/admin/password-reset-requests/show.ejs`.
- `tests/authSecurityPhase3.test.js`, nouveaux `tests/authSecurityPhase5.test.js` et `tests/helpers/fakeEmailTransport.js`.
- `docs/auth-security-phase5.md`.

Les artefacts sous `tmp/auth-phase5-*` servent uniquement à la validation locale. Aucun ancien fichier de migration modifié. Les tests Phase 1/2/4 et leurs garanties restent conservés. Le test Phase 3 qui interdisait tout formulaire après approbation vérifie désormais précisément l’absence des actions approve/reject : la nouvelle action d’envoi est autorisée par cette phase.

## D. Configuration SMTP

**Nodemailer 10.0.3**, version exacte enregistrée dans package.json/lock. Installation sans scripts, sans deuxième bibliothèque email. Le premier téléchargement a été bloqué par les permissions réseau (EACCES) ; l’installation autorisée avec accès au registre npm a réussi. Aucun message email n’a été envoyé pour vérifier l’installation.

Variables ajoutées uniquement à `.env.example` : APP_BASE_URL, SMTP_HOST, SMTP_PORT (exemple 587), SMTP_SECURE (false), SMTP_USER, SMTP_PASSWORD et EMAIL_FROM. Les valeurs secrètes restent vides. EMAIL_FROM attend une seule adresse simple ; le nom d’affichage NVA est ajouté par le provider. Aucun changement à `.env` ou à une configuration VPS/production.

SMTP_SECURE=true utilise TLS direct ; false exige STARTTLS. Certificats vérifiés, TLS 1.2 minimum, debug/logger désactivés, accès aux fichiers et URL de contenu désactivés. Les limites de connexion, accueil et DNS sont dix secondes, d’inactivité vingt secondes, et l’opération comporte une échéance globale de trente secondes. Le transport est fermé après chaque tentative. Options fondées sur la [documentation SMTP Nodemailer](https://nodemailer.com/smtp) et les [options de sécurité des messages](https://nodemailer.com/message).

Le provider exige l’acceptation explicite de l’unique destinataire, sans destinataire rejeté. Il transforme toute exception en erreur métier statique : aucun message, stack ou réponse SMTP n’est propagé vers le logger ou ADMIN. Sans configuration, le reste de l’application reste disponible et l’action affiche « Service email non configuré. » sans émission de token. Un succès ne peut pas être simulé silencieusement en développement.

En NODE_ENV=test, le provider réel refuse toute création, même si NODE_ENV change après import. Le fake s’injecte uniquement via une fonction protégée par les garde-fous Phase 4 : base de test locale et environnement test. Il ne possède aucun accès réseau.

## E. Construction du lien

APP_BASE_URL est obligatoire et indépendante de PUBLIC_APP_URL ; aucun Host, X-Forwarded-Host ou paramètre du formulaire n’est utilisé. Le helper normalise le slash final et ajoute `/reset-password/` puis le token. L’URL ne contient ni userId, email, téléphone ni requestId.

La base doit être une origine HTTP(S) sans identifiants, query, fragment ni chemin supplémentaire. HTTPS est obligatoire ; HTTP n’est accepté qu’en mode non production vers localhost/127.0.0.1/::1. Les URL invalides sont refusées avant émission. Aucun domaine de livraison n’est codé en dur dans l’application.

## F. Gestion email utilisateur

Le destinataire provient exclusivement de User.email rechargé sous verrou. Le formulaire ne propose aucun champ d’adresse et le contrôleur ignore les champs email/to/channel injectés. La validation reprend le format simple et la longueur maximale de l’inscription, avec exclusion supplémentaire des listes, caractères de contrôle et syntaxes d’en-tête. Elle ne prouve pas que l’adresse appartient effectivement à l’utilisateur ; cette limite est explicitée en N.

Email absent ou invalide : demande conservée APPROVED, aucune tentative SMTP et aucun token créé. Le détail ADMIN affiche le problème et masque le bouton. Le parcours public forgot-password conserve strictement sa réponse générique pour compte absent, inactif, avec ou sans email.

Le compte doit rester actif et STUDENT/TEACHER, et `authVersionAtRequest` doit correspondre à authVersion. Les demandes historiques sans version et celles rendues obsolètes par un changement de mot de passe restent inexploitables. L’adresse et les autorisations sont revérifiées après SMTP avant activation ; si elles ont changé pendant l’envoi, le lien éventuellement reçu est invalidé.

## G. Émission du token

La primitive Phase 4 `issueToken` est factorisée : crypto.randomBytes(32), base64url, SHA-256 seul, TTL trente minutes, invalidation des autres tokens utilisateur. Le helper de test Phase 4 reste strictement test-only et n’autorise toujours pas une deuxième émission pour une demande.

La livraison vérifie en base l’ADMIN actif, sa version et l’absence de changement forcé, puis la demande APPROVED, le compte admissible, l’email et la configuration. Elle verrouille les comptes en ordre croissant puis la demande, selon les conventions existantes. Aucun token sur APPROVE ou forgot-password.

Le token de livraison porte `deliveryPending=true`. GET et POST reset le refusent tant que ce drapeau est présent. L’opération enregistre SENDING, EMAIL, l’heure de tentative et le compteur, puis remet le secret uniquement au provider en mémoire, intégré au lien. Après acceptation SMTP, une transaction revérifie demande/utilisateur/ADMIN/adresse/version, identité de la tentative et du token, expiration et durée du bail. Elle écrit SENT et deliveredAt puis active le token. Aucun mot de passe n’est changé à cette étape.

Le service retourne uniquement `{ requestId, channel: EMAIL, status: SENT }`. Le parcours de consommation Phase 4 reste atomique et à usage unique : mot de passe, authVersion, invalidation des tokens et COMPLETED/completedAt. Il vérifie aussi deliveryPending=false lors de la revendication atomique du token.

## H. Échec / retry

Une erreur SMTP ou l’absence d’acceptation explicite invalide immédiatement le token (`usedAt`) et enregistre FAILED, deliveredAt=null ; la demande reste APPROVED. Les contrôles métier refusés avant émission ne comptent pas comme tentative SMTP.

Le retry utilise la même ligne PasswordResetToken, unique par demande, en remplaçant son hash par celui d’un nouveau secret aléatoire. L’ancien secret ne peut plus résoudre de ligne. Aucune suppression de table, de contrainte ou de ligne historique par migration ; seul le token courant est conservé par demande. Les autres tokens de l’utilisateur sont invalidés. Un renvoi après SENT ou expiration suit la même règle.

Règles anti-spam : **30 secondes entre tentatives par utilisateur**, toutes demandes et tous ADMIN confondus, contrôlées en base sous verrou ; **20 POST par quinze minutes et par IP** avec le limiteur existant dédié à cette route. Les erreurs SMTP n’imposent pas de blocage permanent : retry possible après trente secondes. Le limiteur IP reste en mémoire par processus, comme les autres limiteurs du projet ; la sérialisation/cooldown métier est partagée via PostgreSQL.

Un SENDING a un bail de **deux minutes**. Pendant ce bail, aucun second envoi pour le même compte. Après interruption du processus ou échec de finalisation DB, le token reste deliveryPending et donc inutilisable, même si SMTP l’a accepté. Une nouvelle tentative après le bail invalide les anciens tokens et remet les SENDING obsolètes en FAILED. Aucun worker automatique ajouté. Le numéro de tentative protège contre une réponse tardive qui arriverait après cette reprise.

SMTP et PostgreSQL ne constituent pas une transaction distribuée. Un message peut être accepté puis la connexion échouer : il sera traité comme FAILED et son lien invalidé. Un message tardif peut donc arriver avec un lien inutilisable ; jamais avec une deuxième autorisation active produite sans contrôle. SENT signifie « accepté par le serveur SMTP », pas livraison en boîte de réception. En cas d’indisponibilité DB persistante, l’état visible peut rester SENDING jusqu’à reprise ; la sécurité repose alors sur deliveryPending.

## I. Interface ADMIN

Nouvelle route **POST /admin/password-reset-requests/:id/send**, montée derrière les mêmes validateSession/requireAdmin et CSRF que Phase 3. Le service revérifie les droits ADMIN en base avant émission et après SMTP. GET n’envoie jamais de message.

Le détail reprend les cartes existantes et ajoute Livraison : statut traduit, canal, tentatives et date d’envoi. Une demande APPROVED pour un compte actif admissible avec email valide affiche « Envoyer le lien de réinitialisation », puis « Réessayer l’envoi ». Aucun champ de destinataire. Confirmation native via data-admin-confirm existant. Un SENDING affiche le délai de reprise ; le serveur refuse le double clic pendant le bail.

Succès : redirection vers le détail avec un code de succès autorisé, message « Lien de réinitialisation envoyé. ». Aucun token, URL complète ou hash dans la page, JSON ou session. Les erreurs métier de livraison connues sont rendues dans le shell ADMIN avec les traductions FR/EN, y compris le cas SMTP non configuré ; les exceptions techniques du provider ne sont jamais affichées.

Le template email existe en HTML et texte simple, sans JavaScript, tracking pixel, pièce jointe ni ressource distante. Nom NVA, prénom échappé, bouton, validité/usage unique et signature « Learn. Speak. Succeed. ». FR par défaut car User ne possède pas de langue ; variante EN testée et prête pour une future préférence utilisateur. La langue de l’ADMIN ne décide pas de celle du destinataire.

## J. Logs / audit

Le logger/audit standard est réutilisé : PASSWORD_RESET_TOKEN_ISSUED, PASSWORD_RESET_DELIVERY_SENT et PASSWORD_RESET_DELIVERY_FAILED. Les deux événements de livraison portent adminId, requestId, userId, channel, result et le timestamp standard. Aucun email complet, token, tokenHash, lien, contenu d’email, mot de passe ou réponse SMTP.

Les exceptions provider sont volontairement abandonnées au profit d’un code contrôlé. Les références HTTP de reset conservent sanitizeUrl et les headers no-store/no-referrer. Aucun contenu de récupération transmis au service de notifications, qui persisterait des données inutiles.

L’audit garde la limite historique du logger après commit : une interruption peut laisser une mutation sans événement. Un ancien worker peut produire FAILED alors qu’une tentative plus récente est SENT ; le dernier état en base appartient au numéro de tentative courant et ne peut pas être écrasé par cet ancien worker.

## K. Tests

**60 cas Phase 5**, dont :

- Statuts interdits, comptes invalides/supprimés/obsolètes, absence/format email et injection de destinataire.
- STUDENT/TEACHER/anonyme, ADMIN désactivé/rétrogradé/révoqué, revérification sous verrou.
- POST autorisé, émission, liaison, hash seul, URL configurée, HTML/texte, FR/EN et échappement.
- SENT/date/canal/compteur, échec SMTP, absence d’acceptation, cooldown, retry et renvoi après succès.
- Double clic, deux demandes du même compte, token inexploitable pendant envoi, reprise après bail, réponse tardive.
- Email/activité/version/ADMIN modifiés pendant SMTP, panne de finalisation DB et reprise sûre.
- GET/POST via lien reçu, COMPLETED, authVersion, sessions, usage unique, expiration et renvoi.
- CSRF/GET, rate limiter, confidentialité des pages, JSON, logs, audit et sessions.
- Non-énumération publique, APPROVE sans émission, dashboard, configuration et interdiction du provider réel en test.
- Trois tests du provider lui-même avec module Nodemailer substitué, couvrant contrat sendMail, acceptation, rejet et exception sans aucun transport réel.

Le FakeEmailTransport conserve les messages uniquement en mémoire puis est nettoyé. Les tests du provider utilisent une évaluation isolée du module avec createTransport simulé : aucune connexion SMTP possible. Les régressions Phase 1–4 conservent leurs cas et assertions de sécurité.

## L. Résultats exacts

Premier passage ciblé : **218/218 réussites**, zéro échec, ignoré/annulé, code de sortie 0, **105 340,0506 ms**. Il comportait 57 cas Phase 5 et leur parent. Journal : `tmp/auth-phase5-focused.log`.

Relance ciblée finale après ajout des trois tests provider et amélioration de l’erreur ADMIN de configuration : **221/221 réussites**, zéro échec, ignoré/annulé, code de sortie 0, **113 928,3117 ms**. Elle inclut Phase 5 **60/60 cas** (61 avec parent), Phase 4 **60/60**, Phase 3 **39/39**, Phase 2 **19/19**, Phase 1 **19/19**, layout ADMIN, module étudiants ADMIN, CSRF et inscription/reset NVA. Journal : `tmp/auth-phase5-verification.log`.

Suite complète : **575/575 réussites**, **2 suites**, zéro échec, ignoré/annulé, code de sortie **0**, **347 909,6488 ms**. Journal : `tmp/auth-phase5-full.log`. Le total correspond aux 514 tests de référence Phase 4 plus les 61 tests Phase 5 (60 cas et leur parent). Aucun échec intermittent observé et aucune régression restante détectée ; les tests de sauvegarde et tous les parcours de rôles passent. Aucun correctif hors périmètre n’a été appliqué à ces modules.

Contrôles statiques : schéma Prisma valide, **152/152** templates EJS, **477/477** clés publiques FR/EN, **17/17** assets ; syntaxe valide des treize fichiers JavaScript modifiés/ajoutés. Le dictionnaire ADMIN est comparé dans les tests. L’API CommonJS Nodemailer createTransport est disponible.

Validation Edge locale avec transport fictif : **6/6** vues ADMIN à 1440/768/390 px, **2/2** vues email à 640/390 px sans débordement ; **2/2** confirmations (annulation/acceptation), **2/2** états erreur/email absent, zéro erreur JavaScript, zéro email réel. Le navigateur intégré a été déclaré indisponible et sa liste de navigateurs était vide ; Edge installé a servi au contrôle local. Captures finales inspectées sous `tmp/auth-phase5-ui/`, journaux `tmp/auth-phase5-ui.log`, `tmp/auth-phase5-ui-final.log` et `tmp/auth-phase5-ui-final2.log`. La prise de capture revient instantanément en haut après la vérification du bouton, avec assertion scrollY=0, afin d’éviter l’artefact de position de l’en-tête fixe lié au défilement animé dans les captures pleine page. La dernière relance conserve tous les résultats ci-dessus, code de sortie 0, sans modification du code applicatif.

Tous les processus applicatifs et tests utilisent isolatedEnvironment et le nom exact english_center_test. Suites Node avec --test-concurrency=1, sans reset. Fichiers privés isolés dans `tmp/auth-phase5-focused-private`, `tmp/auth-phase5-ui-private` et `tmp/auth-phase5-full-private`.

## M. Migration

**20260911090000_add_password_reset_delivery_tracking**. Deux enums (canal EMAIL/WHATSAPP/SMS ; état SENDING/SENT/FAILED), cinq champs Request (deliveryChannel, deliveryStatus, deliveryAttempts=0, deliveryAttemptedAt, deliveredAt) et un booléen Token deliveryPending=false. Aucun secret ni message technique stocké. Les valeurs par défaut préservent les tokens Phase 4 déjà émis et les demandes existantes.

Migration additive appliquée uniquement à **english_center_test** par prepare/isolatedEnvironment avec assertion du nom exact ; génération Prisma incluse. Le journal `tmp/auth-phase5-migration.log` confirme son application. Aucune ancienne migration modifiée, aucun reset/db push et aucune migration de la base principale, VPS ou production.

## N. Limitations

La livraison réelle nécessite que l’exploitant configure son SMTP et APP_BASE_URL. Aucun compte fournisseur ni domaine d’envoi n’a été configuré ici ; aucun SMTP réel testé ni email réel envoyé, pendant ou hors tests. Le code SMTP est implémenté mais sa délivrabilité réelle n’est pas certifiée sans cette configuration. SPF/DKIM/DMARC et les politiques du serveur restent à configurer par l’exploitant.

User.email est une adresse associée au compte, sans preuve de vérification préalable enregistrée dans le modèle actuel. Le service interdit sa substitution dans le formulaire d’envoi et contrôle les changements pendant SMTP ; il ne crée pas un système de vérification email. La gestion des coordonnées existante doit rester réservée aux parcours autorisés.

Le TTL de trente minutes commence à l’émission avant SMTP ; le temps restant à réception peut donc être légèrement inférieur. Le renvoi écrase l’ancien hash de la ligne unique : le suivi conserve le compteur et la dernière tentative, pas un historique détaillé de chaque token. L’audit conserve ses limites historiques décrites en J.

Pas de worker de reprise automatique, tracking de bounce, réémission sans demande APPROVED, ajout WhatsApp/SMS/OTP, ni livraison de récupération d’un compte ADMIN. Aucun déploiement VPS, configuration de production ou modification de la base principale locale. Une future mise en service nécessitera sa migration autorisée ; elle n’a pas été effectuée ici.

## O. Préparation Phase 6

Les canaux futurs pourront implémenter le même contrat provider `send(message) → accepted`, derrière le service coordonné et ses protections. Chaque nouveau canal devra définir le destinataire vérifié, les règles d’autorisation, les limites d’envoi, l’interprétation des réponses fournisseur et la confidentialité des erreurs. La cryptographie, le TTL et la consommation Phase 4 n’auront pas besoin d’être remplacés.

Une phase distincte pourra aussi concevoir la preuve de réception, les bounces, les alertes sur SENDING obsolètes et un historique d’audit durable. Aucun worker, transport WhatsApp/SMS, OTP, Twilio ou Meta ajouté maintenant.
