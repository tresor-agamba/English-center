const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre']);

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function sanitizeRichText(value, maxLength = 100000) {
  const input = String(value || '').trim();
  if (!input) return null;
  if (input.length > maxLength) throw Object.assign(new Error('Le contenu est trop long.'), { code: 'CONTENT_TOO_LONG', statusCode: 400 });
  const parts = input.split(/(<\/?[a-zA-Z0-9]+(?:\s[^>]*)?>)/g);
  return parts.map(part => {
    const match = part.match(/^<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?>$/);
    if (!match) return escapeHtml(part);
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return escapeHtml(part);
    return part.startsWith('</') ? `</${tag}>` : `<${tag}>`;
  }).join('');
}

module.exports = { ALLOWED_TAGS, escapeHtml, sanitizeRichText };
