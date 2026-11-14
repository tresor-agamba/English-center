const test=require('node:test'),assert=require('node:assert/strict');
const {createMetaInboxMock}=require('./helpers/metaInboxMock');
const {createWhatsAppConversationService}=require('../src/services/whatsappConversationService');
const {createQuestionAICompletionService}=require('../src/services/whatsappQuestionAICompletionService');
const {createQuestionAIService}=require('../src/services/whatsappQuestionAIService');
const {questionAIPlan,dialoguePlan}=require('./helpers/questionAIPlan');
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'mock',NVA_AI_TIMEOUT_MS:'250'};
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED'};
function setup({legacyOffer=false,enabled=true}={}){
 const s=createMetaInboxMock({},{});let sequence=10,apiCalls=0,inTransaction=false;const requests=[],events=[];
 s.seed('whatsAppChatbotSettings',{id:1,enabled:true,admissionsEnabled:enabled});
 s.seed('whatsAppConversation',{id:1,phoneNumber:'+29999999111',controlState:'BOT_ACTIVE',engineState:{mode:'QUESTION_AI',questionAIStartedAt:s.time().toISOString(),processedMessageIds:['old-user'],admission:{step:'FREE',draft:{},options:[],expiresAt:new Date(+s.time()+86400000).toISOString()}}});
 s.seed('whatsAppConversationMessage',{id:1,conversationId:1,direction:'INBOUND',messageType:'TEXT',body:'Je veux apprendre anglais',providerMessageId:'old-user',senderUserId:null,createdAt:s.time()});
 s.seed('whatsAppConversationMessage',{id:2,conversationId:1,direction:'OUTBOUND',messageType:'TEXT',body:legacyOffer?'Pour vous inscrire, nous proposons deux parcours. Souhaitez-vous découvrir les parcours d’inscription ?':'Notre formation d’anglais général est en ligne et adaptée aux débutants.',idempotencyKey:'wa-reply:old-user:0',deliveryStatus:'ACCEPTED',senderUserId:null,createdAt:s.time()});
 const create=s.db.whatsAppConversationMessage.create;
 s.db.whatsAppConversationMessage.create=args=>create({...args,data:{id:++sequence,attempts:0,senderUserId:null,createdAt:s.time(),updatedAt:s.time(),...args.data}});
 const unique=s.db.whatsAppConversationMessage.findUnique;
 s.db.whatsAppConversationMessage.findUnique=async args=>{const r=await unique(args);if(r&&args.include?.conversation)r.conversation=await s.db.whatsAppConversation.findUnique({where:{id:r.conversationId}});return r;};
 s.db.whatsAppChatbotAiBudget={upsert:async()=>{},updateMany:async()=>({count:1})};
 const transaction=s.db.$transaction;s.db.$transaction=(work,options)=>transaction(async tx=>{inTransaction=true;try{return await work(tx);}finally{inTransaction=false;}},options);
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[{...course,session:{id:10}}],listSessionsForPublicRegistration:async()=>[{id:10,course}]};
 let provider=async()=>dialoguePlan('CLARIFY');
 const ai=createQuestionAIService({env,observe:(event,data)=>events.push({event,...data}),fetchImpl:async(url,options)=>{
  assert.equal(inTransaction,false,'OpenAI outside SQL transaction');apiCalls++;requests.push(JSON.parse(options.body));
  const result=await provider();return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof result==='string'?result:JSON.stringify(result)}]}]})};
 }});
 const complete=createQuestionAICompletionService({database:s.db,env,now:s.time,ai,catalog,registration});
 function service(){return createWhatsAppConversationService({client:s.db,env,catalog,registration,now:s.time,followUpConfig:()=>({}),followUps:{cancelForConversation:async()=>{}}});}
 async function receive(text,{id='message-'+(++sequence),interactionId=null,deliver=true,completeAI=true}={}){
  const message={id,from:'29999999111',timestamp:String(+s.time()/1000),type:interactionId?'interactive':'text',...(interactionId?{interactive:{button_reply:{id:interactionId,title:text}}}:{text:{body:text}})};
  // Recreate the service each time: all continuation state must survive in the database.
  const result=await s.db.$transaction(tx=>service().processInboundMessageInTransaction(tx,message,{firstReceivedAt:s.time(),processedAt:s.time()}),{isolationLevel:'Serializable'});
  let outbound=s.rows('whatsAppConversationMessage').find(m=>m.idempotencyKey==='wa-reply:'+id+':0');
  if(outbound?.failureCode==='QUESTION_AI_PENDING'&&completeAI)await complete.completeReply(outbound.idempotencyKey);
  outbound=s.rows('whatsAppConversationMessage').find(m=>m.idempotencyKey==='wa-reply:'+id+':0');
  if(outbound&&deliver&&outbound.deliveryStatus==='QUEUED'&&!outbound.failureCode)outbound.deliveryStatus='ACCEPTED';
  return {result,outbound,message};
 }
 return {...s,receive,complete,requests,events,calls:()=>apiCalls,setProvider:fn=>{provider=fn;},state:()=>s.rows('whatsAppConversation')[0].engineState};
}
for(const text of ["Je veux m'inscrire",'Je veux m’inscrire',"Comment faire pour m'inscrire ?","Comment je peux m'inscrire ?"]){
 test('explicit request bypasses unavailable AI: '+text,async()=>{
  const s=setup();s.setProvider(async()=>{throw Error('synthetic outage');});const {outbound}=await s.receive(text);
  assert.equal(s.calls(),0);assert.equal(s.state().admission.step,'METHOD');assert.equal(s.state().mode,null);
  assert.deepEqual(outbound.interactivePayload.action.buttons.map(b=>b.reply.title),['Via le site','Via WhatsApp','Menu']);
  assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
 });
}
test('three-message sequence survives service recreation without AI',async()=>{
 const s=setup({legacyOffer:true});for(const text of ["Comment je peux m'inscrire ?",'Oui',"Je veux m'inscrire"]){
  await s.receive(text);assert.equal(s.state().admission.step,'METHOD');
 }assert.equal(s.calls(),0);
});
test('Oui resumes a delivered legacy invitation without metadata',async()=>{
 const s=setup({legacyOffer:true});await s.receive('Oui');assert.equal(s.state().admission.step,'METHOD');assert.equal(s.calls(),0);
});
test('validated fact plan invitation persists atomically and Oui resumes without AI',async()=>{
 const s=setup();s.setProvider(async()=>questionAIPlan(['c1_price'],'fr',{followUp:'register'}));
 const {outbound}=await s.receive('Votre certificat est-il international ?');
 assert.equal(s.state().pendingRegistrationOffer.replyKey,outbound.idempotencyKey);
 s.setProvider(async()=>{throw Error('outage');});await s.receive('Oui');assert.equal(s.calls(),1);assert.equal(s.state().admission.step,'METHOD');assert.equal(s.state().pendingRegistrationOffer,null);
 const request=s.requests[0];assert.equal(request.text.format.strict,true);assert.equal(request.text.format.schema.additionalProperties,false);assert.equal(request.tools,undefined);
});
for(const [text,id,step] of [['Via WhatsApp','admin','CONSENT'],['Via le site','online','DONE']])test('text and button share official navigation: '+text,async()=>{
 const a=setup(),b=setup();await a.receive("Je veux m'inscrire");await b.receive("Je veux m'inscrire");
 const option=b.state().admission.options.find(o=>o.id===id);
 const x=await a.receive(text),y=await b.receive(text,{interactionId:option.wireId});
 assert.equal(a.state().admission.step,step);assert.equal(b.state().admission.step,step);assert.equal(x.outbound.body,y.outbound.body);
 assert.deepEqual(a.state().admission.draft,text==='Via WhatsApp'?{courseId:1,courseTitle:course.title}:{});assert.equal(a.calls()+b.calls(),0);
});
test('duplicate inbound creates exactly one reply and never bypasses consent',async()=>{
 const s=setup();await s.receive("Je veux m'inscrire",{id:'dup'});await s.receive("Je veux m'inscrire",{id:'dup'});
 assert.equal(s.rows('whatsAppConversationMessage').filter(m=>m.idempotencyKey==='wa-reply:dup:0').length,1);
 await s.receive('Via WhatsApp',{id:'channel'});await s.receive('Via WhatsApp',{id:'channel'});
 assert.equal(s.state().admission.step,'CONSENT');assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
});
for(const deliveryStatus of ['QUEUED','FAILED','CANCELLED'])test('unsent invitation does not authorize Oui: '+deliveryStatus,async()=>{
 const s=setup({legacyOffer:true});s.rows('whatsAppConversationMessage')[1].deliveryStatus=deliveryStatus;
 await s.receive('Oui');assert.equal(s.calls(),1);assert.notEqual(s.state().admission?.step,'METHOD');
});
test('expired invitation and unrelated Oui remain conversational',async()=>{
 const a=setup({legacyOffer:true});a.advance(86400001);await a.receive('Oui');assert.equal(a.calls(),1);assert.notEqual(a.state().admission?.step,'METHOD');
 const b=setup();await b.receive('Oui');assert.equal(b.calls(),1);assert.notEqual(b.state().admission?.step,'METHOD');
});
test('topic change consumes prior invitation',async()=>{
 const s=setup({legacyOffer:true});await s.receive('Parlons d’autre chose');await s.receive('Oui');assert.equal(s.calls(),2);assert.notEqual(s.state().admission?.step,'METHOD');assert.equal(s.state().pendingRegistrationOffer,null);
});
for(const text of ["Je ne veux pas m'inscrire","Quel est le statut de mon inscription ?","Quels documents pour l’inscription ?",'Combien coûte l’inscription ?'])test('refusal, status and information remain conversational: '+text,async()=>{
 const s=setup();await s.receive(text);assert.equal(s.calls(),1);assert.notEqual(s.state().admission?.step,'METHOD');
});
test('admissions disabled is explained without calling AI',async()=>{
 const s=setup({enabled:false});const {outbound}=await s.receive("Je veux m'inscrire");assert.equal(s.calls(),0);assert.match(outbound.body,/désactivé/);
});
test('human takeover and STOP supersede registration',async()=>{
 const s=setup();s.rows('whatsAppConversation')[0].controlState='HUMAN_TAKEOVER';assert.equal((await s.receive("Je veux m'inscrire")).outbound,undefined);
 const t=setup();await t.receive('STOP');assert.equal(t.rows('whatsAppConversation')[0].controlState,'OPTED_OUT');assert.equal(t.calls(),0);
});
test('stale AI REGISTER cannot replace a newer method choice',async()=>{
 const s=setup();let finish;const gate=new Promise(resolve=>finish=resolve);s.setProvider(async()=>{await gate;return dialoguePlan('REGISTRATION');});
 const {outbound}=await s.receive('Je suis intéressé',{completeAI:false,deliver:false});
 const pending=s.complete.completeReply(outbound.idempotencyKey);await new Promise(resolve=>setImmediate(resolve));
 await s.receive("Je veux m'inscrire");finish();const result=await pending;
 assert.equal(result.cancelled,true);assert.equal(s.state().admission.step,'METHOD');assert.equal(s.rows('whatsAppConversationMessage').find(m=>m.id===outbound.id).deliveryStatus,'CANCELLED');
});
test('newer unsent response blocks older delivered invitation',async()=>{
 const s=setup({legacyOffer:true});await s.receive('Parlons d’autre chose',{deliver:false});await s.receive('Oui');assert.equal(s.calls(),2);assert.notEqual(s.state().admission?.step,'METHOD');
});
test('unverified prose and upstream free-form decisions remain rejected',async()=>{
 for(const result of ['Votre inscription est confirmée.',{intent:'START_REGISTRATION',reply:'Go'},{intent:'APPROVE_ADMISSION',reply:'Approved'}]){
  const s=setup();s.setProvider(async()=>result);await s.receive('Je suis intéressé');assert.equal(s.state().mode,'QUESTION_AI');assert.notEqual(s.state().admission?.step,'METHOD');assert.equal(s.rows('enrollment').length,0);
 }
});
test('explicit first contact opens methods immediately and collection cannot be reset',async()=>{
 const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
 const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
 const s=setup(),catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[]};
 const engine=createConversationEngine({env,catalog,now:s.time,admissions:createAdmissionJourney({database:s.db,catalog,registration,now:s.time})});
 const first=await engine.handleMessage({text:'Je veux m’inscrire',isFirstContact:true,messageId:'first'});
 assert.equal(first.state.admission.step,'METHOD');assert.equal(first.deferredQuestionAI,undefined);
 await s.receive('Je veux m’inscrire');await s.receive('Via WhatsApp');assert.equal(s.state().admission.step,'CONSENT');
 await s.receive('Je veux m’inscrire');assert.equal(s.state().admission.step,'CONSENT');assert.deepEqual(s.state().admission.draft,{courseId:1,courseTitle:course.title});
});
for(const text of ['Combien coûte l’inscription via WhatsApp ?',"Je veux seulement des informations sur l’inscription via le site"])test('channel mention with information veto cannot start collection: '+text,async()=>{
 const s=setup();await s.receive(text);assert.equal(s.calls(),1);assert.notEqual(s.state().admission?.step,'CONSENT');assert.notEqual(s.state().admission?.step,'DONE');
});
test('lost completion ownership cannot persist an invitation or emit a processing failure',async t=>{
 const warnings=[];t.mock.method(require('../src/services/loggerService'),'warn',(event)=>warnings.push(event));
 const s=setup();let finish;const gate=new Promise(resolve=>finish=resolve);
 s.setProvider(async()=>{await gate;return questionAIPlan(['c1_price'],'fr',{followUp:'register'});});
 const {outbound}=await s.receive('Votre certificat est-il international ?',{completeAI:false,deliver:false});
 const pending=s.complete.completeReply(outbound.idempotencyKey);await new Promise(resolve=>setImmediate(resolve));
 const row=s.rows('whatsAppConversationMessage').find(m=>m.id===outbound.id);row.aiClaimToken='new-owner';finish();
 const result=await pending;assert.equal(result.superseded,true);assert.equal(result.completed,false);
 assert.equal(row.aiClaimToken,'new-owner');assert.equal(row.failureCode,'QUESTION_AI_PROCESSING');assert.equal(s.state().pendingRegistrationOffer,null);assert.deepEqual(warnings,[]);
});

