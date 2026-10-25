# NVA WhatsApp V2 — levée des blocages prioritaires

Dernière mise à jour : **25 octobre 2026**, Africa/Kinshasa ; travaux commencés le 24 octobre. Périmètre : code local et laboratoire isolé `127.0.0.1:58432/nva_whatsapp_v2_test`. Aucun déploiement, accès Contabo, envoi WhatsApp/e-mail réel, changement de configuration ou PM2 de production, installation système ou migration destructive.

**Les deux blocages prioritaires sont levés dans le laboratoire : relais manuel Meta et validation complète des parcours SQL sous les rôles restreints. GO pour la poursuite de la recette technique ; NO-GO production maintenu pour les prérequis opérationnels non démontrés.**

## 1. Blocages initiaux et architecture conservée

L’[audit de préproduction](nva-whatsapp-v2-preproduction-audit.md) identifiait HUM-01 : l’envoi manuel exigeait l’ancien flag WhatsApp, incompatible avec le mode Meta ; le worker Meta excluait tous les messages manuels. Il identifiait également une couverture SQL insuffisante : les parcours métier passaient, mais sans le DDL Meta complet et sans exercer le vrai rôle ingress/worker sur la chaîne actuelle.

L’audit du code confirme que le transfert et l’interface existaient déjà :

- Le moteur reconnaît la demande de conseiller et l’orchestrateur enregistre `HUMAN_TAKEOVER`, `handoffAt` et l’état JSON suspendu. Ce statut existant correspond au mode humain demandé ; aucun enum HUMAN parallèle ajouté.
- Les messages entrants restent enregistrés pendant la prise en charge ; les réponses ordinaires du bot et les relances sont suspendues. L’accusé de transfert SYSTEM reste distinct d’une réponse ordinaire.
- Les routes `/admin/whatsapp/conversations` donnent accès à la liste, au détail, à l’historique paginé et aux actions de prise en charge, pause, réponse et reprise. Meta Cloud API ne fournit pas automatiquement cette interface : **c’est l’interface NVA existante** qui est utilisée.
- La liste des conversations et le détail renvoient `Cache-Control: no-store` pour éviter la mise en cache des informations personnelles ; les accès restent réservés aux administrateurs autorisés.
- Le rôle autorisé demeure ADMIN actif, avec session valide et changement de mot de passe terminé. L’administrateur responsable est enregistré dans `assignedAdvisorId` ; chaque réponse porte son `senderUserId`.
- « Reprendre le bot » termine la prise en charge, libère l’affectation et enregistre la reprise. Les messages non transmis de la prise en charge sont annulés ; ils ne sont pas réactivés.

Aucun second système de conversation, webhook, outbox, SDK ou service d’inscription créé. La file `WhatsAppConversationMessage`, l’inbox Meta, le worker et le service Cloud API existants sont réutilisés.

## 2. Corrections du relais humain

Les réponses nouvelles de conseiller utilisent une clé `wa-meta-manual:<endpoint>:<conversation>:<formulaire UUID>`. L’endpoint et la conversation font partie du périmètre d’envoi. Cette clé ne contient ni nom, téléphone, e-mail ni secret. La clé de flux utilise le **même protocole cryptographique** que l’inbox existante, factorisé sans changer son format.

La préparation d’une réponse :

1. Vérifie session/ADMIN/CSRF, responsabilité de la prise en charge et contenu borné.
2. Refuse la coexistence avec l’ancien expéditeur et exige l’autorisation d’envoi Meta. Aucun ancien flag n’est réactivé.
3. Vérifie l’endpoint exact, ses identités et flags, ainsi qu’un message entrant effectivement traité dans son flux.
4. Revérifie la fenêtre fournisseur de 24 heures, puis crée une réponse **QUEUED**, jamais annoncée envoyée à ce stade.
5. Déduplique le formulaire, y compris deux soumissions concurrentes. Un formulaire repris depuis l’ancien canal ou un autre endpoint ne crée pas un nouvel envoi.

