const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const studentService = require('../src/services/studentService');
const authService = require('../src/services/authService');
const studentController = require('../src/controllers/adminStudentController');
const requireAdmin = require('../src/middlewares/requireAdmin');
const { normalizePhoneNumber } = require('../src/utils/phone.util');

function middlewareResult(user) {
  let result;
  requireAdmin(
    { session: { user } },
    { redirect: (url) => { result = { redirect: url }; } },
    (error) => { result = error ? { status: error.statusCode } : { allowed: true }; }
  );
  return result;
}

function mockFormResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, data) {
      this.view = view;
      this.data = data;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
  };
}

test('module administrateur des étudiants', async (t) => {
  let studentId;
  const suffix = String(Date.now()).slice(-8);
  const phoneNumber = normalizePhoneNumber(`089${suffix.slice(0, 7)}`);
  const updatedPhoneNumber = normalizePhoneNumber(`088${suffix.slice(0, 7)}`);
  const initialPassword = 'Temporaire@2026';
  const newPassword = 'Nouveau@2026';

  try {
    await t.test('valide les numéros et la confirmation du mot de passe', async () => {
      assert.throws(() => normalizePhoneNumber('123'), /invalide/i);

      const invalidPhoneResponse = mockFormResponse();
      await studentController.create(
        {
          body: {
            firstName: 'Test',
            lastName: 'Étudiant',
            phoneNumber: '123',
            password: initialPassword,
            passwordConfirmation: initialPassword,
          },
        },
        invalidPhoneResponse
      );
      assert.equal(invalidPhoneResponse.statusCode, 400);
      assert.match(invalidPhoneResponse.data.error, /invalide/i);

      const response = mockFormResponse();
      await studentController.create(
        {
          body: {
            firstName: 'Test',
            lastName: 'Étudiant',
            phoneNumber,
            password: initialPassword,
            passwordConfirmation: 'Different@2026',
          },
        },
        response
      );
      assert.equal(response.statusCode, 400);
      assert.match(response.data.error, /ne correspondent pas/i);
    });

    await t.test('crée un étudiant valide et rejette le doublon', async () => {
      const passwordHash = await bcrypt.hash(initialPassword, 12);
      const student = await studentService.create({
        firstName: 'RecherchePrenom',
        lastName: 'RechercheNom',
        phoneNumber,
        passwordHash,
      });
      studentId = student.id;
      assert.equal(student.role, 'STUDENT');
      assert.equal(student.isActive, true);
      assert.equal(Object.hasOwn(student, 'passwordHash'), false);

      await assert.rejects(
        studentService.create({
          firstName: 'Doublon',
          lastName: 'Téléphone',
          phoneNumber,
          passwordHash,
        }),
        (error) => error.code === 'P2002'
      );

      const duplicateResponse = mockFormResponse();
      await studentController.create(
        {
          body: {
            firstName: 'Doublon',
            lastName: 'Téléphone',
            phoneNumber,
            password: initialPassword,
            passwordConfirmation: initialPassword,
          },
        },
        duplicateResponse
      );
      assert.equal(duplicateResponse.statusCode, 400);
      assert.equal(duplicateResponse.data.error, 'Ce numéro de téléphone est déjà utilisé.');
    });

    await t.test('recherche par prénom, nom et fragment de téléphone', async () => {
      for (const search of ['RecherchePrenom', 'RechercheNom', phoneNumber.slice(-6)]) {
        const result = await studentService.list({ search, page: 1 });
        assert.ok(result.students.some((student) => student.id === studentId));
      }
    });

    await t.test('modifie uniquement un étudiant et refuse un compte ADMIN', async () => {
      const updated = await studentService.update(studentId, {
        firstName: 'PrénomModifié',
        lastName: 'NomModifié',
        phoneNumber: updatedPhoneNumber,
      });
      assert.equal(updated.count, 1);

      const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
      assert.ok(admin);
      const blocked = await studentService.update(admin.id, { firstName: 'Interdit' });
      assert.equal(blocked.count, 0);
      const unchangedAdmin = await prisma.user.findUnique({ where: { id: admin.id } });
      assert.equal(unchangedAdmin.firstName, admin.firstName);
    });

    await t.test('désactive, refuse la connexion puis réactive', async () => {
      assert.equal((await studentService.setActive(studentId, false)).count, 1);
      assert.equal(await authService.authenticate(updatedPhoneNumber, initialPassword), null);
      assert.equal((await studentService.setActive(studentId, true)).count, 1);
      assert.equal((await authService.authenticate(updatedPhoneNumber, initialPassword)).id, studentId);
    });

    await t.test('réinitialise le mot de passe et authentifie le nouveau', async () => {
      const passwordHash = await bcrypt.hash(newPassword, 12);
      assert.equal((await studentService.resetPassword(studentId, passwordHash)).count, 1);
      assert.equal(await authService.authenticate(updatedPhoneNumber, initialPassword), null);
      assert.equal((await authService.authenticate(updatedPhoneNumber, newPassword)).id, studentId);
    });

    await t.test('protège toutes les routes avec requireAdmin', () => {
      assert.deepEqual(middlewareResult(undefined), { redirect: '/login' });
      assert.deepEqual(middlewareResult({ role: 'STUDENT' }), { status: 403 });
      assert.deepEqual(middlewareResult({ role: 'ADMIN' }), { allowed: true });
    });
  } finally {
    if (studentId) await prisma.user.delete({ where: { id: studentId } });
    await prisma.$disconnect();
  }
});
