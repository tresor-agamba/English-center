# Sécurisation de l’authentification NVA — Phase 6

## A. Résumé exécutif

**PHASE 6 TERMINÉE — validation locale réussie.** Phase de consolidation du workflow existant, sans nouveau canal ni architecture. Les fichiers Phase 6 et un rapport provisoire étaient déjà présents à la reprise du 11 septembre 2026 ; ils ont été relus, corrigés et complétés. Les résultats historiques des Phases 1–5 ne sont pas présentés comme des validations de ces changements.

Renforcements : expiration lazy des demandes, confidentialité du HTML de récupération et des erreurs de parsing, destinataire ADMIN masqué, statuts et messages FR/EN, audit de création corrélé à la demande, refus des liens invalides avant bcrypt, minimum Unicode correctement compté. Aucun SMTP réel configuré ou utilisé, aucune migration créée ou appliquée, aucun déploiement ni accès d’écriture à `english_center` principal. Seule `english_center_test` sert aux fixtures.

24 fichiers Phase 6, y compris travaux provisoires repris :

- Services : `src/services/passwordResetRequestPolicy.js` (nouveau), `passwordResetRequestService.js`, `passwordResetService.js`, `passwordResetDeliveryService.js`, `passwordService.js`, `passwordResetEmailTemplate.js`.
- Contrôleurs : `src/controllers/authController.js`, `adminPasswordResetRequestController.js`.
- Utilitaires : `src/utils/maskResetEmail.js` (nouveau), `passwordResetRequestMessages.js`.
- HTTP : `src/app.js`, `src/middlewares/errorHandler.js`.
- Interface : `views/auth/reset-password.ejs`, `views/admin/password-reset-requests/index.ejs`, `views/admin/password-reset-requests/show.ejs`, `public/js/i18n.js`.
- Configuration et validation : `.env.example`, `scripts/validatePublicI18n.js`.
- Tests : `tests/authSecurityPhase6.test.js` (nouveau), `tests/authSecurityPhase1.test.js`, `tests/authSecurityPhase2.test.js`, `tests/authSecurityPhase3.test.js`, `tests/csrfProtection.test.js`.
- Rapport : `docs/auth-security-phase6.md`.

Les scripts, journaux et captures `tmp/auth-phase6-*`, `tmp/run-phase6*.cjs` et `tmp/verify-phase6-schema.cjs` sont des artefacts locaux de validation. Package, lockfile et schéma ne nécessitent aucun changement Phase 6.

## B. Audit du workflow

Carte établie dans le rapport provisoire avant modification :

```text
FORGOT → PENDING → APPROVED → DELIVERY/SENDING
                                  ↓
                  token émis, deliveryPending=true
                                  ↓
                    SMTP accepte + contrôles DB
                                  ↓
                   SENT, deliveryPending=false
                                  ↓
                    GET lien → POST nouveau mot de passe
                                  ↓
                         COMPLETED + completedAt
                                  ↓
                  authVersion++ → anciennes sessions refusées
```

L’émission technique précède SMTP ; le token n’est consommable qu’après activation. Échec SMTP/finalisation : invalidation du token, demande non complétée, retry encadré. APPROVE seul et forgot-password n’émettent aucun token. `requestReset` historique délègue à la création PENDING. Les tokens historiques sans requestId et demandes sans version connue sont refusés. Le helper d’émission des tests est inaccessible hors environnement/base de test vérifiés ; aucune route ne l’expose.

Ont été examinés : rapports 1–5, modèles et migrations, services password/request/reset/delivery/provider, contrôleurs et routes, montage requireAdmin, validateSession, logger/sanitizeUrl/errorHandler, headers Helmet/CSRF, templates publics/ADMIN, traductions, configuration, index et tests des phases précédentes.