Le worker sélectionne uniquement les réponses manuelles explicitement attachées à son endpoint, créées après le cutoff d’envoi. Les anciens messages `wa-manual:*`, les autres endpoints et les messages antérieurs au cutoff ne sont pas repris automatiquement.

Avant transport, le service existant contrôle à nouveau l’auteur actif, l’affectation, le mode humain, STOP, la fenêtre et les événements entrants en attente. Les actions humaines utilisent désormais les verrous de destinataire et de ligne, avec reprises bornées des conflits SQL. Deux conseillers ne peuvent pas s’attribuer la même conversation de manière incohérente.

Un résultat API accepté devient **ACCEPTED**, pas DELIVERED. Les callbacks signés mettent ensuite à jour DELIVERED/READ sans rétrograder les états. Un refus Meta confirmé est FAILED ; un résultat réseau ambigu est DELIVERY_UNCERTAIN et n’est pas renvoyé automatiquement. Les règles existantes de backoff demeurent communes aux messages automatiques et manuels.

**Hors fenêtre**, le texte libre est refusé à la préparation et revérifié à l’envoi. Aucun modèle n’est inventé ni déclaré approuvé, et aucun envoi commercial n’est déclenché pour contourner la fermeture. Ce parcours n’ajoute pas de composeur de templates de conseiller : un tel besoin doit passer par un workflow de modèles réellement approuvés et une autorisation distincte.

## 3. Durcissement et validation SQL/ACL

### Rôles et scripts

| Usage | Nom prévu en production | Nom testé en laboratoire |
| --- | --- | --- |
| Réception signée | `nva_meta_inbox_ingress_prod` | `nva_v2_meta_ingress` |
| Traitement/envoi | `nva_meta_inbox_worker_prod` | `nva_v2_meta_worker` |
| Dashboard/administration | Rôle applicatif NVA à inventorier | `nva_v2_test_runner`, distinct du worker |
| Fixtures, DDL et nettoyage | Aucun usage applicatif | Bootstrap du seul cluster de test |

Les rôles ingress/worker ont été créés avec les **scripts canoniques complets** ; seuls base, port et noms de rôles sont adaptés au laboratoire. Leurs contrôles, grants et restrictions restent exécutés. Les mots de passe sont aléatoires, renouvelés en mémoire et absents des journaux/rapports/Git. L’authentification des deux nouveaux rôles est limitée à cette base et à la boucle locale dans le HBA du laboratoire ; aucun fichier d’une autre instance modifié.

Le DDL Meta canonique complet a été appliqué dans une transaction à la base dédiée : quatre tables, index, contraintes et sept triggers de garde. Son empreinte reste `5700356024669fef66a3b58aa63f0c0a6a0e297b864617543c40f109eac0bb42`. Les **47 migrations Prisma restent inchangées**. Cette validation ne se limite plus à une simulation SQL ou à un rôle de test doté de tous les droits.

### Droits retenus

