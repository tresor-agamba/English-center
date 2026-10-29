const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const journey=require('../src/services/whatsappAdmissionJourney');
const {createAdmissionService,recordConfirmed}=require('../src/services/whatsappAdmissionService');
const registration=require('../src/services/registrationService');
const course={id:11,title:'Anglais général',slug:'anglais-general',shortDescription:'Pratique et interactif en ligne',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',durationValue:8,durationUnit:'WEEK',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,isPublished:true,lmsStatus:'PUBLISHED',archivedAt:null,closedAt:null};
const group={id:31,name:'Matin',capacity:10,isActive:true,isFull:false,weekDays:['Friday','Saturday'],startTime:'10:00',endTime:'11:30',_count:{enrollments:0}};
const session={id:10,name:'Prochaine session',course,levelNumber:1,status:'OPEN',startDate:new Date('2100-01-01'),registrationDeadline:new Date('2099-12-30'),capacity:10,registrationGroups:[group],_count:{enrollments:0}};
function engine({courses=[course],enabled=true,admissionContent={}}={}){const catalog={listPublished:async()=>courses},reg={listCoursesForPublicRegistration:async()=>courses.map(c=>({...c,session}))};return createConversationEngine({admissions:journey.createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:enabled,admissionContent})}},catalog,registration:reg}),catalog,registration:reg,whatsappConfig:()=>({})});}
async function input(e,text,state){if(!state&&!/^(bonjour|bonsoir|salut|hello|hi|menu|accueil|👋)/i.test(text))state={welcomeSentAt:"2026-10-28T00:00:00Z",processedMessageIds:["existing"]};return e.handleMessage({text,state,phoneNumber:'+243812345678',messageId:randomUUID()});}
async function click(e,r,id){const wire=r.state.admission.options.find(o=>o.id===id)?.wireId;assert.ok(wire,'Missing option '+id);return e.handleMessage({text:'',interactionId:wire,state:JSON.parse(JSON.stringify(r.state)),phoneNumber:'+243812345678',messageId:randomUUID()});}
async function collect(e){let r=await input(e,'bonjour');r=await click(e,r,'registration');r=await click(e,r,'admin');r=await click(e,r,'accept');r=await input(e,'Marie Kalala',r.state);r=await click(e,r,'phone-confirm');r=await input(e,'marie@example.test',r.state);r=await click(e,r,'level-BEGINNER');r=await click(e,r,'course-11');r=await click(e,r,'session-10');r=await click(e,r,'group-31');return r;}

test('greetings reuse the exact official menu on first and repeated contacts',async()=>{
 const e=engine({admissionContent:{welcome:'Bienvenue dans notre académie.'}});
 const official=await input(e,'Menu');
 const englishOfficial=await input(e,'Hello');
 const done=await input(e,'annuler',official.state);
 for(const state of [undefined,official.state,done.state]){
  for(const text of ['Bonjour','Salut','Hello','Bonjour !','Hello NVA','Menu']){
   const r=await input(e,text,state);
   const expected=state ? await input(e,text,official.state) : text==='Hello'?englishOfficial:official;
   assert.equal(r.text,expected.text);
   assert.equal(r.interactive.body.text,expected.interactive.body.text);
   assert.deepEqual(r.state.admission.options.map(o=>[o.id,o.label]),official.state.admission.options.map(o=>[o.id,o.label]));
   assert.deepEqual(r.actions,[]);
   const duplicate=await e.handleMessage({text,state:r.state,messageId:r.state.processedMessageIds.at(-1)});
   assert.equal(duplicate.duplicate,true);assert.equal(duplicate.text,null);assert.deepEqual(duplicate.actions,[]);
  }
 }
});

