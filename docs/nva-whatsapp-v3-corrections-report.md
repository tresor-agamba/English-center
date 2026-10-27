# NVA WhatsApp V3 — corrections et validation des anomalies bloquantes

Rapport finalisé le 27 octobre 2026 — Africa/Kinshasa. Les journaux conservent les horodatages de leurs exécutions.

## Décision

**Les trois anomalies applicatives sont corrigées et validées localement. GO technique des corrections pour la recette d’un pilote avec relances désactivées.**

**NO-GO opérationnel pour déployer/activer maintenant le pilote sur Contabo** : les vérifications de cible précédemment ouvertes restent non attestées (identité des processus PM2, runtime Linux, état SQL effectif, sauvegarde/repli et confinement du canal pilote). Ce rapport ne les déclare pas closes sur la base de tests locaux. Aucun défaut applicatif bloquant identifié dans les trois corrections ne subsiste au dernier passage.

Cette distinction évite d’assimiler la réussite du laboratoire à une autorisation de déploiement. Les relances restent désactivées. Aucun accès Contabo, déploiement, push GitHub, modification de production/NovanceTech ou appel réel OpenAI/Meta/SMTP n’a eu lieu. Le `.env` réel n’a pas été modifié. Les seules attributions de droits ont été réalisées dans des clusters PostgreSQL neufs, avec données synthétiques.

## 1. Blocage PostgreSQL 42501

### Cause et opérations exactes

La table concernée est `public.whatsapp_prospect_follow_ups`. Les tables de conversations, messages, consentements, admissions et budget IA conservent leurs droits canoniques existants.

| Service | Écriture refusée avec les ACL initiales | Colonnes manquantes |
| --- | --- | --- |
| `whatsappConversationService` | `UPDATE ... SET scheduled_for, template_name, template_language` après réception | `scheduled_for`, `template_name`, `template_language` |
| `whatsappProspectFollowUpService` — réservation | `UPDATE ... SET attempts = attempts + 1` et état PROCESSING | `attempts` ; les droits sur les autres colonnes existaient |
| `whatsappProspectFollowUpService` — acceptation fournisseur | `UPDATE ... SET accepted_at, provider_message_id, status ...` | `accepted_at` ; les autres droits existaient |

Le rôle prévu pour ces opérations est **`nva_meta_inbox_worker_prod`**. Le rôle ingress de réception Meta ne reçoit aucun droit supplémentaire. Le rôle web/admin n’est pas élargi. Les rôles `nva_v3_lab_owner`, `nva_v3_lab_migrator` et `nva_v3_lab_runner` servent uniquement au bootstrap, aux migrations et aux fixtures du laboratoire, pas à l’exécution des scénarios worker.

Avant correction, la branche de report d’échéance testait seulement `followUp48h`, marqueur de version actif par défaut. Elle tentait l’UPDATE même si `prospectFollowUpsEnabled=false` et même sans ligne correspondante. PostgreSQL contrôle les permissions avant de déterminer les lignes touchées ; `UPDATE ... WHERE false` renvoyait déjà 42501.

### Corrections

1. `whatsappConversationService` ne crée ni ne reporte une relance V3 lorsque `prospectFollowUpsEnabled` n’est pas explicitement `true`. Le consentement reste enregistré sans créer de tâche de relance. La compatibilité des configurations historiques injectées dans les anciens tests est conservée.
2. Le script additionnel **`deploy/whatsapp-chatbot/08-v3-worker-followup-columns.sql`** prépare uniquement :

```sql
GRANT UPDATE (scheduled_for,template_name,template_language,attempts,accepted_at)
  ON public.whatsapp_prospect_follow_ups TO nva_meta_inbox_worker_prod;
```

Il ne contient ni GRANT ALL, ni UPDATE de table entière, ni création de rôle, ni LOGIN, ni droit sur les utilisateurs, paiements, inscriptions ou décisions administratives. Il n’active aucune fonctionnalité et ne modifie aucune donnée métier.

