const bcrypt = require('bcrypt');
const { Prisma } = require('@prisma/client');
const studentService = require('../services/studentService');
const { normalizePhoneNumber, INVALID_PHONE_MESSAGE } = require('../utils/phone.util');

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

async function index(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const requestedPage = Number(req.query.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await studentService.list({ search, page });
  if (page > result.totalPages) {
    return res.redirect(`/admin/students?search=${encodeURIComponent(search)}&page=${result.totalPages}`);
  }
  return res.render('admin/students/index', {
    title: 'Étudiants',
    search,
    success: req.query.success || '',
    ...result,
  });
}

function newForm(req, res) {
  return res.render('admin/students/new', {
    title: 'Ajouter un étudiant',
    form: { firstName: '', lastName: '', phoneNumber: '' },
    error: null,
  });
}

async function create(req, res) {
  let form = {
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    phoneNumber: req.body.phoneNumber?.trim() || '',
  };
  try {
    form = cleanIdentity(req.body);
    validatePassword(req.body.password, req.body.passwordConfirmation);
    const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
    const student = await studentService.create({ ...form, passwordHash });
    return res.redirect(`/admin/students/${student.id}?success=created`);
  } catch (error) {
    const message = isDuplicatePhone(error) ? DUPLICATE_PHONE_MESSAGE : error.message;
    if (error.statusCode === 400 || isDuplicatePhone(error) || message === INVALID_PHONE_MESSAGE) {
      return res.status(400).render('admin/students/new', {
        title: 'Ajouter un étudiant',
        form,
        error: message,
      });
    }
    throw error;
  }
}

async function show(req, res) {
  const student = await getStudent(req.params.id);
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
  const student = await getStudent(req.params.id);
  try {
    validatePassword(req.body.password, req.body.passwordConfirmation);
    const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
    const result = await studentService.resetPassword(student.id, passwordHash);
    if (!result.count) throw httpError(404, 'Étudiant introuvable.');
    return res.redirect(`/admin/students/${student.id}?success=password`);
  } catch (error) {
    if (error.statusCode === 400) {
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
