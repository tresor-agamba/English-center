const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

test('le rate limiter isole les adresses IPv4 mappées et refuse le dépassement', async (t) => {
  const modulePath = require.resolve('../src/middlewares/rateLimits');
  delete require.cache[modulePath];
  const limits = require(modulePath);
  const app = express();
  app.set('views', path.resolve(__dirname, '..', 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', 1);
  app.get('/limited', limits.login, (_req, res) => res.sendStatus(204));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    delete require.cache[modulePath];
  });

  const url = `http://127.0.0.1:${server.address().port}/limited`;
  const request = (ip) => fetch(url, { headers: { 'X-Forwarded-For': ip } });
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await request('::ffff:192.0.2.10')).status, 204);
  }
  assert.equal((await request('::ffff:192.0.2.10')).status, 429);
  assert.equal((await request('::ffff:198.51.100.20')).status, 204);
});
