const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/english_center_test');
const { chromium } = require('playwright');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const passwords = require('../src/services/passwordService');
const service = require('../src/services/passwordResetRequestService');

(async () => {
  process.env.CSRF_ENFORCE = 'true';
  const ids = [], suffix = String(Date.now()).slice(-7);
  const password = require('crypto').randomBytes(20).toString('base64url');
  let server, browser;
  const output = path.resolve('tmp/auth-phase3-ui'); fs.mkdirSync(output, { recursive: true });
  try {
    const passwordHash = await passwords.hashPassword(password);
    const admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Validation', phoneNumber: `+24381${suffix}`, passwordHash, role: 'ADMIN' } }); ids.push(admin.id);
    const user = await prisma.user.create({ data: { firstName: 'Marie', lastName: 'Exemple', phoneNumber: `+24382${suffix}`, email: `phase3-ui-${suffix}@example.test`, whatsappNumber: `+24382${suffix}`, passwordHash } }); ids.push(user.id);
    await service.createPasswordResetRequest(user.email);
    const request = await prisma.passwordResetRequest.findFirst({ where: { userId: user.id } });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'nva-language', value: 'fr', url: base }]);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/login');
    await page.locator('#phoneNumber').fill(admin.phoneNumber); await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/admin/dashboard'), page.locator('form[action="/login"] button[type="submit"]').click()]);
    const results = [];
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, url] of [['list', '/admin/password-reset-requests?lang=fr'], ['detail', `/admin/password-reset-requests/${request.id}?lang=fr`]]) {
        const response = await page.goto(base + url); assert.equal(response.status(), 200);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${name} overflow at ${width}`);
        if (name === 'list' && width === 390) {
          const visibleRow = await page.getByRole('link', { name: `Voir #${request.id}`, exact: true }).boundingBox();
          assert.ok(visibleRow && visibleRow.x >= 0 && visibleRow.x + visibleRow.width <= width, 'Mobile row action must be visible without horizontal scrolling');
        }
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
        results.push({ name, width, overflow });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Rejeter', exact: true }).click();
    assert.equal((await prisma.passwordResetRequest.findUnique({ where: { id: request.id } })).status, 'PENDING');
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([page.waitForURL('**/admin/password-reset-requests/*?success=approved&lang=fr'), page.getByRole('button', { name: 'Approuver', exact: true }).click()]);
    assert.equal(await page.locator('form[data-admin-confirm]').count(), 0);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    await page.screenshot({ path: path.join(output, 'approved-1440.png'), fullPage: true });
    await page.goto(base + '/admin/password-reset-requests?lang=en');
    assert.equal(await page.getByRole('heading', { name: 'Password recovery requests', exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ layouts: results, rejectCancellation: true, approvalConfirmation: true, noToken: true, english: true, pageErrors: errors }, null, 2));
    console.log('UI_LAYOUTS_OK=6/6; CONFIRMATIONS_OK=2/2; ENGLISH_OK=1/1; PAGE_ERRORS=0');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await require('../src/config/sessionStore').closeSessionStore(); await prisma.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
