require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const academic = require('../src/services/academicService');

const key = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let admin, teacher, student, course, cohort, group1, group2, enrollment, session;

test('Phase 6 — gestion académique', async (t) => {
  [admin, teacher, student] = await Promise.all([
    prisma.user.create({ data: { firstName: 'Admin', lastName: 'A', phoneNumber: `+243810${key}`, passwordHash: 'x', role: 'ADMIN' } }),
    prisma.user.create({ data: { firstName: 'Prof', lastName: 'T', phoneNumber: `+243811${key}`, passwordHash: 'x', role: 'TEACHER' } }),
    prisma.user.create({ data: { firstName: 'Élève', lastName: 'S', phoneNumber: `+243812${key}`, passwordHash: 'x', role: 'STUDENT' } }),
  ]);
  course = await prisma.course.create({ data: { title: 'Academic', slug: `academic-${key}`, isPublished: true } });

  await t.test('accepte uniquement les trois niveaux officiels', async () => {
    assert.deepEqual(academic.ACADEMIC_LEVELS, ['LEVEL_1', 'LEVEL_2', 'LEVEL_3']);
    assert.throws(() => academic.academicLevel('LEVEL_4'), /invalide/);
    cohort = await academic.createCohort({ name: 'Promotion A', code: `COH-${key}`, level: 'LEVEL_1', courseId: course.id, startDate: '2026-08-01', endDate: '2026-12-01', capacity: 2, status: 'OPEN' });
    group1 = await academic.createGroup({ cohortId: cohort.id, name: 'Groupe A', code: 'A', capacity: 1, modality: 'ONLINE', locationOrUrl: 'https://meet.example/a', status: 'ACTIVE' });
    group2 = await academic.createGroup({ cohortId: cohort.id, name: 'Groupe B', code: 'B', capacity: 2, modality: 'IN_PERSON', locationOrUrl: 'Salle 2', status: 'ACTIVE' });
    assert.equal(group1.cohortId, cohort.id);
  });

  await t.test('inscrit sans doublon et contrôle les capacités', async () => {
    enrollment = await academic.enrollStudent({ studentId: student.id, cohortId: cohort.id, groupId: group1.id, status: 'ACTIVE' }, admin.id);
    await assert.rejects(() => academic.enrollStudent({ studentId: student.id, cohortId: cohort.id, groupId: group1.id }, admin.id), /complet|déjà inscrit/);
    const other = await prisma.user.create({ data: { firstName: 'Autre', lastName: 'S', phoneNumber: `+243813${key}`, passwordHash: 'x', role: 'STUDENT' } });
    await assert.rejects(() => academic.enrollStudent({ studentId: other.id, cohortId: cohort.id, groupId: group1.id }, admin.id), /complet/);
    await prisma.user.delete({ where: { id: other.id } });
  });

  await t.test('affecte un enseignant et applique ses permissions', async () => {
    await academic.assignTeacher({ teacherId: teacher.id, cohortId: cohort.id, groupId: group1.id, role: 'PRIMARY', startsAt: '2026-07-01' }, admin.id);
    assert.equal(await academic.teacherCanAccess(teacher.id, group1.id, new Date('2026-08-01')), true);
    assert.equal(await academic.teacherCanAccess(teacher.id, group2.id, new Date('2026-08-01')), false);
  });

  await t.test('transfère entre groupes avec historique', async () => {
    const transfer = await academic.transfer(enrollment.id, group2.id, 'Changement pédagogique', admin.id);
    assert.equal(transfer.fromGroupId, group1.id);
    assert.equal((await prisma.academicEnrollment.findUnique({ where: { id: enrollment.id } })).groupId, group2.id);
    assert.equal(await prisma.academicGroupTransfer.count({ where: { enrollmentId: enrollment.id } }), 1);
    await academic.assignTeacher({ teacherId: teacher.id, cohortId: cohort.id, groupId: group2.id, role: 'PRIMARY', startsAt: '2026-07-01' }, admin.id);
  });

  await t.test('crée des séances, refuse les chevauchements et autorise les créneaux adjacents', async () => {
    session = await academic.createSession({ groupId: group2.id, teacherId: teacher.id, title: 'Cours 1', startsAt: '2026-08-03T08:00:00Z', endsAt: '2026-08-03T09:00:00Z', modality: 'IN_PERSON', locationOrUrl: 'Salle 2' }, admin.id);
    await assert.rejects(() => academic.createSession({ groupId: group2.id, teacherId: teacher.id, title: 'Conflit', startsAt: '2026-08-03T08:30:00Z', endsAt: '2026-08-03T09:30:00Z', modality: 'IN_PERSON', locationOrUrl: 'Salle 2' }, admin.id), /Conflit/);
    const adjacent = await academic.createSession({ groupId: group2.id, teacherId: teacher.id, title: 'Adjacent', startsAt: '2026-08-03T09:00:00Z', endsAt: '2026-08-03T10:00:00Z', modality: 'IN_PERSON', locationOrUrl: 'Salle 2' }, admin.id);
    assert.ok(adjacent.id);
    await academic.changeSessionStatus(adjacent.id, 'CANCELLED', 'Report pédagogique', admin.id);
  });

  await t.test('enregistre et corrige une présence unique sans convertir TECHNICAL_ISSUE', async () => {
    const first = await academic.recordAttendance({ sessionId: session.id, enrollmentId: enrollment.id, status: 'TECHNICAL_ISSUE', comment: 'Connexion' }, teacher.id, true);
    const second = await academic.recordAttendance({ sessionId: session.id, enrollmentId: enrollment.id, status: 'PRESENT' }, teacher.id, true);
    assert.equal(first.id, second.id);
    assert.equal(await prisma.academicAttendance.count({ where: { sessionId: session.id, enrollmentId: enrollment.id } }), 1);
  });

  await t.test('suspension retire l’accès LMS et réactivation le restaure', async () => {
    assert.equal(await academic.hasActiveCourseAccess(student.id, course.id), true);
    await academic.changeEnrollmentStatus(enrollment.id, 'SUSPENDED', admin.id);
    assert.equal(await academic.hasActiveCourseAccess(student.id, course.id), false);
    await academic.changeEnrollmentStatus(enrollment.id, 'ACTIVE', admin.id);
    assert.equal(await academic.hasActiveCourseAccess(student.id, course.id), true);
  });

  await t.test('isole la consultation étudiante et déduplique les notifications', async () => {
    const overview = await academic.studentOverview(student.id);
    assert.equal(overview[0].id, enrollment.id);
    assert.equal(Object.hasOwn(overview[0], 'administrativeNotes'), false);
    const keys = await prisma.notification.findMany({ where: { userId: student.id }, select: { deduplicationKey: true } });
    assert.equal(new Set(keys.map((x) => x.deduplicationKey)).size, keys.length);
  });

  await prisma.academicAttendance.deleteMany({ where: { enrollmentId: enrollment.id } });
  await prisma.academicSession.deleteMany({ where: { groupId: { in: [group1.id, group2.id] } } });
  await prisma.academicTeacherAssignment.deleteMany({ where: { cohortId: cohort.id } });
  await prisma.academicGroupTransfer.deleteMany({ where: { enrollmentId: enrollment.id } });
  await prisma.academicAuditLog.deleteMany({ where: { actorId: { in: [admin.id, teacher.id] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [student.id, teacher.id] } } });
  await prisma.academicEnrollment.delete({ where: { id: enrollment.id } });
  await prisma.academicGroup.deleteMany({ where: { cohortId: cohort.id } });
  await prisma.academicCohort.delete({ where: { id: cohort.id } });
  await prisma.course.delete({ where: { id: course.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, teacher.id, student.id] } } });
});
