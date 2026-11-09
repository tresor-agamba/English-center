// Presentation only: never decorate labels, IDs, facts or persisted journey values.
// Include flags and keycaps without mistaking ordinary digits for emojis.
const EMOJI=/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/u;
function emojiFor(text){
 const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/erreur|invalide|indiquez un numero international valide|impossible|pas pu|ne peux pas|indisponible|plus disponible|aucune session|cannot|unavailable|invalid|error/.test(t))return '⚠️';
 if(/consent|collecte|acceptez|autorisez|privacy/.test(t))return '🔒';
 if(/bonjour|bienvenue|hello|welcome|salut/.test(t))return '👋';
 if(/horaire|creneau|heure|planning|schedule|hours/.test(t))return '🕒';
 if(/essai|gratuit|trial|free session/.test(t)&&!/tarif|prix|paiement|pay|usd/.test(t))return '🎁';
 if(/tarif|prix|paiement|payer|verse|solde|usd|payment|price/.test(t))return '💵';
 if(/e-mail|email|adresse electronique/.test(t))return '📧';
 if(/numero|telephone|phone number/.test(t))return '📞';
 if(/confirm|recapitulatif|enregistree/.test(t))return '✅';
 if(/inscri|nom complet|dossier|registration|full name|enroll/.test(t))return '📝';
 if(/\b(?:formations?|anglais|niveaux?|cours|training|english|courses?)\b/.test(t))return '📚';
 return 'ℹ️';
}
function fit(text,max){
 if(text.length<=max)return text;
 let out='';for(const char of text){if(out.length+char.length>max)break;out+=char;}return out;
}
function formatText(text,max=4000){
 if(typeof text!=='string'||!text.trim())return text;
 // Reuse an existing emoji; repeated formatting is deliberately idempotent.
 if(EMOJI.test(text)){
  const fitted=fit(text,max);
  return EMOJI.test(fitted)?fitted:fit(emojiFor(text)+' '+text,max);
 }
 const sections=text.split(/(\n\s*\n)/),used=new Set();let count=0;
 for(let i=0;i<sections.length&&count<3;i+=2){
  if(!sections[i].trim())continue;
  const emoji=emojiFor(sections[i]);
  if(used.has(emoji))continue;
  sections[i]=emoji+' '+sections[i];used.add(emoji);count++;
 }
 return fit(sections.join(''),max);
}
function formatReply(reply){
 if(!reply)return reply;
 return {...reply,text:formatText(reply.text),...(reply.interactive?{interactive:{...reply.interactive,body:{...reply.interactive.body,text:formatText(reply.interactive.body.text,1024)}}}:{})};
}
module.exports={formatText,formatReply,emojiFor};