Incohérences initiales : âge des demandes illimité, token recopié dans l’attribut action, email intégral sur le détail ADMIN, confirmation/politique peu explicites. À la reprise, des tests provisoires attendaient encore un ancien texte/langue ou construisaient une approbation sans date ; une fixture SMTP écrasait son email avec undefined. Compléments d’audit : erreurs de parsing susceptibles de reprendre le corps reçu, headers confidentiels placés après les parsers/session, ID métier absent de l’audit de création, minimum fondé sur unités UTF-16.

Le reset manuel ADMIN reste distinct : ADMIN attribue un mot de passe temporaire, `mustChangePassword=true`, `authVersion++`, révocation des tokens. L’étudiant doit ensuite changer ce mot de passe. La récupération par email laisse l’étudiant choisir son secret et termine avec `mustChangePassword=false`. La version capturée à la demande empêche une ancienne récupération de contourner un reset manuel plus récent.

## C. Anti-abus

Le rate limiter existant est conservé, sans Redis :

| Action | Quota | Clé / périmètre |
| --- | --- | --- |
| POST forgot-password, reset-password, change-password | 10 requêtes / 60 minutes | IP, compteur partagé entre ces routes via `limits.passwordReset` |
| POST ADMIN send | 20 requêtes / 15 minutes | IP, `limits.passwordResetDelivery` |
| Tentatives email, tous ADMIN et demandes confondus pour un compte | 30 secondes minimum entre tentatives | userId + deliveryAttemptedAt, contrôle PostgreSQL |
| Envoi déjà réservé | Bail de 120 secondes | SENDING du même userId, contrôle PostgreSQL |

Le quota public est consommé indépendamment du compte trouvé, actif, absent ou de l’identifiant invalide ; les quatre cas sont exercés jusqu’à la onzième requête (429). CSRF intervient avant les contrôleurs/limiteurs : une requête sans CSRF est refusée sans recherche de compte. Réponses métier publiques identiques, sans identifiant réaffiché. Déduplication PENDING sous verrou utilisateur, y compris appels simultanés. Aucun token pour une demande publique.

Après échec SMTP, retry possible après 30 secondes ; un succès ne dispense pas de ce délai. Un double clic pendant l’envoi est refusé et un worker interrompu peut être repris après deux minutes. Le numéro de tentative empêche un ancien worker d’écraser une tentative récente. Refus d’un lien inexploitable avant le calcul bcrypt, puis nouvelle vérification sous verrou.

Limites : compteurs HTTP en mémoire par processus, remis à zéro au redémarrage, non partagés entre workers PM2 ; IP partagée/NAT pénalise plusieurs utilisateurs ; attaques distribuées non éliminées. IPv6 bénéficie du regroupement /56 par défaut de la bibliothèque installée. TRUST_PROXY doit correspondre exactement au reverse proxy réel, avec port applicatif non exposé directement. Le cooldown PostgreSQL reste partagé entre processus. La réponse générique n’est pas une promesse de temps constant ; pas de test statistique de canal temporel ni de protection DDoS distribuée ajoutée.

## D. Expiration et transitions

`passwordResetRequestPolicy.js` centralise les durées :

- PENDING : **7 jours depuis requestedAt**. Une semaine permet la revue humaine, week-end compris, sans conserver indéfiniment une demande.
- APPROVED : **24 heures depuis reviewedAt**. Une journée laisse le temps d’envoyer et de corriger SMTP, mais limite l’utilisation d’une ancienne autorisation.
- Token : **30 minutes depuis l’émission**, inchangé. L’échéance de la demande reste prioritaire si elle arrive avant celle du token.

Ces durées sont une décision opérationnelle explicitement motivée pour cette phase, pas une norme externe ni un SLA de livraison. Elles sont à présenter aux responsables NVA avant mise en service.

