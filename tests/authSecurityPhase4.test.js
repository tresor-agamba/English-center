const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const signature = require('cookie-signature');
assert.equal(process.env.NODE_ENV, 'test');
const active = new URL(process.env.DATABASE_URL), target = new URL(process.env.TEST_DATABASE_URL);
for (const key of ['protocol', 'hostname', 'port', 'username', 'password', 'pathname']) assert.equal(active[key], target[key]);
assert.equal(decodeURIComponent(active.pathname), '/english_center_test');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const resets = require('../src/services/passwordResetService');
const requests = require('../src/services/passwordResetRequestService');
const passwords = require('../src/services/passwordService');
const auth = require('../src/services/authService');
const logger = require('../src/services/loggerService');
const sanitizeUrl = require('../src/utils/sanitizeUrl');
const store = require('../src/config/sessionStore').getSessionStore();

test('Phase 4 — récupération approuvée, émission isolée et finalisation atomique', async t => {
  const previousCsrf = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true'; app.set('trust proxy', 1);
  const ids = [], sids = new Set();
  const initialPassword = 'Phase4Initial@2026', nextPassword = 'Phase4Changed@2026';
  const initialHash = await passwords.hashPassword(initialPassword);
  const suffix = String(Date.now()).slice(-6);
  let serial = 0, ip = 0;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const callStore = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (error, result) => error ? reject(error) : resolve(result)));
  async function create(extra = {}) {
    const user = await prisma.user.create({ data: { firstName: 'Phase4', lastName: 'Fixture',
      phoneNumber: `+2439${String(++serial).padStart(2, '0')}${suffix}`, email: `phase4-${suffix}-${serial}@example.test`,
      passwordHash: initialHash, ...extra } });
    ids.push(user.id); return user;
  }
  async function http(path, jar = {}, body, csrf = true) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Cookie: `${jar.cookie || ''}; nva-language=fr`, 'X-Forwarded-For': `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}` },
      body: body === undefined ? undefined : new URLSearchParams({ ...(csrf ? { _csrf: jar.csrf || '' } : {}), ...body }) });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie && !cookie.endsWith('=')) {
      jar.cookie = cookie;
      const sid = signature.unsign(decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
      if (sid) sids.add(sid);
    }
    const html = await response.text();
    jar.csrf = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/)?.[1] || jar.csrf;
    return { response, html };
  }
  async function login(user, password = initialPassword) {
    const jar = {}; await http('/login', jar);
    assert.equal((await http('/login', jar, { phoneNumber: user.phoneNumber, password })).response.status, 302);
    await http('/login', jar); return jar;
  }
  const savedUser = id => prisma.user.findUnique({ where: { id } });
  const savedRequest = id => prisma.passwordResetRequest.findUnique({ where: { id } });
  const savedToken = token => prisma.passwordResetToken.findUnique({ where: { tokenHash: resets.hashToken(token) } });
  let admin;
  async function approved(extra = {}) {
    const user = await create(extra);
    await requests.createPasswordResetRequest(user.phoneNumber);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
    await requests.approvePasswordResetRequest(request.id, admin);
    return { user, request: await savedRequest(request.id) };
  }
  async function issued(extra = {}) {
    const fixture = await approved(extra);
    return { ...fixture, ...await resets.preparePasswordResetForTest(fixture.request.id) };
  }
  async function invalid(token) {
    assert.equal(await resets.findValid(token), null);
    const get = await http(`/reset-password/${token}`);
    assert.equal(get.response.status, 400); assert.match(get.html, /Ce lien est invalide ou expiré/);
    assert.doesNotMatch(get.html, /name="passwordConfirmation"/);
    await assert.rejects(resets.resetPassword(token, nextPassword), { code: 'INVALID_TOKEN' });
  }
  try {
    admin = await create({ role: 'ADMIN' });
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED']) await t.test(`${status} interdit toute émission`, async () => {
      const { user, request } = await approved();
      await prisma.passwordResetRequest.update({ where: { id: request.id }, data: { status } });
      await assert.rejects(resets.preparePasswordResetForTest(request.id), { code: 'INVALID_TOKEN' });
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    });
    let first;
    await t.test('APPROVED émet avec crypto.randomBytes(32) et lie les bonnes identités', async () => {
      const fixture = await approved(), calls = [], original = crypto.randomBytes;
      crypto.randomBytes = size => { calls.push(size); return original(size); };
      try { first = { ...fixture, ...await resets.preparePasswordResetForTest(fixture.request.id) }; }
      finally { crypto.randomBytes = original; }
      assert.deepEqual(calls, [32]); assert.ok(/^[A-Za-z0-9_-]{43}$/.test(first.token));
      const row = await savedToken(first.token);
      assert.equal(row.requestId, first.request.id); assert.equal(row.userId, first.user.id);
      assert.equal((await savedRequest(first.request.id)).status, 'APPROVED');
    });
    await t.test('seul SHA-256 est stocké, aucun token brut dans les enregistrements', async () => {
      const row = await savedToken(first.token);
      assert.ok(row.tokenHash === crypto.createHash('sha256').update(first.token).digest('hex'));
      const databaseRows = JSON.stringify([row, await savedRequest(first.request.id), await savedUser(first.user.id)]);
      assert.ok(!databaseRows.includes(first.token)); assert.ok(!databaseRows.includes(initialPassword));
    });
    await t.test('expiration positive et au plus trente minutes', async () => {
      const start = Date.now(), fixture = await issued(), row = await savedToken(fixture.token);
      assert.equal(resets.TOKEN_TTL_MS, 1800000);
      assert.ok(row.expiresAt.getTime() > start);
      assert.ok(row.expiresAt.getTime() <= Date.now() + 1800000);
      assert.ok(row.expiresAt.getTime() - row.createdAt.getTime() <= 1800000);
    });
    await t.test('deux émissions distinctes utilisent des secrets distincts', async () => {
      const second = await issued(); assert.ok(first.token !== second.token);
    });
    await t.test('seconde émission de la même demande refusée sans modifier le premier token', async () => {
      const before = await savedToken(first.token);
      await assert.rejects(resets.preparePasswordResetForTest(first.request.id), { code: 'INVALID_TOKEN' });
      assert.deepEqual(await savedToken(first.token), before);
    });
    await t.test('émissions concurrentes : une seule réussite et un seul audit', async () => {
      const { request } = await approved(), events = [], original = logger.audit;
      logger.audit = (action, data) => events.push({ action, data });
      let results;
      try { results = await Promise.allSettled([resets.preparePasswordResetForTest(request.id), resets.preparePasswordResetForTest(request.id)]); }
      finally { logger.audit = original; }
      assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(results.find(x => x.status === 'rejected').reason.code, 'INVALID_TOKEN');
      assert.equal(await prisma.passwordResetToken.count({ where: { requestId: request.id } }), 1);
      assert.deepEqual(events, [{ action: 'PASSWORD_RESET_TOKEN_ISSUED', data: { requestId: request.id, userId: request.userId } }]);
    });
    await t.test('contrainte unique SQL interdit un second token lié à la demande', async () => {
      await assert.rejects(prisma.passwordResetToken.create({ data: { requestId: first.request.id, userId: first.user.id,
        tokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 10000) } }), { code: 'P2002' });
    });
    await t.test('identifiants absents, invalides ou inexistants refusés', async () => {
      for (const id of [undefined, null, {}, '1', 0, -1, 1.5, 2147483648, 2147483647]) await assert.rejects(resets.preparePasswordResetForTest(id), { code: 'INVALID_TOKEN' });
    });
    await t.test('émission de test désactivée en production et développement', async () => {
      const previous = process.env.NODE_ENV;
      try { for (const value of ['production', 'development', '']) {
        process.env.NODE_ENV = value;
        await assert.rejects(resets.preparePasswordResetForTest(first.request.id), { code: 'TEST_DELIVERY_DISABLED' });
      } } finally { process.env.NODE_ENV = previous; }
    });
    await t.test('émission de test refuse une configuration de base non isolée', async () => {
      const previous = process.env.TEST_DATABASE_URL;
      try { const bad = new URL(previous); bad.pathname = '/english_center'; process.env.TEST_DATABASE_URL = bad.href;
        await assert.rejects(resets.preparePasswordResetForTest(first.request.id), { code: 'TEST_DELIVERY_DISABLED' });
      } finally { process.env.TEST_DATABASE_URL = previous; }
    });
    await t.test('GET valide présente le formulaire et ses protections', async () => {
      const { response, html } = await http(`/reset-password/${first.token}`);
      assert.equal(response.status, 200); assert.match(html, /name="passwordConfirmation"/); assert.match(html, /minlength="10"/);
      assert.match(html, /name="_csrf"/); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.doesNotMatch(html, /rel="canonical"|property="og:url"/);
    });
    await t.test('token inconnu, mal formé ou historique non lié refusé', async () => {
      for (const token of ['invalid', 'a'.repeat(43)]) await invalid(token);
      const user = await create(), token = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: resets.hashToken(token), expiresAt: new Date(Date.now() + 1800000) } });
      await invalid(token); assert.equal((await savedUser(user.id)).passwordHash, initialHash);
    });
    await t.test('token expiré refusé, demande APPROVED préservée, aucune réémission', async () => {
      const fixture = await issued();
      await prisma.passwordResetToken.update({ where: { requestId: fixture.request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await invalid(fixture.token);
      assert.equal((await savedRequest(fixture.request.id)).status, 'APPROVED');
      await assert.rejects(resets.preparePasswordResetForTest(fixture.request.id), { code: 'INVALID_TOKEN' });
    });
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED']) await t.test(`token lié à ${status} refusé en GET et consommation`, async () => {
      const fixture = await issued();
      await prisma.passwordResetRequest.update({ where: { id: fixture.request.id }, data: { status } });
      await invalid(fixture.token); assert.equal((await savedUser(fixture.user.id)).authVersion, 0);
    });
    for (const [label, change] of [['inactif', { isActive: false }], ['devenu ADMIN', { role: 'ADMIN' }]]) {
      await t.test(`compte ${label} interdit émission et consommation`, async () => {
        const fixture = await issued(), other = await approved();
        for (const id of [fixture.user.id, other.user.id]) await prisma.user.update({ where: { id }, data: change });
        await invalid(fixture.token);
        await assert.rejects(resets.preparePasswordResetForTest(other.request.id), { code: 'INVALID_TOKEN' });
        assert.equal((await savedUser(fixture.user.id)).authVersion, 0);
      });
    }
    await t.test('compte supprimé : cascade et refus générique', async () => {
      const fixture = await issued(); await prisma.user.delete({ where: { id: fixture.user.id } });
      await invalid(fixture.token); await assert.rejects(resets.preparePasswordResetForTest(fixture.request.id), { code: 'INVALID_TOKEN' });
    });
    await t.test('demande supprimée : token supprimé et refus générique', async () => {
      const fixture = await issued(); await prisma.passwordResetRequest.delete({ where: { id: fixture.request.id } });
      await invalid(fixture.token); assert.equal(await savedToken(fixture.token), null);
    });
    await t.test('mauvais userId du token : aucun des deux comptes ne change', async () => {
      const fixture = await issued(), other = await create();
      await prisma.passwordResetToken.update({ where: { requestId: fixture.request.id }, data: { userId: other.id } });
      await invalid(fixture.token);
      for (const id of [fixture.user.id, other.id]) assert.equal((await savedUser(id)).passwordHash, initialHash);
    });
    await t.test('demande réattribuée à un autre utilisateur : refus', async () => {
      const fixture = await issued(), other = await create();
      await prisma.passwordResetRequest.update({ where: { id: fixture.request.id }, data: { userId: other.id } });
      await invalid(fixture.token);
      for (const id of [fixture.user.id, other.id]) assert.equal((await savedUser(id)).authVersion, 0);
    });
    await t.test('token relié à une mauvaise demande : refus', async () => {
      const fixture = await issued(), other = await approved();
      await prisma.passwordResetToken.update({ where: { requestId: fixture.request.id }, data: { requestId: other.request.id } });
      await invalid(fixture.token);
    });
    await t.test('snapshot historique absent : émission et consommation interdites', async () => {
      const fixture = await issued(), other = await approved();
      for (const id of [fixture.request.id, other.request.id]) await prisma.passwordResetRequest.update({ where: { id }, data: { authVersionAtRequest: null } });
      await invalid(fixture.token); await assert.rejects(resets.preparePasswordResetForTest(other.request.id), { code: 'INVALID_TOKEN' });
    });
    await t.test('changement de mot de passe après demande : ancienne approbation inutilisable', async () => {
      const fixture = await approved();
      await passwords.replacePasswordHash(fixture.user.id, await passwords.hashPassword(nextPassword));
      await assert.rejects(resets.preparePasswordResetForTest(fixture.request.id), { code: 'INVALID_TOKEN' });
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: fixture.user.id } }), 0);
    });
    await t.test('authVersion modifiée après émission : consommation interdite même sans usedAt', async () => {
      const fixture = await issued();
      await prisma.user.update({ where: { id: fixture.user.id }, data: { authVersion: { increment: 1 } } });
      await invalid(fixture.token); assert.equal((await savedToken(fixture.token)).usedAt, null);
    });
    for (const [label, password, confirmation] of [
      ['moins de dix caractères', '123456789', '123456789'],
      ['plus de 72 octets UTF-8', 'é'.repeat(37), 'é'.repeat(37)],
      ['confirmation différente', nextPassword, 'OtherPassword@2026'],
      ['confirmation absente', nextPassword, undefined],
    ]) await t.test(`POST refuse ${label} sans mutation`, async () => {
      const fixture = await issued(), jar = {}; await http(`/reset-password/${fixture.token}`, jar);
      const before = await savedToken(fixture.token);
      const result = await http(`/reset-password/${fixture.token}`, jar, { password, ...(confirmation === undefined ? {} : { passwordConfirmation: confirmation }) });
      assert.equal(result.response.status, 400);
      assert.deepEqual(await savedToken(fixture.token), before);
      assert.equal((await savedUser(fixture.user.id)).passwordHash, initialHash);
      assert.equal((await savedRequest(fixture.request.id)).status, 'APPROVED');
      assert.ok(!result.html.includes(password));
    });
    await t.test('POST lien invalide et mot de passe invalide : aucune réouverture de formulaire', async () => {
      const jar = {}; await http('/forgot-password', jar);
      const result = await http('/reset-password/invalid', jar, { password: 'short', passwordConfirmation: 'short' });
      assert.equal(result.response.status, 400); assert.match(result.html, /Ce lien est invalide ou expiré/);
      assert.doesNotMatch(result.html, /name="passwordConfirmation"/);
    });
    let completed, staleSessions, start;
    await t.test('POST valide change le mot de passe et complète uniquement sa propre demande', async () => {
      completed = await issued({ mustChangePassword: true });
      staleSessions = [await login(completed.user), await login(completed.user)];
      const other = await issued(), jar = {}; await http(`/reset-password/${completed.token}`, jar);
      start = Date.now();
      const result = await http(`/reset-password/${completed.token}`, jar, { password: nextPassword, passwordConfirmation: nextPassword,
        userId: other.user.id, requestId: other.request.id, token: other.token });
      assert.equal(result.response.status, 200); assert.match(result.html, /mot de passe a été modifié/);
      assert.ok(!result.html.includes(completed.token)); assert.ok(!result.html.includes(nextPassword));
      assert.equal((await savedUser(other.user.id)).passwordHash, initialHash);
      assert.equal((await savedRequest(other.request.id)).status, 'APPROVED');
      assert.ok(await resets.findValid(other.token));
    });
    await t.test('nouveau hash bcrypt coût 12 valide, ancien mot de passe refusé', async () => {
      const user = await savedUser(completed.user.id);
      assert.match(user.passwordHash, /^\$2[aby]\$12\$/);
      assert.ok(await passwords.comparePassword(nextPassword, user.passwordHash));
      assert.equal(await auth.authenticate(user.phoneNumber, initialPassword), null);
      assert.equal((await auth.authenticate(user.phoneNumber, nextPassword)).id, user.id);
    });
    await t.test('COMPLETED et completedAt enregistrés, reviewer conservé', async () => {
      const request = await savedRequest(completed.request.id);
      assert.equal(request.status, 'COMPLETED'); assert.ok(request.completedAt.getTime() >= start && request.completedAt.getTime() <= Date.now());
      assert.equal(request.reviewedById, admin.id); assert.deepEqual(request.reviewedAt, completed.request.reviewedAt);
    });
    await t.test('authVersion incrémentée exactement une fois et mustChangePassword false', async () => {
      const user = await savedUser(completed.user.id); assert.equal(user.authVersion, 1); assert.equal(user.mustChangePassword, false);
    });
    await t.test('toutes les anciennes sessions sont refusées et détruites', async () => {
      for (const jar of staleSessions) {
        const result = await http('/student', jar);
        assert.equal(result.response.status, 302); assert.equal(result.response.headers.get('location'), '/login');
        assert.match(result.response.headers.get('set-cookie'), /connect\.sid=;/);
      }
      const fresh = await login(completed.user, nextPassword); assert.equal((await http('/student', fresh)).response.status, 200);
    });
    await t.test('token utilisé définitivement, deuxième reset et nouvelle décision refusés', async () => {
      assert.ok((await savedToken(completed.token)).usedAt); await invalid(completed.token);
      const jar = {}; await http('/forgot-password', jar);
      const result = await http(`/reset-password/${completed.token}`, jar, { password: nextPassword, passwordConfirmation: nextPassword });
      assert.equal(result.response.status, 400); assert.match(result.html, /Ce lien est invalide ou expiré/);
      assert.doesNotMatch(result.html, /name="passwordConfirmation"/);
      await assert.rejects(resets.preparePasswordResetForTest(completed.request.id), { code: 'INVALID_TOKEN' });
      for (const method of ['approvePasswordResetRequest', 'rejectPasswordResetRequest']) await assert.rejects(requests[method](completed.request.id, admin), { code: 'ALREADY_REVIEWED' });
      assert.equal((await savedUser(completed.user.id)).authVersion, 1);
    });
    await t.test('limites acceptées : dix caractères et 72 octets UTF-8', async () => {
      for (const password of ['1234567890', 'é'.repeat(36)]) {
        const fixture = await issued(); await resets.resetPassword(fixture.token, password);
        assert.ok(await passwords.comparePassword(password, (await savedUser(fixture.user.id)).passwordHash));
      }
    });
    await t.test('autres tokens actifs du même utilisateur invalidés à la finalisation', async () => {
      const fixture = await issued();
      const otherRequest = await prisma.passwordResetRequest.create({ data: { userId: fixture.user.id, status: 'APPROVED', authVersionAtRequest: 0 } });
      await prisma.passwordResetToken.create({ data: { userId: fixture.user.id, requestId: otherRequest.id, tokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 1800000) } });
      await resets.resetPassword(fixture.token, nextPassword);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: fixture.user.id, usedAt: null } }), 0);
      assert.equal((await savedRequest(otherRequest.id)).status, 'APPROVED');
    });
    await t.test('nouvelle émission invalide le token précédent du même utilisateur', async () => {
      const fixture = await issued();
      await requests.createPasswordResetRequest(fixture.user.phoneNumber);
      const newer = await prisma.passwordResetRequest.findFirst({ where: { userId: fixture.user.id, status: 'PENDING' } });
      await requests.approvePasswordResetRequest(newer.id, admin);
      const next = await resets.preparePasswordResetForTest(newer.id);
      assert.ok((await savedToken(fixture.token)).usedAt); await invalid(fixture.token); assert.ok(await resets.findValid(next.token));
      await assert.rejects(resets.preparePasswordResetForTest(fixture.request.id), { code: 'INVALID_TOKEN' });
    });
    await t.test('concurrence HTTP : une seule consommation gagne et un seul audit', async () => {
      const fixture = await issued(), jars = [{}, {}];
      for (const jar of jars) await http(`/reset-password/${fixture.token}`, jar);
      const events = [], original = logger.audit; logger.audit = (action, data) => events.push({ action, data });
      let results;
      try { results = await Promise.all(jars.map((jar, i) => http(`/reset-password/${fixture.token}`, jar,
        { password: `${nextPassword}${i}`, passwordConfirmation: `${nextPassword}${i}` }))); }
      finally { logger.audit = original; }
      assert.deepEqual(results.map(x => x.response.status).sort(), [200, 400]);
      assert.match(results.find(x => x.response.status === 400).html, /Ce lien est invalide ou expiré/);
      assert.equal((await savedUser(fixture.user.id)).authVersion, 1);
      assert.equal((await savedRequest(fixture.request.id)).status, 'COMPLETED');
      assert.deepEqual(events, [{ action: 'PASSWORD_RESET_COMPLETED', data: { requestId: fixture.request.id, userId: fixture.user.id } }]);
    });
    await t.test('expiration revérifiée sous verrou et rollback complet', async () => {
      const fixture = await issued(), original = passwords.lockUser;
      passwords.lockUser = async (tx, id) => { await original(tx, id); await tx.passwordResetToken.updateMany({ where: { userId: id }, data: { expiresAt: new Date(Date.now() - 1000) } }); };
      try { await assert.rejects(resets.resetPassword(fixture.token, nextPassword), { code: 'INVALID_TOKEN' }); }
      finally { passwords.lockUser = original; }
      assert.ok(await resets.findValid(fixture.token)); assert.equal((await savedUser(fixture.user.id)).authVersion, 0);
      assert.equal((await savedRequest(fixture.request.id)).status, 'APPROVED');
    });
    await t.test('statut revérifié sous verrou avant consommation', async () => {
      const fixture = await issued(), original = passwords.lockUser;
      passwords.lockUser = async (tx, id) => { await original(tx, id); await tx.passwordResetRequest.update({ where: { id: fixture.request.id }, data: { status: 'CANCELLED' } }); };
      try { await assert.rejects(resets.resetPassword(fixture.token, nextPassword), { code: 'INVALID_TOKEN' }); }
      finally { passwords.lockUser = original; }
      assert.ok(await resets.findValid(fixture.token)); assert.equal((await savedUser(fixture.user.id)).authVersion, 0);
    });
    await t.test('échec après écriture du mot de passe : aucun changement partiel ni audit de succès', async () => {
      const fixture = await issued(), original = passwords.replacePasswordHash, originalAudit = logger.audit, events = [];
      const before = [await savedUser(fixture.user.id), await savedRequest(fixture.request.id), await savedToken(fixture.token)];
      logger.audit = (action, data) => events.push({ action, data });
      passwords.replacePasswordHash = async (...args) => { await original(...args); throw new Error('INJECTED_TRANSACTION_FAILURE'); };
      try { await assert.rejects(resets.resetPassword(fixture.token, nextPassword), /INJECTED_TRANSACTION_FAILURE/); }
      finally { passwords.replacePasswordHash = original; logger.audit = originalAudit; }
      assert.deepEqual([await savedUser(fixture.user.id), await savedRequest(fixture.request.id), await savedToken(fixture.token)], before);
      assert.deepEqual(events, []); assert.ok(await resets.findValid(fixture.token));
    });
    await t.test('échec de transition COMPLETED annule aussi le changement de mot de passe', async () => {
      const fixture = await issued(), original = passwords.replacePasswordHash;
      passwords.replacePasswordHash = async (...args) => {
        const changed = await original(...args);
        await args[3].passwordResetRequest.update({ where: { id: fixture.request.id }, data: { status: 'CANCELLED' } });
        return changed;
      };
      try { await assert.rejects(resets.resetPassword(fixture.token, nextPassword), { code: 'INVALID_TOKEN' }); }
      finally { passwords.replacePasswordHash = original; }
      assert.equal((await savedUser(fixture.user.id)).passwordHash, initialHash);
      assert.equal((await savedUser(fixture.user.id)).authVersion, 0);
      assert.equal((await savedRequest(fixture.request.id)).status, 'APPROVED'); assert.equal((await savedToken(fixture.token)).usedAt, null);
    });
    await t.test('CSRF absent ou incorrect refuse la consommation', async () => {
      const fixture = await issued(), jar = {}; await http(`/reset-password/${fixture.token}`, jar);
      const body = { password: nextPassword, passwordConfirmation: nextPassword };
      assert.equal((await http(`/reset-password/${fixture.token}`, jar, body, false)).response.status, 403);
      assert.equal((await http(`/reset-password/${fixture.token}`, jar, { ...body, _csrf: 'wrong' })).response.status, 403);
      assert.ok(await resets.findValid(fixture.token));
    });
    await t.test('audit émission/finalisation et logs HTTP sans secrets', async () => {
      const fixture = await approved(), entries = [], original = { log: console.log, warn: console.warn, error: console.error };
      for (const level of Object.keys(original)) console[level] = value => entries.push(String(value));
      let delivery, jar = {};
      try {
        delivery = await resets.preparePasswordResetForTest(fixture.request.id);
        await http(`/reset-password/${delivery.token}`, jar);
        await http(`/reset-password/${delivery.token}`, jar, { password: nextPassword, passwordConfirmation: nextPassword });
        await http(`/reset-password/${delivery.token}`, jar);
      } finally { Object.assign(console, original); }
      const output = entries.join('\n');
      for (const secret of [delivery.token, resets.hashToken(delivery.token), nextPassword, initialHash, jar.cookie]) assert.ok(!output.includes(secret), 'Un secret apparaît dans les logs');
      const audits = entries.map(line => JSON.parse(line)).filter(row => row.level === 'AUDIT');
      assert.deepEqual(audits.map(row => row.action), ['PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_COMPLETED']);
      for (const row of audits) {
        assert.deepEqual(Object.keys(row).sort(), ['action', 'level', 'requestId', 'timestamp', 'userId']);
        assert.equal(row.requestId, fixture.request.id); assert.equal(row.userId, fixture.user.id); assert.ok(Number.isFinite(Date.parse(row.timestamp)));
      }
      assert.match(output, /reset-password\/\[REDACTED\]/);
    });
    await t.test('sanitizeUrl masque aussi les URLs encodées et imbriquées', () => {
      for (const value of [`/reset-password/${first.token}`, encodeURIComponent(`/reset-password/${first.token}`), encodeURIComponent(encodeURIComponent(`/reset-password/${first.token}`))]) {
        assert.ok(!sanitizeUrl(value).includes(first.token)); assert.match(sanitizeUrl(value), /REDACTED/);
      }
    });
    await t.test('forgot-password crée toujours PENDING sans aucun token', async () => {
      const user = await create(), jar = {}; await http('/forgot-password', jar);
      assert.equal((await http('/forgot-password', jar, { identifier: user.phoneNumber })).response.status, 200);
      const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
      assert.equal(request.status, 'PENDING'); assert.equal(request.authVersionAtRequest, user.authVersion);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    });
    await t.test('APPROVE Phase 3 ne génère toujours aucun token', async () => {
      const fixture = await approved(); assert.equal(fixture.request.status, 'APPROVED');
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: fixture.user.id } }), 0);
    });
    await t.test('ADMIN ne reçoit ni token ni hash dans le détail ou sa session', async () => {
      const fixture = await issued(), jar = await login(admin);
      const result = await http(`/admin/password-reset-requests/${fixture.request.id}`, jar);
      assert.equal(result.response.status, 200);
      const sid = signature.unsign(decodeURIComponent(jar.cookie.split('=').slice(1).join('=')).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
      const data = result.html + JSON.stringify(await callStore('get', sid));
      for (const value of [fixture.token, resets.hashToken(fixture.token), initialHash]) assert.ok(!data.includes(value));
    });
    await t.test('aucune route publique ou ADMIN ne livre le token brut', async () => {
      const fixture = await issued(), jar = await login(admin);
      for (const route of ['/api/reset-token', '/admin/show-reset-token', `/admin/password-reset-requests/${fixture.request.id}/token`, `/admin/password-reset-requests/${fixture.request.id}/prepare`]) {
        const result = await http(route, jar); assert.equal(result.response.status, 404); assert.ok(!result.html.includes(fixture.token));
      }
      for (const file of fs.readdirSync('src/routes')) assert.ok(!fs.readFileSync(`src/routes/${file}`, 'utf8').includes('preparePasswordResetForTest'));
    });
    await t.test('après succès une nouvelle demande mémorise la nouvelle version', async () => {
      await requests.createPasswordResetRequest(completed.user.phoneNumber);
      const request = await prisma.passwordResetRequest.findFirst({ where: { userId: completed.user.id, status: 'PENDING' } });
      assert.equal(request.authVersionAtRequest, 1);
      await requests.approvePasswordResetRequest(request.id, admin);
      assert.ok(await resets.findValid((await resets.preparePasswordResetForTest(request.id)).token));
    });
  } finally {
    if (previousCsrf === undefined) delete process.env.CSRF_ENFORCE; else process.env.CSRF_ENFORCE = previousCsrf;
    await new Promise(resolve => server.close(resolve));
    for (const sid of sids) await callStore('destroy', sid);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
});
