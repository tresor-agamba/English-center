const sessionService = require('../services/trainingSessionService');

const statuses = ['DRAFT', 'OPEN', 'FULL', 'ONGOING', 'COMPLETED', 'CANCELLED'];

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw validationError('Identifiant de session invalide.');
  return id;
}

function parseForm(body) {
  const data = {
    name: body.name?.trim(),
    courseId: Number(body.courseId),
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    registrationDeadline: new Date(body.registrationDeadline),
    capacity: Number(body.capacity),
    status: body.status,
  };

  if (!data.name) throw validationError('Le nom est obligatoire.');
  if (!Number.isInteger(data.courseId) || data.courseId <= 0) throw validationError('La formation sélectionnée est invalide.');
  if ([data.startDate, data.endDate, data.registrationDeadline].some((date) => Number.isNaN(date.getTime()))) {
    throw validationError('Toutes les dates sont obligatoires.');
  }
  if (data.endDate <= data.startDate) throw validationError('La date de fin doit être postérieure à la date de début.');
  if (data.registrationDeadline > data.startDate) {
    throw validationError("La date limite d’inscription doit précéder le début de la session.");
  }
  if (!Number.isInteger(data.capacity) || data.capacity <= 0) {
    throw validationError('La capacité doit être un nombre entier supérieur à zéro.');
  }
  if (!statuses.includes(data.status)) throw validationError('Le statut est invalide.');
  return data;
}

async function getSession(value) {
  const session = await sessionService.findById(parseId(value));
  if (!session) {
    const error = new Error('Session introuvable.');
    error.statusCode = 404;
    throw error;
  }
  return session;
}

async function index(req, res) {
  const sessions = await sessionService.list();
  res.render('admin/sessions/index', { title: 'Sessions', sessions });
}

async function newForm(req, res) {
  const courses = await sessionService.listCourses();
  res.render('admin/sessions/new', { title: 'Nouvelle session', courses, statuses });
}

async function create(req, res) {
  const session = await sessionService.create(parseForm(req.body));
  res.redirect(`/admin/sessions/${session.id}`);
}

async function show(req, res) {
  const session = await getSession(req.params.id);
  res.render('admin/sessions/show', { title: session.name, session });
}

async function editForm(req, res) {
  const [session, courses] = await Promise.all([getSession(req.params.id), sessionService.listCourses()]);
  res.render('admin/sessions/edit', { title: `Modifier ${session.name}`, session, courses, statuses });
}

async function update(req, res) {
  const id = parseId(req.params.id);
  await sessionService.update(id, parseForm(req.body));
  res.redirect(`/admin/sessions/${id}`);
}

async function cancel(req, res) {
  const id = parseId(req.params.id);
  await sessionService.cancel(id);
  res.redirect(`/admin/sessions/${id}`);
}

module.exports = { index, newForm, create, show, editForm, update, cancel };
