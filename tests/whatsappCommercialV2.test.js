const test=require('node:test');
const assert=require('node:assert/strict');
const {detectIntents,distance}=require('../src/services/whatsappCommercialIntents');
const corpus=require('./fixtures/nvaCommercialEvaluation.cjs');
const {createAdmissionJourney}=require('../src/services/whatsappAdmissionJourney');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const course={id:1,title:'Anglais',structureType:'LEVEL_BASED',numberOfLevels:3,accessPolicy:'LEGACY_STAGED',sessionCount:16,pricingActive:true,pricingMode:'ONE_TIME',price:60,currency:'USD'};
function setup({courses=[course],sessions=[],ttl=86400000,chatbot=null}={}){
 const catalog={listPublished:async()=>courses};
 const registration={listSessionsForPublicRegistration:async()=>sessions,listCoursesForPublicRegistration:async()=>sessions.map(s=>({...s.course,session:s}))};
 const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration,conversationTtlMs:ttl});
 const engine=createConversationEngine({catalog,registration,admissions,chatbot,whatsappConfig:()=>({})});
 let n=0;return {admissions,engine,send:(text,state,interactionId)=>engine.handleMessage({text,state,interactionId,messageId:'test-'+(++n),phoneNumber:'+243812345678'})};
}
test('authored evaluation corpus measures exact intent sets on at least 200 questions',t=>{
 assert.ok(corpus.length>=200);let correct=0;const failures=[];
 for(const item of corpus){const actual=detectIntents(item.text).sort();if(JSON.stringify(actual)===JSON.stringify([...item.intents].sort()))correct++;else failures.push({text:item.text,expected:item.intents,actual});}
 t.diagnostic(JSON.stringify({total:corpus.length,correct,accuracy:correct/corpus.length,failures}));
 assert.ok(correct/corpus.length>=0.8,'Local evaluation target not reached');
});
test('multiple topics, accents, bounded fuzzy matching and context',()=>{
 assert.deepEqual(detectIntents('Combien ça coûte et quand commence-t-on ?'),['SESSION_START_DATE','PRICING']);
 assert.deepEqual(detectIntents('BONJOUR !'),['GREETING']);assert.deepEqual(detectIntents('Vos horraires ?'),['TRAINING_SCHEDULE']);
 assert.equal(distance('tarifs','tarrifs'),1);
 assert.deepEqual(detectIntents('La deuxième',{registrationMethod:true}),['REGISTRATION_WHATSAPP']);
 assert.deepEqual(detectIntents('la deuxième'),['UNKNOWN']);
});
test('free questions answer multiple topics with live dates and no fictional availability',async()=>{
 const s=setup();const greeting=await s.send('Bonjour');assert.equal(greeting.interactive.action.buttons.length,3);
 const question=greeting.state.admission.options.find(o=>o.id==='question');const free=await s.send('',greeting.state,question.wireId);assert.match(free.text,/assistant virtuel/);
 const response=await s.send('Combien ça coûte et quand commence-t-on ?',free.state);assert.match(response.text,/180 USD/);assert.match(response.text,/Aucune session ouverte/);assert.deepEqual(response.actions,[]);
});
test('registration short answers, explicit consent, expiry and switching methods',async()=>{
 const s=setup();let r=await s.send('Je veux m’inscrire');assert.deepEqual(r.state.admission.options.map(o=>o.id),['online','admin','menu']);
 r=await s.send('La deuxième',r.state);assert.equal(r.state.admission.step,'CONSENT');assert.deepEqual(r.actions,[]);
 const expired={...r.state,admission:{...r.state.admission,expiresAt:'2000-01-01'}};
 r=await s.send('',expired,r.state.admission.options[0].wireId);assert.match(r.text,/expiré/);
 assert.throws(()=>setup({ttl:0}),TypeError);
});
test('V2 unknown questions never invoke existing AI and escalate after three failures',async()=>{
 const calls=[];const s=setup({chatbot:{resolve:async input=>{calls.push(input);assert.equal(input.allowAI,false);return null;}}});
 let r=await s.send('menu');for(let i=0;i<3;i++)r=await s.send('xyz abc',r.state);
 assert.equal(r.state.automationPaused,true);assert.equal(r.actions[0].type,'HUMAN_HANDOFF');assert.ok(calls.every(c=>!c.allowAI));
 assert.equal((await s.send('bonjour',r.state)).text,null);
});
test('a selected session is rechecked before confirmation',async()=>{
 const session={id:7,course,levelNumber:1,startDate:'2100-01-01',weekDays:['Friday'],startTime:'10:00',endTime:'11:30'};
 const sessions=[session];const s=setup({sessions});const draft={fullName:'Marie Kalala',phoneNumber:'+243812345678',email:'marie@example.test',requestedLevel:'BEGINNER',consentToCollect:true,courseId:1};
 let state={admission:{step:'SESSION',draft,options:[{wireId:'adm:session:token',value:'7',id:'session-7',label:'Session 1'}],expiresAt:'2100-01-01'}};
 let r=await s.send('',state,'adm:session:token');assert.equal(r.state.admission.step,'REVIEW');assert.match(r.text,/2100/);
 sessions.length=0;const confirm=r.state.admission.options.find(o=>o.id==='confirm');r=await s.send('',r.state,confirm.wireId);assert.deepEqual(r.actions,[]);assert.match(r.text,/plus disponible/);
});
test('questions during collection preserve the draft and switching to site clears it',async()=>{
 const s=setup();const state={admission:{step:'NAME',draft:{consentToCollect:true},options:[],expiresAt:'2100-01-01'}};
 let r=await s.send('Combien coûte le certificat ?',state);assert.equal(r.state.admission.step,'NAME');assert.match(r.text,/20 USD/);assert.deepEqual(r.actions,[]);
 r=await s.send('Je préfère votre site',r.state);assert.match(r.text,/https:\/\/www.newvisionacademy.org/);assert.deepEqual(r.state.admission.draft,{});
});
test('payment problems request human help rather than commercial payment advice',async()=>{
 const s=setup();const r=await s.send('Mon paiement pose un problème, problème de paiement');assert.equal(r.actions[0].type,'HUMAN_HANDOFF');assert.equal(r.state.automationPaused,true);
});