test('unrecognized first contact reuses menu without swallowing existing topic or conversation',async()=>{
 const e=engine(),official=await input(e,'menu');
 const first=await input(e,'👋');assert.equal(first.text,official.text);assert.equal(first.interactive.body.text,official.interactive.body.text);
 assert.equal((await input(e,'tarifs')).state.admission.step,'FREE');
 const returning=await input(e,'message incompris',{processedMessageIds:['previous'],lastIntent:'CATALOG'});
 assert.notEqual(returning.text,official.text);
});
test('welcome has two stable button actions and unique anti-replay tokens',async()=>{const e=engine();for(const word of ['bonjour','bonsoir','salut','hello','menu','accueil']){const r=await input(e,word);assert.equal(r.interactive.type,'button');assert.equal(r.state.admission.options.length,2);assert.match(r.text,/formation en ligne|online training academy/);assert.match(r.text,/New Vision Academy/);}const a=await input(e,'menu'),b=await input(e,'menu');assert.deepEqual(a.state.admission.options.map(o=>o.id),b.state.admission.options.map(o=>o.id));assert.notEqual(a.state.admission.options[0].wireId,b.state.admission.options[0].wireId);});
test('catalog uses real descriptions and contextual commercial buttons',async()=>{const e=engine();const r=await input(e,'formations');assert.match(r.text,/Anglais général/);assert.match(r.text,/Pratique et interactif/);assert.deepEqual(r.state.admission.options.map(o=>o.id),['trial','price','schedule']);const price=await click(e,r,'price');assert.match(price.text,/60 USD/);assert.equal(price.state.admission.step,'FREE');assert.notEqual((await input(e,'oui')).state.admission?.step,'METHOD');});
test('English prices follow the official commercial rules',async()=>{const r=await input(engine(),'tarifs');for(const value of ['60 USD','180 USD','20 USD','200 USD'])assert.ok(r.text.includes(value));assert.equal(r.state.admission.step,'FREE');});

test('days are French and only official available slots are offered',async()=>{const r=await input(engine(),'horaires');assert.match(r.text,/vendredi et samedi/);assert.match(r.text,/10:00 – 11:30/);assert.doesNotMatch(r.text,/Friday|Saturday|16:00|18:00/);});
test('welcome remains unique per catalog and never promises a disallowed trial',async()=>{const e=engine({courses:[{...course,accessPolicy:'FULL_PAYMENT'}]});const r=await input(e,'bonjour');assert.equal(r.text,(await input(e,'menu')).text);assert.doesNotMatch(r.text,/5 séances/);});

