const fs = require('node:fs');
const files = ['tmp/auth-phase6-final-targeted.log','tmp/auth-phase6-ui-final.log','tmp/auth-phase6-full.log'];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf16le');
  const rawResetPaths = [...text.matchAll(/\/reset-password\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g)].length;
  const passwordFixtures = ['Phase6Initial@2026','Phase6Changed@2026','smtp-sensitive-fixture','private-password-fixture','private-body-fixture'].filter(s=>text.includes(s)).length;
  const bcryptHashes = [...text.matchAll(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g)].length;
  console.log(JSON.stringify({ file, rawResetPaths, passwordFixtures, bcryptHashes }));
}