| Objet | Privilèges worker / justification |
| --- | --- |
| Meta endpoints/receipts/events/items | SELECT pour périmètre, traitement et triggers ; UPDATE limité aux colonnes de baux/états/compteurs et verrou de l’endpoint ; pas de création d’endpoint ni DELETE |
| `users` | SELECT de `id`, téléphone, WhatsApp, rôle, activité et obligation de changement de mot de passe ; aucun e-mail/hash de mot de passe, aucune écriture |
| Formations, sessions, groupes, inscriptions | SELECT pour catalogue, disponibilités et rattachement ; aucune création de compte/Enrollment, ni modification de prix/paiement |
| Règles/settings/scénarios du chatbot | SELECT ; pas de modification des paramètres d’activation par le worker |
| Conversations | SELECT/INSERT et UPDATE des seuls champs d’orchestration nécessaires |
| Messages de conversation | SELECT ; INSERT limité aux colonnes techniques/contenu, **sans `sender_user_id`** ; UPDATE des statuts et colonnes de traitement, sans modification de l’auteur |
| Demandes d’admission | SELECT ; INSERT des coordonnées/consentement/source/draft, **sans statut, affectation, administrateur de conversion ni Enrollment** ; UPDATE des coordonnées/consentement/draft, pas des décisions |
| Événements d’admission | SELECT, **aucun INSERT/UPDATE direct** ; EXECUTE d’une fonction limitée aux événements de consentement du prospect |
| Préférences, consentements commerciaux, suivis, notifications | Droits déjà nécessaires à la collecte, STOP, annulation et notifications internes, selon le script canonique ; pas d’expédition de notifications créée par ce worker |
| Livraisons historiques | SELECT et UPDATE limités aux callbacks/annulation STOP ; pas d’INSERT de livraison |
| Budget chatbot historique | SELECT/INSERT et UPDATE du compteur `calls` uniquement ; compatibilité du composant existant, aucun secret ni réglage IA ; IA maintenue désactivée dans le périmètre V2 |
| Séquences | USAGE des seules séquences nécessaires aux insertions autorisées ; pas de SELECT/UPDATE de séquence ni séquence utilisateur. Le droit sur la séquence des événements d’admission a été retiré, l’insertion passant par la fonction. |
| DDL/administration | Aucun CREATE de schéma/base/rôle, TEMP, DELETE, TRUNCATE, propriétaire, superutilisateur, réplication, BYPASSRLS ou héritage de rôle |

L’inventaire par colonne et séquence est dans [meta-acl-inventory.json](../output/nva-whatsapp-v2-postgres-20261024/meta-acl-inventory.json). Les gardes runtime refusent également les privilèges excessifs d’auteur, de décision ou d’écriture directe des événements d’admission.

### Excès corrigés et dépendance SQL additive

Les anciens droits INSERT de table entière permettaient au rôle SQL du worker de renseigner un auteur de conseiller, des champs de décision d’admission ou un faux événement EMAIL_VERIFIED. Ces excès sont retirés dans les scripts candidats, sans modifier la production.

Le moteur Prisma renseigne certains defaults littéraux, dont PENDING, dans ses INSERT. Pour ne pas donner au worker un droit d’insertion sur `status`, la création de demande utilise désormais un **INSERT paramétré à colonnes explicites**, dans la transaction existante. PostgreSQL fournit PENDING et les liens administratifs nuls. Les timestamps sans fuseau sont écrits explicitement en UTC. Le chemin des modèles en mémoire reste réservé aux tests ; aucune voie de repli permissive de production.

La nouvelle fonction [nva_record_admission_consent](../docs/sql/whatsapp-admission-worker-consent-function.sql) est une dépendance additive : SECURITY DEFINER, propriétaire de confiance distinct du worker, `search_path=pg_catalog`, références de tables qualifiées, EXECUTE PUBLIC retiré. Elle n’accepte que CONSENT_CONFIRMED/RECONFIRMED, une demande ouverte, la version attendue et des métadonnées objet bornées. Elle ne peut produire ni preuve e-mail, ni action administrative, ni auteur administrateur. Le worker n’a plus de droit direct d’écriture sur `WhatsAppAdmissionEvent`.

Le [script 06](../deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql) répare `confirmationDraft` **et resserre maintenant ces INSERT et les événements** pour un rôle existant. Il comporte donc des révocations ciblées sur ce seul rôle ; il ne faut plus le décrire comme un simple GRANT additif. Il vérifie cible, rôle, héritage et objets, puis refuse les privilèges hérités incompatibles. Aucun REVOKE PUBLIC global ni écrasement de rôle.

Le laboratoire reproduit un rôle privé du droit `confirmationDraft`, puis exécute le vrai script 06 adapté : droit absent avant, présent après. Le [script 07](../deploy/whatsapp-chatbot/07-admin-meta-manual-grants.sql) prépare pour le rôle web les seules lectures Meta supplémentaires et l’appel de la fonction de consentement ; **aucun secret/URL du worker n’est nécessaire au dashboard**.

## 4. Tests exécutés et résultats