test('online registration points to the exact HTTPS application route',async()=>{const e=engine();let r=await input(e,'inscription');r=await input(e,'oui',r.state);assert.deepEqual(r.state.admission.options.map(o=>o.id),['online','admin','menu']);r=await click(e,r,'online');assert.match(r.text,/https:\/\/www.newvisionacademy.org\/register/);});
test('collection requires consent, validates fields and records nothing before final confirmation',async()=>{const e=engine();let r=await collect(e);assert.equal(r.state.admission.step,'REVIEW');assert.deepEqual(r.actions,[]);const done=await click(e,r,'confirm');assert.equal(done.actions[0].type,'ADMISSION_REQUEST');assert.equal(done.actions[0].data.phoneNumber,'+243812345678');assert.equal(done.actions[0].consentVersion,'admissions-v1');assert.deepEqual(done.state.admission.draft,{});});
test('invalid identity rejected; greetings during collection do not repeat promotion; email agent is not handoff',async()=>{const e=engine();let r=await collect(e);r=await click(e,r,'modify');r=await click(e,r,'edit-name');r=await input(e,'bonjour',r.state);assert.equal(r.state.admission.step,'NAME');assert.doesNotMatch(r.text,/OFFRE|5 séances|Bienvenue/);r=await input(e,'Marie Kalala',r.state);r=await click(e,r,'phone-confirm');r=await input(e,'invalid',r.state);assert.equal(r.state.admission.step,'EMAIL');r=await input(e,'agent@example.test',r.state);assert.equal(r.state.admission.step,'LEVEL');assert.equal(r.state.automationPaused,false);});
test('abandon, menu, stale clicks, duplicate messages, handoff and STOP preserve safety',async()=>{const e=engine();const review=await collect(e);const cancelled=await input(e,'annuler',review.state);assert.deepEqual(cancelled.state.admission.draft,{});assert.deepEqual(cancelled.actions,[]);const stop=await input(e,'STOP',review.state);assert.equal(stop.actions[0].type,'OPT_OUT');assert.equal(stop.state.admission,null);const handoff=await input(e,'conseiller',review.state);assert.equal(handoff.actions[0].type,'HUMAN_HANDOFF');assert.equal((await input(e,'bonjour',handoff.state)).text,null);const duplicate=await e.handleMessage({text:'bonjour',state:review.state,messageId:review.state.processedMessageIds.at(-1)});assert.equal(duplicate.duplicate,true);});
test('content cannot hardcode a contradictory price, schedule or trial count',()=>{assert.doesNotThrow(()=>journey.validateContent(journey.DEFAULTS));for(const patch of [{price:'Tarif : 60 USD'},{schedule:'Friday 10:00'},{promotion:'5 séances gratuites'}])assert.throws(()=>journey.validateContent({...journey.DEFAULTS,...patch}),{statusCode:400});});
function copy(v){if(v==null||typeof v!=='object'||typeof v.toFixed==='function')return v;if(v instanceof Date)return new Date(v);if(Array.isArray(v))return v.map(copy);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)]));}
function database(){
 let state={users:[{id:1,role:'ADMIN',isActive:true,mustChangePassword:false}],requests:[],events:[],enrollments:[],notifications:[],failEvent:false};let queue=Promise.resolve();
 const match=(r,w)=>Object.entries(w).every(([k,v])=>v instanceof Date?+r[k]===+v:v?.in?v.in.includes(r[k]):r[k]===v);
 const db={whatsAppConversation:{updateMany:async()=>({count:0})},whatsAppProspectFollowUp:{updateMany:async()=>({count:0})},user:{findUnique:async({where})=>structuredClone(state.users.find(u=>match(u,where))||null),findMany:async({where})=>structuredClone(state.users.filter(u=>match(u,where))),create:async({data})=>{const r={id:state.users.length+1,...data};state.users.push(r);return {...r}},update:async({where,data})=>{const u=state.users.find(u=>match(u,where));Object.assign(u,Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined)));return {...u}}},
 trainingSession:{findUnique:async()=>structuredClone({...session,_count:{enrollments:state.enrollments.length},registrationGroups:[{...group,_count:{enrollments:state.enrollments.length}}]})},
 enrollment:{findUnique:async({where})=>copy(state.enrollments.find(e=>e.userId===where.userId_trainingSessionId.userId&&e.trainingSessionId===where.userId_trainingSessionId.trainingSessionId)||null),create:async({data})=>{const e={id:state.enrollments.length+1,...data};state.enrollments.push(e);return {...e}}},
 whatsAppAdmissionRequest:{findUnique:async({where})=>structuredClone(state.requests.find(r=>match(r,where))||null),findFirst:async({where})=>structuredClone(state.requests.find(r=>match(r,where))||null),create:async({data})=>{const r={id:state.requests.length+1,status:'PENDING',updatedAt:new Date(),...data};state.requests.push(r);return {...r}},update:async({where,data})=>{const r=state.requests.find(r=>match(r,where));Object.assign(r,data);return {...r}},updateMany:async({where,data})=>{const r=state.requests.find(r=>match(r,where));if(!r)return {count:0};Object.assign(r,data);return {count:1}}},
 whatsAppAdmissionEvent:{findFirst:async({where})=>state.events.slice().reverse().find(e=>e.requestId===where.requestId&&e.action===where.action)||null,create:async({data})=>{if(state.failEvent)throw Error('synthetic rollback');state.events.push(data);return data}},notification:{upsert:async({where,create})=>{let n=state.notifications.find(n=>n.deduplicationKey===where.deduplicationKey);if(!n){n=create;state.notifications.push(n);}return n;}}
 };
 db.$transaction=work=>{const task=queue.then(async()=>{const snapshot=copy(state);try{return await work(db)}catch(e){state=snapshot;throw e}});queue=task.catch(()=>{});return task};
 return {db,state:()=>state};
}
const data={fullName:'Marie Kalala',phoneNumber:'+243812345678',email:'marie@example.test',requestedLevel:'BEGINNER'};
const conversion={...data,sessionId:'10',groupId:'31',academicLevel:'LEVEL_1',confirm:'on',passwordHash:'synthetic-hash'};
async function confirmed(d){return recordConfirmed(d.db,{conversationId:7,data,sourceMessageId:'wamid.confirm',consentVersion:'admissions-v1'});}
// Unit fixtures explicitly represent an already verified mailbox; SQL tests exercise the challenge.
function service(d){for(const row of d.state().requests)if(!d.state().events.some(e=>e.requestId===row.id&&e.action==='EMAIL_VERIFIED'))d.state().events.push({requestId:row.id,action:'EMAIL_VERIFIED',createdAt:new Date(),metadata:{binding:require('../src/services/whatsappAdmissionVerification').binding(row)}});return createAdmissionService({database:d.db,business:{...registration,completeRegistrationSideEffects:async()=>{}}});}
test('confirmed request creates one internal notification per admin and deduplicates retries',async()=>{const d=database();await confirmed(d);await confirmed(d);assert.equal(d.state().requests.length,1);assert.equal(d.state().events.length,1);assert.equal(d.state().notifications.length,1);assert.equal(d.state().enrollments.length,0);});
test('unverified mailbox cannot create a WhatsApp student account',async()=>{const d=database();await confirmed(d);const unverified=createAdmissionService({database:d.db,business:registration});await assert.rejects(unverified.convert(1,1,conversion),{statusCode:409});assert.equal(d.state().users.length,1);assert.equal(d.state().enrollments.length,0);});
test('refusal requires a reason and only the assigned administrator can change the request',async()=>{const d=database();await confirmed(d);await assert.rejects(service(d).update(1,1,{action:'cancel'}),{statusCode:400});await service(d).update(1,1,{action:'claim'});d.state().users.push({id:4,role:'ADMIN',isActive:true,mustChangePassword:false});await assert.rejects(service(d).update(1,4,{action:'cancel',reason:'Non autorisé'}),{statusCode:409});assert.equal(d.state().requests[0].status,'PROCESSING');});
test('actual shared registration business converts transactionally and repeated/concurrent submits enroll once',async()=>{const d=database(),row=await confirmed(d);const results=await Promise.all([service(d).convert(row.id,1,conversion),service(d).convert(row.id,1,conversion)]);assert.equal(d.state().enrollments.length,1);assert.equal(d.state().users.length,2);assert.equal(d.state().requests[0].status,'ENROLLED');assert.equal(d.state().requests[0].convertedById,1);assert.equal(d.state().enrollments[0].status,'TRIAL_ACTIVE');assert.equal(d.state().enrollments[0].expectedTotalAmount.toString(),'60');assert.equal(results.filter(r=>r.already).length,1);assert.ok(d.state().requests[0].confirmationDraft);});
test('failed enrollment audit rolls back student, enrollment and request status together',async()=>{const d=database();await confirmed(d);d.state().failEvent=true;await assert.rejects(service(d).convert(1,1,conversion),/synthetic rollback/);assert.equal(d.state().enrollments.length,0);assert.equal(d.state().users.length,1);assert.equal(d.state().requests[0].status,'PENDING');});
test('conversion refuses unconfirmed operations, unauthorized actors, duplicate emails and closed sessions',async()=>{const d=database();await confirmed(d);await assert.rejects(service(d).convert(1,1,{...conversion,confirm:''}),{statusCode:400});await assert.rejects(service(d).convert(1,99,conversion),{statusCode:403});d.state().users.push({id:3,email:data.email,phoneNumber:'+243899999999',role:'STUDENT',isActive:true});await assert.rejects(service(d).convert(1,1,conversion),{code:'EMAIL_EXISTS'});assert.equal(d.state().requests[0].status,'PENDING');});
test('existing student is associated without a second account',async()=>{const d=database();d.state().users.push({id:2,...data,firstName:'Marie',lastName:'Kalala',role:'STUDENT',isActive:true});await confirmed(d);const r=await service(d).convert(1,1,conversion);assert.equal(r.accountCreated,false);assert.equal(d.state().users.length,2);assert.equal(d.state().enrollments.length,1);});


