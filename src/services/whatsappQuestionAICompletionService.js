// Claims a durable reply after inbound commit. OpenAI is always outside SQL locks.
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const {createQuestionAIService,buildFacts,fallback,config}=require('./whatsappQuestionAIService');
const logger=require('./loggerService');
const {vetoRegistration}=require('./whatsappRegistrationActionPolicy');
function createQuestionAICompletionService({database,env=process.env,now=()=>new Date(),
 ai=createQuestionAIService({env}),catalog=require('./publicCourseService'),registration=require('./registrationService')}={}){
 const active=c=>c?.controlState==='BOT_ACTIVE'&&c.engineState?.mode==='QUESTION_AI'&&!c.engineState?.optedOut&&!c.engineState?.automationPaused;
 async function factsFor(state,question){
  const courses=await catalog.listPublished(database);
  const resolution=require('./whatsappCommercialPolicy').resolveCourse(question,courses,state);
  const selected=resolution.course?[resolution.course]:courses;
  const sessions=await registration.listSessionsForPublicRegistration(database);
  return buildFacts(selected,sessions,now());
 }
 async function completeReply(idempotencyKey){
  const message=await database.whatsAppConversationMessage.findUnique({where:{idempotencyKey},include:{conversation:true}});
  if(!message||message.direction!=='OUTBOUND'||message.deliveryStatus!=='QUEUED'||!['QUESTION_AI_PENDING','QUESTION_AI_PROCESSING'].includes(message.failureCode))return {skipped:true};
  if(!active(message.conversation)){
   await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:message.failureCode},data:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED'}});
   return {cancelled:true};
  }
  if(message.failureCode==='QUESTION_AI_PROCESSING'){
   if(message.updatedAt&&+now()-+message.updatedAt>120000){
    await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING',updatedAt:message.updatedAt},data:{failureCode:null}});
    return {fallback:true}; // Prewritten safe body; never retry a crashed API owner.
   }return {busy:true};
  }
  const claimed=await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PENDING'},data:{failureCode:'QUESTION_AI_PROCESSING'}});
  if(!claimed.count)return {busy:true};
  logger.info('NVA_AI_ATTEMPT',{phase:'claimed'});
  try{
   const expected=idempotencyKey.startsWith('wa-reply:')?idempotencyKey.slice(9,-2):'';
   const latest=await database.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
   const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
   const started=new Date(message.conversation?.engineState?.questionAIStartedAt);
   const eligible=config(env)&&active(message.conversation)&&settings?.enabled!==false&&settings?.admissionsEnabled===true&&latest?.providerMessageId===expected&&latest?.messageType==='TEXT'&&Number.isFinite(+started);
   let answer=null;
   if(eligible){
    const history=await database.whatsAppConversationMessage.findMany({where:{conversationId:message.conversationId,createdAt:{gte:started},id:{lt:latest.id},senderUserId:null,messageType:'TEXT'},orderBy:{id:'desc'},take:6,select:{direction:true,body:true}});
    const facts=await factsFor(message.conversation.engineState,latest.body);
    answer=await ai.answer({question:latest.body,preferredLanguage:message.conversation.engineState.preferredLanguage,history:history.reverse().map(r=>({role:r.direction==='INBOUND'?'user':'assistant',content:r.body})),facts,reserve:async cap=>{
     const day=now().toISOString().slice(0,10);
     await database.whatsAppChatbotAiBudget.upsert({where:{day},create:{day,calls:0},update:{}});
     const reserved=await database.whatsAppChatbotAiBudget.updateMany({where:{day,calls:{lt:cap}},data:{calls:{increment:1}}});return reserved.count===1;
    }});
    // A price/session changed during HTTP must not publish the old snapshot.
    if(answer&&JSON.stringify(await factsFor(message.conversation.engineState,latest.body))!==JSON.stringify(facts))answer=null;
    if(answer?.action==='REGISTER'&&vetoRegistration(latest.body)){
     logger.info('NVA_AI_ACTION_REJECTED',{reason:'REGISTRATION_VETO'});
     answer=null;
    }
   }
   return await database.$transaction(async tx=>{
    await lockRecipients(tx,[message.conversation.phoneNumber]);
    const current=await tx.whatsAppConversation.findUnique({where:{id:message.conversationId}});
    const inbound=await tx.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
    const settingsNow=await tx.whatsAppChatbotSettings.findUnique({where:{id:1}});
    const valid=active(current)&&inbound?.id===latest?.id&&inbound?.providerMessageId===expected&&current.engineState.questionAIStartedAt===message.conversation.engineState.questionAIStartedAt&&settingsNow?.enabled!==false;
    let body=config(env)&&settingsNow?.admissionsEnabled===true&&answer?answer:fallback(latest?.body,current?.engineState?.preferredLanguage);
    let registrationReply=null;
    if(valid&&body?.action==='REGISTER'){
     registrationReply=await require('./whatsappAdmissionJourney').createAdmissionJourney({database:tx,catalog,registration,now}).resolve({intent:'AI_REGISTRATION',state:current.engineState,text:'',messageId:expected});
     body=registrationReply?.text||fallback(latest?.body,current.engineState.preferredLanguage);
    }
    const changed=await tx.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING'},data:valid?{body,failureCode:null,...(registrationReply?.interactive?{messageType:'INTERACTIVE',interactivePayload:registrationReply.interactive}:{})}:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED'}});
    if(changed.count&&registrationReply)await tx.whatsAppConversation.update({where:{id:current.id},data:{engineState:registrationReply.state}});
    logger.info('NVA_AI_COMPLETION',{outcome:!valid?'cancelled':registrationReply?'registration':answer?'answered':'unavailable'});
    return {completed:changed.count===1,cancelled:!valid};
   },{isolationLevel:'Serializable',timeout:5000});
  }catch{
   logger.warn('NVA_AI_COMPLETION_FAILED',{reason:'API_OR_CONTEXT_UNAVAILABLE'});
   // DB/context failure is not a verified reply. No transaction or API retry.
   await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING'},data:{deliveryStatus:'CANCELLED',failureCode:'AI_COMPLETION_FAILED'}});
   return {cancelled:true};
  }
 }
 return {completeReply};
}
module.exports={createQuestionAICompletionService};
