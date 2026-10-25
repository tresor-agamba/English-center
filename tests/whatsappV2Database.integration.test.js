// Explicit, empty, local laboratory ONLY. No dotenv, migration, reset or transport.
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{randomUUID}=require('node:crypto');
const enabled=process.env.NVA_V2_DATABASE_TESTS_ENABLED==='true';
test('NVA V2 real PostgreSQL integration', {skip:enabled?false:'BLOCKED: explicit attested PostgreSQL laboratory not supplied'},async t=>{
 const raw=process.env.NVA_V2_DATABASE_TEST_URL,expectedDir=process.env.NVA_V2_DATABASE_EXPECTED_DIRECTORY;
 assert.ok(raw&&expectedDir,'Explicit laboratory URL and directory are required');
 const url=new URL(raw);assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');
 assert.match(url.pathname,/^\/(?:nva_whatsapp_v2_test|nva_v2_database_test_[a-z0-9_]+)$/);assert.ok(Number(url.port)>=1024&&Number(url.port)!==5432);
 assert.ok(!url.search,'Connection overrides are forbidden');
 const directory=path.resolve(expectedDir),allowed=path.resolve(__dirname,'../output');
 assert.ok(directory.startsWith(allowed+path.sep),'Laboratory cluster must be inside workspace output');
 // Remove inherited credentials before any application module is imported.
 for(const key of Object.keys(process.env))if(/DATABASE_URL|^WHATSAPP_|^META_|^SMTP_|^MAIL_|^OPENAI_/i.test(key))delete process.env[key];
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:raw,WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',META_WHATSAPP_INBOX_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false'});
 global.fetch=async()=>{throw Error('EXTERNAL_TRANSPORT_FORBIDDEN');};
 const prisma=require('../src/utils/prisma');t.after(()=>prisma.$disconnect());
 const [identity]=await prisma.$queryRaw`SELECT current_database() AS db,inet_server_port() AS port,host(inet_server_addr()) AS host,public.nva_v2_test_cluster_directory() AS directory`;
 assert.equal(identity.db,url.pathname.slice(1));assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,Number(url.port));assert.equal(path.resolve(identity.directory).toLowerCase(),directory.toLowerCase());
 const models=['user','course','trainingSession','registrationGroup','enrollment','whatsAppAdmissionRequest','whatsAppConversation','whatsAppAdmissionEvent','whatsAppChatbotSettings','notification'];
 const counts=async()=>Promise.all(models.map(model=>prisma[model].count()));
 assert.deepEqual(await counts(),models.map(()=>0),'A pristine laboratory is required; do not clean an existing database to bypass this guard');
 const catalog=require('../src/services/publicCourseService'),registration=require('../src/services/registrationService');
 const admissions=require('../src/services/whatsappAdmissionService');
 const rollback=async fn=>{const marker=Error('ROLLBACK_OWN_TEST_FIXTURES');try{await prisma.$transaction(async tx=>{await fn(tx);throw marker;},{isolationLevel:'Serializable',timeout:30000});assert.fail('Transaction unexpectedly committed');}catch(e){if(e!==marker)throw e;}assert.deepEqual(await counts(),models.map(()=>0));};
 async function fixture(tx){
  const course=await tx.course.create({data:{title:'Anglais pratique',slug:'nva-db-'+randomUUID(),shortDescription:'Cours en direct',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',durationValue:8,durationUnit:'WEEKS',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,isPublished:true,lmsStatus:'PUBLISHED',certificateFee:20}});
  const session=await tx.trainingSession.create({data:{courseId:course.id,name:'Niveau 1 du laboratoire',levelNumber:1,startDate:new Date('2099-01-01'),endDate:new Date('2099-04-01'),registrationDeadline:new Date('2098-12-31'),capacity:5,status:'OPEN',weekDays:['Friday','Saturday'],startTime:'10:00',endTime:'11:30'}});
  const group=await tx.registrationGroup.create({data:{trainingSessionId:session.id,name:'Matin',capacity:5,weekDays:['Friday','Saturday'],startTime:'10:00',endTime:'11:30'}});
  const admin=await tx.user.create({data:{firstName:'Laboratoire',lastName:'Admin',phoneNumber:'+243890001001',role:'ADMIN',passwordHash:await require('../src/services/passwordService').hashPassword(randomUUID()+'Aa!7'),mustChangePassword:false}});
  return {course,session,group,admin};
 }
 await t.test('catalog and application services agree on active products, prices and open sessions',()=>rollback(async tx=>{
  const f=await fixture(tx);
  const other=await tx.course.create({data:{...Object.fromEntries(Object.entries(f.course).filter(([k])=>!['id','createdAt','updatedAt'].includes(k))),title:'Informatique',slug:'db-computing-'+randomUUID(),price:90,certificateFee:12}});
  await tx.course.create({data:{title:'Inactive',slug:'db-inactive-'+randomUUID(),isPublished:false}});
  const rows=await catalog.listPublished(tx);assert.deepEqual(new Set(rows.map(x=>x.id)),new Set([f.course.id,other.id]));
  assert.equal(Number(rows.find(c=>c.id===other.id).price),90);assert.equal(Number(rows.find(c=>c.id===other.id).certificateFee),12);
  const open=await registration.listSessionsForPublicRegistration(tx);assert.equal(open.length,1);assert.equal(open[0].id,f.session.id);assert.equal(open[0].remainingPlaces,5);assert.equal(open[0].registrationGroups[0].startTime,'10:00');
  for(const change of [{status:'CANCELLED'},{status:'OPEN',capacity:0},{capacity:5,registrationDeadline:new Date('2000-01-01')}]){await tx.trainingSession.update({where:{id:f.session.id},data:change});assert.equal((await registration.listSessionsForPublicRegistration(tx)).length,0);}
 }));
 await t.test('free-text journey, consent, pending request, preferences, duplicate message and admin SQL reads',()=>rollback(async tx=>{
  const f=await fixture(tx);await tx.whatsAppChatbotSettings.create({data:{id:1,enabled:true,admissionsEnabled:true}});
  const conv=await tx.whatsAppConversation.create({data:{phoneNumber:'+243890001003'}});
  const engine=require('../src/services/whatsappConversationEngine').createConversationEngine({catalog:{listPublished:()=>catalog.listPublished(tx)},registration:{listCoursesForPublicRegistration:()=>registration.listCoursesForPublicRegistration(tx)},admissions:require('../src/services/whatsappAdmissionJourney').createAdmissionJourney({database:tx,catalog:{listPublished:()=>catalog.listPublished(tx)},registration:{listSessionsForPublicRegistration:()=>registration.listSessionsForPublicRegistration(tx),listCoursesForPublicRegistration:()=>registration.listCoursesForPublicRegistration(tx)}}),whatsappConfig:()=>({})});
  let state,n=0;async function send(text,id){const r=await engine.handleMessage({text,interactionId:id,state,phoneNumber:conv.phoneNumber,messageId:'db-msg-'+(++n)});state=r.state;return r;}
  async function click(id){const option=state.admission.options.find(o=>o.id===id);assert.ok(option,id);return send('',option.wireId);}
  await send('inscription');await click('admin');await click('accept');await send('Alice Mukendi');await click('phone-confirm');await send('not-an-email');assert.equal(state.admission.step,'EMAIL');await send('alice@example.test');await click('level-BEGINNER');await click('course-'+f.course.id);await click('session-'+f.session.id);await click('group-'+f.group.id);
  assert.equal(await tx.whatsAppAdmissionRequest.count(),0);const result=await click('confirm');const input={...result.actions[0],conversationId:conv.id,sourceMessageId:'db-confirm'};
  const request=await admissions.recordConfirmed(tx,input);assert.equal(request.status,'PENDING');assert.ok(request.consentAt);assert.equal((await admissions.recordConfirmed(tx,input)).id,request.id);assert.equal(await tx.whatsAppAdmissionRequest.count(),1);assert.equal(await tx.enrollment.count(),0);
  const service=admissions.createAdmissionService({database:tx});assert.equal((await service.list()).rows[0].id,request.id);const detail=await service.get(request.id);assert.equal(detail.events[0].metadata.requestedSessionId,f.session.id);assert.equal(detail.events[0].metadata.requestedGroupId,f.group.id);
 }));
 await t.test('existing student enrollment uses shared business rules without creating a second account',()=>rollback(async tx=>{
  const f=await fixture(tx);const user=await tx.user.create({data:{firstName:'Alice',lastName:'Mukendi',phoneNumber:'+243890001003',email:'alice@example.test',role:'STUDENT',passwordHash:'synthetic-test-fixture'}});
  const input={sessionId:f.session.id,groupId:String(f.group.id),firstName:'Alice',lastName:'Mukendi',phoneNumber:user.phoneNumber,email:user.email,requestedLevel:'LEVEL_1',allowExistingUser:true,reuseExistingEnrollment:true};
  const a=await registration.createRegistrationInTransaction(tx,input);const b=await registration.createRegistrationInTransaction(tx,input);assert.equal(a.user.id,user.id);assert.equal(b.enrollment.id,a.enrollment.id);assert.equal(await tx.user.count(),2);assert.equal(await tx.enrollment.count(),1);assert.equal(Number((await tx.enrollment.findUnique({where:{id:a.enrollment.id}})).expectedTotalAmount),60);
 }));
 await t.test('all synthetic fixture changes are rolled back, including a forced business failure',()=>rollback(async tx=>{await fixture(tx);await assert.rejects(registration.createRegistrationInTransaction(tx,{sessionId:2147483647}),e=>e.code==='SESSION_NOT_FOUND');}));
 await t.test('database actually enforces admission source message uniqueness',async()=>{
  await assert.rejects(prisma.$transaction(async tx=>{await fixture(tx);const conv=await tx.whatsAppConversation.create({data:{phoneNumber:'+243890001003'}});const data={conversationId:conv.id,fullName:'Alice Mukendi',phoneNumber:conv.phoneNumber,email:'alice@example.test',requestedLevel:'BEGINNER',status:'CANCELLED',sourceMessageId:'db-unique'};await tx.whatsAppAdmissionRequest.create({data});await tx.whatsAppAdmissionRequest.create({data});throw Error('UNIQUE_CONSTRAINT_MISSING');}),e=>e.code==='P2002');assert.deepEqual(await counts(),models.map(()=>0));
 });
 await t.test('partial unique index prevents two open requests with different source messages',async()=>{
  await assert.rejects(prisma.$transaction(async tx=>{await fixture(tx);const conv=await tx.whatsAppConversation.create({data:{phoneNumber:'+243890001003'}});const data={conversationId:conv.id,fullName:'Alice Mukendi',phoneNumber:conv.phoneNumber,email:'alice@example.test',requestedLevel:'BEGINNER'};await tx.whatsAppAdmissionRequest.create({data:{...data,sourceMessageId:'db-first'}});await tx.whatsAppAdmissionRequest.create({data:{...data,sourceMessageId:'db-second'}});throw Error('PARTIAL_UNIQUE_INDEX_MISSING');}),e=>e.code==='P2002');assert.deepEqual(await counts(),models.map(()=>0));
 });
});
