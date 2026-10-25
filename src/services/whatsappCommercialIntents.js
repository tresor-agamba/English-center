// Deterministic linguistic provider: bounded lexical evidence, no AI or network.
function normalize(v){return String(v||'').slice(0,8000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim();}
function distance(a,b){let r=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,r[j]+1,r[j-1]+(a[i-1]===b[j-1]?0:1));r=n;}return r[b.length];}
const vocabulary=['bonjour','bonsoir','tarifs','horaires','inscription','certificat','gratuit','paiement','formation','commence'];
function corrected(v){return normalize(v).split(' ').map(w=>{if(w.length<6||vocabulary.some(k=>w.startsWith(k)||k.startsWith(w)))return w;const c=vocabulary.filter(k=>Math.abs(k.length-w.length)<=1&&distance(k,w)===1);return c.length===1?c[0]:w;}).join(' ');}
function registrationChannels(v){
 const t=normalize(v),mentions=[...t.matchAll(/\b(site|whatsapp|whats app)\b/g)];
 const positive=new Set(),negative=new Set();let previous=0;
 for(const m of mentions){
  const id=m[0]==='site'?'REGISTRATION_WEBSITE':'REGISTRATION_WHATSAPP';
  const prefix=t.slice(previous,m.index).split(/\b(?:mais|ou|et|finalement|cependant)\b/).at(-1);
  const neg=/\b(?:sans|pas|jamais|ni|eviter|refuse|exclu\w*)\b(?: [a-z]+){0,5}\s*$/.test(prefix);
  (neg?negative:positive).add(id);previous=m.index+m[0].length;
 }
 return {positive:[...positive],negative:[...negative]};
}
function isRefusal(v){const t=normalize(v);const channels=registrationChannels(t);if(channels.positive.length===1&&channels.negative.length&& !/\b(?:decline|refuse) (?:votre |toute |l |une )?(?:proposition|offre|inscription)\b/.test(t))return false;return /\b(non merci|pas maintenant|pas pour l instant|pas interesse|pas interessee|ne m interesse pas|prefere attendre|vais reflechir|veux reflechir|besoin de reflechir|je refuse|je decline|nous declinons|je rejette)\b/.test(t)||/\b(?:ne |n )?(?:veux|souhaite|desire|choisis|choisit|prends|confirme|accepte)\b.{0,25}\bpas\b/.test(t)||/\b(?:veux|souhaite)\b.{0,20}\bplus\b/.test(t);}
const THRESHOLD=0.75;
function analyzeMessage(value,context={}){
 const t=corrected(value),scores={};let ambiguity=null;const add=(id,s=0.95)=>{scores[id]=Math.max(scores[id]||0,s);};
 const result=intents=>({intents,confidence:intents[0]==='UNKNOWN'?0:Math.min(...intents.map(id=>scores[id]||1)),needsClarification:intents[0]==='UNKNOWN',ambiguity,evidence:scores,normalized:t});
 if(!t)return result(['UNKNOWN']);
 if(/^(?:je veux |je souhaite )?(annuler|abandonner|annule|abandonne)(?: ma (?:demande|inscription))?$/.test(t)){add('CANCEL_REQUEST');return result(['CANCEL_REQUEST']);}
 if(isRefusal(t)){add('REFUSAL');return result(['REFUSAL']);}
 if(/\b(?:conseiller|conseillere|humain|humaine|responsable|administratif|administrative|administration)\b/.test(t)||/\b(?:parler|echanger|discuter|contact|joindre|appeler|passer la main)\b.{0,50}\b(?:quelqu un|personne|equipe|agent)\b/.test(t)||/\bpersonne reelle\b/.test(t)||/\b(?:probleme|souci|erreur|echec|bloque|debite|recu|remboursement)\b.{0,45}\b(?:paiement|paye|recu|argent)\b/.test(t)||/\b(?:paiement|paye)\b.{0,45}\b(?:probleme|souci|erreur|echec|recu|remboursement)\b/.test(t)){
  if(!/\b(?:pas|sans) (?:de |un )?(?:conseiller|humain)\b/.test(t)){add('HUMAN_ADVISOR');return result(['HUMAN_ADVISOR']);}
 }
 if(/\b(menu|accueil)\b/.test(t)||/\bchoix principaux\b/.test(t)){add('MAIN_MENU');return result(['MAIN_MENU']);}
 const registration=/\b(?:inscri\w*|rejoindre|devenir etudiant|devenir eleve|demarches)\b/.test(t);
 const status=/\b(?:statut|suivi|en attente|ou en est|ou en sont|deja envoye|deja envoyee)\b/.test(t)&&/\b(?:inscri\w*|demande|dossier)\b/.test(t);
 const ordinal1=context.registrationMethod&&/\b(premier|premiere|1|numero un)\b/.test(t),ordinal2=context.registrationMethod&&/\b(second|seconde|deuxieme|2|numero deux)\b/.test(t);
 const methodWords=registration||context.registrationMethod||/\b(prefere|via|choisis|choix|utiliser|passer|formulaire|rester|aide)\b/.test(t);
 const channels=registrationChannels(t);
 if(methodWords&&channels.positive.length>1){ambiguity='REGISTRATION_METHOD';return result(['UNKNOWN']);}
 if(status)add('REGISTRATION_STATUS');
 else if(methodWords&&channels.positive.length===1)add(channels.positive[0]);
 else if(methodWords&&channels.negative.length){ambiguity='REGISTRATION_METHOD';return result(['UNKNOWN']);}
 else if(ordinal1||/\bsite\b/.test(t)&&methodWords)add('REGISTRATION_WEBSITE');
 else if(ordinal2||/\b(?:whatsapp|whats app)\b/.test(t)&&methodWords)add('REGISTRATION_WHATSAPP');
 else if(registration)add('REGISTRATION');
 const certificate=/\b(certificat\w*|certification|certifie\w*|certifiant\w*|attestation|diplome|accredit\w*|international\w*)\b/.test(t);
 const money=/\b(prix|tarif\w*|cout\w*|coute\w*|budget|montant|supplement|frais|payant\w*)\b/.test(t)||/\bcombien\b.{0,45}\b(?:formation|cours|niveau|parcours|certificat|document|certification)\b/.test(t)&&! /\b(?:seances|heures|minutes|niveaux|temps)\b/.test(t)||/\bcombien ca\b/.test(t);
 const payment=/\b(pay\w*|paie\w*|solde|moitie|acompte|echeance|regler|versement\w*|fractionne\w*|impaye\w*)\b/.test(t)||/\b(?:trente|30) dollars\b/.test(t);
 const certificateCost=certificate&&(money||payment||/\bcombien\b/.test(t));
 if(certificateCost)add('CERTIFICATE_COST');else if(certificate)add('CERTIFICATION');
 const coursePrice=/\b(?:prix|tarif\w*|cout\w*|coute\w*)\b.{0,35}\b(?:formation|cours|parcours|niveau)\b/.test(t);
 if(money&&(!certificateCost||coursePrice))add('PRICING');
 const trial=/\b(gratuit\w*|essai\w*|essayer|offert\w*)\b/.test(t)||/\b(?:cinq|5)\b.{0,25}\b(?:seances|cours|premieres)\b/.test(t)||/\btester\b.{0,30}\b(?:sans|argent|avant)\b/.test(t);
 if(payment&&!certificateCost)add('PAYMENT_TERMS');
 if(trial&&(!payment||/\b(?:et|aussi|profiter)\b/.test(t)))add('FREE_TRIAL');
 const duration=/\b(duree|dure|durent)\b/.test(t)||/\b(?:combien|nombre)\b.{0,30}\b(?:temps|heures|minutes|seances|niveaux)\b/.test(t)||/\b(?:seize|16|quarante huit|48)\b.{0,20}\b(?:lecons|seances)\b/.test(t)||/\b(?:heure et demie|1h30|1 h 30)\b/.test(t);
 if(duration&&!trial&&!money||/\b(duree|dure|durent)\b/.test(t))add('TRAINING_DURATION');
 const schedule=/\b(horaire\w*|creneau\w*|planning)\b/.test(t)||/\bemploi du temps\b/.test(t)||/\b(?:quels|quelles)\b.{0,15}\b(?:jours|heures)\b/.test(t)||/\b(?:matin|soir|dix huit heures|18h|10h)\b/.test(t)&&/\b(?:cours|choisir|disponible|possible|seance)\b/.test(t);
 if(schedule)add('TRAINING_SCHEDULE');
 const start=/\b(?:debut|demarrage|rentree|commencement|prochaine session)\b/.test(t)||/\b(?:commence\w*|demarre\w*|debute\w*)\b/.test(t)&&!registration&&!/\b(?:adulte|debutant|pedagogie|ordinateur)\b/.test(t)||/\b(?:premier cours|premiere seance)\b/.test(t)&&/\b(date|quand|jour)\b/.test(t);
 if(start)add('SESSION_START_DATE');
 if(/\b(?:session\w*|groupe\w*|places?)\b/.test(t)&&/\b(?:disponible\w*|ouverte\w*|ouverts|ouvert|acceptent|candidats|encore|complets?|restante\w*)\b/.test(t))add('AVAILABLE_SESSIONS');
 if(/\b(?:en ligne|distance|presentiel|internet|locaux|physiquement|deplacer|autre ville)\b/.test(t)&&!scores.REGISTRATION_WEBSITE)add('ONLINE_LEARNING');
 if((/\b(?:methode\w*|pedagog\w*|enseign\w*|professeur|exercices|conversation|petits groupes|individuellement)\b/.test(t)||/\bcomment\b.{0,40}\b(?:cours|apprenez|apprendre)\b/.test(t))&&!schedule&&!ordinal1&&!ordinal2)add('TEACHING_METHOD');
 if(/\b(?:catalogue|programmes)\b/.test(t)||/\b(?:formations|cours)\b/.test(t)&&/\b(?:quelles?|quels|enumerer|liste|nos|differentes|toutes|propose\w*|comparer)\b/.test(t))add('TRAINING_LIST');
 if(/\b(anglais|english)\b/.test(t))add('ENGLISH_TRAINING');
 if(/\b(?:formation\w*|renseignement\w*|information\w*)\b/.test(t))add('TRAINING_INFORMATION',0.8);
 if(/\b(?:bonjour|bonsoir|salut|hello|coucou|bon apres midi)\b/.test(t))add('GREETING');
 if(/\b(?:merci|remercie)\b/.test(t))add('THANKS');
 if(/\b(?:au revoir|a (?:tres )?bientot|a demain|je vous laisse)\b/.test(t)||/\b(?:bonne|excellente)\b.{0,15}\b(?:journee|soiree)\b/.test(t))add('GOODBYE');
 if(!Object.keys(scores).length&&/\b(?:quand|comment|combien|option|choix)\b/.test(t))add('TRAINING_INFORMATION',0.4);
 if(t!==normalize(value))for(const id of Object.keys(scores))scores[id]=Math.min(scores[id],0.8);
 let intents=Object.keys(scores).filter(id=>scores[id]>=THRESHOLD);
 if(intents.length>1)intents=intents.filter(id=>!['TRAINING_INFORMATION','ENGLISH_TRAINING','GREETING','THANKS'].includes(id));
 const order=['REGISTRATION_STATUS','REGISTRATION_WEBSITE','REGISTRATION_WHATSAPP','REGISTRATION','CERTIFICATE_COST','CERTIFICATION','PAYMENT_TERMS','FREE_TRIAL','TRAINING_DURATION','SESSION_START_DATE','AVAILABLE_SESSIONS','TRAINING_SCHEDULE','PRICING','ONLINE_LEARNING','TEACHING_METHOD','ENGLISH_TRAINING','TRAINING_LIST','TRAINING_INFORMATION','GREETING','THANKS','GOODBYE'];
 return result(intents.length?intents.sort((a,b)=>order.indexOf(a)-order.indexOf(b)):['UNKNOWN']);
}
const detectIntents=(v,c)=>analyzeMessage(v,c).intents;
const answers={
 PAYMENT_TERMS:'Pour l’anglais NVA : après les cinq séances gratuites, payez au minimum 30 USD (50 % des 60 USD du niveau) pour continuer. Les 30 USD restants doivent être intégralement payés AVANT la fin des 16 séances du niveau.',
 FREE_TRIAL:'Les cinq premières séances du niveau 1 d’anglais sont gratuites et incluses dans ses 16 séances. Elles ne sont pas supplémentaires : il reste ensuite 11 séances.',
 TRAINING_DURATION:'Chaque niveau d’anglais comprend 16 séances de 1 h 30, soit 24 heures. Les trois niveaux comprennent 48 séances, soit 72 heures.',
 PRICING:'La formation d’anglais coûte 60 USD par niveau, soit 180 USD pour trois niveaux. Le certificat NVA coûte 20 USD supplémentaires : le parcours complet avec certificat revient à 200 USD.',
 CERTIFICATE_COST:'Le certificat NVA coûte 20 USD supplémentaires. Le parcours de trois niveaux avec certificat revient à 200 USD.',
 CERTIFICATION:'Le certificat est délivré par New Vision Academy après l’achèvement des trois niveaux, sous réserve des conditions administratives applicables. Aucune reconnaissance internationale, accréditation externe ou équivalence à un diplôme officiel n’est établie ici.',
 ONLINE_LEARNING:'NVA est un centre de formation 100 % en ligne.',TEACHING_METHOD:'NVA propose des formations pratiques en ligne. Un conseiller peut préciser les méthodes pédagogiques de la formation choisie.',THANKS:'Avec plaisir ! Je reste disponible pour vos questions.',GOODBYE:'À bientôt chez New Vision Academy !',REGISTRATION_STATUS:'Je ne peux pas confirmer une inscription à partir de ce message. Un conseiller peut vérifier votre demande en toute sécurité.',
};
module.exports={normalize,detectIntents,analyzeMessage,isRefusal,registrationChannels,answers,distance,THRESHOLD};
