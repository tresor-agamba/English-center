require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const app = require('../src/app');

test('interface publique GLI bilingue et orientée conversion', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`);
    return { response, html: await response.text() };
  };
  try {
    await t.test('rend une landing page GLI avec les deux appels à l’action', async () => {
      const { response, html } = await get('/');
      assert.equal(response.status, 200);
      assert.match(html, /Global Language Institute/);
      assert.match(html, /Master Languages\. Unlock Opportunities\./);
      assert.match(html, /href="\/register"/);
      assert.match(html, /href="\/formations"/);
      assert.match(html, /data-language="en"/);
      assert.match(html, /data-language="fr"/);
      assert.match(html, /data-menu-toggle/);
    });
    await t.test('centralise et contient les traductions anglaises et françaises', async () => {
      const source = await fs.readFile('public/js/i18n.js', 'utf8');
      assert.match(source, /Start Learning Today/);
      assert.match(source, /Commencer maintenant/);
      assert.match(source, /Create My Account and Take the Test/);
      assert.match(source, /Créer mon compte et passer le test/);
      assert.match(source, /localStorage\.setItem\('gli-language'/);
    });
    await t.test('maintient les pages publiques et leurs champs métier', async () => {
      for (const path of ['/formations', '/register', '/login']) {
        const { response } = await get(path);
        assert.equal(response.status, 200);
      }
      const { html: register } = await get('/register');
      for (const name of ['fullName', 'phoneNumber', 'email', 'password', 'passwordConfirmation', 'courseId', 'requestedLevel']) {
        assert.match(register, new RegExp(`name="${name}"`));
      }
      assert.match(register, /data-registration-submit/);
      const { html: login } = await get('/login');
      assert.match(login, /name="phoneNumber"/);
      assert.match(login, /name="password"/);
      assert.doesNotMatch(login, /name="email"/);
    });
    await t.test('conserve les boutons dynamiques LEVEL_1, LEVEL_2 et LEVEL_3', async () => {
      const source = await fs.readFile('public/js/main.js', 'utf8');
      assert.match(source, /LEVEL_2.*LEVEL_3/);
      assert.match(source, /form\.createTest/);
      assert.match(source, /form\.create/);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
