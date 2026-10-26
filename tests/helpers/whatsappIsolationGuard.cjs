// Preload only for explicitly isolated suites. A default Prisma call must fail,
// never instantiate a real Prisma client or fall back to any DATABASE_URL.
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const prismaPath = path.resolve(__dirname, '../../src/utils/prisma.js');
const denied = () => { throw new Error('ISOLATED_TEST_DATABASE_ACCESS_FORBIDDEN'); };
const methods = ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'create', 'createMany',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'];
const stub = Object.fromEntries(['$connect', '$transaction', '$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].map(m => [m, denied]));
stub.$disconnect = async () => {};
const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
for (const [, model] of schema.matchAll(/^model (\w+) \{/gm)) stub[model[0].toLowerCase() + model.slice(1)] = Object.fromEntries(methods.map(m => [m, denied]));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') throw new Error('ISOLATED_TEST_DATABASE_DRIVER_FORBIDDEN');
  if (request === '@prisma/client') {
    // Domain modules import enum/constants too. Allow these, never a real client.
    const exports = originalLoad.call(this, request, parent, isMain);
    return { ...exports, PrismaClient: class { constructor() { denied(); } } };
  }
  if (typeof request === 'string' && request.includes('prisma') && Module._resolveFilename(request, parent) === prismaPath) return stub;
  return originalLoad.call(this, request, parent, isMain);
};
global.fetch = async () => { throw new Error('ISOLATED_TEST_EXTERNAL_FETCH_FORBIDDEN'); };
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ENABLED = 'false';
process.env.WHATSAPP_WORKERS_ENABLED = 'false';
process.env.NVA_AI_ENABLED = 'false';
