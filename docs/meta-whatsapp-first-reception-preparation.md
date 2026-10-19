# Premier test de réception Meta : commandes préparées, non exécutées

Préparation du 19 octobre 2026. Aucun serveur, tunnel, worker, appel Graph ou réglage Meta n'a été lancé. Aucune modification de `.env`, du schéma, des ACL ou des données PostgreSQL pendant cette préparation.

## Variables réellement attendues

| Variable | Origine / usage |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Secret de la véritable application Meta ; HMAC des POST. Ne pas utiliser `META_APP_SECRET`. |
| `WHATSAPP_VERIFY_TOKEN` | Jeton local déjà généré et protégé dans le bundle DPAPI ; vérification GET. Ce n'est pas l'App Secret. |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant natif du numéro de test Meta, pas le numéro téléphonique. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA attendu. |
| `META_INBOX_APP_ID` | Identifiant de la même application Meta. |
| `META_INBOX_ENDPOINT_ID` | UUID d'un endpoint réel à provisionner séparément en base après validation des identifiants. Ne pas réutiliser les endpoints synthétiques. |
| `META_INBOX_APPLICATION_KEY` | Clé locale de scope, proposée : `nva-meta-test`. |
| `META_INBOX_ENVIRONMENT` | `test` exclusivement. |
| `META_INBOX_DATABASE_URL` | URL construite uniquement en mémoire, rôle `nva_meta_inbox_ingress`, `127.0.0.1:55432/nva_whatsapp_test`. |
| `META_INBOX_LOOKUP_KEYS_JSON`, `META_INBOX_LOOKUP_KEY_VERSION` | Bundle DPAPI : clé lookup et version `l1`. |
| `META_INBOX_STREAM_KEY_HEX`, `META_INBOX_STREAM_KEY_VERSION` | Bundle DPAPI : clé stream et version `s1`. |
| `META_INBOX_ENCRYPTION_KEYS_JSON`, `META_INBOX_ENCRYPTION_KEY_VERSION` | Bundle DPAPI : clé chiffrement et version `e1`. |
| `META_INBOX_AUTH_KEY_VERSION` | Version locale du secret Meta, proposée : `meta-app-v1`. |
| `META_WHATSAPP_INBOX_ENABLED` | `true` uniquement dans le processus de réception après autorisation. |

`WHATSAPP_ACCESS_TOKEN` n'est pas nécessaire pour recevoir et persister. Ne pas le demander pour ce test. L'URL publique se renseigne dans Meta ; le routeur actuel ne lit pas de variable d'URL publique.

## Saisie sécurisée, à exécuter après autorisation

Les valeurs sont saisies avec `Read-Host -AsSecureString`, jamais dans la commande, les arguments, un transcript ou Git. Le fichier cible est hors dépôt et chiffré par DPAPI pour l'utilisateur Windows courant. Aucun secret réel n'est demandé dans la conversation.

Dans PowerShell, sous le même compte Windows que celui qui a créé les clés :

```powershell
$ErrorActionPreference = 'Stop'
$metaTarget = 'D:\NVA-WhatsApp-Test\secrets\meta-inbox\meta-real.credentials.clixml'
if (Test-Path -LiteralPath $metaTarget) { throw 'CONFIGURATION_EXISTS_DO_NOT_OVERWRITE' }
function Read-MetaProtected([string]$label) {
    $s = Read-Host $label -AsSecureString
    $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p); $s.Dispose() }
}
$metaConfig = @{}
try {
    foreach ($name in @('WHATSAPP_APP_SECRET','WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_BUSINESS_ACCOUNT_ID','META_INBOX_APP_ID')) {
        $metaConfig[$name] = Read-MetaProtected $name
        if ([string]::IsNullOrWhiteSpace($metaConfig[$name])) { throw 'MISSING_PARAMETER' }
        if ($name.EndsWith('_ID') -and $metaConfig[$name] -notmatch '^\d{1,64}$') { throw 'INVALID_IDENTIFIER' }
    }
    $metaConfig.META_INBOX_ENDPOINT_ID = [Guid]::NewGuid().ToString()
    $metaConfig.META_INBOX_APPLICATION_KEY = 'nva-meta-test'
    $metaConfig.META_INBOX_AUTH_KEY_VERSION = 'meta-app-v1'
    $metaJson = $metaConfig | ConvertTo-Json -Compress
    $metaSecure = ConvertTo-SecureString $metaJson -AsPlainText -Force
    $metaCredential = New-Object System.Management.Automation.PSCredential('nva-meta-real-v1', $metaSecure)
    $metaCredential | Export-Clixml -LiteralPath $metaTarget
    $metaReadback = Import-Clixml -LiteralPath $metaTarget
    if ($metaReadback.GetNetworkCredential().Password -cne $metaJson) { throw 'DPAPI_VERIFICATION_FAILED' }
    Write-Output 'CONFIGURATION_PROTECTED'
} finally {
    $metaJson = $null; $metaConfig = $null; $metaCredential = $null; $metaReadback = $null
    if ($metaSecure) { $metaSecure.Dispose() }
}
```

