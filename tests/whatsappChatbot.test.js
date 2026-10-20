const test=require('node:test');
const assert=require('node:assert/strict');
const {validateRule,matchRule,createChatbotService}=require('../src/services/whatsappChatbotService');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createOpenAIService}=require('../src/services/whatsappChatbotOpenAIService');
const rule={id:1,kind:'FAQ',title:'Notre centre',triggers:['centre nva'],body:'Réponse officielle',priority:5,enabled:true};
function database(settings={enabled:true,aiEnabled:true}){let calls=0;return {whatsAppChatbotRule:{findMany:async()=>[rule]},whatsAppChatbotSettings:{findUnique:async()=>settings},whatsAppChatbotAiBudget:{upsert:async()=>{},updateMany:async({where})=>({count:calls++<where.calls.lt?1:0})}};}
function engine(chatbot){return createConversationEngine({chatbot,catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},whatsappConfig:()=>({})});}
test('rule validation normalizes accents, rejects malformed and oversized data',()=>{
 assert.deepEqual(validateRule({...rule,triggers:'École, ECOLE',priority:'12'}).triggers,['ecole']);
 for(const patch of [{kind:'SYSTEM'},{title:''},{body:'a'.repeat(3001)},{triggers:['']},{triggers:[{}]},{priority:-1},{priority:1.2}])assert.throws(()=>validateRule({...rule,...patch}),{statusCode:400});
});
test('matching uses word boundaries, enabled state and stable priority',()=>{
 assert.equal(matchRule([rule], 'ce centre nva est où').id,1);
 assert.equal(matchRule([rule], 'centre nvalidation'),null);
 assert.equal(matchRule([rule,{...rule,id:2,priority:9}], 'centre nva').id,2);
 assert.equal(matchRule([{...rule,enabled:false}], 'centre nva'),null);
});
test('engine preserves STOP, consent, handoff, paused and duplicates before custom rules',async()=>{
 let calls=0;const chatbot={resolve:async()=>{calls++;return {text:'custom'}}};const e=engine(chatbot);
 for(const input of [{text:'STOP'},{text:'conseiller'},{text:'oui relances'},{text:'bonjour',state:{automationPaused:true}},{text:'bonjour',state:{optedOut:true}},{text:'bonjour',messageId:'dup',state:{processedMessageIds:['dup']}}]) await e.handleMessage(input);
 assert.equal(calls,0);
 assert.equal((await e.handleMessage({text:'bonjour'})).text,'custom');
});
test('catalog intents never use static answers or AI; global pause suppresses catalogue',async()=>{
 let calls=0;const db=database();const chatbot=createChatbotService({database:db,ai:{select:async()=>{calls++;return 'bad'}}});
 const e=engine(chatbot);const result=await e.handleMessage({text:'prix'});assert.notEqual(result.text,rule.body);assert.equal(calls,0);
 const stopped=engine(createChatbotService({database:database({enabled:false})}));assert.equal((await stopped.handleMessage({text:'prix'})).text,null);
});
test('FAQ, unknown fallback and pending course context',async()=>{
 let calls=0;const chatbot=createChatbotService({database:database(),ai:{select:async()=>{calls++;return null}}});const e=engine(chatbot);
 assert.equal((await e.handleMessage({text:'centre nva'})).text,rule.body);
 assert.match((await e.handleMessage({text:'question inconnue'})).text,/conseiller/);assert.equal(calls,1);
 await e.handleMessage({text:'autre question',state:{pendingQuestion:{type:'COURSE',intent:'PRICE'}}});assert.equal(calls,1);
});
const env={NVA_CHATBOT_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic-secret',OPENAI_MODEL:'configured-test-model',NVA_CHATBOT_AI_DAILY_CALL_LIMIT:'1'};
test('OpenAI mock returns only an approved FAQ, no secrets in body, committed quota',async()=>{
 let calls=0;const ai=createOpenAIService({database:database(),env,fetchImpl:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,64);assert.ok(!options.body.includes(env.OPENAI_API_KEY));assert.ok(options.signal);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'1'}]}]})};}});
 assert.equal(await ai.select('question',[rule]),rule.body);assert.equal(await ai.select('again',[rule]),null);assert.equal(calls,1);
});
test('API errors, timeouts, incomplete and fabricated answers fail closed',async()=>{
 for(const response of [null,{ok:false},{ok:true,json:async()=>({status:'incomplete'})},{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'999'}]}]})},{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'Prix inventé 10 USD'}]}]})}]){
 const ai=createOpenAIService({database:database(),env,fetchImpl:async()=>{if(!response)throw Error('timeout synthetic');return response}});assert.equal(await ai.select('q',[rule]),null);
 }
});
test('AI remains off without explicit server configuration',async()=>{
 const ai=createOpenAIService({database:database(),env:{},fetchImpl:async()=>assert.fail('no network')});assert.equal(await ai.select('q',[rule]),null);
});
