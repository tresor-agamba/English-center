const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

// Keys are injected from a future secret manager. This module never loads .env or logs.
function createGupshupPayloadCipher({ key, keyReference, applicationId }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof keyReference !== 'string'
    || !/^[\x21-\x7e]{1,200}$/.test(keyReference) || typeof applicationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) throw new Error('GUPSHUP_INVALID_CIPHER_CONFIG');
  const secret = Buffer.from(key);
  const aad = Buffer.from(JSON.stringify(['gupshup-inbox-v1', applicationId, keyReference]));
  return Object.freeze({
    seal(plaintext) {
      if (!Buffer.isBuffer(plaintext) || plaintext.length > 1024 * 1024) throw new Error('GUPSHUP_INVALID_PLAINTEXT');
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce);
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ciphertext: Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]), keyReference };
    },
    open({ ciphertext, keyReference: reference }) {
      if (ciphertext instanceof Uint8Array) ciphertext = Buffer.from(ciphertext);
      if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 29 || ciphertext.length > 1024 * 1024 + 29
        || ciphertext[0] !== 1 || reference !== keyReference) throw new Error('GUPSHUP_INVALID_CIPHERTEXT');
      const decipher = createDecipheriv('aes-256-gcm', secret, ciphertext.subarray(1, 13));
      decipher.setAAD(aad); decipher.setAuthTag(ciphertext.subarray(13, 29));
      try { return Buffer.concat([decipher.update(ciphertext.subarray(29)), decipher.final()]); }
      catch { throw new Error('GUPSHUP_DECRYPTION_FAILED'); }
    },
  });
}
module.exports = { createGupshupPayloadCipher };
