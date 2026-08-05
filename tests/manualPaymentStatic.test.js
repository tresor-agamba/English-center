const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('surface sécurisée du paiement manuel', () => {
  const app = fs.readFileSync('src/app.js', 'utf8');
  const adminRoutes = fs.readFileSync('src/routes/adminManualPaymentRoutes.js', 'utf8');
  const studentRoutes = fs.readFileSync('src/routes/paymentRoutes.js', 'utf8');
  const service = fs.readFileSync('src/services/manualPaymentService.js', 'utf8');
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const studentView = fs.readFileSync('views/student/payment/show.ejs', 'utf8');
  const adminView = fs.readFileSync('views/admin/payments/pending.ejs', 'utf8');

  assert.match(app, /app\.use\('\/admin\/finances', requireAdmin, adminManualPaymentRoutes\)/);
  assert.match(adminRoutes, /manual-payments\/:reference\/confirm/);
  assert.match(adminRoutes, /payment-methods\/:id\/toggle/);
  assert.match(studentRoutes, /requireStudent, asyncHandler\(controller\.proof\)/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /payment\.amount\.gt\(accessBefore\.remainingAmount\)/);
  assert.match(service, /payment\.currency !== accessBefore\.expectedCurrency/);
  assert.match(service, /fileTypeFromBuffer/);
  assert.match(service, /'application\/pdf': 'pdf'/);
  assert.match(service, /financialAuditLog/);
  assert.match(schema, /model ManualPaymentMethod/);
  assert.match(schema, /MANUAL_PAYMENT_SUBMITTED/);
  assert.match(studentView, /J’ai effectué mon paiement/);
  assert.match(studentView, /application\/pdf/);
  assert.match(adminView, /name="status"/);
  assert.match(adminView, /name="methodCode"/);
});