DPAPI protège les fichiers au repos ; les secrets restent nécessairement accessibles au processus sous ce compte. Ne pas transcrire, imprimer les objets, exporter l'environnement ou partager ce profil Windows. Conserver le bundle versionné et prévoir une sauvegarde protégée des clés et du profil DPAPI ; perdre ces clés compromet la lecture des événements chiffrés.

## HTTPS temporaire

Constat : `cloudflared`, `ngrok`, `caddy` et `nginx` ne sont pas trouvés dans le PATH ; aucun processus correspondant, aucun worker Node, aucune écoute sur 8787/443 observés. Cela ne prouve pas l'absence d'une installation ailleurs.

Recommandation : **Cloudflare Quick Tunnel** vers `127.0.0.1:8787`, sans compte ni domaine, pour ce test seulement. Son URL est temporaire, change à chaque lancement et n'a pas de garantie de disponibilité. Installer ultérieurement `cloudflared` depuis la distribution officielle Windows, vérifier sa provenance et respecter Smart App Control. Rien n'est installé maintenant.

Alternative : ngrok, avec compte et authentification de l'agent à préparer ; pas retenu pour minimiser les préparatifs. Ne pas activer une inspection qui conserve des corps de webhooks ou des requêtes de vérification contenant le jeton.

Le tunnel transporte tout le port cible : ce n'est pas un filtre de chemin. Le serveur dédié ci-dessous n'importe ni `src/app.js` ni `src/server.js`, monte exclusivement le webhook et rejette les autres chemins/méthodes avant le routeur. PostgreSQL et les routes métier ne sont pas exposés. Le fournisseur de tunnel termine TLS : il fait partie du périmètre de confiance pour ces données de test. Ne pas activer les logs debug/corps/requêtes. Ne pas utiliser une protection interactive par email ou navigateur : Meta ne peut pas la franchir.

## Conditions avant les commandes de lancement

Autorisation distincte obligatoire. Valider les véritables App ID, App Secret, WABA et Phone Number ID. Revérifier l'identité SQL, notamment le système `7696610946073769572` et le cluster `D:\NVA-WhatsApp-Test\data`. Provisionner l'endpoint réel correspondant au fichier protégé : `environment=test`, bonnes identités, versions `l1`/`s1`, `inbox_enabled=true`, `processing_enabled=false`, `disabled_at=NULL`. Cette écriture d'activation n'est pas effectuée ici. Le rôle ingress ne doit pas pouvoir la réaliser lui-même.

Ne pas activer le traitement conversationnel : aucun consommateur, dispatcher, poller ou worker d'envoi. Un STOP sera accepté durablement mais restera en attente ; ce test prouve la réception, pas l'application des effets métier STOP. Le canal sortant doit rester désactivé pour tout autre processus également.

## Lancement réception uniquement — préparé, non exécuté

Dans un premier terminal PowerShell, après les conditions précédentes :

