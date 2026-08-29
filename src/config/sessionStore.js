const session = require('express-session');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const logger = require('../services/loggerService');

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_TABLE = 'http_sessions';
const STORE_KIND = 'postgresql';

let pool;
let store;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obligatoire pour le stockage des sessions');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.SESSION_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      application_name: 'nva-http-sessions',
    });
    pool.on('error', (error) => logger.error('SESSION_POOL_ERROR', { error }));
  }
  return pool;
}

function getSessionStore() {
  if (!store) {
    store = new PgSession({
      pool: getPool(),
      tableName: SESSION_TABLE,
      createTableIfMissing: true,
      ttl: SESSION_TTL_SECONDS,
      pruneSessionInterval: 15 * 60,
      errorLog: (message, error) => logger.error('SESSION_STORE_ERROR', { message, error }),
    });
  }
  return store;
}

async function verifySessionStore() {
  const activeStore = getSessionStore();
  await new Promise((resolve, reject) => {
    activeStore.get('__nva_session_store_readiness__', (error) => error ? reject(error) : resolve());
  });
  return { kind: STORE_KIND, tableName: SESSION_TABLE, ttlSeconds: SESSION_TTL_SECONDS };
}

async function closeSessionStore() {
  if (store) await store.close();
  if (pool) await pool.end();
  store = undefined;
  pool = undefined;
}

module.exports = {
  SESSION_TABLE,
  SESSION_TTL_SECONDS,
  STORE_KIND,
  getSessionStore,
  verifySessionStore,
  closeSessionStore,
};
