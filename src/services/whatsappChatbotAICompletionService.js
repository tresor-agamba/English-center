// Finishes an already committed reply; never performs HTTP in a SQL transaction.
const {lockRecipients}=require('./whatsappSubmissionCoordinator');
const {createOpenAIService}=require('./whatsappChatbotOpenAIService');
const {AI_FALLBACK}=require('./whatsappChatbotService');
const MARKERS=['AI_PENDING','AI_PROCESSING'];
function createAICompletionService({database,env=process.env,ai=createOpenAIService({database,env}),now=()=>new Date()}={}){
 async function completeReply(idempotencyKey){
  if(env.NVA_CHATBOT_AI_ENABLED!=='true'||!env.OPENAI_API_KEY||!env.OPENAI_MODEL)return {skipped:true};
  const message=await database.whatsAppConversationMessage.findUnique({where:{idempotencyKey},include:{conversation:true}});
  if(!message||message.direction!=='OUTBOUND'||message.deliveryStatus!=='QUEUED'||!MARKERS.includes(message.failureCode))return {skipped:true};
  if(message.failureCode==='AI_PROCESSING'){
   // A crashed owner is never retried against OpenAI. Release only the safe fallback.
   if(message.updatedAt && +now()-+message.updatedAt>120000){
    await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',failureCode:'AI_PROCESSING',updatedAt:message.updatedAt},data:{body:AI_FALLBACK,failureCode:null}});
    return {fallback:true};
   }
   return {busy:true};
  }
  const claim=await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'AI_PENDING'},data:{failureCode:'AI_PROCESSING'}});
  if(!claim.count)return {busy:true};
  try{
   const expectedInbound=idempotencyKey.startsWith('wa-reply:')?idempotencyKey.slice(9,-2):'';
   const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
   const latest=await database.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
   const active=message.conversation?.controlState==='BOT_ACTIVE'&&!message.conversation.engineState?.optedOut&&!message.conversation.engineState?.automationPaused;
   const eligible=active&&settings?.enabled!==false&&settings?.aiEnabled&&latest?.providerMessageId===expectedInbound&&latest.messageType==='TEXT';
   const rules=eligible?await database.whatsAppChatbotRule.findMany({where:{kind:'FAQ',enabled:true},orderBy:[{priority:'desc'},{id:'asc'}],take:20}):[];
   // No transaction or recipient lock exists during this call or the quota reservation.
   const answer=eligible?await ai.select(latest.body,rules):null;
   const chosen=answer?rules.find(r=>r.body===answer):null;
   return await database.$transaction(async tx=>{
    await lockRecipients(tx,[message.conversation.phoneNumber]);
    const conversation=await tx.whatsAppConversation.findUnique({where:{id:message.conversationId}});
    const current=await tx.whatsAppConversationMessage.findFirst({where:{conversationId:message.conversationId,direction:'INBOUND'},orderBy:{id:'desc'}});
    const config=await tx.whatsAppChatbotSettings.findUnique({where:{id:1}});
    const valid=conversation?.controlState==='BOT_ACTIVE'&&!conversation.engineState?.optedOut&&!conversation.engineState?.automationPaused
      &&current?.id===latest?.id&&current?.providerMessageId===expectedInbound&&config?.enabled!==false;
    const rule=chosen?await tx.whatsAppChatbotRule.findUnique({where:{id:chosen.id}}):null;
    const body=config?.aiEnabled&&rule?.enabled&&rule.kind==='FAQ'&&rule.body===chosen.body&&rule.title===chosen.title?rule.body:AI_FALLBACK;
    const changed=await tx.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'AI_PROCESSING'},data:valid?{body,failureCode:null}:{deliveryStatus:'CANCELLED',failureCode:'AI_CONTEXT_CHANGED'}});
    return {completed:changed.count===1,cancelled:!valid};
   });
  }catch{
   // An API/DB failure cannot recreate an inbound or send a message. Keep a safe body.
   await database.whatsAppConversationMessage.updateMany({where:{id:message.id,deliveryStatus:'QUEUED',attempts:0,failureCode:'AI_PROCESSING'},data:{deliveryStatus:'CANCELLED',failureCode:'AI_COMPLETION_FAILED'}});
   return {cancelled:true};
  }
 }
 return {completeReply};
}
module.exports={createAICompletionService};
