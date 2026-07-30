'use strict';

const fs = require('node:fs');

const source = fs.readFileSync('public/js/i18n.js', 'utf8');
const match = source.match(/const translations = (\{[\s\S]*?\n  \});/);
if (!match) throw new Error('Dictionnaire i18n public introuvable.');

const translations = Function(`"use strict"; return (${match[1]});`)();
const englishKeys = Object.keys(translations.en).sort();
const frenchKeys = Object.keys(translations.fr).sort();
if (JSON.stringify(englishKeys) !== JSON.stringify(frenchKeys)) {
  throw new Error('Les dictionnaires anglais et français ne contiennent pas les mêmes clés.');
}

const views = [
  'views/home.ejs', 'views/auth/login.ejs', 'views/error.ejs',
  'views/partials/header.ejs', 'views/partials/footer.ejs',
  'views/public/certificates/verify.ejs', 'views/public/courses/index.ejs',
  'views/public/courses/show.ejs', 'views/public/registration/new.ejs',
  'views/public/registration/placement-test.ejs', 'views/public/registration/placement-result.ejs',
  'views/public/registration/success.ejs', 'views/errors/_page.ejs',
];

for (const file of views) {
  const view = fs.readFileSync(file, 'utf8');
  for (const keyMatch of view.matchAll(/data-i18n(?:-aria)?="([^"<%]+)"/g)) {
    const key = keyMatch[1];
    if (!translations.en[key] || !translations.fr[key]) throw new Error(`${file}: clé i18n absente ${key}`);
  }
}

console.log(`PUBLIC_I18N_OK=${englishKeys.length}`);
