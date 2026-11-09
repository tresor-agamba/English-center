// Claims a durable reply after inbound commit. OpenAI is always outside SQL locks.
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const {createQuestionAIService,buildFacts,fallback,config}=require('./whatsappQuestionAIService');
const logger=require('./loggerService');
const {vetoRegistration}=require('./whatsappRegistrationActionPolicy');
const {randomUUID}=require('node:crypto');
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
   // Cancel only the snapshot observed here, never a subsequently acquired claim.
   const cancelled=await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:message.failureCode,aiClaimToken:message.aiClaimToken??null,updatedAt:message.updatedAt},data:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED',aiClaimToken:null}});
   return cancelled.count?{cancelled:true}:{superseded:true};
  }
  const recovering=message.failureCode==='QUESTION_AI_PROCESSING';
  if(recovering&&(!message.updatedAt||+now()-+message.updatedAt<=120000))return {busy:true};
  // Recovery reuses the final context transaction; it never reserves or calls AI.
  const claimToken=randomUUID();
  const claimed=await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:message.failureCode,aiClaimToken:message.aiClaimToken??null,...(recovering?{updatedAt:message.updatedAt}:{})},data:{failureCode:'QUESTION_AI_PROCESSING',aiClaimToken:claimToken}});
  if(!claimed.count)return {busy:true};
  const owned={id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'QUESTION_AI_PROCESSING',aiClaimToken:claimToken};
  logger.info('NVA_AI_ATTEMPT',{phase:'claimed'});
  try{
   const expected=idempotencyKey.startsWith('wa-reply:')?idempotencyKey.slice(9,-2):'';
   const latest=await database.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
   const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
   const started=new Date(message.conversation?.engineState?.questionAIStartedAt);
   const eligible=config(env)&&active(message.conversation)&&settings?.enabled!==false&&settings?.admissionsEnabled===true&&latest?.providerMessageId===expected&&latest?.messageType==='TEXT'&&Number.isFinite(+started);
   let answer=null,answerFacts=[];
   if(!eligible)logger.info('NVA_AI_RESULT',{reason:config(env)?'INELIGIBLE':'CONFIG_INVALID',called:false,responded:false});
   if(eligible&&!recovering){
    const history=await database.whatsAppConversationMessage.findMany({where:{conversationId:message.conversationId,createdAt:{gte:started},id:{lt:latest.id},senderUserId:null,messageType:'TEXT'},orderBy:{id:'desc'},take:6,select:{direction:true,body:true}});
    const facts=await factsFor(message.conversation.engineState,latest.body);answerFacts=facts;
    answer=await ai.answer({question:latest.body,preferredLanguage:message.conversation.engineState.preferredLanguage,history:history.reverse().map(r=>({role:r.direction==='INBOUND'?'user':'assistant',content:r.body})),facts,reserve:async cap=>{
     const day=now().toISOString().slice(0,10);
     try{
      await database.whatsAppChatbotAiBudget.upsert({where:{day},create:{day,calls:0},update:{}});
     }catch(error){
      // Prisma can emulate an empty-update upsert with SELECT then INSERT.
      // A concurrent owner may have created this day already. Only that unique
      // conflict is harmless; the conditional increment below still owns the cap.
      if(error?.code!=='P2002')throw error;
     }
     const reserved=await database.whatsAppChatbotAiBudget.updateMany({where:{day,calls:{lt:cap}},data:{calls:{increment:1}}});return reserved.count===1;
    }});
    // A price/session changed during HTTP must not publish the old snapshot.
    if(answer&&JSON.stringify(await factsFor(message.conversation.engineState,latest.body))!==JSON.stringify(facts)){
     logger.info('NVA_AI_RESULT',{reason:'FACTS_CHANGED',called:true,responded:true});answer=null;
    }
    if(answer?.action==='REGISTER'&&vetoRegistration(latest.body)){
     logger.info('NVA_AI_ACTION_REJECTED',{reason:'REGISTRATION_VETO'});
     answer=null;
    }
   }
   let completionEvent;
   const result=await database.$transaction(async tx=>{
    await lockRecipients(tx,[message.conversation.phoneNumber]);
    // Conditional UPDATE both proves ownership and holds the row lock until
    // commit. Recovery cannot replace the token between this check, REGISTER
    // effects and publication. A snapshot read outside this transaction is unsafe.
    const ownership=await tx.whatsAppConversationMessage.updateMany({where:owned,data:{aiClaimToken:claimToken}});
    if(!ownership.count){
     completionEvent={outcome:'superseded',reason:'OWNERSHIP_LOST'};
     return {completed:false,cancelled:false,superseded:true};
    }
    const current=await tx.whatsAppConversation.findUnique({where:{id:message.conversationId}});
    const inbound=await tx.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
    const settingsNow=await tx.whatsAppChatbotSettings.findUnique({where:{id:1}});
    const valid=active(current)&&inbound?.id===latest?.id&&inbound?.providerMessageId===expected&&current.engineState.questionAIStartedAt===message.conversation.engineState.questionAIStartedAt&&settingsNow?.enabled!==false;
    let body=recovering?message.body:config(env)&&settingsNow?.admissionsEnabled===true&&answer?answer:fallback(latest?.body,current?.engineState?.preferredLanguage);
    let registrationReply=null;
    let offerState=null;
    if(valid&&body?.action==='REGISTER'){
     registrationReply=await require('./whatsappAdmissionJourney').createAdmissionJourney({database:tx,catalog,registration,now}).resolve({intent:'AI_REGISTRATION',state:current.engineState,text:'',messageId:expected});
     body=registrationReply?.text||fallback(latest?.body,current.engineState.preferredLanguage);
    }
    if(valid&&typeof body==='string'&&answer&&!recovering&&!registrationReply){
     const intents=require('./whatsappCommercialIntents').detectIntents(latest.body);
     const informative=answerFacts.some(f=>[f.fr,f.en].some(fragment=>fragment&&body.includes(fragment)));
     if(informative&&!intents.includes('REFUSAL')){
      const {OPENINGS,QUESTIONS}=require('./whatsappAdvisorPolicy');
      // Remove only reviewed framing; approved official facts remain intact.
      let content=body;
      for(const entries of Object.values(OPENINGS))for(const language of ['fr','en'])for(const fragment of entries[language])if(fragment&&content.startsWith(fragment+'\n\n'))content=content.slice(fragment.length+2);
      for(const entries of Object.values(QUESTIONS))for(const language of ['fr','en'])for(const fragment of entries[language])if(fragment&&content.endsWith('\n\n'+fragment))content=content.slice(0,-fragment.length-2);
      registrationReply=await require('./whatsappAdmissionJourney').createAdmissionJourney({database:tx,catalog,registration,now}).resolve({state:current.engineState,text:'',messageId:expected,informationBody:content});
      if(registrationReply){body=registrationReply.text;if(registrationReply.state.admission?.step==='INVITE')registrationReply.state.pendingRegistrationOffer={replyKey:idempotencyKey,expiresAt:registrationReply.state.admission.expiresAt};}
     }
    }
    if(valid&&typeof body==='string'&&answer&&!recovering&&require('./whatsappRegistrationTransition').legacyInvitation({body,createdAt:now()},now())){
     offerState={...current.engineState,pendingRegistrationOffer:{replyKey:idempotencyKey,expiresAt:new Date(+now()+86400000).toISOString()}};
    }
    body=require('./whatsappMessagePresentation').formatText(body);
    if(registrationReply)registrationReply=require('./whatsappMessagePresentation').formatReply(registrationReply);
    const changed=await tx.whatsAppConversationMessage.updateMany({where:owned,data:valid?{body,failureCode:null,aiClaimToken:null,...(registrationReply?.interactive?{messageType:'INTERACTIVE',interactivePayload:registrationReply.interactive}:{})}:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED',aiClaimToken:null}});
    if(changed.count&&registrationReply)await tx.whatsAppConversation.update({where:{id:current.id},data:{engineState:registrationReply.state}});
    if(changed.count&&offerState&&!registrationReply)await tx.whatsAppConversation.update({where:{id:current.id},data:{engineState:offerState}});
    completionEvent={outcome:!changed.count?'superseded':!valid?'cancelled':registrationReply?'registration':answer?'answered':'fallback_ready',reason:!valid?'CONTEXT_CHANGED':recovering?'ABANDONED':answer?'ACCEPTED':'UNAVAILABLE'};
    return {completed:changed.count===1,cancelled:!valid,...(recovering&&valid&&changed.count?{fallback:true}:{})};
   },{isolationLevel:'Serializable',timeout:5000});
   // A successful SQL callback is not proof that the transaction committed.
   try{logger.info('NVA_AI_COMPLETION',completionEvent);}catch{ /* Diagnostics cannot change a committed decision. */ }
   return result;
  }catch{
   logger.warn('NVA_AI_COMPLETION_FAILED',{reason:'API_OR_CONTEXT_UNAVAILABLE'});
   // DB/context failure is not a verified reply. No transaction or API retry.
   const cancelled=await database.whatsAppConversationMessage.updateMany({where:owned,data:{deliveryStatus:'CANCELLED',failureCode:'AI_COMPLETION_FAILED',aiClaimToken:null}});
   return cancelled.count?{cancelled:true}:{completed:false,cancelled:false,superseded:true};
  }
 }
 return {completeReply};
}
module.exports={createQuestionAICompletionService};
