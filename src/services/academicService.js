const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const notifications = require('./notificationService');

class AcademicError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const id = (value, label = 'élément') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new AcademicError('INVALID_ID', `${label} invalide.`);
  return parsed;
};
const text = (value, label, max = 180) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new AcademicError('INVALID_TEXT', `${label} invalide.`);
  return result;
};
const positive = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new AcademicError('INVALID_CAPACITY', `${label} doit être un entier positif.`);
  return parsed;
};
const date = (value, label) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AcademicError('INVALID_DATE', `${label} invalide.`);
  return parsed;
};
const httpUrlOrRoom = (value, modality) => {
  const result = String(value || '').trim() || null;
  if (!result) return null;
  if (modality === 'ONLINE') {
    let parsed;
    try { parsed = new URL(result); } catch { throw new AcademicError('INVALID_URL', 'Lien de cours invalide.'); }
    if (parsed.protocol !== 'https:') throw new AcademicError('INVALID_URL', 'Le lien de cours doit utiliser HTTPS.');
    return parsed.toString();
  }
  return result.slice(0, 300);
};
async function audit(tx, actorId, entityType, entityId, action, beforeData, afterData) {
  return tx.academicAuditLog.create({ data: { actorId: id(actorId, 'acteur'), entityType, entityId, action, beforeData, afterData } });
}
async function notify(userIds, type, relatedEntity, relatedId, title, key, client = prisma) {
  return notifications.createNotificationsForUsers(userIds, {
    type, title, message: title, actionUrl: '/student/academic', relatedEntity, relatedId,
  }, key, client);
}

const ACADEMIC_LEVELS = Object.freeze(['LEVEL_1', 'LEVEL_2', 'LEVEL_3']);
const academicLevel = (value) => {
  if (!ACADEMIC_LEVELS.includes(value)) throw new AcademicError('INVALID_ACADEMIC_LEVEL', 'Niveau académique invalide.');
  return value;
};
async function createCohort(body) {
  const startDate = date(body.startDate, 'Date de début'), endDate = date(body.endDate, 'Date de fin');
  if (endDate <= startDate) throw new AcademicError('INVALID_PERIOD', 'La fin doit suivre le début.');
  return prisma.academicCohort.create({ data: {
    name: text(body.name, 'Nom'), code: text(body.code, 'Code', 60).toUpperCase(),
    level: academicLevel(body.level), courseId: id(body.courseId, 'cours'),
    startDate, endDate, capacity: positive(body.capacity, 'Capacité'),
    description: String(body.description || '').trim() || null,
    academicManagerId: body.academicManagerId ? id(body.academicManagerId) : null,
    status: body.status || 'DRAFT',
  } });
}
async function createGroup(body) {
  const cohort = await prisma.academicCohort.findUnique({ where: { id: id(body.cohortId, 'cohorte') } });
  if (!cohort) throw new AcademicError('COHORT_NOT_FOUND', 'Cohorte introuvable.', 404);
  const capacity = positive(body.capacity, 'Capacité');
  if (capacity > cohort.capacity) throw new AcademicError('CAPACITY_EXCEEDED', 'La capacité du groupe dépasse celle de la cohorte.');
  const modality = ['ONLINE', 'IN_PERSON', 'HYBRID'].includes(body.modality) ? body.modality : 'ONLINE';
  return prisma.academicGroup.create({ data: {
    cohortId: cohort.id, name: text(body.name, 'Nom'), code: text(body.code, 'Code', 60).toUpperCase(),
    capacity, modality, locationOrUrl: httpUrlOrRoom(body.locationOrUrl, modality),
    usualDays: Array.isArray(body.usualDays) ? body.usualDays : [], usualStartTime: body.usualStartTime || null,
    usualEndTime: body.usualEndTime || null, status: body.status || 'DRAFT',
  } });
}

