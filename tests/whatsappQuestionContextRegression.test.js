require('./helpers/whatsappIsolationGuard.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const {createQuestionAIService}=require('../src/services/whatsappQuestionAIService');
const {createQuestionAICompletionService}=require('../src/services/whatsappQuestionAICompletionService');
const {createMetaInboxMock}=require('./helpers/metaInboxMock');
const {questionAIPlan,dialoguePlan}=require('./helpers/questionAIPlan');
const api=require('../src/services/whatsappCloudApiService');
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true};
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic-only',OPENAI_MODEL:'mock-model'};
const clock=new Date('2026-11-09T12:00:00Z');
const final=r=>r.interactive?api.buildInteractivePayload({phoneNumber:'+29999999111',interactive:r.interactive}).interactive.body.text:api.buildTextPayload({phoneNumber:'+29999999111',text:r.text}).text.body;
function setup(open=true,options={}){
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>open?[{...course,session:{id:10}}]:[],listSessionsForPublicRegistration:async()=>open?[{id:10,course,startDate:'2026-11-12'}]:[]};
 if(options.sessions)registration.listSessionsForPublicRegistration=options.sessions;
 const database={whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}};
 const engine=createConversationEngine({env,catalog,registration,now:()=>clock,admissions:createAdmissionJourney({database,catalog,registration,now:()=>clock})});
 let state=options.state||{},history=[],calls=0,events=[],request,lastAssistantMessage=options.lastAssistantMessage||null;
 async function send(text,plan,interactionId){
  const messageId=randomUUID();const out=await engine.handleMessage({text,interactionId,state,messageId,lastAssistantMessage});state=out.state;
  if(out.deferredQuestionAI){
   const s=createMetaInboxMock({},{});
   s.seed('whatsAppConversation',{id:1,phoneNumber:'+29999999111',controlState:'BOT_ACTIVE',engineState:state});
   s.seed('whatsAppChatbotSettings',{id:1,enabled:true,admissionsEnabled:true});
   let id=0;for(const h of history)s.seed('whatsAppConversationMessage',{id:++id,conversationId:1,direction:h.direction,body:h.body,senderUserId:null,messageType:'TEXT',createdAt:clock});
   s.seed('whatsAppConversationMessage',{id:++id,conversationId:1,direction:'INBOUND',body:text,providerMessageId:messageId,senderUserId:null,messageType:'TEXT',createdAt:clock});
   const outbound=++id,key='wa-reply:'+messageId+':0';
   s.seed('whatsAppConversationMessage',{id:outbound,conversationId:1,direction:'OUTBOUND',body:out.text,idempotencyKey:key,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PENDING',createdAt:clock,updatedAt:clock});
   const find=s.db.whatsAppConversationMessage.findUnique;s.db.whatsAppConversationMessage.findUnique=async args=>{const m=await find(args);if(m&&args.include?.conversation)m.conversation=s.rows('whatsAppConversation')[0];return m;};
   s.db.whatsAppChatbotAiBudget={upsert:async()=>{},updateMany:async()=>({count:1})};
   if(options.center)s.db.centerSettings={findUnique:async()=>options.center};
   const ai=createQuestionAIService({env,observe:(event,data)=>events.push({event,...data}),fetchImpl:async(url,opts)=>{const body=JSON.parse(opts.body);if(body.text.format.name==='nva_grounding'){const approved=plan?.grounded!==false;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({approved})}]}]})};}calls++;request=JSON.parse(body.input);if(plan instanceof Error)throw plan;return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan&&Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='grounded')))}]}]})};}});
   await createQuestionAICompletionService({database:s.db,env,ai,catalog,registration,now:()=>clock}).completeReply(key);
   const row=s.rows('whatsAppConversationMessage').find(m=>m.id===outbound);state=s.rows('whatsAppConversation')[0].engineState;
   out.text=row.body;out.interactive=row.interactivePayload;out.state=state;
  }
  const body=final(out);lastAssistantMessage={body,idempotencyKey:'wa-reply:'+messageId+':0',createdAt:clock,deliveryStatus:'SENT'};history.push({direction:'INBOUND',body:text},{direction:'OUTBOUND',body});return {...out,body};
 }
 return {send,calls:()=>calls,events:()=>events,request:()=>request,state:()=>state,enter:async()=>{const menu=await send('Menu');return send('',undefined,menu.state.admission.options.find(o=>o.id==='question').wireId);}};
}