test('closed sessions and unavailable groups keep the request pending',async()=>{
 for(const mutate of [s=>s.status='CLOSED',s=>s.registrationGroups[0].isActive=false,s=>s.capacity=0]){
 const d=database();await confirmed(d);const original=d.db.trainingSession.findUnique;d.db.trainingSession.findUnique=async arg=>{const s=await original(arg);mutate(s);return s;};
 await assert.rejects(service(d).convert(1,1,conversion));assert.equal(d.state().enrollments.length,0);assert.equal(d.state().requests[0].status,'PENDING');
 }
});
test('inactive existing students and unsupported account phone formats do not create accounts',async()=>{
 const d=database();d.state().users.push({id:2,phoneNumber:data.phoneNumber,email:data.email,role:'STUDENT',isActive:false});await confirmed(d);
 await assert.rejects(service(d).convert(1,1,conversion),{code:'STUDENT_UNAVAILABLE'});assert.equal(d.state().enrollments.length,0);
 await assert.rejects(service(d).convert(1,1,{...conversion,phoneNumber:'+15555550123'}),{statusCode:400});
});
test('existing enrollment is reused across separate confirmed requests without a second enrollment',async()=>{
 const d=database();await confirmed(d);await service(d).convert(1,1,conversion);
 await recordConfirmed(d.db,{conversationId:7,data,sourceMessageId:'wamid.confirm-again',consentVersion:'admissions-v1'});
 const read=d.db.trainingSession.findUnique;d.db.trainingSession.findUnique=async arg=>{const s=await read(arg);s.capacity=1;s.registrationGroups[0].capacity=1;return s;};
 const result=await service(d).convert(2,1,conversion);assert.equal(result.reused,true);assert.equal(d.state().enrollments.length,1);assert.equal(d.state().requests[1].status,'ENROLLED');
});
test('human resume preserves the interrupted confirmed-data review and requires a fresh confirmation',async()=>{
 const e=engine();let r=await collect(e);const paused=await input(e,'conseiller',r.state);const resumed=await input(e,'reprendre bot',paused.state);assert.equal(resumed.state.automationPaused,false);assert.equal(resumed.state.admission.step,'REVIEW');r=await click(e,resumed,'confirm');assert.equal(r.actions[0].type,'ADMISSION_REQUEST');
});
test('declining collection never asks personal data and old menu clicks are rejected',async()=>{
 const e=engine();let r=await input(e,'inscription');r=await click(e,r,'admin');const old=r.state.admission.options[0].wireId;r=await click(e,r,'cancel');assert.deepEqual(r.state.admission.draft,{});assert.deepEqual(r.actions,[]);const stale=await e.handleMessage({interactionId:old,state:r.state});assert.match(stale.text,/expiré/);assert.deepEqual(stale.actions,[]);
});


