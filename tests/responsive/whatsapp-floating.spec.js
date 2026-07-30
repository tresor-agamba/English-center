const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');

test.afterAll(async () => {
  await require('../../src/utils/prisma').$disconnect();
});

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-320', width: 320, height: 568 },
];

test('bouton WhatsApp public visible, localisé et sans débordement', async ({ page }) => {
  const output = 'audit-output/whatsapp-floating';
  await fs.mkdir(output, { recursive: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.GLI_I18N.applyLanguage('en'));

    const contact = page.locator('[data-whatsapp-contact]');
    const link = page.locator('[data-whatsapp-link]');
    await expect(contact).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/243899999999\?text=/);
    await expect(link).toHaveAttribute('aria-label', 'Chat with an advisor on WhatsApp');

    const box = await link.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.evaluate(() => window.GLI_I18N.applyLanguage('fr'));
    await expect(link).toHaveAttribute('aria-label', 'Parler à un conseiller sur WhatsApp');
    const frenchHref = await link.getAttribute('href');
    expect(decodeURIComponent(frenchHref)).toContain('Bonjour, je souhaite obtenir des informations');

    await link.focus();
    await expect(link).toBeFocused();
    await page.screenshot({ path: `${output}/home-${viewport.name}.png`, fullPage: true });
  }
});

test('le bouton ne masque pas les champs du formulaire mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/register', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-whatsapp-contact]')).toBeVisible();
  expect(await page.evaluate(() => {
    const button = document.querySelector('[data-whatsapp-link]').getBoundingClientRect();
    return [...document.querySelectorAll('button[type="submit"], .button')].every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom <= button.top || rect.top >= button.bottom || rect.right <= button.left || rect.left >= button.right;
    });
  })).toBe(true);
});
