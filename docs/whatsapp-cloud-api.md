# WhatsApp Cloud API

English-center utilise uniquement des modèles transactionnels WhatsApp approuvés. Les notifications `IN_APP` restent la source principale et fonctionnent lorsque WhatsApp est désactivé.

## Configuration

Copier les variables de `.env.example`. Activer `WHATSAPP_ENABLED=true` seulement après avoir renseigné la version Graph API, le Phone Number ID, le token d’accès, le token de vérification et le secret de l’application. Aucun secret ne doit être commité.

Dans Meta for Developers, créer une application Business, ajouter WhatsApp, récupérer le Phone Number ID, puis configurer :

- URL de callback : `https://votre-domaine/webhooks/whatsapp`
- token de vérification : valeur privée de `WHATSAPP_VERIFY_TOKEN`
- champ webhook : `messages`
- secret de signature : `WHATSAPP_APP_SECRET`

Créer et faire approuver les modèles listés dans `src/config/whatsappTemplates.js`, initialement en langue `fr`. Le nombre et l’ordre des variables doivent correspondre à la configuration du projet.

## Consentement

Un numéro de profil ne vaut jamais consentement. L’utilisateur doit accepter explicitement le canal, ou un administrateur doit enregistrer une source autorisée. Un retrait annule les livraisons futures sans supprimer l’historique ni les notifications internes.

## Exécution

```bash
npm run whatsapp:process
```

Le worker traite un lot puis s’arrête. Il peut être lancé par cron. Avec `WHATSAPP_ENABLED=false`, il quitte normalement sans envoi.

Pour les tests locaux, utiliser `WHATSAPP_FAKE_MODE=true` avec des valeurs factices pour le token de vérification et le secret. Ce mode ne réalise aucun appel réseau et est refusé en production.

## Rotation et arrêt

Pour tourner le token, créer le nouveau token côté Meta, remplacer `WHATSAPP_ACCESS_TOKEN`, redémarrer uniquement le worker, vérifier un envoi, puis révoquer l’ancien token. Pour désactiver immédiatement le canal, définir `WHATSAPP_ENABLED=false`.

## Erreurs courantes

- modèle ou langue non approuvé ;
- Phone Number ID incorrect ;
- token expiré ;
- signature webhook invalide ;
- consentement absent ;
- numéro non conforme à E.164 ;
- paramètres différents de ceux du modèle approuvé.

Les payloads, tokens, numéros complets et liens privés de réunion ne doivent jamais être journalisés.
