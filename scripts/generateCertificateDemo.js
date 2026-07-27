const fs = require('fs');
const path = require('path');
const pdf = require('../src/services/certificatePdfService');

async function main() {
  const output = path.resolve(__dirname, '..', 'output', 'pdf');
  fs.mkdirSync(output, { recursive: true });
  const base = {
    serialNumber: 'EC-2026-DEMO001',
    verificationCode: 'DemoVerificationCode_2026_Secure',
    studentNameSnapshot: 'Grâce-Merveille Mbala Kanku',
    courseNameSnapshot: 'Anglais professionnel, communication internationale et leadership',
    sessionNameSnapshot: 'Promotion intensive — Juillet à décembre 2026',
    centerNameSnapshot: 'English Center',
    signerNameSnapshot: 'Direction English Center',
    signerTitleSnapshot: 'Direction académique',
    certificateTitleSnapshot: 'CERTIFICAT DE FIN DE FORMATION',
    certificateTextSnapshot: 'a suivi avec succès et satisfait aux exigences académiques de la formation',
    footerTextSnapshot: 'English Center — Excellence in English',
    primaryColorSnapshot: '#173B57',
    logoPathSnapshot: null,
    status: 'ISSUED',
    issuedAt: new Date('2026-07-26T00:00:00.000Z'),
  };
  const valid = await pdf.generate(base);
  const revoked = await pdf.generate({ ...base, status: 'REVOKED' }, { revokedWatermark: true });
  fs.writeFileSync(path.join(output, 'certificat-demo-english-center.pdf'), valid);
  fs.writeFileSync(path.join(output, 'certificat-demo-revoque.pdf'), revoked);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