Expiration lazy lors de liste/détail, création pour le compte concerné, décision, émission et vérification/consommation du lien. Une APPROVED sans reviewedAt est également inexploitable. À l’échéance exacte, refus ; bornes ±1 ms testées. Les requêtes conditionnelles ne remplacent pas un statut terminal concurrent. Les contrôles d’éligibilité restent répétés après acquisition des verrous et après SMTP. L’expiration est persistée séparément avant les actions qui peuvent échouer ; si une échéance est franchie pendant l’action, l’éligibilité refuse immédiatement et la prochaine lecture synchronise le statut.

| Départ | Destination | Condition |
| --- | --- | --- |
| PENDING | APPROVED | ADMIN autorisé, demande non expirée, compte admissible |
| PENDING | REJECTED | ADMIN autorisé, demande non expirée |
| PENDING | EXPIRED | requestedAt + 7 jours atteint |
| APPROVED | EXPIRED | reviewedAt + 24 h atteint, ou date de décision absente |
| APPROVED | COMPLETED | Consommation valide et atomique du token |
| REJECTED / COMPLETED / EXPIRED / CANCELLED | Aucune | États terminaux |

Aucune route ne crée CANCELLED. La livraison change son propre état SENDING/SENT/FAILED, jamais la décision. Un token expiré après 30 minutes ne clôt pas automatiquement une approbation encore valable : l’ADMIN peut renvoyer pendant les 24 heures. Une ancienne PENDING expirée n’empêche pas une demande neuve. Pas de cron, purge d’historique ou nouvelle colonne.

## E. UX publique

Forgot-password conserve le message générique FR/EN : « Si un compte admissible correspond à ces informations, votre demande de récupération a été enregistrée. » Identifiant absent/inactif/invalide : même message, sans révélation du compte, email, rôle ou état ADMIN.

Reset : labels Nouveau mot de passe / Confirmer le nouveau mot de passe, minimum dix caractères et maximum 72 octets UTF-8, autocomplete=new-password, labels reliés, description de politique, erreurs accessibles et focus. La politique serveur reste exclusivement dans passwordService ; le minimum compte désormais les points de code Unicode, pas les unités UTF-16 (cinq emoji ne font pas dix caractères). La limite bcrypt est toujours mesurée en octets UTF-8. La comparaison login conserve les anciens mots de passe.

Le formulaire POST sans attribut action soumet à l’URL courante sans recopier le token dans le HTML. Aucun token/userId/requestId visible dans le formulaire. Le jeton CSRF est distinct et nécessaire. Un lien expiré, utilisé ou inconnu produit le même message « Ce lien est invalide ou expiré. », sans formulaire de saisie ; GET, rechargement et POST après expiration sont testés. Le token reste nécessaire dans l’URL du navigateur et le lien email : son absence du HTML n’efface pas l’historique navigateur.

Traductions reset ajoutées au dictionnaire public et validateur ; rendu serveur FR/EN et bascule client testés. Pas de JavaScript supplémentaire lourd. Après succès, confirmation et lien connexion.

## F. UX ADMIN et guide NVA

Liste et détail distinguent APPROVED sans envoi et lien envoyé. PENDING indique l’attente d’une décision ; COMPLETED indique une réinitialisation terminée. Dates de demande/décision/finalisation, reviewer, livraison, tentatives et dernier envoi sont présents. L’adresse est affichée via maskResetEmail, par exemple `ag***@gmail.com` ; une adresse invalide n’est pas recopiée. Aucun token/hash/lien complet n’est rendu dans les pages ADMIN.

Les erreurs métier restent précises et non sensibles : service email non configuré, email absent/invalide, demande déjà traitée ou inéligible, délai entre tentatives, envoi en cours. Les détails SMTP ne parviennent pas au contrôleur. Les boutons ne sont qu’une aide ; les autorisations et transitions sont vérifiées côté serveur.

Guide ADMIN :

