const publicCourseService = require('../services/publicCourseService');
const { publicBaseUrl } = require('../services/seoService');

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

function robots(req, res) {
  const base = publicBaseUrl(req);
  const body = [
    'User-agent: *', 'Allow: /',
    'Disallow: /student', 'Disallow: /admin', 'Disallow: /teacher',
    'Disallow: /notifications', 'Disallow: /payments/',
    'Disallow: /login', 'Disallow: /logout', 'Disallow: /change-password',
    'Disallow: /forgot-password', 'Disallow: /reset-password/', 'Disallow: /register',
    'Disallow: /registration/', 'Disallow: /placement-test/', 'Disallow: /enroll',
    'Disallow: /certificates/verify/', 'Disallow: /ready', 'Disallow: /settings/',
    'Disallow: /webhooks/',
    `Sitemap: ${base}/sitemap.xml`, '',
  ].join('\n');
  res.type('text/plain').send(body);
}

async function sitemap(req, res) {
  const base = publicBaseUrl(req);
  const courses = await publicCourseService.listPublished();
  const entries = [
    { path: '/' }, { path: '/formations' }, { path: '/about' }, { path: '/contact' },
    ...courses.map((course) => ({ path: `/formations/${encodeURIComponent(course.slug)}`, lastmod: course.createdAt })),
  ];
  const urls = entries.map(({ path, lastmod }) => {
    const date = lastmod instanceof Date && !Number.isNaN(lastmod.valueOf()) ? `<lastmod>${lastmod.toISOString()}</lastmod>` : '';
    return `<url><loc>${escapeXml(`${base}${path}`)}</loc>${date}</url>`;
  }).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}

module.exports = { robots, sitemap };
