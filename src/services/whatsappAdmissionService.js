const prisma=require('../utils/prisma');
const registration=require('./registrationService');
const {identity}=require('./whatsappAdmissionJourney');
const {normalizePhoneNumber}=require('../utils/phone.util');
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const STATUSES=['PENDING','PROCESSING','ENROLLED','CANCELLED'];
function fail(message,statusCode=400){return Object.assign(new Error(message),{statusCode});}
function id(value){if(!/^[1-9]\d{0,8}$/.test(String(value)))throw fail('Identifiant invalide.');return Number(value);}
async function actor(tx,adminId){const user=await tx.user.findUnique({where:{id:adminId},select:{id:true,role:true,isActive:true,mustChangePassword:true}});if(user?.role!=='ADMIN'||!user.isActive||user.mustChangePassword)throw fail('Accès interdit.',403);}
async function event(tx,requestId,action,adminId=null,metadata={}){
 if(adminId===null&&['CONSENT_CONFIRMED','RECONFIRMED'].includes(action)&&typeof tx.$executeRaw==='function'){
  const [row]=await tx.$queryRaw`SELECT public.nva_record_admission_consent(${requestId}::integer,${action}::text,${JSON.stringify(metadata)}::jsonb) AS id`;
  return tx.whatsAppAdmissionEvent.findUnique({where:{id:row.id}});
 }
 return tx.whatsAppAdmissionEvent.create({data:{requestId,adminId,action,metadata}});
}
async function createPending(tx,input,data,now,confirmationDraft){
 // Prisma fills literal defaults in INSERT, including status. The worker must
 // NOT hold INSERT on decision columns, so let PostgreSQL supply PENDING/nulls.
 if(typeof tx.$executeRaw!=='function'){
  if(process.env.NODE_ENV!=='test')throw fail('Transaction PostgreSQL requise.',503);
  return tx.whatsAppAdmissionRequest.create({data:{...data,conversationId:input.conversationId,sourceMessageId:input.sourceMessageId,consentVersion:input.consentVersion,consentAt:now,confirmationDraft}});
 }
 try{
  const [created]=await tx.$queryRaw`INSERT INTO "WhatsAppAdmissionRequest"
   ("conversationId","fullName","phoneNumber",email,"requestedLevel","sourceMessageId","consentVersion","consentAt","confirmationDraft","createdAt","updatedAt")
   VALUES (${input.conversationId},${data.fullName},${data.phoneNumber},${data.email},${data.requestedLevel},${input.sourceMessageId},${input.consentVersion},
    (${now}::timestamptz AT TIME ZONE 'UTC'),${confirmationDraft},(${now}::timestamptz AT TIME ZONE 'UTC'),(${now}::timestamptz AT TIME ZONE 'UTC')) RETURNING id`;
  return tx.whatsAppAdmissionRequest.findUnique({where:{id:created.id}});
 }catch(e){if(e.code==='P2010'&&e.meta?.code==='23505')throw Object.assign(Error('Conflit de demande concurrente.'),{code:'P2002'});throw e;}
}
async function recordConfirmed(tx,input,now=new Date()){
 const data=identity(input.data);if(input.consentVersion!=='admissions-v1'||typeof input.sourceMessageId!=='string'||!input.sourceMessageId||input.sourceMessageId.length>256)throw fail('Confirmation invalide.');
 const duplicate=await tx.whatsAppAdmissionRequest.findUnique({where:{sourceMessageId:input.sourceMessageId}});if(duplicate)return duplicate;
 let preference={};
 if(input.data.courseId){
  const selected=await tx.course.findUnique({where:{id:id(input.data.courseId)}});
  if(!selected||!require('./coursePublicationPolicy').isPublicCourse(selected))throw fail('Cette formation n’est plus disponible.');
  preference.courseId=selected.id;
 }
 if(input.data.requestedSessionId){
  const session=await registration.getSessionForRegistration(input.data.requestedSessionId,tx);
  if(session.course.id!==input.data.courseId)throw fail('La session ne correspond pas à la formation.');
  preference={requestedSessionId:session.id,courseId:session.course.id};
  if(input.data.requestedGroupId){
   const group=session.registrationGroups.find(g=>g.id===id(input.data.requestedGroupId)&&g.isActive&&!g.isFull);
   if(!group)throw fail('Ce créneau n’est plus disponible.');
   preference.requestedGroupId=group.id;
  }
 }
 const existing=await tx.whatsAppAdmissionRequest.findFirst({where:{conversationId:input.conversationId,status:{in:['PENDING','PROCESSING']}}});
 const receivedDraft='Votre demande d’inscription NVA a été reçue. Elle reste en attente de vérification et de décision administrative ; aucune inscription n’est encore confirmée.';
 const row=existing?await tx.whatsAppAdmissionRequest.update({where:{id:existing.id},data:{...data,consentAt:now,confirmationDraft:receivedDraft}}):await createPending(tx,input,data,now,receivedDraft);
 await event(tx,row.id,existing?'RECONFIRMED':'CONSENT_CONFIRMED',null,{noticeVersion:'admissions-v1',messageId:input.sourceMessageId,...preference});
 const admins=await tx.user.findMany({where:{role:'ADMIN',isActive:true},select:{id:true}});
 for(const admin of admins)await tx.notification.upsert({where:{deduplicationKey:'wa-admission:'+row.id+':'+admin.id},create:{userId:admin.id,type:'GENERAL_ANNOUNCEMENT',channel:'IN_APP',title:'Demande d’inscription WhatsApp',message:'Une demande consentie attend votre examen.',actionUrl:'/admin/whatsapp/admissions/'+row.id,deduplicationKey:'wa-admission:'+row.id+':'+admin.id},update:{}});
 return row;
}
function createAdmissionService({database=prisma,business=registration}={}){
 async function preferences(rows){
  const entries=rows.map(row=>({row,choice:row.events?.find(e=>['CONSENT_CONFIRMED','RECONFIRMED'].includes(e.action))?.metadata||{}}));
  const ids=key=>[...new Set(entries.map(e=>e.choice[key]).filter(Number.isInteger))];
  const [courses,sessions]=await Promise.all([ids('courseId').length?database.course.findMany({where:{id:{in:ids('courseId')}},select:{id:true,title:true}}):[],ids('requestedSessionId').length?database.trainingSession.findMany({where:{id:{in:ids('requestedSessionId')}},select:{id:true,name:true}}):[]]);
  for(const {row,choice}of entries)row.preference={...choice,courseTitle:courses.find(c=>c.id===choice.courseId)?.title||null,sessionName:sessions.find(s=>s.id===choice.requestedSessionId)?.name||null};return rows;
 }
 async function list(query={}){const q=typeof query.q==='string'?query.q.trim().slice(0,100):'';const status=STATUSES.includes(query.status)?query.status:'';const sort=query.sort==='oldest'?'asc':'desc';const where={...(status?{status}:{}),...(q?{OR:[{fullName:{contains:q,mode:'insensitive'}},{email:{contains:q,mode:'insensitive'}},{phoneNumber:{contains:q}}]}:{})};const page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1));return {rows:await preferences(await database.whatsAppAdmissionRequest.findMany({where,include:{events:{where:{action:{in:["CONSENT_CONFIRMED","RECONFIRMED"]}},orderBy:{id:"desc"},take:1},assignedAdmin:{select:{firstName:true,lastName:true}}},orderBy:[{createdAt:sort},{id:sort}],skip:(page-1)*50,take:50})),q,status,sort,page};}
 async function get(value){const row=await database.whatsAppAdmissionRequest.findUnique({where:{id:id(value)},include:{events:{orderBy:{id:'desc'},take:100,include:{admin:{select:{firstName:true,lastName:true}}}},assignedAdmin:{select:{firstName:true,lastName:true}},enrollment:{select:{id:true,userId:true}}}});if(!row)throw fail('Demande introuvable.',404);await preferences([row]);return row;}
 async function update(value,adminId,input){
  if(!['claim','cancel','edit','request-info'].includes(input.action))throw fail('Action invalide.');
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(['cancel','request-info'].includes(input.action)&&(!reason||reason.length>1000||/[\x00-\x1f<>]/.test(reason)))throw fail('Précisez un motif de 1 à 1000 caractères.');
  return database.$transaction(async tx=>{
   await actor(tx,adminId);const requestId=id(value);
   if(typeof tx.$queryRaw==='function')await tx.$queryRaw`SELECT id FROM "WhatsAppAdmissionRequest" WHERE id=${requestId} FOR UPDATE`;
   const row=await tx.whatsAppAdmissionRequest.findUnique({where:{id:requestId}});
   if(!row)throw fail('Demande introuvable.',404);
   if(['ENROLLED','CANCELLED'].includes(row.status))throw fail('Cette demande est clôturée.',409);
   if(row.assignedAdminId&&row.assignedAdminId!==adminId)throw fail('Demande déjà attribuée à un autre administrateur.',409);
   const data=input.action==='claim'?{assignedAdminId:adminId,status:'PROCESSING'}:input.action==='cancel'?{assignedAdminId:adminId,status:'CANCELLED',confirmationDraft:'Votre demande d’inscription NVA n’a pas été retenue. Motif : '+reason}:input.action==='request-info'?{assignedAdminId:adminId,status:'PROCESSING',confirmationDraft:'Votre demande NVA reste en attente. Informations complémentaires nécessaires : '+reason}:identity(input);
   const changed=await tx.whatsAppAdmissionRequest.updateMany({where:{id:row.id,updatedAt:row.updatedAt,status:row.status},data});
   if(!changed.count)throw fail('La demande a changé. Rechargez la page.',409);
   await event(tx,row.id,{claim:'ASSIGNED',cancel:'CANCELLED',edit:'IDENTITY_EDITED','request-info':'INFORMATION_REQUESTED'}[input.action],adminId,{fields:Object.keys(data),...(reason?{reason}:{})});return row.id;
  },{isolationLevel:'Serializable'}).catch(e=>{if(e.code==='P2034'||e.code==='P2010'&&['40001','40P01'].includes(e.meta?.code))throw fail('La demande a été modifiée ailleurs. Rechargez la page.',409);throw e;});
 }
 async function convert(value,adminId,input){
  if(input.confirm!=='on')throw fail('Confirmez explicitement l’inscription.');
  const requestId=id(value),data=identity(input);try{data.phoneNumber=normalizePhoneNumber(data.phoneNumber);}catch{throw fail('Le compte étudiant exige actuellement un numéro mobile congolais +243 valide. Corrigez ou contactez un conseiller.');}
  const names=data.fullName.split(' ');const sessionId=business.parseSessionId(input.sessionId);const requestedLevel=business.validateLevel(input.academicLevel);
  const payload={firstName:names.shift(),lastName:names.join(' '),phoneNumber:data.phoneNumber,whatsappNumber:data.phoneNumber,email:data.email,sessionId,groupId:input.groupId||null,requestedLevel,passwordHash:input.passwordHash,allowExistingUser:true,mustChangePassword:true,reuseExistingEnrollment:true};
  const snapshot=await database.whatsAppAdmissionRequest.findUnique({where:{id:requestId},include:{conversation:{select:{phoneNumber:true}}}});
  if(!snapshot)throw fail('Demande introuvable.',404);
  for(let attempt=0;attempt<3;attempt++){
   try{
    const result=await database.$transaction(async tx=>{
     await actor(tx,adminId);await lockRecipients(tx,[data.phoneNumber,snapshot.conversation?.phoneNumber]);
     if(typeof tx.$queryRaw==='function')await tx.$queryRaw`SELECT id FROM "WhatsAppAdmissionRequest" WHERE id=${requestId} FOR UPDATE`;
     const row=await tx.whatsAppAdmissionRequest.findUnique({where:{id:requestId}});if(!row)throw fail('Demande introuvable.',404);
     if(row.status==='ENROLLED')return {already:true,enrollment:{id:row.enrollmentId},request:row};
     if(row.status==='CANCELLED')throw fail('Cette demande est annulée.',409);
     if(row.assignedAdminId&&row.assignedAdminId!==adminId)throw fail('Demande attribuée à un autre administrateur.',409);
     await require('./whatsappAdmissionVerification').requireProof(tx,row,data);
     // An email challenge is not proof of an existing student's account ownership.
     // Keep the verified request identity and require the exact account email too.
     const existingAccount=await tx.user.findUnique({where:{phoneNumber:data.phoneNumber}});
     if(existingAccount&&existingAccount.email?.toLowerCase()!==data.email)throw fail('Le compte existant ne correspond pas à l’adresse e-mail vérifiée. Vérifiez son identité par le circuit étudiant existant.',409);
     const enrolled=await business.createRegistrationInTransaction(tx,payload);
     await tx.whatsAppConversation.updateMany({where:{id:row.conversationId,OR:[{userId:null},{userId:enrolled.user.id}]},data:{userId:enrolled.user.id}});
     await require('./whatsappProspectFollowUpService').cancelForConversation(row.conversationId,'ENROLLED',tx);
     const confirmationDraft='Votre inscription NVA est enregistrée. Consultez votre compte : https://www.newvisionacademy.org/login. Les conditions de paiement et d’accès sont celles de la session choisie.';
     const updated=await tx.whatsAppAdmissionRequest.update({where:{id:requestId},data:{...data,status:'ENROLLED',assignedAdminId:adminId,convertedById:adminId,enrollmentId:enrolled.enrollment.id,confirmationDraft}});
     await event(tx,requestId,'ENROLLED',adminId,{enrollmentId:enrolled.enrollment.id,sessionId,reused:enrolled.reused===true});
     return {...enrolled,request:updated};
    },{isolationLevel:'Serializable'});
    if(!result.already&&business.completeRegistrationSideEffects)await business.completeRegistrationSideEffects(result,payload);
    return result;
   }catch(e){const serializationConflict=e.code==='P2034'||(e.code==='P2010'&&['40001','40P01'].includes(e.meta?.code));if((serializationConflict||e.code==='P2002')&&attempt<2)continue;if(serializationConflict)throw fail('Une opération concurrente a modifié cette demande. Rechargez la page puis réessayez.',409);throw e;}
  }
 }
 return {list,get,update,convert};
}
module.exports={STATUSES,id,recordConfirmed,createAdmissionService,...createAdmissionService()};
