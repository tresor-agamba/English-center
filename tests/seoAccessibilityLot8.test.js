require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');

test('Lot 8 — SEO, indexation et accessibilité publique', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const course = await prisma.course.create({
    data: {
      title: `English & Communication <${unique}>`, slug: `seo-course-${unique}`,
      shortDescription: 'A practical published course for metadata validation.',
      description: 'A complete practical published course.', level: 'Beginner', duration: '8 weeks',
      durationValue: 8, durationUnit: 'WEEKS', price: '100.00', currency: 'USD',
      pricingMode: 'ONE_TIME', pricingActive: true,
      isPublished: true, lmsStatus: 'PUBLISHED', publishedAt: new Date(),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, options) => {
    const response = await fetch(`${base}${path}`, { redirect: 'manual', ...options });
    return { response, body: await response.text() };
  };

  try {
    await t.test('homepage expose title, description, canonical, OG, Twitter et JSON-LD', async () => {
      const { response, body } = await get('/');
      assert.equal(response.status, 200);
      assert.match(body, /<title>New Vision Academy \| Practical online courses<\/title>/);
      assert.match(body, /<meta name="description" content="[^"]+">/);
      assert.match(body, new RegExp(`<link rel="canonical" href="${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/">`));
      assert.match(body, /property="og:title"/);
      assert.match(body, /name="twitter:card" content="summary_large_image"/);
      assert.match(body, /"@type":"EducationalOrganization"/);
      assert.equal((body.match(/<h1\b/g) || []).length, 1);
      assert.match(body, /class="skip-link" href="#main-content"/);
    });

    await t.test('catalogue expose ses métadonnées et sa canonical propre', async () => {
      const { response, body } = await get('/formations');
      assert.equal(response.status, 200);
      assert.match(body, /<title>Courses \| New Vision Academy<\/title>/);
      assert.match(body, /rel="canonical" href="[^"]+\/formations"/);
      assert.match(body, /<meta name="robots" content="index, follow">/);
    });

    await t.test('formation dynamique a une canonical spécifique et échappe les données DB', async () => {
      const { response, body } = await get(`/formations/${course.slug}`);
      assert.equal(response.status, 200);
      assert.match(body, new RegExp(`rel="canonical" href="[^"]+/formations/${course.slug}"`));
      assert.doesNotMatch(body, /<title>[^<]*<script/i);
      assert.match(body, /English &amp; Communication &lt;/);
    });

    await t.test('login et inscription sont explicitement non indexables', async () => {
      const login = await get('/login');
      const register = await get('/register');
      assert.match(login.body, /name="robots" content="noindex, follow"/);
      assert.match(register.body, /name="robots" content="noindex, follow"/);
      assert.doesNotMatch(login.body, /rel="canonical"/);
    });

    await t.test('les routes Student restent protégées', async () => {
      const { response } = await get('/student');
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
    });

    await t.test('robots.txt est textuel, référence le sitemap et exclut le privé', async () => {
      const { response, body } = await get('/robots.txt');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/plain/);
      for (const path of ['/student', '/admin', '/teacher']) assert.match(body, new RegExp(`Disallow: ${path}`));
      assert.match(body, new RegExp(`Sitemap: ${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap.xml`));
    });

    await t.test('sitemap XML contient uniquement les pages publiques indexables', async () => {
      const { response, body } = await get('/sitemap.xml');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/xml/);
      for (const path of ['/', '/formations', '/about', '/contact', `/formations/${course.slug}`]) assert.match(body, new RegExp(`<loc>${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${path === '/' ? '/' : path}</loc>`));
      for (const path of ['/login', '/register', '/student', '/admin', '/teacher', '/payments']) assert.doesNotMatch(body, new RegExp(`<loc>[^<]*${path}`));
    });

    await t.test('lang reflète le contexte serveur anglais et français', async () => {
      const english = await get('/');
      const french = await get('/', { headers: { cookie: 'nva-language=fr' } });
      assert.match(english.body, /<html lang="en"/);
      assert.match(french.body, /<html lang="fr"/);
      assert.match(french.body, />Aller au contenu principal<\/a>/);
    });

    await t.test('404 conserve HTTP 404 et noindex', async () => {
      const { response, body } = await get('/route-lot-8-inexistante');
      assert.equal(response.status, 404);
      assert.match(body, /name="robots" content="noindex, nofollow"/);
    });

    await t.test('landmarks, images et formulaires principaux restent accessibles structurellement', async () => {
      for (const path of ['/', '/formations', '/about', '/contact', '/login', '/register']) {
        const { body } = await get(path);
        assert.match(body, /<header\b/); assert.match(body, /<nav\b/); assert.match(body, /<main\b/); assert.match(body, /<footer\b/);
        for (const image of body.match(/<img\b[^>]*>/g) || []) assert.match(image, /\balt="[^"]*"/);
      }
      for (const path of ['/login', '/register']) {
        const { body } = await get(path);
        for (const id of [...body.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((match) => match[1])) {
          assert.match(body, new RegExp(`<label[^>]*for="${id}"`), `label absent pour #${id}`);
        }
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
  }
});
