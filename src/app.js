const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const webRoutes = require('./routes/webRoutes');
const authRoutes = require('./routes/authRoutes');
const publicCourseRoutes = require('./routes/publicCourseRoutes');
const registrationRoutes = require('./routes/registrationRoutes');
const enrollmentRoutes = require('./routes/enrollmentRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const classMeetingRoutes = require('./routes/classMeetingRoutes');
const adminAttendanceRoutes = require('./routes/adminAttendanceRoutes');
const adminCourseRoutes = require('./routes/adminCourseRoutes');
const adminClassMeetingRoutes = require('./routes/adminClassMeetingRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminStudentRoutes = require('./routes/adminStudentRoutes');
const adminSessionRoutes = require('./routes/adminSessionRoutes');
const adminLearningRoutes = require('./routes/adminLearningRoutes');
const adminAssignmentRoutes = require('./routes/adminAssignmentRoutes');
const studentAssignmentRoutes = require('./routes/studentAssignmentRoutes');
const adminTeacherRoutes = require('./routes/adminTeacherRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const whatsappWebhookRoutes = require('./routes/whatsappWebhookRoutes');
const adminWhatsAppRoutes = require('./routes/adminWhatsAppRoutes');
const adminCertificateRoutes = require('./routes/adminCertificateRoutes');
const studentCertificateRoutes = require('./routes/studentCertificateRoutes');
const studentAssessmentRoutes = require('./routes/studentAssessmentRoutes');
const teacherAssessmentRoutes = require('./routes/teacherAssessmentRoutes');
const adminAssessmentRoutes = require('./routes/adminAssessmentRoutes');
const adminLiveOralRoutes = require('./routes/adminLiveOralRoutes');
const adminWrittenAssessmentRoutes = require('./routes/adminWrittenAssessmentRoutes');
const adminAcademicRoutes = require('./routes/adminAcademicRoutes');
const teacherAcademicRoutes = require('./routes/teacherAcademicRoutes');
const studentAcademicRoutes = require('./routes/studentAcademicRoutes');
const adminFinanceRoutes = require('./routes/adminFinanceRoutes');
const studentFinanceRoutes = require('./routes/studentFinanceRoutes');
const adminReportRoutes = require('./routes/adminReportRoutes');
const adminSettingsRoutes = require('./routes/adminSettingsRoutes');
const publicSettingsRoutes = require('./routes/publicSettingsRoutes');
const healthRoutes = require('./routes/healthRoutes');
const adminSystemRoutes = require('./routes/adminSystemRoutes');
const adminManualPaymentRoutes = require('./routes/adminManualPaymentRoutes');
const teacherReportRoutes = require('./routes/teacherReportRoutes');
const teacherWrittenAssessmentRoutes = require('./routes/teacherWrittenAssessmentRoutes');
const studentWrittenAssessmentRoutes = require('./routes/studentWrittenAssessmentRoutes');
const studentLiveOralRoutes = require('./routes/studentLiveOralRoutes');
const teacherLiveOralRoutes = require('./routes/teacherLiveOralRoutes');
const certificateVerificationRoutes = require('./routes/certificateVerificationRoutes');
const requireAdmin = require('./middlewares/requireAdmin');
const requireStudent = require('./middlewares/requireStudent');
const requireTeacher = require('./middlewares/requireTeacher');
const requireAuthenticated = require('./middlewares/requireAuthenticated');
const notificationLocals = require('./middlewares/notificationLocals');
const studentRoutes = require('./routes/studentRoutes');
const errorHandler = require('./middlewares/errorHandler');
const requestContext = require('./middlewares/requestContext');
const pwaRoutes = require('./routes/pwaRoutes');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(requestContext);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
    imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"], formAction: ["'self'"], manifestSrc: ["'self'"], workerSrc: ["'self'"],
  } },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, res, buffer) => {
  if (req.originalUrl.startsWith('/webhooks/whatsapp')) req.rawBody = Buffer.from(buffer);
} }));
app.use(pwaRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'development-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
app.use(notificationLocals);
app.use((req, res, next) => {
  const publicPrefixes = ['/', '/about', '/contact', '/login', '/register', '/formations', '/certificates'];
  res.locals.showPublicWhatsApp = publicPrefixes.some((prefix) => (
    prefix === '/' ? req.path === '/' : (req.path === prefix || req.path.startsWith(`${prefix}/`))
  ));
  next();
});

app.use(healthRoutes);
app.use('/webhooks/whatsapp', whatsappWebhookRoutes);
app.use(webRoutes);
app.use(authRoutes);
app.use('/formations', publicCourseRoutes);
app.use('/certificates', certificateVerificationRoutes);
app.use(registrationRoutes);
app.use(enrollmentRoutes);
app.use(paymentRoutes);
app.use(classMeetingRoutes);
app.use('/student', requireStudent, studentRoutes);
app.use('/student', requireStudent, studentAssignmentRoutes);
app.use('/student', requireStudent, studentCertificateRoutes);
app.use('/student', requireStudent, studentAssessmentRoutes);
app.use('/student', requireStudent, studentLiveOralRoutes);
app.use('/student', requireStudent, studentWrittenAssessmentRoutes);
app.use('/student', requireStudent, studentAcademicRoutes);
app.use('/student', requireStudent, studentFinanceRoutes);
app.use('/teacher', requireTeacher, teacherRoutes);
app.use('/teacher', requireTeacher, teacherAssessmentRoutes);
app.use('/teacher', requireTeacher, teacherLiveOralRoutes);
app.use('/teacher', requireTeacher, teacherWrittenAssessmentRoutes);
app.use('/teacher', requireTeacher, teacherAcademicRoutes);
app.use('/teacher', requireTeacher, teacherReportRoutes);
app.use('/notifications', requireAuthenticated, notificationRoutes);
app.use('/settings/public', publicSettingsRoutes);
app.use('/admin/dashboard', requireAdmin, adminDashboardRoutes);
app.use('/admin/students', requireAdmin, adminStudentRoutes);
app.use('/admin/teachers', requireAdmin, adminTeacherRoutes);
app.use('/admin/notifications', requireAdmin, adminNotificationRoutes);
app.use('/admin/whatsapp', requireAdmin, adminWhatsAppRoutes);
app.use('/admin/certificates', requireAdmin, adminCertificateRoutes);
app.use('/admin/oral-assessments', requireAdmin, adminAssessmentRoutes);
app.use('/admin', requireAdmin, adminLiveOralRoutes);
app.use('/admin/written-assessments', requireAdmin, adminWrittenAssessmentRoutes);
app.use('/admin/sessions', requireAdmin, adminSessionRoutes);
app.use('/admin/attendances', requireAdmin, adminAttendanceRoutes);
app.use('/admin/courses', requireAdmin, adminCourseRoutes);
app.use('/admin/class-meetings', requireAdmin, adminClassMeetingRoutes);
app.use('/admin', requireAdmin, adminLearningRoutes);
app.use('/admin', requireAdmin, adminAssignmentRoutes);
app.use('/admin/academic', requireAdmin, adminAcademicRoutes);
app.use('/admin/finances', requireAdmin, adminFinanceRoutes);
app.use('/admin/finances', requireAdmin, adminManualPaymentRoutes);
app.use('/admin/reports', requireAdmin, adminReportRoutes);
app.use('/admin/settings', requireAdmin, adminSettingsRoutes);
app.use('/admin/system', requireAdmin, adminSystemRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: 'Page introuvable',
    message: 'La page demandée est introuvable.',
    requestId: req.requestId,
  });
});

app.use(errorHandler);

module.exports = app;
