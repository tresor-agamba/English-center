const INVALID_PHONE_MESSAGE = 'Numéro de téléphone invalide.';

function normalizePhoneNumber(rawPhoneNumber) {
  if (typeof rawPhoneNumber !== 'string' || !rawPhoneNumber.trim()) {
    throw new Error(INVALID_PHONE_MESSAGE);
  }

  const cleaned = rawPhoneNumber.trim().replace(/[\s\-()]/g, '');
  let nationalNumber;

  if (/^0[89]\d{8}$/.test(cleaned)) nationalNumber = cleaned.slice(1);
  else if (/^[89]\d{8}$/.test(cleaned)) nationalNumber = cleaned;
  else if (/^243[89]\d{8}$/.test(cleaned)) nationalNumber = cleaned.slice(3);
  else if (/^\+243[89]\d{8}$/.test(cleaned)) nationalNumber = cleaned.slice(4);
  else throw new Error(INVALID_PHONE_MESSAGE);

  return `+243${nationalNumber}`;
}

module.exports = { normalizePhoneNumber, INVALID_PHONE_MESSAGE };
