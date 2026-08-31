require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const health = require('../src/services/systemHealthService');
const logger = require('../src/services/loggerService');
const { validateEnvironment } = require('../src/config/environment');

const validProductionEnv = () => ({
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/nva',
  SESSION_SECRET: 'a'.repeat(48),
  PUBLIC_APP_URL: 'https://academy.example.org',
  TRUST_PROXY: '1',
});

test('Lot 6A - configuration production et VPS', async (t) => {
  await t.test('accepte uniquement une configuration production HTTPS locale derriere un proxy', () => {
    const config = validateEnvironment(validProductionEnv(), { production: true });
    assert.equal(config.nodeEnv, 'production');
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.trustProxy, '1');
    assert.equal(config.publicAppUrl, 'https://academy.example.org');
  });

  await t.test('rejette HTTP, localhost public, ecoute publique et proxy incorrect', () => {
    for (const override of [
      { PUBLIC_APP_URL: 'http://academy.example.org' },
      { PUBLIC_APP_URL: 'https://localhost' },
      { HOST: '0.0.0.0' },
      { TRUST_PROXY: 'true' },
      { NODE_ENV: 'development' },
    ]) assert.throws(() => validateEnvironment({ ...validProductionEnv(), ...override }, { production: true }));
  });

  await t.test('expurge URL PostgreSQL, bearer et secrets des chaines journalisees', () => {
    const safe = logger.sanitize('postgresql://nva:secret@db.internal/nva Bearer abc.def token=raw-value');
    assert.equal(safe.includes('secret@'), false);
    assert.equal(safe.includes('abc.def'), false);
    assert.equal(safe.includes('raw-value'), false);
    assert.match(safe, /\[DATABASE_URL\]/);
  });

  await t.test('readiness confirme la connexion PostgreSQL sans details sensibles', async () => {
    assert.deepEqual(await health.readiness(), { status: 'ok' });
  });

  await t.test('fournit des modeles PM2, Nginx et une procedure VPS', async () => {
    const [pm2, nginx, guide, appSource] = await Promise.all([
      fs.readFile('ecosystem.config.cjs', 'utf8'),
      fs.readFile('deploy/nginx/nva.conf.example', 'utf8'),
      fs.readFile('docs/VPS_DEPLOYMENT.md', 'utf8'),
      fs.readFile('src/app.js', 'utf8'),
    ]);
    assert.match(pm2, /instances:\s*1/);
    assert.match(pm2, /NODE_ENV:\s*'production'/);
    assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:PORT/);
    assert.match(nginx, /return 301 https:/);
    assert.match(nginx, /client_max_body_size 25m/);
    assert.match(guide, /prisma migrate deploy/);
    assert.match(guide, /certbot/);
    assert.match(guide, /off-site|hors site/i);
    assert.match(appSource, /strictTransportSecurity:\s*false/);
  });
});