1. L’étudiant soumet sa demande depuis Mot de passe oublié.
2. Vérifier son identité et les coordonnées du compte selon les procédures NVA.
3. Approuver la demande justifiée, sinon la rejeter.
4. Cliquer sur Envoyer le lien de réinitialisation.
5. L’étudiant reçoit l’email et ouvre le lien, valable au maximum 30 minutes.
6. Il choisit et confirme son nouveau mot de passe ; la demande devient terminée et ses anciennes sessions sont invalidées.

**Ne jamais demander le mot de passe de l’étudiant.** Après échec SMTP, corriger la configuration puis réessayer après le délai indiqué ; après expiration de la demande, demander une nouvelle soumission. SENT signifie acceptation SMTP, pas preuve de réception en boîte mail.

## G. Sécurité HTTP

Helmet existant conservé : CSP, frameAncestors/objectSrc restrictifs, suppression X-Powered-By ; pas d’introduction globale supplémentaire. No-store et no-referrer sur forgot/reset/change-password sont maintenant posés avant les parsers et le middleware session, donc également sur erreurs techniques/CSRF/429. Le routeur ADMIN conserve ses headers privés. Les parsers gardent leurs limites existantes.

CSRF et sessions HttpOnly/SameSite, cookie Secure en production, validateSession et rôles conservés. Le service worker exclut les pages d’authentification. HSTS reste volontairement désactivé dans Express et doit être traité lors de la validation HTTPS Nginx ; CSP globale conserve les unsafe-inline historiques. Aucune configuration serveur en production modifiée.

## H. Logs

Audit des usages console/logger/JSON.stringify/req.originalUrl/req.url. Les chemins de récupération passent par sanitizeUrl dans requestContext, errorHandler et le logger ; encodages simples/doubles testés. Les champs password/passwordHash/token/SMTP_PASSWORD/sessionSecret/cookie/Authorization sont supprimés ou masqués. Aucun corps de formulaire n’est journalisé par les routes de récupération.

Correction complémentaire du gestionnaire d’erreurs : les erreurs de parsing, taille et nombre de paramètres utilisent le code statique INVALID_REQUEST_BODY, sans message du parseur ni corps reçu. Le navigateur obtient une erreur générique. Les tests injectent un marqueur secret dans un JSON malformé et vérifient son absence du HTML et des logs réels.

Les exceptions du provider SMTP sont abandonnées et remplacées par un code métier fixe, même si elles contiennent credentials ou contenu email. Tests de logs réels, audits et fixtures SMTP sans token, mot de passe ou secret SMTP. Les logs applicatifs de récupération sont couverts ; les anciennes consoles de modules notifications/WhatsApp non utilisés par ce workflow ne sont pas refactorisées.

**Point pré-déploiement :** le modèle `deploy/nginx/nva.conf.example` ne définit pas de masquage des access/error logs. Des logs Nginx par défaut peuvent enregistrer l’URL complète. Définir et vérifier leur politique de confidentialité, y compris erreurs upstream et outils d’observabilité, avant exposition des liens réels. Le masquage Express ne protège pas les logs du proxy. Aucun proxy n’a été configuré dans cette phase.

## I. Audit

| Événement | Auteur / corrélation |
| --- | --- |
| PASSWORD_RESET_REQUEST_CREATED | userId + requestId (ajout Phase 6), demande publique |
| PASSWORD_RESET_REQUEST_APPROVED | adminId, userId, requestId |
| PASSWORD_RESET_REQUEST_REJECTED | adminId, userId, requestId |
| PASSWORD_RESET_TOKEN_ISSUED | userId, requestId ; lié à la livraison ADMIN |
| PASSWORD_RESET_DELIVERY_SENT | adminId, userId, requestId, EMAIL, SENT |
| PASSWORD_RESET_DELIVERY_FAILED | adminId, userId, requestId, EMAIL, FAILED |
| PASSWORD_RESET_COMPLETED | userId, requestId |

