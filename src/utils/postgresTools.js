const { spawnSync } = require('node:child_process');

function parsePostgresMajor(value) {
  const match = String(value || '').match(/(?:PostgreSQL\)?\s+)(\d+)(?:\.|\b)/i) || String(value || '').match(/^\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function commandVersion(binary) {
  const result = spawnSync(binary, ['--version'], { windowsHide: true, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || new Error(String(result.stderr || 'Commande PostgreSQL indisponible').trim());
  const output = String(result.stdout || result.stderr || '').trim().slice(0, 120);
  const major = parsePostgresMajor(output);
  if (!major) throw new Error('Version PostgreSQL illisible');
  return { output, major };
}

function assertToolCompatibility(serverVersion, tools) {
  const serverMajor = parsePostgresMajor(serverVersion);
  if (!serverMajor) throw new Error('Version serveur PostgreSQL illisible');
  for (const [name, version] of Object.entries(tools)) {
    const toolMajor = typeof version === 'number' ? version : parsePostgresMajor(version);
    if (!toolMajor) throw new Error(`Version ${name} illisible`);
    if (toolMajor !== serverMajor) throw new Error(`${name} ${toolMajor} incompatible avec PostgreSQL serveur ${serverMajor}`);
  }
  return { serverMajor, compatible: true };
}

module.exports = { parsePostgresMajor, commandVersion, assertToolCompatibility };
