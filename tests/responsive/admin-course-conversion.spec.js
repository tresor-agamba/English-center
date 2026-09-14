const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

test.use({ channel: 'msedge' });
test.describe.serial('Conversion administrative SIMPLE vers LEVEL_BASED', () => {
  let prisma, server, base, admin, student;
  const ids = [], samples = {}, trace = [], restore = [];
  const password = 'ConversionLocal2026!';
  const fields = ['structureType', 'numberOfLevels', 'sessionCount', 'price', 'durationValue'];
  const pick = data => Object.fromEntries(fields.map(key => [key, data[key]]));
  test.beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.match(new URL(process.env.DATABASE_URL).pathname, /[_-]test(?:$|[_-])/);
    prisma = require('../../src/utils/prisma');
    // Test-process instrumentation only: observe real Express and Prisma calls.
    const controller = require('../../src/controllers/adminCourseController');
    const service = require('../../src/services/courseService');
    const originalController = controller.update;
    restore.push(() => { controller.update = originalController; });
    controller.update = async (req, res) => {
      trace.push({ stage: 'req.body', method: req.method, path: req.originalUrl, ...pick(req.body) });
      return originalController(req, res);
    };
    const originalUpdate = service.update;
    restore.push(() => { service.update = originalUpdate; });
    service.update = async (id, data) => {
      trace.push({ stage: 'parseForm -> courseService.update', ...pick(data) });
      return originalUpdate(id, data);
    };
    const transaction = prisma.$transaction.bind(prisma);
    restore.push(() => { prisma.$transaction = transaction; });
    prisma.$transaction = (callback, options) => transaction(async tx => {
      const update = tx.course.update.bind(tx.course);
      tx.course.update = args => {
        trace.push({ stage: 'prisma.course.update', ...pick(args.data) });
        return update(args);
      };
      return callback(tx);
    }, options);
    const app = require('../../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const key = `${Date.now()}-${process.pid}`;
    const hash = await require('../../src/services/passwordService').hashPassword(password);
    admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Conversion', role: 'ADMIN', phoneNumber: `+24383${String(Date.now()).slice(-7)}`, passwordHash: hash } });
    student = await prisma.user.create({ data: { firstName: 'Student', lastName: 'Conversion', phoneNumber: `+24384${String(Date.now()).slice(-7)}`, passwordHash: hash } });
    for (const kind of ['empty', 'session', 'enrollment', 'cohort']) {
      const course = await prisma.course.create({ data: { title: 'Anglais général', slug: `conversion-${kind}-${key}`,
        structureType: 'SIMPLE', numberOfLevels: null, sessionCount: null, accessPolicy: 'LEGACY_STAGED',
        price: '60', durationValue: 24, durationUnit: 'HOURS', currency: 'USD', courseType: 'GENERAL_ENGLISH',
        shortDescription: 'Formation historique de contrôle.', pricingMode: 'ONE_TIME', pricingActive: true } });
      ids.push(course.id); samples[kind] = course;
      if (['session', 'enrollment'].includes(kind)) {
        const session = await prisma.trainingSession.create({ data: { courseId: course.id, name: 'Session historique sans niveau',
          startDate: new Date('2026-10-01'), endDate: new Date('2026-11-01'), registrationDeadline: new Date('2026-09-30'), capacity: 20 } });
        if (kind === 'enrollment') await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: session.id } });
      }
      if (kind === 'cohort') await prisma.academicCohort.create({ data: { courseId: course.id, name: 'Cohorte historique', code: key,
        level: 'LEVEL_1', startDate: new Date('2026-10-01'), endDate: new Date('2026-11-01'), capacity: 20 } });
    }
  });
  test.afterAll(async () => {
    if (prisma) {
      await prisma.academicCohort.deleteMany({ where: { courseId: { in: ids } } });
      await prisma.course.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin?.id, student?.id].filter(Boolean) } } });
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (prisma) await prisma.$disconnect();
    restore.forEach(fn => fn());
  });

  // This suite uses an instrumented app; keep the shared responsive server
  // available for subsequent suites despite its short idle timeout.
  test.beforeEach(async ({ request }) => {
    expect((await request.get('/health')).status()).toBe(200);
  });

  for (const kind of ['empty', 'session', 'enrollment', 'cohort']) test(`sauvegarde réelle : ${kind}`, async ({ page }) => {
    if (kind === 'session') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/login`);
    await page.locator('[name=phoneNumber]').fill(admin.phoneNumber);
    await page.locator('[name=password]').fill(password);
    await Promise.all([page.waitForURL(url => !url.pathname.endsWith('/login')), page.locator('button[type=submit]').click()]);
    const course = samples[kind];
    await page.goto(`${base}/admin/courses/${course.id}/edit`);
    await expect(page.locator('#numberOfLevels')).toBeDisabled();
    await page.locator('#structureType').selectOption('LEVEL_BASED');
    await page.locator('#numberOfLevels').fill('3');
    await page.locator('#sessionCount').fill('16');
    for (const name of fields) await expect(page.locator(`[name=${name}]`)).toBeEnabled();
    const form = page.locator('.course-admin-form');
    expect(await form.getAttribute('method')).toBe('post');
    expect(await form.getAttribute('action')).toBe(`/admin/courses/${course.id}`);
    trace.length = 0;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${base}/admin/courses/${course.id}`),
      form.locator('button[type=submit]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    const body = new URLSearchParams(response.request().postData());
    expect(Object.fromEntries(fields.map(key => [key, body.get(key)]))).toEqual({ structureType: 'LEVEL_BASED', numberOfLevels: '3', sessionCount: '16', price: '60', durationValue: '24' });
    expect(trace[0]).toMatchObject({ stage: 'req.body', structureType: 'LEVEL_BASED', numberOfLevels: '3', sessionCount: '16' });
    expect(trace[1]).toMatchObject({ stage: 'parseForm -> courseService.update', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16 });
    const [row] = await prisma.$queryRaw`SELECT structure_type, number_of_levels, session_count, price, duration_value FROM courses WHERE id = ${course.id}`;
    if (kind === 'empty') {
      expect(response.status()).toBe(302);
      expect(trace[2]).toMatchObject({ stage: 'prisma.course.update', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16 });
      expect(row).toMatchObject({ structure_type: 'LEVEL_BASED', number_of_levels: 3, session_count: 16, duration_value: 24 });
      expect(Number(row.price)).toBe(60);
      await expect(page.locator('.success-message')).toBeVisible();
      await page.reload();
      await expect(page.locator('#structureType')).toHaveValue('LEVEL_BASED');
    } else {
      expect(response.status()).toBe(400);
      expect(trace).toHaveLength(2);
      expect(row).toMatchObject({ structure_type: 'SIMPLE', number_of_levels: null, session_count: null, duration_value: 24 });
      expect(Number(row.price)).toBe(60);
      await expect(form.locator('[role=alert]')).toBeVisible();
      await expect(form.locator('[role=alert]')).toBeFocused();
      await expect(form.locator('[role=alert]')).toBeInViewport();
      await expect(form.locator('[role=alert]')).toContainText('Modifications non enregistrées.');
      await expect(form.locator('[role=alert]')).toContainText('Modification refusée');
      await expect(form.locator('[role=alert]')).toContainText('Créez une nouvelle formation');
      if (kind === 'session') await expect(form.locator('[role=alert]')).toContainText('Session historique sans niveau');
      if (kind === 'session') await page.screenshot({ path: 'test-results/admin-course-conversion-error-mobile.png' });
      await expect(page.locator('.success-message')).toHaveCount(0);
      await expect(page.locator('#structureType')).toHaveValue('LEVEL_BASED');
      console.log('REFUS_REPRODUIT', kind, await form.locator('[role=alert]').innerText());
    }
    console.log('TRACE_CONVERSION', JSON.stringify({ kind, status: response.status(), trace, postgres: row }));
  });
});
