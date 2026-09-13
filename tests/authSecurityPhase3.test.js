const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
assert.equal(process.env.NODE_ENV, 'test');
const target = new URL(process.env.TEST_DATABASE_URL), active = new URL(process.env.DATABASE_URL);
for (const key of ['hostname', 'port', 'username', 'password', 'pathname']) assert.equal(active[key], target[key]);
assert.equal(decodeURIComponent(active.pathname), '/english_center_test');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const service = require('../src/services/passwordResetRequestService');
const passwords = require('../src/services/passwordService');
const logger = require('../src/services/loggerService');
const messages = require('../src/utils/passwordResetRequestMessages');
const store = require('../src/config/sessionStore').getSessionStore();

test('Phase 3 - revue ADMIN des demandes de recuperation', async (t) => {
  const previousCsrf = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true'; app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const prefix = '/admin/password-reset-requests';
  const ids = [], sids = new Set(); let serial = 0, ip = 0;
  const suffix = String(Date.now()).slice(-6), password = 'Phase3Pass@2026';
  const hash = await passwords.hashPassword(password);
  const callStore = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => err ? reject(err) : resolve(value)));
  async function create(role = 'STUDENT', extra = {}) {
    const user = await prisma.user.create({ data: { firstName: 'Phase3', lastName: `${role}-${++serial}`, phoneNumber: `+2439${String(serial).padStart(2, '0')}${suffix}`,
      email: `phase3-${suffix}-${serial}@example.test`, whatsappNumber: '+243899999999', passwordHash: hash, role, ...extra } });
    ids.push(user.id); return user;
  }
  async function pending(extra = {}) {
    const user = await create('STUDENT', extra);
    await service.createPasswordResetRequest(user.phoneNumber);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
    return { user, request };
  }
  async function http(path, jar = {}, body, csrf = true) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: `${jar.cookie || ''}; nva-language=fr`, 'X-Forwarded-For': `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}` },
      body: body === undefined ? undefined : new URLSearchParams({ ...(csrf ? { _csrf: jar.csrf || '' } : {}), ...body }), redirect: 'manual' });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie && !cookie.endsWith('=')) {
      jar.cookie = cookie;
      const key = signature.unsign(decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
      if (key) sids.add(key);
    }
    const html = await response.text();
    jar.csrf = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/)?.[1] || jar.csrf;
    return { response, html };
  }
  async function login(user) {
    const jar = {}; await http('/login', jar);
    const result = await http('/login', jar, { phoneNumber: user.phoneNumber, password });
    assert.equal(result.response.status, 302);
    await http('/login', jar); return jar;
  }
  const saved = id => prisma.passwordResetRequest.findUnique({ where: { id } });
  try {
    const admin = await create('ADMIN'), secondAdmin = await create('ADMIN');
    const jar = await login(admin), initial = await pending();
    await t.test('ADMIN consulte liste PENDING et navigation active', async () => {
      const { response, html } = await http(prefix, jar);
      assert.equal(response.status, 200); assert.match(html, /Demandes de récupération de mot de passe/);
      assert.ok(html.includes(initial.user.phoneNumber)); assert.match(html, /value="PENDING" selected/);
      assert.match(html, /href="\/admin\/password-reset-requests" aria-current="page"/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
    await t.test('detail : identite, contacts, statut et formulaires POST', async () => {
      const { response, html } = await http(`${prefix}/${initial.request.id}`, jar);
      assert.equal(response.status, 200);
      for (const value of [require('../src/utils/maskResetEmail')(initial.user.email), initial.user.phoneNumber, initial.user.whatsappNumber]) assert.ok(html.includes(value));
      assert.match(html, /data-admin-confirm=/); assert.match(html, /\/approve\?lang=fr/); assert.match(html, /\/reject\?lang=fr/);
      assert.doesNotMatch(html, /passwordHash|tokenHash|Phase3Pass@2026/); assert.ok(!html.includes(hash));
    });
    for (const role of ['STUDENT', 'TEACHER']) await t.test(`${role} refuse sur liste, detail et decisions`, async () => {
      const other = await login(await create(role));
      for (const path of [prefix, `${prefix}/${initial.request.id}`]) assert.equal((await http(path, other)).response.status, 403);
      for (const action of ['approve', 'reject']) assert.equal((await http(`${prefix}/${initial.request.id}/${action}`, other, {})).response.status, 403);
      assert.equal((await saved(initial.request.id)).status, 'PENDING');
    });
    await t.test('non connecte redirige sans lecture ou decision', async () => {
      const anon = {}; await http('/login', anon);
      for (const path of [prefix, `${prefix}/${initial.request.id}`]) assert.equal((await http(path, anon)).response.headers.get('location'), '/login');
      assert.equal((await http(`${prefix}/${initial.request.id}/approve`, anon, {})).response.headers.get('location'), '/login');
    });
    for (const [name, data] of [['ADMIN inactif', { isActive: false }], ['ADMIN retrograde', { role: 'TEACHER' }], ['authVersion revoquee', { authVersion: { increment: 1 } }]]) {
      await t.test(`${name} : ancienne session refusee`, async () => {
        const user = await create('ADMIN'), stale = await login(user), stalePost = await login(user);
        await prisma.user.update({ where: { id: user.id }, data });
        assert.equal((await http(prefix, stale)).response.headers.get('location'), '/login');
        assert.equal((await http(`${prefix}/${initial.request.id}/reject`, stalePost, {})).response.headers.get('location'), '/login');
      });
    }
    await t.test('APPROVE HTTP enregistre statut, reviewer et date', async () => {
      const start = Date.now();
      const result = await http(`${prefix}/${initial.request.id}/approve`, jar, { reviewedById: secondAdmin.id, status: 'COMPLETED' });
      assert.equal(result.response.status, 302); assert.match(result.response.headers.get('location'), /success=approved/);
      const row = await saved(initial.request.id);
      assert.equal(row.status, 'APPROVED'); assert.equal(row.reviewedById, admin.id);
      assert.ok(row.reviewedAt.getTime() >= start && row.reviewedAt.getTime() <= Date.now());
      const detail = await http(result.response.headers.get('location'), jar);
      assert.match(detail.html, /Demande approuvée/); assert.ok(detail.html.includes(admin.lastName));
    });
    await t.test('APPROVE ne cree aucun token et preserve mot de passe et authVersion', async () => {
      const user = await prisma.user.findUnique({ where: { id: initial.user.id } });
      assert.equal(user.passwordHash, hash); assert.equal(user.authVersion, 0); assert.equal(user.mustChangePassword, false);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    });
    await t.test('REJECT HTTP enregistre reviewer et date sans token', async () => {
      const { user, request } = await pending();
      assert.equal((await http(`${prefix}/${request.id}/reject`, jar, {})).response.status, 302);
      const row = await saved(request.id); assert.equal(row.status, 'REJECTED'); assert.equal(row.reviewedById, admin.id); assert.ok(row.reviewedAt);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    });
    for (const status of ['APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED']) {
      await t.test(`${status} : aucune nouvelle transition ni formulaire`, async () => {
        const { request } = await pending();
        await prisma.passwordResetRequest.update({ where: { id: request.id }, data: { status, ...(status === 'APPROVED' ? { reviewedAt: new Date() } : {}) } });
        const before = await saved(request.id);
        for (const action of ['approve', 'reject']) assert.equal((await http(`${prefix}/${request.id}/${action}`, jar, {})).response.status, 409);
        assert.deepEqual(await saved(request.id), before);
        const { html } = await http(`${prefix}/${request.id}`, jar);
        assert.doesNotMatch(html, /action="[^"\s]*\/(?:approve|reject)(?:\?|\")/); // Phase 5 may offer delivery for APPROVED.
      });
    }
    await t.test('concurrence approve/reject : une seule decision et un seul audit', async () => {
      const { request } = await pending(), events = [], original = logger.audit;
      logger.audit = (action, data) => { events.push({ action, data }); return original(action, data); };
      let results;
      try { results = await Promise.allSettled([service.approvePasswordResetRequest(request.id, admin), service.rejectPasswordResetRequest(request.id, secondAdmin)]); }
      finally { logger.audit = original; }
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ALREADY_REVIEWED');
      const row = await saved(request.id);
      assert.equal(row.reviewedById, row.status === 'APPROVED' ? admin.id : secondAdmin.id);
      assert.equal(events.length, 1); assert.equal(events[0].data.requestId, request.id);
    });
    await t.test('double APPROVE : seconde tentative refusee', async () => {
      const { request } = await pending();
      await service.approvePasswordResetRequest(request.id, admin);
      await assert.rejects(service.approvePasswordResetRequest(request.id, secondAdmin), { code: 'ALREADY_REVIEWED' });
      assert.equal((await saved(request.id)).reviewedById, admin.id);
    });
    await t.test('compte supprime : demande cascadee, 404 propre', async () => {
      const { user, request } = await pending(); await prisma.user.delete({ where: { id: user.id } });
      assert.equal((await http(`${prefix}/${request.id}`, jar)).response.status, 404);
      assert.equal((await http(`${prefix}/${request.id}/approve`, jar, {})).response.status, 404);
    });
    for (const data of [{ isActive: false }, { role: 'ADMIN' }]) await t.test(`compte devenu inadmissible ${JSON.stringify(data)} : approbation refusee, rejet permis`, async () => {
      const { user, request } = await pending(); await prisma.user.update({ where: { id: user.id }, data });
      const result = await http(`${prefix}/${request.id}/approve`, jar, {});
      assert.equal(result.response.status, 409); assert.match(result.html, /Approbation refusée/);
      assert.equal((await saved(request.id)).status, 'PENDING');
      await service.rejectPasswordResetRequest(request.id, admin); assert.equal((await saved(request.id)).status, 'REJECTED');
    });
    await t.test('service refuse un acteur invalide ou non ADMIN', async () => {
      const { user, request } = await pending();
      for (const actor of [null, { id: admin.id }, user, { ...admin, authVersion: admin.authVersion + 1 }]) await assert.rejects(service.approvePasswordResetRequest(request.id, actor), { code: 'FORBIDDEN' });
      assert.equal((await saved(request.id)).status, 'PENDING');
    });
    await t.test('droits ADMIN reverifies apres acquisition du verrou', async () => {
      const actor = await create('ADMIN'), { request } = await pending(), original = passwords.lockUser;
      passwords.lockUser = async (tx, id) => { await original(tx, id); if (id === actor.id) await tx.user.update({ where: { id }, data: { isActive: false } }); };
      try { await assert.rejects(service.approvePasswordResetRequest(request.id, actor), { code: 'FORBIDDEN' }); }
      finally { passwords.lockUser = original; }
      assert.equal((await saved(request.id)).status, 'PENDING');
    });
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED']) await t.test(`filtre ${status}`, async () => {
      const result = await service.listPasswordResetRequests({ status });
      assert.ok(result.requests.every(request => request.status === status));
      assert.equal((await http(`${prefix}?status=${status}`, jar)).response.status, 200);
    });
    await t.test('pagination bornee et projections sans secrets', async () => {
      const result = await service.listPasswordResetRequests({ page: 999999999 });
      assert.equal(result.page, result.totalPages); assert.ok(result.requests.length <= 10);
      const data = JSON.stringify(await service.getPasswordResetRequestById(initial.request.id));
      assert.doesNotMatch(data, /passwordHash|authVersion|tokenHash|passwordResetTokens/);
      assert.ok(!data.includes(hash));
    });
    await t.test('ID inexistant et parametres invalides', async () => {
      assert.equal((await http(`${prefix}/2147483647`, jar)).response.status, 404);
      for (const id of ['abc', '0', '-1', '1.2', '2147483648']) {
        assert.equal((await http(`${prefix}/${id}`, jar)).response.status, 400);
        assert.equal((await http(`${prefix}/${id}/approve`, jar, {})).response.status, 400);
      }
      assert.equal((await http(`${prefix}?status=INVALID`, jar)).response.status, 400);
    });
    for (const action of ['approve', 'reject']) await t.test(`${action} exige POST et CSRF valide`, async () => {
      const { request } = await pending();
      assert.equal((await http(`${prefix}/${request.id}/${action}`, jar)).response.status, 404);
      assert.equal((await http(`${prefix}/${request.id}/${action}`, jar, {}, false)).response.status, 403);
      assert.equal((await http(`${prefix}/${request.id}/${action}`, jar, { _csrf: 'invalid' })).response.status, 403);
      assert.equal((await saved(request.id)).status, 'PENDING');
    });
    for (const action of ['approve', 'reject']) await t.test(`audit ${action} : format standard et aucun secret`, async () => {
      const { user, request } = await pending(), entries = [], original = console.log;
      console.log = value => entries.push(String(value));
      try { await service[`${action}PasswordResetRequest`](request.id, admin); } finally { console.log = original; }
      const audit = entries.map(value => JSON.parse(value)).find(entry => entry.level === 'AUDIT');
      assert.equal(audit.action, `PASSWORD_RESET_REQUEST_${action === 'approve' ? 'APPROVED' : 'REJECTED'}`);
      assert.equal(audit.requestId, request.id); assert.equal(audit.userId, user.id); assert.equal(audit.adminId, admin.id);
      assert.ok(Number.isFinite(Date.parse(audit.timestamp)));
      for (const secret of [password, hash, user.phoneNumber, user.email, jar.cookie]) assert.ok(!entries.join('').includes(secret));
    });
    await t.test('Phase 2 reste PENDING sans token apres une ancienne approbation', async () => {
      const result = await http('/forgot-password', {}, { identifier: initial.user.phoneNumber }, false);
      assert.equal(result.response.status, 403); // Public recovery still enforces CSRF.
      const anon = {}; await http('/forgot-password', anon);
      assert.equal((await http('/forgot-password', anon, { identifier: initial.user.phoneNumber })).response.status, 200);
      assert.equal(await prisma.passwordResetRequest.count({ where: { userId: initial.user.id, status: 'PENDING' } }), 1);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: initial.user.id } }), 0);
    });
    await t.test('FR/EN : liste, detail, erreurs et cles completes', async () => {
      assert.deepEqual(Object.keys(messages.fr).sort(), Object.keys(messages.en).sort());
      assert.match((await http(`${prefix}?lang=en`, jar)).html, /Password recovery requests/);
      assert.match((await http(`${prefix}/${initial.request.id}?lang=en`, jar)).html, /Password recovery request/);
      assert.match((await http(`${prefix}/invalid?lang=en`, jar)).html, /Invalid request ID/);
    });
    await t.test('noms echappes et aucune injection HTML', async () => {
      const { request } = await pending({ firstName: '<script>alert(1)</script>' });
      const { html } = await http(`${prefix}/${request.id}`, jar);
      assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>alert(1)</script>'));
    });
    await t.test('dashboard et connexion ADMIN toujours fonctionnels', async () => {
      assert.equal((await http('/admin/dashboard', jar)).response.status, 200);
      assert.equal((await require('../src/services/authService').authenticate(admin.phoneNumber, password)).id, admin.id);
    });
  } finally {
    if (previousCsrf === undefined) delete process.env.CSRF_ENFORCE; else process.env.CSRF_ENFORCE = previousCsrf;
    await new Promise(resolve => server.close(resolve));
    for (const sid of sids) await callStore('destroy', sid);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
});