for(const deliveryStatus of ['ACCEPTED','QUEUED','FAILED','CANCELLED'])test('durable last successful question replaces invitation; newest delivery='+deliveryStatus,async()=>{
 const s=setup({legacyOffer:true});
 s.seed('whatsAppConversationMessage',{id:3,conversationId:1,direction:'OUTBOUND',senderUserId:null,messageType:'TEXT',body:'Vous souhaitez plus d’informations sur les horaires ?',idempotencyKey:'new-question',deliveryStatus,createdAt:s.time()});
 // A successful question before the newest one also supersedes the old invitation.
 s.rows('whatsAppConversationMessage')[1].body='Vous souhaitez des détails sur une formation ?';
 s.setProvider(async()=>{throw Error('synthetic failure');});
 const {outbound}=await s.receive('Oui');
 const body=require('../src/services/whatsappCloudApiService').buildTextPayload({phoneNumber:'+29999999111',text:outbound.body}).text.body;
 assert.match(body,deliveryStatus==='ACCEPTED'?/créneau/:/Sur quelle formation/);
 assert.equal(s.state().questionContext.replyKey,deliveryStatus==='ACCEPTED'?'new-question':'wa-reply:old-user:0');
 assert.equal(s.state().admission,null);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
});
test('agreement after registration request follows new information question across service restart',async()=>{
 const s=setup();await s.receive('Je veux m’inscrire');
 s.seed('whatsAppConversationMessage',{id:100,conversationId:1,direction:'OUTBOUND',senderUserId:null,messageType:'TEXT',body:'Vous souhaitez des détails sur une formation ?',idempotencyKey:'new-question',deliveryStatus:'ACCEPTED',createdAt:s.time()});
 s.setProvider(async()=>dialoguePlan('REGISTRATION'));
 const {outbound}=await s.receive('Oui');assert.match(outbound.body,/Sur quelle formation/);assert.equal(s.state().admission,null);
 assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
});
