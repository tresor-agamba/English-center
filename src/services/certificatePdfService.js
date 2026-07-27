const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

function publicAppUrl() {
  const raw = String(process.env.PUBLIC_APP_URL || 'http://localhost:3000').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('PUBLIC_APP_URL invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_APP_URL invalide.');
  return url.toString().replace(/\/$/, '');
}

function verificationUrl(code) {
  return `${publicAppUrl()}/certificates/verify/${encodeURIComponent(code)}`;
}

function safeLogo(relativePath) {
  if (!relativePath) return null;
  const publicRoot = path.resolve(__dirname, '..', '..', 'public');
  const candidate = path.resolve(publicRoot, String(relativePath).replace(/^[/\\]+/, ''));
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${path.sep}`)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function fileName(certificate) {
  const student = certificate.studentNameSnapshot.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'etudiant';
  return `certificat-${student}-${certificate.serialNumber}.pdf`;
}

function fitText(doc, value, maxWidth, initial, minimum = 18) {
  let size = initial;
  while (size > minimum && doc.widthOfString(value, { size }) > maxWidth) size -= 1;
  return size;
}

async function generate(certificate, { revokedWatermark = false } = {}) {
  const url = verificationUrl(certificate.verificationCode);
  const qr = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'H', margin: 1, width: 320 });
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, compress: false, info: {
    Title: certificate.certificateTitleSnapshot,
    Author: certificate.centerNameSnapshot,
    Subject: `Certificat ${certificate.serialNumber}`,
  } });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width;
  const height = doc.page.height;
  const color = /^#[0-9A-Fa-f]{6}$/.test(certificate.primaryColorSnapshot) ? certificate.primaryColorSnapshot : '#173B57';

  doc.rect(0, 0, width, height).fill('#FBFAF6');
  doc.lineWidth(5).strokeColor(color).rect(22, 22, width - 44, height - 44).stroke();
  doc.lineWidth(1).strokeColor('#C9A95E').rect(31, 31, width - 62, height - 62).stroke();
  doc.fillColor(color).polygon([42, 42], [155, 42], [42, 155]).fill();
  doc.fillColor('#C9A95E').polygon([width - 42, height - 42], [width - 155, height - 42], [width - 42, height - 155]).fill();

  const logo = safeLogo(certificate.logoPathSnapshot);
  if (logo) {
    try { doc.image(logo, width / 2 - 38, 48, { fit: [76, 60], align: 'center', valign: 'center' }); } catch { /* logo facultatif */ }
  }
  const headerY = logo ? 113 : 70;
  doc.fillColor(color).font('Helvetica-Bold').fontSize(17).text(certificate.centerNameSnapshot, 100, headerY, { width: width - 200, align: 'center' });
  doc.fillColor('#C9A95E').fontSize(11).text('EXCELLENCE • ENGAGEMENT • RÉUSSITE', 100, headerY + 28, { width: width - 200, align: 'center', characterSpacing: 1.5 });
  doc.fillColor(color).fontSize(fitText(doc, certificate.certificateTitleSnapshot, width - 220, 27, 20))
    .text(certificate.certificateTitleSnapshot, 110, headerY + 64, { width: width - 220, align: 'center' });

  doc.fillColor('#374151').font('Helvetica').fontSize(13).text('Le présent certificat atteste que', 130, headerY + 118, { width: width - 260, align: 'center' });
  doc.fillColor(color).font('Helvetica-Bold').fontSize(fitText(doc, certificate.studentNameSnapshot, width - 240, 30, 19))
    .text(certificate.studentNameSnapshot, 120, headerY + 148, { width: width - 240, align: 'center' });
  doc.strokeColor('#C9A95E').lineWidth(1).moveTo(225, headerY + 188).lineTo(width - 225, headerY + 188).stroke();
  doc.fillColor('#374151').font('Helvetica').fontSize(13)
    .text(certificate.certificateTextSnapshot, 120, headerY + 202, { width: width - 240, align: 'center' });
  doc.fillColor(color).font('Helvetica-Bold').fontSize(fitText(doc, certificate.courseNameSnapshot, width - 260, 24, 17))
    .text(certificate.courseNameSnapshot, 130, headerY + 231, { width: width - 260, align: 'center' });
  doc.fillColor('#4B5563').font('Helvetica').fontSize(11)
    .text(`Session : ${certificate.sessionNameSnapshot}`, 160, headerY + 271, { width: width - 320, align: 'center' });

  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(certificate.issuedAt);
  doc.fillColor('#374151').fontSize(10).text(`Émis le ${date}`, 90, height - 135, { width: 220, align: 'center' });
  doc.moveTo(100, height - 105).lineTo(300, height - 105).strokeColor('#9CA3AF').stroke();
  doc.fillColor(color).font('Helvetica-Bold').fontSize(11).text(certificate.signerNameSnapshot, 90, height - 96, { width: 220, align: 'center' });
  doc.fillColor('#4B5563').font('Helvetica').fontSize(9).text(certificate.signerTitleSnapshot, 90, height - 79, { width: 220, align: 'center' });

  doc.image(qr, width - 180, height - 170, { width: 88 });
  doc.fillColor('#4B5563').fontSize(7.5).text('Scanner pour vérifier', width - 194, height - 76, { width: 116, align: 'center' });
  doc.fillColor('#374151').fontSize(8).text(`N° ${certificate.serialNumber}`, width / 2 - 125, height - 105, { width: 250, align: 'center' });
  doc.fontSize(7).text(`Code : ${certificate.verificationCode}`, width / 2 - 160, height - 89, { width: 320, align: 'center' });
  doc.fillColor('#6B7280').fontSize(7).text(certificate.footerTextSnapshot, 210, height - 55, { width: width - 420, align: 'center' });

  if (revokedWatermark || certificate.status === 'REVOKED') {
    doc.save().rotate(-24, { origin: [width / 2, height / 2] }).fillColor('#B91C1C').opacity(0.18)
      .font('Helvetica-Bold').fontSize(86).text('RÉVOQUÉ', 150, height / 2 - 55, { width: width - 300, align: 'center' }).restore();
  }
  doc.end();
  return finished;
}

module.exports = { publicAppUrl, verificationUrl, fileName, generate };
