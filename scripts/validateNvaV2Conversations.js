// Diagnostic expectations: a nonzero exit means functional NO-GO cases remain.
const fs=require('node:fs');
const {harness,collect,course,baseSession}=require('../tests/helpers/nvaV2ValidationHarness');
const checks=[];
async function scenario(id,description,run){try{const result=await run();checks.push({id,description,...result});}catch(e){checks.push({id,description,pass:false,error:e.message});}}
async function main(){
 await scenario('CTX01','Reformulation courte de durée après les tarifs anglais',async()=>{const h=harness();await h.send('tarifs');const r=await h.send('Et ça dure combien de temps ?');return {pass:/72 heures/.test(r.text),response:r.text};});
 await scenario('CTX02','Choix de la deuxième méthode avec une expression naturelle',async()=>{const h=harness();await h.send('inscription');const r=await h.send('Je choisis le second');return {pass:r.state.admission.step==='CONSENT',step:r.state.admission.step,response:r.text};});
 await scenario('CTX03','Question sur une autre formation ne doit pas recevoir le prix anglais',async()=>{const computing={...course,id:13,title:'Informatique',slug:'informatique',price:90};const h=harness({courses:[course,computing]});const r=await h.send('Quel est le prix de la formation informatique ?');return {pass:!r.text.includes('60 USD'),response:r.text};});
 await scenario('CTX04','Refus explicite de la deuxième option ne doit pas la sélectionner',async()=>{const h=harness();await h.send('inscription');const r=await h.send('Je ne choisis pas la deuxième option');return {pass:r.state.admission.step!=='CONSENT',step:r.state.admission.step,response:r.text};});
 await scenario('CTX05','Question prix et demande d’inscription doivent recevoir deux réponses',async()=>{const h=harness();const r=await h.send('Quel est le prix et je veux m’inscrire ?');return {pass:r.text.includes('60 USD')&&r.state.admission.step==='METHOD',response:r.text};});
 await scenario('CTX06','Un nom contenant International doit rester une donnée d’identité',async()=>{const h=harness();await h.send('inscription');await h.click('admin');await h.click('accept');const r=await h.send('Jean International');return {pass:r.state.admission.step==='PHONE',step:r.state.admission.step,response:r.text};});
 await scenario('CTX07','La pause humaine conserve les données puis permet une reprise explicite',async()=>{const h=harness();await collect(h);const draft=JSON.stringify(h.state.admission.draft);await h.send('un conseiller');const silent=await h.send('bonjour');await h.send('reprendre bot');return {pass:silent.text===null&&JSON.stringify(h.state.admission.draft)===draft,step:h.state.admission.step};});
 await scenario('CTX08','Un groupe devenu complet est refusé dès la confirmation conversationnelle',async()=>{const group={id:32,name:'Soir',isActive:true,isFull:false,capacity:5,weekDays:['Friday','Saturday'],startTime:'16:00',endTime:'17:30',_count:{enrollments:0}};
  const session={...baseSession,registrationGroups:[group]};const h=harness({sessions:[session]});await collect(h);await h.click('course-12');await h.click('session-22');await h.click('group-32');group._count.enrollments=5;group.isFull=true;const r=await h.click('confirm');return {pass:!r.actions.some(a=>a.type==='ADMISSION_REQUEST'),actions:r.actions.map(a=>a.type),response:r.text};});
 await scenario('BUS01','Une politique sans essai ne doit pas recevoir une promesse de cinq séances gratuites',async()=>{const h=harness({courses:[{...course,accessPolicy:'FULL_PAYMENT'}]});const r=await h.send('Je veux essayer gratuitement');return {pass:!r.text.includes('cinq premières séances'),response:r.text};});
 await scenario('BUS02','La seule fin du niveau un ne doit pas suffire à l’éligibilité académique du certificat complet',async()=>{
  const client={enrollment:{findUnique:async()=>({id:1,status:'CONFIRMED',trainingSession:{id:1,status:'COMPLETED',levelNumber:1,courseId:12,course:{numberOfLevels:3,modules:[{lessons:[{id:1}]}]}},lessonProgress:[{lessonId:1}]})}};
  const eligibility=await require('../src/services/certificateService').academicEligibility(1,client);return {pass:eligibility.valid===false,eligibility,note:'Test du service avec une inscription simulée de niveau 1 ; aucune émission de certificat.'};
 });
 const result={total:checks.length,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,checks};
 fs.writeFileSync(process.argv[2]||'output/nva-v2-conversation-diagnostics.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