Chaque événement porte le timestamp du logger. Aucun secret ou contenu email. Les noms existants sont conservés. Expiration : état et updatedAt conservés en base ; pas de nouvel événement individuel d’expiration ni d’historique SMTP détaillé. Le logger après commit conserve la limite connue : interruption entre commit et log possible, absence de garantie transactionnelle de l’audit. Une expiration lazy en masse ne crée pas une nouvelle architecture d’audit.

## J. Configuration email

APP_BASE_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD et EMAIL_FROM sont présents dans .env.example, sans valeurs sensibles. Commentaires précisent l’origine HTTPS et TLS/STARTTLS. Aucun .env réel modifié.

À la première utilisation : APP_BASE_URL doit être une origine valide sans credentials, chemin, query ou fragment ; HTTPS obligatoire en production ; HTTP seulement pour localhost/127.0.0.1/::1 hors production. Aucun Host client utilisé pour fabriquer le lien.

SMTP : port entier 1–65535, secure exactement true/false, host et credentials requis dans ce provider authentifié, expéditeur simple valide. Configuration absente/invalide : EMAIL_NOT_CONFIGURED, message ADMIN sûr et aucun token émis. Relais SMTP sans authentification non pris en charge par ce provider. TLS direct ou STARTTLS obligatoire, certificat vérifié, logs/debug Nodemailer désactivés, délais bornés et transport fermé.

Email HTML et texte : nom New Vision Academy, prénom échappé, lien clair, 30 minutes/usage unique, possibilité d’ignorer et contacter NVA si demande non sollicitée. Aucun mot de passe temporaire, nom ADMIN, identifiant technique ou token affiché séparément. Langue FR par défaut, variante EN testée en Phase 5. FakeEmail ne conserve les messages qu’en mémoire ; aucun email réel envoyé. La réception/délivrabilité et SPF/DKIM/DMARC restent à vérifier avec le fournisseur lors d’une étape autorisée.

## K. Concurrence

Verrous User en ordre croissant, puis Request pour émission/consommation, relecture et mutations conditionnelles. Tests double APPROVE, APPROVE+REJECT, double SEND et double RESET : un seul gagnant. Invalidation des anciens tokens à la rotation, contrainte unique par demande, aucun second token actif exploitable. Le mot de passe, authVersion, usedAt et COMPLETED/completedAt sont atomiques.

SENDING interdit la consommation et borne la réservation ; SMTP hors transaction ; finalisation revalide demande, expiration, utilisateur, ADMIN, email, version et numéro de tentative. Phase 6 couvre aussi une demande qui expire pendant SMTP. Les scénarios de rollback et workers tardifs des Phases 4/5 sont conservés.

## L. Permissions et performance

Montage du module derrière requireAdmin, après validateSession ; STUDENT/TEACHER refusés sur liste, détail et approve/reject/send avec IDs manuellement choisis. Sessions ADMIN désactivées/rétrogradées/révoquées refusées à la requête suivante. Les services de mutation recontrôlent l’ADMIN en base sous verrou. Après reset, ancienne session STUDENT refusée, ancien mot de passe refusé et nouvelle connexion acceptée. Une requête déjà autorisée n’est pas interrompue rétroactivement.

Liste : pagination dix lignes, projections explicites, relations user/reviewedBy chargées avec la requête Prisma, aucun appel par ligne dans le rendu. Index Request (userId,status), status et requestedAt existants ; hash et requestId uniques sur Token, index utilisateur/dates et expiration existants. Les recherches d’envois sont bornées au userId ; expiration du détail/action bornée à l’ID, celle du lien au hash unique. La liste expire les demandes actives en une mise à jour conditionnelle ; coût croissant avec les demandes encore actives et tri/pagination à surveiller si volumétrie élevée. Aucun benchmark massif ni nouvel index/migration spéculatif.

## M. Tests Phase 6

Le fichier dédié couvre les exigences AA, complété par les assertions détaillées conservées des Phases 1–5 :

