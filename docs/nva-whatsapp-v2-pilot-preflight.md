# Préparation du GO pilote Contabo — NVA WhatsApp V2

25 octobre 2026. Complément ciblé au [registre opérationnel](nva-whatsapp-v2-operational-readiness.md) ; aucun audit fonctionnel rejoué. **GO laboratoire maintenu ; NO-GO pilote ; NO-GO ouverture publique.** Aucune inspection Contabo n'a été exécutée : les preuves de cible, sauvegarde et confinement restent absentes. Les 514 tests et 46 contrôles antérieurs ne constituent pas ces preuves.

## Blocages restant à clôturer

Les identifiants ci-dessous reprennent le registre existant. Une preuve doit porter une date, la cible, l'opérateur, le résultat et ses limites ; ne pas joindre de secrets ou de conversations.

| Prérequis ouverts | Opération exacte nécessaire / preuve de clôture | Inspection serveur seule suffisante ? |
| --- | --- | --- |
| A1 + B6 : conditions commerciales et catalogue | Faire approuver les annonces, notamment paiement après dix séances / durée du niveau, essai niveau 1, prix et frais ; rapprocher cette décision des résultats du diagnostic catalogue. Le présent dossier ne tranche pas l'écart commercial. | Non : accord pédagogique/financier indispensable ; données inspectables. |
| A2 : release et dépendances | Fixer l'identifiant et le manifeste SHA-256 de la release et du lockfile ; obtenir un audit de dépendances interprétable et sa décision de traitement. L'audit npm antérieur est non concluant. Qualifier le build Linux exact. | Non : dossier de release nécessaire. |
| A3 + B4 : repli et sauvegardes | Identifier les sauvegardes existantes, contrôler fraîcheur, checksum, archives, copie séparée et accès aux clés ; fournir le procès-verbal d'une restauration isolée et d'un retour à la release compatible, avec RPO/RTO acceptés. | Partiellement : lecture des fichiers/registre seulement ; pas une preuve de restauration. |
| A4 + B2/B5/B8 : confinement et continuité | Fournir la topologie actuelle, l'inventaire des senders et le périmètre Meta ; choisir un environnement pilote réellement indépendant et prouver la restriction aux contacts autorisés, entrée **et** sortie. | Non : inspection + console Meta + décision d'architecture et consentements. |
| A5 : conseiller | Nommer l'ADMIN et son remplaçant, vérifier leur habilitation et leur disponibilité ; remise privée des accès existants. | Non : engagement humain. |
| A6 + B10 : exploitation | Nommer opérateur/observateur/décisionnaire ; approuver fenêtre, bornes, arrêt et conservation ; constater droits/rotation/espace des journaux et rétention réellement planifiée. | Partiellement : configuration inspectable, organisation à approuver. |
| B1 : runtime | Relever Linux/architecture, Node, OpenSSL, versions effectives des binaires et du paquet PM2 ; rapprocher du build Linux et de Prisma 6.19.3. | Oui pour l'inventaire, pas pour un build/démarrage non effectué. |
| B3 : SQL | Comparer histoire et checksums des migrations, objets, sept gardes Meta, fonction de consentement et ACL aux artefacts de la release. Faire examiner chaque différence par le DBA. | Oui pour le constat ; toute correction exige une opération distincte. |
| B5 : configuration effective | Vérifier identités DB/rôles, flags web/worker, endpoint, clés/versions et cutoff UTC, sans publier les valeurs secrètes. Compléter le collecteur par une attestation privée des variables qu'il ne couvre pas. | Oui pour les processus accessibles ; une valeur dans un fichier ne prouve pas sa prise en compte. |
| B7 : web et SMTP | Attester DNS/TLS, reverse proxy, cookies/sessions, origine du lien de vérification, route publique et configuration SMTP. Utiliser la configuration et les preuves de surveillance existantes. | Partiellement : délivrabilité réelle en C2 seulement. |
| B8 : fournisseur | Rapprocher app/WABA/numéro/callback/permissions/version API avec la console Meta ; attester restriction des testeurs et politique hors fenêtre. | Non : console Meta nécessaire, aucune requête d'envoi. |
| B9 : cycle Linux | Obtenir la preuve de readiness et d'arrêt propre du candidat en recette fermée, sans transport, sous le gestionnaire cible. Les mocks et le timeout PM2 ne suffisent pas. | Non : essai de cycle de vie ultérieur, autorisé séparément ; aucun redémarrage ici. |

