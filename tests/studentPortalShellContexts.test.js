const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('les erreurs enrollment choisissent explicitement le shell adapté', () => {
  const view = read('views/student/enrollment/unavailable.ejs');
  const enrollmentController = read('src/controllers/enrollmentController.js');
  const studentController = read('src/controllers/studentController.js');
  const assignmentController = read('src/controllers/studentAssignmentController.js');
  const meetingController = read('src/controllers/classMeetingController.js');

  assert.match(view, /layoutContext[^\n]+student/);
  assert.match(view, /include\('\.\.\/_header'\)/);
  assert.match(view, /include\('\.\.\/\.\.\/partials\/header'/);
  assert.match(view, /include\('\.\.\/_footer'\)/);
  assert.match(view, /include\('\.\.\/\.\.\/partials\/footer'\)/);
  assert.doesNotMatch(enrollmentController, /layoutContext:\s*'student'/);
  for (const source of [studentController, assignmentController, meetingController]) {
    assert.match(source, /layoutContext:\s*'student'/);
  }
});

test('les erreurs de paiement séparent strictement Student et Admin', () => {
  const view = read('views/student/payment/error.ejs');
  const studentController = read('src/controllers/paymentController.js');
  const adminController = read('src/controllers/adminManualPaymentController.js');

  assert.match(studentController, /paymentErrorContext:\s*'student'/);
  assert.match(adminController, /paymentErrorContext:\s*'admin'/);
  assert.match(view, /include\('\.\.\/_header'\)/);
  assert.match(view, /include\('\.\.\/\.\.\/admin\/_nav'\)/);
  assert.match(view, /useAdminShell[^?]+\?[^:]+admin\/finances\/manual-payments/s);
});

test('la navigation conserve toutes les routes réelles et clarifie les groupes', () => {
  const nav = read('views/student/_nav.ejs');
  const studentCss = read('public/css/student.css');
  assert.equal((nav.match(/src="\/images\/logo\/logo-navigation\.png"/g) || []).length, 2);
  assert.doesNotMatch(studentCss, /filter:\s*brightness\(0\)\s*invert\(1\)/);
  assert.match(studentCss, /\.nva-student-body \.student-brand[^}]+background:\s*#fff/s);
  assert.match(studentCss, /\.nva-student-body \.student-brand img[^}]+object-fit:\s*contain/s);
  assert.match(nav, />Évaluations</);
  for (const route of [
    '/student/oral-assessments',
    '/student/written-assessments',
    '/student/live-oral-sessions',
    '/student/payments',
    '/student/finances',
  ]) assert.match(nav, new RegExp(`href="${route.replaceAll('/', '\\/')}"`));
  assert.match(nav, />Paiements</);
  assert.match(nav, /Factures &amp; solde/);
});

test('les états vides certificats et académique restent contextuels', () => {
  const certificates = read('views/student/certificates/index.ejs');
  const academic = read('views/student/academic/index.ejs');
  assert.match(certificates, /Aucun certificat disponible pour le moment/);
  assert.doesNotMatch(certificates, /Aucune formation inscrite/);
  assert.match(academic, /Aucun enseignant assigné pour le moment/);
  assert.match(academic, /Aucune séance enregistrée/);
  assert.match(academic, /Aucune présence enregistrée/);
});

test('le dashboard premium conserve des badges fondés sur les données existantes', () => {
  const dashboard = read('views/student/dashboard.ejs');
  const studentCss = read('public/css/student.css');
  assert.match(dashboard, /nextMeeting\.access\.label/);
  assert.match(dashboard, /nextMeeting\?\.access\.canJoin/);
  assert.match(dashboard, /progress\.level/);
  assert.match(dashboard, /priorities\.assignments\.todo/);
  assert.match(dashboard, /priorities\.payment\.pending/);
  assert.match(dashboard, /priorities\.certificate\.available/);
  assert.doesNotMatch(dashboard, /class="student-ui-badge[^"%]*">Nouveau</);
  assert.match(studentCss, /--student-primary-soft:/);
  assert.match(studentCss, /--student-purple-soft:/);
  assert.match(studentCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('le HTML final des erreurs ne mélange aucun shell', async () => {
  const common = { title: 'Indisponible', message: 'Action impossible.', csrfToken: '', csrfField: () => '', unreadNotificationCount: 0 };
  const student = { ...common, layoutContext: 'student', studentNavigationPath: '/student/courses/1/learn', studentNavigationUser: { firstName: 'Aline', lastName: 'NVA' } };
  const studentHtml = await ejs.renderFile('views/student/enrollment/unavailable.ejs', student);
  assert.match(studentHtml, /class="student-header"/);
  assert.match(studentHtml, /class="student-sidebar"/);
  assert.doesNotMatch(studentHtml, /data-public-header|nva-public-footer/);

  const publicHtml = await ejs.renderFile('views/student/enrollment/unavailable.ejs', common);
  assert.match(publicHtml, /data-public-header/);
  assert.match(publicHtml, /nva-public-footer/);
  assert.doesNotMatch(publicHtml, /class="student-sidebar"/);

  const studentPaymentHtml = await ejs.renderFile('views/student/payment/error.ejs', { ...student, paymentErrorContext: 'student' });
  assert.match(studentPaymentHtml, /class="student-sidebar"/);
  assert.doesNotMatch(studentPaymentHtml, /data-admin-navigation|data-public-header/);

  const adminHtml = await ejs.renderFile('views/student/payment/error.ejs', { ...common, paymentErrorContext: 'admin' });
  assert.match(adminHtml, /data-admin-navigation/);
  assert.doesNotMatch(adminHtml, /class="student-sidebar"|nva-student-body/);
});
