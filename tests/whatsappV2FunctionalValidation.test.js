const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,collect,db,course,baseSession}=require('./helpers/nvaV2ValidationHarness');
const {recordConfirmed,createAdmissionService}=require('../src/services/whatsappAdmissionService');
test('interested prospect: complete collection, real service pending request, consent and deduplication',async()=>{
 const h=harness();await h.send('Bonjour');await h.send('formations');await h.click('trial');assert.match(h.transcript.at(-1).text,/incluses.*16/);
 await collect(h);await h.click('course-12');await h.click('session-22');assert.equal(h.state.admission.step,'REVIEW');assert.match(h.transcript.at(-1).text,/2100/);
 const d=db();assert.equal(d.rows.length,0);const r=await h.send('je confirme');assert.equal(r.actions.length,1);const action=r.actions[0];
 assert.equal(action.type,'ADMISSION_REQUEST');const input={...action,conversationId:3,sourceMessageId:'validation-final'};
 await recordConfirmed(d.tx,input);await recordConfirmed(d.tx,input);
 assert.equal(d.rows.length,1);assert.equal(d.rows[0].status,'PENDING');assert.ok(d.rows[0].consentAt);assert.equal(d.events.length,1);assert.equal(d.events[0].metadata.requestedSessionId,22);assert.equal(d.notifications.length,1);
 const result=await createAdmissionService({database:d.tx}).list();assert.equal(result.rows[0].id,1);
 assert.doesNotMatch(r.text,/inscription (est )?confirmée|vous êtes inscrit/i);
 const replay=await h.engine.handleMessage({state:h.state,messageId:h.state.processedMessageIds.at(-1)});assert.equal(replay.duplicate,true);assert.deepEqual(replay.actions,[]);
 fs.writeFileSync('output/nva-v2-interested-transcript.json',JSON.stringify(h.transcript,null,2));
});
test('hesitant prospect and multiple questions receive exact commercial facts',async()=>{
 const h=harness();await h.send('Menu');await h.click('question');
 const topics=[['Quel est le prix ?',/60 USD.*180 USD.*20 USD.*200 USD/s],['Ça dure combien de temps ?',/16 séances de 1 h 30.*24 heures.*48 séances.*72 heures/s],['Je veux un essai gratuit',/incluses.*16.*11/s],['Je peux payer la moitié ?',/30 USD.*AVANT la fin des 16/s],['Le certificat est international ?',/après.*trois niveaux.*Aucune reconnaissance internationale/s]];
 for(const [text,expected]of topics){const r=await h.send(text);assert.match(r.text,expected);assert.deepEqual(r.actions,[]);}
 const r=await h.send('Je voudrais les tarifs et la date de début');assert.match(r.text,/60 USD/);assert.match(r.text,/2100/);
 await h.send('Je suis hésitant, je dois réfléchir');assert.ok(h.state.admission);assert.deepEqual(h.transcript.at(-1).actions,[]);
});
test('topic change during identity collection preserves draft and asks the next field',async()=>{
 const h=harness();await h.send('inscription');await h.click('admin');await h.click('accept');await h.send('Alice Mukendi');
 const r=await h.send('Combien coûte le certificat ?');assert.match(r.text,/20 USD/);assert.equal(h.state.admission.step,'PHONE');assert.equal(h.state.admission.draft.fullName,'Alice Mukendi');
 await h.click('phone-confirm');await h.send('adresse invalide');assert.equal(h.state.admission.step,'EMAIL');assert.deepEqual(h.transcript.at(-1).actions,[]);await h.send('alice@example.test');assert.equal(h.state.admission.step,'LEVEL');
});
test('switching registration methods in both directions remains usable',async()=>{
 const h=harness();await h.send('inscription');await h.send('Je préfère votre site');await h.click('admin');await h.click('accept');await h.send('Alice Mukendi');
 await h.send('Je vais m’inscrire sur le site');assert.deepEqual(h.state.admission.draft,{});const r=await h.send('Je préfère WhatsApp');assert.equal(r.state.admission.step,'CONSENT');assert.deepEqual(r.actions,[]);
});
test('abandon then restart, interruption then resume, and expired consent',async()=>{
 const h=harness();await collect(h);await h.send('annuler');assert.deepEqual(h.state.admission.draft,{});await h.send('inscription');assert.equal(h.state.admission.step,'METHOD');
 await h.click('admin');await h.click('accept');await h.send('Alice Mukendi');const snapshot=JSON.stringify(h.state);h.setState(JSON.parse(snapshot));h.advance(3600000);await h.click('phone-confirm');assert.equal(h.state.admission.step,'EMAIL');
 h.advance(86400000);const r=await h.send('alice@example.test');assert.notEqual(h.state.admission?.step,'LEVEL');assert.deepEqual(r.actions,[]);
});
test('advisor pause, explicit resume and STOP do not race the bot',async()=>{
 const h=harness();await collect(h);const draft=structuredClone(h.state.admission.draft);const r=await h.send('Je veux un conseiller');assert.equal(r.actions[0].type,'HUMAN_HANDOFF');assert.equal((await h.send('tarifs')).text,null);
 await h.send('reprendre bot');assert.deepEqual(h.state.admission.draft,draft);await h.send('STOP');assert.equal((await h.send('inscription')).text,null);
});
test('session service excludes closed, full, expired and unpublished fixtures',async()=>{
 const invalid=[{...baseSession,id:23,status:'CLOSED'},{...baseSession,id:24,capacity:0},{...baseSession,id:25,registrationDeadline:new Date('2000-01-01')},{...baseSession,id:26,course:{...course,isPublished:false}}];
 const h=harness({sessions:[baseSession,...invalid]});await collect(h);await h.click('course-12');assert.deepEqual(h.state.admission.options.map(x=>x.id),['session-22']);
 h.sessions[0]={...baseSession,status:'CLOSED'};const r=await h.click('session-22');assert.match(r.text,/plus disponible/);assert.deepEqual(r.actions,[]);
});
test('long course titles remain valid on menus with two or three options',async()=>{
 const courses=[{...course,title:'Anglais professionnel avancé'},{...course,id:13,title:'Conversation professionnelle'}];const h=harness({courses});await collect(h);assert.equal(h.state.admission.step,'COURSE');assert.ok(h.transcript.at(-1).text.includes('formation'));assert.equal(h.state.admission.options.length,2);
});
test('ambiguous replies at course, session and group selections preserve the consented draft',async()=>{
 const h=harness();await collect(h);let r=await h.send('je ne sais pas lequel');assert.equal(r.state.admission.step,'COURSE');assert.equal(r.state.admission.draft.fullName,'Alice Mukendi');
 await h.click('course-12');r=await h.send('je ne sais pas laquelle');assert.equal(r.state.admission.step,'SESSION');assert.deepEqual(r.actions,[]);
});
test('actual inbox worker processes a full consented request with mocked Cloud API transport',async()=>{
 const {setup}=require('./helpers/metaInboxWorkerValidationHarness');const s=setup();
 s.catalog.listPublished=async()=>[course];s.registration.listSessionsForPublicRegistration=async()=>[baseSession];s.registration.listCoursesForPublicRegistration=async()=>[{...course,session:baseSession}];
 s.seed('course',course);s.seed('trainingSession',baseSession);s.seed('user',{id:99,role:'ADMIN',isActive:true});
 const create=s.db.whatsAppAdmissionRequest.create;s.db.whatsAppAdmissionRequest.create=input=>create({...input,data:{status:'PENDING',...input.data}});
 const w=s.makeWorker();const turns=[];
 async function send(text,extra){await s.receive(text,extra);const result=await w.runOnce();assert.equal(result.processed,1);const conv=s.rows('whatsAppConversation')[0];turns.push({step:conv.engineState.admission?.step,sent:s.sent.at(-1)});return conv;}
 async function click(id){const conv=s.rows('whatsAppConversation')[0];const option=conv.engineState.admission.options.find(o=>o.id===id);assert.ok(option,'worker choice '+id);return send('',{type:'interactive',interactive:{button_reply:{id:option.wireId,title:'Untrusted label'}}});}
 await send('bonjour');await click('registration');await click('admin');await click('accept');await send('Alice Mukendi');await click('phone-confirm');await send('alice@example.test');await click('level-BEGINNER');await click('course-12');await click('session-22');assert.equal(s.rows('whatsAppAdmissionRequest').length,0);
 await click('confirm');assert.equal(s.rows('whatsAppAdmissionRequest').length,1);assert.equal(s.rows('whatsAppAdmissionEvent').length,1);assert.equal(s.rows('enrollment').length,0);assert.equal(s.rows('whatsAppAdmissionRequest')[0].status,'PENDING');assert.match(s.sent.at(-1).interactive.body.text,/en attente de validation administrative/);
 const count=s.sent.length;await s.receive('',s.last());await w.runOnce();assert.equal(s.sent.length,count);assert.equal(s.rows('whatsAppAdmissionRequest').length,1);
 assert.doesNotMatch(JSON.stringify(s.logs),/alice@example\.test|Alice Mukendi|synthetic-no-real-token/);
 fs.writeFileSync('output/nva-v2-worker-transcript.json',JSON.stringify(turns,null,2));
});
test('a full selected group is rejected before emitting an admission action',async()=>{
 const group={id:32,name:'Soir',isActive:true,isFull:false,capacity:1,_count:{enrollments:0},weekDays:['Friday','Saturday'],startTime:'16:00',endTime:'17:30'};
 const h=harness({sessions:[{...baseSession,registrationGroups:[group]}]});await collect(h);await h.click('course-12');await h.click('session-22');await h.click('group-32');group._count.enrollments=1;group.isFull=true;const r=await h.click('confirm');assert.equal(r.state.admission.step,'REVIEW');assert.match(r.text,/créneau.*plus disponible/);assert.deepEqual(r.actions,[]);
});
test('list limits, duplicate shortened course titles and Unicode titles are safe',async()=>{
 const courses=Array.from({length:11},(_,i)=>({...course,id:100+i,title:'Anglais professionnel 🎓 '+i}));const h=harness({courses});await collect(h);const r=h.transcript.at(-1);assert.equal(h.state.admission.options.length,10);assert.equal(new Set(h.state.admission.options.map(o=>o.label)).size,10);assert.ok(h.state.admission.options.every(o=>[...o.label].length<=24));assert.deepEqual(r.actions,[]);
});