Les C1–C4 sont les objectifs des essais réels après GO, pas des preuves à inventer avant le pilote. Les D1–D3 restent différables dans le périmètre restreint existant ; ils ne deviennent pas de nouveaux blocages.

## Continuité du chatbot actuel et worker unique

La continuité **n'est pas attestée** sans inventaire du serveur et du routage fournisseur. Trois contraintes du code interdisent de promettre une coexistence par simple changement de flags :

- `metaInboxWorkerConfig.js` refuse les flags historiques d'envoi actifs avec le worker Meta.
- `whatsappSubmissionCoordinator.js` bloque le chemin historique sans barrière Meta dès qu'un endpoint Meta actif existe **dans la même base**. Un autre numéro ou processus avec cette base ne suffit donc pas.
- Le DDL Meta limite à un endpoint actif par base ; la politique runtime de production fixe `127.0.0.1:5432`, `english_center` et les rôles `nva_meta_inbox_ingress_prod` / `nva_meta_inbox_worker_prod`. Une base ou un port arbitraire de pilote serait refusé.

**Option compatible avec le maintien du service actuel :** périmètre pilote indépendant (canal/app ou abonnement Meta isolé, processus, base et espace réseau PostgreSQL indépendants), conservant les gardes de cible. Un environnement isolé déjà disponible peut fournir son propre localhost:5432 et ses noms attendus. Ne créer ni VM ni conteneur, ne détourner aucune garde dans cette mission. L'opérateur doit prouver qu'aucun changement du callback partagé ne détournera les messages actuels.

Dans le périmètre pilote : exactement un processus `processMetaInbox.js`, aucune copie par cron/service/autre utilisateur, anciens flags faux. Webhook et dashboard alimentent ce worker ; ils ne constituent pas un deuxième expéditeur. Dans le périmètre actuel indépendant : conserver processus, configuration, base et routage inchangés. Réconcilier aussi les senders qui résident hors du répertoire inspecté.

Si cette séparation n'existe pas, le scénario devient une **bascule** avec risque d'interruption, et non un pilote préservant le bot actuel. Maintenir NO-GO pour l'objectif de continuité jusqu'à décision et preuve adaptées.

## Commandes de constat en lecture seule — préparées, non exécutées sur Contabo

À lancer ultérieurement par l'opérateur habilité. Renseigner les chemins exacts hors d'un contexte shell enregistré publiquement. Ne pas lancer de commande privilégiée pour contourner un accès refusé : noter la couverture manquante. Les diagnostics sont des artefacts séparés, pas une installation du candidat dans l'application active.

```bash
# Valeurs non secrètes à confirmer par l'opérateur, ne pas copier ces exemples tels quels.
NVA_APP_DIR=/chemin/absolu/application-nva-active
NVA_DIAG_DIR=/chemin/absolu/artefacts-diagnostic-revus
uname -srm
node --version
openssl version
psql --version
pg_dump --version
pg_restore --version
command -v node pm2 psql pg_dump pg_restore
systemctl list-units --type=service --all --no-pager --plain
systemctl list-timers --all --no-pager --plain
node "$NVA_DIAG_DIR/inspect-contabo-pilot.cjs" "$NVA_APP_DIR"
```

Le [collecteur](../deploy/whatsapp-chatbot/inspect-contabo-pilot.cjs) lit `/proc`, les emplacements cron accessibles et des métadonnées de fichiers. Il ne lance aucun processus, n'importe pas l'application, n'écrit aucun fichier et ne contacte aucun réseau. Il masque les secrets, ne lit pas `.env` et ne publie pas les commandes cron. Les empreintes d'identifiants permettent un rapprochement privé ; elles ne prouvent pas leur validité Meta.

