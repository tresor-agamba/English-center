const path = require('path');

const DEFAULT_SECRETS = ['development-secret-change-me', 'your-session-secret', 'changeme', 'secret'];
class EnvironmentError extends Error {}
function validateEnvironment(env = process.env, { production = env.NODE_ENV === 'production' } = {}) {
  const errors = [];
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV invalide');
  if (!env.DATABASE_URL) errors.push('DATABASE_URL obligatoire');
  else { try { const url = new URL(env.DATABASE_URL); if (!['postgresql:', 'postgres:'].includes(url.protocol)) errors.push('DATABASE_URL doit utiliser PostgreSQL'); } catch { errors.push('DATABASE_URL invalide'); } }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < (production ? 1 : 0) || port > 65535) errors.push('PORT invalide');
  const sessionSecret = String(env.SESSION_SECRET || '');
  if (production && (sessionSecret.length < 32 || DEFAULT_SECRETS.includes(sessionSecret.toLowerCase()))) errors.push('SESSION_SECRET de production absent, faible ou par défaut');
  if (env.PUBLIC_APP_URL) { try { const url = new URL(env.PUBLIC_APP_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { errors.push('PUBLIC_APP_URL invalide'); } }
  if (env.TRUST_PROXY && !/^(true|false|\d+|loopback|linklocal|uniquelocal)$/i.test(env.TRUST_PROXY)) errors.push('TRUST_PROXY invalide');
  const backupMaxMb = Number(env.BACKUP_MAX_SIZE_MB || 2048);
  if (!Number.isFinite(backupMaxMb) || backupMaxMb < 1) errors.push('BACKUP_MAX_SIZE_MB invalide');
  const privateRoot = path.resolve(env.PRIVATE_STORAGE_ROOT || path.join(__dirname, '..', '..', 'storage', 'private'));
  if (errors.length) throw new EnvironmentError(errors.join('; '));
  return {
    nodeEnv, production, port, sessionSecret, databaseUrl: env.DATABASE_URL,
    publicAppUrl: env.PUBLIC_APP_URL || `http://localhost:${port}`,
    trustProxy: env.TRUST_PROXY || false, privateRoot, backupMaxBytes: Math.floor(backupMaxMb * 1024 * 1024),
    pgDumpPath: env.PG_DUMP_PATH || 'pg_dump', pgRestorePath: env.PG_RESTORE_PATH || 'pg_restore',
    restoreEnabled: env.BACKUP_RESTORE_ENABLED === 'true', restoreConfirmation: env.BACKUP_RESTORE_CONFIRMATION || '',
    shutdownTimeoutMs: Math.min(Math.max(Number(env.SHUTDOWN_TIMEOUT_MS || 15000), 1000), 60000),
  };
}
module.exports = { EnvironmentError, DEFAULT_SECRETS, validateEnvironment };
