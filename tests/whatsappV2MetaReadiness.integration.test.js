const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID,createHmac,randomBytes}=require('node:crypto');
test('NVA V2 real Meta SQL roles and human handoff',{skip:process.env.NVA_V2_DATABASE_TESTS_ENABLED!=='true'},async t=>{
 const fixtureUrl=process.env.NVA_V2_META_FIXTURE_URL,url=new URL(fixtureUrl);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'58432');assert.equal(url.pathname,'/nva_whatsapp_v2_test');assert.equal(url.username,'nva_v2_lab_owner');assert.equal(url.search,'');
 const {PrismaClient}=require('@prisma/client'),{Client}=require('pg');
 const admin=new PrismaClient({datasourceUrl:fixtureUrl,log:[]});
 const [identity]=await admin.$queryRaw`SELECT current_database() db,inet_server_port() port,current_setting('data_directory') directory`;
 assert.equal(identity.db,'nva_whatsapp_v2_test');assert.equal(identity.port,58432);assert.equal(path.resolve(identity.directory).toLowerCase(),path.resolve(__dirname,'../output/nva-whatsapp-v2-postgres-20261024/cluster').toLowerCase());
 const endpointId=randomUUID(),appKey='nva-meta-readiness',secret=randomBytes(32).toString('hex');
 const env={NODE_ENV:'test',NVA_V2_DATABASE_TESTS_ENABLED:'true',NVA_V2_DATABASE_EXPECTED_DIRECTORY:identity.directory,META_INBOX_ENVIRONMENT:'test',META_WHATSAPP_INBOX_ENABLED:'true',META_INBOX_WORKER_ENABLED:'true',META_INBOX_SEND_ENABLED:'true',META_INBOX_SEND_NOT_BEFORE:new Date(Date.now()-60000).toISOString(),META_INBOX_DATABASE_URL:process.env.META_INBOX_DATABASE_URL,META_INBOX_WORKER_DATABASE_URL:process.env.META_INBOX_WORKER_DATABASE_URL,META_INBOX_ENDPOINT_ID:endpointId,META_INBOX_APPLICATION_KEY:appKey,META_INBOX_APP_ID:'3001',WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',WHATSAPP_ACCESS_TOKEN:'synthetic-no-network',WHATSAPP_APP_SECRET:secret,WHATSAPP_VERIFY_TOKEN:'synthetic-verifier',WHATSAPP_GRAPH_API_VERSION:'v23.0',WHATSAPP_PHONE_NUMBER_ID:'1001',WHATSAPP_BUSINESS_ACCOUNT_ID:'2001',META_INBOX_AUTH_KEY_VERSION:'a1',META_INBOX_LOOKUP_KEYS_JSON:JSON.stringify({l1:randomBytes(32).toString('hex')}),META_INBOX_LOOKUP_KEY_VERSION:'l1',META_INBOX_STREAM_KEY_HEX:randomBytes(32).toString('hex'),META_INBOX_STREAM_KEY_VERSION:'s1',META_INBOX_ENCRYPTION_KEYS_JSON:JSON.stringify({e1:randomBytes(32).toString('hex')}),META_INBOX_ENCRYPTION_KEY_VERSION:'e1'};
 Object.assign(process.env,env);global.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
 const app=require('../src/utils/prisma');
 const tables=['user','course','trainingSession','registrationGroup','enrollment','whatsAppChatbotSettings','notification','whatsAppConversation','whatsAppConversationMessage','whatsAppAdmissionRequest','whatsAppAdmissionEvent','metaWebhookEndpoint','metaWebhookReceipt','metaWebhookEvent','metaWebhookReceiptItem'];
 for(const table of tables)assert.equal(await admin[table].count(),0,'Pristine laboratory required');
 const owned={users:[],courses:[],sessions:[],groups:[],phones:new Set()};
 let worker,ingress,server,store;
 t.after(async()=>{
  if(worker)await worker.close();if(ingress)await ingress.close();
  if(server)await new Promise(r=>server.close(r));if(store)await new Promise(r=>store.clear(r));
  // Metadata retention guards remain ON during every test. This bootstrap-only,
  // local cleanup bypasses retention in ONE transaction on this suite's own IDs.
  await admin.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL session_replication_role=replica`;
   await tx.metaWebhookReceiptItem.deleteMany({where:{endpointId}});await tx.metaWebhookReceipt.deleteMany({where:{endpointId}});await tx.metaWebhookEvent.deleteMany({where:{endpointId}});await tx.metaWebhookEndpoint.deleteMany({where:{id:endpointId}});
   const conversations=await tx.whatsAppConversation.findMany({where:{phoneNumber:{in:[...owned.phones]}},select:{id:true}}),ids=conversations.map(c=>c.id);
   const requests=await tx.whatsAppAdmissionRequest.findMany({where:{conversationId:{in:ids}},select:{id:true}});
   await tx.whatsAppAdmissionEvent.deleteMany({where:{requestId:{in:requests.map(r=>r.id)}}});await tx.whatsAppAdmissionRequest.deleteMany({where:{conversationId:{in:ids}}});
   await tx.notification.deleteMany({where:{userId:{in:owned.users}}});await tx.whatsAppProspectFollowUp.deleteMany({where:{conversationId:{in:ids}}});await tx.whatsAppCommercialConsentEvent.deleteMany({where:{conversationId:{in:ids}}});await tx.whatsAppConversationMessage.deleteMany({where:{conversationId:{in:ids}}});await tx.whatsAppConversation.deleteMany({where:{id:{in:ids}}});
   await tx.whatsAppChatbotSettings.deleteMany({where:{id:1}});await tx.registrationGroup.deleteMany({where:{id:{in:owned.groups}}});await tx.trainingSession.deleteMany({where:{id:{in:owned.sessions}}});await tx.course.deleteMany({where:{id:{in:owned.courses}}});await tx.user.deleteMany({where:{id:{in:owned.users}}});
  });
  for(const table of tables)assert.equal(await admin[table].count(),0);
  const triggers=await admin.$queryRaw`SELECT tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('meta_webhook_events'::regclass,'meta_webhook_receipts'::regclass,'meta_webhook_receipt_items'::regclass,'meta_webhook_endpoints'::regclass)`;assert.equal(triggers.length,7);assert.ok(triggers.every(t=>t.tgenabled==='O'));
  await app.$disconnect();await admin.$disconnect();
 });
 const passwordHash=await require('../src/services/passwordService').hashPassword(randomUUID()+'Aa!7');
 async function actor(role,n){const u=await admin.user.create({data:{firstName:'Laboratory',lastName:role,role,phoneNumber:'+24389100000'+n,passwordHash,mustChangePassword:false}});owned.users.push(u.id);return u;}
 const first=await actor('ADMIN',1),second=await actor('ADMIN',2),student=await actor('STUDENT',3);
 const course=await admin.course.create({data:{title:'Anglais pratique',slug:'meta-'+randomUUID(),shortDescription:'Cours fictif',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',durationValue:8,durationUnit:'WEEKS',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,isPublished:true,lmsStatus:'PUBLISHED',certificateFee:20}});owned.courses.push(course.id);
 const session=await admin.trainingSession.create({data:{courseId:course.id,name:'Session laboratoire',levelNumber:1,startDate:new Date('2099-01-01'),endDate:new Date('2099-04-01'),registrationDeadline:new Date('2098-12-31'),capacity:5,status:'OPEN',weekDays:['Friday'],startTime:'10:00',endTime:'11:30'}});owned.sessions.push(session.id);
 const group=await admin.registrationGroup.create({data:{trainingSessionId:session.id,name:'Matin',capacity:5,weekDays:['Friday'],startTime:'10:00',endTime:'11:30'}});owned.groups.push(group.id);
 await admin.whatsAppChatbotSettings.create({data:{id:1,enabled:true,admissionsEnabled:true,aiEnabled:false}});
 await admin.metaWebhookEndpoint.create({data:{id:endpointId,environment:'test',applicationKey:appKey,metaAppId:'3001',wabaId:'2001',phoneNumberId:'1001',inboxEnabled:true,processingEnabled:true,lookupKeyVersion:'l1',streamKeyVersion:'s1'}});
 ingress=require('../src/services/metaInboxRuntime').createMetaInboxRuntime(env);
 const sent=[],logs=[],faults=new Map();
 worker=require('../src/services/metaInboxWorkerService').createMetaInboxWorker({env,observe:(action,data)=>logs.push({action,...data}),sender:(data,options)=>require('../src/services/whatsappCloudApiService').sendConversationMessage(data,{...options,fetchImpl:async(target,init)=>{
  assert.match(target,/^https:\/\/graph.facebook.com\//);const body=JSON.parse(init.body);sent.push(body);
  const fault=faults.get(body.biz_opaque_callback_data);faults.delete(body.biz_opaque_callback_data);if(fault==='uncertain')throw Error('SYNTHETIC_TRANSPORT_TIMEOUT');
  if(fault==='reject'){return {ok:false,status:403,json:async()=>({error:{code:10}})};}
  return {ok:true,status:200,json:async()=>({messages:[{id:'wamid.mock.'+randomUUID()}]})};
 }})});
 await worker.ready();
 const human=require('../src/services/whatsappHumanHandoffService').createWhatsAppHumanHandoffService({client:app,env,audit:()=>{}});
 async function receive(phone,text,extra={}){owned.phones.add(phone);const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[{id:'wamid.test.'+randomUUID(),from:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text},...extra}]}}]}]}));await ingress.acceptRaw({rawBody,signature:'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),receivedAt:new Date()});const result=await worker.runOnce();assert.equal(result.failed,0,JSON.stringify(logs.slice(-2)));await new Promise(r=>setTimeout(r,5));await worker.runOnce();return app.whatsAppConversation.findUnique({where:{phoneNumber:phone}});}
 const phone='+243890000001';let conversation;
 await t.test('A: signed prospect handoff, history, authorized reply, close and bot resume',async()=>{
  conversation=await receive(phone,'conseiller');assert.equal(conversation.controlState,'HUMAN_TAKEOVER');assert.equal(conversation.assignedAdvisorId,null);
  await human.takeOver(conversation.id,first.id);const before=sent.length;
  await receive(phone,'Je souhaite un accompagnement personnel');assert.equal(sent.length,before);assert.ok(await app.whatsAppConversationMessage.findFirst({where:{conversationId:conversation.id,direction:'INBOUND',body:'Je souhaite un accompagnement personnel'}}));
  await assert.rejects(human.queueManualReply(conversation.id,student.id,'Interdit',randomUUID()),{statusCode:403});
  const form=randomUUID(),concurrent=await Promise.all([human.queueManualReply(conversation.id,first.id,'Bonjour, votre conseiller NVA vous accompagne.',form),human.queueManualReply(conversation.id,first.id,'Bonjour, votre conseiller NVA vous accompagne.',form)]),reply=concurrent[0];assert.equal(concurrent.filter(r=>r.duplicate).length,1);assert.equal(reply.message.deliveryStatus,'QUEUED');assert.equal((await human.queueManualReply(conversation.id,first.id,'Bonjour, votre conseiller NVA vous accompagne.',form)).duplicate,true);await assert.rejects(human.queueManualReply(conversation.id,first.id,'Autre contenu pour le même formulaire',form),{statusCode:409});
  assert.equal((await worker.runOnce()).accepted,1);assert.equal(sent.length,before+1);const accepted=await app.whatsAppConversationMessage.findUnique({where:{id:reply.message.id}});assert.equal(accepted.deliveryStatus,'ACCEPTED');await worker.runOnce();assert.equal(sent.length,before+1);
  for(const [status,expected]of [['delivered','DELIVERED'],['read','READ'],['sent','READ']]){
   const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},statuses:[{id:accepted.providerMessageId,recipient_id:phone.slice(1),status,timestamp:String(Math.floor(Date.now()/1000)),biz_opaque_callback_data:accepted.idempotencyKey}]}}]}]}));
   await ingress.acceptRaw({rawBody,signature:'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),receivedAt:new Date()});await worker.runOnce();assert.equal((await app.whatsAppConversationMessage.findUnique({where:{id:reply.message.id}})).deliveryStatus,expected);
  }assert.equal(sent.length,before+1);
  await human.resume(conversation.id,first.id);conversation=await app.whatsAppConversation.findUnique({where:{id:conversation.id}});assert.equal(conversation.controlState,'BOT_ACTIVE');assert.equal(conversation.assignedAdvisorId,null);
  await receive(phone,'tarifs');assert.equal(sent.length,before+2);
 });
 await t.test('B: complete worker role reads catalogue and creates/reconfirms an admission through real inbox',async()=>{
  const p='+243890000002';await receive(p,'inscription');
  async function click(id){const c=await app.whatsAppConversation.findUnique({where:{phoneNumber:p}}),option=c.engineState.admission.options.find(o=>o.id===id);assert.ok(option,id);return receive(p,'',{type:'interactive',interactive:{button_reply:{id:option.wireId,title:'irrelevant'}}});}
  await click('admin');await click('accept');await receive(p,'Alice Laboratoire');await click('phone-confirm');await receive(p,'alice@example.test');await click('level-BEGINNER');await click('course-'+course.id);await click('session-'+session.id);await click('group-'+group.id);await click('confirm');
  const c=await app.whatsAppConversation.findUnique({where:{phoneNumber:p}}),row=await app.whatsAppAdmissionRequest.findFirst({where:{conversationId:c.id}});assert.equal(row.status,'PENDING');assert.ok(row.consentAt);assert.equal(await admin.enrollment.count(),0);
  // Same role, real admission service, new source: exercise restricted UPDATE including draft.
  const client=new PrismaClient({datasourceUrl:env.META_INBOX_WORKER_DATABASE_URL,log:[]});try{await client.$transaction(tx=>require('../src/services/whatsappAdmissionService').recordConfirmed(tx,{conversationId:c.id,data:{fullName:row.fullName,phoneNumber:p,email:row.email,requestedLevel:row.requestedLevel,courseId:course.id,requestedSessionId:session.id,requestedGroupId:group.id},sourceMessageId:'reconfirm-'+randomUUID(),consentVersion:'admissions-v1'}));}finally{await client.$disconnect();}
  assert.equal(await app.whatsAppAdmissionRequest.count({where:{conversationId:c.id}}),1);
 });
 await t.test('C: concurrent advisors cannot own the same conversation',async()=>{
  const c=await receive('+243890000003','conseiller');const results=await Promise.allSettled([human.takeOver(c.id,first.id),human.takeOver(c.id,second.id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.statusCode===409).length,1);assert.ok([first.id,second.id].includes((await app.whatsAppConversation.findUnique({where:{id:c.id}})).assignedAdvisorId));
 });
 await t.test('D: Meta rejection records failure without claiming success or resending',async()=>{
  const c=await receive('+243890000004','conseiller');await human.takeOver(c.id,first.id);const reply=await human.queueManualReply(c.id,first.id,'Réponse simulée en échec',randomUUID());faults.set(reply.message.idempotencyKey,'reject');const count=sent.length;assert.equal((await worker.runOnce()).failed,1);const row=await app.whatsAppConversationMessage.findUnique({where:{id:reply.message.id}});assert.equal(row.deliveryStatus,'FAILED');assert.equal(row.providerMessageId,null);assert.equal(row.failureCode,'10');await worker.runOnce();assert.equal(sent.length,count+1);
 });
 await t.test('manual replies outside the service window are refused and STOP blocks a queued reply',async()=>{
  const c=await receive('+243890000005','conseiller');await human.takeOver(c.id,first.id);const reply=await human.queueManualReply(c.id,first.id,'Ne pas envoyer après STOP',randomUUID());await receive(c.phoneNumber,'STOP');const row=await app.whatsAppConversationMessage.findUnique({where:{id:reply.message.id}});assert.equal(row.deliveryStatus,'CANCELLED');await assert.rejects(human.queueManualReply(c.id,first.id,'Interdit',randomUUID()),{statusCode:409});
  await human.takeOver(conversation.id,first.id);await admin.whatsAppConversationMessage.updateMany({where:{conversationId:conversation.id,direction:'INBOUND'},data:{providerTimestamp:new Date(Date.now()-25*3600000)}});await assert.rejects(human.queueManualReply(conversation.id,first.id,'Fenêtre fermée',randomUUID()),{statusCode:409});
 });
 await t.test('SQL ACL: allowed reads, rollback and forbidden operations under real worker credentials',async()=>{
  const sql=new Client({connectionString:env.META_INBOX_WORKER_DATABASE_URL});await sql.connect();try{
   const identity=(await sql.query('SELECT current_user role,current_database() db')).rows[0];assert.equal(identity.role,'nva_v2_meta_worker');assert.equal(identity.db,'nva_whatsapp_v2_test');assert.equal((await sql.query('SELECT id FROM public.training_sessions')).rowCount,1);
   const original=(await sql.query('SELECT id,"fullName" FROM public."WhatsAppAdmissionRequest" LIMIT 1')).rows[0];await sql.query('BEGIN');await sql.query('UPDATE public."WhatsAppAdmissionRequest" SET "fullName"=$1 WHERE id=$2',['Rollback Name',original.id]);await sql.query('ROLLBACK');assert.equal((await sql.query('SELECT "fullName" FROM public."WhatsAppAdmissionRequest" WHERE id=$1',[original.id])).rows[0].fullName,original.fullName);
   for(const query of ['SELECT password_hash FROM public.users','SELECT email FROM public.users','INSERT INTO public.users DEFAULT VALUES','UPDATE public.users SET is_active=false','UPDATE public."WhatsAppAdmissionRequest" SET status=\'CANCELLED\'','UPDATE public.courses SET price=1','INSERT INTO public.enrollments DEFAULT VALUES','SELECT * FROM public.payments','SELECT * FROM public.password_reset_tokens','DELETE FROM public."WhatsAppAdmissionRequest"','DELETE FROM public.meta_webhook_events','TRUNCATE public.whatsapp_conversations','CREATE TABLE public.forbidden_probe(id int)','SET session_replication_role=replica'])await assert.rejects(sql.query(query),e=>e.code==='42501',query);
   for(const query of ['INSERT INTO public.whatsapp_conversation_messages(conversation_id,direction,sender_user_id,updated_at) VALUES (1,\'OUTBOUND\',1,now())','INSERT INTO public."WhatsAppAdmissionRequest"(status,"updatedAt") VALUES (\'ENROLLED\',now())','INSERT INTO public."WhatsAppAdmissionRequest"("enrollmentId","updatedAt") VALUES (1,now())','SELECT nextval(\'public.users_id_seq\')','SELECT setval(\'public.whatsapp_conversations_id_seq\',1)','SET ROLE nva_v2_lab_owner'])await assert.rejects(sql.query(query),e=>e.code==='42501',query);
   await assert.rejects(sql.query('INSERT INTO public."WhatsAppAdmissionEvent"("requestId",action,metadata) VALUES($1,$2,$3)',[original.id,'EMAIL_VERIFIED',{}]),e=>e.code==='42501');
   await assert.rejects(sql.query('SELECT public.nva_record_admission_consent($1,$2,$3::jsonb)',[original.id,'EMAIL_VERIFIED',JSON.stringify({noticeVersion:'admissions-v1'})]),e=>e.code==='22023');
  }finally{await sql.end();}
 });
 await t.test('ingress cannot read student data or perform business writes',async()=>{
  const sql=new Client({connectionString:env.META_INBOX_DATABASE_URL});await sql.connect();try{for(const query of ['SELECT * FROM public.users','SELECT * FROM public.courses','INSERT INTO public."WhatsAppAdmissionRequest" DEFAULT VALUES','UPDATE public.whatsapp_conversations SET control_state=\'BOT_ACTIVE\'','SELECT public.nva_record_admission_consent(1,\'CONSENT_CONFIRMED\',\'{}\'::jsonb)'])await assert.rejects(sql.query(query),e=>e.code==='42501');}finally{await sql.end();}
 });
 await t.test('actual admin HTTP renders and sends a scoped Meta reply with ADMIN and CSRF',async()=>{
  const express=require('express'),http=require('node:http'),sessions=require('express-session'),web=express(),validate=require('../src/middlewares/validateSession');
  web.set('view engine','ejs');web.set('views',path.resolve(__dirname,'../views'));web.use('/webhooks/whatsapp',require('../src/routes/whatsappWebhookRoutes').createMetaWebhookRouter({env,inboxService:ingress}));web.use(express.urlencoded({extended:false}));store=new sessions.MemoryStore();web.use(sessions({secret:randomUUID(),resave:false,saveUninitialized:false,store}));
  web.post('/test-login',async(req,res)=>{req.session.user=validate.sessionUser(await app.user.findUnique({where:{id:Number(req.body.id)}}));res.sendStatus(200);});web.use(validate);
  web.use((req,res,next)=>{Object.assign(res.locals,{currentUser:req.authenticatedUser,user:req.authenticatedUser,path:req.path,requestId:'lab',siteSettings:{},notifications:[],unreadNotificationCount:0});next();});process.env.CSRF_ENFORCE='true';web.use(require('../src/middlewares/csrfProtection').protect);web.get('/test-csrf',(req,res)=>res.json({token:req.session.csrfToken}));web.use('/admin/whatsapp',require('../src/routes/adminWhatsAppRoutes'));web.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:error.message}));
  server=web.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let cookie='';
  async function request(route,method='GET',data){const body=data?new URLSearchParams(data).toString():'';return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text}));});r.on('error',reject);r.end(body);});}
  const c=await receive('+243890000006','conseiller'),route='/admin/whatsapp/conversations/'+c.id;
  assert.equal((await request(route)).status,302);await request('/test-login','POST',{id:student.id});assert.equal((await request(route)).status,403);
  await request('/test-login','POST',{id:first.id});const csrf=JSON.parse((await request('/test-csrf')).body).token;
  assert.equal((await request(route+'/takeover','POST',{})).status,403);assert.equal((await request(route+'/takeover','POST',{_csrf:csrf})).status,302);
  const page=await request(route);assert.equal(page.status,200,page.body);assert.equal(page.headers['cache-control'],'no-store');assert.match(page.body,/name="message"/);assert.match(page.body,/conseiller/);
  const list=await request('/admin/whatsapp/conversations');assert.equal(list.status,200,list.body);assert.equal(list.headers['cache-control'],'no-store');
  const payload={_csrf:csrf,message:'Réponse HTTP autorisée',submissionId:randomUUID()};assert.equal((await request(route+'/reply','POST',payload)).status,303);assert.equal((await request(route+'/reply','POST',payload)).status,303);const before=sent.length;assert.equal((await worker.runOnce()).accepted,1);assert.equal(sent.length,before+1);
  assert.equal((await request(route+'/resume','POST',{_csrf:csrf})).status,302);assert.equal((await app.whatsAppConversation.findUnique({where:{id:c.id}})).controlState,'BOT_ACTIVE');
 });
 await t.test('ambiguous manual send is never retried and legacy/other-endpoint queues remain untouched',async()=>{
  const c=await receive('+243890000007','conseiller');await human.takeOver(c.id,first.id);const reply=await human.queueManualReply(c.id,first.id,'Envoi incertain',randomUUID());faults.set(reply.message.idempotencyKey,'uncertain');const before=sent.length;await worker.runOnce();const row=await app.whatsAppConversationMessage.findUnique({where:{id:reply.message.id}});assert.equal(row.deliveryStatus,'FAILED');assert.equal(row.failureCode,'DELIVERY_UNCERTAIN');assert.equal(row.providerMessageId,null);
  const legacy=await app.whatsAppConversationMessage.create({data:{conversationId:c.id,direction:'OUTBOUND',messageType:'TEXT',senderUserId:first.id,body:'Ancien message exclu',deliveryStatus:'QUEUED',idempotencyKey:'wa-manual:'+c.id+':'+randomUUID()}});
  const other=await app.whatsAppConversationMessage.create({data:{conversationId:c.id,direction:'OUTBOUND',messageType:'TEXT',senderUserId:first.id,body:'Autre endpoint exclu',deliveryStatus:'QUEUED',idempotencyKey:'wa-meta-manual:'+randomUUID()+':'+c.id+':'+randomUUID()}});
  await worker.runOnce();assert.equal(sent.length,before+1);for(const id of [legacy.id,other.id])assert.equal((await app.whatsAppConversationMessage.findUnique({where:{id}})).deliveryStatus,'QUEUED');
  const oldForm=randomUUID();await app.whatsAppConversationMessage.create({data:{conversationId:c.id,direction:'OUTBOUND',messageType:'TEXT',senderUserId:first.id,body:'Ancien formulaire déjà traité',deliveryStatus:'SENT',providerMessageId:'wamid.old.'+randomUUID(),idempotencyKey:'wa-manual:'+c.id+':'+oldForm}});await assert.rejects(human.queueManualReply(c.id,first.id,'Ancien formulaire déjà traité',oldForm),{statusCode:409});
 });
 await t.test('revoked author and resumed conversation cancel queued manual responses',async()=>{
  const c=await receive('+243890000008','conseiller');await human.takeOver(c.id,first.id);const firstReply=await human.queueManualReply(c.id,first.id,'Auteur révoqué',randomUUID());await admin.user.update({where:{id:first.id},data:{isActive:false}});const before=sent.length;await worker.runOnce();assert.equal((await app.whatsAppConversationMessage.findUnique({where:{id:firstReply.message.id}})).deliveryStatus,'CANCELLED');assert.equal(sent.length,before);await admin.user.update({where:{id:first.id},data:{isActive:true}});
  const next=await human.queueManualReply(c.id,first.id,'Ne pas envoyer après reprise',randomUUID());await human.resume(c.id,first.id);await worker.runOnce();assert.equal((await app.whatsAppConversationMessage.findUnique({where:{id:next.message.id}})).deliveryStatus,'CANCELLED');assert.equal(sent.length,before);
 });
 await t.test('mounted signed HTTP webhook persists once and the real worker processes it once',async()=>{
  const http=require('node:http'),phone='+243890000009',native='wamid.http.'+randomUUID();owned.phones.add(phone);
  const body=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[{id:native,from:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'conseiller'}}]}}]}]}));
  async function post(){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/webhooks/whatsapp',method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end(body);});}
  assert.equal(await post(),200);assert.equal(await post(),200);assert.equal(await admin.metaWebhookEvent.count({where:{endpointId,nativeMessageId:native}}),1);
  const before=sent.length;await worker.runOnce();await worker.runOnce();const c=await app.whatsAppConversation.findUnique({where:{phoneNumber:phone}});assert.equal(c.controlState,'HUMAN_TAKEOVER');assert.equal(await app.whatsAppConversationMessage.count({where:{conversationId:c.id,direction:'INBOUND'}}),1);assert.equal(sent.length,before+1);
 });
 await t.test('worker refuses an excessive decision privilege before processing',async()=>{
  try{await admin.$executeRaw`GRANT INSERT (status) ON public."WhatsAppAdmissionRequest" TO nva_v2_meta_worker`;await assert.rejects(worker.ready(),{code:'META_WORKER_DATABASE_IDENTITY_REJECTED'});}
  finally{await admin.$executeRaw`REVOKE INSERT (status) ON public."WhatsAppAdmissionRequest" FROM nva_v2_meta_worker`;}
  await worker.ready();
 });
});
