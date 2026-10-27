// Grounded conversational replies; no DB driver, tools, identity or logs here.
const {INSTRUCTIONS,detectLanguage,renderPlan,OPENINGS,QUESTIONS}=require('./whatsappAdvisorPolicy');
const {publishedPrice,officialEnglishCourse}=require('./whatsappCommercialPolicy');
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
function buildFacts(courses,sessions,now=new Date()){
 const facts=[];const add=(id,fr,en)=>facts.push({id,fr,en});
 add('clarify','Pour quelle formation souhaitez-vous ces informations ?','Which course would you like information about?');
 if(courses.length&&courses.every(c=>c.trainingMode==='ONLINE'))add('online','Ces formations NVA sont 100 % en ligne.','These NVA courses are entirely online.');
 add('payment_methods','Les moyens de paiement doivent être confirmés par un conseiller NVA ; aucun paiement n’est effectué dans ce chat.','Please confirm payment methods with an NVA adviser; this chat does not process payments.');
 add('status','Une demande reste en attente de vérification e-mail et de décision administrative. Le chatbot ne confirme pas une inscription.','A request remains subject to email verification and an administrative decision. The chatbot cannot confirm enrollment.');
 for(const c of courses.slice(0,6)){
  const title=redact(c.title).slice(0,100),prefix='c'+c.id+'_',price=publishedPrice(c,now);
  const general=officialEnglishCourse(c)&&/\b(?:general|général|generale|générale)\b/i.test((c.title||'')+' '+(c.slug||''));
  add(prefix+'course',title+' est une formation publiée au catalogue NVA.',title+' is published in the NVA course catalogue.');
  add(prefix+'price',price?title+' : '+price+(c.structureType==='LEVEL_BASED'?' par niveau.':'.'):'Le tarif actuel de '+title+' n’est pas publié. Un conseiller peut le vérifier.',price?title+': '+price+(c.structureType==='LEVEL_BASED'?' per level.':'.'):'The current price for '+title+' is not published. Please ask an adviser.');
  if(general){
   add(prefix+'duration','Pour l’anglais général : 3 niveaux, 16 séances de 90 minutes par niveau (48 séances au total).','General English: 3 levels, 16 sessions of 90 minutes per level (48 sessions in total).');
   if(price==='60 USD'){
    add(prefix+'total','L’anglais général coûte 60 USD par niveau, soit 180 USD pour les trois niveaux.','General English costs USD 60 per level, USD 180 for all three levels.');
    if(c.accessPolicy==='LEGACY_STAGED'){
     add(prefix+'trial','Les 5 séances d’essai gratuites sont incluses dans les 16 séances du niveau 1 ; elles ne s’ajoutent pas au programme.','The 5 free trial sessions are included in the 16 sessions of level 1, not added to them.');
     add(prefix+'payment','Pour l’anglais général : au moins 30 USD pour poursuivre à partir de la 6e séance, puis le solde de 30 USD avant la fin du niveau.','For General English: pay at least USD 30 to continue from session 6, then the remaining USD 30 before the end of the level.');
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
   const times=slots.filter(g=>/^\d{2}:\d{2}$/.test(g.startTime||'')&&/^\d{2}:\d{2}$/.test(g.endTime||''))
    .map(g=>(g.weekDays||[]).filter(d=>/^[A-Za-zÀ-ÿ]{2,12}$/.test(d)).join(', ')+' '+g.startTime+'–'+g.endTime).join('; ');
   const details=title+' — '+date.toISOString().slice(0,10)+(s.levelNumber?' — '+s.levelNumber:'')+(times?' — '+times:'')+' ('+(/^[A-Za-z_\/+-]{1,50}$/.test(s.timezone||'')?s.timezone:'Africa/Kinshasa')+')';
   add(prefix+'session'+s.id,details+'. Disponibilité à revérifier lors de l’inscription.',details+'. Availability must be checked again during registration.');
  }
 }
 return facts;
}
function createQuestionAIService({env=process.env,fetchImpl=globalThis.fetch}={}){
 async function answer({question,history=[],facts,reserve,preferredLanguage}){
  const outputLanguage=detectLanguage(question,preferredLanguage);
  const cfg=config(env);if(!cfg||!facts?.length||facts.length>80||Buffer.byteLength(JSON.stringify(facts))>24000)return null;
  // One committed reservation per attempt, including timeout/failure. No retries.
  if(!await reserve(cfg.cap))return null;
  const controller=new AbortController();let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},cfg.timeout);});
  try{return await Promise.race([timeout,(async()=>{
   const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,
    headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:env.OPENAI_MODEL,store:false,max_output_tokens:cfg.tokens,
     instructions:INSTRUCTIONS,
     input:JSON.stringify({preferredLanguage:outputLanguage,question:redact(question),history:history.slice(-6).map(h=>({role:h.role==='assistant'?'assistant':'user',content:redact(h.content).slice(0,600)})),facts,dialogue:{openings:OPENINGS,questions:QUESTIONS}}),
     text:{format:{type:'json_schema',name:'nva_commercial_plan',strict:true,schema:{type:'object',additionalProperties:false,properties:{language:{type:'string',enum:['fr','en']},opening:{type:'string',enum:Object.keys(OPENINGS)},followUp:{type:'string',enum:Object.keys(QUESTIONS)},factIds:{type:'array',items:{type:'string',enum:facts.map(f=>f.id)},maxItems:3}},required:['language','factIds','opening','followUp']}}}})});
   if(!response.ok)return null;const payload=await response.json();if(payload.status!=='completed')return null;
   const text=(payload.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
   const result=JSON.parse(text);if(!['fr','en'].includes(result.language)||!Array.isArray(result.factIds)||result.factIds.length>3)return null;
   if(result.factIds.some(id=>!facts.some(f=>f.id===id)))return null;
   const selected=[...new Set(result.factIds)].map(id=>facts.find(f=>f.id===id));
   // Legacy prose/extra properties never reach the prospect. If the plan cannot
   // be validated, fall back exclusively to its verified official fact IDs.
   const keys=Object.keys(result),validPlan=keys.length===4&&keys.every(k=>['language','factIds','opening','followUp'].includes(k));
   const rendered=validPlan?renderPlan(result,selected,outputLanguage,history):null;
   return rendered||renderPlan({opening:'none',followUp:'none'},selected,outputLanguage,history);
  })()]);}catch{return null;}finally{clearTimeout(timer);}
 }
 return {answer};
}
module.exports={createQuestionAIService,buildFacts,redact,fallback,config};
