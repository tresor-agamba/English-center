const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs/promises');
const { prepare, ACCOUNTS, PASSWORD } = require('../../scripts/prepareResponsiveAudit');

const CASES = {
  PUBLIC: ['/', '/about', '/contact', '/login'],
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

test('la FAQ publique reste accessible au clavier et sans débordement', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const response = await page.goto('/', { waitUntil: 'networkidle' });
  expect(response.status()).toBe(200);
  const catalogue = page.locator('.catalogue-card');
  await expect(catalogue).toBeVisible();
  await expect(catalogue).toHaveAttribute('href', '/formations');
  await catalogue.focus();
  await expect(catalogue).toBeFocused();
  await expect(page.locator('.stitch-final-cta')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('le dashboard admin reste dégagé sous le header à toutes les largeurs cibles', async () => {
  await prepare();
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

test('diagnostic DOM réel de la navigation admin et captures de validation', async () => {
  test.setTimeout(180_000);
  await prepare();
  const output = 'audit-output/admin-header-fix';
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const diagnostics = [];
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
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'laptop-1024', width: 1024, height: 768 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-430', width: 430, height: 932 },
      { name: 'mobile-375', width: 375, height: 812 },
      { name: 'mobile-320', width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/admin/dashboard', { waitUntil: 'networkidle' });
      const result = await page.evaluate(() => {
        const nav = document.querySelector('[data-admin-navigation]');
        const parent = nav.parentElement;
        const style = getComputedStyle(nav);
        const rect = nav.getBoundingClientRect();
        const visibleOverflow = [...document.querySelectorAll('body *')]
          .filter((element) => {
            const computed = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return computed.visibility !== 'hidden' && computed.display !== 'none' && box.width > 2 && box.height > 2
              && element.scrollWidth > element.clientWidth + 1;
          })
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: String(element.className).slice(0, 120),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowX: getComputedStyle(element).overflowX,
          }));
        return {
          tag: nav.tagName.toLowerCase(),
          className: nav.className,
          parent: `${parent.tagName.toLowerCase()}.${parent.className.trim().replace(/\s+/g, '.')}`,
          linkCount: nav.querySelectorAll('a').length,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          display: style.display,
          position: style.position,
          overflowX: style.overflowX,
          marginTop: style.marginTop,
          padding: style.padding,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          visibleOverflow,
          unexpectedScrollers: visibleOverflow.filter((element) => ['auto', 'scroll'].includes(element.overflowX)),
        };
      });
      diagnostics.push({ viewport, ...result });
      expect(result.linkCount).toBeGreaterThan(10);
      expect(result.display).toBe('flex');
      expect(result.overflowX).toBe('visible');
      expect(result.documentScrollWidth).toBeLessThanOrEqual(result.documentClientWidth);
      expect(result.unexpectedScrollers).toEqual([]);
      await page.screenshot({ path: `${output}/admin-dashboard-${viewport.name}.png`, fullPage: true });
    }
    await fs.writeFile(`${output}/dom-diagnostics.json`, JSON.stringify(diagnostics, null, 2));
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});