Options facultatives : transmettre `NVA_PM2_DUMP` avec le chemin du dump PM2 **existant** et `NVA_PM2_PACKAGE` avec le `package.json` du paquet PM2 existant. Le dump est une configuration sauvegardée, **pas** l'état vivant. Une absence ou un accès refusé ne vaut jamais « aucun worker ». Faire compléter l'inventaire par le propriétaire pour les autres utilisateurs, répertoires, services et conteneurs. Ne pas publier les listes de services sans revue des métadonnées internes.

Ne pas exécuter `pm2 jlist`, `pm2 env`, démarrage/redémarrage/sauvegarde PM2, ni afficher `/proc/*/environ`, les fichiers `.env`, les unités avec leur environnement ou les lignes cron brutes. Même une commande PM2 d'information peut démarrer un daemon absent. Ne pas sonder `/health` ou `/ready` dans ce lot strictement sans écriture : le middleware de session peut persister une session HTTP ; de plus ces routes n'attestent pas le worker.

### PostgreSQL : identité puis métadonnées

Utiliser un **service libpq protégé déjà provisionné** et un compte autorisé à lire les métadonnées ; pas de mot de passe/URL dans la commande. `-w` refuse une demande de mot de passe. Le DBA confirme d'abord que ce service désigne bien la cible NVA attendue ; ne pas déduire la cible du nom du service. Chaque script impose aussi une transaction READ ONLY, des délais et le contrôle de la base.

```bash
NVA_DB_SERVICE=service_libpq_existant_confirme
NVA_EXPECTED_DB=english_center
NVA_APP_ROLE=role_web_effectif_confirme
NVA_INGRESS_ROLE=nva_meta_inbox_ingress_prod
NVA_WORKER_ROLE=nva_meta_inbox_worker_prod
for diagnostic in 03-contabo-readonly-structure.sql 04-contabo-readonly-catalog.sql 05-contabo-readonly-worker.sql 08-pilot-readonly-supplement.sql; do
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -w "service=$NVA_DB_SERVICE" \
    -v expected_database="$NVA_EXPECTED_DB" -v nva_app_role="$NVA_APP_ROLE" \
    -v nva_ingress_role="$NVA_INGRESS_ROLE" -v nva_worker_role="$NVA_WORKER_ROLE" \
    -f "$NVA_DIAG_DIR/$diagnostic" || break
done
```

Tout échec interrompt le constat ; ne pas réparer automatiquement. Les objets `Provider*` recensés par 03 ne sont pas tous requis pour le chemin Meta V2 : leur absence seule ne suffit pas à bloquer ce pilote. Une valeur NULL, une table absente ou une autorisation insuffisante est une preuve manquante, jamais une permission refusée attestée.

Le [complément 08](../deploy/whatsapp-chatbot/08-pilot-readonly-supplement.sql) contrôle fonction/owner/search_path/empreinte/PUBLIC, droits effectifs, dernières métadonnées de sauvegarde et agrégats bornés aux 1 000 derniers messages. Aucun corps, contact ou hash de mot de passe n'est retourné. Ces agrégats ne prouvent ni la santé de toute la file ni la livraison effective.

### Sauvegardes : archives existantes uniquement

Faire renseigner les chemins et checksums **attendus issus d'un manifeste de confiance**, ainsi que dates, base source et version PostgreSQL. Pour une archive PostgreSQL custom et une archive de release tar :

```bash
: "${NVA_BACKUP_FILE:?archive PostgreSQL existante requise}"
: "${NVA_BACKUP_SHA256:?checksum attendu requis}"
: "${NVA_RELEASE_ARCHIVE:?archive tar de repli requise}"
: "${NVA_RELEASE_SHA256:?checksum attendu requis}"
stat -c '%a %u %g %s %y' -- "$NVA_BACKUP_FILE" "$NVA_RELEASE_ARCHIVE"
test "$(sha256sum -- "$NVA_BACKUP_FILE" | cut -c1-64)" = "$NVA_BACKUP_SHA256" && \
  pg_restore --list "$NVA_BACKUP_FILE" >/dev/null
test "$(sha256sum -- "$NVA_RELEASE_ARCHIVE" | cut -c1-64)" = "$NVA_RELEASE_SHA256" && \
  tar -tzf "$NVA_RELEASE_ARCHIVE" >/dev/null
```

