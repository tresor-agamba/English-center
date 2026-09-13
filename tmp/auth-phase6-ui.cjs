const assert = require('node:assert/strict');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const passwords = require('../src/services/passwordService');
const requests = require('../src/services/passwordResetRequestService');
const delivery = require('../src/services/passwordResetDeliveryService');
const FakeEmailTransport = require('../tests/helpers/fakeEmailTransport');
const logger = require('../src/services/loggerService');
(async () => {
  const ids = [], suffix = String(Date.now()).slice(-7), password = require('crypto').randomBytes(20).toString('base64url');
  const output = path.resolve('tmp/auth-phase6-ui'); fs.mkdirSync(output, { recursive: true });
  let server, browser, context;
  const fake = new FakeEmailTransport(); delivery.setEmailProviderForTest(fake); process.env.CSRF_ENFORCE = 'true';
  try {
    const passwordHash = await passwords.hashPassword(password);
    const admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Validation', phoneNumber: `+24381${suffix}`, passwordHash, role: 'ADMIN' } }); ids.push(admin.id);
    const user = await prisma.user.create({ data: { firstName: 'Marie', lastName: 'Exemple', phoneNumber: `+24382${suffix}`, email: `phase6-ui-${suffix}@example.test`, passwordHash } }); ids.push(user.id);
    await requests.createPasswordResetRequest(user.email);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
    await requests.approvePasswordResetRequest(request.id, admin);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`; process.env.APP_BASE_URL = base;
    await delivery.deliverApprovedResetRequest(request.id, admin);
    const link = fake.messages[0].text.match(/https?:\/\/[^\s]+/)[0], token = new URL(link).pathname.split('/').at(-1);
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'nva-language', value: 'fr', url: base }]);
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(logger.sanitizeString(error.message)));
    let layouts = 0;
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, url] of [['forgot', base + '/forgot-password'], ['reset', link]]) {
        await page.goto(url); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.ok(!(await page.content()).includes(token));
        if (name === 'reset') { assert.equal(await page.locator('input[autocomplete="new-password"]').count(), 2); assert.equal(await page.locator('form[method="post"]').getAttribute('action'), null); }
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true }); layouts++;
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('header button[data-language="en"]').click();
    await page.getByLabel('Confirm your new password', { exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('header button[data-language="fr"]').click();
    await page.getByLabel('Confirmer le nouveau mot de passe', { exact: true }).waitFor();
    await page.locator('#password').fill(password); await page.locator('#passwordConfirmation').fill('Mismatch@2026');
    await Promise.all([page.waitForNavigation(), page.locator('form button[type="submit"]').click()]);
    await page.locator('#reset-error').waitFor(); assert.ok(!(await page.content()).includes(token));
    await page.screenshot({ path: path.join(output, 'reset-error-1440.png'), fullPage: true });
    await page.locator('#password').fill(password); await page.locator('#passwordConfirmation').fill(password);
    await Promise.all([page.waitForNavigation(), page.locator('form button[type="submit"]').click()]);
    assert.equal((await prisma.passwordResetRequest.findUnique({ where: { id: request.id } })).status, 'COMPLETED');
    assert.ok(!(await page.content()).includes(token));
    await page.goto(link); await page.locator('#reset-error').waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.screenshot({ path: path.join(output, 'reset-expired-1440.png'), fullPage: true });
    await page.goto(base + '/login'); await page.locator('#phoneNumber').fill(admin.phoneNumber); await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/admin/dashboard'), page.locator('form[action="/login"] button[type="submit"]').click()]);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}/admin/password-reset-requests/${request.id}?lang=fr`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(!(await page.content()).includes(user.email)); assert.ok(!(await page.content()).includes(token));
      await page.screenshot({ path: path.join(output, `admin-${width}.png`), fullPage: true }); layouts++;
    }
    const preview = await context.newPage();
    for (const width of [640, 390]) {
      await preview.setViewportSize({ width, height: 900 });
      await preview.setContent(require('../src/services/passwordResetEmailTemplate').renderResetEmail({ firstName: 'Marie', link: 'https://example.test/reset-password/preview' }).html);
      assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await preview.screenshot({ path: path.join(output, `email-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); console.log(`LAYOUTS=${layouts}/9; EMAIL_LAYOUTS=2/2; LOCALE_SWITCH=2/2; RESET_FORM_POST=PASS; INVALID_LINK=PASS; PAGE_ERRORS=0; REAL_EMAILS=0`);
  } finally {
    if (context) {
      const cookies = await context.cookies();
      const store = require('../src/config/sessionStore').getSessionStore();
      for (const cookie of cookies.filter(c => c.name === 'connect.sid')) {
        const sid = require('cookie-signature').unsign(decodeURIComponent(cookie.value).slice(2), process.env.SESSION_SECRET || 'development-secret-change-me');
        if (sid) await new Promise((resolve, reject) => store.destroy(sid, e => e ? reject(e) : resolve()));
      }
    }
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    fake.messages.length = 0; delivery.setEmailProviderForTest(null);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
})().catch(error => { console.error(logger.sanitizeString(error.message)); process.exitCode = 1; });


