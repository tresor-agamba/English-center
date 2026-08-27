const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const registration = require('../src/services/registrationService');
const passwordReset = require('../src/services/passwordResetService');

test('NVA — groupes, inscription partagée et récupération', async (t) => {
  const key = `${Date.now()}-${process.pid}`; const now = new Date();
  const course = await prisma.course.create({ data: { title: `Parcours anglais ${key}`, slug: `nva-completion-${key}`, description: 'Parcours public avec groupes', level: 'Débutant', durationValue: 8, durationUnit: 'WEEKS', price: '60', currency: 'USD', pricingActive: true, pricingMode: 'ONE_TIME', isPublished: true, lmsStatus: 'PUBLISHED', publishedAt: now } });
  const session = await prisma.trainingSession.create({ data: { name: 'Septembre 2026', courseId: course.id, startDate: new Date(now.getTime() + 864000000), endDate: new Date(now.getTime() + 5702400000), registrationDeadline: new Date(now.getTime() + 432000000), capacity: 3, weekDays: ['FRIDAY','SATURDAY'], startTime: '10:00', endTime: '11:30', status: 'OPEN' } });
  const groups = await Promise.all([
    prisma.registrationGroup.create({ data: { trainingSessionId: session.id, name: 'A', weekDays: ['FRIDAY','SATURDAY'], startTime: '10:00', endTime: '11:30', capacity: 1 } }),
    prisma.registrationGroup.create({ data: { trainingSessionId: session.id, name: 'B', weekDays: ['FRIDAY','SATURDAY'], startTime: '16:00', endTime: '17:30', capacity: 2 } }),
    prisma.registrationGroup.create({ data: { trainingSessionId: session.id, name: 'C', weekDays: ['FRIDAY','SATURDAY'], startTime: '18:00', endTime: '19:30', capacity: 2, isActive: false } }),
  ]);
  const userIds = [];
  try {
    const make = async (phone, groupId, extra = {}) => {
      const result = await registration.createStudentEnrollment({ courseId: course.id, groupId, firstName: 'Nva', lastName: 'Test', phoneNumber: phone, email: extra.email, passwordHash: await bcrypt.hash('Initial@2026', 12), requestedLevel: 'LEVEL_1', ...extra }); userIds.push(result.user.id); return result;
    };
    const first = await make(`+24381${String(Date.now()).slice(-7)}`, groups[0].id, { email: `nva-${key}@example.test` });
    await t.test('capacité indépendante et groupe plein', async () => {
      await assert.rejects(() => make(`+24382${String(Date.now()).slice(-7)}`, groups[0].id), error => error.code === 'GROUP_FULL');
      const second = await make(`+24383${String(Date.now()).slice(-7)}`, groups[1].id); assert.equal(second.enrollment.registrationGroupId, groups[1].id);
    });
    await t.test('groupe désactivé et doublon refusés', async () => {
      await assert.rejects(() => make(`+24384${String(Date.now()).slice(-7)}`, groups[2].id), error => error.code === 'GROUP_UNAVAILABLE');
      await assert.rejects(() => registration.createStudentEnrollment({ courseId: course.id, groupId: groups[1].id, firstName: 'Nva', lastName: 'Test', phoneNumber: first.user.phoneNumber, passwordHash: 'unused', requestedLevel: 'LEVEL_1', allowExistingUser: true }), error => error.code === 'DUPLICATE_ENROLLMENT');
    });
    await t.test('jeton hashé, expirant et à usage unique', async () => {
      const issued = await passwordReset.requestReset(`nva-${key}@example.test`); assert.ok(issued.delivery.token);
      assert.equal(await prisma.passwordResetToken.count({ where: { tokenHash: issued.delivery.token } }), 0);
      await passwordReset.resetPassword(issued.delivery.token, 'Nouveau@2026');
      assert.equal(Boolean(await require('../src/services/authService').authenticate(first.user.phoneNumber, 'Nouveau@2026')), true);
      await assert.rejects(() => passwordReset.resetPassword(issued.delivery.token, 'Encore@2026'), error => error.code === 'INVALID_TOKEN');
      const expired = await passwordReset.requestReset(`nva-${key}@example.test`); await prisma.passwordResetToken.updateMany({ where: { userId: first.user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(() => passwordReset.resetPassword(expired.delivery.token, 'Expire@2026'), error => error.code === 'INVALID_TOKEN');
    });
  } finally {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.enrollment.deleteMany({ where: { userId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.registrationGroup.deleteMany({ where: { trainingSessionId: session.id } }); await prisma.trainingSession.delete({ where: { id: session.id } }); await prisma.course.delete({ where: { id: course.id } });
  }
});
