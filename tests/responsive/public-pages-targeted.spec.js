const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');

const VIEWPORTS = [1920, 1440, 1366, 1280, 1024, 768, 640, 430, 412, 390, 375, 360, 320];

async function inspectOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const elements = [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join('')}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        position: style.position,
        overflowX: style.overflowX,
        transform: style.transform,
      };
    });
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflow: root.scrollWidth > root.clientWidth + 1,
      internalOverflow: elements.filter((item) => item.scrollWidth > item.clientWidth + 1),
      viewportOffenders: elements.filter((item) => item.left < -1 || item.right > innerWidth + 1),
    };
  });
}

test('pages publiques ciblées sans débordement ni identifiants dupliqués', async ({ page }) => {
  test.setTimeout(180_000);
  await fs.mkdir('test-results/public-pages', { recursive: true });
  const audit = [];
  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: width <= 640 ? 900 : 1000 });
    for (const route of ['/', '/formations', '/register', '/login']) {
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      const result = await inspectOverflow(page);
      audit.push({ route, width, ...result });
      expect(result.overflow, `${route} ${width}: ${JSON.stringify(result, null, 2)}`).toBe(false);
      const decorativeOffenders = result.viewportOffenders.filter((item) =>
        /hero|visual|orbit|spark/.test(item.selector)
      );
      expect(decorativeOffenders, `${route} ${width}`).toEqual([]);
      if (route === '/register') {
        await page.locator('[name="courseId"]').evaluate((select) => {
          const option = new Option('Formation professionnelle intensive avec un intitulé volontairement très long pour les écrans mobiles', 'long-title');
          select.add(option); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const selectFits = await page.locator('[name="courseId"]').evaluate((select) => select.getBoundingClientRect().right <= innerWidth + 1 && select.scrollWidth <= select.parentElement.clientWidth + 1);
        expect(selectFits, `/register long select ${width}`).toBe(true);
      }
      if ((route === '/' && [1440, 1024, 768, 640, 390, 320].includes(width)) ||
          (route === '/formations' && [1440, 640, 390].includes(width))) {
        await page.screenshot({
          path: `test-results/public-pages/${route === '/' ? 'home' : 'formations'}-${width}.png`,
          fullPage: true,
        });
      }
      if (route === '/register' && [1440, 390].includes(width)) {
        await page.screenshot({ path: `test-results/public-pages/register-${width}.png`, fullPage: true });
        await expect(page.locator('[name="courseId"]')).toBeVisible();
        await expect(page.locator('[name="passwordConfirmation"]')).toBeVisible();
        await expect(page.locator('[name="learningObjective"]')).toBeVisible();
      }
      if (route === '/login') {
        const password = page.locator('[name="password"]'); const toggle = page.locator('[data-password-toggle]');
        await expect(toggle).toBeVisible(); await password.fill('test-secret'); await toggle.click();
        await expect(password).toHaveAttribute('type', 'text'); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await toggle.press('Enter'); await expect(password).toHaveAttribute('type', 'password');
        if ([1440, 390].includes(width)) await page.screenshot({ path: `test-results/public-pages/login-${width}.png`, fullPage: true });
      }
    }
  }
  await fs.writeFile('test-results/public-pages/overflow-audit.json', JSON.stringify(audit, null, 2));
});
