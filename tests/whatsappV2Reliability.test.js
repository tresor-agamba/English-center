const test=require('node:test'),assert=require('node:assert/strict');
const {harness,collect,course,baseSession}=require('./helpers/nvaV2ValidationHarness');
const {detectIntents,analyzeMessage,THRESHOLD}=require('../src/services/whatsappCommercialIntents');
const certificate=require('../src/services/certificateService');
test('refusal priority stops enrollment prompts and allows an explicit later restart',async()=>{
 for(const refusal of ['Non merci','Pas maintenant','Je vais réfléchir','Cela ne m’intéresse pas','Je ne veux pas m’inscrire','Je préfère attendre','Je ne choisis pas la deuxième option']){
  const h=harness();await h.send('inscription');let r=await h.send(refusal);assert.equal(r.state.admission.step,'DONE',refusal);assert.ok(r.state.admission.declined);assert.deepEqual(r.actions,[]);assert.ok(!r.state.admission.options.some(o=>o.id==='registration'));
  await h.send('xyz sujet inconnu');r=await h.send('tarifs');assert.ok(!r.state.admission.options.some(o=>o.id==='registration'));r=await h.send('Je veux m’inscrire maintenant');assert.equal(r.state.admission.step,'METHOD');assert.equal(r.state.admission.declined,false);
 }
});
test('ordinal choices are contextual and negations always win',async()=>{
 for(const text of ['Le second choix','La seconde, avec votre aide','Choisissons la deuxième']){const h=harness();await h.send('inscription');assert.equal((await h.send(text)).state.admission.step,'CONSENT');}
 assert.deepEqual(detectIntents('Le second choix'),['UNKNOWN']);
 assert.deepEqual(detectIntents('Je ne veux pas la première',{registrationMethod:true}),['REFUSAL']);
});
test('product resolution uses real prices, asks clarification and keeps course context',async()=>{
 const computing={...course,id:13,title:'Informatique',slug:'informatique',price:90,certificateFee:12};
 const h=harness({courses:[course,computing]});let r=await h.send('Quel est le prix de la formation informatique ?');assert.match(r.text,/90 USD/);assert.doesNotMatch(r.text,/60 USD/);
 r=await h.send('Combien coûte le certificat ?');assert.match(r.text,/12 USD/);assert.doesNotMatch(r.text,/20 USD|200 USD/);
 r=await h.send('Quelle est la durée ?');assert.doesNotMatch(r.text,/72 heures/);
 const h2=harness({courses:[course,computing]});r=await h2.send('Quels sont les tarifs ?');assert.match(r.text,/Pour quelle formation/);r=await h2.send('Informatique');assert.match(r.text,/90 USD/);
 r=await h2.send('Quel est le prix de la formation couture ?');assert.match(r.text,/Pour quelle formation/);assert.doesNotMatch(r.text,/60 USD|90 USD/);
});
test('unpublished prices and foreign product certificate fees are never invented',async()=>{
 const c={...course,id:13,title:'Informatique',slug:'informatique',price:null,certificateFee:null};const h=harness({courses:[c]});
 let r=await h.send('Quel est le prix ?');assert.match(r.text,/n’est pas publié/);assert.doesNotMatch(r.text,/60 USD/);
 r=await h.send('Quel est le coût du certificat ?');assert.match(r.text,/ne sont pas publiés/);assert.doesNotMatch(r.text,/20 USD/);
});
test('English trial offer respects FULL_PAYMENT at welcome and during questions',async()=>{
 const h=harness({courses:[{...course,accessPolicy:'FULL_PAYMENT'}]});let r=await h.send('bonjour');assert.doesNotMatch(r.text,/5 séances/);r=await h.send('Je veux essayer gratuitement');assert.doesNotMatch(r.text,/premières séances.*gratuites/);assert.match(r.text,/ne permettent pas/);
 const other=harness({courses:[{...course,id:13,title:'Informatique',slug:'informatique',accessPolicy:'LEGACY_STAGED'}]});r=await other.send('Je veux un essai');assert.doesNotMatch(r.text,/premières séances.*gratuites/);
});
test('pricing plus registration and certificate questions preserve all requested answers',async()=>{
 const h=harness();let r=await h.send('Quel est le prix et je veux m’inscrire ?');assert.match(r.text,/60 USD/);assert.equal(r.state.admission.step,'METHOD');
 r=await h.send('Quel est le coût du certificat et les horaires ?');assert.match(r.text,/20 USD/);assert.match(r.text,/16:00/);
});
test('identity values are not classified as questions and genuine questions preserve drafts',async()=>{
 const h=harness();await h.send('inscription');await h.click('admin');await h.click('accept');let r=await h.send('Jean International');assert.equal(r.state.admission.step,'PHONE');assert.equal(r.state.admission.draft.fullName,'Jean International');
 r=await h.send('Le certificat est-il international ?');assert.match(r.text,/Aucune reconnaissance/);assert.equal(r.state.admission.step,'PHONE');
});
test('low confidence and absent topics ask clarification without side effects',async()=>{
 const a=analyzeMessage('Quel choix alors ?');assert.equal(a.needsClarification,true);assert.ok(a.confidence<THRESHOLD);
 const h=harness();await h.send('menu');const r=await h.send('xyz sujet indéterminé');assert.deepEqual(r.actions,[]);assert.match(r.text,/reformuler/);
});
test('certification requires three distinct completed levels of the same student and course',async()=>{
 const enrollment={id:1,userId:51,status:'CONFIRMED',trainingSession:{...baseSession,status:'COMPLETED',courseId:12,course:{...course,modules:[{lessons:[{id:71}]}]}},lessonProgress:[{lessonId:71}]};
 let levels=[1];const client={enrollment:{findUnique:async()=>enrollment,findMany:async args=>{assert.equal(args.where.userId,51);assert.equal(args.where.trainingSession.courseId,12);assert.equal(args.where.status,'CONFIRMED');return levels.map(levelNumber=>({trainingSession:{levelNumber},lessonProgress:[{lessonId:71}]}));}}};
 assert.equal((await certificate.academicEligibility(1,client)).valid,false);levels=[1,2];assert.equal((await certificate.academicEligibility(1,client)).valid,false);levels=[1,2,2];assert.equal((await certificate.academicEligibility(1,client)).valid,false);levels=[1,2,3];assert.equal((await certificate.academicEligibility(1,client)).valid,true);
 enrollment.userId=null;assert.equal((await certificate.academicEligibility(1,client)).valid,false);
});
test('a simple non-English course keeps its own certification completion rule',async()=>{
 const c={enrollment:{findUnique:async()=>({status:'CONFIRMED',trainingSession:{status:'COMPLETED',course:{title:'Informatique',numberOfLevels:null,modules:[]}},lessonProgress:[]})}};assert.equal((await certificate.academicEligibility(1,c)).valid,true);
});
test('exact product titles outrank shared language tokens and schedules follow the selected product',async()=>{
 const second={...course,id:13,title:'Anglais juridique',slug:'anglais-juridique',price:95};const h=harness({courses:[course,second],sessions:[baseSession,{...baseSession,id:23,course:second,startTime:'18:00',endTime:'19:30'}]});
 let r=await h.send('Quel est le prix pour Anglais juridique ?');assert.match(r.text,/95 USD/);assert.equal(r.state.selectedCourseId,13);
 r=await h.send('Quels sont les horaires ?');assert.match(r.text,/18:00/);assert.doesNotMatch(r.text,/16:00/);
});
test('declining offers is a refusal, including during collection and after an unknown message',async()=>{
 for(const text of ['Je décline votre proposition d’inscription','Nous déclinons votre offre','Je rejette cette proposition']){
  const h=harness();await h.send('inscription');await h.click('admin');await h.click('accept');const r=await h.send(text);assert.equal(r.state.admission.step,'DONE');assert.deepEqual(r.actions,[]);
 }
});
test('channel polarity excludes a rejected site without rejecting a positively chosen WhatsApp',async()=>{
 for(const text of ['Restons sur WhatsApp pour m’inscrire sans ouvrir de site','Je ne veux pas le site mais je préfère WhatsApp','Je veux WhatsApp et pas le site']){
  const h=harness();await h.send('inscription');const r=await h.send(text);assert.equal(r.state.admission.step,'CONSENT',text);assert.deepEqual(r.actions,[]);
 }
 const h=harness();await h.send('inscription');let r=await h.send('Je préfère le site et pas WhatsApp');assert.match(r.text,/newvisionacademy.org/);r=await h.send('Via le site ou WhatsApp ?');assert.equal(r.state.admission.step,'METHOD');assert.match(r.text,/choisir à votre place/);
});
