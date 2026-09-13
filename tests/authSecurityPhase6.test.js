const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
assert.equal(process.env.NODE_ENV, 'test');
const active = new URL(process.env.DATABASE_URL), target = new URL(process.env.TEST_DATABASE_URL);
for (const key of ['hostname', 'port', 'username', 'password', 'pathname']) assert.equal(active[key], target[key]);
assert.equal(active.pathname, '/english_center_test');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const passwords = require('../src/services/passwordService');
const requests = require('../src/services/passwordResetRequestService');
const resets = require('../src/services/passwordResetService');
const delivery = require('../src/services/passwordResetDeliveryService');
const config = require('../src/utils/resetDeliveryConfig');
const FakeEmailTransport = require('./helpers/fakeEmailTransport');
const store = require('../src/config/sessionStore').getSessionStore();

test('Phase 6 — durcissement intégral de la récupération sans SMTP réel', async t => {
  const previous = { csrf: process.env.CSRF_ENFORCE, base: process.env.APP_BASE_URL };
  process.env.CSRF_ENFORCE = 'true'; app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; process.env.APP_BASE_URL = `${base}/`;
  const fake = new FakeEmailTransport(); delivery.setEmailProviderForTest(fake);
  const ids = [], sids = new Set(), suffix = String(Date.now()).slice(-6);
  const password = 'Phase6Initial@2026', nextPassword = 'Phase6Changed@2026', hash = await passwords.hashPassword(password);
  let serial = 0, ip = 0, admin, jar;
  const callStore = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
  async function create(extra = {}) {
    const user = await prisma.user.create({ data: { firstName: 'Phase6', lastName: 'Fixture', phoneNumber: `+2438${String(++serial).padStart(2, '0')}${suffix}`,
      email: `phase6-${suffix}-${serial}@example.test`, passwordHash: hash, ...extra } }); ids.push(user.id); return user;
  }
  async function http(path, session = {}, body, options = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Cookie: `${session.cookie || ''}; nva-language=fr`, 'X-Forwarded-For': options.ip || `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}`, ...options.headers },
      body: body === undefined ? undefined : new URLSearchParams({ ...(options.csrf === false ? {} : { _csrf: session.csrf || '' }), ...body }) });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie && !cookie.endsWith('=')) {
      session.cookie = cookie;
      const sid = signature.unsign(decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
      if (sid) sids.add(sid);
    }
    const html = await response.text(); session.csrf = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/)?.[1] || session.csrf;
    return { response, html };
  }
  async function login(user, secret = password) {
    const session = {}; await http('/login', session);
    assert.equal((await http('/login', session, { phoneNumber: user.phoneNumber, password: secret })).response.status, 302);
    await http('/login', session); return session;
  }
  async function approved(extra = {}) {
    const user = await create(extra); await requests.createPasswordResetRequest(user.phoneNumber);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
    await requests.approvePasswordResetRequest(request.id, admin); return { user, request };
  }
  const row = id => prisma.passwordResetRequest.findUnique({ where: { id } });
  const tokenRow = id => prisma.passwordResetToken.findUnique({ where: { requestId: id } });
  const path = id => `/admin/password-reset-requests/${id}/send`;
  const received = () => fake.messages.at(-1);
  const linkOf = message => message.text.match(/https?:\/\/[^\s]+/)[0];
  const tokenOf = message => new URL(linkOf(message)).pathname.split('/').at(-1);
  async function noToken(fixture) {
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: fixture.user.id } }), 0);
    assert.equal((await row(fixture.request.id)).deliveryAttempts, 0);
  }
  try {
    admin = await create({ role: 'ADMIN' }); jar = await login(admin);
    const policy = require('../src/services/passwordResetRequestPolicy');
    const logger = require('../src/services/loggerService');
    const mask = require('../src/utils/maskResetEmail');
    const prefix = '/admin/password-reset-requests';
    const pending = async (extra = {}) => {
      const user = await create(extra); await requests.createPasswordResetRequest(user.email || user.phoneNumber);
      return { user, request: await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } }) };
    };
    for (const [status, field, ttl] of [['PENDING', 'requestedAt', policy.PENDING_TTL_MS], ['APPROVED', 'reviewedAt', policy.APPROVED_TTL_MS]]) {
      for (const delta of [-1, 0, 1]) await t.test(`${status} expiry boundary ${delta}ms`, () => {
        const now = Date.now(); assert.equal(policy.isExpired({ status, [field]: new Date(now - ttl + delta) }, now), delta <= 0);
      });
      for (const action of ['detail', 'list', 'approve', 'send']) await t.test(`${status} stale request expires on ${action}`, async () => {
        const f = status === 'PENDING' ? await pending() : await approved();
        await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { [field]: new Date(Date.now() - ttl - 1000) } });
        if (action === 'detail') assert.equal((await requests.getPasswordResetRequestById(f.request.id)).status, 'EXPIRED');
        if (action === 'list') await requests.listPasswordResetRequests({ status: 'EXPIRED' });
        if (action === 'approve') await assert.rejects(requests.approvePasswordResetRequest(f.request.id, admin), { code: 'ALREADY_REVIEWED' });
        if (action === 'send') await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_INELIGIBLE' });
        assert.equal((await row(f.request.id)).status, 'EXPIRED'); await noToken(f);
      });
    }
    await t.test('old pending does not prevent a fresh request', async () => {
      const f = await pending(); await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { requestedAt: new Date(0) } });
      await Promise.all([requests.createPasswordResetRequest(f.user.email), requests.createPasswordResetRequest(f.user.email)]);
      assert.equal((await row(f.request.id)).status, 'EXPIRED');
      assert.equal(await prisma.passwordResetRequest.count({ where: { userId: f.user.id, status: 'PENDING' } }), 1);
    });
    for (const status of ['APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED']) await t.test(`${status} cannot be reviewed again`, async () => {
      const f = await approved(); await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { status } });
      for (const method of ['approvePasswordResetRequest', 'rejectPasswordResetRequest']) await assert.rejects(requests[method](f.request.id, admin), { code: 'ALREADY_REVIEWED' });
      if (status !== 'APPROVED') await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_INELIGIBLE' });
    });
    for (const actions of [['approvePasswordResetRequest', 'approvePasswordResetRequest'], ['approvePasswordResetRequest', 'rejectPasswordResetRequest']]) await t.test(`concurrent decisions ${actions.join('/')}`, async () => {
      const f = await pending(), results = await Promise.allSettled(actions.map(method => requests[method](f.request.id, admin)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    });
    for (const kind of ['existing', 'missing', 'inactive', 'invalid']) await t.test(`generic forgot and IP limit: ${kind}`, async () => {
      const user = await create({ isActive: kind !== 'inactive' }), session = {}; await http('/forgot-password', session);
      const identifier = kind === 'missing' ? `missing-${suffix}@example.test` : kind === 'invalid' ? '??' : user.email;
      const fixedIp = `198.51.100.${++ip % 250 + 1}`;
      for (let n = 0; n < 10; n++) {
        const result = await http('/forgot-password', session, { identifier }, { ip: fixedIp });
        assert.equal(result.response.status, 200); assert.match(result.html, /Si un compte admissible correspond à ces informations/);
        assert.ok(!result.html.includes(user.email));
      }
      assert.equal((await http('/forgot-password', session, { identifier }, { ip: fixedIp })).response.status, 429);
      assert.equal(await prisma.passwordResetRequest.count({ where: { userId: user.id } }), kind === 'existing' ? 1 : 0);
    });
    for (const role of ['STUDENT', 'TEACHER']) for (const action of ['list', 'detail', 'approve', 'reject', 'send']) await t.test(`${role} IDOR ${action} refused`, async () => {
      const f = await pending(), actor = await create({ role }), session = await login(actor);
      const url = action === 'list' ? prefix : `${prefix}/${f.request.id}${['approve', 'reject', 'send'].includes(action) ? '/' + action : ''}`;
      assert.equal((await http(url, session, ['list', 'detail'].includes(action) ? undefined : {})).response.status, 403);
      assert.equal((await row(f.request.id)).status, 'PENDING');
    });
    for (const change of [{ isActive: false }, { role: 'STUDENT' }, { authVersion: { increment: 1 } }]) await t.test(`stale ADMIN session ${Object.keys(change)[0]}`, async () => {
      const actor = await create({ role: 'ADMIN' }), session = await login(actor);
      await prisma.user.update({ where: { id: actor.id }, data: change });
      assert.equal((await http(prefix, session)).response.headers.get('location'), '/login');
    });
    for (const [label, value, accepted] of [['nine', 'a'.repeat(9), false], ['ten', 'a'.repeat(10), true], ['72 bytes', 'a'.repeat(72), true], ['73 bytes', 'a'.repeat(73), false], ['unicode72', 'é'.repeat(36), true], ['unicode74', 'é'.repeat(37), false], ['five emoji', '😀'.repeat(5), false], ['ten emoji', '😀'.repeat(10), true]]) await t.test(`password policy ${label}`, () => {
      if (accepted) assert.equal(passwords.validatePassword(value, value), value);
      else assert.throws(() => passwords.validatePassword(value, value), passwords.PasswordError);
    });
    await t.test('confirmation mismatch refused', () => assert.throws(() => passwords.validatePassword(password, nextPassword), passwords.PasswordError));
    for (const key of ['password', 'passwordHash', 'token', 'SMTP_PASSWORD', 'sessionSecret', 'cookie', 'Authorization']) await t.test(`logger removes ${key}`, () => {
      assert.ok(!JSON.stringify(logger.sanitize({ nested: { [key]: 'sensitive-fixture' } })).includes('sensitive-fixture'));
      assert.ok(!logger.sanitizeString(`${key}="sensitive-fixture"`).includes('sensitive-fixture'));
    });
    for (const encode of [s => s, encodeURIComponent, s => encodeURIComponent(encodeURIComponent(s))]) await t.test('sanitizer removes encoded reset URL', () => {
      assert.ok(!logger.sanitizeString(encode('/reset-password/' + 'a'.repeat(43))).includes('a'.repeat(43)));
    });
    for (const route of ['/forgot-password', '/reset-password/invalid']) await t.test(`private HTTP headers ${route}`, async () => {
      const { response } = await http(route); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.ok(response.headers.get('content-security-policy'));
    });
    for (const email of ['agamba@gmail.com', 'a@example.test', 'ab@example.test', null, 'invalid']) await t.test(`masked recipient ${email}`, () => {
      const result = mask(email); if (config.resetEmail(email)) { assert.ok(result.includes('***@')); assert.notEqual(result, email); } else assert.equal(result, '—');
    });
    for (const value of ['', 'not-url', 'http://example.test', 'https://u:p@example.test', 'https://example.test/path']) await t.test(`unsafe production origin rejected ${value}`, () => {
      assert.throws(() => config.appBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: value }), { code: 'EMAIL_NOT_CONFIGURED' });
    });
    await t.test('missing SMTP configuration controlled', () => assert.throws(() => config.smtpConfig({}), { code: 'EMAIL_NOT_CONFIGURED' }));
    await t.test('simultaneous send and retry guard; only one active token', async () => {
      const f = await approved(), results = await Promise.allSettled([delivery.deliverApprovedResetRequest(f.request.id, admin), delivery.deliverApprovedResetRequest(f.request.id, admin)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_RATE_LIMITED' });
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: f.user.id, usedAt: null, deliveryPending: false } }), 1);
    });
    await t.test('simultaneous reset allows one completion', async () => {
      const f = await approved(); await delivery.deliverApprovedResetRequest(f.request.id, admin); const token = tokenOf(received());
      const results = await Promise.allSettled([resets.resetPassword(token, nextPassword), resets.resetPassword(token, nextPassword)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await row(f.request.id)).status, 'COMPLETED');
    });
    for (const kind of ['expired', 'used', 'unknown', 'request-expired']) await t.test(`generic token GET and POST ${kind}`, async () => {
      const f = await approved(); await delivery.deliverApprovedResetRequest(f.request.id, admin); let token = tokenOf(received());
      const saved = await tokenRow(f.request.id); assert.equal(saved.expiresAt - saved.createdAt, 30 * 60 * 1000);
      if (kind === 'expired') await prisma.passwordResetToken.update({ where: { id: saved.id }, data: { expiresAt: new Date(0) } });
      if (kind === 'used') await resets.resetPassword(token, nextPassword);
      if (kind === 'unknown') token = 'z'.repeat(43);
      if (kind === 'request-expired') await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { reviewedAt: new Date(0) } });
      const session = {}; await http('/forgot-password', session);
      for (const body of [undefined, { password: nextPassword, passwordConfirmation: nextPassword }]) {
        const result = await http(`/reset-password/${token}`, session, body); assert.equal(result.response.status, 400);
        assert.match(result.html, /Ce lien est invalide ou expiré/); assert.ok(!result.html.includes(token)); assert.doesNotMatch(result.html, /name="passwordConfirmation"/);
      }
      if (kind === 'request-expired') assert.equal((await row(f.request.id)).status, 'EXPIRED');
    });
    for (const kind of ['rejected', 'no-email', 'invalid-email', 'SMTP-failure']) await t.test(`HTTP end-to-end ${kind}`, async () => {
      const user = await create(kind === 'no-email' ? { email: null } : kind === 'invalid-email' ? { email: 'invalid' } : {});
      const session = {}; await http('/forgot-password', session);
      assert.equal((await http('/forgot-password', session, { identifier: user.phoneNumber })).response.status, 200);
      const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
      assert.equal((await http(`${prefix}/${request.id}/${kind === 'rejected' ? 'reject' : 'approve'}`, jar, {})).response.status, 302);
      fake.handler = kind === 'SMTP-failure' ? async () => { throw new Error('SMTP_PASSWORD=sensitive-fixture'); } : null;
      try { const sent = await http(path(request.id), jar, {}); assert.equal(sent.response.status, kind === 'SMTP-failure' ? 503 : 409); assert.ok(!sent.html.includes('sensitive-fixture')); }
      finally { fake.handler = null; }
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } }), 0);
    });
    await t.test('complete HTTP recovery with audit, HTML secrecy, login and session revocation', async () => {
      const user = await create(), oldSession = await login(user), session = {}, events = [], original = logger.audit;
      logger.audit = (action, data) => { events.push({ action, data }); return original(action, data); };
      try {
        await http('/forgot-password', session);
        assert.equal((await http('/forgot-password', session, { identifier: user.email })).response.status, 200);
        const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } }); assert.equal(request.status, 'PENDING');
        assert.equal((await http(`${prefix}/${request.id}/approve`, jar, {})).response.status, 302);
        assert.equal((await http(path(request.id), jar, {})).response.status, 302);
        const message = received(), token = tokenOf(message); assert.equal(new URL(linkOf(message)).origin, base);
        for (const part of [message.html, message.text]) { assert.match(part, /New Vision Academy/); assert.match(part, /30 minutes/); assert.ok(!part.includes(password)); }
        const page = await http(`/reset-password/${token}`, session); assert.equal(page.response.status, 200); assert.ok(!page.html.includes(token));
        assert.match(page.html, /Confirmer le nouveau mot de passe/); assert.match(page.html, /Au moins 10 caractères/); assert.match(page.html, /autocomplete="new-password"/);
        const detail = await http(`${prefix}/${request.id}`, jar); assert.ok(!detail.html.includes(token)); assert.ok(!detail.html.includes(user.email)); assert.ok(detail.html.includes(mask(user.email)));
        assert.equal((await http(`/reset-password/${token}`, session, { password: nextPassword, passwordConfirmation: nextPassword })).response.status, 200);
        const completed = await row(request.id), changed = await prisma.user.findUnique({ where: { id: user.id } });
        assert.equal(completed.status, 'COMPLETED'); assert.ok(completed.completedAt); assert.equal(changed.authVersion, user.authVersion + 1);
        assert.equal(await passwords.comparePassword(nextPassword, changed.passwordHash), true);
        assert.equal((await http('/student', oldSession)).response.headers.get('location'), '/login');
        const fresh = {}; await http('/login', fresh);
        assert.equal((await http('/login', fresh, { phoneNumber: user.phoneNumber, password })).response.status, 401);
        await login(user, nextPassword);
        assert.equal((await http(`/reset-password/${token}`, session, { password: nextPassword, passwordConfirmation: nextPassword })).response.status, 400);
        for (const action of ['PASSWORD_RESET_REQUEST_CREATED', 'PASSWORD_RESET_REQUEST_APPROVED', 'PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_DELIVERY_SENT', 'PASSWORD_RESET_COMPLETED']) assert.ok(events.some(e => e.action === action));
        for (const secret of [token, password, nextPassword, changed.passwordHash]) assert.ok(!JSON.stringify(events).includes(secret));
      } finally { logger.audit = original; }
    });
    await t.test('request expiry during SMTP prevents token activation', async () => {
      const f = await approved();
      fake.handler = async () => {
        await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { reviewedAt: new Date(0) } });
        return { accepted: true };
      };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_FAILED' }); }
      finally { fake.handler = null; }
      assert.equal((await tokenRow(f.request.id)).deliveryPending, true);
      assert.ok((await tokenRow(f.request.id)).usedAt);
      assert.equal(await resets.findValid(tokenOf(received())), null);
      assert.equal((await row(f.request.id)).status, 'EXPIRED');
    });
    await t.test('link expires after opening: reload and submission both refuse', async () => {
      const f = await approved(); await delivery.deliverApprovedResetRequest(f.request.id, admin);
      const token = tokenOf(received()), session = {};
      assert.equal((await http(`/reset-password/${token}`, session)).response.status, 200);
      await prisma.passwordResetToken.update({ where: { requestId: f.request.id }, data: { expiresAt: new Date(0) } });
      for (const body of [undefined, { password: nextPassword, passwordConfirmation: nextPassword }]) {
        const result = await http(`/reset-password/${token}`, session, body);
        assert.equal(result.response.status, 400); assert.match(result.html, /Ce lien est invalide ou expiré/);
        assert.ok(!result.html.includes(token));
      }
      assert.equal((await row(f.request.id)).status, 'APPROVED');
    });
    await t.test('audit rejection and SMTP failure: identities, secrecy and successful retry', async () => {
      const events = [], lines = [], originalAudit = logger.audit, originalLog = console.log, originalError = console.error;
      const f = await approved(), rejected = await pending();
      logger.audit = (action, data) => { events.push({ action, data }); return originalAudit(action, data); };
      console.log = console.error = (...args) => lines.push(args.join(' '));
      fake.handler = async () => { throw new Error('SMTP_PASSWORD=smtp-sensitive-fixture password=private-password-fixture'); };
      let token;
      try {
        await requests.rejectPasswordResetRequest(rejected.request.id, admin);
        await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_FAILED' });
        token = tokenOf(received());
        const fail = events.find(e => e.action === 'PASSWORD_RESET_DELIVERY_FAILED');
        const reject = events.find(e => e.action === 'PASSWORD_RESET_REQUEST_REJECTED');
        assert.equal(fail.data.adminId, admin.id); assert.equal(fail.data.userId, f.user.id); assert.equal(fail.data.requestId, f.request.id);
        assert.equal(reject.data.adminId, admin.id); assert.equal(reject.data.requestId, rejected.request.id);
        await assert.rejects(delivery.deliverApprovedResetRequest(f.request.id, admin), { code: 'DELIVERY_RATE_LIMITED' });
        await prisma.passwordResetRequest.update({ where: { id: f.request.id }, data: { deliveryAttemptedAt: new Date(Date.now() - delivery.RETRY_DELAY_MS - 1) } });
        fake.handler = null;
        assert.equal((await delivery.deliverApprovedResetRequest(f.request.id, admin)).status, 'SENT');
        assert.equal(await resets.findValid(token), null);
        for (const secret of [token, tokenOf(received()), 'smtp-sensitive-fixture', 'private-password-fixture']) assert.ok(!lines.join('\n').includes(secret));
        assert.ok(lines.every(line => JSON.parse(line).timestamp));
      } finally { fake.handler = null; logger.audit = originalAudit; console.log = originalLog; console.error = originalError; }
    });
    const smtp = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', EMAIL_FROM: 'nva@example.test' };
    for (const override of [{ SMTP_PORT: 'abc' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' }, { SMTP_PORT: '1.5' }, { SMTP_SECURE: 'yes' }, { SMTP_HOST: '' }, { SMTP_USER: '' }, { SMTP_PASSWORD: '' }]) {
      await t.test(`SMTP rejects invalid ${JSON.stringify(override)}`, () => assert.throws(() => config.smtpConfig({ ...smtp, ...override }), { code: 'EMAIL_NOT_CONFIGURED' }));
    }
    await t.test('SMTP direct TLS and STARTTLS configuration remain usable', () => {
      assert.equal(config.smtpConfig(smtp).options.requireTLS, true);
      assert.equal(config.smtpConfig({ ...smtp, SMTP_SECURE: 'true', SMTP_PORT: '465' }).options.secure, true);
      assert.equal(config.appBaseUrl({ NODE_ENV: 'test', APP_BASE_URL: base }), base);
    });
    for (const route of ['/forgot-password', '/reset-password/invalid']) await t.test(`malformed HTTP body preserves privacy headers ${route}`, async () => {
      const lines = [], original = console.error;
      console.error = (...args) => lines.push(args.join(' '));
      try {
        const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '"private-body-fixture" trailing' });
        const html = await response.text();
        assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.match(html, /La demande est invalide/);
        assert.doesNotMatch(html + lines.join(''), /private-body-fixture|SyntaxError|JSON position|stack trace/);
      } finally { console.error = original; }
    });
    await t.test('unknown token rejected before bcrypt work', async () => {
      const original = passwords.hashPassword; let called = false;
      passwords.hashPassword = async () => { called = true; throw new Error('bcrypt should not run'); };
      try { await assert.rejects(resets.resetPassword('z'.repeat(43), nextPassword), { code: 'INVALID_TOKEN' }); assert.equal(called, false); }
      finally { passwords.hashPassword = original; }
    });
  } finally {
    fake.handler = null; delivery.setEmailProviderForTest(null); fake.messages.length = 0;
    if (previous.csrf === undefined) delete process.env.CSRF_ENFORCE; else process.env.CSRF_ENFORCE = previous.csrf;
    if (previous.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previous.base;
    await new Promise(resolve => server.close(resolve));
    for (const sid of sids) await callStore('destroy', sid);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
});
