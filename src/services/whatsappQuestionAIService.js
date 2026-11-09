const prospect=require('./whatsappProspectInformation');
// Grounded conversational replies; no DB driver or tools. Diagnostics contain metadata only.
const {randomUUID}=require('node:crypto');
const {detectLanguage,OPENINGS,QUESTIONS}=require('./whatsappAdvisorPolicy');
const {publishedPrice,officialEnglishCourse}=require('./whatsappCommercialPolicy');
const {outputSchema,validatePlan,renderVerifiedPlan}=require('./whatsappQuestionAIValidation');
const NATURAL_INSTRUCTIONS=require('./whatsappNaturalAdvisorPolicy').INSTRUCTIONS;
function redact(value){return String(value||'').slice(0,1800)
 .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]')
 .replace(/https?:\/\/\S+/gi,'[link]').replace(/\+?\d[\d ().-]{6,}\d/g,'[contact]')
 .replace(/\b(?:sk-[\w-]+|Bearer\s+\S+)\b/gi,'[secret]')
 .replace(/(?:je m'appelle|mon nom est|my name is)\s+[^,.!?\n]+/gi,'[name]');}
const fallback=(q,preferred)=>detectLanguage(q,preferred)==='en'?'I cannot verify that information right now. Please try again or type “conseiller” to reach NVA.':'Je ne peux pas vérifier cette information actuellement. Réessayez ou écrivez « conseiller » pour joindre NVA.';
function config(env){
 const bounded=(k,d,min,max)=>{const n=Number(env[k]??d);return Number.isInteger(n)&&n>=min&&n<=max?n:null;};
 const options={timeout:bounded('NVA_AI_TIMEOUT_MS',4000,250,10000),tokens:bounded('NVA_AI_MAX_OUTPUT_TOKENS',256,64,1024),cap:bounded('NVA_AI_DAILY_CALL_LIMIT',50,1,1000)};
 return env.NVA_AI_ENABLED==='true'&&env.OPENAI_API_KEY&&/^[\w.-]{1,100}$/.test(env.OPENAI_MODEL||'')&&Object.values(options).every(Boolean)?options:null;
}
function formatWeekDays(days,language='fr'){
 const translations={MONDAY:['lundi','Monday'],TUESDAY:['mardi','Tuesday'],WEDNESDAY:['mercredi','Wednesday'],THURSDAY:['jeudi','Thursday'],FRIDAY:['vendredi','Friday'],SATURDAY:['samedi','Saturday'],SUNDAY:['dimanche','Sunday']};
 const french={LUNDI:'MONDAY',MARDI:'TUESDAY',MERCREDI:'WEDNESDAY',JEUDI:'THURSDAY',VENDREDI:'FRIDAY',SAMEDI:'SATURDAY',DIMANCHE:'SUNDAY'};
 return (Array.isArray(days)?days:[]).map(day=>{
  const key=String(day).trim().toUpperCase(),entry=translations[french[key]||key];
  return entry?entry[language==='en'?1:0]:null;
 }).filter(Boolean).join(', ');
}
function buildFacts(courses,sessions,now=new Date()){
 const facts=[];const add=(id,fr,en)=>facts.push({id,fr,en});
 add('clarify','Pour quelle formation souhaitez-vous ces informations ?','Which course would you like information about?');
 add('website','Site officiel NVA : https://www.newvisionacademy.org','Official NVA website: https://www.newvisionacademy.org');
 if(courses.length&&courses.every(c=>c.trainingMode==='ONLINE'))add('online','Ces formations NVA sont 100 % en ligne.','These NVA courses are entirely online.');
 add('payment_methods','Les moyens de paiement doivent être confirmés par un conseiller NVA ; aucun paiement n’est effectué dans ce chat.','Please confirm payment methods with an NVA adviser; this chat does not process payments.');
 add('status','Une demande reste en attente de vérification e-mail et de décision administrative. Le chatbot ne confirme pas une inscription.','A request remains subject to email verification and an administrative decision. The chatbot cannot confirm enrollment.');
 for(const c of courses.slice(0,6)){
  const title=redact(c.title).slice(0,100),prefix='c'+c.id+'_',price=publishedPrice(c,now);
  const general=officialEnglishCourse(c)&&/\b(?:general|général|generale|générale)\b/i.test((c.title||'')+' '+(c.slug||''));
  add(prefix+'course',general?prospect.TRAINING:title+' est une formation NVA en ligne avec des exercices pratiques.',title+' is published in the NVA course catalogue.');
  add(prefix+'price',price?title+' : '+price+(c.structureType==='LEVEL_BASED'?' par niveau.':'.'):'Le tarif actuel de '+title+' n’est pas publié. Un conseiller peut le vérifier.',price?title+': '+price+(c.structureType==='LEVEL_BASED'?' per level.':'.'):'The current price for '+title+' is not published. Please ask an adviser.');
  if(general){
   add(prefix+'duration','Pour l’anglais général : 3 niveaux, 16 séances de 90 minutes par niveau (48 séances au total).','General English: 3 levels, 16 sessions of 90 minutes per level (48 sessions in total).');
   add(prefix+'frequency','L’anglais général prévoit 2 séances par semaine.','General English has 2 sessions per week.');
   add(prefix+'weeks','À raison de 2 séances par semaine, un niveau d’anglais général dure normalement 8 semaines ; les trois niveaux représentent environ 24 semaines (environ 6 mois) si les sessions se suivent sans interruption. Ces durées sont indicatives.','At 2 sessions per week, a General English level normally takes 8 weeks; all three levels take about 24 weeks (about 6 months) if sessions run consecutively without interruption. These durations are indicative.');
   add(prefix+'usual_schedule',prospect.USUAL_SCHEDULE,prospect.USUAL_SCHEDULE_EN);
   if(price==='60 USD'){
    add(prefix+'total',prospect.PRICING,'General English costs USD 60 per level, USD 180 for all three levels.');
    if(c.accessPolicy==='LEGACY_STAGED'){
     add(prefix+'trial',prospect.FREE_TRIAL,'The 5 free trial sessions are included in the 16 sessions of level 1, not added to them.');
     add(prefix+'payment',prospect.PAYMENT_TERMS,'For General English: pay at least USD 30 to continue from session 6, then the remaining USD 30 before the end of the level.');
    }
    const fee=c.certificateFee==null?20:Number(c.certificateFee);
    if(Number.isFinite(fee)&&fee>=0)add(prefix+'certificate_fee',`Le certificat NVA coûte ${fee} USD supplémentaires après les trois niveaux ; total avec formation : ${180+fee} USD.`,`The NVA certificate costs an additional USD ${fee} after all three levels; total including tuition: USD ${180+fee}.`);
   }
   add(prefix+'certificate','Le certificat est délivré par NVA après les trois niveaux, sous réserve des conditions administratives. Aucune reconnaissance internationale ou équivalence externe n’est attestée ici.','NVA issues its certificate after all three levels, subject to its administrative conditions. No international recognition or external equivalence is established here.');
  }else add(prefix+'conditions','Les conditions d’essai, de paiement et de certification de '+title+' doivent être confirmées par NVA ; celles de l’anglais général ne s’y appliquent pas automatiquement.','NVA must confirm trial, payment and certification conditions for '+title+'; General English terms do not automatically apply.');
  const available=sessions.filter(s=>s.course?.id===c.id).slice(0,3);
  if(!available.length)add(prefix+'sessions','Aucune session ouverte confirmée pour '+title+' dans les informations consultées.','No confirmed open session for '+title+' is available in the current information.');
  for(const s of available){
   const date=new Date(s.startDate);if(!Number.isFinite(+date))continue;
   const groups=(s.registrationGroups||[]).filter(g=>g.isActive&&!g.isFull).slice(0,4);
   const slots=groups.length?groups:!s.registrationGroups?.length?[s]:[];
   const validSlots=slots.filter(g=>/^\d{2}:\d{2}$/.test(g.startTime||'')&&/^\d{2}:\d{2}$/.test(g.endTime||''));
   const times=language=>validSlots.map(g=>{
    const days=formatWeekDays(g.weekDays,language);
    return (days?days+' : ':'')+g.startTime+'–'+g.endTime;
   }).join('; ');
   const timezone=/^[A-Za-z_\/+-]{1,50}$/.test(s.timezone||'')?s.timezone:'Africa/Kinshasa';
   const base=title+' — '+date.toISOString().slice(0,10)+(s.levelNumber?' — '+s.levelNumber:'');
   const details=language=>base+(times(language)?' — '+times(language):'')+' ('+timezone+')';
   add(prefix+'session'+s.id,details('fr')+'. Disponibilité à revérifier lors de l’inscription.',details('en')+'. Availability must be checked again during registration.');
  }
 }
 return facts;
}
function createQuestionAIService({env=process.env,fetchImpl=globalThis.fetch,observe=(event,data)=>require('./loggerService').info(event,data)}={}){
 async function answer({question,history=[],facts,reserve,preferredLanguage}){
  const attemptId=randomUUID();
  let called=false,responded=false,finished=false;
  const emit=(reason)=>{if(finished)return;try{observe('NVA_AI_RESULT',{attemptId,reason,called,responded});}catch{} };
  const reject=reason=>{emit(reason);finished=true;return null;};
  const outputLanguage=detectLanguage(question,preferredLanguage);
  const cfg=config(env);if(!cfg)return reject('CONFIG_INVALID');
  if(!facts?.length)return reject('INELIGIBLE');
  if(facts.length>80||Buffer.byteLength(JSON.stringify(facts))>24000)return reject('FACTS_TOO_LARGE');
  // One committed reservation per attempt, including timeout/failure. No retries.
  try{if(!await reserve(cfg.cap))return reject('BUDGET_DENIED');}catch{return reject('BUDGET_ERROR');}
  const controller=new AbortController();let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(reject('TIMEOUT'));},cfg.timeout);});
  try{return await Promise.race([timeout,(async()=>{
   called=true;
   try{observe('NVA_AI_REQUEST',{attemptId,called:true});}catch{}
   let response;try{response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,
    headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:env.OPENAI_MODEL,store:false,max_output_tokens:cfg.tokens,
     instructions:NATURAL_INSTRUCTIONS,
     input:JSON.stringify({preferredLanguage:outputLanguage,question:redact(question),history:history.slice(-6).map(h=>({role:h.role==='assistant'?'assistant':'user',content:redact(h.content).slice(0,600)})),facts,dialogueCatalogue:{openings:OPENINGS,followUps:QUESTIONS}}),
     text:{format:{type:'json_schema',name:'nva_advisor_plan',strict:true,schema:outputSchema(facts)}}})});}catch{return reject(controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR');}
   responded=true;if(finished)return null;
   try{observe('NVA_AI_RESPONSE',{attemptId,responded:true,httpStatus:Number.isInteger(response.status)?response.status:undefined});}catch{}
   if(!response.ok)return reject('HTTP_ERROR');
   let payload;try{payload=await response.json();}catch{return reject('JSON_INVALID');}
   if(!payload||typeof payload!=='object')return reject('RESPONSE_INVALID');
   if(payload.status!=='completed')return reject(payload.status==='incomplete'?'RESPONSE_INCOMPLETE':'RESPONSE_INVALID');
   if(!Array.isArray(payload.output)||payload.output.some(x=>!x||typeof x!=='object'||(x.type==='message'&&(!Array.isArray(x.content)||x.content.some(c=>!c||typeof c!=='object'||(c.type==='output_text'&&typeof c.text!=='string'))))))return reject('RESPONSE_INVALID');
   if(payload.output.some(x=>x.type==='message'&&Array.isArray(x.content)&&x.content.some(c=>c.type==='refusal')))return reject('RESPONSE_REFUSED');
   const text=payload.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
   let result;try{result=JSON.parse(text);}catch{return reject('JSON_INVALID');}
   if(!result||typeof result!=='object'||Array.isArray(result))return reject('JSON_INVALID');
   const invalid=validatePlan(result,facts,outputLanguage);
   if(invalid)return reject(invalid);
   const approved=renderVerifiedPlan(result,facts,outputLanguage,history);
   if(!approved)return reject('INELIGIBLE');
   emit('ACCEPTED_FACT_PLAN');finished=true;
   return approved;
  })()]);}catch{return reject(controller.signal.aborted?'TIMEOUT':'RESPONSE_INVALID');}finally{clearTimeout(timer);}
 }
 return {answer};
}
module.exports={createQuestionAIService,buildFacts,redact,fallback,config};
