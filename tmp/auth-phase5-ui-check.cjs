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
const { renderResetEmail } = require('../src/services/passwordResetEmailTemplate');

(async () => {
  const ids = [], suffix = String(Date.now()).slice(-7), password = require('crypto').randomBytes(20).toString('base64url');
  const output = path.resolve('tmp/auth-phase5-ui'); fs.mkdirSync(output, { recursive: true });
  let server, browser;
  const fake = new FakeEmailTransport(); delivery.setEmailProviderForTest(fake);
  process.env.CSRF_ENFORCE = 'true';
  try {
    const passwordHash = await passwords.hashPassword(password);
    const admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Validation', phoneNumber: `+24381${suffix}`, passwordHash, role: 'ADMIN' } }); ids.push(admin.id);
    const user = await prisma.user.create({ data: { firstName: 'Marie', lastName: 'Exemple', phoneNumber: `+24382${suffix}`, email: `phase5-ui-${suffix}@example.test`, passwordHash } }); ids.push(user.id);
    await requests.createPasswordResetRequest(user.email);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } }); await requests.approvePasswordResetRequest(request.id, admin);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`; process.env.APP_BASE_URL = base;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'nva-language', value: 'fr', url: base }]);
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/login'); await page.locator('#phoneNumber').fill(admin.phoneNumber); await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/admin/dashboard'), page.locator('form[action="/login"] button[type="submit"]').click()]);
    const detail = `${base}/admin/password-reset-requests/${request.id}?lang=fr`;
    let layouts = 0;
    async function capture(state) {
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.goto(detail);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const button = page.locator('form[action*="/send?"] button'); await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        await page.screenshot({ path: path.join(output, `${state}-${width}.png`), fullPage: true }); layouts++;
      }
    }
    await capture('approved');
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Envoyer le lien de réinitialisation', exact: true }).click();
    assert.equal(fake.messages.length, 0);
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([page.waitForURL('**?success=sent&lang=fr'), page.getByRole('button', { name: 'Envoyer le lien de réinitialisation', exact: true }).click()]);
    assert.equal(fake.messages.length, 1); assert.equal((await prisma.passwordResetRequest.findUnique({ where: { id: request.id } })).deliveryStatus, 'SENT');
    const token = new URL(fake.messages[0].text.match(/https?:\/\/[^\s]+/)[0]).pathname.split('/').at(-1);
    assert.ok(!(await page.content()).includes(token)); await capture('sent');
    await prisma.passwordResetRequest.update({ where: { id: request.id }, data: { deliveryAttemptedAt: new Date(Date.now() - 31000) } });
    fake.handler = async () => { throw new Error('FAKE_FAILURE'); };
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([page.waitForURL('**/send?lang=fr'), page.getByRole('button', { name: 'Réessayer l’envoi', exact: true }).click()]);
    assert.ok((await page.content()).includes('Échec de l’envoi')); assert.ok(!(await page.content()).includes(token));
    await prisma.user.update({ where: { id: user.id }, data: { email: null } }); await page.goto(detail);
    assert.equal(await page.locator('form[action*="/send?"]').count(), 0); assert.ok((await page.content()).includes('Aucune adresse email'));
    const preview = await context.newPage();
    for (const width of [640, 390]) {
      await preview.setViewportSize({ width, height: 900 });
      await preview.setContent(renderResetEmail({ firstName: 'Marie', link: 'https://example.test/reset-password/preview' }).html);
      assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await preview.screenshot({ path: path.join(output, `email-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); console.log('ADMIN_LAYOUTS=6/6; EMAIL_LAYOUTS=2/2; CONFIRMATIONS=2/2; ERROR_AND_NO_EMAIL=2/2; PAGE_ERRORS=0; REAL_EMAILS=0');
  } finally {
    delivery.setEmailProviderForTest(null); fake.messages.length = 0;
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
})().catch(error => { console.error(error.name, error.message.replace(/\/reset-password\/[^\s]+/g, '/reset-password/[REDACTED]')); process.exitCode = 1; });
