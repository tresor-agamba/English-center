const bcrypt = require('bcrypt');
const registrationService = require('../services/registrationService');
const trialAccessService = require('../services/trialAccessService');
const { normalizePhoneNumber, INVALID_PHONE_MESSAGE } = require('../utils/phone.util');
const placementTestService = require('../services/placementTestService');

const PASSWORD_COST = 12;

function emptyForm() {
  return { fullName: '', firstName: '', lastName: '', phoneNumber: '', whatsappNumber: '', email: '', courseId: '', groupId: '', requestedLevel: 'LEVEL_1' };
}

function cleanForm(body) {
  const fullName = body.fullName?.trim().replace(/\s+/g, ' ').slice(0, 200) || '';
  const nameParts = fullName.split(' ').filter(Boolean);
  const form = {
    fullName,
    firstName: body.firstName?.trim().slice(0, 100) || nameParts.shift() || '',
    lastName: body.lastName?.trim().slice(0, 100) || nameParts.join(' ').slice(0, 100) || '',
    phoneNumber: body.phoneNumber?.trim().slice(0, 30) || '',
    whatsappNumber: body.whatsappNumber?.trim().slice(0, 30) || '',
    email: body.email?.trim().toLowerCase().slice(0, 254) || null,
    courseId: body.courseId || '',
    requestedLevel: body.requestedLevel || '',
    groupId: body.groupId || '',
    whatsappConsent: body.whatsappConsent === 'yes',
    learningObjective: body.learningObjective?.trim().slice(0, 1000) || '',
  };
  if (!form.firstName || !form.lastName || !form.phoneNumber) {
    throw new registrationService.RegistrationError('INVALID_FORM', 'Tous les champs sont obligatoires.');
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    throw new registrationService.RegistrationError('INVALID_EMAIL', 'Adresse email invalide.');
  }
  if (body.courseId !== undefined) {
    form.courseId = registrationService.parseCourseId(form.courseId);
    form.requestedLevel = registrationService.validateLevel(form.requestedLevel);
  }
  form.phoneNumber = normalizePhoneNumber(form.phoneNumber);
  if (form.whatsappNumber) form.whatsappNumber = normalizePhoneNumber(form.whatsappNumber);
  if (body.termsPresented === 'yes' && body.termsAccepted !== 'yes') throw new registrationService.RegistrationError('TERMS_REQUIRED', 'Vous devez accepter les conditions d’inscription.');
  return form;
}

function validatePassword(password, confirmation) {
  if (!password || !confirmation) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Le mot de passe et sa confirmation sont obligatoires.');
  }
  if (password.length < 8) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (password !== confirmation) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Les mots de passe ne correspondent pas.');
  }
}

function renderUnavailable(res, error) {
  const statusCode = error.statusCode || 400;
  return res.status(statusCode).render('error', {
    title: 'Inscription indisponible',
    message: error.message || 'Cette inscription ne peut pas être effectuée.',
  });
}

function renderForm(res, { session = null, courses = [], form, error, accountExists = false }) {
  return res.status(error ? 400 : 200).render('public/registration/new', {
    title: 'Inscription',
    session,
    courses,
    form,
    error,
    accountExists,
  });
}

function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.user = user;
      return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

async function newForm(req, res) {
  try {
    const courses = await registrationService.listCoursesForPublicRegistration();
    if (!req.query.session) {
      const requestedCourse = req.query.course ? String(req.query.course) : '';
      const selectedCourse = courses.some((course) => String(course.id) === requestedCourse) ? requestedCourse : '';
      const error = requestedCourse && !selectedCourse
        ? 'Cette formation n\u2019est actuellement pas ouverte aux inscriptions.'
        : null;
      return renderForm(res, { courses, form: { ...emptyForm(), courseId: selectedCourse }, error });
    }
    const session = await registrationService.getSessionForRegistration(req.query.session);
    return renderForm(res, { session, courses, form: { ...emptyForm(), courseId: session.course.id }, error: null });
  } catch (error) {
    if (error instanceof registrationService.RegistrationError) return renderUnavailable(res, error);
    throw error;
  }
}

