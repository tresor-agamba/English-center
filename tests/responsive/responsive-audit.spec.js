const { test, expect, chromium, firefox, webkit } = require('@playwright/test');
const fs = require('fs/promises');
const { prepare, ACCOUNTS, PASSWORD } = require('../../scripts/prepareResponsiveAudit');
const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 }, { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-landscape-1024', width: 1024, height: 768 }, { name: 'tablet-portrait-768', width: 768, height: 1024 },
  { name: 'mobile-large-430', width: 430, height: 932 }, { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 }, { name: 'mobile-small-320', width: 320, height: 568 },
  { name: 'mobile-landscape-844', width: 844, height: 390 }, { name: 'mobile-landscape-640', width: 640, height: 360 },
];
const PAGES = [
  ['PUBLIC','/','home.ejs'],['PUBLIC','/about','public/about.ejs'],['PUBLIC','/contact','public/contact.ejs'],['PUBLIC','/login','auth/login.ejs'],['PUBLIC','/formations','public/courses/index.ejs'],['PUBLIC','/certificates/verify','public/certificates/verify.ejs'],
  ['ADMIN','/admin/dashboard','admin/dashboard.ejs'],['ADMIN','/admin/students','admin/students/index.ejs'],['ADMIN','/admin/students/new','admin/students/new.ejs'],['ADMIN','/admin/teachers','admin/teachers/index.ejs'],['ADMIN','/admin/teachers/new','admin/teachers/form.ejs'],['ADMIN','/admin/courses','admin/courses/index.ejs'],['ADMIN','/admin/courses/new','admin/courses/new.ejs'],['ADMIN','/admin/sessions','admin/sessions/index.ejs'],['ADMIN','/admin/sessions/new','admin/sessions/new.ejs'],['ADMIN','/admin/class-meetings','admin/class-meetings/index.ejs'],['ADMIN','/admin/class-meetings/new','admin/class-meetings/new.ejs'],['ADMIN','/admin/academic','admin/academic/index.ejs'],['ADMIN','/admin/finances','admin/finances/index.ejs'],['ADMIN','/admin/certificates','admin/certificates/index.ejs'],['ADMIN','/admin/oral-assessments','admin/oral-assessments/index.ejs'],['ADMIN','/admin/oral-assessments/new','admin/oral-assessments/form.ejs'],['ADMIN','/admin/written-assessments','admin/written-assessments/index.ejs'],['ADMIN','/admin/written-assessments/new','admin/written-assessments/form.ejs'],['ADMIN','/admin/live-oral-assessments','admin/live-oral-assessments/index.ejs'],['ADMIN','/admin/live-oral-sessions','admin/live-oral-sessions/index.ejs'],['ADMIN','/admin/notifications/announcements','admin/notifications/announcements/index.ejs'],['ADMIN','/admin/notifications/announcements/new','admin/notifications/announcements/new.ejs'],['ADMIN','/admin/reports','admin/reports/index.ejs'],['ADMIN','/admin/settings','admin/settings/index.ejs'],
  ['TEACHER','/teacher','teacher/dashboard.ejs'],['TEACHER','/teacher/sessions','teacher/sessions.ejs'],['TEACHER','/teacher/profile','teacher/profile.ejs'],['TEACHER','/teacher/academic','teacher/academic/index.ejs'],['TEACHER','/teacher/reports','teacher/reports/index.ejs'],['TEACHER','/teacher/oral-assessments','teacher/oral-assessments/index.ejs'],['TEACHER','/teacher/written-assessments','teacher/written-assessments/index.ejs'],['TEACHER','/teacher/live-oral-sessions','teacher/live-oral-sessions/index.ejs'],
  ['STUDENT','/student','student/dashboard.ejs'],['STUDENT','/student/profile','student/profile/show.ejs'],['STUDENT','/student/courses','student/courses/index.ejs'],['STUDENT','/student/schedule','student/schedule/index.ejs'],['STUDENT','/student/payments','student/payments/index.ejs'],['STUDENT','/student/finances','student/finances/index.ejs'],['STUDENT','/student/assignments','student/assignments/index.ejs'],['STUDENT','/student/certificates','student/certificates/index.ejs'],['STUDENT','/student/academic','student/academic/index.ejs'],['STUDENT','/student/oral-assessments','student/oral-assessments/index.ejs'],['STUDENT','/student/written-assessments','student/written-assessments/index.ejs'],['STUDENT','/student/live-oral-sessions','student/live-oral-sessions/index.ejs'],['STUDENT','/notifications','notifications/index.ejs'],
].map(([role,route,view]) => ({role,route,view}));
async function login(page, role) {
  if (role === 'PUBLIC') return; await page.goto('/login'); await page.locator('[name=phoneNumber]').fill(ACCOUNTS[role].phoneNumber); await page.locator('[name=password]').fill(PASSWORD);
  await Promise.all([page.waitForURL((url) => !url.pathname.endsWith('/login')), page.locator('button[type=submit]').click()]);
}
async function inspect(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')].filter((element) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); if (['auto','scroll'].includes(style.overflowX) || element.closest('.table-wrapper,.table-wrap,.responsive-table,.admin-nav,.student-nav,.settings-tabs,.filter-tabs,.report-tabs')) return false; return rect.left < -1 || rect.right > innerWidth + 1; }).slice(0, 20).map((element) => ({ tag: element.tagName, className: String(element.className).slice(0,100), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }));
    return { overflow: root.scrollWidth > root.clientWidth + 1, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders };
  });
}
test('audit Chromium complet des pages et viewports', async () => {
  await prepare(); await require('../../src/utils/prisma').$disconnect(); await fs.mkdir('test-results/responsive/screenshots', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true }); const matrix = [], errors = [];
  try { for (const role of ['PUBLIC','ADMIN','TEACHER','STUDENT']) {
    const context = await browser.newContext(); const page = await context.newPage(); page.on('pageerror', (error) => errors.push({ role, message: error.message })); await login(page, role);
    for (const item of PAGES.filter((candidate) => candidate.role === role)) for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); const response = await page.goto(item.route, { waitUntil: 'networkidle' }); const result = await inspect(page), status = response?.status() || 0; const passed = status === 200 && !result.overflow && !result.offenders.length;
      matrix.push({ ...item, viewport: viewport.name, httpStatus: status, state: passed ? 'PASS' : 'FAIL', problems: [...(result.overflow ? [`global overflow ${result.scrollWidth}/${result.clientWidth}`] : []), ...(result.offenders.length ? [`${result.offenders.length} overflowing elements`] : [])], corrections: [], validation: passed ? 'PASS' : 'FAIL', offenders: result.offenders });
      if (['/','/login','/admin/dashboard','/admin/students','/admin/settings','/admin/reports','/admin/finances','/teacher','/student','/student/courses'].includes(item.route) && ['desktop-1920','tablet-portrait-768','mobile-390','mobile-small-320'].includes(viewport.name)) await page.screenshot({ path: `test-results/responsive/screenshots/${role}-${item.route.replace(/\\W+/g,'-').replace(/^-|-$/g,'') || 'home'}-${viewport.name}.png`, fullPage: true });
    } await context.close();
  }} finally { await browser.close(); }
  await fs.writeFile('test-results/responsive/audit-matrix.json', JSON.stringify({ generatedAt: new Date().toISOString(), pages: PAGES, viewports: VIEWPORTS, matrix, errors }, null, 2));
  expect(errors).toEqual([]); expect(matrix.filter((row) => row.state === 'FAIL'), JSON.stringify(matrix.filter((row) => row.state === 'FAIL').slice(0,10), null,2)).toEqual([]);
});
test('contrôle principal Firefox et WebKit', async () => {
  test.skip(process.platform === 'win32', 'Firefox/WebKit Playwright restent bloqués dans cet environnement Windows.');
  test.setTimeout(180_000);
  for (const engine of [firefox,webkit]) { const browser = await engine.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); try { for (const route of ['/','/login','/formations']) { const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 }); expect(response.status()).toBe(200); await expect(page.locator('body')).toBeVisible(); expect((await inspect(page)).overflow).toBe(false); } } finally { await browser.close(); } }
});
