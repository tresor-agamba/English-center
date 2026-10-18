# NVA — Phase 4A : stockage durable Gupshup, sans migration

Date : 16 octobre 2026. Implémentation locale non raccordée. Aucun accès à PostgreSQL, appel fournisseur, changement de permissions ou activation.

## Résultat et périmètre

Les six modèles du design de phase 3 sont déclarés dans `prisma/schema.prisma`. Le repository utilise un client Prisma injecté et des transactions sérialisables ; aucun singleton applicatif ni connexion n’est créé lors de son import. Les événements synthétiques peuvent être chiffrés, enregistrés, dédupliqués, réservés et corrélés à une livraison exacte. Les événements réels restent refusés inconditionnellement par le vérificateur de phase 2, inchangé.

Il s’agit de primitives de persistance, pas d’une activation du moteur : aucune route, aucun job, aucun worker, aucun transport réseau et aucun effet métier ne sont raccordés. Une résolution prête reste stockée en WAITING_BINDING avec READY_NO_WORKER_ATTACHED ; elle n’est jamais marquée traitée sans application réelle de l’effet.

## Fichiers

Fichier existant modifié : `prisma/schema.prisma` uniquement.

Fichiers créés :

- `src/services/providers/gupshupDurableStore.js` : repository cloisonné et transactions.
- `src/services/providers/gupshupPayloadCipher.js` : chiffrement AES-256-GCM avec clé injectée, nonce aléatoire et données associées liées à l’application/version de clé.
- `tests/gupshupDurableStore.test.js` : 27 tests isolés.
- `tests/helpers/gupshupPersistenceMock.js` : mock transactionnel avec rollback et injections de panne ; aucun accès SQL.
- `output/gupshup-phase4a-isolated.log` : journal de la suite isolée.
- Le présent rapport.

Les seuls ajouts aux modèles existants sont les relations inverses techniques : User.providerReconciliationAudits ; WhatsAppConversationMessage.providerDeliveries/providerInboundEvents ; WhatsAppDelivery.providerDeliveries ; WhatsAppProspectFollowUp.providerDeliveries. Aucune colonne, contrainte, relation préexistante ou règle métier n’a été modifiée.

## Modèles, relations et contraintes représentées

| Modèle / table | Contenu et contraintes Prisma |
|---|---|
| ProviderApplication / provider_applications | Fournisseur, environnement, applicationKey, identité externe, famille/version, paramètres de vérification et références de secrets seulement ; activations false et authMethod reject par défaut. Uniques fournisseur/environnement/clé, ID externe et nom externe. |
| ProviderDelivery / provider_deliveries | Trois FK optionnelles typées vers les cibles existantes, uniques individuellement sans applicationId ; FK application ; activeAttempt composite application/livraison/essai. |
| ProviderSendAttempt / provider_send_attempts | Numéro, operationKey, digest, état, IDs, jeton et dates de dispatch ; FK composite application/livraison ; uniques par application et numéro/opération/soumission/canonique, clés composites de référence. |
| ProviderMessageAlias / provider_message_aliases | Type et ID opaque exact ; unique application/type/ID ; FK composites application/essai et application/événement source. |
| ProviderWebhookEvent / provider_webhook_events | Inbox chiffrée, empreintes distinctes identité/contenu, IDs externes, état, rétention, compteurs et bail avec génération ; unique application/version/dedupKey ; FK application, essai cloisonné et message entrant. |
| ProviderReconciliationAudit / provider_reconciliation_audits | Action structurée, raison, preuve référencée, acteur User optionnel ; FK composites application/événement et application/essai ; API sans update/delete de l’audit. |

UUID applicatifs, dates techniques TIMESTAMPTZ(3), BYTEA pour empreintes/payload, BIGINT pour génération, VARCHAR bornés pour les identifiants. Aucune extension PostgreSQL imposée. Tous les nouveaux liens historiques utilisent RESTRICT, y compris les mises à jour de clés.

Prisma 6.19.3 accepte ces relations composites, dont la relation cyclique activeAttempt. L’audit n’a pas de FK directe vers application : sa présence dans ce périmètre sera garantie par au moins une cible obligatoire via CHECK et une FK composite.

### Contraintes SQL obligatoires restant à écrire dans une migration autorisée

Le schéma Prisma seul ne représente pas tous les CHECK. Ils ne sont pas supposés présents dans PostgreSQL. Ne pas générer puis appliquer une migration sans les compléter :

