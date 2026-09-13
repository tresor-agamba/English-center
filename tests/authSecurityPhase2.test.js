const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(new URL(process.env.DATABASE_URL).href, new URL(process.env.TEST_DATABASE_URL).href);
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).pathname), '/english_center_test');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const service = require('../src/services/passwordResetRequestService');
const resets = require('../src/services/passwordResetService');
const passwords = require('../src/services/passwordService');
const logger = require('../src/services/loggerService');

test('Phase 2 - demandes de recuperation', async (t) => {
  const ids = [];
  const hash = await passwords.hashPassword('Phase2Pass@2026');
  const suffix = String(Date.now()).slice(-6);
  let serial = 0;
  async function create(extra = {}) {
    const user = await prisma.user.create({ data: { firstName: 'Phase2', lastName: 'Fixture',
      phoneNumber: `+2438${String(++serial).padStart(2, '0')}${suffix}`,
      email: `phase2-${suffix}-${serial}@example.test`, passwordHash: hash, ...extra } });
    ids.push(user.id); return user;
  }
  const count = user => prisma.passwordResetRequest.count({ where: { userId: user.id, status: 'PENDING' } });
  const previous = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true';
  app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  async function request(body, ip = '192.0.2.202', withCsrf = true) {
    const response = await fetch(`${base}/forgot-password`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      body: body === undefined ? undefined : new URLSearchParams({ ...(withCsrf ? { _csrf: csrf } : {}), ...body }), redirect: 'manual' });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    const html = await response.text();
    csrf = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/)?.[1] || csrf;
    return { response, html };
  }
  try {
    await t.test('GET accessible, formulaire et protections conserves', async () => {
      const { response, html } = await request();
      assert.equal(response.status, 200);
      assert.match(html, /label for="identifier"/);
      assert.match(html, /autocomplete="username"/);
      assert.ok(csrf);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    });
    await t.test('STUDENT actif : PENDING, relation et timestamps', async () => {
      const user = await create(), start = Date.now();
      assert.deepEqual(await service.createPasswordResetRequest(user.phoneNumber), { accepted: true });
      const saved = await prisma.user.findUnique({ where: { id: user.id }, include: { passwordResetRequests: true } });
      assert.equal(saved.passwordResetRequests.length, 1);
      const row = saved.passwordResetRequests[0];
      assert.equal(row.userId, user.id); assert.equal(row.status, 'PENDING');
      for (const key of ['requestedAt', 'createdAt', 'updatedAt']) assert.ok(row[key].getTime() >= start - 1000 && row[key].getTime() <= Date.now() + 1000);
      for (const key of ['reviewedAt', 'completedAt', 'reviewedById']) assert.equal(row[key], null);
      assert.equal(saved.passwordHash, hash); assert.equal(saved.authVersion, 0);
    });
    await t.test('telephone normalise et compte sans email admissible', async () => {
      const user = await create({ email: null });
      await service.createPasswordResetRequest(`0${user.phoneNumber.slice(4)}`);
      assert.equal(await count(user), 1);
    });
    await t.test('email normalise et deuxieme demande sans doublon', async () => {
      const user = await create();
      await service.createPasswordResetRequest(` ${user.email.toUpperCase()} `);
      const before = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
      await service.createPasswordResetRequest(user.phoneNumber);
      assert.equal(await count(user), 1);
      assert.deepEqual(await prisma.passwordResetRequest.findUnique({ where: { id: before.id } }), before);
    });
    await t.test('huit demandes concurrentes donnent une seule PENDING', async () => {
      const user = await create();
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => service.createPasswordResetRequest(i % 2 ? user.email : user.phoneNumber)));
      results.forEach(result => assert.deepEqual(result, { accepted: true }));
      assert.equal(await count(user), 1);
    });
    for (const [role, isActive, expected] of [['TEACHER', true, 1], ['ADMIN', true, 0], ['STUDENT', false, 0], ['TEACHER', false, 0], ['ADMIN', false, 0]]) {
      await t.test(`politique ${role} actif=${isActive}`, async () => {
        const user = await create({ role, isActive });
        assert.deepEqual(await service.createPasswordResetRequest(user.email), { accepted: true });
        assert.equal(await count(user), expected);
      });
    }
    await t.test('entrees invalides et compte absent : meme resultat', async () => {
      const before = await prisma.passwordResetRequest.count();
      for (const identifier of [undefined, {}, [], '', 'invalid', 'x'.repeat(255), `absent-${suffix}@example.test`]) {
        assert.deepEqual(await service.createPasswordResetRequest(identifier), { accepted: true });
      }
      assert.equal(await prisma.passwordResetRequest.count(), before);
    });
    await t.test('revalidation du compte sous verrou', async () => {
      const user = await create(), original = passwords.lockUser;
      passwords.lockUser = async (tx, id) => { await original(tx, id); await tx.user.update({ where: { id }, data: { isActive: false } }); };
      try { await service.createPasswordResetRequest(user.email); } finally { passwords.lockUser = original; }
      assert.equal(await count(user), 0);
    });
    await t.test('historique termine conserve, nouvelle demande permise', async () => {
      const user = await create();
      const old = await prisma.passwordResetRequest.create({ data: { userId: user.id, status: 'REJECTED' } });
      await service.createPasswordResetRequest(user.email);
      assert.equal(await count(user), 1);
      assert.equal((await prisma.passwordResetRequest.findUnique({ where: { id: old.id } })).status, 'REJECTED');
    });
    await t.test('ancien service sans livraison ni token et tokens existants preserves', async () => {
      const user = await create();
      const token = await require('./helpers/passwordResetTokenFixture')(user.id);
      const before = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      assert.deepEqual(await resets.requestReset(user.email), { accepted: true });
      assert.deepEqual(await prisma.passwordResetToken.findMany({ where: { userId: user.id } }), before);
      assert.ok(await resets.findValid(token));
    });
    await t.test('POST connu, inconnu, inactif, ADMIN et doublon : reponse identique sans secrets', async () => {
      const user = await create(), inactive = await create({ isActive: false }), admin = await create({ role: 'ADMIN' });
      let expected;
      for (const identifier of [user.email, user.email, `missing-${suffix}@example.test`, inactive.email, admin.email]) {
        const { response, html } = await request({ identifier });
        assert.equal(response.status, 200);
        const status = html.match(/<p role="status"[^>]*>(.*?)<\/p>/)[1];
        expected ||= status; assert.equal(status, expected);
        assert.match(status, /demande/);
        assert.doesNotMatch(html, /EMAIL_PENDING|\/reset-password\/|passwordHash|tokenHash|Phase2Pass@2026/);
        for (const secret of [user.email, user.phoneNumber, inactive.email, admin.email, hash]) assert.equal(html.includes(secret), false);
      }
      assert.equal(await count(user), 1); assert.equal(await count(inactive), 0); assert.equal(await count(admin), 0);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: { in: [user.id, inactive.id, admin.id] } } }), 0);
    });
    await t.test('CSRF absent refuse sans creation', async () => {
      const user = await create();
      assert.equal((await request({ identifier: user.email }, '192.0.2.203', false)).response.status, 403);
      assert.equal(await count(user), 0);
    });
    await t.test('limite existante : 10 requetes par heure et IP', async () => {
      for (let i = 0; i < 10; i++) assert.equal((await request({ identifier: 'unknown' }, '192.0.2.204')).response.status, 200);
      const user = await create();
      assert.equal((await request({ identifier: user.email }, '192.0.2.204')).response.status, 429);
      assert.equal(await count(user), 0);
      assert.equal((await request({ identifier: user.email }, '192.0.2.205')).response.status, 200);
      assert.equal(await count(user), 1);
    });
    await t.test('audit minimal unique sans identifiant de contact ou secret', async () => {
      const user = await create(), events = [], original = logger.audit;
      logger.audit = (action, data) => events.push({ action, data });
      try { await service.createPasswordResetRequest(user.email); await service.createPasswordResetRequest(user.email); }
      finally { logger.audit = original; }
      const saved = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
      assert.deepEqual(events, [{ action: 'PASSWORD_RESET_REQUEST_CREATED', data: { requestId: saved.id, userId: user.id } }]);
    });
    await t.test('FR/EN : cles du formulaire et message generique', () => {
      const source = fs.readFileSync('public/js/i18n.js', 'utf8');
      const translations = Function(`return (${source.match(/const translations = (\{[\s\S]*?\n  \});/)[1]})`)();
      const view = fs.readFileSync('views/auth/forgot-password.ejs', 'utf8');
      for (const [, key] of view.matchAll(/data-i18n="([^"]+)"/g)) for (const lang of ['fr', 'en']) assert.ok(translations[lang][key]);
      assert.match(translations.en['forgot.sent'], /request has been recorded/);
      assert.match(translations.fr['forgot.sent'], /enregistrée/);
    });
  } finally {
    if (previous === undefined) delete process.env.CSRF_ENFORCE; else process.env.CSRF_ENFORCE = previous;
    await new Promise(resolve => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore();
    await prisma.$disconnect();
  }
});
