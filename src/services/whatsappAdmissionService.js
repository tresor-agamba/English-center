const prisma=require('../utils/prisma');
const registration=require('./registrationService');
const {identity}=require('./whatsappAdmissionJourney');
const {normalizePhoneNumber}=require('../utils/phone.util');
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const STATUSES=['PENDING','PROCESSING','ENROLLED','CANCELLED'];
function fail(message,statusCode=400){return Object.assign(new Error(message),{statusCode});}
function id(value){if(!/^[1-9]\d{0,8}$/.test(String(value)))throw fail('Identifiant invalide.');return Number(value);}
async function actor(tx,adminId){const user=await tx.user.findUnique({where:{id:adminId},select:{id:true,role:true,isActive:true,mustChangePassword:true}});if(user?.role!=='ADMIN'||!user.isActive||user.mustChangePassword)throw fail('Accès interdit.',403);}
async function event(tx,requestId,action,adminId=null,metadata={}){return tx.whatsAppAdmissionEvent.create({data:{requestId,adminId,action,metadata}});}
async function recordConfirmed(tx,input,now=new Date()){
 const data=identity(input.data);if(input.consentVersion!=='admissions-v1'||typeof input.sourceMessageId!=='string'||!input.sourceMessageId||input.sourceMessageId.length>256)throw fail('Confirmation invalide.');
 const duplicate=await tx.whatsAppAdmissionRequest.findUnique({where:{sourceMessageId:input.sourceMessageId}});if(duplicate)return duplicate;
 const existing=await tx.whatsAppAdmissionRequest.findFirst({where:{conversationId:input.conversationId,status:{in:['PENDING','PROCESSING']}}});
 const row=existing?await tx.whatsAppAdmissionRequest.update({where:{id:existing.id},data:{...data,consentAt:now}}):await tx.whatsAppAdmissionRequest.create({data:{...data,conversationId:input.conversationId,sourceMessageId:input.sourceMessageId,consentVersion:input.consentVersion,consentAt:now}});
 await event(tx,row.id,existing?'RECONFIRMED':'CONSENT_CONFIRMED',null,{noticeVersion:'admissions-v1',messageId:input.sourceMessageId});
 const admins=await tx.user.findMany({where:{role:'ADMIN',isActive:true},select:{id:true}});
 for(const admin of admins)await tx.notification.upsert({where:{deduplicationKey:'wa-admission:'+row.id+':'+admin.id},create:{userId:admin.id,type:'GENERAL_ANNOUNCEMENT',channel:'IN_APP',title:'Demande d’inscription WhatsApp',message:'Une demande consentie attend votre examen.',actionUrl:'/admin/whatsapp/admissions/'+row.id,deduplicationKey:'wa-admission:'+row.id+':'+admin.id},update:{}});
 return row;
}
function createAdmissionService({database=prisma,business=registration}={}){
 async function list(query={}){const q=typeof query.q==='string'?query.q.trim().slice(0,100):'';const status=STATUSES.includes(query.status)?query.status:'';const sort=query.sort==='oldest'?'asc':'desc';const where={...(status?{status}:{}),...(q?{OR:[{fullName:{contains:q,mode:'insensitive'}},{email:{contains:q,mode:'insensitive'}},{phoneNumber:{contains:q}}]}:{})};const page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1));return {rows:await database.whatsAppAdmissionRequest.findMany({where,include:{assignedAdmin:{select:{firstName:true,lastName:true}}},orderBy:[{createdAt:sort},{id:sort}],skip:(page-1)*50,take:50}),q,status,sort,page};}
 async function get(value){const row=await database.whatsAppAdmissionRequest.findUnique({where:{id:id(value)},include:{events:{orderBy:{id:'desc'},take:100,include:{admin:{select:{firstName:true,lastName:true}}}},assignedAdmin:{select:{firstName:true,lastName:true}},enrollment:{select:{id:true,userId:true}}}});if(!row)throw fail('Demande introuvable.',404);return row;}
 async function update(value,adminId,input){if(!['claim','cancel','edit'].includes(input.action))throw fail('Action invalide.');return database.$transaction(async tx=>{await actor(tx,adminId);const row=await tx.whatsAppAdmissionRequest.findUnique({where:{id:id(value)}});if(!row)throw fail('Demande introuvable.',404);if(['ENROLLED','CANCELLED'].includes(row.status))throw fail('Cette demande est clôturée.',409);const data=input.action==='claim'?{assignedAdminId:adminId,status:'PROCESSING'}:input.action==='cancel'?{status:'CANCELLED'}:identity(input);if(input.action==='claim'&&row.assignedAdminId&&row.assignedAdminId!==adminId)throw fail('Demande déjà attribuée à un autre administrateur.',409);const changed=await tx.whatsAppAdmissionRequest.updateMany({where:{id:row.id,updatedAt:row.updatedAt,status:row.status},data});if(!changed.count)throw fail('La demande a changé. Rechargez la page.',409);await event(tx,row.id,input.action==='claim'?'ASSIGNED':input.action==='cancel'?'CANCELLED':'IDENTITY_EDITED',adminId,{fields:Object.keys(data)});return row.id;},{isolationLevel:'Serializable'}).catch(e=>{if(e.code==='P2034')throw fail('La demande a été modifiée ailleurs. Rechargez la page.',409);throw e;});}
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
