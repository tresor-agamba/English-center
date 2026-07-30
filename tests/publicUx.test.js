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
      const dictionaryMatch = source.match(/const translations = (\{[\s\S]*?\n  \});/);
      assert.ok(dictionaryMatch, 'Le dictionnaire i18n doit rester centralisé');
      const translations = Function(`"use strict"; return (${dictionaryMatch[1]});`)();
      assert.deepEqual(Object.keys(translations.en).sort(), Object.keys(translations.fr).sort());
      for (const language of ['en', 'fr']) {
        for (const [key, value] of Object.entries(translations[language])) {
          assert.equal(typeof value, 'string', `${language}.${key} doit être une chaîne`);
          assert.ok(value.trim(), `${language}.${key} ne doit pas être vide`);
        }
      }
      const viewFiles = [
        'views/home.ejs', 'views/auth/login.ejs', 'views/error.ejs',
        'views/partials/header.ejs', 'views/partials/footer.ejs',
        'views/public/certificates/verify.ejs', 'views/public/courses/index.ejs',
        'views/public/courses/show.ejs', 'views/public/registration/new.ejs',
        'views/public/registration/placement-test.ejs', 'views/public/registration/placement-result.ejs',
        'views/public/registration/success.ejs', 'views/errors/_page.ejs',
      ];
      for (const file of viewFiles) {
        const view = await fs.readFile(file, 'utf8');
        for (const match of view.matchAll(/data-i18n(?:-aria)?="([^"<%]+)"/g)) {
          assert.ok(translations.en[match[1]], `${file}: clé anglaise absente ${match[1]}`);
          assert.ok(translations.fr[match[1]], `${file}: clé française absente ${match[1]}`);
        }
      }
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
    await t.test('expose une navigation mobile et des libellés accessibles traduisibles', async () => {
      const { html } = await get('/');
      assert.match(html, /aria-controls="public-navigation"/);
      assert.match(html, /aria-expanded="false"/);
      assert.match(html, /data-i18n-aria="nav\.open"/);
      assert.match(html, /data-i18n-aria="a11y\.primaryNav"/);
      assert.match(html, /data-i18n="a11y\.skip"/);
      assert.match(html, /href="\/#about"/);
      assert.match(html, /href="\/#contact"/);
    });
    await t.test('conserve les routes et formulaires publics secondaires', async () => {
      const certificate = await get('/certificates/verify');
      assert.equal(certificate.response.status, 200);
      assert.match(certificate.html, /label for="query" data-i18n="certificate\.label"/);
      assert.match(certificate.html, /action="\/certificates\/verify"/);
      const missing = await get('/route-publique-inexistante');
      assert.equal(missing.response.status, 404);
      assert.match(missing.html, /data-i18n="error\.home"/);
    });
    await t.test('n’imbrique pas de région main dans le contenu public', async () => {
      for (const path of ['/', '/formations', '/register', '/login', '/certificates/verify']) {
        const { html } = await get(path);
        assert.equal((html.match(/<main\b/g) || []).length, 1, `${path} doit contenir un seul élément main`);
      }
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
