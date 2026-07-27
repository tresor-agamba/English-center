const PDFDocument = require('pdfkit');

function generate(receipt) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const payment = receipt.payment, invoice = payment.invoice, student = invoice.student;
    doc.fontSize(22).text('English Center', { align: 'center' }).moveDown();
    doc.fontSize(16).text(`Reçu ${receipt.number}`, { align: 'center' }).moveDown(2);
    doc.fontSize(11).text(`Étudiant : ${student.firstName} ${student.lastName}`);
    doc.text(`Facture : ${invoice.number}`);
    doc.text(`Frais : ${invoice.lines.map((line) => line.label).join(', ')}`);
    doc.text(`Montant : ${payment.amount.toFixed(2)} ${payment.currency}`);
    doc.text(`Mode : ${payment.method}`);
    doc.text(`Date : ${payment.paidAt.toLocaleString('fr-FR')}`);
    doc.text(`Référence : ${payment.reference || '—'}`);
    doc.text(`Solde restant : ${invoice.balanceAmount.toFixed(2)} ${invoice.currency}`);
    doc.end();
  });
}
module.exports = { generate };
