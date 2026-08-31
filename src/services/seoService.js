const SITE_NAME = 'New Vision Academy';
const DEFAULT_SOCIAL_IMAGE = '/images/optimized/pic-7-1440.webp';

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function absoluteUrl(req, value = '/') {
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, `${publicBaseUrl(req)}/`).toString();
}

function languageFromRequest(req) {
  const queryLanguage = ['fr', 'en'].includes(req.query?.lang) ? req.query.lang : null;
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('nva-language='));
  const cookieLanguage = cookie ? decodeURIComponent(cookie.slice('nva-language='.length)) : null;
  return queryLanguage || (['fr', 'en'].includes(cookieLanguage) ? cookieLanguage : 'en');
}

function defaultMetadata(req) {
  const path = req.path || '/';
  const privatePage = /^\/(student|admin|teacher)(\/|$)/.test(path)
    || /^\/(notifications|payments)(\/|$)/.test(path)
    || /^\/(login|logout|change-password|forgot-password|reset-password)(\/|$)/.test(path);
  const transactionalPage = /^\/(registration|placement-test|enroll)(\/|$)/.test(path)
    || /^\/certificates\/verify\//.test(path);
  return {
    pageTitle: SITE_NAME,
    metaDescription: 'Practical online language courses with structured guidance from New Vision Academy.',
    canonicalUrl: null,
    robotsMeta: privatePage || transactionalPage ? 'noindex, nofollow' : 'index, follow',
    ogTitle: SITE_NAME,
    ogDescription: 'Practical online language courses with structured guidance from New Vision Academy.',
    ogImage: absoluteUrl(req, DEFAULT_SOCIAL_IMAGE),
    ogUrl: null,
    ogType: 'website',
    twitterCard: 'summary_large_image',
    structuredDataJson: null,
  };
}

function publicMetadata(req, { title, description, path = req.path, robots = 'index, follow', structuredData = null }) {
  const canonicalUrl = absoluteUrl(req, path);
  const metadata = {
    ...defaultMetadata(req), pageTitle: title, metaDescription: description, canonicalUrl, robotsMeta: robots,
    ogTitle: title, ogDescription: description, ogUrl: canonicalUrl,
  };
  if (structuredData) metadata.structuredDataJson = JSON.stringify(structuredData).replace(/</g, '\\u003c');
  return metadata;
}

function organizationData(req) {
  const base = publicBaseUrl(req);
  return {
    '@context': 'https://schema.org', '@type': 'EducationalOrganization', name: SITE_NAME,
    url: `${base}/`, logo: absoluteUrl(req, '/images/optimized/logo-navigation-320.png'),
  };
}

module.exports = {
  SITE_NAME, DEFAULT_SOCIAL_IMAGE, publicBaseUrl, absoluteUrl, languageFromRequest,
  defaultMetadata, publicMetadata, organizationData,
};
