const { test, expect, devices } = require('@playwright/test');

test('manifest, métadonnées et page offline sont accessibles', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'Vous êtes hors connexion.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('un formulaire hors connexion n’est pas soumis', async ({ page, context }) => {
  await page.goto('/login');
  await context.setOffline(true);
  await page.locator('input[name="phoneNumber"]').fill('+243000000000');
  await page.locator('input[name="password"]').fill('mot-de-passe');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await expect(page.locator('[data-pwa-messages]')).toContainText('nécessite une connexion Internet');
  await context.setOffline(false);
});

test.describe('mobile Chromium', () => {
  const { defaultBrowserType, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);
  test('l’interface PWA reste utilisable sur mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('[data-pwa-install]')).toBeHidden();
  });
});

test('le mode standalone simulé est détecté', async ({ page }) => {
  await page.emulateMedia({ media: 'screen' });
  await page.addInitScript(() => {
    const original = window.matchMedia;
    window.matchMedia = (query) => query === '(display-mode: standalone)'
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }
      : original(query);
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);
});

test('le bouton apparaît seulement lorsque Chromium propose l’installation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await expect(page.locator('[data-pwa-install]')).toBeVisible();
});
