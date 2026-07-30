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

test('navigation et logo publics restent utilisables à 320 px', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    const response = await page.goto('/', { waitUntil: 'networkidle' });
    expect(response.status()).toBe(200);
    const navigation = page.locator('[data-public-navigation]');
    const toggle = page.locator('[data-menu-toggle]');
    await expect(navigation).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const logo = page.locator('.header-brand img');
    await expect(logo).toBeVisible();
    expect((await logo.boundingBox()).height).toBeGreaterThanOrEqual(32);
    await toggle.click();
    await expect(navigation).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});

test('le dashboard admin reste dégagé sous le header à toutes les largeurs cibles', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('/login');
    await page.locator('[name=phoneNumber]').fill(ACCOUNTS.ADMIN.phoneNumber);
    await page.locator('[name=password]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/admin/dashboard'),
      page.locator('button[type=submit]').click(),
    ]);

    for (const viewport of [
      { width: 1440, height: 900 }, { width: 1024, height: 768 },
      { width: 768, height: 1024 }, { width: 430, height: 932 },
      { width: 375, height: 812 }, { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/admin/dashboard', { waitUntil: 'networkidle' });
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.public-header').getBoundingClientRect();
        const navigation = document.querySelector('[data-admin-navigation]').getBoundingClientRect();
        const heading = document.querySelector('.dashboard-heading').getBoundingClientRect();
        return {
          mainCount: document.querySelectorAll('main').length,
          headerBottom: header.bottom,
          navigationTop: navigation.top,
          navigationBottom: navigation.bottom,
          headingTop: heading.top,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      expect(layout.mainCount).toBe(1);
      expect(layout.navigationTop).toBeGreaterThanOrEqual(layout.headerBottom + 12);
      expect(layout.headingTop).toBeGreaterThanOrEqual(layout.navigationBottom + 20);
      expect(layout.overflow).toBe(false);
      await expect(page.locator('.header-brand img')).toBeVisible();
      await expect(page.locator('[data-menu-toggle]')).toHaveAttribute('aria-expanded', 'false');
    }
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});
