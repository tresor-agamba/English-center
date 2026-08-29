const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const session = require('express-session');
const prisma = require('../src/utils/prisma');
const sessionStore = require('../src/config/sessionStore');
const app = require('../src/app');

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = fork(require.resolve('./helpers/persistentSessionServer'), [], { env: process.env, silent: true });
    const timer = setTimeout(() => reject(new Error('Timeout au démarrage du serveur de persistance')), 15_000);
    child.once('error', reject);
    child.on('message', (message) => {
      if (message.error) return reject(new Error(message.error));
      clearTimeout(timer);
      resolve({ child, baseUrl: `http://127.0.0.1:${message.port}` });
    });
  });
}

function stopServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Timeout à l’arrêt du serveur')); }, 15_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Serveur arrêté avec le code ${code}`));
    });
    child.send('shutdown');
  });
}

test('stockage PostgreSQL des sessions', async (t) => {
  const store = sessionStore.getSessionStore();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, allowExitOnIdle: true });
  const sid = `session-store-${Date.now()}-${process.pid}`;

  try {
    await t.test('n’utilise pas MemoryStore et conserve une session valide', async () => {
      assert.equal(store instanceof session.MemoryStore, false);
      assert.equal(sessionStore.STORE_KIND, 'postgresql');
      assert.equal(app.locals.sessionStore, store);
      await sessionStore.verifySessionStore();
      await storeCall(store, 'set', sid, { cookie: { maxAge: 28_800_000 }, user: { id: 42 } });
      assert.equal((await storeCall(store, 'get', sid)).user.id, 42);
    });

    await t.test('refuse une session expirée et permet son nettoyage', async () => {
      await pool.query(`UPDATE "${sessionStore.SESSION_TABLE}" SET expire = NOW() - INTERVAL '1 second' WHERE sid = $1`, [sid]);
      assert.equal(await storeCall(store, 'get', sid), undefined);
      await new Promise((resolve, reject) => store.pruneSessions((error) => error ? reject(error) : resolve()));
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM "${sessionStore.SESSION_TABLE}" WHERE sid = $1`, [sid]);
      assert.equal(result.rows[0].count, 0);
    });

    await t.test('préserve l’authentification après redémarrage du processus Node', async () => {
      const suffix = `${Date.now()}${process.pid}`.slice(-8);
      const password = 'Session@2026';
      const user = await prisma.user.create({
        data: {
          firstName: 'Session', lastName: 'Persistante', phoneNumber: `+2438${suffix}`,
          passwordHash: await bcrypt.hash(password, 12), role: 'STUDENT',
        },
      });
      let first;
      let second;
      try {
        first = await startServer();
        const loginPage = await fetch(`${first.baseUrl}/login`);
        const anonymousCookie = loginPage.headers.get('set-cookie')?.split(';')[0];
        assert.ok(anonymousCookie);
        const login = await fetch(`${first.baseUrl}/login`, {
          method: 'POST', headers: { Cookie: anonymousCookie },
          body: new URLSearchParams({ phoneNumber: user.phoneNumber, password }), redirect: 'manual',
        });
        assert.equal(login.headers.get('location'), '/student');
        const cookie = login.headers.get('set-cookie')?.split(';')[0];
        assert.ok(cookie);
        assert.notEqual(cookie, anonymousCookie);
        await stopServer(first.child);
        first = undefined;

        second = await startServer();
        const page = await fetch(`${second.baseUrl}/student`, { headers: { Cookie: cookie }, redirect: 'manual' });
        assert.equal(page.status, 200);
        const logout = await fetch(`${second.baseUrl}/logout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
        assert.equal(logout.headers.get('location'), '/login');
        const rejected = await fetch(`${second.baseUrl}/student`, { headers: { Cookie: cookie }, redirect: 'manual' });
        assert.equal(rejected.headers.get('location'), '/login');
      } finally {
        if (first) await stopServer(first.child).catch(() => {});
        if (second) await stopServer(second.child).catch(() => {});
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      }
    });
  } finally {
    await storeCall(store, 'destroy', sid).catch(() => {});
    await pool.end();
  }
});
