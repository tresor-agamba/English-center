const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

test.use({ channel: 'msedge' });
test.describe.serial('Public course presentation from published PostgreSQL records', () => {
  let prisma, courses, simple, levels, draft, session;
  const ids = [];
  test.beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.match(new URL(process.env.DATABASE_URL).pathname, /[_-]test(?:$|[_-])/);
    prisma = require('../../src/utils/prisma');
    courses = require('../../src/services/courseService');
    const common = { courseType: 'GENERAL_ENGLISH', currency: 'USD', durationUnit: 'HOURS',
      accessPolicy: 'FULL_PAYMENT', pricingMode: 'ONE_TIME', pricingActive: true,
      trainingMode: 'En ligne', shortDescription: 'Une formation pratique en ligne.' };
    async function create(data) {
      const course = await courses.create({ ...common, ...data, slug: `public-presentation-${ids.length}-${Date.now()}-${process.pid}` });
      ids.push(course.id);
      return course;
    }
    simple = await create({ title: 'Excel Pratique', structureType: 'SIMPLE', price: '40', durationValue: 12, sessionCount: 8 });
    levels = await create({ title: 'Anglais Général', structureType: 'LEVEL_BASED', numberOfLevels: 3, price: '60', durationValue: 24, sessionCount: 16 });
    draft = await create({ title: 'Brouillon invisible', structureType: 'LEVEL_BASED', numberOfLevels: 3, price: '60', durationValue: 24, sessionCount: 16 });
    await courses.publish(simple.id);
    await courses.publish(levels.id);
    session = await prisma.trainingSession.create({ data: { courseId: levels.id, levelNumber: 1,
      name: 'Prochain niveau 1', status: 'OPEN', capacity: 20,
      startDate: new Date(Date.now() + 864000000), endDate: new Date(Date.now() + 8640000000),
      registrationDeadline: new Date(Date.now() + 432000000) } });
    const service = require('../../src/services/publicCourseService');
    const list = await service.listPublished();
    const detail = await service.findPublishedBySlug(levels.slug);
    for (const row of [list.find(c => c.id === levels.id), detail]) {
      assert.equal(row.structureType, 'LEVEL_BASED');
      assert.equal(row.numberOfLevels, 3);
      assert.equal(Number(row.price), 60);
      assert.equal(row.currency, 'USD');
      assert.equal(row.durationValue, 24);
      assert.equal(row.durationUnit, 'HOURS');
      assert.equal(row.sessionCount, 16);
    }
    assert.ok(!list.some(c => c.id === draft.id));
    assert.equal(await service.findPublishedBySlug(draft.slug), null);
  });
  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  for (const language of ['fr', 'en']) for (const width of [320, 390, 768, 1440]) {
    test(`${language} at ${width}px: list, detail, registration and hidden draft`, async ({ page, context }) => {
      await context.addCookies([{ name: 'nva-language', value: language, url: test.info().project.use.baseURL }]);
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const perLevel = language === 'fr' ? '/ niveau' : '/ level';
      const sessions = language === 'fr' ? 'séances' : 'sessions';
      const hours = language === 'fr' ? 'heures' : 'hours';
      const levelsLabel = language === 'fr' ? 'niveaux' : 'levels';
      const price = amount => language === 'fr' ? new RegExp(`${amount}\\s+USD`) : new RegExp(`USD\\s*${amount}`);
      async function visit(route) {
        expect((await page.goto(route, { waitUntil: 'networkidle' })).status()).toBe(200);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      await visit('/formations');
      const card = page.locator('[data-public-course-card]').filter({ has: page.locator(`a[href="/formations/${levels.slug}"]`) });
      await expect(card).toBeVisible();
      for (const text of [`3 ${levelsLabel}`, `48 ${sessions}`, `72 ${hours}`, `24 ${hours} ${perLevel}`, `16 ${sessions} ${perLevel}`]) await expect(card).toContainText(text);
      await expect(card.locator('dd').filter({ has: page.locator('[data-amount="60"]') })).toContainText(perLevel);
      await expect(card.locator('[data-amount="60"]')).toHaveText(price(60));
      const simpleCard = page.locator('[data-public-course-card]').filter({ has: page.locator(`a[href="/formations/${simple.slug}"]`) });
      await expect(simpleCard).toContainText(`12 ${hours}`);
      await expect(simpleCard).toContainText(`8 ${sessions}`);
      await expect(simpleCard.locator('[data-amount="40"]')).toHaveText(price(40));
      await expect(simpleCard).not.toContainText(perLevel);
      await expect(page.locator(`a[href="/formations/${draft.slug}"]`)).toHaveCount(0);
      if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/public-course-list-${language}-${width}.png`, fullPage: true });
      await visit(`/formations/${levels.slug}`);
      const summary = page.locator('.course-structure-summary');
      for (const text of [`3 ${levelsLabel}`, `48 ${sessions}`, `72 ${hours}`]) await expect(summary).toContainText(text);
      await expect(summary).toContainText(language === 'fr' ? 'Prix total indicatif' : 'Indicative total price');
      await expect(summary).toContainText(language === 'fr' ? 'Le paiement s’effectue niveau par niveau.' : 'Payment is made one level at a time.');
      await expect(summary.locator('[data-amount="180"]')).toHaveText(price(180));
      const panel = page.locator('.course-enrolment-panel');
      await expect(panel.locator('.course-price-line')).toContainText(perLevel);
      await expect(panel.locator('[data-amount="60"]')).toHaveText(price(60));
      await expect(panel).toContainText(`24 ${hours} ${perLevel}`);
      await expect(panel).toContainText(`16 ${sessions} ${perLevel}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/public-course-detail-${language}-${width}.png`, fullPage: true });
      await visit(`/formations/${simple.slug}`);
      await expect(page.locator('.course-detail-page')).not.toContainText(perLevel);
      await expect(page.locator('.course-structure-summary')).toContainText(`12 ${hours}`);
      await expect(page.locator('.course-structure-summary')).toContainText(`8 ${sessions}`);
      await expect(page.locator('.course-price-line [data-amount="40"]')).toHaveText(price(40));
      await visit(`/register?session=${session.id}`);
      await expect(page.locator('[name=courseId]')).toHaveAttribute('data-price', '60');
      expect((await page.goto(`/formations/${draft.slug}`)).status()).toBe(404);
      expect(errors).toEqual([]);
    });
  }

  test('language switching preserves per-level suffixes and programme totals', async ({ page }) => {
    for (const route of ['/formations', `/formations/${levels.slug}`]) {
      await page.goto(`${route}?lang=fr`);
      for (const language of ['en', 'fr', 'en']) {
        await page.locator(`[data-language="${language}"]`).first().click();
        const scope = route === '/formations'
          ? page.locator('[data-public-course-card]').filter({ has: page.locator(`a[href="/formations/${levels.slug}"]`) })
          : page.locator('.course-detail-page');
        await expect(scope).toContainText(language === 'fr' ? '/ niveau' : '/ level');
        await expect(scope).toContainText(language === 'fr' ? '72 heures' : '72 hours');
      }
    }
  });

  test('republishing exposes updated values immediately on both public routes', async ({ page }) => {
    await courses.unpublish(levels.id);
    await page.goto('/formations');
    await expect(page.locator(`a[href="/formations/${levels.slug}"]`)).toHaveCount(0);
    expect((await page.goto(`/formations/${levels.slug}`)).status()).toBe(404);
    await courses.update(levels.id, { price: '65', durationValue: 25, sessionCount: 17 });
    await courses.publish(levels.id);
    for (const route of ['/formations', `/formations/${levels.slug}`]) {
      expect((await page.goto(`${route}?lang=fr`)).status()).toBe(200);
      const scope = route === '/formations'
        ? page.locator('[data-public-course-card]').filter({ has: page.locator(`a[href="/formations/${levels.slug}"]`) })
        : page.locator('.course-detail-page');
      await expect(scope).toContainText('51 séances');
      await expect(scope).toContainText('75 heures');
      await expect(scope.locator('[data-amount="65"]').first()).toBeVisible();
    }
  });
});
