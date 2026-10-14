# Mémoire conversationnelle WhatsApp NVA

## Audit et périmètre

Le moteur existant reconnaît accueil, catalogue, prix, horaires, essai, inscription, objection, objectif de formation, demande de conseiller, reprise du bot, retrait et consentement commercial. Il conservait déjà `qualification`, `selectedCourseSlug`, les identifiants traités et les indicateurs de consentement et de pause. La formation sélectionnée n'était pas réutilisée pour les questions suivantes et aucune question de clarification n'était mémorisée.

Le moteur reste déterministe et n'utilise aucune API d'IA. Les services de catalogue, d'inscription, de présentation des prix et de règles d'accès sont conservés. Aucun tarif ni aucune formation en base ne sont modifiés.

## Stockage

La colonne JSON `WhatsAppConversation.engineState` existante conserve désormais :

- `selectedCourseId` et `selectedCourseSlug` : référence de la formation, revalidée sur les données publiques à chaque demande ;
- `lastIntent` : dernière intention reconnue ;
- `pendingQuestion` : question de type `COURSE` avec une intention éventuelle à terminer, ou `TOPIC` ;
- `qualification.objective` : objectif exprimé, borné à 240 caractères, non repris dans les réponses publiques ;
- `step` : `MENU`, `SELECT_COURSE`, `SELECT_TOPIC`, `INFORMATION`, `REGISTRATION`, `HUMAN_HANDOFF` ou `OPTED_OUT`.

Les anciens états ne contenant qu'un slug restent compatibles. Les prix, dates et places ne sont pas mis en mémoire : ils sont relus par les services métier. La persistance transactionnelle existante écrit cet état avec le message entrant et la réponse en attente. Aucune migration n'est nécessaire.

## Parcours

Exemple, les éléments entre crochets représentent les données publiques retournées par les services :

```text
Contact : Je veux apprendre l'anglais.
Bot     : Voici les formations publiées : [liste actuelle]. Laquelle vous intéresse ?
Contact : Anglais général.
Bot     : Vous avez choisi Anglais général. Souhaitez-vous connaître le tarif,
          les horaires, les conditions d'essai ou les modalités d'inscription ?
Contact : Le prix.
Bot     : Le tarif indiqué pour Anglais général est [tarif actuel du catalogue].
Contact : Et les horaires ?
Bot     : Pour Anglais général, [créneaux de la session ouverte].
Contact : Je veux m'inscrire.
Bot     : Pour poursuivre l'inscription, utilisez [lien officiel de la session].
```

```text
Contact : Combien coûte la formation ?
Bot     : Pour quel cours souhaitez-vous connaître le tarif ? [liste]
Contact : Anglais général.
Bot     : Le tarif indiqué pour Anglais général est [tarif actuel du catalogue].
Contact : Je préfère Anglais des affaires.
Bot     : Vous avez choisi Anglais des affaires. [choix du sujet]
Contact : Horaires.
Bot     : [Horaires publics d'Anglais des affaires, ou absence de session ouverte].
```

Une réponse courte, éventuellement un nom partiel unique, termine la question en attente. Plusieurs correspondances provoquent une clarification. Une demande explicite pour une formation inconnue n'utilise pas silencieusement la formation précédente. Un catalogue disparu, un tarif indisponible ou une absence de session sont indiqués sans inventer d'information ni changer automatiquement de formation.

`menu` ou `menu principal` remet la demande et la sélection à zéro, en conservant l'objectif et le consentement. `annuler` abandonne la demande sans retrait commercial. `changer de formation` demande une nouvelle sélection. `formations` ouvre à nouveau le catalogue et remplace une clarification de prix en attente.

## Inscription et contrôle humain

Le moteur fournit uniquement un lien vers le formulaire public, après consultation du service d'inscription. Aucun compte, inscription ou paiement n'est créé par cette conversation. Une URL publique contenant des identifiants ou une configuration invalide n'est pas exposée.

STOP reste prioritaire et bloque les réponses suivantes. Le transfert humain conserve le contexte ; les messages ordinaires et le menu ne réactivent pas le bot. Le service de persistance conserve les contrôles `BOT_ACTIVE`, `HUMAN_TAKEOVER` et `OPTED_OUT`, et n'enregistre aucune réponse automatique ordinaire pendant la prise en charge humaine. Le développement de la réponse manuelle et de l'accusé de transfert reste une phase distincte.

## Validation et limites

Les suites de contexte et de persistance utilisent des données fictives et des clients en mémoire. Elles couvrent un nouveau moteur et une nouvelle instance du service après sérialisation de l'état, sans connexion PostgreSQL, migration, reset ni appel Meta. Les suites existantes du webhook sécurisé et des trois circuits d'envoi sont également exécutées.

Le moteur reste limité à ses règles linguistiques ; il ne comprend pas toutes les formulations libres. Les listes affichent au plus huit formations, sans pagination ni choix numérique. La mémoire n'a pas de délai d'expiration propre ; les données métier sont néanmoins revalidées à chaque consultation. Les tests de persistance ne prouvent pas une reconnexion PostgreSQL réelle. Cette phase ne constitue pas une validation de production.
