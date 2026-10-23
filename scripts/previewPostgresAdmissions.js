// Visual evidence against the dedicated test database; credentials stay in memory.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
process.chdir(path.resolve(__dirname, '..'));
for (const key of Object.keys(process.env)) if (/DATABASE_URL|^WHATSAPP_|^META_|^OPENAI_|^NVA_CHATBOT_|^SMTP_/i.test(key)) delete process.env[key];
Object.assign(process.env, { NODE_ENV: 'test', CSRF_ENFORCE: 'true', DATABASE_URL: 'postgresql://nva_validation_app@127.0.0.1:56432/nva_admissions_validation_v2?schema=public&sslmode=disable', WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false', NVA_CHATBOT_AI_ENABLED: 'false', SESSION_SECRET: crypto.randomBytes(48).toString('hex') });
global.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); };
let db, server, browser;
const results = [];
(async () => {
  db = require('../src/utils/prisma');
  const [i] = await db.$queryRaw`SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port`;
  assert.equal(i.db, 'nva_admissions_validation_v2'); assert.equal(i.host, '127.0.0.1'); assert.equal(i.port, 56432);
  const password = crypto.randomBytes(18).toString('hex') + 'Aa!7', phone = '+24389' + String(crypto.randomInt(1000000, 9999999));
  await db.user.create({ data: { firstName: 'Validation', lastName: 'Visuelle', phoneNumber: phone, passwordHash: await require('../src/services/passwordService').hashPassword(password), role: 'ADMIN' } });
  const request = await db.whatsAppAdmissionRequest.findFirstOrThrow({ where: { status: 'PENDING' }, orderBy: { id: 'desc' } });
  const app = require('../src/app'); server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await require('@playwright/test').chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === base ? route.continue() : route.abort(); });
    const page = await context.newPage(); await page.goto(base + '/login');
    await page.locator('[name="phoneNumber"]').fill(phone); await page.locator('[name="password"]').fill(password);
    await Promise.all([page.waitForURL('**/admin/dashboard'), page.locator('button[type="submit"]').click()]);
    for (const [name, url] of [['list', '/admin/whatsapp/admissions'], ['detail', '/admin/whatsapp/admissions/' + request.id], ['content', '/admin/whatsapp/admissions/content']]) {
      const response = await page.goto(base + url); assert.equal(response.status(), 200); await page.screenshot({ path: 'output/postgres-validation/' + name + '-' + width + '.png', fullPage: true });
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
      results.push({ page: name, width, horizontalOverflow: dimensions.scroll > dimensions.viewport }); assert.ok(dimensions.scroll <= dimensions.viewport, 'Horizontal overflow ' + name + ' ' + width);
      if (name === 'detail') assert.equal(await page.locator('input[name="confirm"]').isChecked(), false);
    }
    await context.close();
  }
})().catch(e => { results.push({ error: require('../src/services/loggerService').sanitizeString(e.message) }); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); if (server) await new Promise(r => server.close(r)); if (db) await db.$disconnect();
  const store = require.cache[require.resolve('../src/config/sessionStore')]; if (store) await store.exports.closeSessionStore();
  fs.writeFileSync('output/postgres-validation/visual-results.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify({ pages: results.length, errors: results.filter(r => r.error).length }));
});