```powershell
Set-Location 'D:\English-center'
$ErrorActionPreference = 'Stop'
$metaStore = Get-Content 'output/meta-reception-protected-store.json' -Raw | ConvertFrom-Json
$metaBundle = (Import-Clixml -LiteralPath $metaStore.protectedBundlePath).GetNetworkCredential().Password | ConvertFrom-Json
$metaReal = (Import-Clixml -LiteralPath 'D:\NVA-WhatsApp-Test\secrets\meta-inbox\meta-real.credentials.clixml').GetNetworkCredential().Password | ConvertFrom-Json
$metaUrl = New-Object UriBuilder('postgresql', '127.0.0.1', 55432, 'nva_whatsapp_test')
$metaUrl.UserName = 'nva_meta_inbox_ingress'
$metaUrl.Password = $metaBundle.password
$metaInfo = New-Object Diagnostics.ProcessStartInfo
$metaInfo.FileName = 'C:\Program Files\nodejs\node.exe'
$metaInfo.Arguments = '-'
$metaInfo.WorkingDirectory = 'D:\English-center'
$metaInfo.UseShellExecute = $false
$metaInfo.CreateNoWindow = $true
$metaInfo.RedirectStandardInput = $true
@($metaInfo.EnvironmentVariables.Keys) | Where-Object {
    $_ -match '^PG|^META_|^WHATSAPP_|^(DATABASE_URL|TEST_DATABASE_URL|NODE_OPTIONS|NVA_WHATSAPP_TEST_DATABASE_URL)$'
} | ForEach-Object { $metaInfo.EnvironmentVariables.Remove($_) }
$metaInfo.EnvironmentVariables['NODE_ENV'] = 'test'
$metaInfo.EnvironmentVariables['WHATSAPP_ENABLED'] = 'false'
$metaInfo.EnvironmentVariables['WHATSAPP_WORKERS_ENABLED'] = 'false'
$metaInfo.EnvironmentVariables['META_WHATSAPP_INBOX_ENABLED'] = 'true'
$metaInfo.EnvironmentVariables['META_INBOX_ENVIRONMENT'] = 'test'
$metaInfo.EnvironmentVariables['META_INBOX_DATABASE_URL'] = $metaUrl.Uri.AbsoluteUri
$metaInfo.EnvironmentVariables['WHATSAPP_VERIFY_TOKEN'] = $metaBundle.verifyToken
$metaInfo.EnvironmentVariables['META_INBOX_LOOKUP_KEYS_JSON'] = (@{l1=$metaBundle.lookupKey} | ConvertTo-Json -Compress)
$metaInfo.EnvironmentVariables['META_INBOX_LOOKUP_KEY_VERSION'] = 'l1'
$metaInfo.EnvironmentVariables['META_INBOX_STREAM_KEY_HEX'] = $metaBundle.streamKey
$metaInfo.EnvironmentVariables['META_INBOX_STREAM_KEY_VERSION'] = 's1'
$metaInfo.EnvironmentVariables['META_INBOX_ENCRYPTION_KEYS_JSON'] = (@{e1=$metaBundle.encryptionKey} | ConvertTo-Json -Compress)
$metaInfo.EnvironmentVariables['META_INBOX_ENCRYPTION_KEY_VERSION'] = 'e1'
foreach ($property in $metaReal.PSObject.Properties) { $metaInfo.EnvironmentVariables[$property.Name] = [string]$property.Value }
$metaProgram = @'
const express = require('express');
const { createMetaInboxRuntime } = require('./src/services/metaInboxRuntime');
const { createMetaWebhookRouter } = require('./src/routes/whatsappWebhookRoutes');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const env = { ...process.env };
  // Native runtime validates role, exact DB URL, key material, scope and app secret.
  const inbox = createMetaInboxRuntime(env);
  const probe = new PrismaClient({ datasourceUrl: env.META_INBOX_DATABASE_URL, log: [] });
  try {
    const [i] = await probe.$queryRaw`SELECT current_user AS role,current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version`;
    if (i.role !== 'nva_meta_inbox_ingress' || i.db !== 'nva_whatsapp_test' || i.host !== '127.0.0.1'
      || i.port !== 55432 || i.version !== '160015') throw Error('IDENTITY_REJECTED');
    const e = await probe.metaWebhookEndpoint.findUnique({ where: { id: env.META_INBOX_ENDPOINT_ID } });
    if (!e || !e.inboxEnabled || e.processingEnabled || e.disabledAt || e.environment !== 'test'
      || e.metaAppId !== env.META_INBOX_APP_ID || e.wabaId !== env.WHATSAPP_BUSINESS_ACCOUNT_ID
      || e.phoneNumberId !== env.WHATSAPP_PHONE_NUMBER_ID || e.applicationKey !== env.META_INBOX_APPLICATION_KEY
      || e.lookupKeyVersion !== 'l1' || e.streamKeyVersion !== 's1'
      || e.identityVersion !== 1 || e.normalizationVersion !== 1) throw Error('ENDPOINT_REJECTED');
  } finally { await probe.$disconnect(); }
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    const path = req.url.split('?')[0];
    if (!['/webhooks/whatsapp','/webhooks/whatsapp/'].includes(path)
      || !['GET','POST'].includes(req.method)) return res.sendStatus(404);
    next();
  });
  app.use('/webhooks/whatsapp', createMetaWebhookRouter({env,inboxService:inbox}));
  const server = app.listen(8787, '127.0.0.1', () => console.log('RECEPTION_ONLY_READY'));
  server.on('error', () => { console.error('LOCAL_LISTENER_FAILED'); process.exit(1); });
  const close = () => server.close(() => inbox.close().finally(() => process.exit(0)));
  process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(() => { console.error('RECEPTION_START_REFUSED'); process.exit(1); });
'@
$metaProcess = New-Object Diagnostics.Process
$metaProcess.StartInfo = $metaInfo
try {
    [void]$metaProcess.Start()
    $metaProcess.StandardInput.Write($metaProgram)
    $metaProcess.StandardInput.Close()
    $metaInfo.EnvironmentVariables.Clear()
    $metaBundle=$null; $metaReal=$null; $metaUrl=$null
    $metaProcess.WaitForExit()
} finally {
    if ($metaProcess.Id -and -not $metaProcess.HasExited) { $metaProcess.Kill(); $metaProcess.WaitForExit() }
    $metaInfo.EnvironmentVariables.Clear()
    $metaBundle=$null; $metaReal=$null; $metaUrl=$null
}
```

