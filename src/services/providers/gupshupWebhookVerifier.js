// No Gupshup signature scheme has been established. There is no test bypass.
function verifyGupshupWebhook() {
  throw Object.assign(new Error('Gupshup webhook authentication is not established.'), {
    code: 'GUPSHUP_WEBHOOK_AUTH_UNAVAILABLE', statusCode: 503,
  });
}
module.exports = { verifyGupshupWebhook };
