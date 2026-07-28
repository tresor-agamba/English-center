require('dotenv').config();
const { validateEnvironment } = require('./config/environment');
const logger = require('./services/loggerService');
const prisma = require('./utils/prisma');

let server, shuttingDown = false;
function start() {
  const config = validateEnvironment();
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
  await prisma.$disconnect();
  logger.info('APPLICATION_SHUTDOWN_COMPLETED', { signal });
  if (exit) process.exit(0);
}
if (require.main === module) {
  start();
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
module.exports = { start, shutdown, getServer: () => server };
