const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

test.use({ channel: 'msedge' });
test.describe.serial('Structures de formation : formulaires et mobile', () => {
  test.setTimeout(60000);
  let prisma, admin, simple, levels, session;
  const ids = [];
  const password = 'StructureMobile2026!';
  test.beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
    prisma = new PrismaClient();
    const key = `${Date.now()}-${process.pid}`;
    admin = await prisma.user.create({ data: {
      firstName: 'Admin', lastName: 'Structure mobile', role: 'ADMIN',
      phoneNumber: `+24385${String(Date.now()).slice(-7)}`,
      passwordHash: await require('../../src/services/passwordService').hashPassword(password),
    } });
    const common = { courseType: 'OTHER', level: '', currency: 'USD', durationUnit: 'HOURS',
      accessPolicy: 'FULL_PAYMENT', pricingMode: 'ONE_TIME', pricingActive: true,
      shortDescription: 'Une formation pratique en ligne.', isPublished: true, lmsStatus: 'PUBLISHED' };
    simple = await prisma.course.create({ data: { ...common, title: 'Excel pratique mobile',
      slug: `excel-mobile-${key}`, structureType: 'SIMPLE', price: '40', durationValue: 12, sessionCount: 8 } });
    ids.push(simple.id);
    levels = await prisma.course.create({ data: { ...common, title: 'Anglais général mobile',
      slug: `anglais-mobile-${key}`, structureType: 'LEVEL_BASED', numberOfLevels: 3,
      price: '60', durationValue: 24, sessionCount: 16 } });
    ids.push(levels.id);
    session = await prisma.trainingSession.create({ data: { courseId: levels.id, levelNumber: 1,
      name: 'Niveau 1 — prochaine session', status: 'OPEN', capacity: 20,
      startDate: new Date(Date.now() + 864000000), endDate: new Date(Date.now() + 8640000000),
      registrationDeadline: new Date(Date.now() + 432000000),
      platform: 'Zoom', startTime: '10:00', endTime: '11:30', weekDays: ['MONDAY'] } });
  });
  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    if (admin) await prisma.user.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  });

  test('Admin : libellés, aperçu, bascule SIMPLE et sauvegarde LEVEL_BASED', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[name=phoneNumber]').fill(admin.phoneNumber);
    await page.locator('[name=password]').fill(password);
    await Promise.all([page.waitForURL(url => !url.pathname.endsWith('/login')), page.locator('button[type=submit]').click()]);
    await page.goto(`/admin/courses/${levels.id}/edit`);
    const preview = page.locator('[data-structure-preview]');
    await expect(preview).toContainText('3 niveaux');
    await expect(preview).toContainText('48 séances');
    await expect(preview).toContainText('72 heures');
    await expect(preview).toContainText('180.00 USD');
    await page.locator('#structureType').selectOption('SIMPLE');
    await expect(page.locator('label[for=price]')).toHaveText('Prix de la formation');
    await expect(page.locator('#numberOfLevels')).toBeDisabled();
    await expect(preview).toBeHidden();
    await page.locator('#structureType').selectOption('LEVEL_BASED');
    await expect(page.locator('label[for=price]')).toHaveText('Prix par niveau');
    await expect(page.locator('#numberOfLevels')).toBeEnabled();
    await page.locator('#numberOfLevels').fill('4');
    await expect(preview).toContainText('240.00 USD');
    await page.locator('#numberOfLevels').fill('3');
    await Promise.all([page.waitForURL(url => url.searchParams.get('updated') === '1'), page.locator('.course-admin-form button[type=submit]').click()]);
    levels = await prisma.course.findUniqueOrThrow({ where: { id: levels.id } });
    expect(levels.numberOfLevels).toBe(3);
  });

  for (const width of [320, 390, 768, 1440]) {
    test(`Public : deux structures et inscription à ${width}px`, async ({ page, context }) => {
      await context.addCookies([{ name: 'nva-language', value: 'fr', url: test.info().project.use.baseURL }]);
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const route of ['/formations', `/formations/${simple.slug}`, `/formations/${levels.slug}`, `/register?session=${session.id}`]) {
        expect((await page.goto(route, { waitUntil: 'networkidle' })).status(), route).toBe(200);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route).toBe(true);
        if (route.endsWith(levels.slug)) {
          await expect(page.locator('.course-structure-summary')).toContainText('48');
          await expect(page.locator('.course-structure-summary')).toContainText('72');
          await expect(page.locator('.course-structure-summary')).toContainText('Le paiement s’effectue niveau par niveau.');
          await expect(page.locator('.course-price-line [data-amount]')).toHaveAttribute('data-amount', '60');
        } else if (route.endsWith(simple.slug)) {
          await expect(page.locator('.course-detail-page')).not.toContainText('/ niveau');
          await expect(page.locator('.course-price-line [data-amount]')).toHaveAttribute('data-amount', '40');
        } else if (route.startsWith('/register')) {
          await expect(page.locator('[name=courseId]')).toHaveAttribute('data-price', '60');
          await expect(page.locator('[name=requestedLevel]')).toHaveValue('LEVEL_1');
        }
        if (width === 390 && route.endsWith(levels.slug)) await page.screenshot({ path: 'test-results/course-structure-mobile.png', fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
});
