const { assertTestDelivery } = require('../../src/services/passwordResetService');

class FakeEmailTransport {
  constructor() { assertTestDelivery(); this.messages = []; this.handler = null; }
  async send(message) {
    assertTestDelivery();
    this.messages.push({ ...message });
    return this.handler ? this.handler(message) : { accepted: true };
  }
}
module.exports = FakeEmailTransport;