| Exigences | Couverture |
| --- | --- |
| 1–6 | Réponses génériques et quotas pour compte existant/absent/inactif/identifiant invalide, doublons |
| 7–11 | Transitions, états terminaux et expiration lazy, bornes temporelles |
| 12–16 | GET/POST expiré/utilisé/inconnu, HTML public et ADMIN sans token |
| 17–23 | Sanitizer, champs secrets, logs réels SMTP/audit, headers y compris parsing |
| 24–30 | IDOR STUDENT/TEACHER sur cinq actions, sessions ADMIN révoquées |
| 31–38 | Email absent/invalide, configuration, retry et concurrence send/reset, unicité |
| 39–47 | TTL trente minutes, politique 10 caractères/72 octets Unicode, confirmation, états sans resend |
| 48–54 | Audits création/décision/émission/livraison/finalisation et absence de secret |
| 55–66 | Email texte/HTML/APP_BASE_URL, changement effectif, version/sessions/login, COMPLETED, usage unique |
| 67–70 | Parcours HTTP complet FakeEmail, rejet, absence email, panne SMTP |

Ajouts : cinq/dix emoji, demande expirant pendant SMTP, rechargement puis POST après expiration, reprise SMTP après réparation, paramètres SMTP invalides, corps JSON malformé sans fuite et lien invalide refusé avant bcrypt. La liste des tests TAP contient les noms exacts ; certains sous-tests regroupent plusieurs assertions AA.

## N. Résultats exacts

### Revalidation du 12 septembre 2026

La livraison Phase 6 était déjà présente à réception de la demande. Relecture des protections et migrations, puis relance sans changement applicatif ni migration :

- Phase 6 seule : **98/98 tests Node (97 cas métier + parent)**, zéro échec, annulé, ignoré ou TODO ; code de sortie **0**, **22 938,018 ms**. Journal : `tmp/auth-phase6-revalidation-20260912.log`.
- Suite complète : **673/673 tests**, **2 suites**, zéro échec, annulé, ignoré ou TODO ; code de sortie **0**, **448 890,0766 ms**. Journal : `tmp/auth-phase6-full-20260912.log`. Les six fichiers auth passent dans cette exécution. Le résultat ciblé 319/319 ci-dessous reste celui de la validation précédente, pas une relance ciblée distincte aujourd’hui.
- Contrôles statiques relancés : **152 templates EJS**, **486 clés publiques FR/EN**, **17 assets**, tous valides.

Exécution par `tmp/run-phase6.cjs`, utilisant `isolatedEnvironment()` et une assertion stricte `/english_center_test`, sans reset de base. Aucun SMTP réel utilisé, aucune production ni base principale modifiée. Seul ce rapport est actualisé pendant cette revalidation ; la liste des 24 fichiers décrit la livraison préexistante. La validation navigateur précédente n’a pas été relancée.

Validation ciblée finale : **319/319 tests**, zéro échec, annulé, ignoré ou TODO, code de sortie **0**, **118 609,2536 ms**. Journal : `tmp/auth-phase6-final-targeted.log`.

| Fichier auth | Cas métier réussis | Total Node avec parent | Durée du parent |
| --- | --- | --- | --- |
| Phase 1 | 19/19 | 20/20 | 18 135,9682 ms |
| Phase 2 | 19/19 | 20/20 | 8 025,3077 ms |
| Phase 3 | 39/39 | 40/40 | 14 298,8172 ms |
| Phase 4 | 60/60 | 61/61 | 20 666,7895 ms |
| Phase 5 | 60/60 | 61/61 | 15 628,2053 ms |
| Phase 6 | **97/97** | **98/98** | **20 085,1836 ms** |

Les six fichiers auth représentent 300/300 tests Node. Le total ciblé 319 ajoute layout ADMIN, module étudiants ADMIN, CSRF et inscription/reset NVA. Les temps de parents ne comprennent pas tout le coût de lancement/chargement des fichiers.