Le script est transactionnel, idempotent, limité par un lock timeout et protégé par les gardes de base/endpoint attendus. Il exige le rôle canonique sans privilège d’administration ni héritage/membership et refuse un rôle déjà excessivement privilégié plutôt que de le modifier silencieusement. Il suppose le schéma et le rôle canoniques déjà provisionnés ; ce n’est pas un remplacement du script de création du rôle.

### Validation sous le rôle réellement prévu

Dans le dernier cluster neuf, le script canonique `docs/sql/meta-inbox-production-worker-role.sql` a créé le rôle portant **exactement le nom `nva_meta_inbox_worker_prod`**. Seuls les littéraux de base/port ont été adaptés pour le laboratoire ; ni le nom du rôle, ni les listes de droits, ni les contrôles de sécurité n’ont été assouplis. Une URL propre à ce rôle est utilisée par un vrai client Prisma et les transactions passent le contrôle `verifyWorkerIdentity` du worker existant.

Avant le correctif de droits, avec les cinq permissions toujours absentes :

- réception, choix FR/EN et préparation IA fonctionnent avec relances désactivées ;
- consentement marketing enregistré, aucune relance créée ;
- inscription WhatsApp complète vers une demande **PENDING**, par la fonction de consentement sécurisée, sans Enrollment ni décision administrative.

Après correctif : mêmes parcours, plus création de relance, changement de langue du template et report d’échéance, concurrence de deux services worker avec une seule soumission simulée, `attempts=1`, enregistrement de `accepted_at`, puis annulation STOP. Le worker ne peut toujours ni lire `password_hash`, ni modifier les enrollments ou le statut d’une admission, ni modifier le consentement/destinataire d’une relance. Il ne dispose d’aucun UPDATE global, DELETE, TRUNCATE ou CREATE sur le périmètre vérifié.

Le correctif a été exécuté **deux fois** dans ce cluster : réussite et droits identiques. Le script non adapté, exécuté sur la base de laboratoire au lieu de sa cible déclarée, a correctement refusé cette cible et la transaction a été annulée. Aucune version de ce script n’a été exécutée en production.

### Application éventuelle au déploiement — non exécutée

Le pilote relances désactivées fonctionne avec les ACL initiales grâce à la suppression des écritures de planification. Le correctif des cinq colonnes est nécessaire avant utilisation réelle des relances V3 et doit être revu avec le DBA lors de la préparation du paquet SQL.

Après contrôle privé de l’instance NVA, du rôle et des droits effectifs, la commande candidate est :

```sh
# Seulement dans une intervention de déploiement distincte et autorisée.
# NVA_DBA_ROLE doit désigner le rôle DBA effectivement vérifié, sans secret en argument.
psql -X -h 127.0.0.1 -p 5432 -d english_center \
  -U "${NVA_DBA_ROLE:?Définir le rôle DBA NVA vérifié}" \
  -v ON_ERROR_STOP=1 -f deploy/whatsapp-chatbot/08-v3-worker-followup-columns.sql
```

Le nom de base/port ci-dessus est celui des gardes du projet, pas une attestation de configuration actuelle de Contabo. Ne pas contourner un refus de cible ou de privilèges. Examiner les ACL existantes au lieu d’accorder des droits globaux. Aucune migration Prisma nouvelle n’est nécessaire : il s’agit de permissions sur des colonnes existantes.

## 2. Affirmations commerciales inventées

### Cause

Le prompt demandait des réponses fondées sur les faits, mais le service acceptait du texte libre dès lors que les nombres semblaient présents dans les faits et que quelques formulations interdites n’étaient pas trouvées. Des paraphrases de confirmation, des moyens de paiement ou des accréditations pouvaient ainsi passer sans correspondre aux faits sélectionnés.

Les trois réponses de la validation initiale ont été rejouées sans appel réel : PayPal, certificat reconnu dans le monde entier, dossier accepté. Elles ne sont désormais plus publiées.

### Architecture corrigée

L’API Responses retourne maintenant **un plan de dialogue**, via un schéma JSON strict :

