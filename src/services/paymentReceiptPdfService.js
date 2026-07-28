const PDFDocument = require('pdfkit');
const centerSettings = require('./centerSettingsService');

async function generate(receipt) {
  const settings = await centerSettings.getCenterSettings();
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const payment = receipt.payment, invoice = payment.invoice, student = invoice.student;
    if (settings.documentShowCenterName) doc.fontSize(22).text(settings.officialName, { align: 'center' }).moveDown();
    const coordinates = [
      settings.documentShowAddress && [settings.address, settings.city, settings.country].filter(Boolean).join(', '),
      settings.documentShowPhone && settings.primaryPhone,
      settings.documentShowEmail && settings.email,
    ].filter(Boolean).join(' • ');
    if (coordinates) doc.fontSize(9).text(coordinates, { align: 'center' }).moveDown();
    doc.fontSize(16).text(`Reçu ${receipt.number}`, { align: 'center' }).moveDown(2);
    doc.fontSize(11).text(`Étudiant : ${student.firstName} ${student.lastName}`);
    doc.text(`Facture : ${invoice.number}`);
    doc.text(`Frais : ${invoice.lines.map((line) => line.label).join(', ')}`);
    doc.text(`Montant : ${payment.amount.toFixed(2)}${settings.documentShowCurrency ? ` ${payment.currency}` : ''}`);
    if (settings.showPaymentMethod) doc.text(`Mode : ${payment.method}`);
    doc.text(`Date : ${payment.paidAt.toLocaleString('fr-FR')}`);
    if (settings.showPaymentReference) doc.text(`Référence : ${payment.reference || '—'}`);
    if (settings.showBalanceOnReceipts) doc.text(`Solde restant : ${invoice.balanceAmount.toFixed(2)} ${invoice.currency}`);
    if (settings.documentThankYouText) doc.moveDown(2).text(settings.documentThankYouText, { align: 'center' });
    if (settings.documentFooter) doc.moveDown().fontSize(9).text(settings.documentFooter, { align: 'center' });
    doc.end();
  });
}
module.exports = { generate };
