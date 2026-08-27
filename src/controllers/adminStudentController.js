const bcrypt = require('bcrypt');
const { Prisma } = require('@prisma/client');
const studentService = require('../services/studentService');
const { normalizePhoneNumber, INVALID_PHONE_MESSAGE } = require('../utils/phone.util');
const trialAccessService = require('../services/trialAccessService');
const registrationService = require('../services/registrationService');
const crypto = require('crypto');

const PASSWORD_COST = 12;
const DUPLICATE_PHONE_MESSAGE = 'Ce numéro de téléphone est déjà utilisé.';

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Identifiant étudiant invalide.');
  return id;
}

function cleanIdentity(body) {
  const form = {
    firstName: body.firstName?.trim() || '',
    lastName: body.lastName?.trim() || '',
    phoneNumber: body.phoneNumber?.trim() || '',
  };
  if (!form.firstName || !form.lastName || !form.phoneNumber) {
    throw httpError(400, 'Tous les champs sont obligatoires.');
  }
  form.phoneNumber = normalizePhoneNumber(form.phoneNumber);
  return form;
}

function validatePassword(password, confirmation) {
  if (!password || !confirmation) throw httpError(400, 'Tous les champs du mot de passe sont obligatoires.');
  if (password.length < 8) throw httpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (password !== confirmation) throw httpError(400, 'Les mots de passe ne correspondent pas.');
}

function isDuplicatePhone(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function getStudent(value) {
  const student = await studentService.findById(parseId(value));
  if (!student) throw httpError(404, 'Étudiant introuvable.');
  return student;
}

async function withAccess(student) {
  const access = await Promise.all(student.enrollments.map((item) => trialAccessService.calculateTrialAccess(item.id)));
  student.enrollments = student.enrollments.map((item, index) => ({ ...item, access: access[index] }));
  return student;
}

async function index(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const requestedPage = Number(req.query.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const parseFilterId = (value) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };
  const filters = { courseId: parseFilterId(req.query.courseId), sessionId: parseFilterId(req.query.sessionId), groupId: parseFilterId(req.query.groupId), level: ['LEVEL_1','LEVEL_2','LEVEL_3'].includes(req.query.level) ? req.query.level : null, status: ['TRIAL_ACTIVE','PLACEMENT_TEST_REQUIRED','PAYMENT_REQUIRED','CONFIRMED','CANCELLED','PAYMENT_FAILED'].includes(req.query.status) ? req.query.status : null };
  const [result, options] = await Promise.all([studentService.list({ search, page, filters }), studentService.filterOptions()]);
  const query = new URLSearchParams(Object.entries({ search, ...filters }).filter(([, value]) => value).map(([key, value]) => [key, String(value)])).toString();
  if (page > result.totalPages) {
    return res.redirect(`/admin/students?${query}&page=${result.totalPages}`);
  }
  return res.render('admin/students/index', {
    title: 'Étudiants',
    search,
    filters, options, query,
    success: req.query.success || '',
    ...result,
  });
}

async function newForm(req, res) {
  const courses = await registrationService.listCoursesForPublicRegistration();
  return res.render('admin/students/new', {
    title: 'Inscrire un étudiant', courses,
    form: { firstName: '', lastName: '', phoneNumber: '', whatsappNumber: '', email: '', courseId: '', groupId: '', requestedLevel: 'LEVEL_1' },
    error: null,
  });
}

function temporaryPassword() {
  return `Nva!${crypto.randomBytes(9).toString('base64url')}`;
}

async function create(req, res) {
  let form = {
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    phoneNumber: req.body.phoneNumber?.trim() || '',
    whatsappNumber: req.body.whatsappNumber?.trim() || '', email: req.body.email?.trim() || '',
    courseId: req.body.courseId || '', groupId: req.body.groupId || '', requestedLevel: req.body.requestedLevel || 'LEVEL_1',
  };
  try {
    form = cleanIdentity(req.body);
    if (!req.body.courseId) {
      validatePassword(req.body.password, req.body.passwordConfirmation);
      const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
      const student = await studentService.create({ ...form, passwordHash, mustChangePassword: true });
      return res.redirect(`/admin/students/${student.id}?success=created`);
    }
    form = { ...form, whatsappNumber: req.body.whatsappNumber?.trim() || '', email: req.body.email?.trim() || '', courseId: req.body.courseId, groupId: req.body.groupId, requestedLevel: req.body.requestedLevel };
    const generatedPassword = temporaryPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, PASSWORD_COST);
    const result = await registrationService.createStudentEnrollment({
      ...form, courseId: registrationService.parseCourseId(form.courseId), groupId: form.groupId,
      requestedLevel: registrationService.validateLevel(form.requestedLevel), passwordHash,
      allowExistingUser: true, mustChangePassword: true,
    });
    const enrollment = await registrationService.findEnrollmentForViewer(result.enrollment.id);
    return res.render('admin/students/enrollment-confirmation', {
      title: 'Inscription confirmée', enrollment, temporaryPassword: result.accountCreated ? generatedPassword : null,
      loginUrl: `${req.protocol}://${req.get('host')}/login`,
    });
  } catch (error) {
    const courses = await registrationService.listCoursesForPublicRegistration();
    const message = isDuplicatePhone(error) ? DUPLICATE_PHONE_MESSAGE : error.message;
    if (error.statusCode === 400 || isDuplicatePhone(error) || message === INVALID_PHONE_MESSAGE) {
      return res.status(400).render('admin/students/new', {
        title: 'Inscrire un étudiant', courses, form,
        error: message,
      });
    }
    if (error instanceof registrationService.RegistrationError) return res.status(400).render('admin/students/new', { title: 'Inscrire un étudiant', courses, form, error: error.message });
    throw error;
  }
}