Les scénarios traversent de vrais clients Prisma et PostgreSQL, les rôles restreints avec leurs mots de passe éphémères, les contraintes/triggers, l’inbox signée, le worker, les services réels et le constructeur Cloud API. Seul le transport Meta est remplacé par un mock. Le serveur HTTP local monte les routes existantes avec vraie validation de session, ADMIN, CSRF et rendu EJS ; sa route de connexion fictive n’existe que dans le test.

| Scénario | Résultat |
| --- | --- |
| A : demande conseiller → suspension → prise en charge → historique → réponse → fin/reprise | Réussi ; réponse QUEUED puis ACCEPTED ; callbacks signés DELIVERED/READ, callback ancien sans rétrogradation ; bot reprend sur la question suivante |
| B : rôle worker → catalogue/sessions → consentement → demande PENDING → reconfirmation | Réussi sous le vrai rôle restreint, une demande et aucun compte/Enrollment créé |
| C : deux conseillers concurrents | Une attribution réussie, une erreur contrôlée 409 ; responsable unique |
| D : erreur Meta 403 | FAILED, aucun identifiant fournisseur ni succès fictif ; pas de nouvel envoi automatique |
| Deux envois concurrents du même formulaire, rejeu et changement de contenu | Un message, une déduplication ; contenu différent refusé |
| Fenêtre fermée, STOP, auteur désactivé, reprise du bot | Texte refusé ou message en attente annulé, aucune expédition indue |
| Résultat transport ambigu | DELIVERY_UNCERTAIN ; nouveau passage du worker sans retransmission |
| Ancien canal et autre endpoint | Files existantes inchangées, non expédiées ; réutilisation d’un ancien formulaire refusée |
| HTTP dashboard Meta | Visiteur redirigé, étudiant refusé, absence CSRF refusée ; ADMIN autorisé voit l’historique et le formulaire même si le canal historique est désactivé |
| HTTP webhook signé réel sur SQL | Acceptation durable, doublon gardé unique, un traitement et un accusé de transfert |
| Opérations SQL interdites | Accès aux hashes/e-mails étudiants, paiements et tokens refusé ; écritures comptes/Enrollments/prix/décisions/auteurs/preuves e-mail, DELETE/TRUNCATE/DDL, séquences interdites et changement de rôle refusés |
| Transactions | Mise à jour autorisée puis ROLLBACK ; état initial retrouvé |
| Excès de privilège simulé | Ajout contrôlé d’INSERT(status) dans le laboratoire : le runtime refuse `ready()` ; privilège retiré, disponibilité rétablie |
| Fonction de consentement | Succès du chemin réel ; événement EMAIL_VERIFIED refusé directement et via la fonction ; ingress ne peut appeler cette fonction ni lire/écrire le métier |

| Suite finale | Résultat | Preuve |
| --- | --- | --- |
| Release WhatsApp | **412/412** | [journal](../output/nva-v2-final-readiness-release.log) |
| Compléments fonctionnels/fiabilité/contrats | **80/80** | [journal](../output/nva-v2-final-readiness-extra.log) |
| Webhook monté, préproduction et nouveau périmètre manuel | **22/22** | [journal](../output/nva-v2-final-readiness-targeted.log) |
| Intégration métier SQL | **7/7** | [journal](../output/nva-whatsapp-v2-postgres-20261024/business-tests.log) |
| Administration SQL/HTTP | **20/20** | [journal](../output/nva-whatsapp-v2-postgres-20261024/admin-tests.log) |
| Configuration/readiness sur laboratoire | **6/6** | [journal](../output/nva-whatsapp-v2-postgres-20261024/vps-readiness-tests.log) |
| Nouvelle chaîne Meta SQL/relais/ACL | **13/13**, parent et douze scénarios | [journal](../output/nva-whatsapp-v2-postgres-20261024/meta-readiness-tests.log) |
| Sonde de colonne et réparation 06 | PASS | [sonde](../output/nva-whatsapp-v2-postgres-20261024/worker-acl-reconfirmation.json), [réparation](../output/nva-whatsapp-v2-postgres-20261024/meta-grant-repair.json) |
| Corpus conversationnel inchangé | **207/216 = 95,83 %**, 16/16 critiques | [mesure](../output/nva-v2-final-readiness-holdout.json) |
| Compilation des vues et syntaxe JS | **164 vues OK**, syntaxe vérifiée | Contrôles locaux |

