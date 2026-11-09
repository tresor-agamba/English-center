// Only opens existing enrollment navigation. Never records consent or admission.
const {normalize,analyzeMessage,isRefusal}=require('./whatsappCommercialIntents');
const isCollecting=state=>Boolean(state.admission&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(state.admission.step));
const validOffer=(state,lastAssistantMessage,now)=>{
 const offer=state.pendingRegistrationOffer;
 return Boolean(offer&&offer.replyKey===lastAssistantMessage?.idempotencyKey
  &&Number.isFinite(Date.parse(offer.expiresAt))&&Date.parse(offer.expiresAt)>+now);
};
function legacyInvitation(message,now){
 if(!message?.body||!Number.isFinite(Date.parse(message.createdAt))||+now-Date.parse(message.createdAt)>86400000||+now<Date.parse(message.createdAt))return false;
 // Compatibility with already delivered AI invitations, without inferring consent from the prospect's history.
 const questions=String(message.body).match(/[^?]*\?/g)||[];
 if(questions.length!==1)return false;
 const text=normalize(questions[0]);
 return /\b(?:souhaitez vous|voulez vous|veux tu|would you like|do you want)\b.{0,110}\b(?:inscri\w*|registration|enroll\w*|sign up)\b/.test(text);
}
function resolveRegistrationTransition({text,state={},lastAssistantMessage,now=new Date()}){
 if(isCollecting(state))return null;
 const t=normalize(text);
 if(isRefusal(text)||/^(non|no|nope)$/.test(t))return null;
 const informational = require('./whatsappRegistrationActionPolicy').vetoRegistration(text) && !/^(comment (?:faire pour|je peux|puis je) m inscrire)/.test(t);
 if(informational)return null;
 const analysis=analyzeMessage(text,{registrationMethod:state.admission?.step==='METHOD'});
 if(analysis.intents.includes('REGISTRATION_STATUS'))return null;
 if(analysis.ambiguity==='REGISTRATION_METHOD')return 'CHOOSE_METHOD';
 if(analysis.intents.includes('REGISTRATION_WEBSITE'))return 'WEBSITE';
 if(analysis.intents.includes('REGISTRATION_WHATSAPP'))return 'WHATSAPP';
 const request=/^(?:(?:je veux|je souhaite|j aimerais|je voudrais) (?:m inscrire|inscrire)|m inscrire|inscris moi|i (?:want|would like) to (?:register|enrol\w*|sign up)|(?:comment (?:faire pour|je peux|puis je) m inscrire))(?:\b|$)/.test(t)
  ||/^(je veux|je souhaite|j aimerais|i want to|i would like to) (commencer|debuter|start|begin)( (maintenant|now|la formation|le cours))?$/.test(t);
 if(request)return 'CHOOSE_METHOD';
 const acceptance=/^(oui|oui merci|oui svp|oui je veux|oui je souhaite|d accord|ok|okay|yes|yes please|sure|je suis interesse|je suis interessee|ca m interesse)[.! ]*$/.test(t);
 if(!acceptance)return null;
 const active=state.admission;
 const pendingStep=active&&['INVITE','METHOD'].includes(active.step)&&Date.parse(active.expiresAt)>+now;
 const delivered=lastAssistantMessage&&['ACCEPTED','SENT','DELIVERED','READ'].includes(lastAssistantMessage.deliveryStatus);
 return delivered&&(pendingStep||validOffer(state,lastAssistantMessage,now)||legacyInvitation(lastAssistantMessage,now))?'CHOOSE_METHOD':null;
}
module.exports={isCollecting,resolveRegistrationTransition,legacyInvitation};
