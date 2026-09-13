const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function renderResetEmail({ firstName, link, language = 'fr' }) {
  const fr = language !== 'en';
  const name = String(firstName || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
  const subject = fr ? 'New Vision Academy — Réinitialisation de votre mot de passe' : 'New Vision Academy — Reset your password';
  const greeting = `${fr ? 'Bonjour' : 'Hello'} ${name},`;
  const intro = fr ? 'Votre demande de réinitialisation de mot de passe a été approuvée.' : 'Your password reset request has been approved.';
  const action = fr ? 'Choisir un nouveau mot de passe' : 'Choose a new password';
  const instruction = fr ? 'Utilisez le lien sécurisé ci-dessous pour choisir un nouveau mot de passe.' : 'Use the secure link below to choose a new password.';
  const expiry = fr ? 'Ce lien expire dans 30 minutes et ne peut être utilisé qu’une seule fois.' : 'This link expires in 30 minutes and can only be used once.';
  const help = fr ? 'Si vous n’avez pas demandé cette réinitialisation, vous pouvez ignorer ce message et contacter New Vision Academy.' : 'If you did not request this reset, you can ignore this message and contact New Vision Academy.';
  return { subject, text: [greeting, intro, instruction, `${action} : ${link}`, expiry, help, 'New Vision Academy', 'Learn. Speak. Succeed.'].join('\n\n'),
    html: `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#17213d"><div style="max-width:560px;margin:24px auto;padding:24px;background:#fff;border-radius:12px"><h1 style="font-size:22px;color:#19145a">New Vision Academy</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p>${escapeHtml(instruction)}</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#19145a;color:#fff;text-decoration:none;padding:14px 20px;border-radius:6px">${escapeHtml(action)}</a></p><p>${escapeHtml(expiry)}</p><p>${escapeHtml(help)}</p><hr style="border:0;border-top:1px solid #e4e7ee"><p><strong>New Vision Academy</strong><br>Learn. Speak. Succeed.</p></div></body></html>` };
}
module.exports = { renderResetEmail };
