// A veto only: matching a keyword must never authorize an enrollment action.
// Positive interpretation belongs to OpenAI; consent and submission to backend.
const {isRefusal,normalize}=require('./whatsappCommercialIntents');
function vetoRegistration(value){
 const text=normalize(value);
 return !text || /^[\d\s.,]+$/.test(text) || isRefusal(text)
  || /\b(?:prefere|souhaite|veux) (?:encore )?reflechir\b|\b(?:seulement|juste|uniquement) (?:des |les |de l )?(?:informations|renseignements|prix|tarifs)\b/.test(text)
  || /\b(?:prix|tarifs|informations)\b.*\bavant de (?:decider|m inscrire)\b/.test(text)
  || /\b(?:pas maintenant|pas encore|plus tard|not now|not yet|later|only information|just information|just prices|only prices|think about it|before (?:i )?decid\w*)\b/.test(text)
  || /\b(?:don t|do not|not|never)\b.{0,45}\b(?:register|enrol\w*|sign up)\b/.test(text)
  || /^(?:comment|combien|quels? documents|quelles? pieces|how|what documents|how much)\b/.test(text);
}
module.exports={vetoRegistration};