Suite complète : **673/673 tests**, **2 suites**, zéro échec, annulé, ignoré ou TODO, code de sortie **0**, **433 639,9456 ms**. Journal : `tmp/auth-phase6-full.log`. Total cohérent avec les 575 tests de référence Phase 5 + les 98 tests Node Phase 6 (97 cas et parent). Les parcours login/inscription, ADMIN/STUDENT/TEACHER, paiements manuels, sessions PostgreSQL, sécurité et sauvegardes sont inclus. Aucune régression restante observée ; aucun correctif métier hors récupération appliqué pour obtenir ce résultat.

Contrôles statiques finaux : schéma Prisma valide ; **152/152** templates EJS ; **486/486** clés publiques FR/EN ; **17/17** assets ; syntaxe des fichiers JavaScript modifiés valide. Contrôle des journaux ciblés, UI et suite complète : **0** URL contenant un token brut de 43 caractères, **0** mot de passe/marqueur sensible de fixture Phase 6, **0** hash bcrypt.

Contrôle Edge final : **9/9** vues forgot/reset/ADMIN à 1440, 768 et 390 px, **2/2** vues email à 640/390 px, **2/2** bascules de langue ; soumission native du formulaire sans action explicite, erreur de confirmation, reset réussi et lien réutilisé refusé ; **0** erreur JavaScript, **0** email réel, code de sortie **0**. Journal `tmp/auth-phase6-ui-final.log`. Captures publiques, ADMIN, erreurs et email inspectées.

Les processus passent par isolatedEnvironment() avec assertion stricte `/english_center_test` ; aucune commande npm test (qui réinitialiserait cette base), migrate reset, migrate deploy ou db push exécutée. Exécution Node `--test --test-concurrency=1 --test-reporter=tap`. Répertoire privé isolé sous tmp. Vérification SQL en lecture seule : current_database=english_center_test et les quatre migrations septembre sont déjà appliquées.

## O. Régressions et reprises

Journal provisoire trouvé à la reprise : 283 tests, 273 réussites et 10 échecs comptabilisés. Il n’est pas une validation finale. Les erreurs identifiées concernent la langue attendue Phase 1, une fixture APPROVED sans reviewedAt Phase 3, quatre attentes de message Phase 6 et la fixture SMTP sans email, plus les parents.

Première relance de reprise : 141/141, zéro échec, 99 700,5788 ms, journal tmp/auth-phase6-recheck.log. Passage suivant auth 1–6 : 298 tests, 296 réussites, deux échecs comptabilisés (assertion audit Phase 2 et parent), 102 221,8833 ms, tmp/auth-phase6-targeted.log. Les 95 cas Phase 6 passent alors ; le test Phase 2 a été adapté pour exiger aussi le requestId ajouté au contrat d’audit, sans assouplir la confidentialité. Deux cas Unicode ont ensuite été ajoutés. Le premier passage élargi a donné 317/319 réussites en 121 379,803 ms (tmp/auth-phase6-verification.log) : une assertion CSRF attendait encore une confirmation française alors que sa requête utilise la langue anglaise par défaut. Elle a été alignée sur cette langue, en conservant les contrôles CSRF et de réussite.

Validation navigateur : premier essai interrompu avant fixture par indisponibilité PostgreSQL ; relance interrompue par clic sur un sélecteur de langue de l’en-tête masqué à 390 px. Le script a été corrigé pour exercer ce contrôle à largeur desktop, sans changement de comportement applicatif. Passage final Edge : 9/9 vues publiques/ADMIN sans débordement, 2/2 emails, 2/2 bascules FR/EN, POST réel du formulaire et refus du lien réutilisé, zéro erreur JS et zéro email réel. Captures inspectées sous tmp/auth-phase6-ui ; journal tmp/auth-phase6-ui-final.log. Le navigateur intégré ne proposait aucun navigateur disponible.

## P. Migrations prêtes pour production

À appliquer seulement lors d’un futur déploiement explicitement autorisé, après sauvegarde :

