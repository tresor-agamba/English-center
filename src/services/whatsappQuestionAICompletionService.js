// Claims a durable reply after inbound commit. OpenAI is always outside SQL locks.
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const {createQuestionAIService,buildFacts,fallback,config}=require('./whatsappQuestionAIService');
function createQuestionAICompletionService({database,env=process.env,now=()=>new Date(),
 ai=createQuestionAIService({env}),catalog=require('./publicCourseService'),registration=require('./registrationService')}={}){
 const active=c=>c?.controlState==='BOT_ACTIVE'&&c.engineState?.mode==='QUESTION_AI'&&!c.engineState?.optedOut&&!c.engineState?.automationPaused;
 async function factsFor(state,question){
  const courses=await catalog.listPublished(database);
  const selected=courses;
  const sessions=await registration.listSessionsForPublicRegistration(database);
  require('./loggerService').info('NVA_ASSISTANT_FACTS',{catalogCount:selected.length,sessionCount:sessions.length});
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
  try{
   const expected=idempotencyKey.startsWith('wa-reply:')?idempotencyKey.slice(9,-2):'';
   const latest=await database.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
   const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
   const started=new Date(+now()-7*24*60*60*1000);
   const eligible=config(env)&&active(message.conversation)&&settings?.enabled!==false&&settings?.admissionsEnabled===true&&latest?.providerMessageId===expected&&latest?.messageType==='TEXT'&&Number.isFinite(+started);
   let answer=null,decision=null;
   if(!eligible)require('./loggerService').warn('NVA_ASSISTANT_NOT_ELIGIBLE',{reason:!config(env)?'configuration':settings?.enabled===false||settings?.admissionsEnabled!==true?'settings_disabled':'message_or_context'});
   if(eligible){
    const history=await database.whatsAppConversationMessage.findMany({where:{conversationId:message.conversationId,createdAt:{gte:started},id:{lt:latest.id},senderUserId:null,messageType:'TEXT',OR:[{direction:'INBOUND'},{direction:'OUTBOUND',deliveryStatus:{in:['ACCEPTED','SENT','DELIVERED','READ']}}]},orderBy:{id:'desc'},take:12,select:{direction:true,body:true}});
    const facts=await factsFor(message.conversation.engineState,latest.body);
    const generated=await (ai.decide?ai.decide.bind(ai):ai.answer.bind(ai))({correlation:require('node:crypto').createHash('sha256').update(expected).digest('hex').slice(0,20),question:latest.body,preferredLanguage:message.conversation.engineState.preferredLanguage,history:history.reverse().map(r=>({role:r.direction==='INBOUND'?'user':'assistant',content:r.body})),facts,reserve:async cap=>{
     const day=now().toISOString().slice(0,10);
     await database.whatsAppChatbotAiBudget.upsert({where:{day},create:{day,calls:0},update:{}});
     const reserved=await database.whatsAppChatbotAiBudget.updateMany({where:{day,calls:{lt:cap}},data:{calls:{increment:1}}});return reserved.count===1;
    }});
    if(ai.decide){
     decision=require('./whatsappRegistrationTransition').validateDecision(generated);
     answer=decision?.reply||null;
    }else answer=typeof generated==='string'?generated:null;
    // A price/session changed during HTTP must not publish the old snapshot.
    if(answer&&JSON.stringify(await factsFor(message.conversation.engineState,latest.body))!==JSON.stringify(facts))answer=null;
   }
   return await database.$transaction(async tx=>{
    await lockRecipients(tx,[message.conversation.phoneNumber]);
    const current=await tx.whatsAppConversation.findUnique({where:{id:message.conversationId}});
    const inbound=await tx.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
    const settingsNow=await tx.whatsAppChatbotSettings.findUnique({where:{id:1}});
    const valid=active(current)&&inbound?.id===latest?.id&&inbound?.providerMessageId===expected&&current.engineState.questionAIStartedAt===message.conversation.engineState.questionAIStartedAt&&settingsNow?.enabled!==false;
    const publishAI=Boolean(config(env)&&settingsNow?.admissionsEnabled===true&&answer);
    let body=publishAI?answer:fallback(latest?.body,current?.engineState?.preferredLanguage);
    let nextState=null,interactive=null;
    if(valid&&config(env)&&answer&&decision&&settingsNow?.admissionsEnabled===true&&!require('./whatsappRegistrationTransition').isCollecting(current.engineState)){
     const action={START_REGISTRATION:'CHOOSE_METHOD',REGISTRATION_WEBSITE:'WEBSITE',REGISTRATION_WHATSAPP:'WHATSAPP'}[decision.intent];
     if(action){
      const result=await require('./whatsappAdmissionJourney').createAdmissionJourney({database:tx,catalog,registration,now}).resolve({
       state:current.engineState,text:latest.body,registrationAction:action});
      if(result){body=result.text;nextState=result.state;interactive=result.interactive;}
     }else if(decision.intent==='OFFER_REGISTRATION'){
      nextState={...current.engineState,pendingRegistrationOffer:{replyKey:idempotencyKey,expiresAt:new Date(+now()+86400000).toISOString()}};
     }
    }
    const changed=await tx.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING'},data:valid?{body,failureCode:null,...(interactive?{messageType:'INTERACTIVE',interactivePayload:interactive}:{})}:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED'}});
    if(changed.count===1&&valid&&nextState)await tx.whatsAppConversation.update({where:{id:current.id},data:{engineState:nextState}});
    require('./loggerService').info('NVA_ASSISTANT_COMPLETION',{correlation:require('node:crypto').createHash('sha256').update(expected).digest('hex').slice(0,20),
     source:!valid?'cancelled':interactive?'backend':publishAI?'openai':'fallback',decision:decision?.intent||'NONE',transition:nextState?.admission?.step||null,cancelled:!valid});
    return {completed:changed.count===1,cancelled:!valid};
   },{isolationLevel:'Serializable',timeout:5000});
  }catch{
   require('./loggerService').warn('NVA_ASSISTANT_COMPLETION_FAILED',{reason:'database_or_context'});
   // DB/context failure is not a verified reply. No transaction or API retry.
   await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING'},data:{deliveryStatus:'CANCELLED',failureCode:'AI_COMPLETION_FAILED'}});
   return {cancelled:true};
  }
 }
 return {completeReply};
}
module.exports={createQuestionAICompletionService};
