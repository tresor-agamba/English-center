function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedDateTimeToUtc(dateValue, timeValue, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) return null;
  if (!validateTimeZone(timeZone)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant += desired - represented;
  }
  return new Date(instant);
}

function dateKeyInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function inputPartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

module.exports = { validateTimeZone, zonedDateTimeToUtc, dateKeyInZone, inputPartsInZone };
