const app = require('../../src/app');
const prisma = require('../../src/utils/prisma');
const { verifySessionStore, closeSessionStore } = require('../../src/config/sessionStore');

let server;

async function stop() {
  if (server) {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
  await closeSessionStore();
  await prisma.$disconnect();
  process.exit(0);
}

verifySessionStore()
  .then(() => {
    server = app.listen(0, '127.0.0.1', () => {
      if (process.send) process.send({ port: server.address().port });
    });
  })
  .catch((error) => {
    if (process.send) process.send({ error: error.message });
    process.exit(1);
  });

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.on('message', (message) => {
  if (message === 'shutdown') stop();
});
