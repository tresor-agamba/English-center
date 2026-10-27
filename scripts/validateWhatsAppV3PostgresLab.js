// Final validation: a brand-new cluster, generated credentials, synthetic data only.
// Never imports dotenv or accepts a database URL from the caller.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process'), { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/nva-v3-corrections', 'run-' + Date.now());
const cluster = path.join(out, 'cluster');
const bin = 'D:/NVA-WhatsApp-Test/runtime/postgresql-16.15-edb-verified/bin';
const port = 59432, database = 'nva_whatsapp_v3_test';
const owner = 'nva_v3_lab_owner', migrator = 'nva_v3_lab_migrator', runner = 'nva_v3_lab_runner';
const password = randomBytes(32).toString('hex');
const clean = s => String(s || '').split(password).join('[REDACTED]').replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[LAB_URL]');
const safeEnv = { ...process.env };
for (const k of Object.keys(safeEnv)) if (/DATABASE_URL|^PG|^META_|^WHATSAPP_|^OPENAI_|^SMTP_|^MAIL_|^NVA_/i.test(k)) delete safeEnv[k];
Object.assign(safeEnv, { NODE_ENV: 'test', WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false', META_INBOX_SEND_ENABLED: 'false', META_INBOX_WORKER_ENABLED: 'false', NVA_AI_ENABLED: 'false', NVA_CHATBOT_AI_ENABLED: 'false', NVA_FOLLOWUPS_ENABLED: 'false', NVA_FOLLOWUPS_DRY_RUN: 'true' });
function command(exe, args, name, env = safeEnv) {
  // File descriptors avoid Windows pipe inheritance keeping pg_ctl alive.
  const logPath = path.join(out, name + '.log'), fd = fs.openSync(logPath, 'w');
  let r;
  try { r = spawnSync(exe, args, { cwd: root, env, stdio: ['ignore', fd, fd], windowsHide: true, timeout: 60000 }); }
  finally { fs.closeSync(fd); fs.writeFileSync(logPath, clean(fs.readFileSync(logPath, 'utf8'))); }
  assert.equal(r.error?.code, undefined, name + ' process error');
  assert.equal(r.status, 0, name + ' failed; inspect laboratory log');
}
async function main() {
  fs.mkdirSync(out, { recursive: true }); assert.ok(!fs.existsSync(cluster));
  // Refuse any occupied port, without connecting to the listener.
  const net = require('node:net');
  await new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(port, '127.0.0.1', () => socket.close(resolve)); });
  command(path.join(bin, 'initdb.exe'), ['-D', cluster, '-U', owner, '--auth=trust', '--encoding=UTF8', '--locale=C'], 'initdb');
  // Restrict HBA and TCP before the first startup; owner has access only on loopback.
  fs.writeFileSync(path.join(cluster, 'pg_hba.conf'), `host all ${owner} 127.0.0.1/32 trust\nhost ${database} ${migrator} 127.0.0.1/32 scram-sha-256\nhost ${database} ${runner} 127.0.0.1/32 scram-sha-256\nhost ${database} nva_meta_inbox_worker_prod 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n`);
  let started = false;
  try {
    started = true;
    command(path.join(bin, 'pg_ctl.exe'), ['-D', cluster, '-l', path.join(out, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], 'start');
    const admin = new Client({ host: '127.0.0.1', port, user: owner, database: 'postgres', connectionTimeoutMillis: 3000 }); await admin.connect();
    try {
      const { rows: [identity] } = await admin.query("SELECT current_user role,host(inet_server_addr()) host,inet_server_port() port,current_setting('data_directory') directory,version() version");
      assert.equal(identity.role, owner); assert.equal(identity.host, '127.0.0.1'); assert.equal(identity.port, port);
      assert.equal(path.resolve(identity.directory).toLowerCase(), cluster.toLowerCase());
      assert.equal((await admin.query("SELECT count(*)::int n FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'")).rows[0].n, 0);
      fs.writeFileSync(path.join(out, 'identity.json'), JSON.stringify({ ...identity, freshCluster: true, noExistingBusinessDatabase: true }, null, 2));
      for (const role of [migrator, runner]) await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ` + admin.escapeLiteral(password));
      await admin.query(`CREATE DATABASE ${database} OWNER ${migrator}`);
      await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${runner}`);
    } finally { await admin.end(); }
    const labUrl = role => `postgresql://${role}:${password}@127.0.0.1:${port}/${database}`;
    command(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], 'migrations', { ...safeEnv, DATABASE_URL: labUrl(migrator) });
    const setup = new Client({ host: '127.0.0.1', port, user: owner, database }); await setup.connect();
    try {
      await setup.query('BEGIN'); await setup.query(fs.readFileSync(path.join(root, 'docs/sql/meta-inbox-schema-reviewed.sql'), 'utf8')); await setup.query('COMMIT');
      await setup.query(fs.readFileSync(path.join(root, 'docs/sql/whatsapp-admission-worker-consent-function.sql'), 'utf8'));
      await setup.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO ${runner}`);
      const tables = ['users', 'courses', 'training_sessions', 'registration_groups', 'enrollments', 'whatsapp_conversations', 'whatsapp_conversation_messages', 'whatsapp_commercial_consent_events', 'whatsapp_prospect_follow_ups', 'WhatsAppChatbotSettings', 'WhatsAppChatbotAiBudget', 'WhatsAppChatbotRule', 'WhatsAppScenario', 'WhatsAppAdmissionRequest', 'WhatsAppAdmissionEvent', 'notifications', 'whatsapp_preferences'];
      await setup.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tables.map(t => 'public."' + t + '"').join(',')} TO ${runner}`);
      await setup.query(`GRANT SELECT ON public.meta_webhook_endpoints TO ${runner}; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${runner}`);
      await setup.query("CREATE FUNCTION public.nva_v3_cluster_directory() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT current_setting('data_directory') $$");
      await setup.query(`REVOKE ALL ON FUNCTION public.nva_v3_cluster_directory() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.nva_v3_cluster_directory() TO ${runner}`);
      // Keep the exact production role name and ACL, adapt only lab DB/port.
      const roleSql=fs.readFileSync(path.join(root,'docs/sql/meta-inbox-production-worker-role.sql'),'utf8').replace(/^\\.*$/gm,'').replaceAll('english_center',database).replace(/\b5432\b/g,String(port));
      await setup.query(roleSql);
      await setup.query('ALTER ROLE nva_meta_inbox_worker_prod LOGIN PASSWORD '+setup.escapeLiteral(password));
      fs.writeFileSync(path.join(out, 'migrations.json'), JSON.stringify((await setup.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows, null, 2));
    } finally { await setup.end(); }
    const env = { ...safeEnv, DATABASE_URL: labUrl(runner), NVA_V3_LAB_URL: labUrl(runner), NVA_V3_WORKER_URL:labUrl('nva_meta_inbox_worker_prod'), NVA_V3_LAB_DIRECTORY: cluster, NVA_V3_LAB_EVIDENCE: out };
    command(process.execPath, ['--test', '--test-concurrency=1', 'tests/whatsappV3Postgres.integration.test.js'], 'postgres-tests', env);
    // Reproduce the canonical column ACL without altering any deployment script.
    const aclDb = new Client({ host: '127.0.0.1', port, user: owner, database }); await aclDb.connect();
    let acl;
    try {
      const source = fs.readFileSync(path.join(root, 'docs/sql/meta-inbox-production-worker-role.sql'), 'utf8');
      const columns = source.match(/GRANT UPDATE\s*\(([^)]+)\)\s*ON public\.whatsapp_prospect_follow_ups/)[1].split(',').map(s => s.trim());
      assert.ok(columns.every(c => /^[a-z_]+$/.test(c)));
      await aclDb.query('CREATE ROLE nva_v3_acl_probe NOLOGIN NOINHERIT');
      await aclDb.query('GRANT USAGE ON SCHEMA public TO nva_v3_acl_probe; GRANT SELECT ON public.whatsapp_prospect_follow_ups TO nva_v3_acl_probe');
      await aclDb.query('GRANT UPDATE (' + columns.join(',') + ') ON public.whatsapp_prospect_follow_ups TO nva_v3_acl_probe');
      const needed = ['scheduled_for', 'template_name', 'template_language', 'attempts', 'accepted_at'];
      const missing = [];
      for (const column of needed) {
        const { rows: [r] } = await aclDb.query("SELECT has_column_privilege('nva_v3_acl_probe','public.whatsapp_prospect_follow_ups',$1,'UPDATE') allowed", [column]);
        if (!r.allowed) missing.push(column);
      }
      let denied;
      await aclDb.query('BEGIN; SET LOCAL ROLE nva_v3_acl_probe');
      try { await aclDb.query('UPDATE public.whatsapp_prospect_follow_ups SET scheduled_for=clock_timestamp() WHERE false'); }
      catch (e) { denied = e.code; }
      finally { await aclDb.query('ROLLBACK'); }
      assert.equal(denied, '42501');
      acl = { source: 'docs/sql/meta-inbox-production-worker-role.sql', sourceSha256: require('node:crypto').createHash('sha256').update(source).digest('hex'), grantedUpdateColumns: columns, missingUpdateColumns: missing,
        attemptedStatement: 'UPDATE whatsapp_prospect_follow_ups SET scheduled_for=clock_timestamp() WHERE false', postgresError: denied,
        impact: 'V3 inbound unconditionally updates schedule/template columns, including when follow-ups are disabled. No matching row is needed for PostgreSQL to deny the UPDATE.', productionModified: false };
      fs.writeFileSync(path.join(out, 'worker-acl-probe.json'), JSON.stringify(acl, null, 2));
    } finally { await aclDb.end(); }
    command(process.execPath,['--test','tests/whatsappV3WorkerPostgres.integration.test.js'],'worker-before-patch',{...env,NVA_V3_ACL_STAGE:'before'});
    const patchDb=new Client({host:'127.0.0.1',port,user:owner,database});await patchDb.connect();
    try{
      const sourcePatch=fs.readFileSync(path.join(root,'deploy/whatsapp-chatbot/08-v3-worker-followup-columns.sql'),'utf8').replace(/^\\.*$/gm,'');
      let refused=false;
      try{await patchDb.query(sourcePatch);}catch(e){refused=e.code==='P0001'&&e.message==='Wrong NVA target; stop';await patchDb.query('ROLLBACK');}
      assert.equal(refused,true,'Unadapted production target guard must refuse the laboratory');
      const patch=sourcePatch.replaceAll('english_center',database).replace(/\b5432\b/g,String(port));
      await patchDb.query(patch);await patchDb.query(patch);
      fs.writeFileSync(path.join(out,'patch.json'),JSON.stringify({file:'deploy/whatsapp-chatbot/08-v3-worker-followup-columns.sql',targetGuardRefusedUnadaptedScript:refused,applications:2,role:'nva_meta_inbox_worker_prod',database,port,productionExecuted:false},null,2));
    }finally{await patchDb.end();}
    command(process.execPath,['--test','tests/whatsappV3WorkerPostgres.integration.test.js'],'worker-after-patch',{...env,NVA_V3_ACL_STAGE:'after'});
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ result: 'PASS_CORRECTIONS_AND_CANONICAL_WORKER_ACL', realPostgres: true, syntheticOnly: true, externalCalls: 0, database, port, historicMissingWorkerColumns: acl.missingUpdateColumns,patchApplications:2 }, null, 2));
    console.log('PASS PostgreSQL V3 corrections, exact canonical worker role, patch idempotence: ' + path.relative(root, out));
  } finally {
    if (started) command(path.join(bin, 'pg_ctl.exe'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], 'stop');
  }
}
main().catch(e => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ code: e.code || e.name, message: clean(e.message) }, null, 2)); console.error('V3_LAB_FAILED: ' + clean(e.message) + ' — ' + path.relative(root, out)); process.exitCode = 1; });
