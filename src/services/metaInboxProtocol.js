// Pure protocol/crypto. No environment loading, database singleton or network.
const { createHmac, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && Buffer.byteLength(value) <= 2048 && !/[\x00-\x20\x7f]/.test(value);
const version = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
function canonical(value, depth = 0) {
  if (depth > 24) fail('META_INBOX_INVALID_PAYLOAD');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']';
  if (!value || typeof value !== 'object') fail('META_INBOX_INVALID_PAYLOAD');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
}
function createMetaInboxCrypto({ lookupKeys, currentLookupVersion, streamKey, streamKeyVersion,
  encryptionKeys, currentEncryptionVersion } = {}) {
  const copy = keys => Object.fromEntries(Object.entries(keys || {}).map(([v, key]) => {
    if (!version(v) || !Buffer.isBuffer(key) || key.length !== 32) fail('META_INBOX_INVALID_KEYS');
    return [v, Buffer.from(key)];
  }));
  const lookups = copy(lookupKeys), encryption = copy(encryptionKeys);
  if (!Object.hasOwn(lookups, currentLookupVersion) || !Object.hasOwn(encryption, currentEncryptionVersion) || !version(streamKeyVersion)
    || !Buffer.isBuffer(streamKey) || streamKey.length !== 32) fail('META_INBOX_INVALID_KEYS');
  const flowSecret = Buffer.from(streamKey);
  if (Object.values(lookups).some(k => k.equals(flowSecret) || Object.values(encryption).some(e => e.equals(k)))
    || Object.values(encryption).some(k => k.equals(flowSecret))) fail('META_INBOX_KEYS_MUST_BE_DISTINCT');
  const hmac = (key, values) => createHmac('sha256', key).update(canonical(values)).digest();
  return Object.freeze({
    currentLookupVersion, streamKeyVersion, currentEncryptionVersion,
    lookupVersions: Object.freeze(Object.keys(lookups).sort()),
    digest(endpointId, domain, value, v = currentLookupVersion) {
      if (!Object.hasOwn(lookups, v)) fail('META_INBOX_MISSING_LOOKUP_KEY');
      return hmac(lookups[v], [endpointId, domain, value]);
    },
    stream(endpointId, sender) { if (!/^[1-9]\d{6,14}$/.test(sender)) fail('META_INBOX_INVALID_SENDER'); return hmac(flowSecret, [endpointId, 'stream-v1', sender]); },
    seal(value, context) {
      const plaintext = Buffer.from(canonical(value));
      if (plaintext.length > 1024 * 1024) fail('META_INBOX_PAYLOAD_TOO_LARGE');
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryption[currentEncryptionVersion], nonce);
      cipher.setAAD(Buffer.from(canonical([context, currentEncryptionVersion])));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ciphertext: Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]), keyVersion: currentEncryptionVersion };
    },
    open(ciphertext, keyVersion, context) {
      if (!Object.hasOwn(encryption, keyVersion) || !(ciphertext instanceof Uint8Array)) fail('META_INBOX_DECRYPTION_FAILED');
      const bytes = Buffer.from(ciphertext);
      if (bytes.length < 29 || bytes.length > 1024 * 1024 + 29 || bytes[0] !== 1) fail('META_INBOX_DECRYPTION_FAILED');
      try {
        const cipher = createDecipheriv('aes-256-gcm', encryption[keyVersion], bytes.subarray(1, 13));
        cipher.setAAD(Buffer.from(canonical([context, keyVersion]))); cipher.setAuthTag(bytes.subarray(13, 29));
        return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(29)), cipher.final()]).toString('utf8'));
      } catch { fail('META_INBOX_DECRYPTION_FAILED'); }
    },
  });
}
const code = value => /^\d{1,10}$/.test(String(value)) ? String(value) : 'UNSPECIFIED';
const knownTypes = ['text', 'interactive', 'image', 'audio', 'video', 'document', 'sticker'];
const knownStatuses = ['sent', 'delivered', 'read', 'failed'];
function normalizeMetaBatch(payload, { wabaId, phoneNumberId, receivedAt }) {
  if (!(receivedAt instanceof Date) || !Number.isFinite(+receivedAt) || payload?.object !== 'whatsapp_business_account'
    || !Array.isArray(payload.entry) || !payload.entry.length) fail('META_INBOX_INVALID_PAYLOAD');
  const out = [];
  payload.entry.forEach((entry, entryIndex) => {
    if (entry?.id !== wabaId) fail('META_INBOX_ACCOUNT_MISMATCH');
    if (!Array.isArray(entry.changes) || !entry.changes.length) fail('META_INBOX_INVALID_PAYLOAD');
    entry.changes.forEach((change, changeIndex) => {
      const value = change?.value;
      if (change?.field !== 'messages' || value?.messaging_product !== 'whatsapp') fail('META_INBOX_INVALID_PAYLOAD');
      if (value.metadata?.phone_number_id !== phoneNumberId) fail('META_INBOX_ACCOUNT_MISMATCH');
      let count = 0;
      for (const collection of ['messages', 'statuses', 'errors']) {
        if (value[collection] === undefined) continue;
        if (!Array.isArray(value[collection])) fail('META_INBOX_INVALID_PAYLOAD');
        value[collection].forEach((item, itemIndex) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) fail('META_INBOX_INVALID_PAYLOAD');
          count++;
          let kind, data, identity, streamSender = null, occurredAt = null, nativeMessageId = null, nativeStatus = null;
          if (collection !== 'errors') {
            if (!id(item.id) || (item.timestamp !== undefined && (typeof item.timestamp !== 'string'
              || !/^\d{1,12}$/.test(item.timestamp) || !Number.isFinite(+new Date(Number(item.timestamp) * 1000))))) fail('META_INBOX_INVALID_PAYLOAD');
            nativeMessageId = item.id;
            occurredAt = item.timestamp === undefined ? null : new Date(Number(item.timestamp) * 1000);
          }
          if (collection === 'messages') {
            if (typeof item.from !== 'string' || !/^[1-9]\d{6,14}$/.test(item.from) || typeof item.type !== 'string' || !item.type.length || item.type.length > 64) fail('META_INBOX_INVALID_PAYLOAD');
            streamSender = item.from;
            const message = { id: item.id, from: item.from, type: item.type, ...(item.timestamp === undefined ? {} : { timestamp: item.timestamp }) };
            if (item.type === 'text') {
              if (typeof item.text?.body !== 'string' || !item.text.body.trim() || item.text.body.length > 4096) fail('META_INBOX_INVALID_PAYLOAD');
              message.text = { body: item.text.body };
            } else if (item.type === 'interactive') {
              const type = item.interactive?.button_reply?.title ? 'button_reply' : 'list_reply';
              const title = item.interactive?.[type]?.title;
              if (typeof title !== 'string' || !title.trim() || title.length > 4096) fail('META_INBOX_INVALID_PAYLOAD');
              const optionId = item.interactive?.[type]?.id;
              if (optionId !== undefined && (typeof optionId !== 'string' || !optionId.trim() || optionId.length > 256)) fail('META_INBOX_INVALID_PAYLOAD');
              // Keep the stable ID encrypted with the normalized message; never route on its title.
              message.interactive = { [type]: { title, ...(optionId === undefined ? {} : { id: optionId }) } };
            }
            kind = knownTypes.includes(item.type) ? 'INBOUND' : 'UNSUPPORTED';
            data = { message, timestampValidAtReceipt: Boolean(occurredAt && occurredAt <= receivedAt) };
            identity = ['inbound', item.id];
          } else if (collection === 'statuses') {
            if (typeof item.status !== 'string' || !item.status.length || item.status.length > 64) fail('META_INBOX_INVALID_PAYLOAD');
            if (item.biz_opaque_callback_data !== undefined && (typeof item.biz_opaque_callback_data !== 'string'
              || !item.biz_opaque_callback_data.trim() || Buffer.byteLength(item.biz_opaque_callback_data) > 512)) fail('META_INBOX_INVALID_PAYLOAD');
            if (item.errors !== undefined && (!Array.isArray(item.errors) || item.errors.some(e => !e || typeof e !== 'object'))) fail('META_INBOX_INVALID_PAYLOAD');
            kind = knownStatuses.includes(item.status) ? 'STATUS' : 'UNSUPPORTED'; nativeStatus = item.status;
            const status = { id: item.id, status: item.status, ...(item.timestamp === undefined ? {} : { timestamp: item.timestamp }),
              ...(item.biz_opaque_callback_data === undefined ? {} : { biz_opaque_callback_data: item.biz_opaque_callback_data }),
              ...(item.errors?.length ? { errors: [{ code: code(item.errors[0].code) }] } : {}) };
            data = { status }; identity = ['status', item.id, item.status, occurredAt?.toISOString() ?? null];
          } else { kind = 'PROVIDER_ERROR'; data = { code: code(item.code) }; identity = ['provider-error', data]; }
          // Receipt-time validity is not semantic identity/content: retain its first value only.
          const projection = data.message ? { message: data.message } : data;
          out.push({ kind, data, projection, identity, streamSender, occurredAt, nativeMessageId, nativeStatus,
            position: { entryIndex, changeIndex, collection, itemIndex } });
          if (out.length > 512) fail('META_INBOX_TOO_MANY_ITEMS');
        });
      }
      if (!count) fail('META_INBOX_INVALID_PAYLOAD');
    });
  });
  return out;
}
module.exports = { fail, canonical, normalizeMetaBatch, createMetaInboxCrypto };
