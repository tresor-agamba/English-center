// Dedicated local cluster ONLY. No dotenv, no inherited URL, no password files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/nva-whatsapp-v2-postgres-20261024');
const target={host:'127.0.0.1',port:58432,database:'nva_whatsapp_v2_test'};
const owner='nva_v2_lab_owner',migrator='nva_v2_test_migrator',runner='nva_v2_test_runner';
const passwords={migrator:randomBytes(32).toString('hex'),runner:randomBytes(32).toString('hex')};
function clean(s){let v=String(s||'');for(const secret of Object.values(passwords))v=v.split(secret).join('[REDACTED]');return v.replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[REDACTED_TEST_URL]');}
function envFor(user,password){const env={...process.env};for(const k of Object.keys(env))if(/DATABASE_URL|^META_|^WHATSAPP_|^OPENAI_|^SMTP_|^MAIL_|^NVA_CHATBOT_/i.test(k))delete env[k];return {...env,NODE_ENV:'test',DATABASE_URL:`postgresql://${user}:${password}@127.0.0.1:58432/nva_whatsapp_v2_test`,WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',META_WHATSAPP_INBOX_ENABLED:'false',META_INBOX_WORKER_ENABLED:'false',META_INBOX_SEND_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false'};}
function runNode(args,env,name){const r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:180000});fs.writeFileSync(path.join(out,name+'.log'),clean((r.stdout||'')+'\n'+(r.stderr||'')));if(r.error)throw Object.assign(Error('CHILD_FAILED'),{code:r.error.code});assert.equal(r.status,0,name+' failed; inspect redacted lab log');return r;}
async function main(){
 assert.equal(process.env.NVA_V2_LAB_AUTHORIZED,'local-new-synthetic-cluster','Explicit lab authorization missing');
 const c=new Client({...target,database:'postgres',user:owner,connectionTimeoutMillis:2000});await c.connect();
 try{
  const {rows:[identity]}=await c.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory,version() AS version");
  assert.equal(identity.db,'postgres');assert.equal(identity.role,owner);assert.equal(identity.host,target.host);assert.equal(identity.port,target.port);assert.equal(path.resolve(identity.directory).toLowerCase(),path.join(out,'cluster').toLowerCase());
  const names=(await c.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'")).rows.map(x=>x.datname);assert.ok(names.every(name=>name===target.database),'Unexpected database in lab cluster');
  for(const [role,password]of [[migrator,passwords.migrator],[runner,passwords.runner]]){
   const exists=(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
   if(!exists)await c.query('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '+c.escapeLiteral(password));
   else {assert.ok(fs.existsSync(path.join(out,'identity.json')),'Refuse to rotate unrecorded existing roles');await c.query('ALTER ROLE '+role+' PASSWORD '+c.escapeLiteral(password));}
  }
  if(!names.includes(target.database))await c.query('CREATE DATABASE '+target.database+' OWNER '+migrator);
  await c.query('REVOKE ALL ON DATABASE '+target.database+' FROM PUBLIC');await c.query('GRANT CONNECT ON DATABASE '+target.database+' TO '+runner);
  fs.writeFileSync(path.join(out,'identity.json'),JSON.stringify({...identity,freshLab:true,syntheticOnly:true},null,2)+'\n');
 }finally{await c.end();}
 const migrateEnv=envFor(migrator,passwords.migrator);
 runNode([require.resolve('prisma/build/index.js'),'validate'],migrateEnv,'prisma-validate');
 runNode([require.resolve('prisma/build/index.js'),'migrate','deploy'],migrateEnv,'migrate-deploy');
 const admin=new Client({...target,user:owner});await admin.connect();
 try{
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await admin.query('GRANT USAGE ON SCHEMA public TO '+runner);
  const tables=['users','courses','training_sessions','registration_groups','enrollments','whatsapp_conversations','whatsapp_conversation_messages','WhatsAppChatbotSettings','WhatsAppAdmissionRequest','WhatsAppAdmissionEvent','notifications','whatsapp_prospect_follow_ups'];
  await admin.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM '+runner);
  await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON '+tables.map(t=>'public."'+t+'"').join(',')+' TO '+runner);
  // Read dependencies of the existing admin confirmation and enrollment reminders.
  await admin.query('GRANT SELECT ON public.payments,public.class_meetings,public.assignments,public.assignment_submissions TO '+runner);
  await admin.query('GRANT SELECT,UPDATE ON public.scheduled_reminders TO '+runner);
  await admin.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO '+runner);
  await admin.query("CREATE OR REPLACE FUNCTION public.nva_v2_test_cluster_directory() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT current_setting('data_directory') $$");
  await admin.query('REVOKE ALL ON FUNCTION public.nva_v2_test_cluster_directory() FROM PUBLIC');await admin.query('GRANT EXECUTE ON FUNCTION public.nva_v2_test_cluster_directory() TO '+runner);
  const roles=(await admin.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ($1,$2)",[migrator,runner])).rows;
  assert.ok(roles.every(r=>!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls));
  const migrations=(await admin.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;assert.ok(migrations.every(m=>m.finished_at&&!m.rolled_back_at));
  fs.writeFileSync(path.join(out,'schema-and-roles.json'),JSON.stringify({roles,migrations},null,2)+'\n');
 }finally{await admin.end();}
 const testEnv=envFor(runner,passwords.runner);testEnv.NVA_V2_DATABASE_TESTS_ENABLED='true';testEnv.NVA_V2_DATABASE_TEST_URL=testEnv.DATABASE_URL;testEnv.NVA_V2_DATABASE_EXPECTED_DIRECTORY=path.join(out,'cluster');
 await require('./prepareNvaMetaLab')({root,out,target,owner,runner,passwords,testEnv});
 runNode(['--test','tests/whatsappV2Database.integration.test.js'],testEnv,'business-tests');
 runNode(['--test','tests/whatsappV2Admin.integration.test.js'],testEnv,'admin-tests');
 runNode(['--test','tests/productionVpsReadiness.test.js'],testEnv,'vps-readiness-tests');
 // Exercise the canonical column grant on the exact laboratory, without leaving
 // a role or fixture behind. This does NOT apply the production role script.
 const aclClient=new Client({...target,user:owner});await aclClient.connect();
 try{
  const sql=fs.readFileSync(path.join(root,'docs/sql/meta-inbox-production-worker-role.sql'),'utf8');
  const columns=sql.match(/GRANT UPDATE\s*\(([^)]+)\)\s*ON public\."WhatsAppAdmissionRequest"/)[1].split(',').map(s=>s.trim().replaceAll('"',''));
  assert.ok(columns.every(c=>/^[A-Za-z]+$/.test(c)));
  await aclClient.query('BEGIN');
  await aclClient.query('CREATE ROLE nva_v2_worker_acl_probe NOLOGIN NOINHERIT');
  await aclClient.query('GRANT USAGE ON SCHEMA public TO nva_v2_worker_acl_probe');
  await aclClient.query('GRANT SELECT ON public."WhatsAppAdmissionRequest" TO nva_v2_worker_acl_probe');
  await aclClient.query('GRANT UPDATE ('+columns.map(c=>'"'+c+'"').join(',')+') ON public."WhatsAppAdmissionRequest" TO nva_v2_worker_acl_probe');
  const {rows:[conversation]}=await aclClient.query("INSERT INTO public.whatsapp_conversations(phone_number,updated_at) VALUES('+243899000009',now()) RETURNING id");
  const {rows:[request]}=await aclClient.query('INSERT INTO public."WhatsAppAdmissionRequest"("conversationId","fullName","phoneNumber",email,"requestedLevel","sourceMessageId","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',[conversation.id,'ACL Laboratory','+243899000009','acl@example.test','BEGINNER','acl-'+randomBytes(12).toString('hex')]);
  await aclClient.query('SET LOCAL ROLE nva_v2_worker_acl_probe');
  const changed=await aclClient.query('UPDATE public."WhatsAppAdmissionRequest" SET "confirmationDraft"=$1 WHERE id=$2',['Synthetic reconfirmation',request.id]);assert.equal(changed.rowCount,1);
  fs.writeFileSync(path.join(out,'worker-acl-reconfirmation.json'),JSON.stringify({result:'PASS',columns,scope:'isolated transaction; role and fixtures rolled back'},null,2)+'\n');
 }finally{await aclClient.query('ROLLBACK');await aclClient.end();}
 runNode(['--test','tests/whatsappV2MetaReadiness.integration.test.js'],testEnv,'meta-readiness-tests');
 const metaFinal=new Client({...target,user:owner});await metaFinal.connect();
 try{
  const counts={};for(const table of ['meta_webhook_endpoints','meta_webhook_events','meta_webhook_receipts','meta_webhook_receipt_items']){counts[table]=(await metaFinal.query('SELECT count(*)::int n FROM public.'+table)).rows[0].n;assert.equal(counts[table],0);}
  const {rows:[guards]}=await metaFinal.query("SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgrelid IN ('meta_webhook_endpoints'::regclass,'meta_webhook_events'::regclass,'meta_webhook_receipts'::regclass,'meta_webhook_receipt_items'::regclass)");assert.equal(guards.n,7);
  fs.writeFileSync(path.join(out,'meta-final-checks.json'),JSON.stringify({counts,enabledGuards:guards.n,fixtureCleanup:'bootstrap-only, scoped IDs, transaction-local retention bypass; no production operation'},null,2)+'\n');
 }finally{await metaFinal.end();}
 const restricted=new Client({...target,user:runner,password:passwords.runner});await restricted.connect();
 try{
  const {rows:[rights]}=await restricted.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,has_table_privilege(current_user,'public.users','TRUNCATE') AS can_truncate,has_table_privilege(current_user,'public._prisma_migrations','UPDATE') AS can_change_migrations");
  assert.deepEqual(rights,{can_create:false,can_truncate:false,can_change_migrations:false});
  const counts={};for(const table of ['users','courses','training_sessions','registration_groups','enrollments','whatsapp_conversations','WhatsAppAdmissionRequest','WhatsAppAdmissionEvent','notifications']){const {rows:[r]}=await restricted.query('SELECT count(*)::int AS n FROM public."'+table+'"');counts[table]=r.n;assert.equal(r.n,0);}
  fs.writeFileSync(path.join(out,'final-checks.json'),JSON.stringify({rights,counts},null,2)+'\n');
 }finally{await restricted.end();}
 console.log('PASS: dedicated PostgreSQL lab, migrations and real Prisma business tests. Credentials remained in memory.');
}
main().catch(e=>{console.error('NVA_V2_LAB_FAILED',e.code||e.name,clean(e.message));process.exitCode=1;});