async function show(req, res) {
  const student = await withAccess(await getStudent(req.params.id));
  return res.render('admin/students/show', {
    title: `${student.firstName} ${student.lastName}`,
    student,
    success: req.query.success || '',
    resetError: null,
  });
}

async function editForm(req, res) {
  const student = await getStudent(req.params.id);
  return res.render('admin/students/edit', {
    title: `Modifier ${student.firstName} ${student.lastName}`,
    student,
    form: student,
    error: null,
  });
}

async function update(req, res) {
  const student = await getStudent(req.params.id);
  let form = {
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    phoneNumber: req.body.phoneNumber?.trim() || '',
  };
  try {
    form = cleanIdentity(req.body);
    const result = await studentService.update(student.id, form);
    if (!result.count) throw httpError(404, 'Étudiant introuvable.');
    return res.redirect(`/admin/students/${student.id}?success=updated`);
  } catch (error) {
    const message = isDuplicatePhone(error) ? DUPLICATE_PHONE_MESSAGE : error.message;
    if (error.statusCode === 400 || isDuplicatePhone(error) || message === INVALID_PHONE_MESSAGE) {
      return res.status(400).render('admin/students/edit', {
        title: `Modifier ${student.firstName} ${student.lastName}`,
        student,
        form,
        error: message,
      });
    }
    throw error;
  }
}

async function toggleStatus(req, res) {
  const student = await getStudent(req.params.id);
  const result = await studentService.setActive(student.id, !student.isActive);
  if (!result.count) throw httpError(404, 'Étudiant introuvable.');
  return res.redirect(`/admin/students/${student.id}?success=${student.isActive ? 'disabled' : 'enabled'}`);
}

async function resetPassword(req, res) {
  let student = await getStudent(req.params.id);
  try {
    validatePassword(req.body.password, req.body.passwordConfirmation);
    const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
    const result = await studentService.resetPassword(student.id, passwordHash);
    if (!result.count) throw httpError(404, 'Étudiant introuvable.');
    return res.redirect(`/admin/students/${student.id}?success=password`);
  } catch (error) {
    if (error.statusCode === 400) {
      student = await withAccess(student);
      return res.status(400).render('admin/students/show', {
        title: `${student.firstName} ${student.lastName}`,
        student,
        success: '',
        resetError: error.message,
      });
    }
    throw error;
  }
}

module.exports = { index, newForm, create, show, editForm, update, toggleStatus, resetPassword };