```json
{
  "language": "fr",
  "factIds": ["c1_price"],
  "opening": "budget",
  "followUp": "level"
}
```

`opening` et `followUp` sont des enums, pas du texte. Le service rend la réponse à partir de deux sources autorisées :

- les faits commerciaux construits côté serveur à partir du catalogue/sessions NVA et de la politique commerciale existante ;
- une bibliothèque relue de formulations FR/EN d’accueil, d’écoute, de budget, d’horaires, de respect du refus et de questions de qualification.

**Aucun champ textuel produit par le modèle, aucun nom ou message du prospect n’est interpolé dans le texte de sortie.** Les champs supplémentaires, les anciens `reply` et les identifiants invalides ne deviennent jamais des phrases à envoyer. Un plan non vérifiable revient aux seuls faits officiels sélectionnés et vérifiés ; s’il n’en reste aucun, le service de completion utilise le repli existant dans la langue du prospect. Aucun outil ni action administrative n’est exposé au modèle.

La compatibilité avec les anciens résultats contenant uniquement `language` et `factIds` conserve un rendu de faits canoniques, sans texte libre. Elle ne réintroduit pas l’ancien contrôle par regex. La fonction de compatibilité `validateReply` n’accepte plus qu’une égalité exacte avec des faits officiels complets.

Le rendu varie les formulations en tenant compte des derniers messages, pose au plus une question dans le cas usuel, évite d’ajouter une question si le fait `clarify` en contient déjà une et limite les invitations d’inscription répétées. Une réponse trop longue est refusée plutôt que de couper une condition commerciale. La persuasion repose sur les faits réels présentés avec une formulation chaleureuse ; aucune promesse supplémentaire n’est générée.

Exemple de composition autorisée :

> Je comprends que le budget compte dans votre décision.
>
> Anglais général : 60 USD par niveau.
>
> Comment décririez-vous votre niveau actuel en anglais ?

### Régressions ajoutées

Vingt affirmations synthétiques en français/anglais couvrent les trois cas initiaux et des variantes de promotions, garanties, réussite/emploi, partenariats, accréditation, paiement libre, disponibilités et conditions erronées utilisant pourtant un nombre officiel. Chaque cas est testé :

- sans fait autorisé : aucun texte inventé retourné ;
- avec un fait officiel : uniquement le fait canonique comme secours ;
- comme champ supplémentaire d’un plan : le champ libre est ignoré et le rendu revient au fait officiel.

S’ajoutent les identifiants malveillants, les faits inexistants, la composition FR/EN, le nombre de questions, la variation des formulations et la limitation des invitations répétées. Le diagnostic initial retourne maintenant **`unsupportedClaimsAccepted: 0`**, contre 3 avant correction.

### Limite assumée

Le modèle choisit l’ordre et la pertinence des éléments autorisés ; il ne paraphrase plus librement les affirmations commerciales. Le système peut donc être moins varié qu’une génération libre. C’est le compromis nécessaire pour vérifier réellement la provenance des promesses. La qualité des faits dépend toujours du catalogue et de la politique commerciale NVA relus par les responsables ; aucun audit des données de production n’a été effectué.

## 3. Préférences linguistiques

### Cause et correction

L’ancienne détection reposait sur quelques mots et ne reconnaissait pas « English please » ou « Je préfère l’anglais ». La langue déclarée par le modèle pouvait aussi décider de la langue de sortie.

La détection normalise les accents et apostrophes, traite d’abord les demandes explicites (`English please`, `Je préfère l’anglais`, `Parlez-moi en anglais`, `French please`, etc.), puis examine plusieurs indices linguistiques concordants. Un seul mot anglais de vocabulaire comme `beginner`, `certificate` ou `budget` ne provoque pas de bascule. Les réponses courtes (`OK`, etc.) conservent la préférence. Certaines formulations négatives mixtes comme « English please, not French » sont également couvertes.

