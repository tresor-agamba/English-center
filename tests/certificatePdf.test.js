const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const pdf = require('../src/services/certificatePdfService');

function sample(overrides = {}) {
  return {
    serialNumber: 'EC-2026-ABC123',
    verificationCode: 'R4ndomSecureVerificationCode_123',
    studentNameSnapshot: 'Grâce-Merveille Mbala Kanku',
    courseNameSnapshot: 'Anglais professionnel, communication internationale et leadership',
    sessionNameSnapshot: 'Session intensive 2026',
    centerNameSnapshot: 'English Center',
    signerNameSnapshot: 'Direction English Center',
    signerTitleSnapshot: 'Direction académique',
    certificateTitleSnapshot: 'CERTIFICAT DE FIN DE FORMATION',
    certificateTextSnapshot: 'a suivi avec succès la formation',
    footerTextSnapshot: 'English Center — Excellence in English',
    primaryColorSnapshot: '#173B57',
    logoPathSnapshot: null,
    status: 'ISSUED',
    issuedAt: new Date('2026-07-26T00:00:00Z'),
    ...overrides,
  };
}

describe('PDF et vérification des certificats', () => {
  it('construit le lien QR uniquement depuis PUBLIC_APP_URL', () => {
    const previous = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = 'https://certificates.example.org/base/';
    assert.equal(pdf.verificationUrl('abc_DEF-123'), 'https://certificates.example.org/base/certificates/verify/abc_DEF-123');
    if (previous === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previous;
  });

  it('produit un vrai PDF A4 paysage sur une seule page, sans logo', async () => {
    const buffer = await pdf.generate(sample());
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buffer.length > 8_000);
    assert.equal((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  });

  it('supporte les noms longs et ajoute un filigrane au PDF révoqué', async () => {
    const buffer = await pdf.generate(sample({
      studentNameSnapshot: 'Jean-Baptiste Alexandre Théophile Mukendi wa Tshibangu',
      status: 'REVOKED',
    }), { revokedWatermark: true });
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buffer.length > 8_000);
    assert.equal((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  });

  it('génère un nom de téléchargement sûr', () => {
    assert.equal(pdf.fileName(sample()), 'certificat-Grace-Merveille-Mbala-Kanku-EC-2026-ABC123.pdf');
  });
});
