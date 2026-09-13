const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const signature = require('cookie-signature');

// Refuse accidental direct execution against the development database.
const target = new URL(process.env.TEST_DATABASE_URL);
assert.ok(decodeURIComponent(target.pathname.slice(1)).includes('_test'));
const active = new URL(process.env.DATABASE_URL);
assert.equal(decodeURIComponent(active.pathname.slice(1)), decodeURIComponent(target.pathname.slice(1)));
assert.equal(active.hostname, target.hostname);
assert.equal(active.port || '5432', target.port || '5432');
assert.equal(process.env.NODE_ENV, 'test');

const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const passwords = require('../src/services/passwordService');
const resets = require('../src/services/passwordResetService');
const auth = require('../src/services/authService');
const profileService = require('../src/services/studentProfileService');
const logger = require('../src/services/loggerService');
const errorHandler = require('../src/middlewares/errorHandler');
const store = require('../src/config/sessionStore').getSessionStore();

test('Phase 1 — sécurité de l’authentification', async (t) => {
  const previousCsrf = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true';
  app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = [], sids = new Set();
  const initialPassword = 'Old@2026'; // Existing 8-character credentials must still work.
  const initialHash = await bcrypt.hash(initialPassword, 12);
  let serial = 0, address = 0;
  const suffix = String(Date.now()).slice(-6);
  const callStore = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (e, value) => e ? reject(e) : resolve(value)));
  function sid(cookie) {
    const value = decodeURIComponent(cookie.split('=').slice(1).join('='));
    return signature.unsign(value.slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
  }
  async function request(path, jar = {}, body, extraHeaders = {}) {
    const headers = { 'X-Forwarded-For': `192.0.${Math.floor(++address / 250)}.${address % 250 + 1}`, ...extraHeaders };
    if (jar.cookie) headers.Cookie = jar.cookie;
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : new URLSearchParams(body), redirect: 'manual',
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie && !cookie.endsWith('=')) { jar.cookie = cookie; const key = sid(cookie); if (key) sids.add(key); }
    const html = await response.text();
    const csrf = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/);
    if (csrf) jar.csrf = csrf[1];
    return { response, html };
  }
  async function create(role = 'STUDENT', extra = {}) {
    const user = await prisma.user.create({ data: {
      firstName: 'Phase1', lastName: role, phoneNumber: `+2438${String(++serial).padStart(2, '0')}${suffix}`,
      email: `phase1-${suffix}-${serial}@example.test`, role, passwordHash: initialHash, ...extra,
    } });
    ids.push(user.id); return user;
  }
  async function login(user, password = initialPassword) {
    const jar = {};
    await request('/login', jar);
    const result = await request('/login', jar, { phoneNumber: user.phoneNumber, password, _csrf: jar.csrf });
    assert.equal(result.response.status, 302, result.html);
    await request('/login', jar); // CSRF token belongs to the regenerated session.
    return jar;
  }
  async function denied(jar, path = '/student') {
    const result = await request(path, jar);
    assert.equal(result.response.status, 302);
    assert.equal(result.response.headers.get('location'), '/login');
    assert.match(result.response.headers.get('set-cookie') || '', /connect\.sid=;/);
  }
  async function activeToken(user) {
    return require('./helpers/passwordResetTokenFixture')(user.id);
  }
  async function assertChanged(user, version, token) {
    const saved = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(saved.authVersion, version + 1);
    assert.equal(await resets.findValid(token), null);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } }), 0);
    return saved;
  }
  try {
    for (const [role, path] of [['STUDENT', '/student'], ['TEACHER', '/teacher'], ['ADMIN', '/admin/dashboard']]) {
      await t.test(`A/N/O/P — login ${role}, version et absence de hash dans la session`, async () => {
        const user = await create(role);
        const jar = await login(user);
        const saved = await callStore('get', sid(jar.cookie));
        assert.equal(saved.user.authVersion, 0);
        assert.equal(saved.user.role, role);
        assert.equal(Object.hasOwn(saved.user, 'passwordHash'), false);
        assert.equal((await request(path, jar)).response.status, 200);
      });
    }
    for (const [label, change] of [
      ['B — version incorrecte', value => { value.user.authVersion += 1; }],
      ['C — version absente', value => { delete value.user.authVersion; }],
    ]) {
      await t.test(label, async () => {
        const jar = await login(await create());
        const key = sid(jar.cookie), saved = await callStore('get', key);
        change(saved); await callStore('set', key, saved);
        await denied(jar);
        assert.equal(await callStore('get', key), undefined);
      });
    }
    for (const [label, role, data, path] of [
      ['D — étudiant désactivé', 'STUDENT', { isActive: false }, '/student'],
      ['E — ADMIN rétrogradé', 'ADMIN', { role: 'STUDENT' }, '/admin/dashboard'],
      ['F — ADMIN désactivé', 'ADMIN', { isActive: false }, '/admin/dashboard'],
    ]) {
      await t.test(label, async () => {
        const user = await create(role), jar = await login(user);
        await prisma.user.update({ where: { id: user.id }, data });
        await denied(jar, path);
      });
    }
    await t.test('compte supprimé et rôle STUDENT ne donnent aucun accès ADMIN', async () => {
      const user = await create('ADMIN'), jar = await login(user);
      await prisma.user.delete({ where: { id: user.id } });
      await denied(jar, '/admin/dashboard');
      assert.equal((await request('/admin/dashboard', await login(await create()))).response.status, 403);
    });
    await t.test('G/H/I — profil étudiant : version, tokens et toutes les anciennes sessions', async () => {
      const user = await create(), first = await login(user), second = await login(user);
      const token = await activeToken(user), password = 'Nouveau@2026';
      const result = await request('/student/profile/password', first, { currentPassword: initialPassword, newPassword: password, confirmPassword: password, _csrf: first.csrf });
      assert.equal(result.response.status, 302);
      await assertChanged(user, 0, token);
      await denied(second);
      assert.equal((await request('/student', first)).response.status, 302);
      assert.equal(await auth.authenticate(user.phoneNumber, initialPassword), null);
      assert.equal((await auth.authenticate(user.phoneNumber, password)).authVersion, 1);
    });
    await t.test('J/K — reset atomique, concurrence, usage unique et expiration', async () => {
      const user = await create(), jar = await login(user), token = await activeToken(user);
      const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      assert.equal(rows.some(row => row.tokenHash === token), false);
      const results = await Promise.allSettled([resets.resetPassword(token, 'ResetOne@2026'), resets.resetPassword(token, 'ResetTwo@2026')]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'INVALID_TOKEN');
      assert.equal((await assertChanged(user, 0, token)).mustChangePassword, false);
      await denied(jar);
      await assert.rejects(resets.resetPassword(token, 'ResetAgain@2026'), { code: 'INVALID_TOKEN' });
      const expired = await activeToken(user);
      await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(resets.resetPassword(expired, 'Expired@2026'), { code: 'INVALID_TOKEN' });
      assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).authVersion, 1);
    });
    await t.test('Q — mot de passe temporaire obligatoire ; changement volontaire séparé', async () => {
      const user = await create('STUDENT', { mustChangePassword: true });
      const jar = await login(user), old = await login(user), token = await activeToken(user);
      assert.equal((await request('/student', jar)).response.headers.get('location'), '/change-password');
      const result = await request('/change-password', jar, { password: 'Definitif@2026', passwordConfirmation: 'Definitif@2026', _csrf: jar.csrf });
      assert.equal(result.response.status, 302);
      assert.equal((await assertChanged(user, 0, token)).mustChangePassword, false);
      await denied(old);
      const fresh = await login(user, 'Definitif@2026');
      assert.equal((await request('/student', fresh)).response.status, 200);
      assert.equal((await request('/change-password', fresh, { password: 'AttackPass@2026', passwordConfirmation: 'AttackPass@2026', _csrf: fresh.csrf })).response.status, 403);
      await assert.rejects(profileService.changePassword(user.id, { newPassword: 'Volontaire@2026', confirmPassword: 'Volontaire@2026' }), { code: 'CURRENT_REQUIRED' });
    });
    await t.test('expiration revérifiée après lecture et avant consommation ; rollback si compte inactif', async () => {
      const user = await create(), token = await activeToken(user);
      const originalLock = passwords.lockUser;
      passwords.lockUser = async (tx, id) => {
        await originalLock(tx, id);
        await tx.passwordResetToken.updateMany({ where: { userId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      };
      try {
        await assert.rejects(resets.resetPassword(token, 'TooLate@2026'), { code: 'INVALID_TOKEN' });
      } finally { passwords.lockUser = originalLock; }
      assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).authVersion, 0);
      assert.ok(await resets.findValid(token)); // The failed transaction rolls back the injected expiry too.
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await assert.rejects(resets.resetPassword(token, 'Inactive@2026'), { code: 'INVALID_TOKEN' });
      const saved = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(saved.authVersion, 0);
      assert.equal(saved.passwordHash, initialHash);
      assert.equal(await resets.findValid(token), null); // GET now also refuses inactive accounts.
      assert.equal((await prisma.passwordResetToken.findUnique({ where: { tokenHash: resets.hashToken(token) } })).usedAt, null);
    });
    await t.test('resets ADMIN étudiant et enseignant invalident sessions et tokens', async () => {
      const admin = await login(await create('ADMIN'));
      for (const [role, route] of [['STUDENT', 'students'], ['TEACHER', 'teachers']]) {
        const user = await create(role), old = await login(user), token = await activeToken(user);
        const result = await request(`/admin/${route}/${user.id}/reset-password`, admin, { password: 'Temporary@2026', passwordConfirmation: 'Temporary@2026', _csrf: admin.csrf });
        assert.equal(result.response.status, 302, result.html);
        assert.equal((await assertChanged(user, 0, token)).mustChangePassword, true);
        await denied(old, role === 'STUDENT' ? '/student' : '/teacher');
        const fresh = await login(user, 'Temporary@2026');
        assert.equal((await request(role === 'STUDENT' ? '/student' : '/teacher', fresh)).response.headers.get('location'), '/change-password');
      }
    });
    await t.test('profil enseignant exige le mot de passe actuel et révoque les accès', async () => {
      const user = await create('TEACHER'), jar = await login(user), old = await login(user), token = await activeToken(user);
      const body = { firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, password: 'TeacherNew@2026', passwordConfirmation: 'TeacherNew@2026', _csrf: jar.csrf };
      assert.equal((await request('/teacher/profile', jar, body)).response.status, 400);
      assert.equal((await request('/teacher/profile', jar, { ...body, currentPassword: initialPassword })).response.status, 302);
      await assertChanged(user, 0, token);
      await denied(old, '/teacher');
    });
    await t.test('R — CSRF et headers des pages de récupération', async () => {
      const user = await create(), token = await activeToken(user), jar = {};
      for (const path of ['/forgot-password', `/reset-password/${token}`, '/reset-password/invalid']) {
        const result = await request(path, jar);
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
        assert.equal(result.response.headers.get('referrer-policy'), 'no-referrer');
      }
      assert.equal((await request(`/reset-password/${token}`, jar, { password: 'CsrfReset@2026', passwordConfirmation: 'CsrfReset@2026' })).response.status, 403);
      assert.ok(await resets.findValid(token));
      const result = await request(`/reset-password/${token}`, jar, { password: 'CsrfReset@2026', passwordConfirmation: 'CsrfReset@2026', _csrf: jar.csrf });
      assert.equal(result.response.status, 200);
      assert.match(result.html, /Your password has been changed/);
    });
    await t.test('politique centralisée et entrées invalides sans changement de compte', async () => {
      assert.equal(passwords.PASSWORD_MIN_LENGTH, 10);
      assert.equal(passwords.PASSWORD_COST, 12);
      for (const value of [undefined, {}, [], 'short', 'é'.repeat(37)]) assert.throws(() => passwords.validatePassword(value), passwords.PasswordError);
      assert.throws(() => passwords.validatePassword('ValidPass@2026', 'Different@2026'), passwords.PasswordError);
      const user = await create(), token = await activeToken(user);
      await assert.rejects(resets.resetPassword(token, 'short'), passwords.PasswordError);
      assert.ok(await resets.findValid(token));
      assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).authVersion, 0);
    });
    await t.test('L/M — aucun secret dans les logs HTTP, erreurs et métadonnées', async () => {
      const token = 'Phase1SecretToken_ABC123', secret = 'Phase1PasswordSecret', hash = initialHash;
      const logs = [], savedConsole = { log: console.log, warn: console.warn, error: console.error };
      for (const level of Object.keys(savedConsole)) console[level] = value => logs.push(String(value));
      try {
        const result = await request(`/reset-password/${token}`);
        assert.equal(result.response.status, 400);
        logger.info('SANITIZATION_TEST', {
          password: secret, passwordHash: hash, currentPassword: secret, newPassword: secret, confirmPassword: secret,
          token, cookie: secret, SESSION_SECRET: secret,
          nested: { originalUrl: `/reset-password/${token}?newPassword=${secret}`, referer: `https://example.test/reset-password/${token}`, encoded: encodeURIComponent(encodeURIComponent(`/reset-password/${token}`)) },
          message: `password="${secret}" currentPassword=${secret} passwordHash=${hash} token=${token}`,
          error: new Error(`request /reset-password/${token}`),
        });
        let rendered;
        errorHandler(new Error(`technical /reset-password/${token} password=${secret}`), {
          originalUrl: `/reset-password/${token}`, method: 'POST', accepts: () => 'html', session: {},
        }, { headersSent: false, status() { return this; }, render(view, data) { rendered = data; } }, () => {});
        assert.equal(JSON.stringify(rendered).includes(token), false);
        assert.equal(JSON.stringify(rendered).includes(secret), false);
      } finally { Object.assign(console, savedConsole); }
      const output = logs.join('\n');
      for (const value of [token, secret, hash]) assert.equal(output.includes(value), false, 'Un secret a été journalisé');
      assert.match(output, /REDACTED/);
    });
    await t.test('erreur technique du reset masquée ; réponse publique non énumérante', async () => {
      const jar = {};
      await request('/forgot-password', jar);
      const existing = await create();
      const known = await request('/forgot-password', jar, { identifier: existing.phoneNumber, _csrf: jar.csrf });
      const unknown = await request('/forgot-password', jar, { identifier: '+243899999999', _csrf: jar.csrf });
      assert.equal(known.response.status, unknown.response.status);
      assert.match(known.html, /Si un compte admissible/);
      assert.match(unknown.html, /Si un compte admissible/);
      const original = resets.resetPassword;
      resets.resetPassword = async () => { throw new Error('INTERNAL_DATABASE_DETAIL'); };
      try {
        const result = await request('/reset-password/not-a-real-token', jar, { password: 'ResetError@2026', passwordConfirmation: 'ResetError@2026', _csrf: jar.csrf });
        assert.equal(result.response.status, 500);
        assert.doesNotMatch(result.html, /INTERNAL_DATABASE_DETAIL/);
      } finally { resets.resetPassword = original; }
    });
  } finally {
    process.env.CSRF_ENFORCE = previousCsrf;
    await new Promise(resolve => server.close(resolve));
    for (const key of sids) await callStore('destroy', key);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore();
    await prisma.$disconnect();
  }
});
