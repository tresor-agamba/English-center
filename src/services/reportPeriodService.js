class ReportFilterError extends Error {
  constructor(code, message) { super(message); this.code = code; this.statusCode = 400; }
}
const PERIODS = Object.freeze(['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM']);
function startOfDay(value) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; }
function endOfDay(value) { const d = new Date(value); d.setHours(23, 59, 59, 999); return d; }
function parseDate(value, label) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportFilterError('INVALID_DATE', `${label} est obligatoire et doit être valide.`);
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new ReportFilterError('INVALID_DATE', `${label} est invalide.`);
  return d;
}
function resolvePeriod(query = {}, now = new Date()) {
  const period = PERIODS.includes(query.period) ? query.period : 'THIS_MONTH';
  let start, end;
  if (period === 'TODAY') start = startOfDay(now), end = endOfDay(now);
  else if (period === 'THIS_WEEK') {
    start = startOfDay(now); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = endOfDay(start); end.setDate(end.getDate() + 6);
  } else if (period === 'THIS_MONTH') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    start = parseDate(query.startDate, 'La date de début');
    end = endOfDay(parseDate(query.endDate, 'La date de fin'));
    if (start > end) throw new ReportFilterError('INVALID_PERIOD', 'La date de début ne peut pas être après la date de fin.');
    if (end.getTime() - start.getTime() > 366 * 86400000) throw new ReportFilterError('PERIOD_TOO_LONG', 'La période personnalisée est limitée à 366 jours.');
  }
  return { period, start, end, dateWhere: { gte: start, lte: end } };
}
module.exports = { ReportFilterError, PERIODS, resolvePeriod };
