const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createQuestionAIService,buildFacts}=require('../src/services/whatsappQuestionAIService');
const {detectLanguage,renderPlan,OPENINGS,QUESTIONS}=require('../src/services/whatsappAdvisorPolicy');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const course={id:1,title:'Anglais général',slug:'anglais-general',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,price:60,currency:'USD',pricingActive:true,pricingMode:'ONE_TIME',accessPolicy:'LEGACY_STAGED',certificateFee:20};
const facts=buildFacts([course],[]);
async function answer(result,options={}){
 const ai=createQuestionAIService({env:{NVA_AI_ENABLED:'true',OPENAI_API_KEY:randomUUID(),OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async(url,opts)=>{
  const request=JSON.parse(opts.body);assert.equal(request.store,false);assert.equal(request.tools,undefined);assert.equal(request.text.format.schema.properties.reply,undefined);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};
 }});return ai.answer({question:'Quels sont les tarifs ?',facts,reserve:async()=>true,...options});
}
const inventions=[
 'Vous pouvez payer par PayPal.','Notre certificat est reconnu dans le monde entier.','Votre dossier est accepté, bienvenue parmi nos étudiants.',
 'Payez par Western Union, c’est notre partenaire officiel.','Nous garantissons votre réussite.','Votre inscription vient d’être approuvée.',
 'Une réduction exceptionnelle vous est réservée.','La formation est gratuite pour vous.','Le certificat vous donne accès aux universités étrangères.',
 'Il reste des places pour demain.','Votre emploi sera garanti après les cours.','Notre partenaire Cambridge reconnaît ce diplôme.',
 'You can pay through PayPal.','Your admission has been approved.','Our certificate is recognised worldwide.',
 'We guarantee fluency and a job.','A special discount is reserved for you.','A place is available tomorrow.','Pay whenever you like.',
 '60 USD includes an internationally accredited certificate.',
];
for(const prose of inventions)test('unverified provider prose is rejected: '+prose,async()=>{
 assert.equal(await answer({language:'fr',factIds:[],reply:prose}),null);
 const official=await answer({language:'fr',factIds:['c1_price'],reply:prose});
 assert.equal(official,facts.find(f=>f.id==='c1_price').fr);
 assert.equal(official.includes(prose),false);
 // Extra prose in an otherwise valid plan also falls back to official facts.
 assert.equal(await answer({language:'fr',factIds:['c1_price'],opening:'goal',followUp:'level',reply:prose}),official);
});
test('arbitrary text cannot be smuggled in plan IDs or invented fact IDs',async()=>{
 for(const plan of [{opening:'Votre dossier est accepté',followUp:'none'},{opening:'goal',followUp:'promotion'}])assert.equal(await answer({language:'fr',factIds:[],...plan}),null);
 assert.equal(await answer({language:'fr',factIds:['discount'],opening:'none',followUp:'none'}),null);
});
test('only official assertions, reviewed opening and one question are rendered',async()=>{
 const plan={language:'en',factIds:['c1_price','c1_trial'],opening:'budget',followUp:'level'};
 const body=await answer(plan); // Model language cannot override French preference.
 assert.ok(body.startsWith(OPENINGS.budget.fr[0]));assert.match(body,/60 USD/);assert.match(body,/5 séances/);
 assert.equal((body.match(/\?/g)||[]).length,1);assert.ok(body.endsWith(QUESTIONS.level.fr[0]));
 const english=await answer(plan,{question:'English please'});assert.ok(english.startsWith(OPENINGS.budget.en[0]));assert.match(english,/USD 60|60 USD/);
});
test('dialogue varies reviewed fragments and limits registration invitations',()=>{
 const plan={opening:'goal',followUp:'work'};
 const first=renderPlan(plan,[],'en');const second=renderPlan(plan,[],'en',[{role:'assistant',content:first}]);assert.notEqual(first,second);
 assert.equal((second.match(/\?/g)||[]).length,1);
 const invite=renderPlan({opening:'welcome',followUp:'register'},[],'fr');
 const next=renderPlan({opening:'welcome',followUp:'register'},[],'fr',[{role:'assistant',content:invite}]);assert.ok(!next.includes('M’inscrire'));
 assert.ok(!renderPlan({opening:'respect',followUp:'register'},[],'fr').includes('?'));
});
const switches=[['English please','fr','en'],['Je préfère l’anglais','fr','en'],['Je prefere l anglais','fr','en'],['Parlez-moi en anglais','fr','en'],['Please reply in English','fr','en'],['Switch to English please','fr','en'],['anglais','fr','en'],['French please','en','fr'],['Je préfère le français','en','fr'],['Please answer in French','en','fr'],['Français','en','fr'],['English please, not French','fr','en'],['Parlez-moi en anglais, pas en français','fr','en']];
for(const [input,previous,expected]of switches)test('explicit language '+input,()=>assert.equal(detectLanguage(input,previous),expected));
const mixed=[['Je veux apprendre English pour mon travail','fr','fr'],['Mon niveau est beginner','fr','fr'],['budget','fr','fr'],['certificate','fr','fr'],['OK','en','en'],['Merci','en','en'],['English is the course I want to study','fr','en'],['I want to learn for my work','fr','en'],['Je souhaite progresser pour mon travail','en','fr'],['What about the certificate?','fr','en']];
for(const [input,previous,expected]of mixed)test('mixed/short language '+input,()=>assert.equal(detectLanguage(input,previous),expected));
test('language changes persist across engine messages; foreign vocabulary does not switch',async()=>{
 const engine=createConversationEngine({env:{NVA_AI_ENABLED:'true'},catalog:{listPublished:async()=>[course]}});
 let state={mode:'QUESTION_AI',questionAIStartedAt:new Date().toISOString()};
 for(const [text,expected]of [['English please','en'],['OK','en'],['certificate','en'],['Répondez en français','fr'],['Mon niveau est beginner','fr'],['English','en']]){
  const result=await engine.handleMessage({text,state,messageId:randomUUID()});assert.equal(result.state.preferredLanguage,expected);assert.equal(result.deferredQuestionAI,true);state=result.state;
 }
});
test('deployment review artifacts force V3 flags off without assuming live PM2 names',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const candidate=require('../deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs');
 for(const app of candidate.apps){assert.equal(app.env_production.NVA_FOLLOWUPS_ENABLED,'false');assert.equal(app.env_production.NVA_FOLLOWUPS_DRY_RUN,'true');assert.equal(app.env_production.NVA_AI_ENABLED,'false');}
 const source=fs.readFileSync(path.resolve(__dirname,'../deploy/whatsapp-chatbot/operator-functions.sh'),'utf8');
 assert.match(source,/NVA_FOLLOWUPS_ENABLED:'false'/);assert.match(source,/NVA_FOLLOWUPS_DRY_RUN:'true'/);assert.match(source,/process\.env\.NVA_PROCESS/);
});
