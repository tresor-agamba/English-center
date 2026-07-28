# Progressive Web App — Phase 11

## Architecture

La PWA est une couche progressive au-dessus de l’application Express/EJS existante. Elle ne remplace ni les sessions serveur, ni Prisma/PostgreSQL, ni les vues. Le manifest dynamique réutilise le nom, la description, la langue et la couleur principale des paramètres centralisés du centre.

## Manifest et icônes

`/manifest.webmanifest` est servi en `application/manifest+json`, avec un cache court de cinq minutes. `public/manifest.webmanifest` est la référence statique et le secours de développement. Les icônes PNG carrées sont disponibles en 72, 96, 128, 144, 152, 192, 384 et 512 px, avec une icône maskable 512 px, une apple-touch-icon et un favicon. Le monogramme temporaire peut être remplacé lorsque le logo définitif est disponible.

## Service worker et stratégies

`/sw.js` est servi depuis la racine avec `Cache-Control: no-cache, no-store, must-revalidate`.

- Cache First : CSS, JavaScript public, icônes, images publiques et polices locales.
- Network First : accueil, connexion, catalogue public et vérification publique de certificat, avec secours cache/page offline.
- Network Only : toute autre navigation, en particulier les zones authentifiées.

Le cache versionné `english-center-v1` est nettoyé à l’activation. Une réponse n’est enregistrée que si elle est GET, réussie, same-origin, non privée et sans en-tête `Set-Cookie`.

## Routes exclues

Les préfixes `/admin`, `/teacher`, `/student`, `/api`, `/health`, `/notifications`, `/settings/public/logo`, `/webhooks`, `/payments`, `/payment` et `/enrollment` ne passent jamais par le cache. Les uploads, PDF, archives, documents, audio et vidéo sont également exclus. POST, PUT, PATCH et DELETE ne sont jamais interceptés.

## Hors connexion

`/offline` fournit une page légère et autonome. Les formulaires sont bloqués côté interface hors ligne avec le message « Cette action nécessite une connexion Internet. » Aucune file d’attente offline, IndexedDB ou synchronisation métier n’est créée.

## Installation

### Android, Windows, macOS et Linux (Chromium)

Le bouton « Installer l’application » apparaît seulement après `beforeinstallprompt` et disparaît après installation. Le navigateur permet aussi l’installation depuis son menu.

### iPhone et iPad

Sur Safari iOS, un panneau conditionnel indique : Partager → Sur l’écran d’accueil → Ajouter. Sa fermeture est mémorisée comme préférence non sensible.

## Standalone et mises à jour

Le mode standalone est détecté par `display-mode: standalone` ou `navigator.standalone`. Un service worker en attente affiche une proposition de mise à jour. Le rechargement n’est jamais forcé lorsqu’un formulaire a le focus.

## Sécurité et limites

HTTPS est obligatoire en production. Aucun token, cookie, mot de passe, donnée personnelle, paiement, évaluation, présence, rapport, sauvegarde ou média privé n’est stocké. L’offline se limite au squelette statique et aux pages publiques déjà consultées. Les actions métier nécessitent toujours une confirmation serveur.

La CSP autorise uniquement le manifest et les workers de même origine. `unsafe-eval` n’est pas utilisé.

## Procédure réelle Android

1. Ouvrir l’URL HTTPS dans Chrome.
2. Se connecter.
3. Ouvrir le menu du navigateur.
4. Choisir « Installer l’application ».
5. Vérifier l’icône.
6. Ouvrir depuis l’écran d’accueil.
7. Tester la navigation et les redirections de rôle.
8. Tester la déconnexion.
9. Couper Internet.
10. Vérifier la page hors connexion et l’absence d’envoi des formulaires.

## Procédure réelle iPhone/iPad

1. Ouvrir l’URL HTTPS dans Safari.
2. Appuyer sur Partager.
3. Choisir « Sur l’écran d’accueil ».
4. Ajouter.
5. Ouvrir l’icône.
6. Tester navigation, connexion, expiration et déconnexion.

## Tests et dépannage

Exécuter `npm run test:pwa`, `npm run test:pwa:e2e`, `npm run test:responsive`, puis `npm test`. Vérifier dans DevTools > Application le manifest, le scope `/`, les caches et le mode offline. Si l’installation n’est pas proposée, contrôler HTTPS, les icônes 192/512, le manifest et l’absence d’une installation existante. Sur iOS, l’installation reste manuelle via Safari.
