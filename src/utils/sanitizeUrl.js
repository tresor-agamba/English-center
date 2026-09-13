// Used both on request paths and on strings nested in log/error metadata.
function sanitizeUrl(value) {
  let text = String(value);
  // Proxies and error reporters may encode an entire URL, sometimes twice.
  for (let pass = 0; pass < 2; pass += 1) {
    try { text = decodeURIComponent(text); } catch { break; }
  }
  return text
    .replace(/((?:\/|%2f)reset-password(?:\/|%2f))[^\s/?#"'<>\\]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:[^=&#\s]*(?:password|token|secret|cookie|authorization)[^=&#\s]*)=)[^&#\s"'<>]*/gi, '$1[REDACTED]');
}

module.exports = sanitizeUrl;
