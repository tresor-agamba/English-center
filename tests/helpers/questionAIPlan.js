// Synthetic provider outputs for the server-rendered contract, never a transport.
function questionAIPlan(factIds = [], language = 'fr', overrides = {}) {
  return { language, intent: 'INFORMATION', factIds, opening: 'none', followUp: 'none', action: 'NONE', ...overrides };
}
function dialoguePlan(intent, language = 'fr') {
  return questionAIPlan([], language, { intent, action: intent === 'REGISTRATION' ? 'REGISTER' : 'NONE' });
}
module.exports = { questionAIPlan, dialoguePlan };
