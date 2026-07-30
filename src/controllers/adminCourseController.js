const { Prisma } = require('@prisma/client');
const courseService = require('../services/courseService');
const { COURSE_TYPE_LABELS, DURATION_UNIT_LABELS } = require('../utils/catalogFormat.util');

const COURSE_TYPES = Object.keys(COURSE_TYPE_LABELS);
const DURATION_UNITS = Object.keys(DURATION_UNIT_LABELS);
const CURRENCIES = ['USD', 'CDF'];
const PRICING_STATES = Object.freeze({
  UNAVAILABLE: 'Tarif non disponible',
  FREE: 'Formation gratuite',
  AVAILABLE: 'Formation payante',
  INACTIVE: 'Tarif désactivé',
});

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw validationError('Identifiant de formation invalide.');
  return id;
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'formation';
}

async function uniqueSlug(title, excludedId = null) {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (true) {
    const existing = await courseService.findSlug(slug);
    if (!existing || existing.id === excludedId) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

function parseForm(body) {
  const data = {
    title: body.title?.trim().slice(0, 160) || '',
    courseType: body.courseType,
    level: body.level?.trim().slice(0, 100) || '',
    durationValue: Number(body.durationValue),
    durationUnit: body.durationUnit,
    price: body.price,
    currency: body.currency,
    pricingMode: null,
    pricingActive: body.pricingState !== 'INACTIVE',
    registrationFee: body.registrationFee || '0',
    maxInstallments: 1,
    pricingStartsAt: body.pricingStartsAt ? new Date(body.pricingStartsAt) : null,
    pricingEndsAt: body.pricingEndsAt ? new Date(body.pricingEndsAt) : null,
    shortDescription: body.shortDescription?.trim() || null,
    description: body.description?.trim() || null,
    objectives: body.objectives?.trim() || null,
    targetAudience: body.targetAudience?.trim() || null,
    prerequisites: body.prerequisites?.trim() || null,
    trainingMode: '100 % en ligne',
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
  };
  if (!data.title || !data.level) throw validationError('Le titre et le niveau sont obligatoires.');
  if (!COURSE_TYPES.includes(data.courseType)) throw validationError('Type de formation invalide.');
  if (!Number.isInteger(data.durationValue) || data.durationValue <= 0) throw validationError('La durée doit être supérieure à zéro.');
  if (!DURATION_UNITS.includes(data.durationUnit)) throw validationError('Unité de durée invalide.');
  const pricingState = body.pricingState || (body.price === '' || body.price == null ? 'UNAVAILABLE' : (Number(body.price) === 0 ? 'FREE' : 'AVAILABLE'));
  if (!Object.hasOwn(PRICING_STATES, pricingState)) throw validationError('État tarifaire invalide.');
  if (!CURRENCIES.includes(data.currency)) throw validationError('Devise invalide.');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(data.registrationFee).trim())) throw validationError('Frais d’inscription invalides.');
  data.registrationFee = String(data.registrationFee).replace(',', '.');
  if (Number(data.registrationFee) < 0) throw validationError('Les frais d’inscription ne peuvent pas être négatifs.');
  if (pricingState === 'UNAVAILABLE') {
    data.price = null;
    data.pricingMode = null;
    data.pricingActive = true;
    data.registrationFee = '0';
  } else {
    if (typeof data.price !== 'string' || !/^\d+(?:[.,]\d{1,2})?$/.test(data.price.trim())) throw validationError('Prix invalide.');
    data.price = data.price.replace(',', '.');
    if (Number(data.price) < 0) throw validationError('Le prix ne peut pas être négatif.');
    if (pricingState === 'FREE') {
      data.price = '0';
      data.registrationFee = '0';
      data.pricingMode = 'FREE';
    } else {
      if (Number(data.price) <= 0) throw validationError('Le montant d’une formation payante doit être supérieur à zéro.');
      data.pricingMode = 'ONE_TIME';
    }
  }
  if (data.pricingStartsAt && Number.isNaN(data.pricingStartsAt.getTime())) throw validationError('Date de début tarifaire invalide.');
  if (data.pricingEndsAt && Number.isNaN(data.pricingEndsAt.getTime())) throw validationError('Date de fin tarifaire invalide.');
  if (data.pricingStartsAt && data.pricingEndsAt && data.pricingEndsAt <= data.pricingStartsAt) throw validationError('La date de fin doit être postérieure à la date de début.');
  return data;
}

function viewData(extra = {}) {
  return { courseTypes: COURSE_TYPE_LABELS, durationUnits: DURATION_UNIT_LABELS, currencies: CURRENCIES, pricingStates: PRICING_STATES, ...extra };
}

async function getCourse(value) {
  const course = await courseService.findById(parseId(value));
  if (!course) {
    const error = new Error('Formation introuvable.');
    error.statusCode = 404;
    throw error;
  }
  return course;
}

async function index(req, res) {
  const courses = await courseService.list();
  return res.render('admin/courses/index', { title: 'Formations', courses, typeLabels: COURSE_TYPE_LABELS });
}

function newForm(req, res) {
  return res.render('admin/courses/new', viewData({ title: 'Nouvelle formation', form: { pricingState: 'UNAVAILABLE', currency: 'USD', registrationFee: '0' }, error: null }));
}

async function create(req, res) {
  try {
    const data = parseForm(req.body);
    data.slug = await uniqueSlug(data.title);
    const course = await courseService.create(data);
    return res.redirect(`/admin/courses/${course.id}/edit?created=1`);
  } catch (error) {
    if (error.statusCode === 400 || error?.code === 'P2002') {
      return res.status(400).render('admin/courses/new', viewData({
        title: 'Nouvelle formation',
        form: req.body,
        error: error?.code === 'P2002' ? 'Une formation utilise déjà ce slug.' : error.message,
      }));
    }
    throw error;
  }
}

async function editForm(req, res) {
  const course = await getCourse(req.params.id);
  return res.render('admin/courses/edit', viewData({
    title: `Modifier ${course.title}`,
    course,
    form: course,
    error: null,
    success: req.query.created || req.query.updated || '',
  }));
}

async function update(req, res) {
  const course = await getCourse(req.params.id);
  try {
    const data = parseForm(req.body);
    data.slug = await uniqueSlug(data.title, course.id);
    await courseService.update(course.id, data);
    return res.redirect(`/admin/courses/${course.id}/edit?updated=1`);
  } catch (error) {
    if (error.statusCode === 400 || error?.code === 'P2002') {
      return res.status(400).render('admin/courses/edit', viewData({
        title: `Modifier ${course.title}`,
        course,
        form: req.body,
        error: error?.code === 'P2002' ? 'Une formation utilise déjà ce slug.' : error.message,
        success: '',
      }));
    }
    throw error;
  }
}

async function togglePublished(req, res) {
  const course = await getCourse(req.params.id);
  await courseService.togglePublished(course.id, !course.isPublished);
  return res.redirect(`/admin/courses/${course.id}/edit?updated=1`);
}

module.exports = {
  COURSE_TYPES,
  DURATION_UNITS,
  CURRENCIES,
  slugify,
  uniqueSlug,
  parseForm,
  index,
  newForm,
  create,
  editForm,
  update,
  togglePublished,
};
