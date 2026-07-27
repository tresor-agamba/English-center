const MAX_EXPORT_ROWS = 5000;
const TYPES = Object.freeze(['students', 'enrollments', 'attendances', 'evaluations', 'payments', 'balances', 'certificates']);
function safeCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function encode(headers, rows) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeCell).join(',')).join('\r\n')}\r\n`;
}
module.exports = { MAX_EXPORT_ROWS, TYPES, safeCell, encode };
