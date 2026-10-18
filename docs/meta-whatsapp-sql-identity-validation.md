# NVA ? Validation SQL en lecture seule de PostgreSQL de test

Date : 17 octobre 2026. D?but : 2026-10-17T15:31:12.461Z. Fin : 2026-10-17T15:31:12.524Z.

## 1. Conclusion

**Identit? SQL confirm?e et coh?rente avec le cluster de test attendu.** Une seule connexion ? 127.0.0.1:55432/nva_whatsapp_test ; consultations uniquement, transaction READ ONLY. Les 44 migrations locales correspondent aux 44 migrations r?ellement enregistr?es comme r?ussies, checksums identiques.

Aucune table Meta inbox et aucune table Provider* Gupshup d?tect?e. Les six d?clarations Provider* du sch?ma source ne sont pas mat?rialis?es dans cette base. Les quatre mod?les Meta restent documentaires. Aucune migration ni correction effectu?e.

## 2. Pr?contr?les syst?me et param?tres

Avant connexion, le PID **9292** a ?t? rev?rifi? via postmaster.pid et Win32_Process. Le processus utilise :

```text
D:\NVA-WhatsApp-Test\runtime\postgresql-16.15-edb-verified\bin\postgres.exe
-D D:/NVA-WhatsApp-Test/data -h 127.0.0.1 -p 55432
```

Get-NetTCPConnection confirme une seule ?coute du processus : **127.0.0.1:55432**. Chemin et port du fichier PID ?galement conformes. Ce contr?le a ?t? r?p?t? imm?diatement avant lancement du processus de consultation. Aucun service red?marr? ou autre environnement utilis?.

Les documents de test, le validateur de cible du projet et l'ancien script de validation ont ?t? examin?s comme fichiers, sans les ex?cuter. Le projet pr?voit une URL WhatsApp de test explicite et distincte du processus applicatif ; la base et le r?le runner sont contr?l?s par ses garde-fous. Cette intervention utilise un compte administrateur **de test d?j? existant**, n?cessaire pour lire le r?pertoire r?el et le contr?le syst?me : nva_whatsapp_test_admin. Elle ne valide pas les permissions du runner.

Identifiant du compte et secret issus du fichier DPAPI existant cluster-admin.credentials.clixml. Le mot de passe a ?t? d?chiffr? uniquement en m?moire puis transmis dans l'environnement du processus enfant ; jamais ?crit dans le script, l'URL, le rapport ou les sorties. Le compte attendu a ?t? v?rifi? avant connexion. Aucun utilisateur ou mot de passe cr??/modifi?.

Pas de chargement dotenv, Prisma ni singleton applicatif. Host, port et database cod?s explicitement dans le client de consultation. Variables PG*, DATABASE_URL, TEST_DATABASE_URL, NVA_WHATSAPP_TEST_DATABASE_URL et NODE_OPTIONS h?rit?es exclues du processus enfant ; aucun param?tre de production utilis?. Le fichier .env principal n'a pas ?t? charg? et son empreinte est rest?e inchang?e.

## 3. Identit? du serveur et de la base

| Contr?le SQL | R?sultat |
|---|---|
| Version | **16.15**, version_num **160015** |
| Construction | PostgreSQL 16.15, Visual C++ build 1944, 64-bit |
| Adresse serveur | **127.0.0.1** |
| Port serveur | **55432** |
| listen_addresses | 127.0.0.1 |
| Base courante | **nva_whatsapp_test** |
| Propri?taire de la base | nva_whatsapp_migrator |
| Utilisateur connect? | nva_whatsapp_test_admin |
| R?pertoire r?el | **D:/NVA-WhatsApp-Test/data** |
| Identifiant syst?me | **7696610946073769572** |
| pg_is_in_recovery() | **false** |
| D?marrage postmaster | 2026-10-17T15:24:12.853Z |
| Encodage / collation / ctype | UTF8 / C / C |

Les valeurs d'identit? ont ?t? compar?es aux constantes attendues avant les autres consultations. Toute divergence aurait interrompu la collecte. L'identifiant syst?me a ?t? obtenu par pg_control_system(), pas inf?r? du seul nom de base.

## 4. Lecture seule r?ellement utilis?e

