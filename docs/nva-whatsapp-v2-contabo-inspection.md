# Inspection Contabo — lot soumis à autorisation

25 octobre 2026. Référence : [préflight](nva-whatsapp-v2-pilot-preflight.md). **Aucune commande distante exécutée.** La présente mission autorise la préparation ; elle exige une autorisation explicite avant l'accès distant. Les résultats du serveur restent inconnus. GO laboratoire maintenu, **NO-GO pilote / public**.

## Revue locale du lot

Collecteur examiné : aucun import applicatif, sous-processus, réseau, écriture ou signal. Lecture des processus et de quelques fichiers existants seulement. Ajout d'un état Linux borné et de mentions explicites : état PM2 non interrogé, environnement de lancement seulement. Les valeurs chargées ultérieurement par dotenv ne sont pas attestées par `/proc`. Un PID vivant n'est pas une preuve de bon fonctionnement. Le dump PM2 reste une configuration sauvegardée et peut être périmé.

Les diagnostics 03/04/05/08 ont été relus : transactions READ ONLY, délais, aucune DDL/DML ou fonction métier appelée. Les définitions libres des defaults, contraintes, index, triggers et paramètres de fonctions sont désormais remplacées par des empreintes dans les sorties concernées. Le complément 08 expose un booléen de conformité du search_path plutôt que ses valeurs libres. Les fichiers restent locaux : aucune copie distante effectuée.

Ces commandes ne modifient pas volontairement l'état applicatif ou PostgreSQL. Elles engendrent néanmoins une connexion et peuvent produire des traces d'accès normales du système. La lecture d'archives consomme des ressources : arrêter en cas de pression serveur. Les métadonnées et noms d'objets sont destinés à l'opérateur habilité ; ne pas publier un transcript brut. Les erreurs clients peuvent contenir des chemins et identités : les revoir avant partage. Aucune garantie absolue sur le contenu arbitraire d'une installation compromise n'est déduite du filtrage.

## Commandes exactes proposées

Les variables ci-dessous doivent être renseignées par l'opérateur à partir de la cible confirmée. Ne fournir aucun mot de passe, token ou URL de connexion. Utiliser les binaires existants de confiance ; aucun npm/npx, import de code actif ou installation. `node --version` décrit ce binaire, pas automatiquement celui de chaque PID ; rapprocher les chemins d'interpréteur du collecteur.

```bash
NVA_APP_DIR=/chemin/absolu/nva-confirme
NVA_DIAG_DIR=/chemin/absolu/diagnostics-revus
uname -srm
node --version
openssl version
psql --version
pg_dump --version
pg_restore --version
command -v node npm pm2 psql pg_dump pg_restore
systemctl list-units --type=service --all --no-pager --plain
systemctl list-timers --all --no-pager --plain
node "$NVA_DIAG_DIR/inspect-contabo-pilot.cjs" "$NVA_APP_DIR"
```

Pour relever npm sans lancer sa CLI ni charger ses hooks, renseigner le chemin absolu du package.json du paquet npm existant et le lire comme donnée :

```bash
node -e 'const f=require("node:fs");try{const p=JSON.parse(f.readFileSync(process.argv[1],"utf8"));if(p.name!=="npm"||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(p.version))throw Error();console.log("npm_package_version="+p.version)}catch{console.error("NPM_PACKAGE_UNVERIFIED");process.exitCode=2}' "$NVA_NPM_PACKAGE"
```

Chemins facultatifs du collecteur : `NVA_PM2_PACKAGE` (package.json PM2) et `NVA_PM2_DUMP` (dump existant). Ne pas créer un dump. Aucun `pm2 jlist/env/start/restart/reload/save`, `systemctl restart`, `nginx -T`, `cat .env`, affichage d'environnement/cron/logs bruts ou GET applicatif. Le lot ne prétend pas fournir l'état interne PM2 : demander au propriétaire une attestation existante expurgée et rapprochée des PID, sans lui faire lancer une commande hors du lot approuvé.

SQL : service libpq **existant**, protégé et confirmé par le DBA, sans connexion distante additionnelle ni création de credentials :

```bash
NVA_DB_SERVICE=service_existant_confirme
NVA_EXPECTED_DB=english_center
NVA_APP_ROLE=role_web_confirme
NVA_INGRESS_ROLE=nva_meta_inbox_ingress_prod
NVA_WORKER_ROLE=nva_meta_inbox_worker_prod
for diagnostic in 03-contabo-readonly-structure.sql 04-contabo-readonly-catalog.sql 05-contabo-readonly-worker.sql 08-pilot-readonly-supplement.sql; do
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -w "service=$NVA_DB_SERVICE" \
    -v expected_database="$NVA_EXPECTED_DB" -v nva_app_role="$NVA_APP_ROLE" \
    -v nva_ingress_role="$NVA_INGRESS_ROLE" -v nva_worker_role="$NVA_WORKER_ROLE" \
    -f "$NVA_DIAG_DIR/$diagnostic" || { printf '%s\n' 'INSPECTION_INCOMPLETE'; break; }
done
```

Les diagnostics doivent déjà être disponibles dans un emplacement approuvé, ou un transfert limité de ces artefacts doit être autorisé séparément ; ne pas écrire dans le répertoire actif. Une erreur/absence/visibilité partielle laisse le point ouvert. Ne pas corriger une permission ou un schéma pour poursuivre.

