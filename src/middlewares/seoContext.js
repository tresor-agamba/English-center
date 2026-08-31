const seo = require('../services/seoService');

module.exports = (req, res, next) => {
  res.locals.documentLanguage = seo.languageFromRequest(req);
  const pages = {
    '/': ['New Vision Academy | Practical online courses', 'Build useful language and professional skills through practical, structured online courses with New Vision Academy.'],
    '/formations': ['Courses | New Vision Academy', 'Explore published New Vision Academy courses, their learning goals and upcoming online sessions.'],
    '/about': ['About | New Vision Academy', 'Learn about New Vision Academy’s practical approach to structured online language learning.'],
    '/contact': ['Contact | New Vision Academy', 'Contact New Vision Academy using the verified details published by the academy.'],
    '/certificates/verify': ['Verify a certificate | New Vision Academy', 'Verify a certificate issued by New Vision Academy using its certificate number or verification code.'],
  };
  const transactional = {
    '/register': ['Registration | New Vision Academy', 'Create a student account and apply for an available New Vision Academy course.', 'noindex, follow'],
    '/login': ['Login | New Vision Academy', 'Sign in securely to your New Vision Academy account.', 'noindex, follow'],
    '/change-password': ['Change password | New Vision Academy', 'Update the password for your New Vision Academy account.', 'noindex, nofollow'],
    '/forgot-password': ['Forgot password | New Vision Academy', 'Request a secure password reset for your New Vision Academy account.', 'noindex, nofollow'],
  };
  if (pages[req.path]) {
    const [title, description] = pages[req.path];
    res.locals.seo = seo.publicMetadata(req, { title, description, path: req.path, structuredData: req.path === '/' ? seo.organizationData(req) : null });
  } else if (transactional[req.path] || req.path.startsWith('/reset-password/')) {
    const [title, description, robots] = transactional[req.path] || ['Reset password | New Vision Academy', 'Reset the password for your New Vision Academy account.', 'noindex, nofollow'];
    res.locals.seo = { ...seo.defaultMetadata(req), pageTitle: title, metaDescription: description, robotsMeta: robots };
  } else {
    res.locals.seo = seo.defaultMetadata(req);
  }
  next();
};