Pas de logger HTTP ni impression d'erreurs SQL/URL. Le petit serveur ne charge aucun worker et ne traite pas les événements métier. Les secrets sont injectés uniquement au processus enfant ; aucune variable durable ni `.env` n'est modifiée. La vérification initiale du cluster complet reste un préalable administratif : le rôle ingress n'a pas accès à toutes les informations d'administration.

Après `RECEPTION_ONLY_READY`, dans un second terminal, avec `cloudflared` officiellement installé et validé :

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

URL callback : `https://<nom-effectivement-affiche>.trycloudflare.com/webhooks/whatsapp`. Ce nom est attribué au lancement ; aucune URL réelle ne peut être réservée ou validée maintenant. Arrêter le tunnel avec Ctrl+C pour retirer l'exposition ; arrêter ensuite le serveur local. Ne pas lancer `npm start` pour ce test.

## Actions manuelles Meta, uniquement après autorisation

1. Ouvrir la même application dans Meta Developers. Relever l'App ID et, dans les paramètres de l'application / informations de base, le véritable App Secret. Dans la configuration WhatsApp/API, relever le WABA et le Phone Number ID du numéro de test. Les libellés d'interface peuvent varier.
2. Après démarrage autorisé du serveur et du tunnel, ouvrir WhatsApp > Configuration > Webhooks (ou Webhooks > objet WhatsApp Business Account). Renseigner la Callback URL HTTPS complète.
3. Fournir le jeton local existant dans Verify token. Ne pas coller l'App Secret dans ce champ. Pour transférer le jeton sans l'imprimer, après autorisation et uniquement sur le poste de confiance :

```powershell
$metaStore = Get-Content 'D:\English-center\output\meta-reception-protected-store.json' -Raw | ConvertFrom-Json
$metaPrivate = (Import-Clixml -LiteralPath $metaStore.protectedBundlePath).GetNetworkCredential().Password | ConvertFrom-Json
Set-Clipboard -Value $metaPrivate.verifyToken
$metaPrivate = $null
# Coller uniquement dans le champ Verify token de Meta, puis effacer :
Set-Clipboard -Value ''
```

Le presse-papiers est un transfert volontaire de secret : éviter les gestionnaires/historiques synchronisés ; si cela n'est pas maîtrisé, employer une saisie depuis un coffre local approuvé. Aucun token n'est imprimé dans la console.

4. Cliquer Verify and save / Vérifier et enregistrer. Le GET doit réussir. S'abonner au champ `messages` pour l'objet WhatsApp Business Account. Vérifier séparément que l'application est abonnée au WABA choisi ; une vérification GET ou un événement de démonstration ne prouve pas cette association. Si un appel Graph serait nécessaire pour établir cette association, il relève d'une autorisation distincte, non de cette préparation.
5. Après validation des signatures et des identifiants, envoyer manuellement un seul message depuis un téléphone de test autorisé vers le numéro Meta de test, sous autorisation du premier test réel. Aucun message n'est envoyé dans cette intervention.
6. Vérifier en lecture seule la présence du reçu et de l'événement dans le bon scope, l'ACK après COMMIT et l'absence de réponse. Ne pas afficher le contenu ou le numéro. Les événements demeurent en attente tant qu'un traitement séparé n'est pas autorisé.

## Sources et limites de vérification

- Code local : `src/services/metaInboxRuntime.js`, `src/services/metaInboxService.js`, `src/routes/whatsappWebhookRoutes.js`, `src/controllers/metaInboxWebhookController.js`.
- Cloudflare, documentation officielle Quick Tunnels : https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ (consultée ; URL temporaire, commande, absence de compte, limitations).
- ngrok, téléchargement officiel Windows : https://ngrok.com/download/windows (consulté ; alternative avec authentification de l'agent).
- Meta, guide officiel : https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks ; guide Graph : https://developers.facebook.com/docs/graph-api/webhooks/getting-started . Lecture actuelle refusée par HTTP 429 : les libellés exacts de l'interface ne sont pas confirmés en direct. Aucune connexion au compte Meta n'a été effectuée.
- Référence SDK hébergée par Meta : https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/ (signature SHA-256 ; SDK ancien, non proposé comme dépendance).

## État de fin de préparation

Seul ce document de commandes a été créé. Aucun secret Meta réel saisi, aucune configuration privée supplémentaire créée, aucun endpoint réel provisionné, aucune réception activée, aucun tunnel installé ou lancé. Préparation documentaire : les commandes de lancement n'ont pas été exécutées ou validées de bout en bout avec de vrais identifiants.
