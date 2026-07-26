const bcrypt = require('bcrypt');
const { Prisma } = require('@prisma/client');
const service = require('../services/teacherService');
const access = require('../services/teacherAccessService');
const { normalizePhoneNumber } = require('../utils/phone.util');

function identity(body) {
  const firstName = body.firstName?.trim(), lastName = body.lastName?.trim();
  if (!firstName || !lastName || !body.phoneNumber?.trim()) { const e = new Error('Tous les champs sont obligatoires.'); e.statusCode = 400; throw e; }
  return { firstName, lastName, phoneNumber: normalizePhoneNumber(body.phoneNumber) };
}
function password(body) {
  if (!body.password || body.password.length < 8 || body.password !== body.passwordConfirmation) {
    const e = new Error('Le mot de passe doit contenir 8 caractères et correspondre à la confirmation.'); e.statusCode = 400; throw e;
  }
  return body.password;
}
function duplicate(error) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
async function get(value) {
  const item = await service.find(access.parseId(value, 'enseignant'));
  if (!item) { const e = new Error('Enseignant introuvable.'); e.statusCode = 404; throw e; }
  return item;
}
async function index(req, res) {
  const search = req.query.search?.trim() || '';
  res.render('admin/teachers/index', { title: 'Enseignants', teachers: await service.list(search), search, success: req.query.success || '' });
}
function newForm(req, res) { res.render('admin/teachers/form', { title: 'Ajouter un enseignant', teacher: null, error: null }); }
async function create(req, res) {
  try {
    const teacher = await service.create({ ...identity(req.body), passwordHash: await bcrypt.hash(password(req.body), 12) });
    res.redirect(`/admin/teachers/${teacher.id}?success=created`);
  } catch (error) {
    if (error.statusCode === 400 || duplicate(error)) return res.status(400).render('admin/teachers/form', { title: 'Ajouter un enseignant', teacher: req.body, error: duplicate(error) ? 'Ce numéro est déjà utilisé.' : error.message });
    throw error;
  }
}
async function show(req, res) {
  res.render('admin/teachers/show', { title: 'Fiche enseignant', teacher: await get(req.params.id), sessions: await service.sessions(), success: req.query.success || '', error: null });
}
async function update(req, res) {
  const teacher = await get(req.params.id);
  try { await service.update(teacher.id, identity(req.body)); res.redirect(`/admin/teachers/${teacher.id}?success=updated`); }
  catch (error) {
    if (error.statusCode === 400 || duplicate(error)) return res.status(400).render('admin/teachers/form', { title: 'Modifier l’enseignant', teacher: { ...teacher, ...req.body }, error: duplicate(error) ? 'Ce numéro est déjà utilisé.' : error.message });
    throw error;
  }
}
async function editForm(req, res) { res.render('admin/teachers/form', { title: 'Modifier l’enseignant', teacher: await get(req.params.id), error: null }); }
async function toggle(req, res) { const teacher = await get(req.params.id); await service.update(teacher.id, { isActive: !teacher.isActive }); res.redirect(`/admin/teachers/${teacher.id}?success=status`); }
async function resetPassword(req, res) { const teacher = await get(req.params.id); await service.update(teacher.id, { passwordHash: await bcrypt.hash(password(req.body), 12) }); res.redirect(`/admin/teachers/${teacher.id}?success=password`); }
async function assign(req, res) { const teacherId = access.parseId(req.params.id, 'enseignant'); await service.assign({ teacherId, trainingSessionId: access.parseId(req.body.trainingSessionId, 'session'), isLeadTeacher: req.body.isLeadTeacher === 'on' }); res.redirect(`/admin/teachers/${teacherId}?success=assigned`); }
async function unassign(req, res) { const teacherId = access.parseId(req.params.id, 'enseignant'); await service.unassign(teacherId, access.parseId(req.params.sessionId, 'session')); res.redirect(`/admin/teachers/${teacherId}?success=unassigned`); }
module.exports = { index, newForm, create, show, editForm, update, toggle, resetPassword, assign, unassign };
