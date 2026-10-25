// Contract backend, not a PostgreSQL emulator. Serialized transactions + rollback.
const { randomUUID } = require('node:crypto');
const equal = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array ? Buffer.from(a).equals(Buffer.from(b))
  : a instanceof Date && b instanceof Date ? +a === +b : a === b;
function match(row, where = {}) {
  return Object.entries(where).every(([key, v]) => {
    if (key === 'OR') return v.some(w => match(row, w));
    if (key === 'AND') return v.every(w => match(row, w));
    const actual = row[key] ?? null;
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array)) return Object.entries(v).every(([op, arg]) =>
      op === 'in' ? arg.includes(actual) : op === 'notIn' ? !arg.includes(actual) : op === 'lte' ? actual !== null && actual <= arg
        : op === 'lt' ? actual !== null && actual < arg : op === 'gt' ? actual !== null && actual > arg
          : op === 'gte' ? actual !== null && actual >= arg : op === 'not' ? !equal(actual, arg) : op==='startsWith'?typeof actual==='string'&&actual.startsWith(arg):op==='endsWith'?typeof actual==='string'&&actual.endsWith(arg):false);
    return equal(actual, v);
  });
}
function createMetaInboxMock(endpoint, { allowReadCommitted = false } = {}) {
  const names = ['metaWebhookEndpoint', 'metaWebhookReceipt', 'metaWebhookEvent', 'metaWebhookReceiptItem',
    'user', 'enrollment', 'whatsAppConversation', 'whatsAppPreference', 'whatsAppCommercialConsentEvent',
    'whatsAppConversationMessage', 'whatsAppProspectFollowUp', 'whatsAppDelivery', 'simulationDelivery', 'simulationConsent',
    'whatsAppChatbotSettings','whatsAppChatbotRule','whatsAppScenario','notification',
    'course','trainingSession','whatsAppAdmissionRequest','whatsAppAdmissionEvent'];
  let rows = Object.fromEntries(names.map(n => [n, []])), queue = Promise.resolve(), now = new Date('2026-10-16T12:00:00Z'), order = 0n;
  let createFailure = null, commitFailure = false, beginFailure = null;
  rows.metaWebhookEndpoint.push(structuredClone(endpoint));
  const db = { $queryRaw: async strings => strings.join('').includes('clock_timestamp') ? [{ now: new Date(now) }] : [] };
  for (const name of names) {
    const find = ({ where = {}, orderBy, take } = {}) => {
      let found = rows[name].filter(row => match(row, where));
      if (orderBy) { const keys = Array.isArray(orderBy) ? orderBy : [orderBy]; found.sort((a, b) => {
        for (const obj of keys) { const key = Object.keys(obj)[0], sign = obj[key] === 'desc' ? -1 : 1;
          if (a[key] < b[key]) return -sign; if (a[key] > b[key]) return sign; } return 0;
      }); }
      if (take) found = found.slice(0, take);
      return structuredClone(found);
    };
    db[name] = {
      findMany: async input => find(input), findFirst: async input => find(input)[0] || null,
      findUnique: async input => find(input)[0] || null, count: async input => find(input).length,
      create: async ({ data }) => {
        if (createFailure?.name === name && --createFailure.remaining === 0) { createFailure = null; throw new Error('PRIVATE_STORAGE_DETAILS'); }
        const row = { id: randomUUID(), ...(name === 'metaWebhookEvent' ? { enqueueOrder: ++order } : {}), ...structuredClone(data) };
        rows[name].push(row); return structuredClone(row);
      },
      update: async ({ where, data }) => {
        const row = rows[name].find(row => match(row, where));
        if (!row) throw Object.assign(new Error('Missing mock row'), { code: 'P2025' });
        Object.assign(row, structuredClone(data)); return structuredClone(row);
      },
      upsert: async ({ where, create, update }) => {
        const existing = rows[name].find(row => match(row, where));
        return existing ? db[name].update({ where, data: update }) : db[name].create({ data: create });
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of rows[name]) if (match(row, where)) {
          count++;
          for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
            ? row[key] + value.increment : structuredClone(value);
        }
        return { count };
      },
    };
  }
  db.$transaction = (work, options) => {
    if (options?.isolationLevel !== 'Serializable' && !(allowReadCommitted && options?.isolationLevel === 'ReadCommitted')) throw new Error('Serializable required');
    const result = queue.then(async () => {
      if (beginFailure) { const error = beginFailure; beginFailure = null; throw error; }
      const before = structuredClone(rows);
      try {
        const tx = { ...db }; delete tx.$transaction;
        const value = await work(tx);
        if (commitFailure) { const error = commitFailure; commitFailure = false; throw error; }
        return value;
      } catch (error) { rows = before; throw error; }
    });
    queue = result.catch(() => {}); return result;
  };
  return { db, rows: name => rows[name], seed: (name, row) => rows[name].push(structuredClone(row)),
    advance: ms => { now = new Date(+now + ms); }, time: () => new Date(now),
    failCreate: (name, remaining = 1) => { createFailure = { name, remaining }; }, failCommit: code => { commitFailure = Object.assign(new Error('PRIVATE_COMMIT_DETAILS'), { code }); },
    failBegin: code => { beginFailure = Object.assign(new Error('PRIVATE_DETAILS'), { code }); } };
}
module.exports = { createMetaInboxMock };
