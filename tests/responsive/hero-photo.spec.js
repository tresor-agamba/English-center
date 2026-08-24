const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

test.afterAll(async () => {
  await require('../../src/utils/prisma').$disconnect();
});

const VIEWPORTS = [
  [1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024],
  [640, 900], [430, 932], [390, 844], [375, 812], [320, 568],
];

test('photo du Hero nette, cadree et sans debordement', async ({ page }) => {
  await fs.mkdir('audit-output/hero-photo', { recursive: true });
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'networkidle' });
    const hero = page.locator('.stitch-hero');
    const image = page.locator('.stitch-hero-media img');
    await expect(hero).toBeVisible();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('alt', '');
    const metrics = await image.evaluate((element) => ({
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      fit: getComputedStyle(element).objectFit,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(metrics.complete).toBe(true);
    expect(metrics.naturalWidth).toBe(1280);
    expect(metrics.naturalHeight).toBe(853);
    expect(metrics.fit).toBe('cover');
    expect(metrics.horizontalOverflow).toBe(false);
    await expect(page.locator('.hero-actions')).toBeVisible();
    await page.screenshot({ path: `audit-output/hero-photo/home-${width}.png`, fullPage: false });
    if ([1440, 1024, 768, 390, 320].includes(width)) {
      await hero.screenshot({ path: `audit-output/hero-photo/hero-${width}.png` });
    }
  }
});
