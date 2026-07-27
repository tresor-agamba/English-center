const studentDashboardService = require('../services/studentDashboardService');
const studentCourseService = require('../services/studentCourseService');
const studentScheduleService = require('../services/studentScheduleService');
const studentPaymentService = require('../services/studentPaymentService');
const studentProfileService = require('../services/studentProfileService');
const learningAccessService = require('../services/learningAccessService');
const lmsResourceService = require('../services/lmsResourceService');
const studentClassMeetingService = require('../services/studentClassMeetingService');

async function dashboard(req, res) {
  const data = await studentDashboardService.getDashboard(req.student.id);
  res.render('student/dashboard', { title: 'Tableau de bord étudiant', ...data });
}

async function courses(req, res) {
  const enrollments = await studentCourseService.listStudentCourses(req.student.id);
  res.render('student/courses/index', { title: 'Mes formations', enrollments });
}

async function course(req, res) {
  const enrollment = await studentCourseService.getStudentCourse(req.student.id, req.params.enrollmentId);
  if (!enrollment) {
    return res.status(404).render('error', { title: 'Inscription introuvable', message: 'Cette inscription est introuvable.' });
  }
  return res.render('student/courses/show', { title: enrollment.trainingSession.course.title, enrollment });
}

async function schedule(req, res) {
  const selectedEnrollmentId = Number(req.query.course) || null;
  const period = ['week', 'month'].includes(req.query.period) ? req.query.period : 'all';
  const [meetings, enrollments] = await Promise.all([
    studentScheduleService.getStudentMeetings(req.student.id, {
      courseEnrollmentId: selectedEnrollmentId,
      period,
    }),
    studentCourseService.listStudentCourses(req.student.id),
  ]);
  res.render('student/schedule/index', {
    title: 'Mon calendrier',
    groups: studentScheduleService.groupMeetingsByDate(meetings),
    enrollments,
    filters: { selectedEnrollmentId, period },
  });
}

async function payments(req, res) {
  const items = await studentPaymentService.listStudentPayments(req.student.id);
  res.render('student/payments/index', { title: 'Mes paiements', payments: items });
}

async function profile(req, res) {
  const student = await studentProfileService.getProfile(req.student.id);
  res.render('student/profile/show', {
    title: 'Mon profil', student, profileError: null, passwordError: null,
    profileSuccess: req.query.updated === '1', passwordSuccess: req.query.password === '1',
  });
}

async function updateProfile(req, res) {
  try {
    const student = await studentProfileService.updateProfile(req.student.id, req.body);
    Object.assign(req.session.user, {
      firstName: student.firstName,
      lastName: student.lastName,
      phoneNumber: student.phoneNumber,
    });
    return req.session.save(() => res.redirect('/student/profile?updated=1'));
  } catch (error) {
    if (!(error instanceof studentProfileService.StudentProfileError)) throw error;
    const student = {
      ...req.student,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phoneNumber: req.body.phoneNumber,
    };
    return res.status(error.statusCode).render('student/profile/show', {
      title: 'Mon profil', student, profileError: error.message, passwordError: null,
      profileSuccess: false, passwordSuccess: false,
    });
  }
}

async function updatePassword(req, res) {
  try {
    await studentProfileService.changePassword(req.student.id, req.body);
    return res.redirect('/student/profile?password=1');
  } catch (error) {
    if (!(error instanceof studentProfileService.StudentProfileError)) throw error;
    return res.status(error.statusCode).render('student/profile/show', {
      title: 'Mon profil',
      student: req.student,
      profileError: null,
      passwordError: error.message,
      profileSuccess: false,
      passwordSuccess: false,
    });
  }
}

async function learn(req, res) {
  try {
    const data = await learningAccessService.getLearningPath(req.student.id, req.params.enrollmentId);
    return res.render('student/learning/index', { title: `Apprendre — ${data.course.title}`, ...data });
  } catch (error) {
    if (error instanceof learningAccessService.LearningAccessError) {
      return res.status(error.statusCode).render('student/enrollment/unavailable', {
        title: 'Contenu indisponible', message: error.message,
      });
    }
    throw error;
  }
}

async function lesson(req, res) {
  try {
    const data = await learningAccessService.getLesson(req.student.id, req.params.enrollmentId, req.params.lessonId);
    return res.render('student/learning/lesson', { title: data.lesson.title, ...data });
  } catch (error) {
    if (error instanceof learningAccessService.LearningAccessError) {
      return res.status(error.statusCode).render('student/enrollment/unavailable', {
        title: 'Leçon indisponible', message: error.message,
      });
    }
    throw error;
  }
}

async function setLessonCompletion(req, res, completed) {
  try {
    await learningAccessService.setCompleted(req.student.id, req.params.enrollmentId, req.params.lessonId, completed);
    return res.redirect(`/student/courses/${req.params.enrollmentId}/lessons/${req.params.lessonId}`);
  } catch (error) {
    if (error instanceof learningAccessService.LearningAccessError) {
      return res.status(error.statusCode).render('student/enrollment/unavailable', {
        title: 'Progression indisponible', message: error.message,
      });
    }
    throw error;
  }
}

async function classMeeting(req, res) {
  try {
    const data = await studentClassMeetingService.getMeetingDetails(req.student.id, req.params.id);
    return res.render('student/class-meetings/show', { title: data.meeting.title || 'Cours en direct', ...data });
  } catch (error) {
    if (error instanceof studentClassMeetingService.StudentClassMeetingError) {
      return res.status(error.statusCode).render('student/enrollment/unavailable', {
        title: 'Séance indisponible', message: error.message,
      });
    }
    throw error;
  }
}

async function privateLearningResource(req, res) {
  const file = await lmsResourceService.studentFile(req.student.id, req.params.enrollmentId, req.params.publicId);
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`);
  return res.sendFile(file.absolutePath);
}

async function lessonActivity(req, res) {
  await learningAccessService.recordActivity(req.student.id, req.params.enrollmentId, req.params.lessonId, req.body.lastPositionSeconds);
  return res.status(204).end();
}

module.exports = {
  dashboard, courses, course, schedule, payments, profile, updateProfile, updatePassword,
  learn, lesson,
  classMeeting,
  privateLearningResource, lessonActivity,
  completeLesson: (req, res) => setLessonCompletion(req, res, true),
  uncompleteLesson: (req, res) => setLessonCompletion(req, res, false),
};
