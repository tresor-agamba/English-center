const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const fs = require('node:fs');
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
const provider = require('../src/services/emailDeliveryProvider');
const config = require('../src/utils/resetDeliveryConfig');
const { renderResetEmail } = require('../src/services/passwordResetEmailTemplate');
const messages = require('../src/utils/passwordResetRequestMessages');
const FakeEmailTransport = require('./helpers/fakeEmailTransport');
const store = require('../src/config/sessionStore').getSessionStore();

test('Phase 5 — livraison email sécurisée sans réseau SMTP', async t => {
  const previous = { csrf: process.env.CSRF_ENFORCE, base: process.env.APP_BASE_URL };
  process.env.CSRF_ENFORCE = 'true'; app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; process.env.APP_BASE_URL = `${base}/`;
  const fake = new FakeEmailTransport(); delivery.setEmailProviderForTest(fake);
  const ids = [], sids = new Set(), suffix = String(Date.now()).slice(-6);
  const password = 'Phase5Initial@2026', nextPassword = 'Phase5Changed@2026', hash = await passwords.hashPassword(password);
  let serial = 0, ip = 0, admin, jar;
  const callStore = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
  async function create(extra = {}) {
    const user = await prisma.user.create({ data: { firstName: 'Phase5', lastName: 'Fixture', phoneNumber: `+2438${String(++serial).padStart(2, '0')}${suffix}`,
      email: `phase5-${suffix}-${serial}@example.test`, passwordHash: hash, ...extra } }); ids.push(user.id); return user;
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
  const age = (userId, ms = delivery.RETRY_DELAY_MS + 1000) => prisma.passwordResetRequest.updateMany({ where: { userId }, data: { deliveryAttemptedAt: new Date(Date.now() - ms) } });
  async function noToken(fixture) {
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: fixture.user.id } }), 0);
    assert.equal((await row(fixture.request.id)).deliveryAttempts, 0);
  }
  try {
    admin = await create({ role: 'ADMIN' }); jar = await login(admin);
    for (const status of ['PENDING', 'REJECTED', 'COMPLETED', 'CANCELLED', 'EXPIRED']) await t.test(`${status} interdit la livraison`, async () => {
      const fixture = await approved(); await prisma.passwordResetRequest.update({ where: { id: fixture.request.id }, data: { status } });
      const before = fake.messages.length;
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_INELIGIBLE' });
      await noToken(fixture); assert.equal(fake.messages.length, before);
    });
    for (const [label, email] of [['absent', null], ['invalide', 'invalid'], ['liste', 'a@example.test,b@example.test'], ['en-tête', 'a@example.test\r\nBcc:b@example.test']]) {
      await t.test(`email ${label} : aucun token ni tentative SMTP`, async () => {
        const fixture = await approved({ email }); const before = fake.messages.length;
        await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: email ? 'INVALID_EMAIL' : 'NO_EMAIL' });
        await noToken(fixture); assert.equal((await row(fixture.request.id)).status, 'APPROVED'); assert.equal(fake.messages.length, before);
      });
    }
    for (const [label, change] of [['inactif', { isActive: false }], ['rôle ADMIN', { role: 'ADMIN' }], ['version obsolète', { authVersion: { increment: 1 } }]]) await t.test(`utilisateur ${label} refusé`, async () => {
      const fixture = await approved(); await prisma.user.update({ where: { id: fixture.user.id }, data: change });
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_INELIGIBLE' }); await noToken(fixture);
    });
    await t.test('utilisateur supprimé : 404 propre sans émission', async () => {
      const fixture = await approved(); await prisma.user.delete({ where: { id: fixture.user.id } });
      assert.equal((await http(path(fixture.request.id), jar, {})).response.status, 404);
    });
    for (const role of ['STUDENT', 'TEACHER']) await t.test(`${role} ne peut pas envoyer`, async () => {
      const fixture = await approved(), actor = await create({ role }), other = await login(actor);
      assert.equal((await http(path(fixture.request.id), other, {})).response.status, 403);
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, actor), { code: 'FORBIDDEN' }); await noToken(fixture);
    });
    await t.test('visiteur anonyme redirigé et acteur absent refusé', async () => {
      const fixture = await approved(), anon = {}; await http('/login', anon);
      assert.equal((await http(path(fixture.request.id), anon, {})).response.headers.get('location'), '/login');
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, null), { code: 'FORBIDDEN' }); await noToken(fixture);
    });
    for (const [label, change] of [['désactivé', { isActive: false }], ['rétrogradé', { role: 'TEACHER' }], ['session révoquée', { authVersion: { increment: 1 } }]]) await t.test(`ADMIN ${label} perd le droit d’envoi`, async () => {
      const actor = await create({ role: 'ADMIN' }), other = await login(actor), fixture = await approved();
      await prisma.user.update({ where: { id: actor.id }, data: change });
      assert.equal((await http(path(fixture.request.id), other, {})).response.headers.get('location'), '/login');
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, actor), { code: 'FORBIDDEN' }); await noToken(fixture);
    });
    await t.test('droits ADMIN revérifiés après verrou', async () => {
      const actor = await create({ role: 'ADMIN' }), fixture = await approved(), original = passwords.lockUser;
      passwords.lockUser = async (tx, id) => { await original(tx, id); if (id === actor.id) await tx.user.update({ where: { id }, data: { isActive: false } }); };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, actor), { code: 'FORBIDDEN' }); }
      finally { passwords.lockUser = original; } await noToken(fixture);
    });
    let sentFixture, message;
    await t.test('APPROVED peut être livré par POST, destinataire imposé par User.email', async () => {
      sentFixture = await approved();
      const result = await http(path(sentFixture.request.id), jar, { email: 'attacker@example.test', to: 'attacker@example.test', channel: 'SMS' });
      assert.equal(result.response.status, 302); assert.match(result.response.headers.get('location'), /success=sent/);
      message = received(); assert.equal(message.to, sentFixture.user.email);
      assert.ok(!JSON.stringify(message).includes('attacker@example.test'));
    });
    await t.test('SENT, canal EMAIL, date et compteur enregistrés sans compléter la demande', async () => {
      const saved = await row(sentFixture.request.id);
      assert.equal(saved.status, 'APPROVED'); assert.equal(saved.deliveryStatus, 'SENT'); assert.equal(saved.deliveryChannel, 'EMAIL');
      assert.equal(saved.deliveryAttempts, 1); assert.ok(saved.deliveryAttemptedAt); assert.ok(saved.deliveredAt); assert.equal(saved.completedAt, null);
    });
    await t.test('token lié, hash seul en base, activation uniquement après succès', async () => {
      const token = tokenOf(message), saved = await tokenRow(sentFixture.request.id);
      assert.equal(saved.userId, sentFixture.user.id); assert.equal(saved.requestId, sentFixture.request.id);
      assert.ok(saved.tokenHash === resets.hashToken(token)); assert.equal(saved.deliveryPending, false); assert.equal(saved.usedAt, null);
      const dump = JSON.stringify([saved, await row(sentFixture.request.id)]);
      assert.ok(!dump.includes(token)); assert.ok(!dump.includes(linkOf(message))); assert.ok(await resets.findValid(token));
    });
    await t.test('lien utilise APP_BASE_URL et uniquement le token dans son chemin', () => {
      const link = new URL(linkOf(message)); assert.equal(link.origin, base); assert.ok(/^\/reset-password\/[A-Za-z0-9_-]{43}$/.test(link.pathname));
      assert.equal(link.search, ''); assert.equal(link.hash, ''); assert.ok(!link.pathname.includes('//'));
    });
    await t.test('email professionnel HTML et texte sans secret supplémentaire', () => {
      assert.equal(message.subject, 'New Vision Academy — Réinitialisation de votre mot de passe');
      for (const body of [message.html, message.text]) {
        assert.match(body, /30 minutes/); assert.match(body, /une seule fois/); assert.match(body, /Learn\. Speak\. Succeed\./);
        assert.ok(body.includes(linkOf(message))); assert.ok(!body.includes(password)); assert.ok(!body.includes(hash));
        assert.doesNotMatch(body, /passwordHash|authVersion|adminId|<script/i);
      }
      assert.match(message.html, /<a href=/); assert.match(message.text, /Bonjour Phase5/);
    });
    await t.test('templates FR/EN et noms HTML échappés', () => {
      const email = renderResetEmail({ firstName: '<img src=x onerror=alert(1)>', link: linkOf(message), language: 'en' });
      assert.match(email.subject, /Reset your password/); assert.match(email.text, /30 minutes/);
      assert.ok(email.html.includes('&lt;img')); assert.ok(!email.html.includes('<img')); assert.doesNotMatch(email.html, /<script/);
    });
    await t.test('ADMIN reçoit uniquement statut, jamais token, lien ou hash', async () => {
      const detail = await http(`/admin/password-reset-requests/${sentFixture.request.id}?success=sent`, jar);
      assert.equal(detail.response.status, 200); assert.match(detail.html, /Lien de réinitialisation envoyé/); assert.match(detail.html, /Réessayer/);
      for (const secret of [tokenOf(message), linkOf(message), resets.hashToken(tokenOf(message))]) assert.ok(!detail.html.includes(secret));
      const sid = signature.unsign(decodeURIComponent(jar.cookie.split('=').slice(1).join('=')).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
      assert.ok(!JSON.stringify(await callStore('get', sid)).includes(tokenOf(message)));
    });
    await t.test('absence email affichée uniquement côté ADMIN sans formulaire d’envoi', async () => {
      const fixture = await approved({ email: null });
      const result = await http(`/admin/password-reset-requests/${fixture.request.id}`, jar);
      assert.match(result.html, /Aucune adresse email/); assert.ok(!result.html.includes(`${fixture.request.id}/send`)); await noToken(fixture);
    });
    await t.test('configuration URL invalide refusée avant émission', async () => {
      const fixture = await approved(), original = process.env.APP_BASE_URL;
      try { for (const url of ['', 'invalid', 'javascript:alert(1)', 'http://outside.example', `${base}/path`, `${base}/?token=x`, `http://user:pass@localhost`]) {
        process.env.APP_BASE_URL = url;
        await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'EMAIL_NOT_CONFIGURED' });
      } } finally { process.env.APP_BASE_URL = original; } await noToken(fixture);
    });
    await t.test('HTTPS obligatoire en production et normalisation du slash', () => {
      assert.equal(config.appBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: 'https://example.test/' }), 'https://example.test');
      assert.throws(() => config.appBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: 'http://localhost:3000' }), { code: 'EMAIL_NOT_CONFIGURED' });
    });
    await t.test('SMTP sans configuration : erreur contrôlée et aucun token', async () => {
      const fixture = await approved(); delivery.setEmailProviderForTest(null);
      try {
        await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'EMAIL_NOT_CONFIGURED' });
        const result = await http(path(fixture.request.id), jar, {});
        assert.equal(result.response.status, 503); assert.match(result.html, /Service email non configuré/);
      } finally { delivery.setEmailProviderForTest(fake); } await noToken(fixture);
    });
    await t.test('configuration SMTP standard, TLS requis et debug désactivé', () => {
      const env = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'test', SMTP_PASSWORD: 'synthetic-only', EMAIL_FROM: 'nva@example.test' };
      const settings = config.smtpConfig(env); assert.equal(settings.options.requireTLS, true); assert.equal(settings.options.tls.rejectUnauthorized, true);
      assert.equal(settings.options.logger, false); assert.equal(settings.options.debug, false);
      assert.equal(settings.options.disableFileAccess, true); assert.equal(settings.options.disableUrlAccess, true);
      assert.equal(config.smtpConfig({ ...env, SMTP_SECURE: 'true', SMTP_PORT: '465' }).options.secure, true);
      for (const overrides of [{ SMTP_PASSWORD: '' }, { SMTP_PORT: 'no' }, { SMTP_SECURE: 'maybe' }, { EMAIL_FROM: 'Name <nva@example.test>' }]) assert.throws(() => config.smtpConfig({ ...env, ...overrides }), { code: 'EMAIL_NOT_CONFIGURED' });
    });
    await t.test('provider réel strictement interdit aux tests même après changement NODE_ENV', () => {
      assert.throws(() => provider.createEmailDeliveryProvider(), { code: 'EMAIL_NOT_CONFIGURED' });
      const original = process.env.NODE_ENV;
      try { process.env.NODE_ENV = 'production'; assert.throws(() => provider.createEmailDeliveryProvider(), { code: 'EMAIL_NOT_CONFIGURED' });
        assert.throws(() => delivery.setEmailProviderForTest(fake), { code: 'TEST_DELIVERY_DISABLED' });
      } finally { process.env.NODE_ENV = original; }
    });
    for (const outcome of ['accepted', 'rejected', 'error']) await t.test(`adaptateur SMTP ${outcome} : contrat Nodemailer vérifié sans connexion`, async () => {
      // Isolated module evaluation with a stubbed library: no real transporter is constructed.
      const vm = require('node:vm'), resultModule = { exports: {} }; let options, envelope, closed = 0;
      const env = { NODE_ENV: 'development', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture-only', EMAIL_FROM: 'nva@example.test' };
      const context = { module: resultModule, process: { env }, setTimeout, clearTimeout,
        require(name) {
          if (name === '../utils/resetDeliveryConfig') return { ResetDeliveryError: config.ResetDeliveryError, smtpConfig: () => config.smtpConfig(env) };
          assert.equal(name, 'nodemailer');
          return { createTransport(value) { options = value; return {
            close() { closed++; }, async sendMail(mail) {
              envelope = mail;
              if (outcome === 'error') throw new Error(`Untrusted provider ${mail.text}`);
              return outcome === 'accepted' ? { accepted: [mail.to.address], rejected: [] } : { accepted: [], rejected: [mail.to.address] };
            },
          }; } };
        },
      };
      vm.runInNewContext(fs.readFileSync('src/services/emailDeliveryProvider.js', 'utf8'), context);
      const sender = resultModule.exports.createEmailDeliveryProvider();
      if (outcome === 'accepted') assert.equal((await sender.send(message)).accepted, true);
      else await assert.rejects(sender.send(message), error => error.code === 'DELIVERY_FAILED' && !error.message.includes(tokenOf(message)));
      assert.equal(envelope.to.address, message.to); assert.equal(envelope.from.address, 'nva@example.test');
      assert.equal(envelope.text, message.text); assert.equal(envelope.html, message.html);
      assert.equal(options.requireTLS, true); assert.ok(closed > 0);
    });
    let failed;
    await t.test('échec SMTP : token immédiatement invalidé, FAILED, demande APPROVED', async () => {
      failed = await approved(); fake.handler = async mail => { throw new Error(`Untrusted provider: ${mail.text}`); };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(failed.request.id, admin), { code: 'DELIVERY_FAILED' }); }
      finally { fake.handler = null; }
      const saved = await row(failed.request.id); assert.equal(saved.status, 'APPROVED'); assert.equal(saved.deliveryStatus, 'FAILED'); assert.equal(saved.deliveredAt, null);
      assert.ok((await tokenRow(failed.request.id)).usedAt); assert.equal(await resets.findValid(tokenOf(received())), null);
    });
    await t.test('retry trop rapide refusé sans nouvel email', async () => {
      const before = fake.messages.length;
      await assert.rejects(delivery.deliverApprovedResetRequest(failed.request.id, admin), { code: 'DELIVERY_RATE_LIMITED' }); assert.equal(fake.messages.length, before);
    });
    await t.test('retry après échec : nouveau secret et un seul token actif', async () => {
      const old = tokenOf(received()); await age(failed.user.id);
      const result = await delivery.deliverApprovedResetRequest(failed.request.id, admin), next = tokenOf(received());
      assert.deepEqual(result, { requestId: failed.request.id, channel: 'EMAIL', status: 'SENT' }); assert.ok(old !== next);
      assert.equal(await resets.findValid(old), null); assert.ok(await resets.findValid(next));
      assert.equal((await row(failed.request.id)).deliveryAttempts, 2);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: failed.user.id, usedAt: null, deliveryPending: false } }), 1);
    });
    await t.test('renvoi après succès invalide aussi le lien précédent', async () => {
      const old = tokenOf(received()); await age(failed.user.id); await delivery.deliverApprovedResetRequest(failed.request.id, admin);
      assert.ok(old !== tokenOf(received())); assert.equal(await resets.findValid(old), null); assert.equal((await row(failed.request.id)).deliveryAttempts, 3);
    });
    await t.test('provider sans acceptation explicite reste FAILED', async () => {
      const fixture = await approved(); fake.handler = async () => ({ accepted: false });
      try { await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_FAILED' }); }
      finally { fake.handler = null; } assert.equal((await row(fixture.request.id)).deliveryStatus, 'FAILED');
    });
    await t.test('double clic : une tentative et token inutilisable pendant SMTP', async () => {
      const fixture = await approved(); let release, started;
      const waiting = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
      fake.handler = async () => { started(); await gate; return { accepted: true }; };
      const first = delivery.deliverApprovedResetRequest(fixture.request.id, admin); await waiting;
      try {
        assert.equal((await row(fixture.request.id)).deliveryStatus, 'SENDING'); assert.equal(await resets.findValid(tokenOf(received())), null);
        await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_BUSY' });
      } finally { release(); fake.handler = null; }
      await first; assert.equal((await row(fixture.request.id)).deliveryAttempts, 1);
      assert.ok(await resets.findValid(tokenOf(received())));
    });
    await t.test('deux demandes du même compte ne peuvent pas envoyer simultanément', async () => {
      const fixture = await approved(); await requests.createPasswordResetRequest(fixture.user.phoneNumber);
      const other = await prisma.passwordResetRequest.findFirst({ where: { userId: fixture.user.id, status: 'PENDING' } }); await requests.approvePasswordResetRequest(other.id, admin);
      let release, started; const waiting = new Promise(r => { started = r; }), gate = new Promise(r => { release = r; });
      fake.handler = async () => { started(); await gate; return { accepted: true }; };
      const first = delivery.deliverApprovedResetRequest(fixture.request.id, admin); await waiting;
      try { await assert.rejects(delivery.deliverApprovedResetRequest(other.id, admin), { code: 'DELIVERY_BUSY' }); }
      finally { release(); fake.handler = null; } await first;
      await assert.rejects(delivery.deliverApprovedResetRequest(other.id, admin), { code: 'DELIVERY_RATE_LIMITED' });
    });
    await t.test('reprise après interruption : bail expiré et ancien token remplacé', async () => {
      const fixture = await approved(), old = await resets.preparePasswordResetForTest(fixture.request.id);
      await prisma.passwordResetToken.update({ where: { requestId: fixture.request.id }, data: { deliveryPending: true } });
      await prisma.passwordResetRequest.update({ where: { id: fixture.request.id }, data: { deliveryStatus: 'SENDING', deliveryAttempts: 1, deliveryAttemptedAt: new Date(Date.now() - delivery.DELIVERY_LEASE_MS - 1000) } });
      await delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      assert.equal(await resets.findValid(old.token), null); assert.equal((await row(fixture.request.id)).deliveryAttempts, 2); assert.ok(await resets.findValid(tokenOf(received())));
    });
    await t.test('résultat SMTP tardif ne peut pas activer ou invalider une tentative plus récente', async () => {
      const fixture = await approved(); let release, started;
      const waiting = new Promise(r => { started = r; }), gate = new Promise(r => { release = r; });
      fake.handler = async () => { started(); await gate; return { accepted: true }; };
      const first = delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      const failure = assert.rejects(first, { code: 'DELIVERY_FAILED' }); await waiting;
      const old = tokenOf(received());
      try {
        await age(fixture.user.id, delivery.DELIVERY_LEASE_MS + 1000); fake.handler = null;
        await delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      } finally { release(); fake.handler = null; }
      await failure; assert.equal((await row(fixture.request.id)).deliveryStatus, 'SENT');
      assert.equal(await resets.findValid(old), null); assert.ok(await resets.findValid(tokenOf(received())));
    });
    for (const [label, change] of [['email modifié', { email: 'changed@example.test' }], ['compte désactivé', { isActive: false }], ['version révoquée', { authVersion: { increment: 1 } }]]) await t.test(`${label} pendant SMTP : aucune activation`, async () => {
      const fixture = await approved(); fake.handler = async () => { await prisma.user.update({ where: { id: fixture.user.id }, data: change }); return { accepted: true }; };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_FAILED' }); }
      finally { fake.handler = null; }
      assert.equal(await resets.findValid(tokenOf(received())), null); assert.equal((await row(fixture.request.id)).deliveryStatus, 'FAILED');
    });
    await t.test('ADMIN révoqué pendant SMTP : aucun token activé', async () => {
      const fixture = await approved(), actor = await create({ role: 'ADMIN' });
      fake.handler = async () => { await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } }); return { accepted: true }; };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, actor), { code: 'DELIVERY_FAILED' }); }
      finally { fake.handler = null; } assert.equal(await resets.findValid(tokenOf(received())), null);
    });
    await t.test('échec de finalisation DB : token reste non exploitable, reprise possible', async () => {
      const fixture = await approved(), original = prisma.$transaction;
      fake.handler = async () => { prisma.$transaction = async () => { throw new Error('INJECTED_DB_FAILURE'); }; return { accepted: true }; };
      try { await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_FAILED' }); }
      finally { prisma.$transaction = original; fake.handler = null; }
      assert.equal(await resets.findValid(tokenOf(received())), null); assert.equal((await row(fixture.request.id)).deliveryStatus, 'SENDING');
      await age(fixture.user.id, delivery.DELIVERY_LEASE_MS + 1000); await delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      assert.equal((await row(fixture.request.id)).deliveryStatus, 'SENT');
    });
    await t.test('email reçu permet GET/POST, COMPLETED, authVersion et révocation de session', async () => {
      const fixture = await approved(), old = await login(fixture.user); await delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      const token = tokenOf(received()), session = {};
      const get = await http(`/reset-password/${token}`, session); assert.equal(get.response.status, 200);
      assert.equal(get.response.headers.get('cache-control'), 'no-store'); assert.equal(get.response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal((await http(`/reset-password/${token}`, session, { password: nextPassword, passwordConfirmation: nextPassword })).response.status, 200);
      assert.equal((await row(fixture.request.id)).status, 'COMPLETED'); assert.ok((await row(fixture.request.id)).completedAt);
      const user = await prisma.user.findUnique({ where: { id: fixture.user.id } }); assert.equal(user.authVersion, 1); assert.ok(await passwords.comparePassword(nextPassword, user.passwordHash));
      assert.equal((await http('/student', old)).response.headers.get('location'), '/login'); await login(fixture.user, nextPassword);
      assert.equal((await http(`/reset-password/${token}`, session, { password: nextPassword, passwordConfirmation: nextPassword })).response.status, 400);
      await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin), { code: 'DELIVERY_INELIGIBLE' });
    });
    await t.test('lien email expiré inutilisable et renvoi autorisé', async () => {
      const fixture = await approved(); await delivery.deliverApprovedResetRequest(fixture.request.id, admin); const old = tokenOf(received());
      await prisma.passwordResetToken.update({ where: { requestId: fixture.request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await http(`/reset-password/${old}`)).response.status, 400);
      await age(fixture.user.id); await delivery.deliverApprovedResetRequest(fixture.request.id, admin);
      assert.equal(await resets.findValid(old), null); assert.ok(await resets.findValid(tokenOf(received())));
    });
    await t.test('CSRF et POST obligatoires pour envoyer', async () => {
      const fixture = await approved(); assert.equal((await http(path(fixture.request.id), jar)).response.status, 404);
      assert.equal((await http(path(fixture.request.id), jar, {}, { csrf: false })).response.status, 403);
      assert.equal((await http(path(fixture.request.id), jar, { _csrf: 'wrong' })).response.status, 403); await noToken(fixture);
    });
    await t.test('rate limiter HTTP : au plus vingt tentatives par quinze minutes et IP', async () => {
      const fixture = await approved(); const options = { ip: '192.0.2.250' };
      for (let i = 0; i < 20; i++) assert.equal((await http('/admin/password-reset-requests/2147483647/send', jar, {}, options)).response.status, 404);
      assert.equal((await http(path(fixture.request.id), jar, {}, options)).response.status, 429); await noToken(fixture);
    });
    await t.test('logs, audit, erreurs HTTP et JSON ne contiennent aucun secret', async () => {
      const fixture = await approved(), entries = [], original = { log: console.log, warn: console.warn, error: console.error };
      for (const level of Object.keys(original)) console[level] = value => entries.push(String(value));
      let first, second, result;
      try {
        await delivery.deliverApprovedResetRequest(fixture.request.id, admin); first = received(); await age(fixture.user.id);
        fake.handler = async mail => { throw new Error(`Untrusted SMTP body ${mail.text} password=${password}`); };
        result = await http(path(fixture.request.id), jar, {}, { headers: { Accept: 'application/json' } }); second = received();
      } finally { Object.assign(console, original); fake.handler = null; }
      assert.equal(result.response.status, 503);
      const output = entries.join('\n') + result.html;
      for (const mail of [first, second]) for (const secret of [tokenOf(mail), linkOf(mail), mail.to, resets.hashToken(tokenOf(mail)), password, hash]) assert.ok(!output.includes(secret), 'Secret présent dans les logs');
      const audits = entries.map(line => JSON.parse(line)).filter(x => x.action.startsWith('PASSWORD_RESET_DELIVERY_'));
      assert.deepEqual(audits.map(x => x.action), ['PASSWORD_RESET_DELIVERY_SENT', 'PASSWORD_RESET_DELIVERY_FAILED']);
      for (const event of audits) {
        assert.equal(event.adminId, admin.id); assert.equal(event.userId, fixture.user.id); assert.equal(event.requestId, fixture.request.id);
        assert.equal(event.channel, 'EMAIL'); assert.ok(Number.isFinite(Date.parse(event.timestamp)));
        assert.deepEqual(Object.keys(event).sort(), ['action', 'adminId', 'channel', 'level', 'requestId', 'result', 'timestamp', 'userId']);
      }
    });
    await t.test('forgot-password reste générique sans émission quel que soit l’email', async () => {
      const known = await create(), absent = await create({ email: null }), inactive = await create({ isActive: false }), session = {};
      await http('/forgot-password', session); const before = fake.messages.length; let expected;
      for (const identifier of [known.phoneNumber, absent.phoneNumber, inactive.phoneNumber, 'missing-phase5@example.test']) {
        const result = await http('/forgot-password', session, { identifier }); assert.equal(result.response.status, 200);
        const status = result.html.match(/<p role="status"[^>]*>(.*?)<\/p>/)[1]; expected ||= status; assert.equal(status, expected);
        assert.ok(!result.html.includes(known.email)); assert.doesNotMatch(result.html, /\/reset-password\//);
      }
      assert.equal(fake.messages.length, before);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: { in: [known.id, absent.id, inactive.id] } } }), 0);
    });
    await t.test('APPROVE seul reste sans token ni email', async () => {
      const before = fake.messages.length, fixture = await approved(); await noToken(fixture); assert.equal(fake.messages.length, before);
    });
    await t.test('FR/EN admin, confirmation, absence de champ destinataire et dashboard', async () => {
      assert.deepEqual(Object.keys(messages.fr).sort(), Object.keys(messages.en).sort());
      const fixture = await approved();
      for (const language of ['fr', 'en']) {
        const result = await http(`/admin/password-reset-requests/${fixture.request.id}?lang=${language}`, jar);
        assert.ok(result.html.includes(messages[language].sendLink)); assert.ok(result.html.includes('data-admin-confirm='));
        assert.doesNotMatch(result.html, /<input[^>]+name="(?:email|to|token)"/);
      }
      assert.equal((await http('/admin/dashboard', jar)).response.status, 200);
    });
    await t.test('canaux futurs et identifiants invalides refusés sans émission', async () => {
      const fixture = await approved();
      for (const channel of ['SMS', 'WHATSAPP', 'OTHER']) await assert.rejects(delivery.deliverApprovedResetRequest(fixture.request.id, admin, { channel }), { code: 'CHANNEL_UNAVAILABLE' });
      for (const id of ['abc', 0, -1, 1.5, 2147483648]) assert.equal((await http(path(id), jar, {})).response.status, 400);
      await noToken(fixture);
    });
    await t.test('configuration documentée, aucun secret réel ni appel de notification', () => {
      const env = fs.readFileSync('.env.example', 'utf8');
      for (const key of ['APP_BASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']) assert.ok(env.includes(`${key}=`));
      assert.match(env, /^SMTP_PASSWORD=$/m);
      assert.doesNotMatch(fs.readFileSync('src/services/passwordResetDeliveryService.js', 'utf8'), /notificationService|whatsappDeliveryService/);
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