**Total : 514 tests isolés ; 40 tests d’intégration PostgreSQL/HTTP et 6 tests de configuration/readiness avec le laboratoire, soit 46 contrôles Node de laboratoire.** Zéro échec dans les exécutions finales activées ; parents compris. Corpus et sondes SQL séparés de ces totaux.

Le [récapitulatif vérifié du 25 octobre](../output/nva-v2-final-readiness-summary.json) rapproche les sept journaux finaux, vérifie zéro échec/ignoré, les comptes de nettoyage et les sept gardes Meta actifs.

Les premiers essais ont identifié un droit SELECT de laboratoire manquant sur l’historique de consentements du dashboard et le besoin d’éviter les defaults Prisma sur les colonnes de décision. Ils ont été corrigés. L’injection d’échec Meta est maintenant attachée à la clé du message ciblé, pour ne pas affecter un accusé encore en file ; le test reproduit le prochain passage du poller. Les assertions HTTP respectent les redirections existantes. Aucun test ne revendique une livraison Meta réelle.

Les fixtures utilisent des identités détenues par la suite. Nettoyage du seul endpoint et des IDs/numéros créés ; pas de reset, TRUNCATE ou suppression de données réelles. Les gardes de rétention Meta sont actifs pendant les tests. **Le bootstrap du laboratoire utilise uniquement pour le nettoyage une transaction `session_replication_role=replica`**, car les historiques Meta sont protégés contre l’effacement avant expiration. Cette opération n’est ni disponible au worker/ingress (refus testé), ni une procédure de production. Après nettoyage, les quatre tables Meta et les tables métier contrôlées sont vides, et les sept triggers restent actifs.

Preuves : [préparation des rôles/DDL/fonction](../output/nva-whatsapp-v2-postgres-20261024/meta-role-preparation.json), [nettoyage Meta](../output/nva-whatsapp-v2-postgres-20261024/meta-final-checks.json), [nettoyage métier](../output/nva-whatsapp-v2-postgres-20261024/final-checks.json). Les preuves `output` sont hors Git et ne contiennent aucun mot de passe ni clé.

## 5. Fichiers créés ou modifiés

- Relais/transport : `src/services/whatsappHumanHandoffService.js`, nouveau `metaManualReplyScope.js`, `metaInboxWorkerService.js`, `metaInboxProtocol.js`, contrôleur `adminWhatsAppController.js`. L’interface existante est réutilisée, sans nouvelle vue de messagerie.
- Admissions : `src/services/whatsappAdmissionService.js`, pour l’INSERT restreint et les événements de consentement limités.
- Configuration de test : `src/services/metaInboxRuntime.js`, `src/config/metaInboxWorkerConfig.js` ; exception locale strictement gardée pour la seule base 58432, interdite en production.
- SQL candidats : `docs/sql/meta-inbox-production-worker-role.sql`, nouvelle fonction `docs/sql/whatsapp-admission-worker-consent-function.sql`, script `06-worker-admission-draft-grant.sql`, nouveau `07-admin-meta-manual-grants.sql`.
- Laboratoire/tests : nouveau `scripts/prepareNvaMetaLab.js`, `scripts/runNvaV2PostgresLab.js`, nouveaux `tests/whatsappV2MetaReadiness.integration.test.js` et `whatsappMetaManualScope.test.js`, backend contractuel `tests/helpers/metaInboxMock.js`.
- Documentation : ce rapport et renvois actualisés dans les rapports de préproduction/PostgreSQL. Aucun fichier de migration Prisma, configuration de production ou PM2 réel modifié.

## 6. Prérequis opérationnels et risques restants