async function enrollStudent(body, actorId) {
  return prisma.$transaction(async (tx) => {
    const studentId = id(body.studentId, 'étudiant'), cohortId = id(body.cohortId, 'cohorte');
    const [student, cohort] = await Promise.all([
      tx.user.findFirst({ where: { id: studentId, role: 'STUDENT', isActive: true } }),
      tx.academicCohort.findUnique({ where: { id: cohortId } }),
    ]);
    if (!student || !cohort) throw new AcademicError('NOT_FOUND', 'Étudiant ou cohorte introuvable.', 404);
    if (!['OPEN', 'ACTIVE'].includes(cohort.status)) throw new AcademicError('COHORT_CLOSED', 'Cette cohorte est fermée aux inscriptions.', 409);
    const groupId = body.groupId ? id(body.groupId, 'groupe') : null;
    if (groupId) {
      const group = await tx.academicGroup.findFirst({ where: { id: groupId, cohortId } });
      if (!group) throw new AcademicError('GROUP_COHORT_MISMATCH', 'Le groupe n’appartient pas à la cohorte.');
      const groupCount = await tx.academicEnrollment.count({ where: { groupId, status: { in: ['PENDING', 'ACTIVE'] } } });
      if (groupCount >= group.capacity) throw new AcademicError('GROUP_FULL', 'Le groupe est complet.', 409);
    }
    const count = await tx.academicEnrollment.count({ where: { cohortId, status: { in: ['PENDING', 'ACTIVE'] } } });
    if (count >= cohort.capacity) throw new AcademicError('COHORT_FULL', 'La cohorte est complète.', 409);
    let enrollment;
    try {
      enrollment = await tx.academicEnrollment.create({ data: {
        studentId, cohortId, groupId, entryLevel: body.entryLevel ? academicLevel(body.entryLevel) : null,
        status: body.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING', source: String(body.source || '').trim() || null,
        administrativeNotes: String(body.administrativeNotes || '').trim() || null,
      } });
    } catch (error) {
      if (error.code === 'P2002') throw new AcademicError('DUPLICATE_ENROLLMENT', 'Cet étudiant est déjà inscrit à cette cohorte.', 409);
      throw error;
    }
    await audit(tx, actorId, 'ACADEMIC_ENROLLMENT', enrollment.id, 'CREATED', null, { status: enrollment.status, groupId });
    await notify([studentId], 'ENROLLMENT_CREATED', 'ACADEMIC_ENROLLMENT', enrollment.id, 'Inscription académique créée', `ACADEMIC_ENROLLMENT:${enrollment.id}:CREATED`, tx);
    if (groupId) await notify([studentId], 'GROUP_ASSIGNED', 'ACADEMIC_GROUP', groupId, 'Groupe académique attribué', `ACADEMIC_ENROLLMENT:${enrollment.id}:GROUP:${groupId}`, tx);
    return enrollment;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function changeEnrollmentStatus(enrollmentId, status, actorId) {
  const allowed = { PENDING: ['ACTIVE', 'CANCELLED'], ACTIVE: ['SUSPENDED', 'COMPLETED', 'DROPPED'], SUSPENDED: ['ACTIVE', 'CANCELLED', 'DROPPED'], COMPLETED: [], CANCELLED: [], DROPPED: [] };
  return prisma.$transaction(async (tx) => {
    const current = await tx.academicEnrollment.findUnique({ where: { id: id(enrollmentId, 'inscription') } });
    if (!current) throw new AcademicError('ENROLLMENT_NOT_FOUND', 'Inscription introuvable.', 404);
    if (!allowed[current.status].includes(status)) throw new AcademicError('INVALID_TRANSITION', 'Transition d’inscription invalide.', 409);
    const updated = await tx.academicEnrollment.update({ where: { id: current.id }, data: {
      status, suspendedAt: status === 'SUSPENDED' ? new Date() : status === 'ACTIVE' ? null : current.suspendedAt,
      endedAt: ['COMPLETED', 'CANCELLED', 'DROPPED'].includes(status) ? new Date() : null,
    } });
    await audit(tx, actorId, 'ACADEMIC_ENROLLMENT', current.id, 'STATUS_CHANGED', { status: current.status }, { status });
    await notify([current.studentId], status === 'SUSPENDED' ? 'ENROLLMENT_SUSPENDED' : 'ENROLLMENT_UPDATED', 'ACADEMIC_ENROLLMENT', current.id, 'Inscription académique mise à jour', `ACADEMIC_ENROLLMENT:${current.id}:STATUS:${status}`, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function transfer(enrollmentId, toGroupId, reason, actorId) {
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.academicEnrollment.findUnique({ where: { id: id(enrollmentId) } });
    const group = await tx.academicGroup.findUnique({ where: { id: id(toGroupId, 'groupe') } });
    if (!enrollment || !group || group.cohortId !== enrollment.cohortId) throw new AcademicError('TRANSFER_MISMATCH', 'Transfert incohérent.', 409);
    if (group.id === enrollment.groupId) throw new AcademicError('SAME_GROUP', 'L’étudiant appartient déjà à ce groupe.');
    const count = await tx.academicEnrollment.count({ where: { groupId: group.id, status: { in: ['PENDING', 'ACTIVE'] } } });
    if (count >= group.capacity) throw new AcademicError('GROUP_FULL', 'Le groupe est complet.', 409);
    const transferRow = await tx.academicGroupTransfer.create({ data: {
      enrollmentId: enrollment.id, fromGroupId: enrollment.groupId, toGroupId: group.id,
      transferredById: id(actorId), reason: text(reason, 'Motif', 1000),
    } });
    await tx.academicEnrollment.update({ where: { id: enrollment.id }, data: { groupId: group.id } });
    await audit(tx, actorId, 'ACADEMIC_ENROLLMENT', enrollment.id, 'GROUP_TRANSFERRED', { groupId: enrollment.groupId }, { groupId: group.id });
    await notify([enrollment.studentId], 'GROUP_ASSIGNED', 'ACADEMIC_GROUP', group.id, 'Nouveau groupe académique', `TRANSFER:${transferRow.id}`, tx);
    return transferRow;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function assignTeacher(body, actorId) {
  return prisma.$transaction(async (tx) => {
    const teacher = await tx.user.findFirst({ where: { id: id(body.teacherId), role: 'TEACHER', isActive: true } });
    const cohort = await tx.academicCohort.findUnique({ where: { id: id(body.cohortId) } });
    if (!teacher || !cohort) throw new AcademicError('NOT_FOUND', 'Enseignant ou cohorte introuvable.', 404);
    const groupId = body.groupId ? id(body.groupId) : null;
    if (groupId && !(await tx.academicGroup.findFirst({ where: { id: groupId, cohortId: cohort.id } }))) throw new AcademicError('GROUP_COHORT_MISMATCH', 'Groupe invalide.');
    const assignment = await tx.academicTeacherAssignment.create({ data: {
      teacherId: teacher.id, cohortId: cohort.id, groupId, role: body.role || (groupId ? 'SECONDARY' : 'COHORT_MANAGER'),
      startsAt: date(body.startsAt || new Date(), 'Début'), endsAt: body.endsAt ? date(body.endsAt, 'Fin') : null, assignedById: id(actorId),
    } });
    await notify([teacher.id], 'TEACHER_ASSIGNED', 'ACADEMIC_GROUP', groupId || cohort.id, 'Affectation académique', `ACADEMIC_TEACHER_ASSIGNMENT:${assignment.id}`, tx);
    return assignment;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function teacherCanAccess(teacherId, groupId, at = new Date()) {
  return Boolean(await prisma.academicTeacherAssignment.findFirst({ where: {
    teacherId: id(teacherId), groupId: id(groupId), removedAt: null, startsAt: { lte: at },
    OR: [{ endsAt: null }, { endsAt: { gte: at } }],
  } }));
}

async function createSession(body, actorId, enforceTeacher = false) {
  return prisma.$transaction(async (tx) => {
    const groupId = id(body.groupId, 'groupe'), teacherId = id(body.teacherId, 'enseignant');
    const group = await tx.academicGroup.findUnique({ where: { id: groupId }, include: { cohort: true } });
    if (!group) throw new AcademicError('GROUP_NOT_FOUND', 'Groupe introuvable.', 404);
    if (enforceTeacher && !(await teacherCanAccess(actorId, groupId))) throw new AcademicError('ACCESS_DENIED', 'Groupe non autorisé.', 403);
    const startsAt = date(body.startsAt, 'Début'), endsAt = date(body.endsAt, 'Fin');
    if (endsAt <= startsAt) throw new AcademicError('INVALID_PERIOD', 'La fin doit suivre le début.');
    if (body.lessonId && !(await tx.courseLesson.findFirst({ where: { id: id(body.lessonId), courseModule: { courseId: group.cohort.courseId } } }))) throw new AcademicError('LESSON_COURSE_MISMATCH', 'Leçon invalide.');
    const conflict = await tx.academicSession.findFirst({ where: {
      status: { in: ['SCHEDULED', 'IN_PROGRESS', 'RESCHEDULED'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
      OR: [{ groupId }, { teacherId }, ...(body.modality === 'IN_PERSON' && body.locationOrUrl ? [{ modality: 'IN_PERSON', locationOrUrl: String(body.locationOrUrl) }] : [])],
    } });
    if (conflict) throw new AcademicError('SCHEDULE_CONFLICT', 'Conflit de calendrier.', 409);
    const modality = body.modality || group.modality;
    const session = await tx.academicSession.create({ data: {
      groupId, teacherId, lessonId: body.lessonId ? id(body.lessonId) : null, title: text(body.title, 'Titre'),
      description: String(body.description || '').trim() || null, startsAt, endsAt, modality,
      locationOrUrl: httpUrlOrRoom(body.locationOrUrl || group.locationOrUrl, modality),
    } });
    const students = await tx.academicEnrollment.findMany({ where: { groupId, status: 'ACTIVE' }, select: { studentId: true } });
    await notify(students.map((row) => row.studentId), 'ACADEMIC_SESSION_SCHEDULED', 'ACADEMIC_SESSION', session.id, 'Nouvelle séance académique', `ACADEMIC_SESSION:${session.id}:SCHEDULED`, tx);
    await audit(tx, actorId, 'ACADEMIC_SESSION', session.id, 'CREATED', null, { startsAt, endsAt });
    return session;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function changeSessionStatus(sessionId, status, reason, actorId) {
  const allowed = { SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'RESCHEDULED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'], RESCHEDULED: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };
  return prisma.$transaction(async (tx) => {
    const current = await tx.academicSession.findUnique({ where: { id: id(sessionId) }, include: { group: { include: { enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } } } });
    if (!current) throw new AcademicError('SESSION_NOT_FOUND', 'Séance introuvable.', 404);
    if (!allowed[current.status].includes(status)) throw new AcademicError('INVALID_TRANSITION', 'Transition de séance invalide.', 409);
    if (status === 'CANCELLED' && !String(reason || '').trim()) throw new AcademicError('REASON_REQUIRED', 'Le motif d’annulation est obligatoire.');
    const updated = await tx.academicSession.update({ where: { id: current.id }, data: { status, cancellationReason: status === 'CANCELLED' ? text(reason, 'Motif', 1000) : null } });
    await audit(tx, actorId, 'ACADEMIC_SESSION', current.id, 'STATUS_CHANGED', { status: current.status }, { status });
    const type = status === 'CANCELLED' ? 'ACADEMIC_SESSION_CANCELLED' : 'ACADEMIC_SESSION_UPDATED';
    await notify(current.group.enrollments.map((row) => row.studentId), type, 'ACADEMIC_SESSION', current.id, 'Séance académique mise à jour', `ACADEMIC_SESSION:${current.id}:STATUS:${status}`, tx);
    return updated;
  });
}

async function recordAttendance(body, actorId, enforceTeacher = false) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.academicSession.findUnique({ where: { id: id(body.sessionId) } });
    const enrollment = await tx.academicEnrollment.findUnique({ where: { id: id(body.enrollmentId) } });
    if (!session || !enrollment || enrollment.groupId !== session.groupId || enrollment.status !== 'ACTIVE') throw new AcademicError('ATTENDANCE_SCOPE', 'Étudiant non inscrit activement à ce groupe.', 403);
    if (enforceTeacher && !(await teacherCanAccess(actorId, session.groupId, session.startsAt))) throw new AcademicError('ACCESS_DENIED', 'Groupe non autorisé.', 403);
    const status = body.status;
    if (!['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'TECHNICAL_ISSUE'].includes(status)) throw new AcademicError('INVALID_STATUS', 'Statut de présence invalide.');
    const existing = await tx.academicAttendance.findUnique({ where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id } } });
    const data = {
      status, arrivedAt: body.arrivedAt ? date(body.arrivedAt, 'Arrivée') : null, leftAt: body.leftAt ? date(body.leftAt, 'Départ') : null,
      lateMinutes: status === 'LATE' ? Math.max(0, Math.min(Number(body.lateMinutes) || 0, 1440)) : 0,
      comment: String(body.comment || '').trim() || null, justification: String(body.justification || '').trim() || null, recordedById: id(actorId),
    };
    const attendance = await tx.academicAttendance.upsert({
      where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id } },
      create: { sessionId: session.id, enrollmentId: enrollment.id, ...data }, update: data,
    });
    await audit(tx, actorId, 'ACADEMIC_ATTENDANCE', attendance.id, existing ? 'UPDATED' : 'CREATED', existing, data);
    await notify([enrollment.studentId], 'ATTENDANCE_RECORDED', 'ACADEMIC_ATTENDANCE', attendance.id, 'Présence enregistrée', `ACADEMIC_ATTENDANCE:${attendance.id}:${attendance.updatedAt.toISOString()}`, tx);
    return attendance;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function studentOverview(studentId) {
  return prisma.academicEnrollment.findMany({
    where: { studentId: id(studentId), status: { in: ['ACTIVE', 'SUSPENDED', 'COMPLETED'] } },
    select: {
      id: true, status: true, enrolledAt: true, suspendedAt: true, endedAt: true,
      cohort: { select: { id: true, name: true, code: true, level: true, startDate: true, endDate: true, course: { select: { id: true, title: true } } } },
      group: { select: { id: true, name: true, code: true, modality: true, locationOrUrl: true, teachers: { where: { removedAt: null }, select: { role: true, teacher: { select: { firstName: true, lastName: true } } } }, sessions: { where: { status: { not: 'CANCELLED' } }, orderBy: { startsAt: 'asc' }, select: { id: true, title: true, startsAt: true, endsAt: true, modality: true, status: true } } } },
      attendances: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, arrivedAt: true, leftAt: true, lateMinutes: true, comment: true, session: { select: { title: true, startsAt: true } } } },
    },
  });
}
async function teacherOverview(teacherId) {
  return prisma.academicTeacherAssignment.findMany({
    where: { teacherId: id(teacherId), removedAt: null },
    select: { id: true, role: true, startsAt: true, endsAt: true, cohort: { select: { id: true, name: true } }, group: { select: { id: true, name: true, enrollments: { where: { status: 'ACTIVE' }, select: { id: true, student: { select: { id: true, firstName: true, lastName: true } } } }, sessions: { orderBy: { startsAt: 'asc' } } } } },
  });
}
async function hasActiveCourseAccess(studentId, courseId) {
  return Boolean(await prisma.academicEnrollment.findFirst({ where: { studentId: id(studentId), status: 'ACTIVE', cohort: { courseId: id(courseId) } }, select: { id: true } }));
}

module.exports = {
  AcademicError, ACADEMIC_LEVELS, academicLevel, createCohort, createGroup, enrollStudent, changeEnrollmentStatus,
  transfer, assignTeacher, teacherCanAccess, createSession, changeSessionStatus, recordAttendance,
  studentOverview, teacherOverview, hasActiveCourseAccess,
};