La préférence reste persistée dans l’`engineState` existant, sans migration. Le rendu utilise la langue déterminée côté serveur, même si un fournisseur simulé déclare l’autre langue dans son plan. Les textes officiels et les formulations relues possèdent leurs versions FR/EN.

Les deux cas initiaux produisent désormais EN. Les conversations mixtes sont testées au niveau du moteur avec plusieurs messages successifs et sur PostgreSQL sous le rôle worker exact. Des formulations ambiguës ou des langues tierces peuvent encore nécessiter une demande explicite de préférence ; aucune prétention de détection linguistique universelle n’est faite.

## 4. Résultats de validation

Dernier cluster : **`output/nva-v3-corrections/run-1793046662647/`**, PostgreSQL 16.15, écoute loopback `127.0.0.1:59432`, base neuve `nva_whatsapp_v3_test`. Aucun dump ni ancienne base réutilisés. Bootstrap et migrations limités à ce cluster ; identifiants temporaires en mémoire et expurgés des journaux. Les deux clusters créés pour cette intervention sont arrêtés, sans fichier `postmaster.pid` restant.

| Commande / phase | Résultat |
| --- | --- |
| `npm run test:whatsapp:v3` | **73/73** réussis |
| `npm run test:whatsapp:release` | **415/415** réussis |
| `npm run test:whatsapp:v3:corrections` | **48/48** nouveaux tests réussis |
| PostgreSQL métier, `postgres-tests.log` | **9/9** réussis |
| Worker canonique avant patch, `worker-before-patch.log` | **5/5** réussis, sans les cinq nouveaux droits |
| Worker canonique après patch, `worker-after-patch.log` | **8/8** réussis |
| Application SQL deux fois + refus de mauvaise cible | **Réussis**, `patch.json` |
| Prisma validate, URL locale fictive explicite | **Code 0**, schéma valide |
| Compilation EJS | **164 vues compilées** |

Aucun test ignoré dans les commandes ci-dessus. Les suites se recoupent : ces comptes ne doivent pas être additionnés comme nombre de scénarios uniques.

Le cas V3 existant qui attendait une phrase libre a été adapté au nouveau contrat de plan, sans supprimer son contrôle FR/EN. Les fixtures PostgreSQL utilisent aussi ce contrat. Les autres assertions métier restent actives, notamment menus, inscription sécurisée, contexte périmé, erreurs OpenAI, quota quotidien, timeouts, STOP, consentement, fenêtre de service, déduplication et reprise.

### Preuves

- `output/nva-v3-corrections/v3-tests.txt`, `non-regression.txt`, `security-language-tests.txt`, `prisma.txt`, `ejs.txt`.
- `output/nva-v3-corrections/offline-audit.json` : zéro des trois inventions acceptée, langues corrigées, contrat `gpt-4.1-mini`, zéro appel fournisseur réel.
- Dans le dernier cluster : `identity.json`, `business-evidence.json`, `worker-before-evidence.json`, `worker-after-evidence.json`, les trois journaux de tests, `patch.json`, `result.json` et `stop.log`.
- `worker-acl-probe.json` conserve une reproduction volontaire de l’ancienne liste de droits sur un rôle NOLOGIN de diagnostic ; son 42501 est attendu et historique. Il ne décrit pas le rôle canonique après application du patch.

Les tests sous le rôle worker invoquent le contrôle d’identité SQL existant du runtime. Ils utilisent les véritables services et transactions PostgreSQL ; ils ne remplacent pas le contrôle du routage/callback Meta ou le cycle PM2 réel du serveur.

## 5. Fichiers modifiés ou ajoutés