test('existing custom scenarios and their unchanged IDs remain usable after the admissions journey',async()=>{
 const {createScenarioService}=require('../src/services/whatsappScenarioService');const option=randomUUID();
 const row={id:randomUUID(),revision:1,enabled:true,triggers:['personnalise'],definition:{entry:'start',nodes:[{id:'start',type:'button',body:'Scénario existant',options:[{id:option,label:'Continuer',action:{type:'GOTO',nodeId:'end'}}]},{id:'end',type:'text',body:'Réponse existante',next:{type:'END'}}]}};
 const database={whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})},whatsAppScenario:{findMany:async()=>[row]}};
 const catalog={listPublished:async()=>[]},reg={listCoursesForPublicRegistration:async()=>[]};const e=createConversationEngine({catalog,registration:reg,admissions:journey.createAdmissionJourney({database,catalog,registration:reg}),scenarios:createScenarioService({database})});
 const done={admission:{step:'DONE',draft:{},options:[],expiresAt:'2100-01-01'}};const start=await input(e,'personnalise',done);assert.equal(start.intent,'SCENARIO');const id=start.interactive.action.buttons[0].reply.id;
 const result=await e.handleMessage({interactionId:id,state:start.state});assert.equal(result.text,'Réponse existante');assert.equal(row.definition.nodes[0].options[0].id,option);
});

