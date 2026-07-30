const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');

const app = require('../src/app');
const { normalizePublicWhatsAppNumber } = require('../src/config/publicWhatsAppConfig');

test('bouton WhatsApp public configuré et accessible', async (t) => {
  const previous = process.env.PUBLIC_WHATSAPP_NUMBER;
  process.env.PUBLIC_WHATSAPP_NUMBER = '243899999999';
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await t.test('normalise uniquement un numéro international explicite', () => {
    assert.equal(normalizePublicWhatsAppNumber('243899999999'), '243899999999');
    for (const invalid of ['', '+243899999999', '0 899 999 999', '0899999999', 'abc']) {
      assert.equal(normalizePublicWhatsAppNumber(invalid), '');
    }
  });

  await t.test('expose la configuration sans coder le numéro dans le composant', async () => {
    const [partial, footer, source, example] = await Promise.all([
      fs.readFile('views/partials/whatsapp-button.ejs', 'utf8'),
      fs.readFile('views/partials/footer.ejs', 'utf8'),
      fs.readFile('public/js/main.js', 'utf8'),
      fs.readFile('.env.example', 'utf8'),
    ]);
    assert.match(partial, /data-whatsapp-link/);
    assert.match(partial, /data-i18n-aria="whatsapp\.open"/);
    assert.doesNotMatch(partial, /243\d{8,}/);
    assert.match(footer, /showPublicWhatsApp/);
    assert.match(source, /https:\/\/wa\.me\/\$\{settings\.publicWhatsAppNumber\}/);
    assert.match(example, /^PUBLIC_WHATSAPP_NUMBER=$/m);
  });

  await t.test('rend le composant sur une page publique et pas sur une page admin', async () => {
    const publicPage = await fetch(`${baseUrl}/`);
    assert.equal(publicPage.status, 200);
    assert.match(await publicPage.text(), /data-whatsapp-contact/);

    const adminPage = await fetch(`${baseUrl}/admin/dashboard`, { redirect: 'manual' });
    assert.equal(adminPage.status, 302);
    assert.doesNotMatch(await adminPage.text(), /data-whatsapp-contact/);
  });

  await t.test('renvoie le numéro public configuré', async () => {
    const response = await fetch(`${baseUrl}/settings/public`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).publicWhatsAppNumber, '243899999999');
  });

  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previous === undefined) delete process.env.PUBLIC_WHATSAPP_NUMBER;
  else process.env.PUBLIC_WHATSAPP_NUMBER = previous;
});
