const path = require('path');

const DEFAULT_SECRETS = ['development-secret-change-me', 'your-session-secret', 'changeme', 'secret'];
class EnvironmentError extends Error {}
function validateEnvironment(env = process.env, { production = env.NODE_ENV === 'production' } = {}) {
  const errors = [];
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV invalide');
  if (production && nodeEnv !== 'production') errors.push('NODE_ENV doit être production');
  if (!env.DATABASE_URL) errors.push('DATABASE_URL obligatoire');
  else { try { const url = new URL(env.DATABASE_URL); if (!['postgresql:', 'postgres:'].includes(url.protocol)) errors.push('DATABASE_URL doit utiliser PostgreSQL'); } catch { errors.push('DATABASE_URL invalide'); } }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < (production ? 1 : 0) || port > 65535) errors.push('PORT invalide');
  const host = String(env.HOST || '127.0.0.1').trim();
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) errors.push('HOST doit rester local derrière le reverse proxy');
  const sessionSecret = String(env.SESSION_SECRET || '');
  if (production && (sessionSecret.length < 32 || DEFAULT_SECRETS.includes(sessionSecret.toLowerCase()))) errors.push('SESSION_SECRET de production absent, faible ou par défaut');
  const sessionPoolMax = Number(env.SESSION_POOL_MAX || 5);
  if (!Number.isInteger(sessionPoolMax) || sessionPoolMax < 1 || sessionPoolMax > 20) errors.push('SESSION_POOL_MAX invalide');
  if (!env.PUBLIC_APP_URL && production) errors.push('PUBLIC_APP_URL obligatoire en production');
  if (env.PUBLIC_APP_URL) {
    try {
      const url = new URL(env.PUBLIC_APP_URL);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      if (production && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) throw new Error();
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error();
    } catch { errors.push('PUBLIC_APP_URL invalide'); }
  }
  if (env.TRUST_PROXY && !/^(true|false|\d+|loopback|linklocal|uniquelocal)$/i.test(env.TRUST_PROXY)) errors.push('TRUST_PROXY invalide');
  if (production && env.TRUST_PROXY !== '1') errors.push('TRUST_PROXY doit valoir 1 derrière un reverse proxy unique');
  const backupMaxMb = Number(env.BACKUP_MAX_SIZE_MB || 2048);
  if (!Number.isFinite(backupMaxMb) || backupMaxMb < 1) errors.push('BACKUP_MAX_SIZE_MB invalide');
  const privateRoot = path.resolve(env.PRIVATE_STORAGE_ROOT || path.join(__dirname, '..', '..', 'storage', 'private'));
  if (errors.length) throw new EnvironmentError(errors.join('; '));
  return {
    nodeEnv, production, port, host, sessionSecret, sessionPoolMax, databaseUrl: env.DATABASE_URL,
    publicAppUrl: env.PUBLIC_APP_URL || `http://localhost:${port}`,
    trustProxy: env.TRUST_PROXY || false, privateRoot, backupMaxBytes: Math.floor(backupMaxMb * 1024 * 1024),
    pgDumpPath: env.PG_DUMP_PATH || 'pg_dump', pgRestorePath: env.PG_RESTORE_PATH || 'pg_restore',
    restoreEnabled: env.BACKUP_RESTORE_ENABLED === 'true', restoreConfirmation: env.BACKUP_RESTORE_CONFIRMATION || '',
    shutdownTimeoutMs: Math.min(Math.max(Number(env.SHUTDOWN_TIMEOUT_MS || 15000), 1000), 60000),
  };
}
module.exports = { EnvironmentError, DEFAULT_SECRETS, validateEnvironment };