Un code non nul laisse B4 ouvert. Ne pas adapter un dump SQL texte en le passant à `psql` : ce serait une restauration. `pg_restore --list` ne reçoit **aucune cible DB**. Ne pas appeler `backup:verify` ni le service applicatif de vérification : ils peuvent mettre à jour le registre et l'audit. Un statut `VALID`, un checksum ou une liste d'archive ne prouve pas une restauration.

Le DBA doit fournir séparément la preuve d'une restauration isolée, l'inventaire protégé des configurations/stockages privés et références de clés, la copie séparée et les RPO/RTO. Prévoir une sauvegarde fraîche avant toute future mutation ; sa création n'est pas exécutée ici.

## SQL et permissions à prévoir conditionnellement — aucune exécution autorisée ici

| Ordre après comparaison de cible | Artefacts / droits nécessaires |
| --- | --- |
| 1. Historique Prisma | Comparer les 47 migrations et leurs checksums. Les ajouts WhatsApp connus sont `20261020120000_add_whatsapp_chatbot_admin`, `20261020140000_add_whatsapp_interactive_scenarios`, `20261022120000_add_whatsapp_admission_requests`. Leur nécessité réelle dépend de l'historique cible. Pas de `db push`, reset, `migrate dev`, falsification d'historique ou application globale non revue. |
| 2. Objets Meta manquants | `docs/sql/meta-inbox-schema-reviewed.sql` : quatre tables et sept gardes, hors historique Prisma. DDL non idempotent : ne pas le rejouer sur des objets existants ; examiner les écarts et les verrous sur une restauration avant plan DBA. |
| 3. Rôles dédiés | Scripts `meta-inbox-production-ingress-role.sql` et `meta-inbox-production-worker-role.sql` pour une création absente uniquement ; rôles NOLOGIN initiaux, sans privilèges administratifs. Ne pas les rejouer comme réparation de rôles existants ; authentification à provisionner séparément et en privé. |
| 4. Consentement | `docs/sql/whatsapp-admission-worker-consent-function.sql`, avant les grants/code dépendants. Propriétaire de confiance, SECURITY DEFINER, search_path pg_catalog, EXECUTE refusé à PUBLIC/ingress. |
| 5. ACL effectives | `06-worker-admission-draft-grant.sql` et `07-admin-meta-manual-grants.sql`, avec le vrai rôle web. 06 comporte des REVOKE et restrictions d'INSERT : ce n'est pas un ajout neutre pour l'ancien worker. 07 concerne le rôle web, pas un octroi administratif au worker. |

Séparation attendue : ingress limité à l'entrée Meta ; worker limité au traitement/envoi, lecture métier nécessaire et brouillon, consentement via fonction ; décision et auteur administratifs réservés au circuit web habilité. Worker/ingress sans superuser, BYPASSRLS, CREATE, héritage inattendu, lecture de hash étudiant ou écriture libre des décisions/preuves/auteurs. Examiner aussi les droits hérités et PUBLIC, pas uniquement les GRANT nominatifs. Le compte de diagnostic n'est pas le compte de migration ; la future DDL relève du DBA, jamais des comptes runtime. Aucun droit global ne doit être ajouté pour contourner un refus.

La liste exacte des migrations manquantes, les temps de verrouillage et la compatibilité des données restent **inconnus avant le diagnostic de cible**. Aucune migration de production n'est présentée comme nécessaire par défaut.

## Activation limitée et critères d'acceptation

Pas de liste blanche applicative actuelle. Une liste de testeurs dans un document, un numéro non publié, un cutoff, un lot réduit ou la fenêtre de service ne filtrent pas les destinataires. Exiger la preuve d'une restriction fournisseur effective sur le canal de test choisi, **pour les entrées susceptibles de déclencher des réponses et pour les sorties**, ou un confinement équivalent démontré. Ne pas présumer qu'un numéro de test Meta fournit toutes ces restrictions. Sans cette preuve : NO-GO pilote limité ; pas de contournement par configuration.

