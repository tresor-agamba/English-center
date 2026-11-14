require('./helpers/whatsappIsolationGuard.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const api=require('../src/services/whatsappCloudApiService');
function setup(aiEnabled=true){
 const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED',session:{id:10,startTime:'09:30',endTime:'11:00',weekDays:['friday','saturday']}};
 const catalog={listPublished:async()=>[course]},registration={listCoursesForPublicRegistration:async()=>[course]};
 const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration});
 // No key/provider: any AI route would defer or fall back instead of rendering the campaign.
 return createConversationEngine({admissions,catalog,registration,env:{NVA_AI_ENABLED:String(aiEnabled)},whatsappConfig:()=>({})});
}
const receive=(engine,text,state={},extra={})=>engine.handleMessage({text,state,messageId:'campaign',...extra});
for(const enabled of [true,false])for(const opened of [true,false])test(`whole keyword, AI enabled=${enabled}, opened=${opened}`,async()=>{
 const e=setup(enabled),state=opened?{mode:'QUESTION_AI',questionAIStartedAt:new Date().toISOString(),processedMessageIds:['old'],preferredLanguage:'en'}:{};
 let body;
 for(const text of ['anglais','Anglais','ANGLAIS !',' \tANGLAIS…?! \n']){
  const r=await receive(e,text,state,{isFirstContact:!opened});
  assert.equal(r.intent,'ENGLISH_CAMPAIGN');assert.equal(r.deferredQuestionAI,undefined);assert.equal(r.state.mode,null);assert.equal(r.state.preferredLanguage,'fr');
  const payload=api.buildInteractivePayload({phoneNumber:'+29999999111',interactive:r.interactive});
  assert.deepEqual(payload.interactive.action.buttons.map(b=>b.reply.title),['Voir les horaires','Voir le tarif','S’inscrire']);
  body=body||payload.interactive.body.text;assert.equal(payload.interactive.body.text,body);assert.match(body,/100 % en ligne/);
 }
});
for(const [value,expected] of [['schedule',/vendredi|9h30/],['price',/60 USD/],['registration',/https:\/\/www.newvisionacademy.org\/register/]])test('existing button '+value,async()=>{
 const e=setup(),first=await receive(e,'ANGLAIS');
 const option=first.state.admission.options.find(o=>o.value===value);
 const r=await receive(e,option.label,first.state,{messageId:'click',interactionId:option.wireId,isFirstContact:false});
 assert.equal(r.deferredQuestionAI,undefined);assert.match(r.text,expected);
 if(value==='registration')assert.deepEqual(r.state.admission.draft,{});
});
test('complete question keeps AI routing in an open conversation',async()=>{
 const r=await receive(setup(),'Combien coûtent les cours d’anglais ?',{mode:'QUESTION_AI',questionAIStartedAt:new Date().toISOString(),processedMessageIds:['old']});
 assert.equal(r.intent,'QUESTION_AI');assert.equal(r.deferredQuestionAI,true);
});
test('campaign respects pauses, opt-out and deduplication',async()=>{
 for(const [state,intent] of [[{automationPaused:true},'PAUSED'],[{optedOut:true},'OPTED_OUT'],[{processedMessageIds:['campaign']},'DUPLICATE']]){
  const r=await receive(setup(),'ANGLAIS !',state);assert.equal(r.intent,intent);assert.equal(r.text,null);assert.deepEqual(r.actions,[]);
 }
 const e=setup(),first=await receive(e,'ANGLAIS');
 assert.equal((await receive(e,'ANGLAIS',first.state)).duplicate,true);
 const stopped=await receive(e,'STOP',first.state,{messageId:'stop'});
 assert.equal(stopped.intent,'OPT_OUT');assert.equal((await receive(e,'ANGLAIS',stopped.state,{messageId:'after-stop'})).text,null);
});
