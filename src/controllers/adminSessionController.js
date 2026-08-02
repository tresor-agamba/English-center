const sessionService = require('../services/trainingSessionService');
const trialAccessService = require('../services/trialAccessService');

const statuses = ['DRAFT', 'OPEN', 'FULL', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const weekDays = {
  MONDAY: 'Lundi',
  TUESDAY: 'Mardi',
  WEDNESDAY: 'Mercredi',
  THURSDAY: 'Jeudi',
  FRIDAY: 'Vendredi',
  SATURDAY: 'Samedi',
  SUNDAY: 'Dimanche',
};
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
  const selectedWeekDays = Array.isArray(body.weekDays)
    ? body.weekDays
    : body.weekDays
      ? [body.weekDays]
      : [];
  const startTime = body.startTime?.trim() || '';
  const endTime = body.endTime?.trim() || '';
  const startDate = new Date(`${body.startDate}T${startTime || '00:00'}:00`);
  const endDate = new Date(`${body.endDate}T${endTime || '00:00'}:00`);
  const data = {
    name: body.name?.trim(),
    courseId: Number(body.courseId),
    startDate,
    endDate,
    registrationDeadline: new Date(body.registrationDeadline),
    capacity: Number(body.capacity),
    weekDays: selectedWeekDays,
    startTime,
    endTime,
    timezone: body.timezone?.trim(),
    platform: body.platform?.trim() || null,
    status: body.status,
  };

  if (!data.name) throw validationError('Le nom est obligatoire.');
  if (!Number.isInteger(data.courseId) || data.courseId <= 0) throw validationError('La formation sélectionnée est invalide.');
  if ([data.startDate, data.endDate, data.registrationDeadline].some((date) => Number.isNaN(date.getTime()))) {
    throw validationError('Toutes les dates sont obligatoires.');
  }
  if (!data.weekDays.length || data.weekDays.some((day) => !Object.hasOwn(weekDays, day))) {
    throw validationError('Sélectionnez au moins un jour de cours valide.');
  }
  if (!timePattern.test(data.startTime) || !timePattern.test(data.endTime) || data.endTime <= data.startTime) {
    throw validationError("L'heure de fin doit être postérieure à l'heure de début.");
  }
  if (!data.timezone) throw validationError('Le fuseau horaire est obligatoire.');
  if (data.endDate <= data.startDate) throw validationError('La date de fin doit être postérieure à la date de début.');
  if (data.registrationDeadline > data.startDate) {
    throw validationError("La date limite d’inscription doit précéder le début de la session.");
  }
  if (!Number.isInteger(data.capacity) || data.capacity <= 0) {
    throw validationError('La capacité doit être un nombre entier supérieur à zéro.');
  }
  if (!statuses.includes(data.status)) throw validationError('Le statut est invalide.');
  if (['OPEN', 'FULL', 'ONGOING'].includes(data.status) && !data.platform) {
    throw validationError('La plateforme est obligatoire pour une session ouverte ou en cours.');
  }
  return data;
}

async function ensureCourseExists(courseId) {
  if (!(await sessionService.findCourse(courseId))) throw validationError('La formation sélectionnée est introuvable.');
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
  res.render('admin/sessions/new', { title: 'Nouvelle session', courses, statuses, weekDays, error: null, form: {} });
}

async function create(req, res) {
  const courses = await sessionService.listCourses();
  try {
    const data = parseForm(req.body);
    await ensureCourseExists(data.courseId);
    const session = await sessionService.create(data);
    return res.redirect(`/admin/sessions/${session.id}`);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).render('admin/sessions/new', {
        title: 'Nouvelle session', courses, statuses, weekDays, error: error.message, form: req.body,
      });
    }
    throw error;
  }
}

async function show(req, res) {
  const session = await getSession(req.params.id);
  const access = await Promise.all(session.enrollments.map((item) => trialAccessService.calculateTrialAccess(item.id)));
  session.enrollments = session.enrollments.map((item, index) => ({ ...item, access: access[index] }));
  res.render('admin/sessions/show', { title: session.name, session });
}

async function editForm(req, res) {
  const [session, courses] = await Promise.all([getSession(req.params.id), sessionService.listCourses()]);
  res.render('admin/sessions/edit', { title: `Modifier ${session.name}`, session, form: session, courses, statuses, weekDays, error: null });
}

async function update(req, res) {
  const id = parseId(req.params.id);
  const [session, courses] = await Promise.all([getSession(id), sessionService.listCourses()]);
  try {
    const data = parseForm(req.body);
    await ensureCourseExists(data.courseId);
    await sessionService.update(id, data);
    return res.redirect(`/admin/sessions/${id}`);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).render('admin/sessions/edit', {
        title: `Modifier ${session.name}`, session, form: req.body, courses, statuses, weekDays, error: error.message,
      });
    }
    throw error;
  }
}

async function cancel(req, res) {
  const id = parseId(req.params.id);
  await sessionService.cancel(id);
  res.redirect(`/admin/sessions/${id}`);
}

async function toggleStatus(req, res) {
  const session = await getSession(req.params.id);
  const status = req.body.status;
  if (!statuses.includes(status)) throw validationError('Le statut est invalide.');
  if (['OPEN', 'FULL', 'ONGOING'].includes(status) && !session.platform) {
    throw validationError('La plateforme est obligatoire pour publier cette session.');
  }
  await sessionService.update(session.id, { status });
  return res.redirect(`/admin/sessions/${session.id}`);
}

module.exports = { index, newForm, create, show, editForm, update, cancel, toggleStatus, parseForm, weekDays };
