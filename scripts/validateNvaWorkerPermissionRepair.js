// Fixed synthetic laboratory only; no dotenv, inherited URLs or transport.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomBytes}=require('node:crypto');
const {verifyWorkerIdentity}=require('../src/services/metaInboxWorkerService');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const role='nva_repair_probe_'+randomBytes(6).toString('hex'),results=[];
const c=new Client({host:'127.0.0.1',port:58432,database:'nva_whatsapp_v2_test',user:'nva_v2_lab_owner',connectionTimeoutMillis:2000});
const source=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
function adapt(sql){return sql.replaceAll('english_center','nva_whatsapp_v2_test').replaceAll('nva_meta_inbox_worker_prod',role).replaceAll('5432','58432').split(/\r?\n/).filter(l=>!l.startsWith('\\')&&!/^\s*(BEGIN|COMMIT);\s*$/.test(l)).join('\n');}
async function check(name,fn){await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}
async function asWorker(fn){await c.query('SET LOCAL ROLE '+role);try{return await fn();}finally{await c.query('RESET ROLE');}}
async function denied(sql,code='42501'){await c.query('SAVEPOINT denied');try{await assert.rejects(()=>c.query(sql),e=>e.code===code);}finally{await c.query('ROLLBACK TO denied');}}
const identity=()=>asWorker(()=>verifyWorkerIdentity({$queryRaw:async strings=>(await c.query(strings.join(''))).rows},{database:'nva_whatsapp_v2_test',role,port:58432}));
async function main(){
 assert.equal(process.env.NVA_WORKER_REPAIR_LAB,'isolated-permission-repair');await c.connect();
 const {rows:[r]}=await c.query("SELECT current_database() db,host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory");
 assert.equal(r.db,'nva_whatsapp_v2_test');assert.equal(r.address,'127.0.0.1');assert.equal(r.port,58432);
 assert.equal(path.resolve(r.directory).toLowerCase(),path.resolve(__dirname,'../output/nva-whatsapp-v2-postgres-20261024/cluster').toLowerCase());
 await c.query('BEGIN');
 try{
  await c.query(source('docs/sql/whatsapp-admission-worker-consent-function.sql'));
  await c.query(adapt(source('docs/sql/meta-inbox-production-worker-role.sql')));
  await c.query('ALTER ROLE '+role+' LOGIN');
  await check('canonical restricted role passes real identity SQL',identity);
  await check('missing function fails closed with identity code, not SQLSTATE 42883',async()=>{
   await c.query('SAVEPOINT missing');await c.query('DROP FUNCTION public.nva_record_admission_consent(integer,text,jsonb)');
   await assert.rejects(identity,{code:'META_WORKER_DATABASE_IDENTITY_REJECTED'});await c.query('ROLLBACK TO missing');
  });
  await c.query('GRANT INSERT,UPDATE ON public.whatsapp_conversation_messages,public."WhatsAppAdmissionRequest",public."WhatsAppAdmissionEvent" TO '+role);
  await c.query('GRANT INSERT(sender_user_id),UPDATE(sender_user_id) ON public.whatsapp_conversation_messages TO '+role);
  await c.query('GRANT INSERT(status),UPDATE(status) ON public."WhatsAppAdmissionRequest" TO '+role);
  await c.query('GRANT INSERT(action),UPDATE(action) ON public."WhatsAppAdmissionEvent" TO '+role);
  await check('overprivileged table and column grants reproduce rejection',()=>assert.rejects(identity,{code:'META_WORKER_DATABASE_IDENTITY_REJECTED'}));
  const repair=adapt(source('deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql'));
  await check('transactional repair removes table AND column grants',async()=>{await c.query(repair);await identity();});
  await check('repair can be repeated without broadening privileges',async()=>{await c.query(repair);await identity();});
  for(const [name,grant] of [
   ['PUBLIC column grant','GRANT UPDATE(sender_user_id) ON public.whatsapp_conversation_messages TO PUBLIC'],
   ['PUBLIC table grant','GRANT INSERT ON public."WhatsAppAdmissionEvent" TO PUBLIC'],
   ['role membership','CREATE ROLE nva_repair_parent NOLOGIN; GRANT nva_repair_parent TO '+role]
  ])await check(name+' causes rollback instead of changing shared access',async()=>{
   await c.query('SAVEPOINT pollution');await c.query(grant);await c.query('SAVEPOINT attempt');
   await assert.rejects(()=>c.query(repair),e=>e.code==='P0001');await c.query('ROLLBACK TO attempt');await c.query('ROLLBACK TO pollution');await identity();
  });
  await check('installer target/owner guards and canonical include execute in lab',async()=>{
   let install=source('deploy/whatsapp-chatbot/09-install-admission-consent.sql')
    .replace('\\ir ../../docs/sql/whatsapp-admission-worker-consent-function.sql',()=>source('docs/sql/whatsapp-admission-worker-consent-function.sql'))
    .replace(":'expected_consent_owner'","'nva_v2_lab_owner'");
   await c.query(adapt(install));await identity();
  });
  const conv=(await c.query("INSERT INTO whatsapp_conversations(phone_number,updated_at) VALUES('299999991111',now()) RETURNING id")).rows[0].id;
  const request=(await c.query(`INSERT INTO "WhatsAppAdmissionRequest"("conversationId","fullName","phoneNumber",email,"requestedLevel","sourceMessageId","updatedAt") VALUES($1,'Synthetic repair','299999991111','repair@example.invalid','BEGINNER',$2,now()) RETURNING id`,[conv,role])).rows[0].id;
  await check('restricted consent succeeds with null admin attribution',async()=>{
   await asWorker(()=>c.query("SELECT public.nva_record_admission_consent($1,'CONSENT_CONFIRMED','{\"noticeVersion\":\"admissions-v1\"}'::jsonb)",[request]));
   const e=(await c.query('SELECT action,"adminId" FROM "WhatsAppAdmissionEvent" WHERE "requestId"=$1',[request])).rows;assert.equal(e.length,1);assert.equal(e[0].adminId,null);
  });
  await check('admin actions, malformed notice and direct administrative writes denied',async()=>{
   for(const sql of [
    `SELECT public.nva_record_admission_consent(${request},'ENROLLED','{"noticeVersion":"admissions-v1"}')`,
    `SELECT public.nva_record_admission_consent(${request},'RECONFIRMED','{"noticeVersion":"wrong"}')`
   ])await asWorker(()=>denied(sql,'22023'));
   for(const sql of ['UPDATE "WhatsAppAdmissionRequest" SET status=\'CANCELLED\' WHERE false','UPDATE whatsapp_conversation_messages SET sender_user_id=NULL WHERE false','INSERT INTO "WhatsAppAdmissionEvent"("requestId",action) VALUES('+request+',\'ENROLLED\')'])await asWorker(()=>denied(sql));
  });
  await check('terminal requests reject consent',async()=>{
   await c.query('UPDATE "WhatsAppAdmissionRequest" SET status=\'CANCELLED\' WHERE id=$1',[request]);
   await asWorker(()=>denied(`SELECT public.nva_record_admission_consent(${request},'RECONFIRMED','{"noticeVersion":"admissions-v1"}')`,'22023'));
  });
 }finally{await c.query('ROLLBACK');}
 await check('probe role and synthetic request rolled back',async()=>{assert.equal((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0);assert.equal((await c.query('SELECT 1 FROM "WhatsAppAdmissionRequest" WHERE "sourceMessageId"=$1',[role])).rowCount,0);});
 fs.writeFileSync(path.resolve(__dirname,'../output/nva-worker-postgres-repair-results.json'),JSON.stringify({target:'127.0.0.1:58432/nva_whatsapp_v2_test',productionAccess:false,adaptations:['target DB/port','unique probe role','psql include expansion; outer rollback replaces file transaction boundaries'],checks:results,cleanup:'ROLLBACK; sequence gaps possible'},null,2));
}
main().catch(e=>{console.error('LAB_REPAIR_FAILED '+(e.code||e.name));process.exitCode=1;}).finally(()=>c.end());