const delivered=body=>({body,idempotencyKey:'previous',createdAt:clock,deliveryStatus:'SENT'});
for(const open of [true,false]){
 for(const [question,reply,expected] of [
 ['Vous souhaitez des détails sur une formation ?','Oui',/Sur quelle formation souhaitez-vous plus de détails/],
 ['Vous souhaitez plus d’informations sur les horaires ?','Oui j’en veux',/créneau|horaires|19h00/],
 ['Vous souhaitez un créneau particulier ?','Non',/D’accord, aucun créneau en particulier/],
 ])test('question context open='+open+' '+reply+' '+question,async()=>{
  const s=setup(open,{state:{mode:'QUESTION_AI',questionAIStartedAt:clock.toISOString(),admission:{step:'INVITE',expiresAt:new Date(+clock+3600000).toISOString(),options:[]}},lastAssistantMessage:delivered(question)});
  const r=await s.send(reply,new Error('synthetic outage'));
  assert.match(r.body,expected);assert.doesNotMatch(r.body,/Via WhatsApp|Via le site|Choisissez.*inscription/);assert.deepEqual(r.actions,[]);
 });
}
for(const open of [true,false]){
 test('valid explicit invitation open='+open,async()=>{
  const s=setup(open,{state:{mode:'QUESTION_AI',questionAIStartedAt:clock.toISOString()},lastAssistantMessage:delivered('Souhaitez-vous commencer votre inscription ?')});
  const r=await s.send('Oui');assert.equal(s.calls(),0);assert.equal(r.state.admission.step,'DONE');assert.match(r.body,open?/remplissez le formulaire/:/Aucune session n’est ouverte/);assert.match(r.body,/https:\/\/www.newvisionacademy.org\/register/);
 });
 for(const failure of ['outage','validation'])test('information agreement cannot register '+failure+' open='+open,async()=>{
  const s=setup(open,{state:{mode:'QUESTION_AI',questionAIStartedAt:clock.toISOString()},lastAssistantMessage:delivered('Vous souhaitez des détails sur une formation ?')});
  const r=await s.send('Oui',failure==='outage'?new Error('private outage'):{invalid:'private response'});
  assert.match(r.body,/Sur quelle formation/);assert.equal((r.body.match(/\?/g)||[]).length,1);assert.equal(r.state.admission,null);assert.equal(s.calls(),1);
  assert.ok(s.events().some(e=>e.reason===(failure==='outage'?'NETWORK_ERROR':'PLAN_INVALID')));
  assert.doesNotMatch(JSON.stringify(s.events()),/private|formation/);
 });
 test('model REGISTER cannot act on information agreement open='+open,async()=>{
  const s=setup(open,{state:{mode:'QUESTION_AI',questionAIStartedAt:clock.toISOString()},lastAssistantMessage:delivered('Vous souhaitez plus d’informations sur les horaires ?')});
  const r=await s.send('Oui je veux bien',dialoguePlan('REGISTRATION'));
  assert.match(r.body,/créneau/);assert.equal(r.state.admission,null);assert.ok(s.request().questionContext);assert.equal(s.request().questionContext.topic,'SCHEDULE');
 });
}
test('unreferenced Oui asks exactly one clarification even with model registration intent',async()=>{
 const s=setup();const r=await s.send('Oui',dialoguePlan('REGISTRATION'));assert.equal((r.body.match(/\?/g)||[]).length,1);assert.match(r.body,/quel sujet/);assert.equal(r.state.admission,null);
});
test('new explicit subject overrides earlier course question',async()=>{
 const s=setup(true,{state:{mode:'QUESTION_AI',questionAIStartedAt:clock.toISOString()},lastAssistantMessage:delivered('Vous souhaitez des détails sur une formation ?')});
 const r=await s.send('Quel est le tarif ?',questionAIPlan(['c1_price']));assert.match(r.body,/60 USD/);assert.doesNotMatch(r.body,/Sur quelle formation/);
});
const context=require('../src/services/whatsappQuestionContext');
test('only successful questions carry typed context; expiry and failed deliveries are ignored',()=>{
 for(const status of ['QUEUED','FAILED','CANCELLED'])assert.equal(context.fromMessage({...delivered('Vous souhaitez des détails sur une formation ?'),deliveryStatus:status},clock),null);
 assert.equal(context.fromMessage({...delivered('Une question ?'),createdAt:new Date(+clock-86400001)},clock),null);
 const c=context.fromMessage(delivered('Vous souhaitez des détails sur une formation ?'),clock);assert.equal(c.expected,'YES_NO');assert.equal(c.action,null);assert.equal(c.replyKey,'previous');
 assert.equal(context.fromMessage(delivered('Vous souhaitez un créneau particulier ?'),clock).topic,'SCHEDULE');
 assert.equal(context.fromMessage(delivered('Souhaitez-vous commencer votre inscription ?'),clock).action,'REGISTER');
});
for(const plan of [new Error('private failure'),{invalid:true}])test('verified facts replace generic fallback after AI failure or validation rejection',async()=>{
 const s=setup();await s.enter();const r=await s.send('Quels horaires sont habituels ?',plan);assert.match(r.body,/9h30|19h00/);assert.match(r.body,/habituel/);assert.doesNotMatch(r.body,/Réessayez|private/);
});
test('missing schedule is identified precisely',()=>{
 assert.match(context.safeFallback('Les horaires ?','fr',[]),/L’horaire confirmé manque/);
});
test('information about registration is not an explicit invitation to register',async()=>{
 const s=setup(true,{lastAssistantMessage:delivered('Souhaitez-vous des informations sur l’inscription ?'),state:{admission:{step:'INVITE',expiresAt:new Date(+clock+3600000).toISOString()}}});
 const r=await s.send('Oui',dialoguePlan('REGISTRATION'));assert.equal(r.state.admission,null);assert.equal((r.body.match(/\?/g)||[]).length,1);
});
test('legacy collection is redirected without submitting the draft',async()=>{
 const draft={consentToCollect:true,courseId:1};
 const s=setup(true,{state:{admission:{step:'NAME',draft,options:[],expiresAt:new Date(+clock+3600000).toISOString()}},lastAssistantMessage:delivered('Vous souhaitez des détails sur une formation ?')});
 const r=await s.send('Oui',new Error('synthetic failure'));assert.match(r.body,/remplissez le formulaire/);assert.equal(r.state.admission.step,'DONE');assert.deepEqual(r.state.admission.draft,{});assert.deepEqual(r.actions,[]);
});