Une fois A/B clos et les autorisations distinctes de déploiement et d'envoi obtenues : protocole proposé de deux contacts consentants, trente minutes, trente sorties au plus, un ADMIN et un observateur. Bornes manuelles à approuver, pas des limites automatiques du code. Aucun paiement, certificat ou compte étudiant créé par défaut ; aucune ouverture publique. Utiliser uniquement la fenêtre de service ouverte par le testeur ; hors fenêtre, aucun message libre ni notification administrative sans workflow et modèle approuvés.

Réussite du pilote : accueil/boutons/listes rendus correctement ; questions et contexte corrects ; choix conformes aux sessions réelles ; consentement et une seule demande PENDING visible par l'ADMIN, aucun Enrollment ni annonce de confirmation ; e-mail de test selon autorisation ; relais humain reçu et suspension/reprise/STOP respectés ; un seul worker dans le périmètre ; aucune sortie non autorisée/doublon ; statuts Meta et réception rapprochés, file maîtrisée ; fermeture effective à la borne. Vérifier parallèlement les preuves de fonctionnement du bot actuel sans lui injecter de message de test non autorisé.

Arrêt immédiat : mauvais destinataire, défaut de confinement, concurrence de senders, doublon, réponse après STOP ou pendant relais interdit, fausse confirmation, fuite, mauvaise cible SQL, refus ACL ou perte de contrôle. Proposition à approuver : arrêt à la première erreur Meta 401/403 inattendue ; pause après trois erreurs techniques inattendues consécutives ou un événement inexpliqué de plus de 60 s hors backoff documenté. Fin de fenêtre/borne atteinte : fermer le pilote. Un message DELIVERY_UNCERTAIN n'est pas renvoyé automatiquement.

## Retour arrière exigé avant GO

Préparer et répéter hors production l'arrêt du **seul worker pilote**, la fermeture effective de l'envoi et le retour à une release compatible, sans opération PM2 globale. Préserver événements, consentements, demandes, décisions et clés/versions. Ne pas remettre les envois incertains en file. Le retrait du pilote isolé doit laisser le bot actuel et son routage inchangés : cette propriété doit être attestée par la topologie et la répétition du repli.

En bascule non isolée, l'ancienne release peut échouer sous les nouveaux INSERT restreints. Interdiction de promettre sa reprise, d'élargir automatiquement les grants ou de relancer un second sender. Repli sûr possible : bot arrêté, site maintenu ; il ne satisfait pas une exigence de continuité WhatsApp. Pas de suppression SQL ni restauration automatique de production : une restauration implique une décision DBA sur la perte des données intervenues depuis la sauvegarde.

## Preuves obtenues pendant cette préparation

- Relecture ciblée des rapports et sources de coexistence, runtime, permissions et sauvegardes ; aucune suite fonctionnelle ancienne rejouée.
- Collecteur Node : contrôle de syntaxe et vérification synthétique du masquage des secrets réussis ; son utilisation Linux réelle reste à faire. [Preuve locale](../output/nva-v2-pilot-command-review.json).
- Complément SQL 08 exécuté uniquement sur `127.0.0.1:58432`, `nva_whatsapp_v2_test`, transaction `read_only=on`, COMMIT réussi : fonction et ACL lues ; registres sauvegarde/messages vides dans ce laboratoire. [Journal local](../output/nva-v2-pilot-readonly-supplement.log). Cela valide la sonde, pas les sauvegardes ou l'état de Contabo.
- Aucun accès Contabo, déploiement, redémarrage PM2, changement de secret, migration de production ou message réel.

**Prochaine opération : obtenir le dossier humain A1–A6 et faire exécuter ce lot de lecture seule par l'opérateur Contabo, puis rapprocher ses résultats.** B9 et la restauration nécessitent ensuite une recette fermée autorisée. Aucune preuve disponible ne permet aujourd'hui de recommander le GO pilote.