| Fichier | Changement |
| --- | --- |
| `src/services/whatsappAdvisorPolicy.js` | Bibliothèque bilingue, rendu contrôlé, détection de langue et compatibilité stricte |
| `src/services/whatsappQuestionAIService.js` | Plan JSON strict et rendu sans prose modèle, langue imposée côté serveur |
| `src/services/whatsappConversationService.js` | Aucun scheduling/report V3 quand les relances sont désactivées |
| `deploy/whatsapp-chatbot/08-v3-worker-followup-columns.sql` | Nouveau correctif idempotent, cinq droits de colonne uniquement |
| `deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs` | Flags V3 explicitement désactivés dans le candidat |
| `deploy/whatsapp-chatbot/operator-functions.sh` | Restart fermé neutralise aussi les flags V3 hérités |
| `tests/whatsappV3Corrections.test.js` | 48 tests commerciaux, linguistiques et configuration de livraison |
| `tests/whatsappAdvisorV3.test.js` | Fixture de conversation adaptée au plan autorisé |
| `tests/whatsappV3Postgres.integration.test.js` | Fixtures de plan dans le parcours PostgreSQL existant |
| `tests/whatsappV3WorkerPostgres.integration.test.js` | Nouveau parcours sous le rôle canonique, permissions positives et négatives |
| `scripts/validateWhatsAppV3PostgresLab.js` | Provisionnement du rôle exact, tests avant/après, garde de cible et idempotence |
| `scripts/auditWhatsAppV3FinalOffline.js` | Preuves corrigées écrites séparément des preuves historiques |
| `package.json` | Commande des nouveaux tests isolés |
| `docs/nva-whatsapp-v3-corrections-report.md` | Présent rapport |
| Rapports de validation/livraison V3 précédents | Renvoi vers ce bilan, sans effacer les anciens constats |

Aucun changement de `schema.prisma`, dépendance npm, `.env` réel ou fichier de production. Aucun script de déploiement n’a été exécuté. Le fichier canonique de création du rôle conserve son historique ; le changement de droits est porté explicitement par le patch 08.

## 6. Relances désactivées et déploiement pilote

La configuration par défaut conserve :

```dotenv
NVA_FOLLOWUPS_ENABLED=false
NVA_FOLLOWUPS_DRY_RUN=true
```

Le candidat PM2 et le redémarrage fermé imposent maintenant ces deux valeurs, ainsi que `NVA_AI_ENABLED=false` dans la phase fermée. L’IA ne doit être activée séparément que dans le périmètre de recette/pilote autorisé. L’existence du correctif SQL ne doit jamais servir d’interrupteur fonctionnel.

Les noms PM2 restent ceux **déclarés** dans le dépôt, pas des noms actifs certifiés. Le contrôle `nva_check_context` exige toujours le processus effectif et son répertoire réel ; aucune commande ne suppose que le nom actif est `english-center`. Le fichier candidat reste un artefact de revue, à ne pas démarrer à côté de processus NVA existants.

## 7. Risques résiduels et portée du GO

Les trois blocages de code sont levés. Restent à qualifier, dans leurs périmètres autorisés :

- le build et le cycle de vie Linux/PM2 exacts, les identités et ACL effectives de la cible et les objets Meta présents ;
- les sauvegardes/repli et le confinement du pilote, déjà ouverts dans le dossier opérationnel précédent ;
- la pertinence des plans et la latence du modèle réel `gpt-4.1-mini` : aucun appel réel n’a été autorisé ; le contrat Responses/JSON a été vérifié localement et avec [OpenAI Docs](https://developers.openai.com/api/docs/guides/structured-outputs) ;
- la qualité et la fraîcheur des données NVA officielles, l’historique limité de conversation et les cas linguistiques ambigus ;
- avant toute future activation des relances : statut Meta réellement approuvé, IDs et langues des templates, permission du token, revue de simulation et activation séparée. Ces points ne sont pas réputés vérifiés par des mocks.

**Verdict demandé : NO-GO opérationnel à ce stade pour un déploiement pilote, même relances désactivées, tant que les contrôles de cible et d’exploitation déjà ouverts ne sont pas attestés. Les corrections locales sont techniquement validées et n’introduisent plus les trois anomalies applicatives identifiées. Aucun nouveau défaut applicatif bloquant n’a été observé.**

Les appels réels à OpenAI/Meta et toute intervention de déploiement restent soumis à une autorisation distincte ; aucune activation ni intervention de ce type n’a été effectuée.
