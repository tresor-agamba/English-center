# Migration Meta persistante — résultat

Application : 18 octobre 2026. Source détaillée : output/meta-whatsapp-persistent-evidence.json.

- PostgreSQL 16.15 redémarré une seule fois : PID 8924, 127.0.0.1:55432, cluster D:/NVA-WhatsApp-Test/data, identifiant 7696610946073769572, base nva_whatsapp_test.
- Sauvegarde existante : D:/NVA-WhatsApp-Test/backups/physical-16.15-20261017-152257-299fb8cd. Les 1 802 fichiers et leurs empreintes ont été revérifiés ; aucun essai de restauration effectué.
- Récupération normale terminée, serveur prêt ; aucun FATAL/PANIC dans le nouveau journal au contrôle final.
- Compte existant : nva_whatsapp_test_admin. Permissions constatées dans le JSON de preuve ; aucun rôle ni privilège modifié. Secret DPAPI transmis uniquement en mémoire au processus enfant.
- SQL : tmp/meta-whatsapp-transaction-ddl-review.sql, SHA-256 5700356024669fef66a3b58aa63f0c0a6a0e297b864617543c40f109eac0bb42 ; bloc documentaire SHA-256 709c4a31500a15d833a62999352fc640f3e741d9ab2d665f520978a7219d7f32. Empreintes recalculées avant application et preuve antérieure des 17 contrôles vérifiée.
- Transaction explicite, comparaison des catalogues avec la validation précédente et des objets historiques avant COMMIT. COMMIT confirmé ; aucune insertion de fixture ou endpoint.
- Tables créées : meta_webhook_endpoints, meta_webhook_receipts, meta_webhook_events, meta_webhook_receipt_items. Les quatre sont vides.
- Catalogue conforme : 86 colonnes, 4 PK, 4 FK, 7 UNIQUE, 7 CHECK, 25 index et 7 triggers, dont 3 différés. Une séquence Meta et sept fonctions Meta sont également créées par le SQL validé.
- Nouvelle connexion READ ONLY : mêmes catalogues Meta, 44 migrations inchangées, empreintes des données/catalogues des 69 tables métier inchangées, 63 séquences historiques inchangées, aucun Provider*, aucun index invalide, aucune contrainte non validée.
- Aucun enregistrement dans _prisma_migrations : application SQL dédiée, pas une migration Prisma officielle. Réconciliation Prisma encore nécessaire ; les quatre modèles Meta sont absents du client généré actuel. Les six modèles Provider* restent uniquement dans le schéma source.
- schema.prisma, .env et les 44 fichiers de migration : empreintes inchangées.

## Préparation webhook et tests

Nouveaux fichiers : src/controllers/metaInboxWebhookController.js et tests/metaInboxWebhookController.test.js.

Contrôleur injecté, désactivé par défaut et non importé par une route active. Il transmet le corps brut et la signature à acceptRaw, attend l'acceptation durable avant HTTP 200 et renvoie un échec sans exposer les détails sensibles. Il n'appelle aucun traitement métier ni sender. Le service existant conserve la validation HMAC et des comptes Meta et reste limité au mode isolé de test.

Commande : node --require ./tests/helpers/whatsappIsolationGuard.cjs --test tests/metaInboxWebhookController.test.js tests/metaInbox.test.js tests/metaInboxPrismaAdapter.test.js tests/metaWhatsAppConsolidation.test.js

Résultat : 96 réussis, 0 échec, 0 ignoré, durée 949,6429 ms. Journal : output/meta-whatsapp-current-isolated.log. Le preload interdit le pilote pg, les appels Prisma réels et fetch. Ces mocks ne démontrent pas la sûreté des courses PostgreSQL/réseau.

## Étapes restantes

1. Réconcilier explicitement les quatre modèles Meta avec Prisma sans inclure involontairement Provider*, générer le client adapté et tracer le SQL déjà appliqué sans le rejouer.
2. Valider les baux, transactions applicatives et courses STOP/envoi avec de vrais accès concurrents au seul PostgreSQL dédié et un réseau simulé. L'inbox ne garantit pas l'annulation d'un appel réseau déjà soumis ; la coordination de soumission reste bloquante avant activation.
3. Fournir une configuration sécurisée et les clés de chiffrement/HMAC, créer un endpoint contrôlé, puis autoriser séparément le raccordement réel, la supervision/rétention et l'activation. Aucun worker ni envoi réel activé.

Aucun accès 5432/production, reset, suppression de données, migration Prisma générale, modification des protections Windows, service Windows ou appel Meta/Gupshup.
