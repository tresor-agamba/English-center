const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs/promises');
const { ACCOUNTS, PASSWORD } = require('../../scripts/prepareResponsiveAudit');

const CASES = {
  PUBLIC: ['/', '/login'],
  ADMIN: ['/admin/dashboard', '/admin/reports', '/admin/certificates'],
  TEACHER: ['/teacher'],
  STUDENT: ['/student', '/student/courses'],
};
const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 568 },
];

test('captures visuelles représentatives', async () => {
  test.setTimeout(180_000);
  const output = 'audit-output/responsive/screenshots';
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [role, routes] of Object.entries(CASES)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (role !== 'PUBLIC') {
        await page.goto('/login');
        await page.locator('[name=phoneNumber]').fill(ACCOUNTS[role].phoneNumber);
        await page.locator('[name=password]').fill(PASSWORD);
        await Promise.all([
          page.waitForURL((url) => !url.pathname.endsWith('/login')),
          page.locator('button[type=submit]').click(),
        ]);
      }
      for (const route of routes) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          const response = await page.goto(route, { waitUntil: 'networkidle' });
          expect(response.status()).toBe(200);
          const name = route.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home';
          await page.screenshot({ path: `${output}/${role}-${name}-${viewport.name}.png`, fullPage: true });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});
