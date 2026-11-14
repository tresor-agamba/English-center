const test=require('node:test'),assert=require('node:assert/strict');
const {createMetaInboxMock}=require('./helpers/metaInboxMock');
const {createWhatsAppConversationService}=require('../src/services/whatsappConversationService');
const {createQuestionAICompletionService}=require('../src/services/whatsappQuestionAICompletionService');
const {createQuestionAIService}=require('../src/services/whatsappQuestionAIService');
const {questionAIPlan,dialoguePlan}=require('./helpers/questionAIPlan');
const env={NVA_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'mock',NVA_AI_TIMEOUT_MS:'250'};
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED'};
function setup({legacyOffer=false,enabled=true,open=true}={}){
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
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>open?[{...course,session:{id:10}}]:[],listSessionsForPublicRegistration:async()=>[{id:10,course}]};
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

const expected='Pour vous inscrire à New Vision Academy, remplissez le formulaire en ligne :\nhttps://www.newvisionacademy.org/register\n\nSur le site, indiquez votre numéro de téléphone et choisissez un mot de passe. Ces deux identifiants vous permettront de vous connecter à votre espace étudiant.';
function verify(s,outbound){
 const payload=require('../src/services/whatsappCloudApiService').buildTextPayload({phoneNumber:'+29999999111',text:outbound.body});
 assert.equal(payload.text.body,expected);assert.deepEqual(s.state().admission.draft,{});
 for(const table of ['whatsAppAdmissionRequest','enrollment','user'])assert.equal(s.rows(table).length,0);
}
for(const text of ['S’inscrire','Je veux m’inscrire','Comment puis-je m’inscrire ?'])test('website request: '+text,async()=>{const s=setup();verify(s,(await s.receive(text)).outbound);assert.equal(s.calls(),0);});
test('button to generated WhatsApp payload',async()=>{const s=setup();s.state().admission={step:'MENU',draft:{},options:[{value:'registration',wireId:'adm:registration:test'}],expiresAt:new Date(+s.time()+10000).toISOString()};verify(s,(await s.receive('S’inscrire',{interactionId:'adm:registration:test'})).outbound);});
test('Oui to delivered explicit invitation',async()=>{const s=setup({legacyOffer:true});verify(s,(await s.receive('Oui')).outbound);});
for(const step of ['METHOD','CONSENT','NAME','EMAIL','PHONE','LEVEL','COURSE','SESSION','GROUP','REVIEW','EDIT'])test('legacy draft '+step,async()=>{const s=setup();s.state().admission={step,draft:{fullName:'Ancien Prospect',consentToCollect:true},options:[]};s.seed('whatsAppAdmissionRequest',{id:77,status:'PENDING'});const old=s.rows('whatsAppAdmissionRequest')[0];const {outbound}=await s.receive('Oui');assert.equal(outbound.body,expected);assert.deepEqual(s.state().admission.draft,{});assert.equal(s.rows('whatsAppAdmissionRequest').length,1);assert.equal(s.rows('whatsAppAdmissionRequest')[0],old);assert.equal(s.rows('enrollment').length,0);});
test('no open sessions',async()=>{const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');const s=setup();const journey=createAdmissionJourney({database:s.db,catalog:{listPublished:async()=>[course]},registration:{listCoursesForPublicRegistration:async()=>[]},now:s.time});const r=await journey.resolve({text:'inscription',state:{},registrationAction:'WEBSITE'});const payload=require('../src/services/whatsappCloudApiService').buildTextPayload({phoneNumber:'+29999999111',text:r.text});assert.match(payload.text.body,/Aucune session n’est ouverte/);assert.match(payload.text.body,/https:\/\/www.newvisionacademy.org\/register/);assert.deepEqual(r.actions,[]);assert.deepEqual(r.state.admission.draft,{});});
test('Oui to information offer stays conversational',async()=>{const s=setup();s.rows('whatsAppConversationMessage')[1].body='Vous souhaitez plus d’informations sur les horaires ?';const {outbound}=await s.receive('Oui');assert.match(outbound.body,/créneau/);assert.doesNotMatch(outbound.body,/remplissez le formulaire/);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);});
for(const text of ['Quels documents pour l’inscription ?','Combien coûte l’inscription ?','Quels sont les horaires ?','Quelles formations proposez-vous ?'])test('information: '+text,async()=>{const s=setup();const {outbound}=await s.receive(text);assert.ok(outbound.body);assert.doesNotMatch(outbound.body,/remplissez le formulaire/);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);});

test('no session reaches durable WhatsApp message without creating a dossier',async()=>{const s=setup({open:false});const {outbound}=await s.receive('Je veux m’inscrire');const body=require('../src/services/whatsappCloudApiService').buildTextPayload({phoneNumber:'+29999999111',text:outbound.body}).text.body;assert.match(body,/Aucune session n’est ouverte/);assert.match(body,/https:\/\/www.newvisionacademy.org\/register/);assert.deepEqual(s.state().admission.draft,{});for(const table of ['whatsAppAdmissionRequest','enrollment','user'])assert.equal(s.rows(table).length,0);});
for(const deliveryStatus of ['QUEUED','FAILED','CANCELLED'])test('invalid invitation '+deliveryStatus,async()=>{const s=setup({legacyOffer:true});s.rows('whatsAppConversationMessage')[1].deliveryStatus=deliveryStatus;const {outbound}=await s.receive('Oui');assert.doesNotMatch(outbound.body,/remplissez le formulaire/);assert.equal(s.rows('whatsAppAdmissionRequest').length,0);});
test('disabled guided admissions still redirects to official website',async()=>{const s=setup({enabled:false});verify(s,(await s.receive('Je veux m’inscrire')).outbound);});
