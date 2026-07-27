require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const content = require('../src/services/learningContentService');
const lms = require('../src/services/lmsCourseService');
const access = require('../src/services/learningAccessService');
const { sanitizeRichText } = require('../src/services/lmsSanitizationService');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let admin;
let course;

test('LMS Phase 5', async (t) => {
  admin = await prisma.user.create({
    data: { firstName: 'Admin', lastName: 'LMS', phoneNumber: `+24395${Date.now()}`, passwordHash: 'x', role: 'ADMIN' },
  });

  await t.test('crée la hiérarchie réelle, nettoie le HTML et valide les liens', async () => {
    course = await lms.create({ title: 'Cours LMS', slug: `lms-${stamp}`, description: '<p>Valide</p><script>alert(1)</script>' }, admin.id);
    const module = await content.createModule(course.id, { title: 'Module 1', position: '1' });
    const chapter = await content.createChapter(module.id, { title: 'Chapitre 1', position: '1' });
    const lesson = await content.createLesson(module.id, {
      title: 'Leçon liée', position: '1', courseChapterId: String(chapter.id), type: 'LINK',
      externalUrl: 'https://example.com/lesson', content: '<p>Texte</p><img src=x onerror=alert(1)>',
    });
    assert.equal(lesson.courseChapterId, chapter.id);
    assert.match(lesson.content, /<p>Texte<\/p>/);
    assert.doesNotMatch(lesson.content, /<img/);
    assert.throws(() => content.lessonData({ title: 'X', position: 1, type: 'EMBED', externalUrl: 'javascript:alert(1)' }), /protocoles/);
  });

  await t.test('réorganise transactionnellement avec un périmètre exact', async () => {
    const first = await prisma.courseModule.findFirst({ where: { courseId: course.id } });
    const second = await content.createModule(course.id, { title: 'Module 2', position: '2' });
    await lms.reorder('courseModule', 'courseId', course.id, [second.id, first.id], admin.id, course.id);
    const rows = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { position: 'asc' } });
    assert.deepEqual(rows.map((row) => row.id), [second.id, first.id]);
    await assert.rejects(() => lms.reorder('courseModule', 'courseId', course.id, [first.id], admin.id, course.id), /tous les éléments/);
  });

  await t.test('duplique la structure sans dupliquer Assessment ni données étudiantes', async () => {
    const module = await prisma.courseModule.findFirst({ where: { courseId: course.id }, include: { chapters: true } });
    const assessment = await prisma.assessment.create({
      data: { title: 'Évaluation LMS', instructions: 'Consigne', mode: 'WRITTEN', courseId: course.id, createdById: admin.id, totalPoints: 10, passingScore: 5 },
    });
    const chapter = module.chapters[0] || await content.createChapter(module.id, { title: 'Chapitre', position: 1 });
    await content.createLesson(module.id, { title: 'Évaluation', position: 2, courseChapterId: chapter.id, assessmentId: assessment.id, completionRule: 'AFTER_ASSESSMENT_SUBMISSION' });
    const copy = await lms.duplicate(course.id, admin.id);
    const copied = await lms.detail(copy.id, admin.id);
    assert.equal(copied.lmsStatus, 'DRAFT');
    assert.ok(copied.modules.length >= 2);
    assert.equal(copied.modules.flatMap((row) => row.chapters).flatMap((row) => row.lessons).find((row) => row.assessmentId === assessment.id)?.assessmentId, assessment.id);
    assert.equal(await prisma.enrollment.count({ where: { trainingSession: { courseId: copy.id } } }), 0);
    await prisma.course.delete({ where: { id: copy.id } });
  });

  await t.test('limite le temps serveur et exclut le contenu verrouillé', () => {
    assert.equal(access.MAX_ACTIVITY_INCREMENT_SECONDS, 300);
    const visible = access.filterUnlockedModules([
      { id: 1, title: 'Publié', position: 1, isPublished: true, availableAt: null, prerequisiteModule: null, lessons: [], chapters: [] },
      { id: 2, title: 'Masqué', position: 2, isPublished: false, availableAt: null, prerequisiteModule: null, lessons: [], chapters: [] },
    ], new Set());
    assert.equal(visible.length, 0);
  });

  await t.test('sanitisation XSS idempotente au stockage', () => {
    const safe = sanitizeRichText('<h2>Titre</h2><iframe src="x"></iframe>');
    assert.equal(safe, '<h2>Titre</h2>&lt;iframe src=&quot;x&quot;&gt;&lt;/iframe&gt;');
  });

  await prisma.assessment.deleteMany({ where: { courseId: course.id } });
  await prisma.course.delete({ where: { id: course.id } });
  await prisma.user.delete({ where: { id: admin.id } });
});
