// Contract mock only: not evidence of PostgreSQL constraints or MVCC behavior.
const { randomUUID } = require('node:crypto');
function equal(a, b) {
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.from(a).equals(Buffer.from(b));
  return a instanceof Date && b instanceof Date ? +a === +b : a === b;
}
function match(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(w => match(row, w));
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Uint8Array))
      return Object.entries(value).every(([op, arg]) => op === 'in' ? arg.includes(row[key])
        : op === 'lte' ? row[key] <= arg : op === 'gt' ? row[key] > arg : op === 'not' ? !equal(row[key] ?? null, arg) : false);
    return equal(row[key] ?? null, value);
  });
}
function createPersistenceMock(application) {
  let rows = {}, queue = Promise.resolve(), time = new Date('2026-10-16T12:00:00Z'), nextError = null, failingCreate = null;
  const names = ['providerApplication', 'providerDelivery', 'providerSendAttempt', 'providerMessageAlias', 'providerWebhookEvent',
    'providerReconciliationAudit', 'whatsAppConversationMessage', 'whatsAppDelivery', 'whatsAppProspectFollowUp'];
  for (const n of names) rows[n] = [];
  rows.providerApplication.push(structuredClone(application));
  const db = { $queryRaw: async () => [{ now: new Date(time) }] };
  for (const name of names) db[name] = {
    async findFirst({ where, orderBy } = {}) {
      const found = rows[name].filter(r => match(r, where));
      if (orderBy) found.sort((a, b) => { for (const order of orderBy) { const k = Object.keys(order)[0]; if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; });
      return structuredClone(found[0] || null);
    },
    async create({ data }) {
      if (failingCreate === name) { failingCreate = null; throw Object.assign(new Error('Synthetic write failure'), { code: 'STORAGE_WRITE_FAILED' }); }
      const row = { id: randomUUID(), leaseGeneration: 0n, processAttempts: 0, ...structuredClone(data) };
      rows[name].push(row); return structuredClone(row);
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const row of rows[name]) if (match(row, where)) {
        count++;
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
          ? row[key] + value.increment : structuredClone(value);
      }
      return { count };
    },
  };
  db.$transaction = (work, options) => {
    if (options?.isolationLevel !== 'Serializable') throw new Error('Serializable transaction required');
    const run = queue.then(async () => {
      if (nextError) { const e = nextError; nextError = null; throw e; }
      const backup = structuredClone(rows);
      try { return await work(db); } catch (e) { rows = backup; throw e; }
    });
    queue = run.catch(() => {}); return run;
  };
  return { db, rows: name => rows[name], advance: ms => { time = new Date(+time + ms); },
    failCreate: name => { failingCreate = name; },
    failNext: code => { nextError = Object.assign(new Error('Synthetic storage failure'), { code }); },
    seed: (name, data) => rows[name].push(structuredClone(data)) };
}
module.exports = { createPersistenceMock };
