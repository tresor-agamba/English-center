const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createConversationEngine } = require('../src/services/whatsappConversationEngine');
const { createAdmissionJourney } = require('../src/services/whatsappAdmissionJourney');
const courses = [{id:1,title:'Anglais général',slug:'anglais-general',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',structureType:'LEVEL_BASED'}];
function engine() {
 const catalog={listPublished:async()=>courses};
 const registration={listCoursesForPublicRegistration:async()=>[]};
 const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration});
 return createConversationEngine({catalog,registration,admissions,env:{NVA_AI_ENABLED:'true'},whatsappConfig:()=>({})});
}
const input=(e,text,state)=>e.handleMessage({text,state,messageId:randomUUID()});
test('AI question followed by repeated greetings bypasses AI and renders real buttons',async()=>{
 const e=engine(); let r=await input(e,'Combien de séances gratuites ?', {mode:'QUESTION_AI',questionAIStartedAt:new Date().toISOString()});
 assert.equal(r.deferredQuestionAI,true);
 for(const text of ['Bonjour','Bonjour','Bonsoir','Salut','Hello','Hi']) {
  r=await input(e,text,r.state);
  assert.equal(r.deferredQuestionAI,undefined); assert.match(r.text,/Ravi de vous retrouver/);
  assert.equal(r.interactive.type,'button');
  assert.deepEqual(r.interactive.action.buttons.map(b=>b.reply.title),['S’inscrire','Menu','Poser une question']);
 }
});
test('thanks bypasses AI while preserving question mode',async()=>{
 const state={mode:'QUESTION_AI',questionAIStartedAt:new Date().toISOString(),processedMessageIds:['old']};
 const r=await input(engine(),'Merci.',state);
 assert.match(r.text,/Avec plaisir/);assert.equal(r.deferredQuestionAI,undefined);assert.equal(r.state.mode,'QUESTION_AI');
});
test('greetings and thanks preserve every collection step and draft',async()=>{
 const e=engine();
 for(const step of ['CONSENT','NAME','PHONE','EMAIL','LEVEL','COURSE','SESSION','GROUP','REVIEW','EDIT']) {
  const admission={step,draft:{consentToCollect:true,fullName:'Marie Kalala'},options:[],expiresAt:new Date(Date.now()+60000).toISOString()};
  for(const text of ['Bonjour','Merci']) {const r=await input(e,text,{admission});assert.deepEqual(r.state.admission,admission);assert.deepEqual(r.actions,[]);}
 }
});
test('current topic overrides pending trial when the course is explicitly named',async()=>{
 const r=await input(engine(),'Quelle durée pour Anglais général ?', {admission:{step:'FREE',pendingIntents:['FREE_TRIAL'],options:[],draft:{},expiresAt:new Date(Date.now()+60000).toISOString()}});
 assert.match(r.text,/16 séances/);assert.doesNotMatch(r.text,/gratuites/);
});
