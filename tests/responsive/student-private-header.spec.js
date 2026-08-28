const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs/promises');
const { prepare, ACCOUNTS, PASSWORD } = require('../../scripts/prepareResponsiveAudit');

test('le header étudiant remplace le header public à toutes les largeurs cibles', async () => {
  test.setTimeout(180_000);
  await prepare();
  const output = 'audit-output/student-private-header';
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('/login');
    await page.locator('[name=phoneNumber]').fill(ACCOUNTS.STUDENT.phoneNumber);
    await page.locator('[name=password]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/student'),
      page.locator('button[type=submit]').click(),
    ]);

    for (const viewport of [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'laptop-1024', width: 1024, height: 768 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-390', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const response = await page.goto('/student', { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      await expect(page.locator('.student-header')).toHaveCount(1);
      await expect(page.locator('[data-public-header]')).toHaveCount(0);
      await expect(page.locator('.student-brand img')).toBeVisible();
      await expect(page.locator('.student-account')).toBeVisible();
      await expect(page.locator('.student-nav a[href="/student"]')).toHaveAttribute('aria-current', 'page');
      if (viewport.width <= 768) {
        const toggle = page.locator('[data-student-menu-toggle]');
        await expect(page.locator('.student-nav')).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(page.locator('.student-nav')).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('.student-nav')).toBeHidden();
        await expect(toggle).toBeFocused();
      } else {
        await expect(page.locator('.student-nav')).toBeVisible();
      }
      const layout = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        mainCount: document.querySelectorAll('main').length,
      }));
      expect(layout.horizontalOverflow).toBe(false);
      expect(layout.mainCount).toBe(1);
      if (viewport.width === 390 || viewport.width === 1440) {
        if (viewport.width === 390) await page.locator('[data-student-menu-toggle]').click();
        await page.screenshot({ path: `${output}/student-${viewport.name}.png`, fullPage: true });
      }
    }

    const studentRoutes = [
      { route: '/student', active: '/student', capture: 'dashboard' },
      { route: '/student/courses', active: '/student/courses', capture: 'courses' },
      { route: '/student/schedule', active: '/student/schedule' },
      { route: '/student/payments', active: '/student/payments', capture: 'payments' },
      { route: '/student/assignments', active: '/student/assignments' },
      { route: '/student/certificates', active: '/student/certificates' },
      { route: '/student/profile', active: '/student/profile', capture: 'profile' },
      { route: '/student/oral-assessments', active: '/student/oral-assessments' },
      { route: '/student/written-assessments' },
      { route: '/student/live-oral-sessions' },
      { route: '/student/academic' },
      { route: '/student/finances' },
    ];
    for (const { route, active, capture } of studentRoutes) {
      await page.setViewportSize({ width: 1440, height: 900 });
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      if (active) await expect(page.locator(`.student-nav a[href="${active}"]`)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-public-header]')).toHaveCount(0);
      await expect(page.locator('.student-header')).toHaveCount(1);
      await expect(page.locator('.student-account form[action="/logout"] button')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      if (capture) await page.screenshot({ path: `${output}/student-${capture}-1440.png`, fullPage: true });
    }
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});

test('les pages publiques conservent leur header public', async ({ page }) => {
  for (const route of ['/', '/formations', '/login', '/register']) {
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response.status()).toBe(200);
    await expect(page.locator('[data-public-header]')).toHaveCount(1);
    await expect(page.locator('.student-header')).toHaveCount(0);
  }
});

test('la déconnexion étudiant détruit la session et restaure le header public', async () => {
  test.setTimeout(180_000);
  await prepare();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const viewport of [
      { width: 390, height: 844 }, { width: 768, height: 1024 },
      { width: 1024, height: 768 }, { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('[name=phoneNumber]').fill(ACCOUNTS.STUDENT.phoneNumber);
      await page.locator('[name=password]').fill(PASSWORD);
      await Promise.all([
        page.waitForURL((url) => url.pathname === '/student'),
        page.locator('button[type=submit]').click(),
      ]);

      await expect(page.locator('[data-public-header]')).toHaveCount(0);
      await expect(page.locator('.student-header')).toHaveCount(1);
      if (viewport.width <= 768) {
        await page.locator('[data-student-menu-toggle]').click();
        await expect(page.locator('.student-mobile-logout button')).toBeVisible();
        await Promise.all([
          page.waitForURL((url) => url.pathname === '/login'),
          page.locator('.student-mobile-logout button').click(),
        ]);
      } else {
        await expect(page.locator('.student-account form button')).toBeVisible();
        await Promise.all([
          page.waitForURL((url) => url.pathname === '/login'),
          page.locator('.student-account form button').click(),
        ]);
      }

      await expect(page.locator('[data-public-header]')).toHaveCount(1);
      await expect(page.locator('.student-header')).toHaveCount(0);
      const protectedResponse = await page.goto('/student', { waitUntil: 'networkidle' });
      expect(protectedResponse.status()).toBe(200);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator('[data-public-header]')).toHaveCount(1);
      await context.close();
    }
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});

test('les navigations Teacher et Admin restent inchangées', async () => {
  await prepare();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const role of ['TEACHER', 'ADMIN']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('[name=phoneNumber]').fill(ACCOUNTS[role].phoneNumber);
      await page.locator('[name=password]').fill(PASSWORD);
      await Promise.all([
        page.waitForURL((url) => role === 'ADMIN' ? url.pathname === '/admin/dashboard' : url.pathname === '/teacher'),
        page.locator('button[type=submit]').click(),
      ]);
      await expect(page.locator('.admin-nav')).toHaveCount(1);
      await expect(page.locator('.student-header')).toHaveCount(0);
      await context.close();
    }
  } finally {
    await browser.close();
    await require('../../src/utils/prisma').$disconnect();
  }
});
