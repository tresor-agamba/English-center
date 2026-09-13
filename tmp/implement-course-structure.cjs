const fs = require('node:fs');
function edit(path, fn) { const old = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); fs.writeFileSync(path, fn(old)); }
function replace(s, from, to) { if (!s.includes(from)) throw new Error(`Missing anchor: ${from}`); return s.replace(from, to); }
edit('src/controllers/adminCourseController.js', s => {
  s = "const { parseStructure } = require('../services/courseStructureService');\n" + s;
  s = replace(s, 'const data = {\n', 'const data = {\n    ...parseStructure(body),\n');
  s = replace(s, "if (!data.title || !data.level) throw validationError('Le titre et le niveau sont obligatoires.');", "if (!data.title) throw validationError('Le titre est obligatoire.');");
  s = replace(s, "form: { pricingState: 'UNAVAILABLE'", "form: { structureType: 'SIMPLE', accessPolicy: 'FULL_PAYMENT', pricingState: 'UNAVAILABLE'");
  s = replace(s, 'const data = parseForm(req.body);\n    data.slug = await uniqueSlug(data.title, course.id);', 'const data = parseForm({ ...course, ...req.body });\n    data.slug = await uniqueSlug(data.title, course.id);');
  return s;
});
edit('src/services/courseService.js', s => {
 s = "const structure = require('./courseStructureService');\n" + s;
 s = replace(s, 'function create(data) {\n  return prisma.course.create({ data });\n}', 'function create(data) {\n  return prisma.course.create({ data: { ...data, ...structure.parseStructure(data) } });\n}');
 s = replace(s, 'function update(id, data) {\n  return prisma.course.update({ where: { id }, data });\n}', `async function update(id, data) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw\`SELECT id FROM courses WHERE id = \${id} FOR UPDATE\`;
    const current = await tx.course.findUniqueOrThrow({ where: { id } });
    const merged = { ...current, ...data };
    const parsed = structure.parseStructure(merged);
    const changed = ['structureType', 'sessionCount', 'accessPolicy'].some(key => merged[key] !== current[key]);
    if (changed && (await tx.enrollment.count({ where: { trainingSession: { courseId: id } } }) || await tx.academicCohort.count({ where: { courseId: id } }))) {
      throw structure.invalid('Structure et règle d’accès verrouillées : des inscriptions ou cohortes existent. Créez une nouvelle formation.');
    }
    const sessions = await tx.trainingSession.findMany({ where: { courseId: id }, select: { levelNumber: true } });
    for (const session of sessions) structure.validateSessionLevel(merged, session.levelNumber);
    return tx.course.update({ where: { id }, data: { ...data, ...parsed } });
  });
}`);
 return s;
});
edit('src/services/trainingSessionService.js', s => {
 s = "const structure = require('./courseStructureService');\n" + s;
 s = replace(s, 'function create(data) {\n  return prisma.trainingSession.create({ data });\n}', `async function create(data) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw\`SELECT id FROM courses WHERE id = \${data.courseId} FOR UPDATE\`;
    const course = await tx.course.findUnique({ where: { id: data.courseId } });
    return tx.trainingSession.create({ data: { ...data, levelNumber: structure.validateSessionLevel(course, data.levelNumber) } });
  });
}`);
 s = replace(s, 'function update(id, data) {\n  return prisma.trainingSession.update({ where: { id }, data });\n}', `async function update(id, data) {
  return prisma.$transaction(async tx => {
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id } });
    const merged = { ...current, ...data };
    for (const courseId of [...new Set([current.courseId, merged.courseId])].sort((a,b) => a-b)) await tx.$queryRaw\`SELECT id FROM courses WHERE id = \${courseId} FOR UPDATE\`;
    const course = await tx.course.findUnique({ where: { id: merged.courseId } });
    const levelNumber = structure.validateSessionLevel(course, merged.levelNumber);
    if ((merged.courseId !== current.courseId || levelNumber !== current.levelNumber) && await tx.enrollment.count({ where: { trainingSessionId: id } })) throw structure.invalid('Formation et niveau verrouillés : cette session possède des inscriptions.');
    return tx.trainingSession.update({ where: { id }, data: { ...data, levelNumber } });
  });
}`);
 return s;
});
edit('src/controllers/adminSessionController.js', s => replace(s, 'name: body.name?.trim(),', "name: body.name?.trim(),\n    levelNumber: body.levelNumber === '' || body.levelNumber == null ? null : Number(body.levelNumber),"));
edit('src/services/coursePublicationPolicy.js', s => {
 s = "const structure = require('./courseStructureService');\n" + s;
 s = replace(s, "if (!textPresent(course.level)) missing.push('Niveau');", "if (!course.structureType && !textPresent(course.level)) missing.push('Niveau');\n  try { structure.parseStructure(course); } catch { missing.push('Structure de formation'); }");
 return s;
});
edit('src/services/publicCourseService.js', s => {
 s = "const { structureSelect } = require('./courseStructureService');\n" + s;
 s = s.replace(/level: true,/g, 'level: true, ...structureSelect,');
 s = s.replace(/name: true,/g, 'name: true, levelNumber: true,');
 return s;
});
edit('src/services/registrationService.js', s => {
 s = "const { structureSelect, isLevelBased, validateSessionLevel, accessLimits } = require('./courseStructureService');\n" + s;
 s = replace(s, 'name: true,', 'name: true, levelNumber: true,');
 s = s.replace(/level: true,/g, 'level: true, ...structureSelect,');
 s = replace(s, 'const state = sessionRegistrationState(session, now);', `try { validateSessionLevel(session.course, session.levelNumber); } catch (error) { throw new RegistrationError('SESSION_UNAVAILABLE', error.message); }
  if (isLevelBased(session.course) && session.levelNumber > 3) throw new RegistrationError('ACADEMIC_LEVEL_UNSUPPORTED', 'Ce niveau nécessite une prise en charge administrative. L’inscription académique au-delà du niveau 3 n’est pas encore disponible.');
  const state = sessionRegistrationState(session, now);`);
 s = replace(s, 'return { id: course.id, title: course.title, slug: course.slug, price:', 'return { ...Object.fromEntries(Object.keys(structureSelect).map(key => [key, course[key]])), id: course.id, title: course.title, slug: course.slug, price:');
 s = replace(s, 'const session = courseId\n', 'const session = !sessionId && courseId\n');
 s = replace(s, 'const level = requestedLevel ? validateLevel(requestedLevel) : null;', `if (courseId && Number(courseId) !== session.course.id) throw new RegistrationError('COURSE_UNAVAILABLE', 'La session ne correspond pas à la formation.');
      const level = registrationLevel(session, requestedLevel);`);
 s = replace(s, "status: level && level !== 'LEVEL_1' ? 'PLACEMENT_TEST_REQUIRED' : 'TRIAL_ACTIVE',", "status: level && level !== 'LEVEL_1' ? 'PLACEMENT_TEST_REQUIRED' : (accessLimits(session.course).legacy ? 'TRIAL_ACTIVE' : 'PAYMENT_REQUIRED'),");
 s = replace(s, "status: 'TRIAL_ACTIVE',\n          ...enrollmentPricingSnapshot(availableSession),", "status: registrationLevel(availableSession) && availableSession.levelNumber > 1 ? 'PLACEMENT_TEST_REQUIRED' : (accessLimits(availableSession.course).legacy ? 'TRIAL_ACTIVE' : 'PAYMENT_REQUIRED'),\n          requestedLevel: registrationLevel(availableSession),\n          approvedLevel: availableSession.levelNumber === 1 ? 'LEVEL_1' : null,\n          placementTestRequired: isLevelBased(availableSession.course) && availableSession.levelNumber > 1,\n          ...enrollmentPricingSnapshot(availableSession),");
 s = replace(s, 'function enrollmentPricingSnapshot(session) {', `function registrationLevel(session, requested) {
  if (isLevelBased(session.course)) {
    const expected = 'LEVEL_' + session.levelNumber;
    if (requested && requested !== expected) throw new RegistrationError('LEVEL_MISMATCH', 'Le niveau demandé doit correspondre au niveau de la session.');
    return validateLevel(expected);
  }
  // Preserve existing placement behavior only on historical courses.
  return accessLimits(session.course).legacy && requested ? validateLevel(requested) : null;
}

function enrollmentPricingSnapshot(session) {`);
 // Filter unsupported sessions in course selectors; direct URLs still explain the refusal.
 s = replace(s, '.filter((course) => isPublicCourse(course)', '.map(course => ({ ...course, trainingSessions: course.trainingSessions.filter(session => !isLevelBased(course) || (session.levelNumber >= 1 && session.levelNumber <= Math.min(course.numberOfLevels, 3))) }))\n    .filter((course) => isPublicCourse(course)');
 s = replace(s, "['SESSION_FULL', 'REGISTRATION_CLOSED'].includes(error.code)", "['SESSION_FULL', 'REGISTRATION_CLOSED', 'ACADEMIC_LEVEL_UNSUPPORTED', 'SESSION_UNAVAILABLE'].includes(error.code)");
 return s;
});
edit('src/controllers/registrationController.js', s => replace(s, 'form.requestedLevel = registrationService.validateLevel(form.requestedLevel);', 'if (form.requestedLevel) form.requestedLevel = registrationService.validateLevel(form.requestedLevel);'));
