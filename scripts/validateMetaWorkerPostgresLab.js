// Real PostgreSQL integration. Fixed synthetic cluster only; no dotenv or live transport.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Client } = require('pg'), { randomUUID, createHmac } = require('node:crypto');
process.chdir(path.resolve(__dirname,'..'));
for (const k of Object.keys(process.env)) if (/DATABASE_URL|^WHATSAPP_|^META_|^OPENAI_|^NVA_CHATBOT_/i.test(k)) delete process.env[k];
Object.assign(process.env,{ NODE_ENV:'test', DATABASE_URL:'postgresql://blocked@127.0.0.1:1/forbidden', WHATSAPP_ENABLED:'false', WHATSAPP_WORKERS_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false' });
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const target = { host:'127.0.0.1',port:55432,database:'nva_whatsapp_test' };
const results=[]; let owner, workerSql, ingressSql, db, runtime, worker, singleton;
async function check(name,fn) {
  try { await fn(); results.push({name,status:'PASS'}); console.log('PASS '+name); }
  catch(e) { results.push({name,status:'FAIL',code:e.code || e.name}); console.log('FAIL '+name+' '+(e.code || e.name)); throw e; }
}
async function denied(c,sql) { await assert.rejects(()=>c.query(sql),e=>e.code==='42501'); }
async function main() {
  assert.equal(process.env.NVA_META_WORKER_LAB,'isolated-worker-validation');
  owner=new Client({...target,user:'nva_worker_lab_owner'}); await owner.connect();
  const {rows:[r]}=await owner.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS dir");
  assert.equal(r.db,target.database); assert.equal(r.role,'nva_worker_lab_owner'); assert.equal(r.host,target.host); assert.equal(r.port,target.port);
  assert.equal(path.resolve(r.dir).toLowerCase(),path.resolve('output/meta-worker-postgres/cluster').toLowerCase());
  await check('final production worker SQL provisions a fresh NOLOGIN probe with identical grants',async()=>{
    const source=fs.readFileSync('docs/sql/meta-inbox-production-worker-role.sql','utf8');
    const probe='nva_worker_probe_'+randomUUID().replaceAll('-','').slice(0,12);
    const sql=source.replaceAll('english_center','nva_whatsapp_test').replaceAll('nva_meta_inbox_worker_prod',probe)
      .replaceAll('5432','55432').split(/\r?\n/).filter(line=>!line.startsWith('\\')).join('\n');
    try {await owner.query(sql);}catch(e){await owner.query('ROLLBACK');throw e;}
    assert.equal((await owner.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[probe])).rows[0].rolcanlogin,false);
    fs.writeFileSync('output/meta-worker-postgres/final-sql-evidence.json',JSON.stringify({sourceSha256:require('node:crypto').createHash('sha256').update(source).digest('hex'),
      adaptations:['database english_center -> nva_whatsapp_test','port 5432 -> 55432','role -> unique NOLOGIN lab probe'],executed:true},null,2));
  });
  const {PrismaClient}=require('@prisma/client');
  db=new PrismaClient({datasourceUrl:'postgresql://nva_worker_lab_owner@127.0.0.1:55432/nva_whatsapp_test',log:[]});
  singleton={ $disconnect:async()=>{} };
  const defaultModule=require.resolve('../src/utils/prisma');
  require.cache[defaultModule]={id:defaultModule,filename:defaultModule,loaded:true,exports:new Proxy(singleton,{get(target,key){
    if(key==='$disconnect')return target[key]; throw Error('DEFAULT_APPLICATION_DATABASE_FORBIDDEN');
  }})};
  workerSql=new Client({...target,user:'nva_meta_inbox_worker'}); ingressSql=new Client({...target,user:'nva_meta_inbox_ingress'});
  await workerSql.connect(); await ingressSql.connect();
  await check('47 local migrations applied without failed entries; hashes unchanged',async()=>{
    const rows=(await owner.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    const files=fs.readdirSync('prisma/migrations').filter(n=>fs.existsSync(`prisma/migrations/${n}/migration.sql`)).sort(); assert.equal(rows.length,files.length); assert.equal(rows.length,47);
    for (const row of rows) { assert.ok(row.finished_at); assert.equal(row.rolled_back_at,null); assert.equal(row.checksum,require('node:crypto').createHash('sha256').update(fs.readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`)).digest('hex')); }
  });
  await check('HTTP sessions retained outside Prisma; columns and expiry index present',async()=>{
    const names=(await owner.query("SELECT column_name FROM information_schema.columns WHERE table_name='http_sessions' ORDER BY ordinal_position")).rows.map(x=>x.column_name);
    assert.deepEqual(names,['sid','sess','expire']);
    assert.ok((await owner.query("SELECT 1 FROM pg_indexes WHERE tablename='http_sessions' AND indexdef LIKE '%(expire)%'")).rowCount);
  });
  await check('complete Meta schema: 86 columns, 22 constraints, 25 indexes, seven safety triggers',async()=>{
    const {rows:[r]}=await owner.query("WITH tables AS (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('meta_webhook_endpoints','meta_webhook_events','meta_webhook_receipts','meta_webhook_receipt_items')) SELECT (SELECT count(*)::int FROM pg_attribute WHERE attrelid IN (SELECT oid FROM tables) AND attnum>0 AND NOT attisdropped) AS columns,(SELECT count(*)::int FROM pg_constraint WHERE conrelid IN (SELECT oid FROM tables) AND contype <> 't') AS constraints,(SELECT count(*)::int FROM pg_index WHERE indrelid IN (SELECT oid FROM tables) AND indisvalid) AS indexes,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM tables) AND NOT tgisinternal AND tgenabled='O') AS triggers");
    assert.deepEqual(r,{columns:86,constraints:22,indexes:25,triggers:7});
  });
  await check('worker has no superuser, inherited roles, DDL, TEMP or ownership',async()=>{
    const config={database:target.database,role:'nva_meta_inbox_worker',port:target.port};
    await require('../src/services/metaInboxWorkerService').verifyWorkerIdentity({$queryRaw:async()=> (await workerSql.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS database_create,has_schema_privilege(current_user,'public','CREATE') AS schema_create,EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND (c.relowner=r.oid OR (c.relkind IN ('r','p','v','m') AND has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')))) AS forbidden FROM pg_roles r WHERE r.rolname=current_user")).rows},config);
    await denied(workerSql,'CREATE TABLE public.worker_forbidden(id int)'); await denied(workerSql,'CREATE TEMP TABLE worker_forbidden(id int)');
    await denied(workerSql,'SET ROLE nva_worker_lab_migrator');
  });
  for(const [name,sql] of [
    ['password hash reads','SELECT password_hash FROM users'],['user writes','UPDATE users SET is_active=false WHERE false'],
    ['enrollment writes','UPDATE enrollments SET status=status WHERE false'],['payment writes','UPDATE payments SET status=status WHERE false'],
    ['pedagogical payment reads','SELECT * FROM student_payments'],['HTTP session access','SELECT * FROM http_sessions'],
    ['notification edits','UPDATE notifications SET message=message WHERE false'],['admission conversion','UPDATE "WhatsAppAdmissionRequest" SET status=\'ENROLLED\' WHERE false'],
    ['advisor assignment','UPDATE "WhatsAppAdmissionRequest" SET "assignedAdminId"=NULL WHERE false'],
    ['follow-up template edits','UPDATE whatsapp_prospect_follow_ups SET template_name=template_name WHERE false'],
    ['event insertion','INSERT INTO meta_webhook_events DEFAULT VALUES'],['endpoint activation','UPDATE meta_webhook_endpoints SET processing_enabled=true WHERE false'],
    ['event payload edits','UPDATE meta_webhook_events SET normalized_payload_ciphertext=NULL WHERE false'],
    ['message identity edits','UPDATE whatsapp_conversation_messages SET idempotency_key=idempotency_key WHERE false'],
    ['message deletion','DELETE FROM whatsapp_conversation_messages WHERE false'],['event truncation','TRUNCATE meta_webhook_events'],
  ]) await check('worker denies '+name,()=>denied(workerSql,sql));
  const ingressBefore=(await owner.query("SELECT c.relname,c.relacl::text AS acl FROM pg_class c WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname")).rows;
  for(const [name,sql] of [['users','SELECT id FROM users'],['admissions','SELECT * FROM "WhatsAppAdmissionRequest"'],
    ['claim fields','UPDATE meta_webhook_events SET processing_attempts=processing_attempts+1 WHERE false'],
    ['processing activation','UPDATE meta_webhook_endpoints SET processing_enabled=true WHERE false'],
    ['DELETE','DELETE FROM meta_webhook_events WHERE false'],['DDL','CREATE TABLE public.ingress_forbidden(id int)'],
    ['TEMP','CREATE TEMP TABLE ingress_forbidden(id int)'],['worker membership','SET ROLE nva_meta_inbox_worker']])
    await check('ingress still denies '+name,()=>denied(ingressSql,sql));
  const id=randomUUID(), suffix=String(require('node:crypto').randomInt(100000,999999)), phone='24389'+suffix+'1', sent=[];
  // Retain all synthetic data on rerun; deactivate only earlier fixtures in this verified lab.
  await owner.query("UPDATE meta_webhook_endpoints SET inbox_enabled=false,processing_enabled=false,disabled_at=now() WHERE application_key LIKE 'lab-%' AND disabled_at IS NULL");
  await owner.query("UPDATE courses SET is_published=false WHERE slug LIKE 'worker-lab-%'");
  const env={ NODE_ENV:'test',META_WHATSAPP_INBOX_ENABLED:'true',META_INBOX_ENVIRONMENT:'test',META_INBOX_WORKER_ENABLED:'true',
    META_INBOX_DATABASE_URL:'postgresql://nva_meta_inbox_ingress:synthetic@127.0.0.1:55432/nva_whatsapp_test',
    META_INBOX_WORKER_DATABASE_URL:'postgresql://nva_meta_inbox_worker:synthetic@127.0.0.1:55432/nva_whatsapp_test',
    META_INBOX_ENDPOINT_ID:id,META_INBOX_APPLICATION_KEY:'lab-'+id,META_INBOX_APP_ID:BigInt('0x'+id.replaceAll('-','')).toString(),WHATSAPP_BUSINESS_ACCOUNT_ID:'2001',WHATSAPP_PHONE_NUMBER_ID:'1001',
    META_INBOX_AUTH_KEY_VERSION:'a1',WHATSAPP_APP_SECRET:'synthetic-lab-only',
    META_INBOX_LOOKUP_KEYS_JSON:JSON.stringify({l1:'01'.repeat(32)}),META_INBOX_LOOKUP_KEY_VERSION:'l1',
    META_INBOX_STREAM_KEY_HEX:'02'.repeat(32),META_INBOX_STREAM_KEY_VERSION:'s1',META_INBOX_ENCRYPTION_KEYS_JSON:JSON.stringify({e1:'03'.repeat(32)}),META_INBOX_ENCRYPTION_KEY_VERSION:'e1',
    WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',META_INBOX_SEND_ENABLED:'false',META_INBOX_SEND_NOT_BEFORE:new Date(Date.now()-30000).toISOString(),
    WHATSAPP_ACCESS_TOKEN:'synthetic-not-real',WHATSAPP_GRAPH_API_VERSION:'v23.0',WHATSAPP_FAKE_MODE:'false' };
  // All rows below are synthetic; reused role permissions are not broadened.
  await owner.query("UPDATE users SET is_active=false WHERE password_hash='synthetic-disabled-login'");
  const admin=await db.user.create({data:{firstName:'Lab',lastName:'Admin',phoneNumber:'+24389'+suffix+'2',role:'ADMIN',passwordHash:'synthetic-disabled-login'}});
  const student=await db.user.create({data:{firstName:'Lab',lastName:'Student',phoneNumber:'+24389'+suffix+'3',role:'STUDENT',passwordHash:'synthetic-disabled-login'}});
  await db.whatsAppPreference.create({data:{userId:student.id,phoneNumber:student.phoneNumber,isEnabled:true,hasOptedIn:true}});
  const course=await db.course.create({data:{title:'Lab English',slug:'worker-lab-'+id,shortDescription:'Local synthetic course',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,registrationFee:0,durationValue:8,durationUnit:'WEEKS',trainingMode:'ONLINE',isPublished:true,lmsStatus:'PUBLISHED'}});
  const session=await db.trainingSession.create({data:{courseId:course.id,name:'Lab level 1',levelNumber:1,startDate:new Date('2099-01-01'),endDate:new Date('2099-05-01'),registrationDeadline:new Date('2098-12-31'),capacity:10,status:'OPEN',weekDays:['Friday','Saturday'],startTime:'10:00',endTime:'11:30',platform:'GOOGLE_MEET'}});
  await db.registrationGroup.create({data:{trainingSessionId:session.id,name:'Lab group',weekDays:['Friday','Saturday'],startTime:'10:00',endTime:'11:30',capacity:10}});
  await db.whatsAppChatbotSettings.upsert({where:{id:1},create:{id:1,enabled:true,admissionsEnabled:true,aiEnabled:false},update:{enabled:true,admissionsEnabled:true,aiEnabled:false}});
  await db.metaWebhookEndpoint.create({data:{id,environment:'test',applicationKey:env.META_INBOX_APPLICATION_KEY,metaAppId:env.META_INBOX_APP_ID,wabaId:'2001',phoneNumberId:'1001',lookupKeyVersion:'l1',streamKeyVersion:'s1',inboxEnabled:true,processingEnabled:true}});
  runtime=require('../src/services/metaInboxRuntime').createMetaInboxRuntime(env);
  await check('unchanged receive-only runtime ready with restricted ingress role',()=>runtime.ready());
  const compose=()=>require('../src/services/metaInboxWorkerService').createMetaInboxWorker({env,sender:(data,options)=>require('../src/services/whatsappCloudApiService').sendConversationMessage(data,{...options,fetchImpl:async()=>{
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='nva_meta_inbox_worker' AND state LIKE '%transaction%'")).rows[0].n,0);
    sent.push(data);return {ok:true,status:200,json:async()=>({messages:[{id:'wamid.lab.sent.'+id+'.'+sent.length}]})};
  }})});
  worker=compose(); let lastMessage,lastInput;
  async function receive(text,option,from=phone) {
    const conv=await db.whatsAppConversation.findUnique({where:{phoneNumber:'+'+from}});
    const selected=option?conv?.engineState?.admission?.options.find(o=>o.id===option):null; assert.ok(!option||selected,'Expected interactive option');
    const latest=option?await db.whatsAppConversationMessage.findFirst({where:{conversationId:conv.id,direction:'OUTBOUND'},orderBy:{id:'desc'}}):null;
    const kind=latest?.interactivePayload?.type==='list'?'list_reply':'button_reply';
    lastMessage={id:'wamid.lab.'+randomUUID(),from,timestamp:String(Math.floor(Date.now()/1000)),...(option?{type:'interactive',interactive:{[kind]:{id:selected.wireId,title:'Synthetic label'}}}:{type:'text',text:{body:text}})};
    const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[lastMessage]}}]}]}));
    lastInput={rawBody,signature:'sha256='+createHmac('sha256',env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex'),receivedAt:new Date()};
    await runtime.acceptRaw(lastInput); const result=await worker.runOnce();
    assert.equal(result.failed,0); assert.equal(result.retrying,0);
    assert.equal((await db.metaWebhookEvent.findFirst({where:{nativeMessageId:lastMessage.id}})).state,'PROCESSED'); return result;
  }
  await check('real transaction commits inbound, engine and QUEUED response; sending disabled',async()=>{
    await receive('Bonjour'); assert.equal(sent.length,0);
    const row=await db.whatsAppConversationMessage.findUnique({where:{idempotencyKey:'wa-reply:'+lastMessage.id+':0'}}); assert.equal(row.deliveryStatus,'QUEUED'); assert.match(row.body,/100 % en ligne/);
  });
  await check('scoped outgoing claims and mocked Meta acceptance outside PostgreSQL transaction',async()=>{
    env.META_INBOX_SEND_ENABLED='true'; const result=await worker.runOnce(); assert.equal(result.accepted,1); assert.equal(sent.length,1);
  });
  await check('restricted worker reads actual course, prices, hours and registration sessions',async()=>{
    await receive('','catalog');
    await receive('menu'); await receive('','price');
    const row=await db.whatsAppConversationMessage.findUnique({where:{idempotencyKey:'wa-reply:'+lastMessage.id+':0'}}); assert.match(row.body,/60 USD par niveau/);
    await receive('menu'); await receive('','schedule');
    const hours=await db.whatsAppConversationMessage.findUnique({where:{idempotencyKey:'wa-reply:'+lastMessage.id+':0'}});
    assert.match(hours.body,/vendredi/i);assert.match(hours.body,/samedi/i);
  });
  await check('complete admission with actual permissions creates request, audit and IN_APP notification',async()=>{
    await receive('menu'); await receive('','price'); await receive('','yes'); await receive('','admin'); await receive('','accept');
    await receive('Synthetic Prospect'); await receive('','phone-confirm'); await receive('prospect@example.test'); await receive('','level-BEGINNER'); await receive('','confirm');
    const req=await db.whatsAppAdmissionRequest.findUniqueOrThrow({where:{sourceMessageId:lastMessage.id}}); assert.equal(req.status,'PENDING');
    assert.equal(await db.whatsAppAdmissionEvent.count({where:{requestId:req.id}}),1); assert.equal(await db.notification.count({where:{userId:admin.id}}),1);
    // Reconfirmation exercises UPDATE column permissions and existing upsert(update:{}).
    const c=new PrismaClient({datasourceUrl:env.META_INBOX_WORKER_DATABASE_URL});
    try { await c.$transaction(tx=>require('../src/services/whatsappAdmissionService').recordConfirmed(tx,{conversationId:req.conversationId,data:{fullName:'Synthetic Prospect',phoneNumber:'+'+phone,email:'prospect@example.test',requestedLevel:'BEGINNER'},consentVersion:'admissions-v1',sourceMessageId:'wamid.reconfirm.'+randomUUID()})); }
    finally {await c.$disconnect();}
    assert.equal(await db.notification.count({where:{userId:admin.id}}),1);
  });
  await check('duplicate webhook and worker restart do not duplicate responses',async()=>{
    const before=await db.whatsAppConversationMessage.count(); await runtime.acceptRaw(lastInput); await worker.runOnce(); await worker.close(); worker=compose(); await worker.runOnce(); assert.equal(await db.whatsAppConversationMessage.count(),before);
  });
  await check('STOP for existing user revokes preference and cancels existing delivery',async()=>{
    const delivery=await db.whatsAppDelivery.create({data:{userId:student.id,phoneNumber:student.phoneNumber,templateName:'synthetic',templateLanguage:'fr',deduplicationKey:'lab-'+id}});
    await receive('STOP',null,student.phoneNumber.slice(1));
    assert.equal((await db.whatsAppPreference.findUnique({where:{userId:student.id}})).hasOptedIn,false);
    assert.equal((await db.whatsAppDelivery.findUnique({where:{id:delivery.id}})).status,'CANCELLED');
  });
  await check('advisor handoff sends acknowledgement only then pauses bot',async()=>{
    await receive('conseiller'); const n=sent.length; await receive('formations'); assert.equal(sent.length,n);
    assert.equal((await db.whatsAppConversation.findUnique({where:{phoneNumber:'+'+phone}})).controlState,'HUMAN_TAKEOVER');
  });
  await check('all three callback circuits update statuses with column-limited SQL grants',async()=>{
    const conversation=await db.whatsAppConversation.findUniqueOrThrow({where:{phoneNumber:'+'+phone}});
    const reply=await db.whatsAppConversationMessage.findFirstOrThrow({where:{conversationId:conversation.id,direction:'OUTBOUND',deliveryStatus:'ACCEPTED'}});
    const consent=await db.whatsAppCommercialConsentEvent.create({data:{conversationId:conversation.id,scope:'COMMERCIAL_FOLLOW_UPS',decision:'GRANTED',source:'ADMIN_RECORDED',occurredAt:new Date(),deduplicationKey:'lab-consent-'+id}});
    const follow=await db.whatsAppProspectFollowUp.create({data:{conversationId:conversation.id,consentEventId:consent.id,sequenceHours:24,templateName:'synthetic',deduplicationKey:'lab-follow-'+id,scheduledFor:new Date(),status:'ACCEPTED',providerMessageId:'wamid.follow.'+id}});
    const delivery=await db.whatsAppDelivery.create({data:{userId:student.id,phoneNumber:student.phoneNumber,templateName:'synthetic',templateLanguage:'fr',deduplicationKey:'lab-delivery-'+id,status:'ACCEPTED',providerMessageId:'wamid.delivery.'+id}});
    const statuses=[reply,follow,delivery].map(x=>({id:x.providerMessageId,status:'delivered',timestamp:String(Math.floor(Date.now()/1000))}));
    const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},statuses}}]}]}));
    await runtime.acceptRaw({rawBody,signature:'sha256='+createHmac('sha256',env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex'),receivedAt:new Date()});
    const result=await worker.runOnce();assert.equal(result.processed,3);assert.equal(result.retrying,0);
    assert.equal((await db.whatsAppConversationMessage.findUnique({where:{id:reply.id}})).deliveryStatus,'DELIVERED');
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({where:{id:follow.id}})).status,'DELIVERED');
    assert.equal((await db.whatsAppDelivery.findUnique({where:{id:delivery.id}})).status,'DELIVERED');
  });
  await check('UTC recovery cutoff leaves fresh work intact and marks only stale work uncertain',async()=>{
    const conversation=await db.whatsAppConversation.findUniqueOrThrow({where:{phoneNumber:'+'+phone}});
    const rows=await db.whatsAppConversationMessage.findMany({where:{conversationId:conversation.id,direction:'OUTBOUND'},take:2,orderBy:{id:'asc'}}); assert.equal(rows.length,2);
    await db.whatsAppConversationMessage.update({where:{id:rows[0].id},data:{deliveryStatus:'PROCESSING',attempts:1,updatedAt:new Date(Date.now()-16*60000)}});
    await db.whatsAppConversationMessage.update({where:{id:rows[1].id},data:{deliveryStatus:'PROCESSING',attempts:1,updatedAt:new Date()}});
    const result=await worker.runOnce();assert.equal(result.uncertain,1);
    assert.equal((await db.whatsAppConversationMessage.findUnique({where:{id:rows[0].id}})).failureCode,'DELIVERY_UNCERTAIN');
    assert.equal((await db.whatsAppConversationMessage.findUnique({where:{id:rows[1].id}})).deliveryStatus,'PROCESSING');
  });
  await check('real SQL 42501 rolls back effect and schedules retry without partial reply',async()=>{
    await owner.query('REVOKE INSERT ON whatsapp_conversation_messages FROM nva_meta_inbox_worker');
    try {
      const msg={id:'wamid.retry.'+randomUUID(),from:'243890000114',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Bonjour'}};
      const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[msg]}}]}]}));
      await runtime.acceptRaw({rawBody,signature:'sha256='+createHmac('sha256',env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex'),receivedAt:new Date()});
      const result=await worker.runOnce(); assert.equal(result.retrying,1);
      assert.equal(await db.whatsAppConversationMessage.count({where:{providerMessageId:msg.id}}),0);
      assert.equal((await db.metaWebhookEvent.findFirst({where:{nativeMessageId:msg.id}})).state,'RETRY_WAIT');
    } finally { await owner.query('GRANT INSERT ON whatsapp_conversation_messages TO nva_meta_inbox_worker'); }
  });
  await check('integration did not modify role grants and HTTP sessions remain present',async()=>{
    const after=(await owner.query("SELECT c.relname,c.relacl::text AS acl FROM pg_class c WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname")).rows;
    // ACL array ordering may change after revoke/regrant; compare privileges semantically.
    for (const row of ingressBefore) { const actual=after.find(x=>x.relname===row.relname); assert.deepEqual((actual.acl||'').slice(1,-1).split(',').sort(),(row.acl||'').slice(1,-1).split(',').sort()); }
    assert.equal((await owner.query("SELECT to_regclass('public.http_sessions') IS NOT NULL AS present")).rows[0].present,true);
  });
}
main().catch(e=>{ if(!results.some(x=>x.status==='FAIL'))results.push({name:'harness',status:'FAIL',code:e.code||e.name}); fs.writeFileSync('output/meta-worker-postgres/failure-local.txt',String(e.stack)); process.exitCode=1; }).finally(async()=>{
  for(const close of [()=>worker?.close(),()=>runtime?.close(),()=>db?.$disconnect(),()=>singleton?.$disconnect(),()=>workerSql?.end(),()=>ingressSql?.end(),()=>owner?.end()])try{await close();}catch{}
  fs.writeFileSync('output/meta-worker-postgres/results.json',JSON.stringify(results,null,2)); console.log(JSON.stringify({pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length}));
});
