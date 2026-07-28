const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : entry.name.endsWith('.ejs') ? [target] : [];
  });
}
const templates = files(path.resolve(__dirname, '..', 'views'));
for (const template of templates) ejs.compile(fs.readFileSync(template, 'utf8'), { filename: template });
console.log(`EJS_OK=${templates.length}`);
