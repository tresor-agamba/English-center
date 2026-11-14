// Reconstructed from durable, successfully sent bot messages, never queued prose.
const {normalize}=require('./whatsappCommercialIntents');
const SENT=['ACCEPTED','SENT','DELIVERED','READ'];
function fromMessage(message,now=new Date()){
 if(!message||!SENT.includes(message.deliveryStatus)||!message.body||!message.idempotencyKey)return null;
 const age=+now-Date.parse(message.createdAt);if(!Number.isFinite(age)||age<0||age>86400000)return null;
 const questions=String(message.body).match(/[^.!?\n]*[?？]/g);if(!questions?.length)return null;
 const question=questions.at(-1).trim(),t=normalize(question);
 const topic=/horaire|creneau|schedule|time slot|disponib/.test(t)?'SCHEDULE':/formation|cours|course|training/.test(t)?'COURSE':'OTHER';
 const action=require('./whatsappRegistrationTransition').legacyInvitation({...message,body:question},now)?'REGISTER':null;
 const expected=/souhaitez|voulez|avez vous|acceptez|confirmez|would you|do you|are you/.test(t)?'YES_NO':'DETAIL';
 return {replyKey:message.idempotencyKey,expiresAt:new Date(Date.parse(message.createdAt)+86400000).toISOString(),topic,expected,action,question};
}
function polarity(text){
 const t=normalize(text);
 if(/^(non|no|non merci|no thanks|pas vraiment|aucun|aucun en particulier)$/.test(t))return 'NO';
 if(/^(oui|yes|ok|okay|d accord|bien sur|volontiers|avec plaisir|oui merci|oui svp|oui s il vous plait|yes please|oui j en veux|j en veux|oui je veux bien|je veux bien|ca m interesse|cela m interesse)[.! ]*$/.test(t))return 'YES';
 return null;
}
function contextualReply(text,context,language='fr'){
 const p=polarity(text),en=language==='en';if(!p)return null;
 if(!context)return en?'What would you like more information about?':'Sur quel sujet souhaitez-vous des précisions ?';
 if(context.action==='REGISTER')return null;
 if(context.topic==='SCHEDULE'){
  if(p==='NO')return en?'All right, no particular time slot.':'D’accord, aucun créneau en particulier.';
  return en?'Which time slot would you like information about?':'Sur quel créneau souhaitez-vous des informations ?';
 }
 if(context.topic==='COURSE'&&p==='YES')return en?'Which course would you like more details about?':'Sur quelle formation souhaitez-vous plus de détails ?';
 if(p==='NO')return en?'All right.':'D’accord.';
 return en?'What would you like more information about?':'Sur quel sujet souhaitez-vous des précisions ?';
}
function safeFallback(question,language,facts=[],context){
 const conversational=contextualReply(question,context,language);if(conversational)return conversational;
 const t=normalize(question),en=language==='en';let suffix;
 if(/prix|tarif|cout|budget|price|cost/.test(t))suffix='price';
 else if(/soir|evening/.test(t))suffix='evening_schedule';
 else if(/horaire|creneau|schedule/.test(t))suffix='usual_schedule';
 else if(/cours.*comment|comment.*cours|deroul|training/.test(t))suffix='course';
 if(!suffix)return null;
 const selected=facts.filter(f=>f.id.endsWith('_'+suffix));
 if(selected.length===1){
  const missing=/garderie|creche/.test(t)?(en?'childcare':'la garderie'):/transport/.test(t)?(en?'transport':'le transport des apprenants'):null;
  return selected[0][en?'en':'fr']+(missing?(en?' Confirmed information about '+missing+' is missing.':' L’information confirmée sur '+missing+' manque dans les données NVA vérifiées.'):'');
 }
 if(selected.length>1)return en?'Which course would you like information about?':'Pour quelle formation souhaitez-vous ces informations ?';
 return en?`The ${suffix==='price'?'published price':suffix.includes('schedule')?'confirmed schedule':'course description'} is not available in the verified NVA data.`:`${suffix==='price'?'Le tarif publié':suffix.includes('schedule')?'L’horaire confirmé':'La présentation de la formation'} manque dans les données NVA vérifiées. Écrivez « conseiller » pour le vérifier.`;
}
module.exports={fromMessage,polarity,contextualReply,safeFallback};
