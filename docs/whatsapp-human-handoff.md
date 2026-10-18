# Transfert humain et réponse manuelle NVA

## Flux et contrôles

Le contrôleur administratif ne contacte jamais Meta. La route `POST /admin/whatsapp/conversations/:id/reply` enregistre un message `TEXT / QUEUED` dans la file conversationnelle existante. Le formulaire exige CSRF, un texte non vide de 4000 caractères maximum et un UUID de soumission. Le service revérifie le rôle ADMIN, l'activité du compte, l'absence de changement de mot de passe obligatoire, l'attribution et la fenêtre de service. Une soumission identique retrouve le même message ; un autre texte ou auteur avec la même clé est refusé.

Prise en charge, pause et reprise utilisent des transactions Prisma Serializable, limitées à trois essais en cas de conflit. Un administrateur ne peut pas modifier une conversation attribuée à un autre. L'auteur, les états avant/après et la date sont conservés comme événement SYSTEM dans l'historique et dans les journaux structurés. Les journaux ne contiennent ni corps de message, ni numéro, ni secret. Aucun événement de contrôle n'est envoyé à WhatsApp.

Le worker revérifie l'état, l'attribution, les privilèges de l'auteur et la fenêtre. Les politiques précédentes de rejet permanent, reprise temporaire confirmée, incertitude et réconciliation sont conservées. Une suppression de l'auteur ne transforme pas une réponse manuelle en réponse du bot.

## Accusé et reprise

La demande de conseiller suspend les réponses ordinaires et les relances, puis enregistre un accusé SYSTEM sortant avec clé unique `wa-handoff:<identifiant entrant>:0`. Le worker reconnaît uniquement cette catégorie et ce préfixe comme exception dans HUMAN_TAKEOVER. Le bot reste suspendu. L'accusé ne passe pas après STOP, clôture ou expiration de fenêtre.

La restitution au bot conserve la mémoire JSON et annule les réponses ordinaires/manuelles encore en attente. Aucun message ancien n'est retraité et aucune relance annulée n'est restaurée.

## Fenêtre et STOP

`whatsappServiceWindow.js` calcule la fenêtre depuis le plus récent horodatage fournisseur fiable d'un entrant. L'interface, la mise en file et le worker utilisent cette règle. Une heure de réception locale ne prolonge pas la fenêtre. Hors fenêtre, aucun texte libre ni modèle commercial de remplacement n'est envoyé automatiquement.

Retrait marketing et fin de conversation sont des notions distinctes. Le modèle actuel représente STOP par un arrêt global OPTED_OUT et un retrait commercial. Cette phase maintient cette politique conservatrice : aucun message manuel ni reprise dans cet état, même si de nouveaux entrants sont conservés. Une prise en charge ne réactive jamais les consentements. Un parcours de réponse après retrait marketing seul reste à définir avant toute autorisation.

## Interface et données

La page protégée affiche le numéro complet, le nom lié au compte, l'état, l'activité, la fenêtre, les auteurs et les statuts. Les messages anciens sont consultables par pages de 100 sans suppression. Les champs sont échappés par EJS et les dates de conversation affichées en Africa/Kinshasa. Le formulaire dispose de styles mobiles.

Les modèles et contraintes uniques existants suffisent : aucune migration n'est nécessaire. Les événements SYSTEM enregistrent les changements administratifs, `senderUserId` identifie l'auteur des réponses, et les messages conservent le statut fournisseur courant. Il n'existe pas de table distincte historisant chaque transition de livraison.

## Validation et limites

Les tests `whatsappHumanHandoff.test.js` et `whatsappHumanHttp.test.js` utilisent un client en mémoire, des expéditeurs simulés, un serveur HTTP local et MemoryStore. CSRF est réellement activé dans le harness. Le corps de la vue est rendu sans ses partials ; les styles mobiles ne sont pas validés visuellement dans un navigateur complet. Aucun serveur NVA, PostgreSQL ou appel Meta n'est lancé.

Les transactions du mock sont sérialisées et ne prouvent pas le comportement SSI de PostgreSQL. Une annulation ne peut pas rappeler une requête réseau transmise. Une livraison incertaine sans callback peut rester non confirmée. La corrélation ne garantit pas une livraison exactement une fois.

Prochaine validation : base dédiée déjà préparée, deux administrateurs, deux workers et expéditeur simulé, puis essai Meta contrôlé. Aucun reset ni migration automatique. La production n'est pas validée par ces tests simulés.
