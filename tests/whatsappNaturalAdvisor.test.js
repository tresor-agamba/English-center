const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const {createQuestionAIService,buildFacts}=require('../src/services/whatsappQuestionAIService');
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED'};
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:randomUUID(),OPENAI_MODEL:'mock-model'};
function engine(){const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[]};return createConversationEngine({env,catalog,registration,admissions:createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration})});}
const input=(e,text,state,id=randomUUID())=>e.handleMessage({text,state,messageId:id});
test('professional NVA prompt reaches the provider with identity, advice and security instructions',async()=>{
 let request;
 const ai=createQuestionAIService({env,fetchImpl:async(_url,opts)=>{
  request=JSON.parse(opts.body);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({language:'fr',reply:'Bonjour ! 😊 Comment puis-je vous aider ?',factIds:[],action:'NONE'})}]}]})};
 }});
 assert.ok(await ai.answer({question:'Bonjour',facts:buildFacts([course],[]),reserve:async()=>true}));
 for(const text of ['NVA Assistant','employé humain','*texte important*','sans pression','code OTP','QUESTIONS GÉNÉRALES','CONTRAT TECHNIQUE'])assert.ok(request.instructions.includes(text),text);
 assert.equal(request.tools,undefined);assert.equal(request.text.format.schema.properties.action.enum.join(','),'NONE,REGISTER');
});
test('indicative duration and usual hours are distinct from current open sessions',()=>{
 const facts=buildFacts([course],[{id:7,course,startDate:'2026-12-01',registrationGroups:[{isActive:true,isFull:false,startTime:'12:00',endTime:'13:30',weekDays:['Tuesday']}]}]);
 const weeks=facts.find(f=>f.id==='c1_weeks'),usual=facts.find(f=>f.id==='c1_usual_schedule'),session=facts.find(f=>f.id==='c1_session7');
 assert.match(weeks.fr,/8 semaines/);assert.match(weeks.en,/24 weeks.*without interruption/);assert.match(weeks.fr,/indicatives/);
 assert.match(usual.fr,/habituels/);assert.match(usual.fr,/pas une confirmation/);assert.match(usual.en,/not confirmation/);
 assert.match(session.fr,/12:00–13:30/);assert.doesNotMatch(session.fr,/18:00/);
 assert.equal(buildFacts([{...course,id:2,title:'Excel',slug:'excel'}],[]).some(f=>/weeks|usual_schedule/.test(f.id)),false);
});
test('any pristine first contact receives a persisted welcome and exactly two buttons',async()=>{
 for(const text of ['Bonjour','Comment débuter ?','Je n’ai que 30 dollars','Et après les cinq séances gratuites ?']){
  const e=engine(),r=await input(e,text);assert.equal(r.intent,'WELCOME');assert.ok(r.state.welcomeSentAt);
  assert.deepEqual(r.interactive.action.buttons.map(b=>b.reply.title),["📝 S'inscrire",'💬 Poser une question']);
  const next=await input(e,text,JSON.parse(JSON.stringify(r.state)),'second');assert.equal(next.deferredQuestionAI,true);assert.equal(next.interactive,undefined);
  assert.equal((await input(e,text,next.state,'second')).duplicate,true);
 }
});
test('both initial buttons work and registration preserves deterministic consent',async()=>{
 const e=engine(),r=await input(e,'Bonjour');
 for(const [id,step]of [['question','FREE'],['registration','METHOD']]){
  const o=r.state.admission.options.find(o=>o.id===id);const next=await e.handleMessage({interactionId:o.wireId,state:r.state,messageId:randomUUID()});assert.equal(next.state.admission.step,step);
  if(id==='registration'){const admin=next.state.admission.options.find(o=>o.id==='admin');const consent=await e.handleMessage({interactionId:admin.wireId,state:next.state,messageId:randomUUID()});assert.equal(consent.state.admission.step,'CONSENT');assert.deepEqual(consent.actions,[]);}
 }
});
test('ordinary social, budget and follow-up questions freely use AI with language changes',async()=>{
 const e=engine();let r=await input(e,'Hello, how are you?');assert.match(r.text,/Welcome/);
 for(const text of ['Bonjour','Comment débuter ?','Je n’ai que 30 dollars','Et après les cinq séances gratuites ?','What about the certificate?','Merci']){r=await input(e,text,r.state);assert.equal(r.deferredQuestionAI,true);assert.ok(r.state.questionAIStartedAt);}
 assert.equal(r.state.preferredLanguage,'en');
});
test('natural provider prose uses official facts, bounded history and safe registration action',async()=>{
 let request;const facts=buildFacts([course],[]);
 const run=async result=>createQuestionAIService({env,fetchImpl:async(_url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};}}).answer({question:'Je n’ai que 30 dollars',history:Array.from({length:10},()=>({role:'user',content:'Et ensuite ?'})),facts,reserve:async()=>true});
 assert.equal(await run({language:'fr',reply:'Vous pouvez continuer dès la sixième séance avec 30 USD. 😊',factIds:['c1_payment'],action:'NONE'}),'Vous pouvez continuer dès la sixième séance avec 30 USD. 😊');
 assert.equal(JSON.parse(request.input).history.length,6);assert.equal(request.store,false);
 assert.deepEqual(await run({language:'fr',reply:'Commençons votre demande.',factIds:[],action:'REGISTER'}),{action:'REGISTER'});
 for(const reply of ['Le prix est 12 USD.','Votre inscription est confirmée.','Payez avec PayPal.','https://fake.invalid'])assert.equal(await run({language:'fr',reply,factIds:['c1_price'],action:'NONE'}),null);
});
