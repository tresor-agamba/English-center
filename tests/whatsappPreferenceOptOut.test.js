const test = require('node:test');
const assert = require('node:assert/strict');
const { recordWhatsAppOptOut } = require('../src/services/whatsappPreferenceService');

test('le retrait utilisateur désactive aussi ses conversations et annule les réponses en attente', async () => {
  const calls = {};
  const client = {
    whatsAppPreference: { upsert: async () => ({ userId: 42, phoneNumber: '+243812345678', isEnabled: false, hasOptedIn: false }) },
    whatsAppDelivery: { updateMany: async (args) => { calls.deliveries = args; } },
    whatsAppConversation: { updateMany: async (args) => { calls.conversations = args; } },
    whatsAppConversationMessage: { updateMany: async (args) => { calls.messages = args; } },
    whatsAppProspectFollowUp: { updateMany: async (args) => { calls.followUps = args; } },
  };

  await recordWhatsAppOptOut(42, client);
  assert.deepEqual(calls.conversations.where.OR, [{ userId: 42 }, { phoneNumber: '+243812345678' }]);
  assert.equal(calls.conversations.data.controlState, 'OPTED_OUT');
  assert.equal(calls.messages.where.deliveryStatus, 'QUEUED');
  assert.equal(calls.messages.data.deliveryStatus, 'CANCELLED');
  assert.equal(calls.deliveries.data.status, 'CANCELLED');
  assert.equal(calls.followUps.data.status, 'CANCELLED');
  assert.equal(calls.followUps.data.failureCode, 'CONSENT_WITHDRAWN');
});