Pour les archives existantes : utiliser exactement le bloc `stat`, comparaison SHA-256, `pg_restore --list` sans cible et `tar -tzf` du [préflight](nva-whatsapp-v2-pilot-preflight.md), avec les chemins et empreintes de référence confirmés. Pas de création, restauration, nettoyage ou vérification via le service applicatif. Obtenir aussi l'attestation expurgée des jobs de sauvegarde (dernière réussite, calendrier, stockage séparé et rétention) et le procès-verbal de restauration isolée. Les lignes cron identifiées par le collecteur ne prouvent pas l'exécution réussie.

## Matrice de continuité à compléter sur preuves

| Élément ancien / V2 | Preuve à rapprocher | État aujourd'hui |
| --- | --- | --- |
| Numéro et compte Meta | Empreintes des identités + attestation console du propriétaire | Inconnu sur Contabo |
| Webhook et abonnement | Configuration enregistrée attestée, route déployée identifiée, app concernée ; pas de token ou URL avec secret | Inconnu |
| Base PostgreSQL | Identité de connexion et namespace réseau, pas seulement nom identique | Inconnu |
| Tables de messages | Relations et schéma cible, chemins réellement utilisés par chaque release | Inconnu |
| Mécanisme d'envoi | PID/cwd/interpréteur, flags, services/cron/autres utilisateurs et périmètre fournisseur | Inconnu |

Un service utilisant Meta hors du répertoire NVA peut échapper au collecteur : inventaire complémentaire par le propriétaire indispensable. Le runtime déployé et ses chemins doivent être rapprochés de la release locale avant toute conclusion. L'identité et les capacités du webhook ne sont pas vérifiables intégralement par ce seul lot : attestation privée de la console Meta nécessaire, aucune modification ni POST de test.

## Confinement et basculement proposés

Option la plus sûre pour préserver les prospects : canal de recette indépendant, sans modification du webhook actuel, base et contexte d'exécution isolés, et rejet **avant traitement V2** de tout expéditeur hors liste autorisée. Le canal ne doit pas détourner les prospects habituels. Si une restriction fournisseur est proposée, démontrer qu'elle couvre les entrées et les sorties ; une restriction de destinataires d'envoi seule est insuffisante.

Ce filtre d'entrée/sortie n'existe pas dans le code local actuel. Si le fournisseur ne garantit pas le confinement complet, une correction applicative dédiée sera nécessaire avant pilote, à développer/tester en laboratoire après décision de périmètre. Elle devra filtrer sur identité normalisée issue du webhook signé, avant le moteur et toute écriture métier V2 ; pour un canal partagé, aiguiller les non-autorisés exclusivement vers le comportement historique prévu et les callbacks vers leur propriétaire, avec un seul arbitrage d'envoi et une déduplication commune. Ce routage n'est ni implémenté ni autorisé à être installé ici. Ne pas ajouter un filtre tardif d'envoi qui laisserait traiter les prospects par V2.

Le simple partage de la base présente déjà un obstacle confirmé localement : un endpoint Meta actif bloque le chemin historique sans barrière Meta. Les flags historiques actifs sont également incompatibles avec le worker V2. Le runtime de production impose localhost:5432/english_center et ses rôles dédiés : une isolation doit respecter ces gardes dans un namespace indépendant, sans les contourner. Aucune promesse de coexistence sur la même base/numéro n'est possible en l'état.

Sur canal isolé : conserver l'ancien service intégralement inchangé ; préparer V2 transports fermés, vérifier la liste autorisée et les files, puis n'activer qu'un seul worker pilote après autorisation ultérieure. Sur canal partagé, ne pas activer avant réalisation et validation d'un routage exclusif compatible ; arrêter/figer l'ancien propriétaire, réconcilier messages en vol et résultats incertains, transférer la propriété au worker unique, sans rejouer les anciens envois. Ce second scénario implique une bascule et une interruption possible ; ne pas le présenter comme une continuité démontrée.

Retour arrière : retirer uniquement le périmètre pilote isolé, préserver preuves/consentements et ne pas renvoyer les résultats incertains. Sur base partagée, l'ancienne release peut être incompatible avec les nouveaux INSERT restreints : pas de réouverture de grants ni relance automatique du sender historique. Une restauration de production n'est jamais automatique.

## Décision et prochaine autorisation

**NO-GO pilote** : accès réel non autorisé, topologie et état inconnus ; confinement d'entrée non démontré ; sauvegarde restaurable et repli compatible non attestés ; autres A/B du préflight toujours ouverts sans preuve nouvelle. Ces inconnues ne sont pas des pannes serveur constatées. Les incompatibilités de coexistence et l'absence de filtre sont des constats locaux.

Pour lancer uniquement l'inspection, obtenir : autorisation explicite du lot, alias SSH/cible et utilisateur habilité, chemin actif NVA, emplacement des diagnostics approuvés (ou autorisation de leur transfert hors application), service libpq existant et rôles non secrets, chemins des archives et manifeste de confiance. Ne transmettre aucun secret dans la conversation. Cette autorisation n'inclura ni déploiement, ni restart, ni mutation SQL, ni modification Meta, ni envoi.
