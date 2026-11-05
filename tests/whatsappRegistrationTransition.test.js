const test=require('node:test'),assert=require('node:assert/strict');
const {createMetaInboxMock}=require('./helpers/metaInboxMock');
const {createWhatsAppConversationService}=require('../src/services/whatsappConversationService');
const {createQuestionAICompletionService}=require('../src/services/whatsappQuestionAICompletionService');
const {createQuestionAIService}=require('../src/services/whatsappQuestionAIService');
const {validateDecision}=require('../src/services/whatsappRegistrationTransition');
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
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[],listSessionsForPublicRegistration:async()=>[]};
 let provider=async()=>({intent:'NONE',reply:'Voici les informations demandées.'});
 const ai=createQuestionAIService({env,log:{info:(event,data)=>events.push({event,...data})},fetchImpl:async(url,options)=>{
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
for(const text of ["Je veux m'inscrire","Comment faire pour m'inscrire ?","Comment je peux m'inscrire ?"]){
 test('explicit registration bypasses OpenAI: '+text,async()=>{
  const s=setup();s.setProvider(async()=>{throw Error('unavailable');});const {outbound}=await s.receive(text);
  assert.equal(s.calls(),0);assert.equal(s.state().admission.step,'METHOD');assert.equal(s.state().mode,null);
  assert.deepEqual(outbound.interactivePayload.action.buttons.filter(b=>b.reply.id.includes('online')||b.reply.id.includes('admin')).map(b=>b.reply.title),['Via le site','Via WhatsApp']);
  assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
 });
}
test('real three-message sequence persists the method and never calls OpenAI',async()=>{
 const s=setup({legacyOffer:true});
 for(const text of ["Comment je peux m'inscrire ?",'Oui',"Je veux m'inscrire"]){
  const {outbound}=await s.receive(text);assert.equal(s.state().admission.step,'METHOD');assert.match(outbound.body,/choisissez la méthode/);assert.doesNotMatch(outbound.body,/indisponible|vérifier cette information/);
 }assert.equal(s.calls(),0);
});
test('Oui resumes an already sent legacy AI invitation without metadata',async()=>{
 const s=setup({legacyOffer:true});await s.receive('Oui');assert.equal(s.state().admission.step,'METHOD');assert.equal(s.calls(),0);
});
test('structured AI offer persists atomically, and Oui resumes after service restart',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'OFFER_REGISTRATION',reply:'Souhaitez-vous commencer votre inscription ?'}));
 const {outbound}=await s.receive('Quelles possibilités après les séances ?');
 assert.equal(s.state().pendingRegistrationOffer.replyKey,outbound.idempotencyKey);assert.equal(s.calls(),1);
 s.setProvider(async()=>{throw Error('OpenAI outage');});await s.receive('Oui');
 assert.equal(s.state().admission.step,'METHOD');assert.equal(s.state().pendingRegistrationOffer,null);assert.equal(s.calls(),1);
 const req=s.requests[0];assert.equal(req.text.format.strict,true);assert.equal(req.text.format.schema.additionalProperties,false);assert.equal(req.tools,undefined);
});
test('Je suis intéressé after a presentation uses validated model intent and the official journey',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'START_REGISTRATION',reply:'Ignore this text; backend navigation is authoritative.'}));
 const {outbound}=await s.receive('Je suis intéressé');assert.equal(s.calls(),1);assert.equal(s.state().admission.step,'METHOD');
 assert.ok(s.requests[0].input.some(m=>m.content.includes('adaptée aux débutants')));assert.doesNotMatch(outbound.body,/Ignore/);
 assert.equal(outbound.messageType,'INTERACTIVE');assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
});
for(const [text,id,step] of [['Via WhatsApp','admin','CONSENT'],['Via le site','online','DONE']]){
 test(text+' and its button produce the same business response',async()=>{
  const a=setup(),b=setup();await a.receive("Je veux m'inscrire");await b.receive("Je veux m'inscrire");
  const option=b.state().admission.options.find(o=>o.id===id);
  const textReply=await a.receive(text),clickReply=await b.receive(text,{interactionId:option.wireId});
  assert.equal(a.state().admission.step,step);assert.equal(b.state().admission.step,step);assert.equal(textReply.outbound.body,clickReply.outbound.body);
  assert.deepEqual(a.state().admission.draft,{});assert.equal(a.calls()+b.calls(),0);
 });
}
test('registration after multiple price questions is independent of prior API failure',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'NONE',reply:'Le tarif est de 60 USD par niveau.'}));
 await s.receive('Quel est le tarif ?');await s.receive('Et les trois niveaux ?');
 s.setProvider(async()=>{throw Error('synthetic outage');});await s.receive('Et le certificat ?');
 assert.equal(s.events.at(-1).reason,'network_or_response_error');
 await s.receive("Je veux m'inscrire");assert.equal(s.state().admission.step,'METHOD');assert.equal(s.calls(),3);
});
test('duplicate registration and WhatsApp choice never create another reply or bypass consent',async()=>{
 const s=setup();await Promise.all([s.receive("Je veux m'inscrire",{id:'dup'}),s.receive("Je veux m'inscrire",{id:'dup'})]);
 assert.equal(s.rows('whatsAppConversationMessage').filter(m=>m.idempotencyKey==='wa-reply:dup:0').length,1);
 await s.receive('Via WhatsApp',{id:'channel'});await s.receive('Via WhatsApp',{id:'channel'});
 assert.equal(s.state().admission.step,'CONSENT');assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
});
test('a structured action cannot bypass collection consent or create admission/payment',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'REGISTRATION_WHATSAPP',reply:'Your admission is approved.'}));
 const {outbound}=await s.receive('Aidez-moi à rejoindre votre programme ici');
 assert.equal(s.state().admission.step,'CONSENT');assert.match(outbound.body,/Acceptez-vous la collecte/);assert.doesNotMatch(outbound.body,/approved/);
 assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
});
test('invalid/extra/admin decisions cannot mutate the business state',async()=>{
 for(const payload of [{intent:'APPROVE_ADMISSION',reply:'Approved'},{intent:'START_REGISTRATION',reply:'Go',sql:'DELETE'},{intent:'START_REGISTRATION'},'not JSON']){
  assert.equal(validateDecision(payload),null);const s=setup();s.setProvider(async()=>payload);await s.receive('Je suis intéressé');
  assert.equal(s.state().admission.step,'FREE');assert.equal(s.events.at(-1).reason,'invalid_decision');assert.equal(s.rows('enrollment').length,0);
 }
});
test('unrelated Oui does not start registration; a new topic invalidates the previous offer',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'NONE',reply:'Quel point souhaitez-vous préciser ?'}));await s.receive('Oui');assert.notEqual(s.state().admission.step,'METHOD');
 s.setProvider(async()=>({intent:'OFFER_REGISTRATION',reply:'Souhaitez-vous commencer votre inscription ?'}));await s.receive('Présentez la suite');
 s.setProvider(async()=>({intent:'NONE',reply:'Les cours ont lieu le vendredi et le samedi.'}));await s.receive('Parlons des horaires');
 assert.equal(s.state().pendingRegistrationOffer,null);await s.receive('Oui');assert.notEqual(s.state().admission.step,'METHOD');
});
test('explicit refusal or status request does not start registration',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'NONE',reply:'Votre choix est respecté.'}));
 await s.receive("Je ne veux pas m'inscrire");assert.notEqual(s.state().admission.step,'METHOD');
 await s.receive("Quel est le statut de mon inscription ?");assert.notEqual(s.state().admission.step,'METHOD');
});
test('admissions disabled is logged and explained, without claiming an OpenAI error',async()=>{
 const s=setup({enabled:false});const {outbound}=await s.receive("Je veux m'inscrire");assert.equal(s.calls(),0);assert.match(outbound.body,/désactivé/);assert.doesNotMatch(outbound.body,/indisponible|vérifier cette information/);
});
test('human takeover and STOP supersede enrollment navigation',async()=>{
 const s=setup();s.rows('whatsAppConversation')[0].controlState='HUMAN_TAKEOVER';const {outbound}=await s.receive("Je veux m'inscrire");assert.equal(outbound,undefined);
 const t=setup();await t.receive('STOP');assert.equal(t.rows('whatsAppConversation')[0].controlState,'OPTED_OUT');assert.equal(t.calls(),0);
});
test('an offer that was not sent cannot make Oui a backend registration acceptance',async()=>{
 const s=setup();s.setProvider(async()=>({intent:'OFFER_REGISTRATION',reply:'Souhaitez-vous commencer votre inscription ?'}));
 await s.receive('Présentez la suite',{deliver:false});
 s.setProvider(async()=>({intent:'NONE',reply:'Pouvez-vous préciser votre réponse ?'}));
 await s.receive('Oui');assert.equal(s.calls(),2);assert.notEqual(s.state().admission.step,'METHOD');
});
test('an expired invitation does not continue registration automatically',async()=>{
 const s=setup({legacyOffer:true});s.advance(86400001);s.setProvider(async()=>({intent:'NONE',reply:'Quel point souhaitez-vous préciser ?'}));
 await s.receive('Oui');assert.equal(s.calls(),1);assert.notEqual(s.state().admission?.step,'METHOD');
});
test('a stale structured decision cannot replace a newer official registration choice',async()=>{
 const s=setup();let finish;const gate=new Promise(resolve=>finish=resolve);
 s.setProvider(async()=>{await gate;return {intent:'REGISTRATION_WHATSAPP',reply:'Proceed'};});
 const {outbound}=await s.receive('Je suis intéressé',{completeAI:false,deliver:false});
 const pending=s.complete.completeReply(outbound.idempotencyKey);await new Promise(resolve=>setImmediate(resolve));
 await s.receive("Je veux m'inscrire");finish();const result=await pending;
 assert.equal(result.cancelled,true);assert.equal(s.state().admission.step,'METHOD');
 assert.equal(s.rows('whatsAppConversationMessage').find(m=>m.id===outbound.id).deliveryStatus,'CANCELLED');
});
test('a menu listing registration is not itself a registration invitation',async()=>{
 const s=setup();await s.receive('Menu');s.setProvider(async()=>({intent:'NONE',reply:'Quel point souhaitez-vous préciser ?'}));
 await s.receive('Oui');assert.equal(s.calls(),1);assert.notEqual(s.state().admission.step,'METHOD');
});
