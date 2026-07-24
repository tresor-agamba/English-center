const path = require('path');
const express = require('express');
const session = require('express-session');

const webRoutes = require('./routes/webRoutes');
const authRoutes = require('./routes/authRoutes');
const publicCourseRoutes = require('./routes/publicCourseRoutes');
const registrationRoutes = require('./routes/registrationRoutes');
const enrollmentRoutes = require('./routes/enrollmentRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const classMeetingRoutes = require('./routes/classMeetingRoutes');
const adminAttendanceRoutes = require('./routes/adminAttendanceRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminStudentRoutes = require('./routes/adminStudentRoutes');
const adminSessionRoutes = require('./routes/adminSessionRoutes');
const requireAdmin = require('./middlewares/requireAdmin');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

app.use(webRoutes);
app.use(authRoutes);
app.use('/formations', publicCourseRoutes);
app.use(registrationRoutes);
app.use(enrollmentRoutes);
app.use(paymentRoutes);
app.use(classMeetingRoutes);
app.use('/admin/dashboard', requireAdmin, adminDashboardRoutes);
app.use('/admin/students', requireAdmin, adminStudentRoutes);
app.use('/admin/sessions', requireAdmin, adminSessionRoutes);
app.use('/admin/attendances', requireAdmin, adminAttendanceRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page introuvable',
    message: 'La page demandée est introuvable.',
  });
});

app.use(errorHandler);

module.exports = app;