Le client pg a demand? d?s la connexion : default_transaction_read_only=on, statement_timeout=10000 et lock_timeout=2000. Ces derniers sont des param?tres **de session**, sans changement de configuration persistant.

Transaction :

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- SELECT d'identit? et de catalogues uniquement.
ROLLBACK;
```

Valeurs SQL constat?es : transaction_read_only=on, default_transaction_read_only=on, transaction_isolation=repeatable read. Le ROLLBACK cl?t la photographie de consultation ; aucune ?criture applicative ou DDL n'a ?t? ?mise.

Requ?tes limit?es ? l'identit?, aux catalogues pg_database/pg_namespace/pg_class/pg_index/pg_constraint/pg_extension et ? public._prisma_migrations. Aucun SELECT de contenu m?tier, num?ro, utilisateur personnel, conversation ou message WhatsApp. Aucun log de migration d?taill? affich? : seulement un bool?en indiquant sa pr?sence.

Une connexion ferm?e apr?s collecte. Aucun acc?s au port 5432 ou ? une base de production, aucun test d'?criture n?gatif pour tenter de prouver READ ONLY.

## 5. Inventaire Prisma r?ellement appliqu?

Table **public._prisma_migrations pr?sente**.

| Mesure | R?sultat |
|---|---|
| Fichiers migration.sql locaux | 44 |
| Lignes d'historique dans la cible | 44 |
| Migrations termin?es sans rollback, applied_steps_count=1 et sans logs d'erreur | 44 |
| Migration locale absente de l'historique | 0 |
| Migration appliqu?e sans fichier local | 0 |
| Checksum SQL diff?rent du fichier local | 0 |

Le contr?le de r?ussite couvre les 44 lignes : finished_at renseign?, rolled_back_at nul, applied_steps_count=1, logs nul ou vide. Le SHA-256 des octets de chaque migration.sql a ?t? compar? ? son checksum enregistr?. Les anciens rapports ne sont donc plus la seule preuve de l'?tat appliqu? de cette cible.

| # | Migration | ?tat SQL | Checksum local/SQL |
|---|---|---|---|
| 1 | `20260722131415_add_training_sessions` | R?ussie | Conforme |
| 2 | `20260722160000_phone_authentication` | R?ussie | Conforme |
| 3 | `20260724223000_add_student_status` | R?ussie | Conforme |
| 4 | `20260724230000_add_public_course_catalog` | R?ussie | Conforme |
| 5 | `20260724233000_add_self_registration` | R?ussie | Conforme |
| 6 | `20260725000000_add_online_session_details` | R?ussie | Conforme |
| 7 | `20260725003000_add_payment_architecture` | R?ussie | Conforme |
| 8 | `20260725010000_add_free_trial_attendance` | R?ussie | Conforme |
| 9 | `20260725013000_add_admin_course_schedule_configuration` | R?ussie | Conforme |
| 10 | `20260725020000_add_admin_class_meeting_management` | R?ussie | Conforme |
| 11 | `20260726010000_add_course_learning_content` | R?ussie | Conforme |
| 12 | `20260726020000_add_assignments_and_submissions` | R?ussie | Conforme |
| 13 | `20260726030000_link_live_meetings_to_lessons` | R?ussie | Conforme |
| 14 | `20260726040000_add_teacher_management` | R?ussie | Conforme |
| 15 | `20260726050000_add_notifications_and_reminders` | R?ussie | Conforme |
| 16 | `20260726060000_add_whatsapp_delivery` | R?ussie | Conforme |
| 17 | `20260726070000_add_certificate_fees` | R?ussie | Conforme |
| 18 | `20260726071000_unique_certificate_payment_per_enrollment` | R?ussie | Conforme |
| 19 | `20260726072000_add_certificate_verification_snapshots` | R?ussie | Conforme |
| 20 | `20260727142540_assessment_foundations` | R?ussie | Conforme |
| 21 | `20260727144144_recorded_oral_phase2` | R?ussie | Conforme |
| 22 | `20260727151805_live_video_oral_phase3` | R?ussie | Conforme |
| 23 | `20260727154726_written_assessment_phase4` | R?ussie | Conforme |
| 24 | `20260727163000_lms_phase5` | R?ussie | Conforme |
| 25 | `20260727203000_academic_management_phase6` | R?ussie | Conforme |
| 26 | `20260727214500_strict_academic_levels` | R?ussie | Conforme |
| 27 | `20260727223000_simple_finance_phase7` | R?ussie | Conforme |
| 28 | `20260728120000_center_settings_phase9` | R?ussie | Conforme |
| 29 | `20260728200000_production_readiness_phase10` | R?ussie | Conforme |
| 30 | `20260728220000_public_student_placement` | R?ussie | Conforme |
| 31 | `20260730143000_add_course_pricing` | R?ussie | Conforme |
| 32 | `20260730143100_default_course_pricing_mode` | R?ussie | Conforme |
| 33 | `20260730171000_add_enrollment_payment_access_snapshots` | R?ussie | Conforme |
| 34 | `20260730171100_enforce_free_registration` | R?ussie | Conforme |
| 35 | `20260805120000_add_manual_payment_methods` | R?ussie | Conforme |
| 36 | `20260827090000_add_registration_groups_and_forced_password` | R?ussie | Conforme |
| 37 | `20260827130000_add_password_reset_tokens` | R?ussie | Conforme |
| 38 | `20260909180000_add_user_auth_version` | R?ussie | Conforme |
| 39 | `20260910120000_add_password_reset_requests` | R?ussie | Conforme |
| 40 | `20260910200000_link_password_reset_token_to_request` | R?ussie | Conforme |
| 41 | `20260911090000_add_password_reset_delivery_tracking` | R?ussie | Conforme |
| 42 | `20260912190000_add_course_structure` | R?ussie | Conforme |
| 43 | `20261009140000_add_whatsapp_conversations` | R?ussie | Conforme |
| 44 | `20261009150000_add_whatsapp_prospect_follow_ups` | R?ussie | Conforme |

Cette correspondance de l'historique ne constitue pas une comparaison exhaustive de toutes les colonnes, defaults, triggers, ACL et contraintes avec un replay SQL neuf. Aucune commande Prisma de diff, validation, g?n?ration ou migration ex?cut?e.

## 6. Tables Meta et Provider*

### Inbox Meta

Les tables suivantes sont toutes **absentes** :

| Mod?le documentaire | Table propos?e |
|---|---|
| MetaWebhookEndpoint | meta_webhook_endpoints |
| MetaWebhookReceipt | meta_webhook_receipts |
| MetaWebhookEvent | meta_webhook_events |
| MetaWebhookReceiptItem | meta_webhook_receipt_items |

L'inventaire des relations utilisateur n'a trouv? aucun nom commen?ant par meta_webhook_ ou MetaWebhook, dans les sch?mas consult?s. Ces quatre mod?les ne figurent pas dans schema.prisma ; ils existent dans les documents de conception/impl?mentation/revue uniquement. Aucun ?v?nement de l'inbox n'est pr?tendu durable dans cette base ? ce stade.

### Gupshup Provider*

| Mod?le source | Table propos?e | ?tat SQL |
|---|---|---|
| ProviderApplication | `provider_applications` | Absent |
| ProviderDelivery | `provider_deliveries` | Absent |
| ProviderSendAttempt | `provider_send_attempts` | Absent |
| ProviderMessageAlias | `provider_message_aliases` | Absent |
| ProviderWebhookEvent | `provider_webhook_events` | Absent |
| ProviderReconciliationAudit | `provider_reconciliation_audits` | Absent |

Aucune relation utilisateur provider_*/Provider* trouv?e dans les sch?mas consult?s ; aucune migration historique de ces mod?les. Les d?clarations et les relations inverses du sch?ma sont conserv?es, sans tentative de les supprimer ou de cr?er leurs tables.

Le contr?le porte sur les tables/relations. Il ne pr?tend pas inventorier exhaustivement d'?ventuelles fonctions ind?pendantes homonymes ou tous les objets SQL possibles d'une extension.

## 7. ?tat g?n?ral des sch?mas et objets

Un seul sch?ma utilisateur inventori? : **public**, propri?taire pg_database_owner. Les sch?mas syst?me pg_* et information_schema sont exclus de cet inventaire applicatif.

- **70 tables** dans public : 69 correspondant aux mod?les historiques et _prisma_migrations.
- **0 vue/vue mat?rialis?e**, **63 s?quences**.
- Aucun nom de table public suppl?mentaire hors des 69 mod?les historiques et de l'historique Prisma.
- **0 index invalide ou non pr?t** d?tect? dans les sch?mas utilisateur.
- **0 contrainte non valid?e** d?tect?e dans les sch?mas utilisateur.
- Extension inventori?e : plpgsql 1.0, dans pg_catalog.

Ces consultations de catalogue n'?tablissent pas l'int?grit? exhaustive des pages/donn?es, l'exactitude des permissions ou l'absence de donn?es de fixtures. Le contenu des sept tables de fixtures n'a pas ?t? interrog? ; aucune assertion sur leur vacuit? n'est ajout?e.

## 8. Comparaison au sch?ma et divergences

Sch?ma source : **75 mod?les**. Les tables des 69 mod?les historiques sont pr?sentes. Les seuls mod?les source sans table public correspondante sont les six Provider* ci-dessus.

Les documents Meta existants proposent quatre nouveaux mod?les autonomes, avec uniques/FK composites, baux et triggers de manifeste d?crits dans la revue. Ils ne sont pas ajout?s au sch?ma ou ? l'historique par cette intervention.

| Sujet | Constat | Cons?quence |
|---|---|---|
| Historique Prisma/local | 44/44, checksums identiques | Aucune divergence d'historique observ?e. |
| Provider* | 6 mod?les source, 0 table, 0 migration correspondante | Divergence d?clarative connue et confirm?e dans cette cible. |
| Meta inbox | 4 mod?les documentaires, 0 mod?le source et 0 table | Migration Meta toujours ? pr?parer/approuver ; aucun stockage op?rationnel d?duit de l'adaptateur. |
| Diff global du sch?ma | Inclurait aussi le p?rim?tre Provider* non migr? | Ne pas g?n?rer/appliquer aveugl?ment une migration globale. |
| Sch?ma r?el d?taill? | Inventaire et sant? des catalogues seulement | Pas de certification d'absence de drift colonne par colonne. |
| STOP/envoi r?el | Non exerc? ici | Reste une condition bloquante avant activation asynchrone avec senders actifs. |

Empreintes locales, identiques avant/apr?s les consultations :

- schema.prisma : `a7051df24bca10ec6eb338da5a39370c96c2c3469ce5132d6f182d345f8f826a`.
- Manifeste des 44 migrations : `fb28b862e78fc0c0b77ca483ff3dfa42b85d38c52dcfab77fef79f9081f7d967`.
- .env : empreinte compar?e et inchang?e, sans lecture/affichage de ses valeurs dans les sorties.

Le manifeste est d?fini comme SHA-256 de la concat?nation UTF-8 des lignes chemin relatif + espace + SHA-256 des octets + LF, chemins tri?s. Les 44 fichiers SQL individuels ont aussi ?t? rev?rifi?s inchang?s apr?s collecte.

## 9. Artefacts et prochaine ?tape

Fichiers cr??s pour cette validation :

- docs/meta-whatsapp-sql-identity-validation.md : pr?sent rapport.
- output/meta-whatsapp-sql-identity-evidence.json : r?sultats de consultation sans secrets ni donn?es m?tier.
- output/meta-whatsapp-sql-local-inventory.json : inventaire/empreintes locales.
- tmp/meta-whatsapp-sql-identity-readonly.cjs : script de consultation explicite, sans identifiants secrets embarqu?s.

**Recommandation :** demander une autorisation distincte pour valider sur cette cible de test le SQL Meta d?j? propos? et les sc?narios transactionnels/concurrents, avec transport simul? et sauvegarde v?rifi?e. Cette validation n?cessitera des ?critures express?ment autoris?es et un p?rim?tre limit? aux objets Meta ; traiter explicitement l'?cart Provider* avant toute g?n?ration globale de migration. La conformit? de l'identit? et des 44 migrations ne valide pas encore les triggers, contraintes ou courses STOP/envoi.

Toute modification de schema.prisma, cr?ation/application de migration, attribution de permissions, test PostgreSQL d'?criture ou raccordement/activation exige une autorisation distincte. Aucun migrate dev/deploy/reset, db push, CREATE/ALTER/DROP/GRANT/REVOKE, changement de donn?es, red?marrage, worker WhatsApp, appel Meta/Gupshup ou message r?el effectu?.

**Point d'arr?t atteint : consultation SQL termin?e et connexion ferm?e ; attente d'autorisation avant toute migration ou modification.**