La preuve porte sur **le candidat courant dans un laboratoire synthétique**, pas sur la base Contabo existante, son trafic ni ses autres applications. Restent ouverts :

1. Inventaire réel Linux/Node/PM2/processus/cron, schéma, historiques/checksums, rôles, PUBLIC et catalogue de la cible ; répétition sur restauration représentative anonymisée. Les contrôles de droits échouent volontairement si des privilèges hérités sont excessifs : ne pas révoquer PUBLIC globalement pour les faire passer.
2. Délivrabilité SMTP et accessibilité HTTPS du parcours e-mail avec destinataires autorisés ; aucun compte créé avant la preuve réussie. Remise sécurisée du mot de passe et organisation/disponibilité des conseillers.
3. Alignement de la règle de paiement après dix séances, portée de l’essai, tarifs/frais de certificat et horaires effectifs ; validations financières/certificat complètes. Les neuf erreurs non critiques du corpus ne sont pas effacées par cette mission.
4. Inventaire des modèles Meta réellement approuvés, consentement et autorisation de tests réels limités ; aucun texte libre hors fenêtre. Surveillance erreurs/backlog/DELIVERY_UNCERTAIN, absence de second sender, rétention/purge et rotation des logs.
5. Audit de dépendances encore non concluant dans l’audit précédent ; recette d’arrêt/reprise PM2/Linux, test de charge et retour arrière compatible. Les tests de concurrence actuels concernent deux acteurs, pas une charge multi-worker.

### Ordre de préparation ultérieure — non exécuté

Après autorisation explicite d’une release exacte et sauvegarde/restauration vérifiée : arrêter seulement les workers NVA concernés, laisser les envois fermés, comparer les migrations/objets existants, déployer les évolutions additives nécessaires et **la fonction de consentement avant les grants/code qui l’exigent**. Provisionner ou auditer les rôles ; appliquer 06 au seul rôle worker existant, 07 au rôle applicatif identifié, puis la release compatible et le worker unique. Revalider santé, endpoint, rôle/fonction, identité/ACL et cutoff avant ouverture graduelle et contacts consentants autorisés.

Le dashboard doit recevoir ses propres autorisations Meta de préparation, l’identité d’endpoint et sa clé de flux ; il n’a pas besoin du mot de passe du worker. Les flags d’envoi doivent être cohérents entre dashboard et worker. L’ancien expéditeur doit rester désactivé dans tous ses processus, pas seulement dans le fichier web.

**Retour arrière :** fermer l’envoi, arrêter proprement le worker exact, conserver files/consentements/résultats incertains et revenir à une release compatible. L’ancien code Prisma peut être incompatible avec ces INSERT désormais restreints : ne pas le relancer aveuglément et ne pas rétablir automatiquement des droits larges. Un bot arrêté avec le site intact est préférable à deux senders ou à des admissions non sûres. Pas de restauration destructive ou effacement des nouveaux consentements sans décision DBA/RPO séparée.

Reproduction locale :

```powershell
$env:NVA_V2_LAB_AUTHORIZED = 'local-new-synthetic-cluster'
node scripts/runNvaV2PostgresLab.js
Remove-Item Env:NVA_V2_LAB_AUTHORIZED
npm.cmd run test:whatsapp:release
node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/whatsappMetaManualScope.test.js
```

Le lanceur atteste le répertoire exact du cluster, refuse une base inconnue et fournit les identifiants uniquement en mémoire. Il prépare le SQL canonique dans **la seule base de test** et lance les suites. Les scripts candidats ne doivent jamais être exécutés sur la production simplement parce que ces commandes locales réussissent.

## 7. Décision

**HUM-01 et le défaut de validation SQL/ACL du candidat courant : résolus et démontrés en laboratoire. GO pour poursuivre la recette isolée.**

**NO-GO production** tant que les prérequis techniques de cible et opérationnels ci-dessus ne sont pas effectivement satisfaits et documentés. Aucun déploiement ou message réel n’a été autorisé ou effectué.