test('certification answer is conditional and does not claim external recognition',async()=>{const r=await input(engine(),'Votre certificat est-il international ?');assert.ok(r.text.includes('New Vision Academy'));assert.ok(r.text.includes('trois niveaux'));assert.ok(r.text.includes('Aucune reconnaissance internationale'));assert.ok(r.interactive.body.text.length<=1024);});

test('certification conditions remain visible in long catalog interactive and numeric fallback',async()=>{const r=await input(engine({courses:[{...course,title:'Anglais '.repeat(80),shortDescription:'Cours '.repeat(120)}]}),'formations');assert.match(r.interactive.body.text,/conditions de certification définies par l’académie/);assert.match(r.text,/Répondez par numéro/);assert.ok(r.interactive.body.text.length<=1024);assert.throws(()=>journey.validateContent({...journey.DEFAULTS,certificationNotice:'x'.repeat(261)}),{statusCode:400});});

test('certification and duration questions receive both answers',async()=>{const r=await input(engine(),'Le certificat et la duree ?');assert.ok(r.text.includes('48'));assert.ok(r.text.includes('72'));assert.ok(r.text.includes('conditions administratives'));});

test('mandatory complete-training rule survives saved custom content and long catalogs',async()=>{
 const e=engine({courses:[{...course,title:'Anglais '.repeat(80),shortDescription:'Cours '.repeat(120)}],admissionContent:{catalog:'Présentation personnalisée',certificationNotice:'Selon les conditions de l’académie.'}});
 const r=await input(e,'formations');assert.match(r.interactive.body.text,/Niveau 1 → Niveau 2 → Niveau 3/);assert.match(r.interactive.body.text,/48 séances/);assert.match(r.interactive.body.text,/Aucun certificat à la fin d’un seul niveau/);assert.match(r.interactive.body.text,/Selon les conditions de l’académie/);assert.ok(r.interactive.body.text.length<=1024);assert.deepEqual(r.actions,[]);
});

test('payment balance is required before the end of the level',async()=>{const r=await input(engine(),'Je peux payer la moitie ?');assert.ok(r.text.includes('30 USD'));assert.ok(r.text.includes('AVANT la fin des 16'));assert.deepEqual(r.actions,[]);});

test('confirmed session preference is validated and preserved in the admission audit',async()=>{
 const d=database();d.db.course={findUnique:async()=>course};
 await recordConfirmed(d.db,{conversationId:7,data:{...data,courseId:11,requestedSessionId:10},sourceMessageId:'wamid.preference',consentVersion:'admissions-v1'});
 assert.equal(d.state().events[0].metadata.requestedSessionId,10);assert.equal(d.state().events[0].metadata.courseId,11);
 assert.equal(d.state().requests[0].status,'PENDING');assert.equal(d.state().enrollments.length,0);
 const blocked=database();blocked.db.course={findUnique:async()=>course};blocked.db.trainingSession.findUnique=async()=>({...session,status:'CLOSED'});
 await assert.rejects(recordConfirmed(blocked.db,{conversationId:7,data:{...data,courseId:11,requestedSessionId:10},sourceMessageId:'wamid.closed',consentVersion:'admissions-v1'}));
 assert.equal(blocked.state().requests.length,0);
});
