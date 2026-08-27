const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const prisma = require('../src/utils/prisma');
const passwordReset = require('../src/services/passwordResetService');

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/) || html.match(/name="csrf-token" content="([A-Za-z0-9_-]+)"/);
  assert.ok(match, 'Le formulaire doit contenir un jeton CSRF.');
  return match[1];
}

function cookieFrom(response, fallback = '') {
  return response.headers.get('set-cookie')?.split(';')[0] || fallback;
}

test('protection CSRF des parcours publics, étudiant et Admin', async (t) => {
  const previous = process.env.CSRF_ENFORCE;
  process.env.CSRF_ENFORCE = 'true';
  const suffix = `${Date.now()}${process.pid}`.slice(-7);
  const studentPhone = `+24381${suffix}`;
  const adminPhone = `+24382${suffix}`;
  const initialPassword = 'Temporaire@2026';
  const student = await prisma.user.create({ data: {
    firstName: 'Csrf', lastName: 'Student', phoneNumber: studentPhone,
    email: `csrf-student-${suffix}@example.test`, passwordHash: await bcrypt.hash(initialPassword, 12),
    role: 'STUDENT', mustChangePassword: true,
  } });
  const admin = await prisma.user.create({ data: {
    firstName: 'Csrf', lastName: 'Admin', phoneNumber: adminPhone,
    passwordHash: await bcrypt.hash(initialPassword, 12), role: 'ADMIN',
  } });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function get(path, cookie = '') {
    const response = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
    return { response, html: await response.text(), cookie: cookieFrom(response, cookie) };
  }

  async function post(path, body, cookie = '') {
    const response = await fetch(`${base}${path}`, { method: 'POST', body: new URLSearchParams(body), headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
    return { response, html: await response.text(), cookie: cookieFrom(response, cookie) };
  }

  async function login(phoneNumber) {
    const page = await get('/login');
    const result = await post('/login', { phoneNumber, password: initialPassword, _csrf: tokenFrom(page.html) }, page.cookie);
    assert.equal(result.response.status, 302);
    return result;
  }

  try {
    await t.test('accepte un jeton valide sur le formulaire d’inscription', async () => {
      const page = await get('/register');
      const result = await post('/register', { _csrf: tokenFrom(page.html) }, page.cookie);
      assert.equal(result.response.status, 400);
      assert.doesNotMatch(result.html, /session de formulaire a expiré/i);
    });

    await t.test('refuse un jeton absent ou incorrect', async () => {
      const page = await get('/register');
      const missing = await post('/register', {}, page.cookie);
      assert.equal(missing.response.status, 403);
      assert.match(missing.html, /session de formulaire a expiré/i);
      const invalid = await post('/register', { _csrf: 'incorrect' }, page.cookie);
      assert.equal(invalid.response.status, 403);
    });

    await t.test('protège le changement de mot de passe', async () => {
      const authenticated = await login(studentPhone);
      assert.equal(authenticated.response.headers.get('location'), '/change-password');
      const page = await get('/change-password', authenticated.cookie);
      const result = await post('/change-password', { password: 'Nouveau@2026', passwordConfirmation: 'Nouveau@2026', _csrf: tokenFrom(page.html) }, page.cookie);
      assert.equal(result.response.status, 302);
    });

    await t.test('protège la réinitialisation par jeton', async () => {
      const issued = await passwordReset.requestReset(`csrf-student-${suffix}@example.test`);
      const page = await get(`/reset-password/${issued.delivery.token}`);
      const result = await post(`/reset-password/${issued.delivery.token}`, { password: 'Reset@2026', passwordConfirmation: 'Reset@2026', _csrf: tokenFrom(page.html) }, page.cookie);
      assert.equal(result.response.status, 200);
      assert.match(result.html, /mot de passe a été modifié/i);
    });

    await t.test('protège une action Admin sensible', async () => {
      const authenticated = await login(adminPhone);
      const page = await get('/admin/students', authenticated.cookie);
      const result = await post(`/admin/students/${student.id}/toggle-status`, { _csrf: tokenFrom(page.html) }, page.cookie);
      assert.equal(result.response.status, 302);
    });
  } finally {
    process.env.CSRF_ENFORCE = previous;
    await new Promise(resolve => server.close(resolve));
    await prisma.passwordResetToken.deleteMany({ where: { userId: student.id } });
    await prisma.user.deleteMany({ where: { id: { in: [student.id, admin.id] } } });
  }
});
