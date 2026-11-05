const test=require('node:test');
const assert=require('node:assert/strict');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const {createQuestionAIService,buildFacts,fallback}=require('../src/services/whatsappQuestionAIService');
const {PROMPT_VERSION}=require('../src/config/nvaAssistantPrompt');
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'mock',NVA_AI_TIMEOUT_MS:'250'};
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED'};
const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[],listSessionsForPublicRegistration:async()=>[]};
const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration});
const engine=()=>createConversationEngine({env,catalog,registration,admissions});
test('persistent first welcome has exactly two stable choices; known greetings use AI',async()=>{
 const e=engine(),first=await e.handleMessage({text:'Bonjour',messageId:'first',isFirstContact:true});
 assert.equal(first.intent,'WELCOME');assert.ok(first.state.welcomeSentAt);
 assert.deepEqual(first.interactive.action.buttons.map(b=>b.reply),[{id:'adm:welcome:registration',title:"📝 S'inscrire"},{id:'adm:welcome:question',title:'💬 Poser une question'}]);
 const next=await e.handleMessage({text:'Bonjour',messageId:'second',state:JSON.parse(JSON.stringify(first.state))});
 assert.equal(next.deferredQuestionAI,true);assert.equal(next.interactive,undefined);
 const clicked=await e.handleMessage({interactionId:'adm:welcome:registration',messageId:'click',state:first.state});assert.equal(clicked.state.admission.step,'METHOD');
});
const questions=["Je veux apprendre l'anglais.",'Je suis débutant.','Comment débuter ?','Combien coûte la formation ?',"Je n’ai que 30 dollars.",'Et après les cinq séances gratuites ?','Quels jours proposez-vous ?',"C’est quand la prochaine session ?",'Le certificat est-il reconnu internationalement ?','Merci beaucoup.','Can we speak English please?','Et après ?','Parlons maintenant du certificat.','Et sa reconnaissance ?','je veu aprendre langlai'];
for(const text of questions)test('free conversation goes to generation: '+text,async()=>{
 const r=await engine().handleMessage({text,messageId:text,state:{processedMessageIds:['old']}});
 assert.equal(r.deferredQuestionAI,true);assert.equal(r.intent,'QUESTION_AI');assert.equal(r.actions.length,0);
});
test('duplicate, STOP, adviser and registration retain backend control',async()=>{
 const e=engine(),r=await e.handleMessage({text:'Je suis débutant',messageId:'same'});
 assert.equal((await e.handleMessage({text:'Je suis débutant',messageId:'same',state:r.state})).duplicate,true);
 for(const text of ['STOP','conseiller',"Je veux m'inscrire",'Je veux commencer']){const out=await e.handleMessage({text,messageId:text,state:r.state});assert.equal(out.deferredQuestionAI,undefined);}
});
test('generation returns original prose with bounded context, no tools and no storage',async()=>{
 let request;const events=[];
 const ai=createQuestionAIService({env,log:{info:(name,data)=>events.push(data)},fetchImpl:async(url,options)=>{
  request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:40,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:'Vous pouvez commencer au premier niveau 😊'}]}]})};
 }});
 const history=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'message '+i}));
 assert.equal(await ai.answer({question:'Je suis débutant',history,facts:buildFacts([course],[]),reserve:async()=>true}),'Vous pouvez commencer au premier niveau 😊');
 assert.equal(request.input.length,14);assert.equal(request.store,false);assert.equal(request.tools,undefined);assert.equal(request.text,undefined);
 assert.match(request.instructions,/dates de lancement/);assert.equal(events[0].promptVersion,PROMPT_VERSION);assert.equal(events[0].source,'openai');
});
test('provider failures, quota, truncation, empty output, invalid output and timeout have safe fallback',async()=>{
 const transports=[async()=>{throw Error('secret');},async()=>({ok:false,status:429}),async()=>({ok:false,status:401}),async()=>({ok:true,json:async()=>({status:'incomplete'})}),async()=>({ok:true,json:async()=>({status:'completed',output:[]})}),async()=>new Promise(()=>{})];
 for(const fetchImpl of transports){const ai=createQuestionAIService({env,fetchImpl,log:{info:()=>{}}});assert.equal(await ai.answer({question:'Bonjour',facts:buildFacts([course],[]),reserve:async()=>true}),null);}
 const ai=createQuestionAIService({env,fetchImpl:async()=>assert.fail('quota must prevent HTTP'),log:{info:()=>{}}});
 assert.equal(await ai.answer({question:'Bonjour',facts:buildFacts([course],[]),reserve:async()=>false}),null);
 assert.doesNotMatch(fallback('Bonjour','fr'),/vérifier cette information/);
});
test('official facts separate usual timetable from confirmed start dates and protect certification',()=>{
 const facts=buildFacts([course],[]);const text=JSON.stringify(facts);
 for(const value of ['60 USD','180 USD','200 USD','30 USD','16 séances','24 semaines','reconnaissance internationale','Aucune session ouverte confirmée','vendredi et samedi'])assert.ok(text.includes(value),value);
});
