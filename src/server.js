require('dotenv').config();
const { validateEnvironment } = require('./config/environment');
const logger = require('./services/loggerService');
const prisma = require('./utils/prisma');
const { verifySessionStore, closeSessionStore } = require('./config/sessionStore');

let server, shuttingDown = false;
async function start() {
  const config = validateEnvironment();
  try {
    await verifySessionStore();
  } catch (error) {
    logger.error('SESSION_STORE_STARTUP_FAILED', { error });
    throw new Error('Stockage PostgreSQL des sessions indisponible au démarrage', { cause: error });
  }
  const app = require('./app');
  server = app.listen(config.port, () => logger.info('APPLICATION_STARTED', { port: config.port, environment: config.nodeEnv }));
  return server;
}
async function shutdown(signal, { exit = true } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  const config = validateEnvironment();
  logger.info('APPLICATION_SHUTDOWN_STARTED', { signal });
  const closeServer = new Promise((resolve) => server ? server.close(resolve) : resolve());
  const deadline = Date.now() + config.shutdownTimeoutMs;
  while (Date.now() < deadline) {
    const critical = await prisma.systemOperationLock.count({ where: { expiresAt: { gt: new Date() } } }).catch(() => 0);
    if (!critical) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await Promise.race([closeServer, new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs))]);
  await closeSessionStore();
  await prisma.$disconnect();
  logger.info('APPLICATION_SHUTDOWN_COMPLETED', { signal });
  if (exit) process.exit(0);
}
if (require.main === module) {
  start().catch((error) => {
    logger.error('APPLICATION_START_FAILED', { error });
    process.exitCode = 1;
  });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
module.exports = { start, shutdown, getServer: () => server };
