// Exact production worker ROLE/ACL on a fresh laboratory only. No live provider.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
test('V3 canonical worker role under least privilege',{skip:!process.env.NVA_V3_WORKER_URL},async t=>{
 const stage=process.env.NVA_V3_ACL_STAGE;assert.ok(['before','after'].includes(stage));
 const url=new URL(process.env.NVA_V3_WORKER_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'59432');assert.equal(url.pathname,'/nva_whatsapp_v3_test');assert.equal(url.username,'nva_meta_inbox_worker_prod');assert.equal(url.search,'');
 assert.ok(path.resolve(process.env.NVA_V3_LAB_DIRECTORY).startsWith(path.resolve(__dirname,'../output/nva-v3-corrections')+path.sep));
 process.env.NODE_ENV='test';process.env.DATABASE_URL=url.toString();
 let external=0;global.fetch=async()=>{external++;throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 const {PrismaClient}=require('@prisma/client');const raw=new PrismaClient({datasourceUrl:url.toString()});t.after(()=>raw.$disconnect());
 const verify=require('../src/services/metaInboxWorkerService').verifyWorkerIdentity;
 const identityConfig={database:'nva_whatsapp_v3_test',role:'nva_meta_inbox_worker_prod',port:59432};
 const db=new Proxy(raw,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(async tx=>{await verify(tx,identityConfig);return fn(tx);},options);const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const [identity]=await db.$queryRaw`SELECT current_database() db,current_user role,host(inet_server_addr()) host,inet_server_port() port`;
 assert.equal(identity.role,'nva_meta_inbox_worker_prod');assert.equal(identity.db,'nva_whatsapp_v3_test');assert.equal(identity.host,'127.0.0.1');
 await db.$transaction(async()=>{}, {isolationLevel:'ReadCommitted'});
 const denied=e=>e?.code==='P2010'&&e.meta?.code==='42501';
 await t.test('worker cannot read passwords, create enrollments or decide admissions',async()=>{
  await assert.rejects(db.$queryRaw`SELECT password_hash FROM public.users WHERE false`,denied);
  await assert.rejects(db.$executeRaw`UPDATE public.enrollments SET status='TRIAL_ACTIVE' WHERE false`,denied);
  await assert.rejects(db.$executeRaw`UPDATE public."WhatsAppAdmissionRequest" SET status='ENROLLED' WHERE false`,denied);
  const [rights]=await db.$queryRaw`SELECT has_schema_privilege(current_user,'public','CREATE') c,has_table_privilege(current_user,'public.whatsapp_prospect_follow_ups','UPDATE,DELETE,TRUNCATE') broad,has_sequence_privilege(current_user,'public.users_id_seq','USAGE') user_sequence`;
  assert.deepEqual(rights,{c:false,broad:false,user_sequence:false});
 });
 const needed=['scheduled_for','template_name','template_language','attempts','accepted_at'];
 await t.test('only the five additive columns change across patch',async()=>{
  for(const col of needed){const [r]=await db.$queryRaw`SELECT has_column_privilege(current_user,'public.whatsapp_prospect_follow_ups',${col},'UPDATE') allowed`;assert.equal(r.allowed,stage==='after',col);}
  const [r]=await db.$queryRaw`SELECT has_column_privilege(current_user,'public.whatsapp_prospect_follow_ups','consent_event_id','UPDATE') consent,has_column_privilege(current_user,'public.whatsapp_prospect_follow_ups','conversation_id','UPDATE') recipient`;
  assert.deepEqual(r,{consent:false,recipient:false});
 });
 const config={...require('../src/config/whatsappConfig').getWhatsAppConfig({}),enabled:true,prospectFollowUpsEnabled:false};
 const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:randomUUID(),OPENAI_MODEL:'gpt-4.1-mini'};
 const followFactory=require('../src/services/whatsappProspectFollowUpService').createWhatsAppProspectFollowUpService;
 const follows=followFactory({client:db,configProvider:()=>config});
 const service=require('../src/services/whatsappConversationService').createWhatsAppConversationService({client:db,env,followUps:follows,followUpConfig:()=>config});
 const ai=require('../src/services/whatsappQuestionAIService').createQuestionAIService({env,fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({language:'fr',factIds:[],opening:'goal',followUp:'work'})}]}]})})});
 const complete=require('../src/services/whatsappQuestionAICompletionService').createQuestionAICompletionService({database:db,env,ai});
 let phone=stage==='before'?'29999990111':'29999990222',current,sequence=0;const transcript=[];
 async function send(text,interaction){
  const now=new Date(),id='worker-v3-'+stage+'-'+(++sequence)+'-'+randomUUID();
  const message={id,from:phone,timestamp:String(Math.floor(+now/1000)),...(interaction?{type:'interactive',interactive:{button_reply:{id:interaction,title:text}}}:{type:'text',text:{body:text}})};
  const r=await db.$transaction(tx=>service.processInboundMessageInTransaction(tx,message,{firstReceivedAt:now,processedAt:now}),{isolationLevel:'Serializable',timeout:10000});
  current=await db.whatsAppConversation.findUnique({where:{id:r.conversationId}});
  await complete.completeReply('wa-reply:'+id+':0');
  const outgoing=await db.whatsAppConversationMessage.findUnique({where:{idempotencyKey:'wa-reply:'+id+':0'}});
  transcript.push({input:text,output:outgoing?.body,mode:current.engineState.mode,language:current.engineState.preferredLanguage});
  return outgoing;
 }
 async function click(key){const o=current.engineState.admission.options.find(o=>o.id===key);assert.ok(o,'option '+key);return send(o.label,o.wireId);}
 await t.test('disabled inbound, language, AI completion and consent work WITHOUT new column grants',async()=>{
  for(const text of ['menu','3','I want to learn English for my work','English please','OK'])await send(text);
  assert.equal(current.engineState.preferredLanguage,'en');assert.match(transcript.at(-1).output,/Thank you|Your plans/);
  await send('Répondez en français');await send('Mon niveau est beginner');assert.equal(current.engineState.preferredLanguage,'fr');
  await send('relances');await send('OUI RELANCES');
  assert.equal(await db.whatsAppProspectFollowUp.count({where:{conversationId:current.id}}),0);
  assert.equal((await db.whatsAppCommercialConsentEvent.findFirst({where:{conversationId:current.id}})).decision,'GRANTED');
 });
 await t.test('existing secure registration creates PENDING only, through the consent function',async()=>{
  const before=await db.enrollment.count();await send('Je veux m’inscrire');assert.equal(current.engineState.admission.step,'METHOD');
  await click('admin');await click('accept');await send('Alice Laboratory');await click('phone-confirm');await send('alice-'+stage+'@example.test');await click('level-BEGINNER');
  const c=await db.course.findFirst({where:{slug:'anglais-general'}});await click('course-'+c.id);
  const s=await db.trainingSession.findFirst({where:{courseId:c.id}});await click('session-'+s.id);
  const g=await db.registrationGroup.findFirst({where:{trainingSessionId:s.id}});await click('group-'+g.id);
  assert.equal(await db.whatsAppAdmissionRequest.count({where:{conversationId:current.id}}),0);
  await click('confirm');const request=await db.whatsAppAdmissionRequest.findFirst({where:{conversationId:current.id}});
  assert.equal(request.status,'PENDING');assert.equal(await db.enrollment.count(),before);
  assert.equal((await db.whatsAppAdmissionEvent.findFirst({where:{requestId:request.id}})).action,'CONSENT_CONFIRMED');
 });
 if(stage==='after'){
  config.prospectFollowUpsEnabled=true;config.prospectFollowUpsDryRun=false;
  phone='29999990333';
  await t.test('enabled schedule resets locale/deadline under patched worker columns',async()=>{
   for(const text of ['menu','3','Je veux apprendre anglais général','relances','OUI RELANCES'])await send(text);
   let row=await db.whatsAppProspectFollowUp.findFirst({where:{conversationId:current.id}});assert.ok(row);assert.equal(row.templateLanguage,'fr');
   await send('English please');row=await db.whatsAppProspectFollowUp.findUnique({where:{id:row.id}});assert.equal(row.templateLanguage,'en');assert.equal(row.templateName,'nva_followup_en');
   const last=await db.whatsAppConversationMessage.findFirst({where:{conversationId:current.id,direction:'INBOUND'},orderBy:{id:'desc'}});assert.equal(+row.scheduledFor,+last.receivedAt+48*3600000);
  });
  await t.test('two concurrent worker services claim attempts and record acceptance once',async()=>{
   const fixtureUrl=new URL(process.env.NVA_V3_LAB_URL);assert.equal(fixtureUrl.username,'nva_v3_lab_runner');assert.equal(fixtureUrl.host,url.host);assert.equal(fixtureUrl.pathname,url.pathname);
   const fixture=new PrismaClient({datasourceUrl:fixtureUrl.toString()});
   const row=await db.whatsAppProspectFollowUp.findFirst({where:{conversationId:current.id}});
   try{const last=await fixture.whatsAppConversationMessage.findFirst({where:{conversationId:current.id,direction:'INBOUND'},orderBy:{id:'desc'}});await fixture.whatsAppConversationMessage.update({where:{id:last.id},data:{receivedAt:new Date(Date.now()-49*3600000)}});await fixture.whatsAppProspectFollowUp.update({where:{id:row.id},data:{scheduledFor:new Date(Date.now()-1000)}});}finally{await fixture.$disconnect();}
   let sent=0;const sender=async data=>{assert.equal(data.templateName,'nva_followup_en');sent++;return{providerMessageId:'mock-worker-accepted-'+randomUUID()};};
   const a=followFactory({client:db,configProvider:()=>config,templateVerifier:async()=>true,sender}),b=followFactory({client:db,configProvider:()=>config,templateVerifier:async()=>true,sender});
   await Promise.all([a.sendFollowUp(row.id),b.sendFollowUp(row.id)]);assert.equal(sent,1);
   const accepted=await db.whatsAppProspectFollowUp.findUnique({where:{id:row.id}});assert.equal(accepted.status,'ACCEPTED');assert.equal(accepted.attempts,1);assert.ok(accepted.acceptedAt);
  });
  await t.test('STOP under the exact worker role cancels a pending follow-up',async()=>{
   phone='29999990444';for(const text of ['menu','3','Je veux apprendre anglais général','relances','OUI RELANCES','STOP'])await send(text);
   assert.equal(current.controlState,'OPTED_OUT');assert.equal((await db.whatsAppProspectFollowUp.findFirst({where:{conversationId:current.id}})).status,'CANCELLED');
  });
 }
 assert.equal(external,0);fs.writeFileSync(path.join(process.env.NVA_V3_LAB_EVIDENCE,'worker-'+stage+'-evidence.json'),JSON.stringify({identity,stage,externalAttempts:external,transcript},null,2));
});
