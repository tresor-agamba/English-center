// Explicit fresh local cluster only. Never reads .env or connects to a supplied URL.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Client } = require('pg'), { spawnSync } = require('node:child_process');
process.chdir(path.resolve(__dirname, '..'));
const out = path.resolve('output/meta-worker-postgres');
async function main() {
  assert.equal(process.env.NVA_META_WORKER_LAB, 'isolated-worker-validation');
  const c = new Client({ host: '127.0.0.1', port: 55432, database: 'postgres', user: 'nva_worker_lab_owner' });
  await c.connect();
  try {
    const { rows: [r] } = await c.query("SELECT current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS dir");
    assert.equal(r.role, 'nva_worker_lab_owner'); assert.equal(r.host, '127.0.0.1'); assert.equal(r.port, 55432);
    assert.equal(path.resolve(r.dir).toLowerCase(), path.join(out, 'cluster').toLowerCase());
    // Refuse to overwrite an existing lab or any other database.
    assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'")).rows[0].n, 0);
    await c.query('CREATE ROLE nva_worker_lab_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    await c.query('CREATE DATABASE nva_whatsapp_test OWNER nva_worker_lab_migrator');
  } finally { await c.end(); }
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const k of Object.keys(env)) if (/DATABASE_URL|^META_|^WHATSAPP_|^OPENAI_|^NVA_CHATBOT_/i.test(k)) delete env[k];
  env.DATABASE_URL = 'postgresql://nva_worker_lab_migrator@127.0.0.1:55432/nva_whatsapp_test?schema=public';
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js','migrate','deploy'], { env, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(out,'migrate.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, 'Local migration deployment failed; inspect private lab log');
  const d = new Client({ host: '127.0.0.1', port: 55432, database: 'nva_whatsapp_test', user: 'nva_worker_lab_owner' });
  await d.connect();
  try {
    await d.query('REVOKE ALL ON DATABASE nva_whatsapp_test FROM PUBLIC');
    await d.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await d.query('SET ROLE nva_worker_lab_migrator');
    await d.query('BEGIN');
    await d.query(fs.readFileSync('docs/sql/meta-inbox-schema-reviewed.sql','utf8'));
    await d.query('COMMIT'); await d.query('RESET ROLE');
    // Deliberately retain the HTTP sessions object outside Prisma.
    await d.query('SET ROLE nva_worker_lab_migrator');
    await d.query(fs.readFileSync('node_modules/connect-pg-simple/table.sql','utf8').replaceAll('"session"','"http_sessions"').replaceAll('IDX_session_expire','IDX_http_sessions_expire').replaceAll('session_pkey','http_sessions_pkey'));
    await d.query('RESET ROLE');
    // Only target guard + role/database substitutions; privileges/logic are identical.
    for (const kind of ['ingress','worker']) {
      let sql = fs.readFileSync(`docs/sql/meta-inbox-production-${kind}-role.sql`,'utf8');
      sql = sql.replaceAll('english_center','nva_whatsapp_test').replaceAll(`nva_meta_inbox_${kind}_prod`,`nva_meta_inbox_${kind}`)
        .replaceAll('5432','55432').split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n');
      fs.writeFileSync(path.join(out,`${kind}-role-test-only.sql`),sql);
      await d.query(sql);
      await d.query(`ALTER ROLE nva_meta_inbox_${kind} LOGIN`);
    }
    fs.writeFileSync(path.join(out,'setup.json'),JSON.stringify({ target: '127.0.0.1:55432/nva_whatsapp_test', cluster: rpath(),
      migrations: (await d.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows,
      roleScripts: Object.fromEntries(['ingress','worker'].map(k => [k,require('node:crypto').createHash('sha256').update(fs.readFileSync(`docs/sql/meta-inbox-production-${k}-role.sql`)).digest('hex')])) },null,2));
    console.log('PASS isolated schema, Meta SQL, HTTP sessions, ingress and worker role provisioning');
  } finally { await d.end(); }
}
function rpath() { return path.join(out,'cluster'); }
main().catch(e => { console.error('LAB_SETUP_FAILED', e.code || e.name); process.exitCode=1; });
