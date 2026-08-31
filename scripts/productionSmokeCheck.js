require('dotenv').config();
const { validateEnvironment } = require('../src/config/environment');
const { start, shutdown } = require('../src/server');

async function main() {
  const config = validateEnvironment(process.env, { production: true });
  const server = await start();
  const base = `http://${config.host}:${config.port}`;
  const check = async (pathname, expected) => {
    const response = await fetch(`${base}${pathname}`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    if (!expected.includes(response.status)) throw new Error(`${pathname}: HTTP ${response.status}`);
    return response;
  };
  try {
    const health = await check('/health', [200]);
    await check('/ready', [200]);
    await check('/', [200]);
    await check('/login', [200]);
    await check('/student', [302]);
    await check('/__production_smoke_missing__', [404]);
    if (health.headers.has('x-powered-by')) throw new Error('X-Powered-By ne doit pas être exposé');
    if (!health.headers.get('content-security-policy')) throw new Error('CSP absente');
    const app = require('../src/app');
    const cookie = app.locals.runtimeSecurity?.sessionCookie;
    if (!cookie?.httpOnly || !cookie.secure || cookie.sameSite !== 'lax') throw new Error('Cookie production invalide');
    console.log('PRODUCTION_SMOKE_OK');
  } finally {
    await shutdown('PRODUCTION_SMOKE', { exit: false });
  }
}

main().catch((error) => {
  console.error(`[PRODUCTION_SMOKE_FAILED] ${error.message}`);
  process.exitCode = 1;
});