1. Application : valeurs fermées provider/environment/authMethod ; inboundEnabled exige méthode confirmée, secretReference et authConfirmedAt ; identité immuable après usage (droits de colonnes/trigger à concevoir).
2. Delivery : exactement une des trois cibles non nulle, cohérente avec deliveryKind. La direction OUTBOUND est contrôlée dans le repository ; une garantie contre des écritures SQL directes exige un trigger de contrainte revu séparément.
3. Attempt : numéro > 0, digest de 32 octets, état fermé ; DISPATCHING exige token/date ; ACCEPTED exige IDs ; HTTP 100–599 ; cohérence des dates/états et rejet définitif. Le repository n’offre aucune transformation UNCERTAIN → REJECTED ni autorisation de nouvel envoi pour cet état.
4. Alias : types fermés, IDs ASCII visibles bornés à 512, appartenance à une application identique via les FK composites.
5. Inbox : kind/state/status fermés et cohérents, digests de 32 octets, dedupVersion > 0, receiptCount > 0 et compteurs non négatifs ; token/owner/expiry tous présents en PROCESSING et nuls hors PROCESSING ; génération >= 0 et > 0 en PROCESSING ; payload traitable exige ciphertext/référence de clé et rétention cohérente ; état expiré/quarantaine avec raison.
6. Audit : au moins une cible ; actions fermées ; APPROVE_BINDING exige événement/essai/acteur/preuve. Aucun chemin APPROVE_BINDING n’est exposé dans cette phase : autorisation humaine, preuve vérifiable et double revue restent à implémenter.

Le choix de chaînes avec futurs CHECK évite d’introduire des enums PostgreSQL dans cette phase. Les uniques nullable Prisma utilisent la sémantique PostgreSQL habituelle des NULL distincts ; pour les trois cibles, cela protège les valeurs renseignées comme les uniques partiels du design. Des index uniques partiels physiques pourront être choisis dans la migration, sans perdre cette garantie.

### Index

Déclarés : queue (applicationId,state,nextProcessAt,firstReceivedAt,id), récupération des baux (applicationId,state,leaseExpiresAt,id), recherches des deux identifiants externes, exploitation par état/date, expirations payload/tombstone, alias par essai, essais par état/date de dispatch, audits par événement et essai.

Les index de queue/bail/identifiants/dispatch sont volontairement des index ordinaires dans la représentation Prisma 6.19.3. La migration devra les remplacer ou compléter par les index partiels du design après revue des plans : états éligibles, PROCESSING, WAITING_CORRELATION et DISPATCHING. Les index d’unicité composites sont également nécessaires aux FK ; ne pas les supprimer lors de cette optimisation.

## Contrats de persistance

| Méthode | Garantie / limite |
|---|---|
| receiveRealWebhook | Refus immédiat par le vérificateur existant, avant toute transaction ; aucun booléen trusted ni nom de méthode d’authentification ne contourne le refus. |
| receiveSimulated | Réservé à environment=test, NODE_ENV non production et application désactivée. Marque explicitement authenticationMethod=simulation. Ne constitue jamais une preuve d’authentification réelle. |
| inspect | Lecture d’un UUID seulement dans le périmètre fournisseur/environnement/application capturé à la construction. |
| prepareAttempt | Exige la cible exacte OUTBOUND/notification/relance et un claim NVA PROCESSING avec le compteur attendu. Refuse une cible déjà affectée à une autre application, une opération contradictoire et un essai antérieur non résolu. |
| beginDispatch | CAS PREPARED → DISPATCHING, contrôle claim et essai actif, un seul jeton retourné. Aucun appel HTTP effectué. Un deuxième appel ne reçoit pas d’autorisation d’envoi. |
| recordResponse | Associe la réponse au token d’essai exact, persiste canonique et alias atomiquement, réveille les callbacks en attente. Une réponse tardive peut résoudre UNCERTAIN, sans refaire le POST ni modifier NVA. |
| markUncertain | DISPATCHING → UNCERTAIN seulement avec le token exact. |
| claim | Temps PostgreSQL via clock_timestamp(), transaction Serializable, sélection puis CAS état/génération ; génération incrémentée et token unique. Pas de verrou JavaScript présenté comme garantie SQL. |
| resolve | Cherche exclusivement les alias exacts du périmètre. Conflit → quarantaine/audit ; absence de clé commune → WAITING_CORRELATION/audit ; essai connu → contrôle essai actif, ID et compteur persistés NVA. Aucun statut métier modifié. |
| defer | Retry du traitement inbox seulement, backoff exponentiel borné, quarantaine à 10 essais. Aucune consommation de tentative d’envoi. |
| recover | Dispatch interrompu → UNCERTAIN ; événement au contenu expiré → EXPIRED conservant tombstone/raison. Les baux expirés sont repris par claim ; aucun envoi ou reset d’essai. |

