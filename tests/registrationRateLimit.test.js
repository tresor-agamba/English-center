const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const csrf = require('../src/middlewares/csrfProtection');

function cookieFrom(response, fallback = '') {
  return response.headers.get('set-cookie')?.split(';')[0] || fallback;
}

test('POST /register est limité par IP sans affecter GET ni CSRF', async (t) => {
  const modulePath = require.resolve('../src/middlewares/rateLimits');
  delete require.cache[modulePath];
  const limits = require(modulePath);
  const previousCsrf = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true';

  const app = express();
  app.set('views', path.resolve(__dirname, '..', 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'registration-rate-limit-test-secret', resave: false, saveUninitialized: false }));
  app.use(csrf.protect);
  app.get('/register', (req, res) => res.json({ csrfToken: res.locals.csrfToken }));
  app.post('/register', limits.register, (_req, res) => res.sendStatus(204));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).send(error.message));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    process.env.CSRF_ENFORCE = previousCsrf;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    delete require.cache[modulePath];
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/register`, { headers: { 'X-Forwarded-For': '192.0.2.10' } });
  assert.equal(response.status, 200);
  let cookie = cookieFrom(response);
  const { csrfToken } = await response.json();

  const submit = (ip, token = csrfToken) => fetch(`${base}/register`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: token }),
    headers: { Cookie: cookie, 'X-Forwarded-For': ip },
  });

  for (let index = 0; index < 10; index += 1) {
    response = await submit('192.0.2.10');
    assert.equal(response.status, 204);
    assert.ok(response.headers.get('ratelimit'));
  }

  response = await submit('192.0.2.10');
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('ratelimit'));
  assert.match(await response.text(), /Trop de requêtes|Veuillez patienter/i);

  response = await submit('198.51.100.20');
  assert.equal(response.status, 204, 'une autre IP derrière le proxy conserve son propre quota');

  response = await fetch(`${base}/register`, { headers: { Cookie: cookie, 'X-Forwarded-For': '192.0.2.10' } });
  assert.equal(response.status, 200, 'GET /register ne doit pas être limité');

  response = await submit('203.0.113.30', 'incorrect');
  assert.equal(response.status, 403, 'le rate limiter ne doit pas désactiver CSRF');
});
