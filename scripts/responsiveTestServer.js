require('dotenv').config();

const app = require('../src/app');
const prisma = require('../src/utils/prisma');

const port = Number(process.env.PORT || 3100);
const idleTimeoutMs = 15_000;
let idleTimer;
let stopping = false;

const server = app.listen(port);

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(idleTimer);
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
}

function scheduleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    stop().then(() => process.exit(0), () => process.exit(1));
  }, idleTimeoutMs);
}

server.on('request', scheduleStop);
server.on('listening', scheduleStop);
process.once('SIGTERM', () => stop().then(() => process.exit(0)));
process.once('SIGINT', () => stop().then(() => process.exit(0)));