| Ordre | Migration | Effet / dépendance |
| --- | --- | --- |
| Prérequis historique | 20260827130000_add_password_reset_tokens | Table tokens et index ; dépend de users |
| Phase 1 | 20260909180000_add_user_auth_version | users.auth_version NOT NULL DEFAULT 0 |
| Phase 2 | 20260910120000_add_password_reset_requests | Enum, table, relations et index Request ; dépend de users |
| Phase 4 | 20260910200000_link_password_reset_token_to_request | auth_version_at_request nullable, request_id nullable unique et FK ; dépend des tables Request/Token |
| Phase 5 | 20260911090000_add_password_reset_delivery_tracking | Enums et colonnes livraison, delivery_pending DEFAULT false ; dépend de Request/Token |

Phase 3 et Phase 6 : aucune migration. Ces migrations sont additives : aucun DROP, TRUNCATE, suppression de données ni changement de mot de passe. Les relations ON DELETE CASCADE décrivent le comportement futur de suppression des comptes/demandes ; leur création ne supprime aucune ligne. Les données historiques non liées ou sans version restent conservées mais ne peuvent pas autoriser une récupération. Ne pas les backfiller arbitrairement pour les rendre exploitables.

Plan futur : **backup vérifié → déployer le code → npm ci → générer le client Prisma selon le script du projet → prisma migrate deploy → vérifier schéma et migrations → redémarrer PM2 → smoke tests**. Les migrations précédentes du projet restent des prérequis ; ne pas copier seulement les quatre migrations auth dans une base vide. Aucun de ces actes de production n’a été exécuté ici.

## Q. Risques restants

- SMTP réel, domaines et délivrabilité non configurés/testés ; SENT ne prouve pas la lecture/réception.
- Adresse associée au compte sans preuve de vérification enregistrée : contrôle des coordonnées indispensable côté NVA.
- Logs Nginx/observabilité à sécuriser avant livraison réelle ; TLS/HSTS et TRUST_PROXY à vérifier au VPS.
- Limiteurs en mémoire, IP partagées/distribuées, différences temporelles et disponibilité DB : pas une certification d’absence de tout canal latéral ou DDoS.
- Audit après commit et absence de worker de reprise/historique SMTP ; expiration lazy, sans purge d’historique.
- Politiques 7 jours/24 heures à communiquer aux ADMIN ; un lien envoyé près de l’échéance de la demande peut être valide moins de 30 minutes.
- Compétence navigateur intégrée indisponible : validation effectuée avec Edge local, pas avec un navigateur VPS.

## R. Checklist pré-déploiement VPS

- [ ] Identifier la cible et confirmer explicitement l’autorisation de déploiement ; conserver cette phase locale.
- [ ] Sauvegarde PostgreSQL/fichiers privés et restauration de contrôle, avec destination vérifiée.
- [ ] Configurer HTTPS/APP_BASE_URL, SMTP authentifié, EMAIL_FROM et secrets hors dépôt.
- [ ] Configurer et tester les journaux Nginx (accès **et erreurs**) et observabilité avec URL de récupération fictive, sans token conservé.
- [ ] Vérifier proxy unique, TRUST_PROXY, pare-feu du port Node, cookies Secure, headers et exclusion des caches.
- [ ] Appliquer les migrations dans l’ordre selon le plan P, vérifier schéma, générer le client puis redémarrer PM2.
- [ ] Confirmer l’organisation de revue ADMIN et communiquer les durées/cooldowns.
- [ ] Exécuter un smoke test contrôlé, vérifier emails réels FR, spam et SPF/DKIM/DMARC, autorisations et révocation des anciennes sessions.
- [ ] Conserver le plan de retour arrière compatible avec migrations additives ; ne pas réactiver l’ancien reset sans approbation.

Prêt pour la préparation opérationnelle du VPS ne signifie pas déjà déployé ni SMTP certifié. Toute mise en production reste une étape distincte.




