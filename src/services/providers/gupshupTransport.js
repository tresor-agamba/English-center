const { createHash } = require('node:crypto');
const { isGupshupSimulation } = require('./gupshupSimulation');
function failure(code, { retryable = false, uncertain = false } = {}) {
  return Object.assign(new Error('Simulated Gupshup operation failed.'), {
    code, retryable, uncertain, acceptanceRejected: !uncertain,
  });
}
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function canonicalId(applicationKey, submissionId) {
  if (!identifier(applicationKey) || typeof submissionId !== 'string' || !submissionId.trim() || submissionId.length > 512) {
    throw failure('GUPSHUP_INVALID_IDENTIFIER');
  }
  return `gupshup:${applicationKey}:${encodeURIComponent(submissionId)}`;
}
function createGupshupTransport({ mode, simulation, applicationKey, appName, source, templateCatalog = [] } = {}) {
  if (mode !== 'simulation' || process.env.NODE_ENV === 'production' || !isGupshupSimulation(simulation)) {
    throw failure('GUPSHUP_SIMULATION_REQUIRED');
  }
  if (!identifier(applicationKey) || !identifier(appName) || typeof source !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(source)) {
    throw failure('GUPSHUP_INVALID_CONFIGURATION');
  }
  const catalog = structuredClone(templateCatalog);
  const operations = new Map();
  const fingerprints = new Map();
  function send(kind, data) {
    if (process.env.NODE_ENV === 'production') return Promise.reject(failure('GUPSHUP_SIMULATION_REQUIRED'));
    if (!data || typeof data.phoneNumber !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(data.phoneNumber)
      || typeof data.idempotencyKey !== 'string' || !data.idempotencyKey.trim() || data.idempotencyKey.length > 512) {
      return Promise.reject(failure('GUPSHUP_INVALID_INPUT'));
    }
    let payload;
    if (kind === 'text') {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4096) return Promise.reject(failure('GUPSHUP_INVALID_TEXT'));
      payload = { type: 'text', text: data.text };
    } else {
      const matches = catalog.filter(t => t.applicationKey === applicationKey && t.businessTemplateName === data.templateName && t.language === data.templateLanguage);
      const t = matches[0];
      if (matches.length !== 1 || !t.enabled || t.approvalStatus !== 'APPROVED' || !identifier(t.providerTemplateId)
        || !Array.isArray(t.parameterNamesInOrder) || !Array.isArray(data.templateParameters)
        || data.templateParameters.length !== t.parameterNamesInOrder.length
        || !data.templateParameters.every(p => typeof p === 'string' && p.length <= 500)) return Promise.reject(failure('GUPSHUP_INVALID_TEMPLATE'));
      payload = { id: t.providerTemplateId, params: [...data.templateParameters] };
    }
    const form = new URLSearchParams({ channel: 'whatsapp', source: source.replace(/^\+/, ''),
      destination: data.phoneNumber.replace(/^\+/, ''), 'src.name': appName, [kind === 'text' ? 'message' : 'template']: JSON.stringify(payload) }).toString();
    const fingerprint = createHash('sha256').update(kind + form).digest('hex');
    if (fingerprints.has(data.idempotencyKey) && fingerprints.get(data.idempotencyKey) !== fingerprint) return Promise.reject(failure('GUPSHUP_IDEMPOTENCY_CONFLICT'));
    fingerprints.set(data.idempotencyKey, fingerprint);
    const prior = operations.get(data.idempotencyKey);
    if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.reject(failure('GUPSHUP_IDEMPOTENCY_CONFLICT'));
    const promise = (async () => {
      let response;
      try {
        response = await simulation.request({ url: `https://gupshup.invalid/wa/api/v1/${kind === 'text' ? 'msg' : 'template/msg'}`,
          method: 'POST', headers: { apikey: 'simulation-only', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
      } catch { throw failure('DELIVERY_UNCERTAIN', { uncertain: true }); }
      const body = response?.body;
      const expectedStatus = kind === 'text' ? 200 : 202;
      const allowed = kind === 'text' ? ['submitted'] : ['success', 'submitted'];
      if (response?.status === expectedStatus && allowed.includes(body?.status) && typeof body.messageId === 'string' && body.messageId.trim() && body.messageId.length <= 512) {
        return { providerMessageId: canonicalId(applicationKey, body.messageId) };
      }
      // A valid rejection body must not simultaneously claim an accepted message id.
      if ([400, 401, 429].includes(response?.status) && body?.status === 'error' && typeof body.message === 'string' && !body.messageId) {
        throw failure(`GUPSHUP_HTTP_${response.status}`, { retryable: response.status === 429 });
      }
      throw failure('DELIVERY_UNCERTAIN', { uncertain: true });
    })();
    operations.set(data.idempotencyKey, { fingerprint, promise });
    // Only an explicit temporary rejection permits a caller-controlled new attempt.
    promise.catch(error => { if (error.retryable && operations.get(data.idempotencyKey)?.promise === promise) operations.delete(data.idempotencyKey); });
    return promise;
  }
  return Object.freeze({ sendTextMessage: data => send('text', data), sendTemplateMessage: data => send('template', data) });
}
module.exports = { createGupshupTransport, canonicalId };
