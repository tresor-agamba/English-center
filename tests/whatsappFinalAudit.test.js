// Requirement audit: assertions remain active, never converted to TODOs.
// Synthetic data, guarded Prisma access and injected HTTP only. No live transport.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const {createQuestionAIService,fallback}=require('../src/services/whatsappQuestionAIService');
const {createQuestionAICompletionService}=require('../src/services/whatsappQuestionAICompletionService');
const {INSTRUCTIONS}=require('../src/services/whatsappNaturalAdvisorPolicy');
const {createMetaInboxMock}=require('./helpers/metaInboxMock');
const logger=require('../src/services/loggerService');
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:randomUUID(),OPENAI_MODEL:'audit-model',NVA_AI_TIMEOUT_MS:'250'};
const now=new Date('2026-10-29T09:00:00Z');
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED'};
function engine(){
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[]};
 const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration,now:()=>now});
 let admissionCalls=0;
 const wrapped={...admissions,resolve:async input=>{admissionCalls++;return admissions.resolve(input);}};
 const e=createConversationEngine({env,catalog,registration,admissions:wrapped,now:()=>now,
  chatbot:{resolve:async()=>assert.fail('Legacy FAQ must not preempt ordinary AI conversation')},
  scenarios:{resolve:async()=>assert.fail('Legacy scenario must not preempt ordinary AI conversation')}});
 return {...e,admissionCalls:()=>admissionCalls};
}
const input=(e,text,state,messageId=randomUUID())=>e.handleMessage({text,state,messageId});
function response(result={language:'fr',reply:'Je vous accompagne. 😊',factIds:[],action:'NONE'}){
 return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};
}
function pending({fetchImpl=async()=>response(),overrides={}}={}){
 const s=createMetaInboxMock({},{}),config={...env,...overrides};let calls=0,requests=[];
 s.seed('whatsAppChatbotSettings',{id:1,enabled:true,admissionsEnabled:true});
 s.seed('whatsAppConversation',{id:1,phoneNumber:'+29999999111',controlState:'BOT_ACTIVE',engineState:{mode:'QUESTION_AI',questionAIStartedAt:'2026-10-29T08:00:00Z',preferredLanguage:'fr'}});
 for(let id=10;id<20;id++){if(id===16||id===17)continue;s.seed('whatsAppConversationMessage',{id,conversationId:1,direction:id%2?'OUTBOUND':'INBOUND',body:'history-'+id,senderUserId:null,messageType:'TEXT',createdAt:new Date('2026-10-29T08:30:00Z')});}
 s.seed('whatsAppConversationMessage',{id:4,conversationId:1,direction:'INBOUND',body:'OLD_BEFORE_AI',senderUserId:null,messageType:'TEXT',createdAt:new Date('2026-10-28T08:00:00Z')});
 s.seed('whatsAppConversationMessage',{id:16,conversationId:2,direction:'INBOUND',body:'OTHER_PROSPECT_PRIVATE',senderUserId:null,messageType:'TEXT',createdAt:now});
 s.seed('whatsAppConversationMessage',{id:17,conversationId:1,direction:'OUTBOUND',body:'HUMAN_ADVISER_PRIVATE',senderUserId:7,messageType:'TEXT',createdAt:now});
 s.seed('whatsAppConversationMessage',{id:20,conversationId:1,direction:'INBOUND',body:'Et après ?',providerMessageId:'audit-followup',senderUserId:null,messageType:'TEXT',createdAt:now});
 s.seed('whatsAppConversationMessage',{id:21,conversationId:1,direction:'OUTBOUND',body:fallback('Et après ?','fr'),idempotencyKey:'wa-reply:audit-followup:0',deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PENDING',updatedAt:now,createdAt:now});
 const find=s.db.whatsAppConversationMessage.findUnique;
 s.db.whatsAppConversationMessage.findUnique=async args=>{const row=await find(args);if(row&&args.include?.conversation)row.conversation=await s.db.whatsAppConversation.findUnique({where:{id:row.conversationId}});return row;};
 s.db.whatsAppChatbotAiBudget={upsert:async()=>{},updateMany:async()=>({count:1})};
 const ai=createQuestionAIService({env:config,fetchImpl:async(url,options)=>{calls++;requests.push(JSON.parse(options.body));assert.equal(url,'https://api.openai.com/v1/responses');return fetchImpl(url,options);}});
 const service=createQuestionAICompletionService({database:s.db,env:config,ai,now:()=>now,catalog:{listPublished:async()=>[course]},registration:{listSessionsForPublicRegistration:async()=>[]}});
 return {...s,service,calls:()=>calls,requests,reply:()=>s.rows('whatsAppConversationMessage').find(m=>m.id===21),conversation:()=>s.rows('whatsAppConversation')[0]};
}

test('1 — new prospect gets one persisted presentation and exactly two interactive actions',async()=>{
 const e=engine(),first=await input(e,'Comment débuter ?',undefined,'first');
 assert.equal(first.intent,'WELCOME');assert.ok(first.state.welcomeSentAt);assert.equal(first.interactive.type,'button');
 assert.deepEqual(first.interactive.action.buttons.map(b=>b.reply.title),["📝 S'inscrire",'💬 Poser une question']);
 assert.deepEqual(first.state.admission.options.map(o=>o.id),['registration','question']);
 assert.match(first.interactive.body.text,/académie de formation en ligne/);
 const duplicate=await input(e,'Comment débuter ?',first.state,'first');assert.equal(duplicate.duplicate,true);assert.equal(duplicate.text,null);
 const next=await input(e,'Bonjour',JSON.parse(JSON.stringify(first.state)),'next');assert.equal(next.deferredQuestionAI,true);assert.equal(next.interactive,undefined);assert.equal(next.state.welcomeSentAt,first.state.welcomeSentAt);
});

for(const question of ['Bonjour','Merci','Comment débuter ?','Je n’ai que 30 dollars','Et après les cinq séances gratuites ?','Quels sont vos tarifs ?','Vos horraires ?','Votre certificat est-il international ?','Quels documents faut-il pour l’inscription ?','Je ne veux pas m’inscrire, juste connaître les prix.']){
 test('2/3 — direct question reaches AI before legacy rules: '+question,async()=>{
  const e=engine(),welcome=await input(e,'Bonjour');
  const out=await input(e,question,JSON.parse(JSON.stringify(welcome.state)));
  assert.equal(out.deferredQuestionAI,true,JSON.stringify({intent:out.intent,step:out.state.admission?.step,text:out.text}));
  assert.equal(out.state.mode,'QUESTION_AI');assert.equal(e.admissionCalls(),1,'Only initial welcome may resolve admissions');assert.deepEqual(out.actions,[]);
 });
}

test('4 — OpenAI receives six chronological messages from the same conversation only',async()=>{
 const s=pending();await s.service.completeReply('wa-reply:audit-followup:0');
 const request=s.requests[0],data=JSON.parse(request.input);
 assert.equal(data.question,'Et après ?');assert.equal(data.history.length,6);
 assert.deepEqual(data.history.map(h=>h.content),[12,13,14,15,18,19].map(id=>'history-'+id));
 assert.deepEqual(data.history.map(h=>h.role),['user','assistant','user','assistant','user','assistant']);
 for(const secret of ['OTHER_PROSPECT_PRIVATE','HUMAN_ADVISER_PRIVATE','OLD_BEFORE_AI'])assert.equal(JSON.stringify(request).includes(secret),false);
 assert.equal(request.store,false);
});

test('2 — refusal plus price question in an existing AI conversation must not start enrollment',async()=>{
 const e=engine(),welcome=await input(e,'Bonjour'),previous=await input(e,'Quels sont vos tarifs ?',welcome.state);
 const out=await input(e,'Je ne veux pas m’inscrire, juste connaître les prix.',previous.state);
 assert.equal(out.deferredQuestionAI,true,JSON.stringify({intent:out.intent,step:out.state.admission?.step,text:out.text}));
 assert.equal(out.state.mode,'QUESTION_AI');assert.deepEqual(out.actions,[]);
});

for(const [number,step]of [['1','METHOD'],['2','FREE']])test('7 — advertised numbered welcome fallback stays backend-owned: '+number,async()=>{
 const e=engine(),welcome=await input(e,'Bonjour'),out=await input(e,number,welcome.state);
 assert.equal(out.deferredQuestionAI,undefined,'A menu choice must not be interpreted by OpenAI');
 assert.equal(out.state.admission.step,step);
});

test('5 — each conversational HTTP call uses the exact professional prompt',async()=>{
 for(const question of ['Bonjour','Et après ?','What about the certificate?']){
  const s=pending();s.rows('whatsAppConversationMessage').find(m=>m.id===20).body=question;
  await s.service.completeReply('wa-reply:audit-followup:0');assert.equal(s.calls(),1);assert.equal(s.requests[0].instructions,INSTRUCTIONS);
  assert.equal(s.requests[0].tools,undefined);
 }
});

test('6 — a valid OpenAI reply replaces the pending body, without deterministic substitution',async()=>{
 const s=pending();await s.service.completeReply('wa-reply:audit-followup:0');assert.equal(s.reply().body,'Je vous accompagne. 😊');assert.equal(s.reply().failureCode,null);
 await s.service.completeReply('wa-reply:audit-followup:0');assert.equal(s.calls(),1);
});

for(const [name,fetchImpl]of [
 ['HTTP 401',async()=>({ok:false,status:401})],['HTTP 429',async()=>({ok:false,status:429})],['HTTP 500',async()=>({ok:false,status:500})],
 ['network error',async()=>{throw Error('PRIVATE_PROVIDER_DETAILS');}],
 ['incomplete response',async()=>({ok:true,json:async()=>({status:'incomplete'})})],
 ['malformed JSON',async()=>({ok:true,json:async()=>{throw Error('PRIVATE_PROVIDER_DETAILS');}})],
 ['timeout',async()=>new Promise(()=>{})]
])test('6 — '+name+' produces explicit unavailability, never an unrelated FAQ',async t=>{
 const decisions=[];t.mock.method(logger,'info',(event,data)=>decisions.push({event,...data}));
 const s=pending({fetchImpl});await s.service.completeReply('wa-reply:audit-followup:0');assert.equal(s.calls(),1);
 assert.equal(s.reply().body,fallback('Et après ?','fr'));assert.match(s.reply().body,/ne peux pas vérifier.*actuellement/);assert.match(s.reply().body,/conseiller/);
 assert.equal(decisions.some(d=>d.event==='NVA_AI_COMPLETION'&&d.outcome==='unavailable'),true);
 assert.equal(s.reply().body.includes('PRIVATE_PROVIDER_DETAILS'),false);
});

test('7 — welcome buttons dispatch on backend IDs and WhatsApp enrollment still requires consent',async()=>{
 const e=engine(),first=await input(e,'Bonjour');
 const click=async(result,id)=>e.handleMessage({state:result.state,interactionId:result.state.admission.options.find(o=>o.id===id).wireId,text:'untrusted changed label',messageId:randomUUID()});
 const question=await click(first,'question');assert.equal(question.state.mode,'QUESTION_AI');assert.equal(question.deferredQuestionAI,undefined);
 const registration=await click(first,'registration');assert.equal(registration.state.admission.step,'METHOD');assert.equal(registration.deferredQuestionAI,undefined);
 const consent=await click(registration,'admin');assert.equal(consent.state.admission.step,'CONSENT');assert.deepEqual(consent.actions,[]);assert.deepEqual(consent.state.admission.draft,{});
 const name=await click(consent,'accept');assert.equal(name.state.admission.step,'NAME');assert.deepEqual(name.actions,[]);
});

test('7 — semantic REGISTER only opens backend method selection and creates no enrollment',async()=>{
 const s=pending({fetchImpl:async()=>response({language:'fr',reply:'Commençons.',factIds:[],action:'REGISTER'})});
 await s.service.completeReply('wa-reply:audit-followup:0');
 assert.equal(s.conversation().engineState.admission.step,'METHOD');assert.equal(s.reply().messageType,'INTERACTIVE');
 assert.deepEqual(s.conversation().engineState.admission.options.map(o=>o.id),['online','admin','menu']);
 assert.equal(s.rows('enrollment').length,0);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
});

test('7 — unsupported AI actions cannot confirm enrollment or payment',async()=>{
 const s=pending({fetchImpl:async()=>response({language:'fr',reply:'Votre inscription est confirmée.',factIds:[],action:'CONFIRM_ENROLLMENT'})});
 await s.service.completeReply('wa-reply:audit-followup:0');assert.equal(s.reply().body,fallback('Et après ?','fr'));
 assert.equal(s.rows('enrollment').length,0);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
});

for(const text of ['Comment fonctionne l’inscription ?','Combien coûte l’inscription ?','Je ne veux pas m’inscrire.','Pas maintenant.','Je veux seulement des informations.','Je préfère réfléchir.','Je veux connaître les prix avant de décider.','I do not want to register.','Not now, just prices please.'])test('refusals and information remain conversational in both menu and AI modes: '+text,async()=>{
 for(const inAI of [false,true]){
  const e=engine(),welcome=await input(e,'Bonjour'),prior=inAI?await input(e,'Quels sont vos tarifs ?',welcome.state):welcome;
  const out=await input(e,text,prior.state);assert.equal(out.deferredQuestionAI,true);assert.equal(out.state.mode,'QUESTION_AI');assert.equal(out.state.admission,null);assert.deepEqual(out.actions,[]);
 }
});

test('numbers without a live offered choice never authorize an action',async()=>{
 const e=engine(),welcome=await input(e,'Bonjour');
 const free=await input(e,'Je veux seulement des informations.',welcome.state);
 const expired={...welcome.state,admission:{...welcome.state.admission,expiresAt:'2020-01-01T00:00:00Z'}};
 for(const state of [free.state,expired,{processedMessageIds:['previous'],welcomeSentAt:now.toISOString()}]){
  for(const text of ['1','2','42']){const out=await input(e,text,state);assert.equal(out.deferredQuestionAI,true);assert.equal(out.state.admission,null);assert.deepEqual(out.actions,[]);}
 }
 const outOfRange=await input(e,'3',welcome.state);assert.equal(outOfRange.deferredQuestionAI,true);
});

test('a free message consumes old interactive menu tokens as well as numbered choices',async()=>{
 const e=engine(),welcome=await input(e,'Bonjour'),wireId=welcome.state.admission.options[0].wireId;
 const free=await input(e,'Quels sont vos tarifs ?',welcome.state);
 const stale=await e.handleMessage({state:free.state,interactionId:wireId,text:'S’inscrire',messageId:randomUUID()});
 assert.notEqual(stale.state.admission?.step,'METHOD');assert.deepEqual(stale.actions,[]);assert.match(stale.text,/expiré/);
});

for(const text of ['Je ne veux pas m’inscrire.','Pas maintenant.','Je veux seulement des informations.','Je préfère réfléchir.','Je veux connaître les prix avant de décider.','Comment fonctionne l’inscription ?','Combien coûte l’inscription ?','I do not want to register.','1'])test('backend veto rejects a wrong model REGISTER classification: '+text,async t=>{
 const decisions=[];t.mock.method(logger,'info',(event,data)=>decisions.push({event,...data}));
 const s=pending({fetchImpl:async()=>response({language:/^I /.test(text)?'en':'fr',reply:'Commençons.',factIds:[],action:'REGISTER'})});
 s.rows('whatsAppConversationMessage').find(m=>m.id===20).body=text;
 await s.service.completeReply('wa-reply:audit-followup:0');
 assert.equal(s.conversation().engineState.admission,undefined);assert.equal(s.reply().interactivePayload,undefined);
 assert.equal(decisions.some(d=>d.event==='NVA_AI_ACTION_REJECTED'&&d.reason==='REGISTRATION_VETO'),true);
 assert.equal(s.rows('whatsAppAdmissionRequest').length,0);assert.equal(s.rows('enrollment').length,0);
});

test('a current positive request interpreted by the model opens only the secure method choice',async()=>{
 const s=pending({fetchImpl:async()=>response({language:'fr',reply:'Avec plaisir.',factIds:[],action:'REGISTER'})});
 s.rows('whatsAppConversationMessage').find(m=>m.id===20).body='Je veux m’inscrire maintenant';
 await s.service.completeReply('wa-reply:audit-followup:0');
 assert.equal(s.calls(),1);assert.equal(JSON.parse(s.requests[0].input).question,'Je veux m’inscrire maintenant');
 assert.equal(s.conversation().engineState.admission.step,'METHOD');assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
});

test('a changed topic sends the latest question and publishes the new model response',async()=>{
 const s=pending({fetchImpl:async()=>response({language:'fr',reply:'Le certificat est délivré par NVA.',factIds:['c1_certificate'],action:'NONE'})});
 s.rows('whatsAppConversationMessage').find(m=>m.id===20).body='Et le certificat ?';
 await s.service.completeReply('wa-reply:audit-followup:0');
 assert.equal(JSON.parse(s.requests[0].input).question,'Et le certificat ?');assert.equal(s.reply().body,'Le certificat est délivré par NVA.');assert.equal(s.calls(),1);
});
