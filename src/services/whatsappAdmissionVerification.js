// Proof belongs to a request and its exact identity, not to all uses of an email.
const {randomBytes,createHash}=require('node:crypto');
const prisma=require('../utils/prisma');
const {identity}=require('./whatsappAdmissionJourney');
const digest=value=>createHash('sha256').update(value).digest('hex');
const binding=data=>digest(JSON.stringify(identity(data)));
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function lock(tx,id){await tx.$queryRaw`SELECT id FROM "WhatsAppAdmissionRequest" WHERE id=${id} FOR UPDATE`;}
async function requireProof(tx,row,data,now=new Date()){
 const proof=await tx.whatsAppAdmissionEvent.findFirst({where:{requestId:row.id,action:'EMAIL_VERIFIED'},orderBy:{id:'desc'}});
 if(!proof||binding(row)!==binding(data)||proof.metadata?.binding!==binding(data)||!Number.isFinite(Date.parse(proof.createdAt))||+now-Date.parse(proof.createdAt)>7*86400000)throw failure('Vérifiez l’adresse e-mail du prospect avant de confirmer cette inscription.',409);
}
function createVerification({database=prisma,delivery=()=>require('./emailDeliveryProvider').createEmailDeliveryProvider(),now=()=>new Date()}={}){
 async function issue(value,adminId){
  const requestId=require('./whatsappAdmissionService').id(value),token=randomBytes(32).toString('base64url');
  const provider=delivery(); // Fail before writing if email is unavailable.
  const challenge=await database.$transaction(async tx=>{
   const actor=await tx.user.findUnique({where:{id:adminId}});
   if(actor?.role!=='ADMIN'||!actor.isActive||actor.mustChangePassword)throw failure('Accès interdit.',403);
   await lock(tx,requestId);
   const row=await tx.whatsAppAdmissionRequest.findUnique({where:{id:requestId}});
   if(!row)throw failure('Demande introuvable.',404);
   if(!require('../utils/resetDeliveryConfig').resetEmail(row.email))throw failure('Adresse e-mail invalide. Corrigez les coordonnées avant l’envoi.');
   if(!['PENDING','PROCESSING'].includes(row.status)||row.assignedAdminId&&row.assignedAdminId!==adminId)throw failure('Cette demande ne peut pas être vérifiée par cet administrateur.',409);
   const recent=await tx.whatsAppAdmissionEvent.findFirst({where:{requestId,action:'EMAIL_CHALLENGE'},orderBy:{id:'desc'}});
   if(recent&&+now()-Date.parse(recent.createdAt)<60000)throw failure('Attendez une minute avant un nouvel envoi.',429);
   return tx.whatsAppAdmissionEvent.create({data:{requestId,adminId,action:'EMAIL_CHALLENGE',metadata:{binding:binding(row),tokenHash:digest(token),expiresAt:new Date(+now()+1800000).toISOString(),email:row.email}}});
  },{isolationLevel:'ReadCommitted'});
  try{
   const result=await provider.send({to:challenge.metadata.email,subject:'NVA — Vérification de votre demande WhatsApp',text:'Votre demande n’est pas encore une inscription. Ouvrez https://www.newvisionacademy.org/whatsapp/admission-email et saisissez le numéro de demande '+requestId+' et ce code à usage unique : '+token+'\nCe code expire dans 30 minutes. Ne le communiquez à personne. Si vous n’avez pas demandé cette inscription, ignorez ce message.'});
   if(!result?.accepted)throw Error('NOT_ACCEPTED');
  }catch{
   await database.whatsAppAdmissionEvent.create({data:{requestId,adminId,action:'EMAIL_DELIVERY_FAILED',metadata:{challengeId:challenge.id}}});
   throw failure('Le message de vérification n’a pas pu être envoyé. Réessayez ultérieurement.',503);
  }
  return {sent:true};
 }
 async function verify(value,token){
  const requestId=require('./whatsappAdmissionService').id(value);
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw failure('Code invalide ou expiré.');
  return database.$transaction(async tx=>{
   await lock(tx,requestId);
   const row=await tx.whatsAppAdmissionRequest.findUnique({where:{id:requestId}});
   if(!row||!['PENDING','PROCESSING'].includes(row.status))throw failure('Code invalide ou expiré.');
   const challenge=await tx.whatsAppAdmissionEvent.findFirst({where:{requestId,action:'EMAIL_CHALLENGE'},orderBy:{id:'desc'}});
   if(!challenge||challenge.metadata.tokenHash!==digest(token)||challenge.metadata.binding!==binding(row)||!Number.isFinite(Date.parse(challenge.metadata.expiresAt))||Date.parse(challenge.metadata.expiresAt)<=+now())throw failure('Code invalide ou expiré.');
   const consumed=await tx.whatsAppAdmissionEvent.findFirst({where:{requestId,action:{in:['EMAIL_VERIFIED','EMAIL_DELIVERY_FAILED']},metadata:{path:['challengeId'],equals:challenge.id},id:{gt:challenge.id}},orderBy:{id:'desc'}});
   if(consumed)throw failure('Code invalide ou expiré.');
   await tx.whatsAppAdmissionEvent.create({data:{requestId,action:'EMAIL_VERIFIED',metadata:{binding:binding(row),challengeId:challenge.id}}});
   return {verified:true};
  },{isolationLevel:'ReadCommitted'});
 }
 return {issue,verify};
}
module.exports={createVerification,requireProof,binding,...createVerification()};
