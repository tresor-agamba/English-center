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
  'views/home.ejs', 'views/auth/login.ejs', 'views/error.ejs', 'views/public/about.ejs', 'views/public/contact.ejs',
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

const brandAssets = [
  'logo/file_00000000136481f4adfe20138a5ac0be.png',
  'logo/file_00000000288c82469aee30c1647223e5.png',
  'logo/file_0000000081cc81f495d7da251e20f7a4.png',
  'public/images/logo/logo-with-tagline.png',
  'public/images/logo/logo-navigation.png',
  'public/images/logo/logo-icon.png',
  'public/favicon.ico',
  'public/icons/apple-touch-icon.png',
  ...[72, 96, 128, 144, 152, 192, 384, 512].map((size) => `public/icons/icon-${size}.png`),
  'public/icons/icon-512-maskable.png',
];
for (const file of brandAssets) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`Ressource de marque absente : ${file}`);
}

const publicViews = views.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
if (/[A-Z]:\\[^"<\s]+/.test(publicViews)) throw new Error('Un chemin Windows local est exposé dans une vue publique.');
for (const imageMatch of publicViews.matchAll(/(?:src|srcset|href)="(\/(?:images|icons)\/[^"]+\.(?:png|jpg|jpeg|webp|svg))"/g)) {
  const file = `public${imageMatch[1]}`;
  if (!fs.existsSync(file)) throw new Error(`Image publique référencée mais absente : ${imageMatch[1]}`);
}

console.log(`PUBLIC_I18N_OK=${englishKeys.length}`);
console.log(`BRAND_ASSETS_OK=${brandAssets.length}`);