La stratégie de réservation utilise Serializable + CAS, alternative correcte au SKIP LOCKED proposé : un conflit de sérialisation impose un nouveau snapshot. Trois tentatives de transaction au maximum pour P2034/P2002, puis erreur propagée ; ce retry ne contient ni réseau, ni effet métier, ni callback arbitraire. À charge élevée, contention/famine possible : les performances et la correction MVCC restent à éprouver dans les futurs tests PostgreSQL. Aucun engagement d’exactement une fois.

Le repository n’ouvre aucune transaction longue autour d’un envoi. Il ne fournit ni purge, ni administration d’application, ni modification d’audit historique, ni réconciliation manuelle, ni API d’application de statut. Ces opérations requièrent les étapes ultérieures décrites ci-dessous.

## Identité, callbacks précoces et absence de perte silencieuse

Clé v1 : ID WhatsApp entrant indépendant de l’heure d’arrivée ; statut/transport identifié par type, paire d’IDs, statut et temps externe facultatif. Le digest de contenu est distinct. Un changement d’horodatage externe d’un statut peut constituer un autre événement, traité ultérieurement de manière idempotente ; ce contrat devra être figé avec les payloads réels avant activation. Les événements non identifiables sont adressés par contenu et quarantainés, sans effet métier.

Une reprise identique incrémente receiptCount et conserve le premier ciphertext. Un même événement au contenu contradictoire conserve le contenu initial, passe en quarantaine et ajoute un audit contenant seulement l’empreinte du conflit ; le retour expose conflict=true. Le corps contradictoire n’est pas écrasé sur le corps initial ni conservé séparément. Une politique de conservation supplémentaire nécessiterait une revue de confidentialité et de schéma.

Le chiffrement est réalisé avant la transaction ; aucun accusé de succès n’est retourné avant son commit. Toute panne de chiffrement, lecture, écriture ou commit remonte au caller. Il n’y a aucun fallback mémoire. Un appelant futur devra transformer l’échec en réponse HTTP appropriée, sans acquitter prématurément.

Un callback précoce reste durable en WAITING_CORRELATION. Une réponse connue crée l’alias et réveille les événements correspondant exactement. Un callback authentifié/synthétique autorisé portant une paire exacte apprend ensuite l’alias WhatsApp et réveille les événements WhatsApp seuls. Des IDs contradictoires bloquent ce rattachement. Les callbacks d’un ancien essai ne sont jamais redirigés vers un nouvel essai.

Après perte de réponse sans alias commun, UNCERTAIN et WAITING_CORRELATION demeurent. Ni téléphone, ni texte, ni heure approximative ne sont consultés pour corréler. Le stockage ne prétend pas résoudre cette impossibilité. La reprise d’un processus reconstruit le repository depuis les lignes persistées ; aucun cache local ne contient la preuve unique.

## Tests et vérifications

Prisma local 6.19.3 : `node node_modules/prisma/build/index.js validate --schema=prisma/schema.prisma`, dans un processus enfant avec DATABASE_URL factice pointant vers le port 1 et télémétrie de mise à jour désactivée. Validation réussie ; aucune connexion à une base. Le CLI charge la configuration locale, sans afficher son contenu. Aucun generate, migrate, db push ou outil d’installation exécuté ; le client généré existant n’a pas été modifié et n’expose donc pas encore les nouveaux delegates.

Tests exécutés directement avec `node --test`, liste explicite du script `test:whatsapp:isolated` plus `tests/whatsappFixtureClock.test.js`, `tests/gupshupPhase2.test.js` et `tests/gupshupDurableStore.test.js`. Aucun npm test ni hook npm. Journal : `output/gupshup-phase4a-isolated.log`.

Résultat global : **266 tests, 266 réussis, 0 échec, 0 ignoré**. Dont **27 nouveaux tests de stockage**, en complément des 239 tests historiques. Durée du passage final à reporter depuis le journal.

Les nouveaux scénarios couvrent persistance chiffrée, reconstruction du repository, doublons simultanés, contenu contradictoire, entrée non authentifiée, scopes incompatibles, chiffrement/pannes SQL, sérialisation, compétition de workers, bail expiré et fencing, callback précoce, binding réel, réponse perdue, ID impossible/inconnu, non-réémission, expiration, conflits d’alias, rollback au milieu d’une transaction, réveil par alias WhatsApp, limite de retry, réponse tardive et ancien essai.

**Limite de preuve :** le mock sérialise les transactions et restaure une copie au rollback. Il vérifie le contrat du repository, pas les contraintes PostgreSQL, le pool Prisma, les interblocages, la tenue sous charge ou un redémarrage réel du serveur. Aucun test des 14 scénarios PostgreSQL n’a été lancé.