async function create(req, res) {
  let session;
  let courses = [];
  let form = {
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    phoneNumber: req.body.phoneNumber?.trim() || '',
    whatsappNumber: req.body.whatsappNumber?.trim() || '',
    email: req.body.email?.trim() || '',
    courseId: req.body.courseId || '',
    requestedLevel: req.body.requestedLevel || 'LEVEL_1',
    groupId: req.body.groupId || '',
    whatsappConsent: req.body.whatsappConsent === 'yes',
    learningObjective: req.body.learningObjective?.trim().slice(0, 1000) || '',
  };
  try {
    courses = await registrationService.listCoursesForPublicRegistration();
    if (req.body.sessionId) session = await registrationService.getSessionForRegistration(req.body.sessionId);
    form = cleanForm(req.body);
    validatePassword(req.body.password, req.body.passwordConfirmation);
    const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
    const result = await registrationService.createStudentEnrollment({
      sessionId: session?.id,
      ...form,
      passwordHash,
      whatsappConsent: req.body.whatsappConsent === 'yes',
    });
    await establishSession(req, result.user);
    if (result.enrollment.placementTestRequired) return res.redirect(`/placement-test/${result.enrollment.id}`);
    return res.redirect(`/registration/success/${result.enrollment.id}`);
  } catch (error) {
    if (error.message === INVALID_PHONE_MESSAGE) {
      return renderForm(res, { session, courses, form, error: INVALID_PHONE_MESSAGE });
    }
    if (error instanceof registrationService.RegistrationError) {
      if (req.body.sessionId && (!session || ['SESSION_REQUIRED', 'SESSION_NOT_FOUND', 'SESSION_UNAVAILABLE', 'REGISTRATION_CLOSED', 'SESSION_FULL'].includes(error.code))) {
        return renderUnavailable(res, error);
      }
      return renderForm(res, {
        session,
        courses,
        form,
        error: error.message,
        accountExists: ['ACCOUNT_EXISTS', 'DUPLICATE_ENROLLMENT'].includes(error.code),
      });
    }
    throw error;
  }
}

async function placementForm(req, res) {
  try {
    const enrollment = await placementTestService.getPendingEnrollment(req.params.enrollmentId, req.session.user.id);
    return res.render('public/registration/placement-test', {
      title: 'Test de niveau', enrollment, questions: placementTestService.QUESTIONS, error: null,
    });
  } catch (error) {
    if (error instanceof placementTestService.PlacementTestError) {
      return res.status(error.statusCode).render('error', { title: 'Test de niveau', message: error.message });
    }
    throw error;
  }
}

async function submitPlacement(req, res) {
  try {
    await placementTestService.getPendingEnrollment(req.params.enrollmentId, req.session.user.id);
    const score = placementTestService.scoreAnswers(req.body);
    const enrollment = await placementTestService.completePlacement({
      enrollmentId: req.params.enrollmentId, studentId: req.session.user.id, score,
    });
    return res.render('public/registration/placement-result', {
      title: 'Résultat du test', enrollment,
    });
  } catch (error) {
    if (error instanceof placementTestService.PlacementTestError) {
      return res.status(error.statusCode).render('error', { title: 'Test de niveau', message: error.message });
    }
    throw error;
  }
}

async function success(req, res) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const enrollmentId = Number(req.params.enrollmentId);
  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return res.status(404).render('error', {
      title: 'Inscription introuvable',
      message: 'Cette inscription est introuvable.',
    });
  }

  const enrollment = await registrationService.findEnrollmentForViewer(enrollmentId);
  if (!enrollment) {
    return res.status(404).render('error', {
      title: 'Inscription introuvable',
      message: 'Cette inscription est introuvable.',
    });
  }
  if (req.session.user.role !== 'ADMIN' && enrollment.userId !== req.session.user.id) {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    throw error;
  }

  const learningOverview = await trialAccessService.getLearningOverview(enrollment.id);
  enrollment.status = learningOverview.trialAccess.enrollmentStatus;
  return res.render('public/registration/success', {
    title: 'Inscription enregistrée',
    enrollment,
    trialAccess: learningOverview.trialAccess,
    classMeetings: learningOverview.classMeetings,
  });
}

module.exports = {
  newForm, create, success, placementForm, submitPlacement,
  cleanForm, validatePassword, establishSession,
};
