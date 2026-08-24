const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('photo optimisee integree au Hero public', () => {
  const view = fs.readFileSync('views/home.ejs', 'utf8');
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const webp = 'public/images/hero/young-congolese-learner-online-english.webp';
  const fallback = 'public/images/hero/young-congolese-learner-online-english.jpg';

  assert.equal(fs.existsSync(webp), true);
  assert.equal(fs.existsSync(fallback), true);
  assert.ok(fs.statSync(webp).size < 200 * 1024);
  assert.match(view, /srcset="\/images\/hero\/young-congolese-learner-online-english\.webp"/);
  assert.match(view, /src="\/images\/hero\/young-congolese-learner-online-english\.jpg"/);
  assert.match(view, /<picture class="stitch-hero-media" aria-hidden="true">/);
  assert.match(view, /alt=""/);
  assert.match(view, /width="1280" height="853"/);
  assert.match(view, /loading="eager" fetchpriority="high" decoding="async"/);
  assert.doesNotMatch(view, /[A-Z]:\\|file:\/\//);
  assert.doesNotMatch(view, /visual-main|visual-depth-card|visual-spark/);
  assert.match(css, /\.stitch-hero-media img[^}]*object-fit:\s*cover/);
});
