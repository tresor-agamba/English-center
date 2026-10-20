const test=require('node:test'),assert=require('node:assert/strict');
const {createAICompletionService}=require('../src/services/whatsappChatbotAICompletionService');
const {createOpenAIService}=require('../src/services/whatsappChatbotOpenAIService');
const {createChatbotService,AI_FALLBACK}=require('../src/services/whatsappChatbotService');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const env={NVA_CHATBOT_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'synthetic-model',NVA_CHATBOT_AI_DAILY_CALL_LIMIT:'2'};
function setup(){
 const conversation={id:1,phoneNumber:'+15555550123',controlState:'BOT_ACTIVE',engineState:{}};
 const message={id:2,conversationId:1,direction:'OUTBOUND',deliveryStatus:'QUEUED',attempts:0,failureCode:'AI_PENDING',body:AI_FALLBACK,idempotencyKey:'wa-reply:wamid.test:0',updatedAt:new Date(),conversation};
 const latest={id:1,providerMessageId:'wamid.test',messageType:'TEXT',body:'question'};
 const rule={id:4,kind:'FAQ',enabled:true,body:'Official FAQ',title:'NVA'};const settings={enabled:true,aiEnabled:true};
 let inTx=false,requests=0,quota=0;
 const database={whatsAppConversationMessage:{findUnique:async()=>structuredClone(message),findFirst:async()=>structuredClone(latest),updateMany:async({where,data})=>{
   if(Object.entries(where).some(([k,v])=>k==='updatedAt'?+message[k]!==+v:message[k]!==v))return {count:0};Object.assign(message,data);return {count:1};
  }},whatsAppConversation:{findUnique:async()=>structuredClone(conversation)},whatsAppChatbotSettings:{findUnique:async()=>structuredClone(settings)},whatsAppChatbotRule:{findMany:async()=>[structuredClone(rule)],findUnique:async()=>structuredClone(rule)},
  whatsAppChatbotAiBudget:{upsert:async()=>{assert.equal(inTx,false)},updateMany:async()=>{assert.equal(inTx,false);quota++;return {count:1}}},
  $transaction:async work=>{assert.equal(inTx,false);inTx=true;try{return await work(database)}finally{inTx=false}}
 };
 const ai=createOpenAIService({database,env,fetchImpl:async()=>{assert.equal(inTx,false);requests++;return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'4'}]}]})}}});
 return {database,ai,message,latest,rule,conversation,settings,requests:()=>requests,quota:()=>quota};
}
test('quota and actual OpenAI request run outside every SQL transaction; final answer remains approved',async()=>{
 const s=setup();const service=createAICompletionService({...s,env});assert.equal((await service.completeReply(s.message.idempotencyKey)).completed,true);assert.equal(s.requests(),1);assert.equal(s.quota(),1);assert.equal(s.message.body,'Official FAQ');assert.equal(s.message.failureCode,null);
 await service.completeReply(s.message.idempotencyKey);assert.equal(s.requests(),1);
});
test('STOP, handoff and newer inbound during HTTP cancel the deferred reply',async()=>{
 for(const mutate of [s=>s.conversation.controlState='OPTED_OUT',s=>s.conversation.controlState='HUMAN_TAKEOVER',s=>{s.latest.id=3;s.latest.providerMessageId='wamid.new';}]){
  const s=setup();const ai={select:async()=>{mutate(s);return s.rule.body}};
  const result=await createAICompletionService({database:s.database,env,ai}).completeReply(s.message.idempotencyKey);assert.equal(result.cancelled,true);assert.equal(s.message.deliveryStatus,'CANCELLED');
 }
});
test('FAQ disabled or edited during HTTP is never published',async()=>{
 for(const mutate of [s=>s.rule.enabled=false,s=>s.rule.body='Edited FAQ',s=>s.settings.aiEnabled=false]){
  const s=setup();const answer=s.rule.body;const ai={select:async()=>{mutate(s);return answer}};
  await createAICompletionService({database:s.database,env,ai}).completeReply(s.message.idempotencyKey);assert.equal(s.message.body,AI_FALLBACK);assert.equal(s.message.failureCode,null);
 }
});
test('concurrent completion claims make a single API call',async()=>{
 const s=setup();let finish;const gate=new Promise(resolve=>finish=resolve);let calls=0;const ai={select:async()=>{calls++;await gate;return s.rule.body}};
 const service=createAICompletionService({database:s.database,env,ai});const first=service.completeReply(s.message.idempotencyKey);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await service.completeReply(s.message.idempotencyKey),{busy:true});finish();await first;assert.equal(calls,1);
});
test('crashed processing owner releases safe fallback without repeating OpenAI',async()=>{
 const s=setup();s.message.failureCode='AI_PROCESSING';s.message.updatedAt=new Date('2020-01-01');
 assert.equal((await createAICompletionService({...s,env}).completeReply(s.message.idempotencyKey)).fallback,true);assert.equal(s.requests(),0);assert.equal(s.message.body,AI_FALLBACK);
});
test('disabled AI performs no database access and no HTTP',async()=>{
 const service=createAICompletionService({database:new Proxy({},{get:()=>assert.fail('DB forbidden')}),env:{},ai:{select:async()=>assert.fail('HTTP forbidden')}});assert.deepEqual(await service.completeReply('x'),{skipped:true});
});
test('transaction engine defers AI and produces only a safe pending reply',async()=>{
 const s=setup();const chatbot=createChatbotService({database:s.database,deferAI:true,ai:{select:async()=>assert.fail('No HTTP from engine transaction')}});
 const engine=createConversationEngine({chatbot,catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},whatsappConfig:()=>({})});
 const result=await engine.handleMessage({text:'unknown query'});assert.equal(result.deferredAI,true);assert.equal(result.text,AI_FALLBACK);
});
