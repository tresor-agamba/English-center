const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {randomUUID}=require('node:crypto'),http=require('node:http');
test('NVA V2 administrative circuit on isolated PostgreSQL',{skip:process.env.NVA_V2_DATABASE_TESTS_ENABLED!=='true'},async t=>{
 const raw=process.env.NVA_V2_DATABASE_TEST_URL,expected=process.env.NVA_V2_DATABASE_EXPECTED_DIRECTORY;
 const url=new URL(raw);assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'58432');assert.equal(url.pathname,'/nva_whatsapp_v2_test');assert.equal(url.search,'');assert.equal(url.hash,'');
 assert.equal(path.resolve(expected).toLowerCase(),path.resolve(__dirname,'../output/nva-whatsapp-v2-postgres-20261024/cluster').toLowerCase());
 for(const key of Object.keys(process.env))if(/DATABASE_URL|^WHATSAPP_|^META_|^SMTP_|^MAIL_|^OPENAI_/i.test(key))delete process.env[key];
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:raw,WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',META_WHATSAPP_INBOX_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false',CSRF_ENFORCE:'true'});
 global.fetch=async()=>{throw Error('NO_EXTERNAL_NETWORK');};
 const db=require('../src/utils/prisma');t.after(()=>db.$disconnect());
 const [who]=await db.$queryRaw`SELECT current_database() AS db,inet_server_port() AS port,public.nva_v2_test_cluster_directory() AS directory`;
 assert.equal(who.db,'nva_whatsapp_v2_test');assert.equal(who.port,58432);assert.equal(path.resolve(who.directory).toLowerCase(),path.resolve(expected).toLowerCase());
 const models=['user','course','trainingSession','registrationGroup','enrollment','whatsAppConversation','whatsAppAdmissionRequest','whatsAppAdmissionEvent','notification'];
 const counts=()=>Promise.all(models.map(m=>db[m].count()));assert.deepEqual(await counts(),models.map(()=>0));
 const admissions=require('../src/services/whatsappAdmissionService'),registration=require('../src/services/registrationService'),verification=require('../src/services/whatsappAdmissionVerification');
 const passwordHash=await require('../src/services/passwordService').hashPassword(randomUUID()+'Aa!7');
 const service=admissions.createAdmissionService({database:db,business:{...registration,completeRegistrationSideEffects:async()=>{}}});
 let mailbox=[];
 t.mock.method(require('../src/services/emailDeliveryProvider'),'createEmailDeliveryProvider',()=>({send:async m=>{mailbox.push(m);return {accepted:true};}}));
 const verifier=verification.createVerification({database:db});
 const token=()=>mailbox.at(-1).text.match(/unique : ([A-Za-z0-9_-]{43})/)[1];
 let seq=0;
 async function scenario(fn){
  const owned={users:[],courses:[],sessions:[],groups:[],conversations:[],requests:[]};
  const n=++seq,phone='+243890'+String(n).padStart(6,'0');
  try{
   const course=await db.course.create({data:{title:'Anglais laboratoire',slug:'admin-'+randomUUID(),shortDescription:'Formation fictive',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',durationValue:8,durationUnit:'WEEKS',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,isPublished:true,lmsStatus:'PUBLISHED',certificateFee:20}});owned.courses.push(course.id);
   const session=await db.trainingSession.create({data:{courseId:course.id,name:'Session fictive',levelNumber:1,startDate:new Date('2099-01-01'),endDate:new Date('2099-04-01'),registrationDeadline:new Date('2098-12-31'),capacity:2,status:'OPEN',weekDays:['Friday'],startTime:'10:00',endTime:'11:30'}});owned.sessions.push(session.id);
   const group=await db.registrationGroup.create({data:{trainingSessionId:session.id,name:'Matin',capacity:2,weekDays:['Friday'],startTime:'10:00',endTime:'11:30'}});owned.groups.push(group.id);
   async function user(role,offset){const u=await db.user.create({data:{firstName:'Test',lastName:role,phoneNumber:'+243891'+String(n*10+offset).padStart(6,'0'),role,passwordHash,mustChangePassword:false}});owned.users.push(u.id);return u;}
   const admin=await user('ADMIN',1),other=await user('ADMIN',2),student=await user('STUDENT',3);
   const conversation=await db.whatsAppConversation.create({data:{phoneNumber:phone}});owned.conversations.push(conversation.id);
   const data={fullName:'Alice Laboratoire',phoneNumber:phone,email:'alice-'+n+'@example.test',requestedLevel:'BEGINNER',courseId:course.id,requestedSessionId:session.id,requestedGroupId:group.id};
   const row=await db.$transaction(tx=>admissions.recordConfirmed(tx,{conversationId:conversation.id,data,sourceMessageId:'admin-test-'+randomUUID(),consentVersion:'admissions-v1'}));owned.requests.push(row.id);
   const input={...data,confirm:'on',sessionId:String(session.id),groupId:String(group.id),academicLevel:'LEVEL_1',passwordHash};
   await fn({course,session,group,admin,other,student,conversation,row,input,data,owned,async verified(){await verifier.issue(row.id,admin.id);return verifier.verify(row.id,token());}});
  }finally{
   // Delete only identities created by this scenario; never reset or truncate.
   await db.$transaction(async tx=>{
    await tx.notification.deleteMany({where:{userId:{in:owned.users}}});
    await tx.whatsAppAdmissionEvent.deleteMany({where:{requestId:{in:owned.requests}}});
    await tx.whatsAppAdmissionRequest.deleteMany({where:{id:{in:owned.requests}}});
    await tx.whatsAppConversation.deleteMany({where:{id:{in:owned.conversations}}});
    const enrolled=await tx.enrollment.findMany({where:{trainingSessionId:{in:owned.sessions}},select:{userId:true}});
    await tx.enrollment.deleteMany({where:{trainingSessionId:{in:owned.sessions}}});
    await tx.registrationGroup.deleteMany({where:{id:{in:owned.groups}}});
    await tx.trainingSession.deleteMany({where:{id:{in:owned.sessions}}});
    await tx.course.deleteMany({where:{id:{in:owned.courses}}});
    await tx.user.deleteMany({where:{id:{in:[...owned.users,...enrolled.map(e=>e.userId)]}}});
   });
   assert.deepEqual(await counts(),models.map(()=>0));mailbox=[];
  }
 }
 // The real router, controller, Prisma client, authorization middleware, CSRF and EJS.
 const express=require('express'),sessions=require('express-session'),app=express();
 app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../views'));app.use(express.urlencoded({extended:false}));
 const store=new sessions.MemoryStore();app.use(sessions({secret:randomUUID(),resave:false,saveUninitialized:false,store}));
 const validateSession=require('../src/middlewares/validateSession');
 app.post('/test-login',async(req,res)=>{const u=await db.user.findUnique({where:{id:Number(req.body.id)}});req.session.user=validateSession.sessionUser(u);res.sendStatus(200);});
 app.use(validateSession);
 app.use((req,res,next)=>{Object.assign(res.locals,{currentUser:req.authenticatedUser,user:req.authenticatedUser,path:req.path,requestId:'lab',siteSettings:{},notifications:[],unreadNotificationCount:0});next();});
 app.use(require('../src/middlewares/csrfProtection').protect);
 app.get('/test-csrf',(req,res)=>res.json({token:req.session.csrfToken}));
 app.use(require('../src/routes/whatsappAdmissionVerificationRoutes'));
 app.use('/admin/whatsapp',require('../src/routes/adminWhatsAppRoutes'));
 app.use((e,req,res,next)=>res.status(e.statusCode||500).json({error:e.message,code:e.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));t.after(()=>new Promise(r=>store.clear(r)));
 function client(){let cookie='';return {async request(route,method='GET',data){const body=data?new URLSearchParams(data).toString():'';return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:text,headers:res.headers}));});req.on('error',reject);req.end(body);});},async login(id){await this.request('/test-login','POST',{id});return JSON.parse((await this.request('/test-csrf')).body).token;}};}
 await t.test('consented pending request, SQL-backed admin reads, authorization and CSRF',()=>scenario(async f=>{
  assert.equal(f.row.status,'PENDING');assert.ok(f.row.consentAt);assert.equal(await db.enrollment.count(),0);
  const h=client();assert.equal((await h.request('/admin/whatsapp/admissions')).status,302);
  await h.login(f.student.id);assert.equal((await h.request('/admin/whatsapp/admissions')).status,403);
  assert.equal((await h.request('/admin/whatsapp/admissions/'+f.row.id+'/convert','POST',f.input)).status,403);
  await h.login(f.admin.id);assert.equal((await h.request('/admin/whatsapp/admissions/'+f.row.id+'/convert','POST',f.input)).status,403);
  const list=await h.request('/admin/whatsapp/admissions');assert.equal(list.status,200,list.body);assert.match(list.body,/Alice Laboratoire/);assert.match(list.body,/Anglais laboratoire/);assert.match(list.body,/Session fictive/);assert.equal(list.headers['cache-control'],'no-store');
  const detail=await h.request('/admin/whatsapp/admissions/'+f.row.id);assert.equal(detail.status,200,detail.body);
 }));
 await t.test('HTTP email proof then approval creates account and enrollment only after commit',()=>scenario(async f=>{
  const h=client(),csrf=await h.login(f.admin.id),route='/admin/whatsapp/admissions/'+f.row.id;
  const blocked=await h.request(route+'/convert','POST',{...f.input,_csrf:csrf});assert.equal(blocked.status,409,blocked.body);assert.equal(await db.enrollment.count(),0);
  assert.equal((await h.request(route+'/verify-email','POST',{_csrf:csrf})).status,303);
  const prospect=client();const publicPage=await prospect.request('/whatsapp/admission-email');assert.equal(publicPage.status,200,publicPage.body);const pcsrf=JSON.parse((await prospect.request('/test-csrf')).body).token;
  const proof=await prospect.request('/whatsapp/admission-email','POST',{requestId:f.row.id,token:token(),_csrf:pcsrf});assert.equal(proof.status,200,proof.body);
  const result=await h.request(route+'/convert','POST',{...f.input,_csrf:csrf});assert.equal(result.status,200,result.body);assert.match(result.body,/Inscription/);
  assert.doesNotMatch(result.body,/https:\/\/wa\.me\//,'No link may put account credentials into a WhatsApp URL');
  const row=await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id},include:{enrollment:{include:{user:true}},events:true}});
  assert.equal(row.status,'ENROLLED');assert.equal(row.convertedById,f.admin.id);assert.equal(row.enrollment.user.email,f.data.email);assert.equal(row.enrollment.user.mustChangePassword,true);assert.match(row.enrollment.user.passwordHash,/^\$2/);assert.ok(row.events.some(e=>e.action==='ENROLLED'&&e.adminId===f.admin.id));assert.ok(row.confirmationDraft);
  assert.equal((await h.request(route+'/convert','POST',{...f.input,_csrf:csrf})).status,303);assert.equal(await db.enrollment.count(),1);
 }));
 await t.test('email proof is one-use, rejects wrong code and identity changes',()=>scenario(async f=>{
  await verifier.issue(f.row.id,f.admin.id);const code=token();await assert.rejects(verifier.verify(f.row.id,'x'.repeat(43)),{statusCode:400});await verifier.verify(f.row.id,code);await assert.rejects(verifier.verify(f.row.id,code),{statusCode:400});
  await service.update(f.row.id,f.admin.id,{...f.data,action:'edit',email:'changed@example.test'});
  await assert.rejects(service.convert(f.row.id,f.admin.id,{...f.input,email:'changed@example.test'}),{statusCode:409});assert.equal(await db.enrollment.count(),0);
 }));
 await t.test('HTTP rejection and information request retain actor, reason and actual status',()=>scenario(async f=>{
  const h=client(),csrf=await h.login(f.admin.id),route='/admin/whatsapp/admissions/'+f.row.id+'/update';
  assert.equal((await h.request(route,'POST',{action:'request-info',reason:'Confirmez le créneau',_csrf:csrf})).status,303);
  let row=await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id}});assert.equal(row.status,'PROCESSING');assert.match(row.confirmationDraft,/Informations/);
  await assert.rejects(service.update(f.row.id,f.other.id,{action:'cancel',reason:'Autre décision'}),{statusCode:409});
  assert.equal((await h.request(route,'POST',{action:'cancel',reason:'Session incompatible',_csrf:csrf})).status,303);
  row=await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id},include:{events:true}});assert.equal(row.status,'CANCELLED');assert.equal(row.assignedAdminId,f.admin.id);assert.ok(row.events.some(e=>e.action==='CANCELLED'&&e.metadata.reason==='Session incompatible'));assert.equal(await db.enrollment.count(),0);await assert.rejects(service.convert(f.row.id,f.admin.id,f.input),{statusCode:409});
 }));
 await t.test('two concurrent approvals create exactly one enrollment',()=>scenario(async f=>{
  await f.verified();const outcomes=await Promise.all([service.convert(f.row.id,f.admin.id,f.input),service.convert(f.row.id,f.admin.id,f.input)]);assert.equal(outcomes.filter(x=>x.already).length,1);assert.equal(await db.enrollment.count(),1);assert.equal(await db.whatsAppAdmissionEvent.count({where:{requestId:f.row.id,action:'ENROLLED'}}),1);
 }));
 await t.test('concurrent approval versus rejection has exactly one terminal decision',()=>scenario(async f=>{
  await f.verified();const results=await Promise.allSettled([service.convert(f.row.id,f.admin.id,f.input),service.update(f.row.id,f.admin.id,{action:'cancel',reason:'Demande refusée'})]);
  const row=await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id},include:{events:true}});assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.enrollment.count(),row.status==='ENROLLED'?1:0);assert.equal(row.events.filter(e=>['ENROLLED','CANCELLED'].includes(e.action)).length,1);
 }));
 for(const [name,change]of [['cancelled',{status:'CANCELLED'}],['full',{capacity:0}],['expired',{registrationDeadline:new Date('2000-01-01')}]])await t.test(name+' session leaves request pending',()=>scenario(async f=>{
  await f.verified();await db.trainingSession.update({where:{id:f.session.id},data:change});await assert.rejects(service.convert(f.row.id,f.admin.id,f.input));assert.equal(await db.enrollment.count(),0);assert.equal((await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id}})).status,'PENDING');
 }));
 await t.test('account creation failure rolls back all writes',()=>scenario(async f=>{
  await f.verified();const broken=admissions.createAdmissionService({database:db,business:{...registration,createRegistrationInTransaction:(tx,payload)=>registration.createRegistrationInTransaction(tx,{...payload,passwordHash:undefined})}});
  await assert.rejects(broken.convert(f.row.id,f.admin.id,f.input));assert.equal(await db.user.findUnique({where:{phoneNumber:f.data.phoneNumber}}),null);assert.equal(await db.enrollment.count(),0);assert.equal((await db.whatsAppAdmissionRequest.findUnique({where:{id:f.row.id}})).status,'PENDING');
 }));
 await t.test('failure after account and enrollment creation rolls back the entire decision',()=>scenario(async f=>{
  await f.verified();const broken=admissions.createAdmissionService({database:db,business:{...registration,async createRegistrationInTransaction(tx,payload){await registration.createRegistrationInTransaction(tx,payload);throw Error('FORCED_TRANSACTION_FAILURE');}}});
  await assert.rejects(broken.convert(f.row.id,f.admin.id,f.input),/FORCED_TRANSACTION_FAILURE/);assert.equal(await db.user.findUnique({where:{phoneNumber:f.data.phoneNumber}}),null);assert.equal(await db.enrollment.count(),0);assert.equal(await db.whatsAppAdmissionEvent.count({where:{requestId:f.row.id,action:'ENROLLED'}}),0);
 }));
 await t.test('second administrator and inactive administrator cannot convert',()=>scenario(async f=>{
  await f.verified();await service.update(f.row.id,f.admin.id,{action:'claim'});await assert.rejects(service.convert(f.row.id,f.other.id,f.input),{statusCode:409});await db.user.update({where:{id:f.admin.id},data:{isActive:false}});await assert.rejects(service.convert(f.row.id,f.admin.id,f.input),{statusCode:403});assert.equal(await db.enrollment.count(),0);
 }));
 await t.test('verified existing student account is reused without changing its password',()=>scenario(async f=>{
  const user=await db.user.create({data:{firstName:'Alice',lastName:'Laboratoire',phoneNumber:f.data.phoneNumber,email:f.data.email,role:'STUDENT',passwordHash,mustChangePassword:false}});f.owned.users.push(user.id);
  await f.verified();const result=await service.convert(f.row.id,f.admin.id,f.input);assert.equal(result.accountCreated,false);assert.equal(result.user.id,user.id);const unchanged=await db.user.findUnique({where:{id:user.id}});assert.equal(unchanged.passwordHash,passwordHash);assert.equal(unchanged.mustChangePassword,false);assert.equal(await db.enrollment.count(),1);
 }));
 await t.test('email verification never overwrites a different existing account email',()=>scenario(async f=>{
  const user=await db.user.create({data:{firstName:'Autre',lastName:'Étudiant',phoneNumber:f.data.phoneNumber,email:'owner@example.test',role:'STUDENT',passwordHash}});f.owned.users.push(user.id);
  await f.verified();await assert.rejects(service.convert(f.row.id,f.admin.id,f.input),{statusCode:409});assert.equal((await db.user.findUnique({where:{id:user.id}})).email,'owner@example.test');assert.equal(await db.enrollment.count(),0);
 }));
 await t.test('real session validation revokes stale, inactive and password-change admin sessions',()=>scenario(async f=>{
  const h=client();await h.login(f.admin.id);await db.user.update({where:{id:f.admin.id},data:{authVersion:{increment:1}}});assert.equal((await h.request('/admin/whatsapp/admissions')).headers.location,'/login');
  await h.login(f.admin.id);await db.user.update({where:{id:f.admin.id},data:{mustChangePassword:true}});assert.equal((await h.request('/admin/whatsapp/admissions')).headers.location,'/change-password');
  await db.user.update({where:{id:f.admin.id},data:{isActive:false}});assert.equal((await h.request('/admin/whatsapp/admissions')).headers.location,'/login');
 }));
 await t.test('expired code and email delivery failure cannot authorize account creation',()=>scenario(async f=>{
  const expired=verification.createVerification({database:db,now:()=>new Date(Date.now()-3600000)});await expired.issue(f.row.id,f.admin.id);await assert.rejects(verifier.verify(f.row.id,token()),{statusCode:400});
  const failed=verification.createVerification({database:db,now:()=>new Date(Date.now()+61000),delivery:()=>({send:async m=>{mailbox.push(m);throw Error('SMTP synthetic failure');}})});await assert.rejects(failed.issue(f.row.id,f.admin.id),{statusCode:503});await assert.rejects(verifier.verify(f.row.id,token()),{statusCode:400});await assert.rejects(service.convert(f.row.id,f.admin.id,f.input),{statusCode:409});assert.equal(await db.enrollment.count(),0);
 }));
 await t.test('two prospects racing for the final place cannot exceed capacity',()=>scenario(async f=>{
  await f.verified();await db.trainingSession.update({where:{id:f.session.id},data:{capacity:1}});await db.registrationGroup.update({where:{id:f.group.id},data:{capacity:1}});
  const conversation=await db.whatsAppConversation.create({data:{phoneNumber:'+243899999998'}});f.owned.conversations.push(conversation.id);
  const data={...f.data,phoneNumber:conversation.phoneNumber,email:'second@example.test'};
  const row=await db.$transaction(tx=>admissions.recordConfirmed(tx,{conversationId:conversation.id,data,sourceMessageId:'capacity-'+randomUUID(),consentVersion:'admissions-v1'}));f.owned.requests.push(row.id);await verifier.issue(row.id,f.admin.id);await verifier.verify(row.id,token());
  const results=await Promise.allSettled([service.convert(f.row.id,f.admin.id,f.input),service.convert(row.id,f.admin.id,{...f.input,...data})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.enrollment.count(),1);assert.equal(await db.whatsAppAdmissionRequest.count({where:{status:'ENROLLED'}}),1);
 }));
 await t.test('a delayed failure of an older email cannot consume the current challenge',()=>scenario(async f=>{
  await verifier.issue(f.row.id,f.admin.id);const old=await db.whatsAppAdmissionEvent.findFirst({where:{requestId:f.row.id,action:'EMAIL_CHALLENGE'},orderBy:{id:'desc'}});
  await db.whatsAppAdmissionEvent.update({where:{id:old.id},data:{createdAt:new Date(Date.now()-61000)}});
  await verifier.issue(f.row.id,f.admin.id);const currentCode=token();
  await db.whatsAppAdmissionEvent.create({data:{requestId:f.row.id,action:'EMAIL_DELIVERY_FAILED',metadata:{challengeId:old.id}}});
  assert.deepEqual(await verifier.verify(f.row.id,currentCode),{verified:true});
 }));
 await t.test('invalid persisted email expiry fails closed',()=>scenario(async f=>{
  await verifier.issue(f.row.id,f.admin.id);const challenge=await db.whatsAppAdmissionEvent.findFirst({where:{requestId:f.row.id,action:'EMAIL_CHALLENGE'},orderBy:{id:'desc'}});
  await db.whatsAppAdmissionEvent.update({where:{id:challenge.id},data:{metadata:{...challenge.metadata,expiresAt:'invalid'}}});
  await assert.rejects(verifier.verify(f.row.id,token()),{statusCode:400});assert.equal(await db.enrollment.count(),0);
 }));
});