Vérification d’empreintes : parmi les 371 fichiers préexistants protégés, seul prisma/schema.prisma a changé. En retirant les six nouveaux blocs et les seules relations inverses ajoutées, on retrouve exactement le SHA-256 initial du schéma : `f795b2c80d63a6c1f42cfbcb741d41874feda08efa7236aa5b1885c8f81c3c4d`. Les 44 migrations, .env, package.json, package-lock.json et tous les fichiers métier/tests existants sont inchangés.

## Migration et permissions nécessaires, non appliquées

Une future migration additive devra créer les six tables, les uniques composites et index, puis les FK cycliques de retour, enfin les CHECK et garanties supplémentaires énumérés. Aucun fichier SQL de migration n’a été créé ou modifié. Le schéma réel et ses données sont inchangés ; cette implémentation ne peut pas fonctionner contre la base actuelle sans cette étape et la génération ultérieure du client.

Permissions à concevoir par fonction et accorder seulement après autorisation :

- Réception : lecture des seules colonnes de configuration nécessaires, SELECT/INSERT/UPDATE de l’inbox pour déduplication et SELECT/INSERT de l’audit pour conflits. Pas de DELETE ; aucun accès métier d’écriture par ce composant.
- Corrélation/worker technique : SELECT des cibles NVA et configurations nécessaires ; SELECT/INSERT/UPDATE des références/essais ; SELECT/INSERT des alias ; SELECT/UPDATE de l’inbox ; INSERT de l’audit, sans UPDATE/DELETE de l’audit. Les mutations d’essai et les mutations d’inbox pourront relever de rôles distincts selon leur future composition.
- Application des effets métier : droits déjà justifiés pour les services concernés à réauditer, pas de nouveaux droits globaux accordés par ce repository.
- Rétention/exploitation : rôle distinct et procédure dédiée avant tout DELETE/purge, avec respect des dépendances RESTRICT et des événements ouverts.

UUID applicatifs : aucune séquence nouvelle nécessaire pour ces six modèles. Aucun droit CREATE, TEMPORARY, GRANT OPTION, DDL ou administratif requis pour les repositories. Une FK composite ne protège pas les SELECT d’un rôle disposant d’un accès global ; le cloisonnement applicatif n’est pas présenté comme de la RLS. RLS, permissions de colonnes, append-only SQL et immutabilité d’application restent à concevoir et tester séparément. Aucun GRANT/REVOKE effectué.

## Risques et étapes avant activation

1. Authentification réelle non confirmée pour l’application NVA ; maintenir le vérificateur en refus. receiveSimulated ne doit jamais être appelé par une route réelle, ni transférer une preuve simulée vers la production.
2. Faire approuver la migration complète, les CHECK, les index partiels et les plans de requêtes ; générer le client local et valider les nouveaux delegates dans la phase autorisée.
3. Autoriser un environnement PostgreSQL dédié pour tester contraintes, races, collisions et crashs réels. Aucun résultat mock ne remplace cette validation.
4. Définir secrets/rotation et chiffrement opérationnel avec résolution de versions historiques ; aucune clé réelle stockée dans le dépôt. La clé des tests est exclusivement synthétique.
5. RESTRICT peut bloquer le nettoyage historique des fixtures ou la suppression utilisateur : concevoir purge/anonymisation et adapter les futurs nettoyages sous autorisation. recover marque l’expiration, mais n’est pas un job de suppression du ciphertext ; la rétention physique reste à implémenter.
6. Conserver le périmètre conversationnel mono-application : les tables existantes restent globales, le canonique réutilise la clé applicative existante. Ne pas activer plusieurs environnements/comptes partageant les mêmes cibles métier sans revue de cette isolation et des uniques existants.
7. Composer ultérieurement un worker idempotent avec les services existants, ordonnancement conversationnel, application monotone des statuts et fencing des effets métier. Un bail ne protège pas automatiquement un effet hors transaction. Les entrants sont actuellement conservés/quarantainés sans handler.
8. Prévoir l’intégration du chemin de rejet définitif et de backoff avec la politique existante : cette phase n’autorise pas de retry d’envoi depuis le registre et ne transforme aucun envoi incertain en rejet certain.
9. Ajouter procédure humaine de réconciliation sur preuve vérifiable, permissions minimales, observabilité sans données personnelles et alertes de rétention. La corrélation impossible doit rester explicitement non résolue.
10. Demander une autorisation séparée pour les tests PostgreSQL, les migrations et, plus tard, l’authentification et toute activation réelle.

Consentement, contrôle humain, réservations NVA, backoff métier, déduplication existante et statuts monotones sont préservés : aucun de leurs services n’a été modifié. Aucune assertion existante n’a été changée. Arrêt après ce rapport, en attente d’autorisation avant toute migration.
