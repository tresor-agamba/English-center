const {randomUUID}=require('node:crypto');
const {Prisma}=require('@prisma/client');
const {normalizeText}=require('./whatsappConversationEngine');
const {validateInteractive}=require('./whatsappInteractive');
const {accessLimits}=require('./courseStructureService');
const {normalizePhoneNumber,isValidWhatsAppPhoneNumber}=require('../utils/phoneNumber');
const LEVELS={BEGINNER:'Débutant',INTERMEDIATE:'Intermédiaire',ADVANCED:'Avancé',UNKNOWN:'Je ne connais pas mon niveau'};
// Mandatory communication rule; does not control certificate issuance.
const CERTIFICATION_RULE='Formation complète : trois niveaux, soit 48 séances. Certificat NVA uniquement après les trois niveaux, sous réserve des conditions de certification. Aucun certificat à la fin d’un seul niveau.';
const CERTIFICATION_LEVELS='Niveau 1 → Niveau 2 → Niveau 3 (16 séances par niveau).';
const DEFAULTS={certificationIntro:'NVA propose des formations d’anglais pratiques, 100 % en ligne et certifiantes.',certificationLabel:'Formation certifiante',certificationNotice:'Un certificat NVA peut être délivré à l’issue de la formation, conformément aux conditions de certification définies par l’académie. Sa délivrance n’est pas automatique.',welcome:'👋 Bienvenue chez *NEW VISION ACADEMY (NVA)* ! 🎓\n\n🌍 New Vision Academy est un centre de formation *100 % en ligne*, proposant des formations d’anglais certifiantes, pratiques et interactives.\n\n🎯 Parlez anglais avec confiance pour vos études, votre carrière et vos opportunités professionnelles.\n💻 Apprenez où que vous soyez grâce à nos cours en direct et à distance.',catalog:'📚 Nos formations pratiques et interactives sont accessibles en ligne.',price:'💰 TARIFS NEW VISION ACADEMY',schedule:'🕒 HORAIRES DES FORMATIONS NVA',registration:'📝 INSCRIPTIONS NEW VISION ACADEMY\n🚀 Rejoignez notre centre de formation 100 % en ligne.',promotion:'🎁 {{trialOffer}}',invitation:'Souhaitez-vous commencer votre inscription ?',name:'Quel est votre nom complet ?',phone:'Confirmez votre numéro WhatsApp ci-dessous, ou saisissez le bon numéro au format international.',email:'Quelle est votre adresse e-mail ?',level:'Quel niveau d’anglais souhaitez-vous ?',advisor:'👨‍💼 ASSISTANCE NEW VISION ACADEMY\nNotre équipe vous accompagne dans votre inscription.',confirm:'Confirmez-vous l’envoi de votre demande d’inscription à l’équipe New Vision Academy ?'};
function invalid(message){return Object.assign(new Error(message),{statusCode:400})}
function validateContent(body){const result={};for(const key of Object.keys(DEFAULTS)){const value=body[key]??DEFAULTS[key];if(typeof value!=='string'||!value.trim()||value.length>700||/\x00/.test(value))throw invalid('Contenu invalide : '+key);const prose=value.replace(/100\s*%/g,'');if(/\d|\b(USD|EUR|CDF|dollars?|euros?|Friday|Saturday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|gratuites?|essais?)\b/i.test(prose))throw invalid('Les chiffres, tarifs et horaires sont calculés depuis le catalogue. Utilisez {{trialOffer}} pour la promotion.');result[key]=value.trim();}if(result.certificationIntro.length>180||result.certificationLabel.length>80||result.certificationNotice.length>260||result.certificationLabel.length+result.certificationNotice.length+result.promotion.replace('{{trialOffer}}',trialOffer([{accessPolicy:'LEGACY_STAGED'}])).length+result.invitation.length>550)throw invalid('Raccourcissez les mentions de certification, la promotion ou l’invitation pour le message interactif.');if(!result.promotion.includes('{{trialOffer}}'))throw invalid('Conservez {{trialOffer}} dans la promotion.');return result;}
function identity(data){
 if(!data||['fullName','phoneNumber','email','requestedLevel'].some(k=>typeof data[k]!=='string'))throw invalid('Coordonnées invalides.');
 const fullName=String(data.fullName||'').trim().replace(/\s+/g,' '),email=String(data.email||'').trim().toLowerCase(),phoneNumber=normalizePhoneNumber(data.phoneNumber);
 if(fullName.length<3||fullName.length>120||!fullName.includes(' ')||/[\d<>\x00-\x1f]/.test(fullName))throw invalid('Saisissez votre nom et prénom (3 à 120 caractères).');
 if(!isValidWhatsAppPhoneNumber(phoneNumber))throw invalid('Numéro WhatsApp invalide.');
 if(email.length>254||!email||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw invalid('Adresse e-mail invalide.');
 if(!Object.hasOwn(LEVELS,data.requestedLevel))throw invalid('Niveau invalide.');return {fullName,email,phoneNumber,requestedLevel:data.requestedLevel};
}
const DAYS={monday:'lundi',tuesday:'mardi',wednesday:'mercredi',thursday:'jeudi',friday:'vendredi',saturday:'samedi',sunday:'dimanche',mon:'lundi',tue:'mardi',wed:'mercredi',thu:'jeudi',fri:'vendredi',sat:'samedi',sun:'dimanche'};
function frenchDay(day){const n=normalizeText(day);return DAYS[n]||(['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(n)?n:'jour non renseigné');}
function trialOffer(courses){const eligible=courses.filter(c=>accessLimits(c).trial===5);return eligible.length?(eligible.some(c=>c.structureType==='LEVEL_BASED')?'Profitez de 5 séances d’essai gratuites, incluses dans les 16 séances du premier niveau des formations éligibles.':'Profitez de 5 séances d’essai gratuites sur les formations éligibles, selon les règles du catalogue.'):'Les conditions d’essai dépendent de la formation choisie ; un conseiller vous les précisera.';}
function prices(courses,now=new Date()){
 return courses.slice(0,8).map(c=>{const active=c.pricingActive&&c.pricingMode==='ONE_TIME'&&Number(c.price)>0&&(!c.pricingStartsAt||new Date(c.pricingStartsAt)<=now)&&(!c.pricingEndsAt||new Date(c.pricingEndsAt)>now);
 const lines=['• '+c.title+' : '+(active?Number(c.price).toLocaleString('fr-FR')+' '+c.currency+(c.structureType==='LEVEL_BASED'?' par niveau':' pour la formation'):'tarif non disponible, contactez un conseiller')];
 const sessions=c.sessionCount||(accessLimits(c).legacy?16:null);if(sessions)lines.push(sessions+' séances'+(c.structureType==='LEVEL_BASED'?' par niveau':''));
 if(active&&accessLimits(c).legacy)lines.push('Après l’essai : paiement minimum de '+new Prisma.Decimal(c.price).mul('0.5').toFixed(2).replace(/\.00$/,'')+' '+c.currency+' pour poursuivre jusqu’à la 10e séance.');
 const slots=(c.session?.registrationGroups||[]).filter(g=>g.isActive&&!g.isFull);const slot=slots[0]||c.session;
 if(slot?.startTime&&slot.endTime){const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));const duration=minute(slot.endTime)-minute(slot.startTime);if(duration>0&&slots.every(g=>minute(g.endTime)-minute(g.startTime)===duration))lines.push('Durée : '+Math.floor(duration/60)+' h '+String(duration%60).padStart(2,'0'));}
 const frequency=new Set(slot?.weekDays||[]).size;if(frequency&&slots.every(g=>new Set(g.weekDays||[]).size===frequency)){lines.push(frequency+' séances par semaine');if(sessions)lines.push('Durée indicative : '+Math.ceil(sessions/frequency)+' semaines');}return lines.join('\n');}).join('\n\n')||'Aucun tarif publié actuellement.';
}
function schedules(courses){return courses.slice(0,8).map(c=>{const session=c.session;if(!session)return '• '+c.title+' : aucune session ouverte.';const groups=(session.registrationGroups||[]).filter(g=>g.isActive&&!g.isFull&&g.startTime&&g.endTime);const slots=groups.length?groups:(!session.registrationGroups?.length&&session.startTime&&session.endTime?[session]:[]);
 const lines=slots.map(g=>(g.weekDays||[]).map(frenchDay).join(' et ')+' : '+g.startTime+' – '+g.endTime);return '• '+c.title+'\n'+(lines.join('\n')||'Aucun créneau disponible confirmé.');}).join('\n\n')||'Aucune session ouverte aux inscriptions.';}
function createAdmissionJourney({database,catalog,registration,now=()=>new Date(),token=()=>randomUUID()}={}){
 async function resolve({text,interactionId,state,phoneNumber,messageId}){
  if(!database?.whatsAppChatbotSettings)return null;const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
  if(!settings?.admissionsEnabled||settings.enabled===false)return null;
  if(interactionId&&!interactionId.startsWith('adm:'))return null;
  const c={...DEFAULTS,...(settings.admissionContent||{})};let active=state.admission;const normalized=normalizeText(text);
  if(active&&(!Number.isFinite(Date.parse(active.expiresAt))||Date.parse(active.expiresAt)<+now())){active=null;state.admission=null;}
  let certificationExplained=active?.certificationExplained===true;
  const send=(body,step,choices=[],draft={},extra={})=>{
   const t=token(),options=choices.map(([id,label,value])=>({id,label,value:value||id,wireId:'adm:'+id+':'+t}));
   let interactive=null;if(options.length){interactive=options.length<=3?{type:'button',body:{text:body.slice(0,1024)},action:{buttons:options.map(o=>({type:'reply',reply:{id:o.wireId,title:o.label}}))}}:{type:'list',body:{text:body.slice(0,1024)},action:{button:'Voir les options',sections:[{title:'Options',rows:options.map(o=>({id:o.wireId,title:o.label}))}]}};interactive=validateInteractive(interactive);}
   const fallback=body+(options.length?'\n\n'+options.map((o,i)=>(i+1)+'. '+o.label).join('\n')+'\nRépondez par numéro.':'');
   return {text:fallback.slice(0,4000),interactive,actions:[],state:{...state,pendingQuestion:null,scenarioMenu:null,admission:{step,draft,options,certificationExplained,expiresAt:new Date(+now()+86400000).toISOString()}},...extra};
  };
  const allCourses=()=>catalog.listPublished();
  const menu=async()=>{const courses=await allCourses();return send(c.welcome.slice(0,650)+(normalizeText(c.welcome).includes('certif')?'':'\n'+c.certificationIntro)+'\n\n'+c.promotion.replace('{{trialOffer}}',trialOffer(courses))+'\n\n👇 Sélectionnez une option ci-dessous.','MENU',[['catalog','📚 Formations'],['price','💰 Tarifs'],['schedule','🕒 Horaires'],['registration','📝 Inscriptions'],['advisor','👨‍💼 Conseiller']]);};
  const info=async topic=>{const courses=await allCourses();let body;if(topic==='catalog')body=c.catalog+'\n\n'+courses.slice(0,8).map(x=>'• '+x.title+(x.shortDescription?' — '+x.shortDescription:'')).join('\n');else if(topic==='price'){const open=await registration.listCoursesForPublicRegistration();body=c.price+'\n\n'+prices(courses.map(x=>({...x,session:open.find(y=>y.id===x.id)?.session})),now());}else if(topic==='schedule')body=c.schedule+'\n\n'+schedules(await registration.listCoursesForPublicRegistration());else body=c.registration;
   const certified=['catalog','price','registration'].includes(topic);
   const label=certified?c.certificationLabel+'\n'+(topic==='catalog'?CERTIFICATION_LEVELS+'\n':'')+CERTIFICATION_RULE+'\n':'';
   const notice=certified&&!certificationExplained?'\n\n'+c.certificationNotice:'';
   const suffix=notice+'\n\n'+c.promotion.replace('{{trialOffer}}',trialOffer(courses))+'\n'+c.invitation;
   if(certified)certificationExplained=true;
   return send(label+body.slice(0,Math.max(0,1024-label.length-suffix.length))+suffix,'INVITE',[['yes','✅ OUI'],['no','❌ NON']]);};
  if(['annuler','abandonner'].includes(normalized))return send('Votre saisie a été annulée. Aucune nouvelle demande n’a été transmise.','DONE',[['menu','Menu principal']]);
  if(/^(menu|accueil|menu principal|retour au menu(?: principal)?)$/.test(normalized))return menu();
  if(!active){if(interactionId?.startsWith('adm:'))return send('Ce choix a expiré. Revenez au menu.','DONE',[['menu','Menu principal']]);if(['bonjour','bonsoir','salut','hello'].includes(normalized))return menu();if(['formations','formation','cours'].includes(normalized))return info('catalog');if(['prix','tarifs','tarif'].includes(normalized))return info('price');if(['horaires','horaire'].includes(normalized))return info('schedule');if(['inscription','inscriptions'].includes(normalized))return info('registration');return null;}
  let value=null;
  if(interactionId){const chosen=active.options?.find(o=>o.wireId===interactionId);if(!chosen)return send('Ce choix a expiré. Revenez au menu.','DONE',[['menu','Menu principal']]);value=chosen.value;}
  else if(/^[1-9]\d?$/.test(normalized)&&active.options?.length)value=active.options[Number(normalized)-1]?.value;
  else if(active.step==='INVITE'&&['oui','non'].includes(normalized))value=normalized==='oui'?'yes':'no';
  else value=active.options?.find(o=>normalizeText(o.label)===normalized)?.value;
  if(value==='menu')return menu();
  if(['MENU','DONE'].includes(active.step)&&!interactionId){const topic={formations:'catalog',formation:'catalog',cours:'catalog',prix:'price',tarifs:'price',horaires:'schedule',inscription:'registration',inscriptions:'registration'}[normalized];if(topic)return info(topic);if(!value)return null;}
  if(value==='advisor')return {text:c.advisor+'\nUn conseiller prendra en charge votre demande selon les disponibilités de l’équipe.',actions:[{type:'HUMAN_HANDOFF'}],state:{...state,admission:null,automationPaused:true,step:'HUMAN_HANDOFF'}};
  if(active.step==='MENU'&&['catalog','price','schedule','registration'].includes(value))return info(value);
  if(active.step==='INVITE'){
   if(value==='no')return send('😊 Merci pour votre intérêt envers New Vision Academy ! Revenez au menu pour découvrir nos services.','DONE',[['menu','Menu principal']]);
   if(value==='yes')return send('🎉 Excellent choix ! Comment souhaitez-vous procéder ?','METHOD',[['online','🌐 En ligne'],['admin','👨‍💼 Par l’admin']]);
  }
  if(active.step==='METHOD'){
   if(value==='online')return send('Complétez le formulaire officiel puis choisissez votre formation et une session disponible :\nhttps://www.newvisionacademy.org/register','DONE',[['menu','Menu principal']]);
   if(value==='admin')return send('Acceptez-vous la collecte temporaire de vos coordonnées pour préparer votre demande ? Rien ne sera transmis à l’équipe avant votre confirmation finale. Annulez à tout moment ; saisie valable 24 h.','CONSENT',[['accept','J’accepte'],['cancel','Annuler']]);
  }
  if(active.step==='CONSENT'&&value==='cancel')return send('Collecte annulée.','DONE',[['menu','Menu principal']]);
  if(active.step==='CONSENT'&&value==='accept')return send(c.name,'NAME',[],{consentToCollect:true});
  let draft={...active.draft};
  if(draft.consentToCollect&&['modifier','corriger'].includes(normalized)||active.step==='REVIEW'&&value==='modify')return send('Quel champ souhaitez-vous corriger ?','EDIT',[['edit-name','Nom','NAME'],['edit-phone','WhatsApp','PHONE'],['edit-email','E-mail','EMAIL'],['edit-level','Niveau','LEVEL']],draft);
  if(active.step==='EDIT'&&['NAME','PHONE','EMAIL','LEVEL'].includes(value))return send({NAME:c.name,PHONE:c.phone,EMAIL:c.email,LEVEL:c.level}[value],value,value==='LEVEL'?Object.entries(LEVELS).map(([id,label])=>['level-'+id,id==='UNKNOWN'?'Je ne sais pas':label,id]):[],draft);
  try{
   if(active.step==='NAME'){const name=String(text||'').trim().replace(/\s+/g,' ');if(name.length<3||name.length>120||!name.includes(' ')||/[\d<>\x00-\x1f]/.test(name))throw invalid('Indiquez votre nom et prénom.');draft.fullName=name;const candidate=draft.phoneNumber||phoneNumber;return send(c.phone+(candidate?'\n'+candidate:''),'PHONE',candidate?[['phone-confirm','Confirmer le numéro']]:[],{...draft,phoneCandidate:candidate});}
   if(active.step==='PHONE'){const phone=normalizePhoneNumber(value==='phone-confirm'?draft.phoneCandidate:text);if(!isValidWhatsAppPhoneNumber(phone))throw invalid('Indiquez un numéro international valide, par exemple +243…');draft.phoneNumber=phone;delete draft.phoneCandidate;return send(c.email,'EMAIL',[],draft);}
   if(active.step==='EMAIL'){const email=String(text||'').trim().toLowerCase();if(email.length>254||!email||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw invalid('Adresse e-mail invalide.');draft.email=email;return send(c.level,'LEVEL',Object.entries(LEVELS).map(([id,label])=>['level-'+id,id==='UNKNOWN'?'Je ne sais pas':label,id]),draft);}
   if(active.step==='LEVEL'&&Object.hasOwn(LEVELS,value)){draft.requestedLevel=value;const data=identity(draft);return send('Récapitulatif :\n'+data.fullName+'\n'+data.phoneNumber+'\n'+data.email+'\nNiveau : '+LEVELS[data.requestedLevel]+'\n\n'+c.confirm,'REVIEW',[['confirm','CONFIRMER'],['modify','MODIFIER']],{...data,consentToCollect:true});}
   if(active.step==='REVIEW'&&value==='confirm'){
    const data=identity(draft);if(!draft.consentToCollect)throw invalid('Consentement manquant.');
    return {...send('✅ Votre demande d’inscription a été transmise avec succès ! Notre équipe vous contactera pour finaliser votre inscription.','DONE',[['menu','Menu principal']]),actions:[{type:'ADMISSION_REQUEST',data,sourceMessageId:messageId,consentVersion:'admissions-v1'}]};
   }
  }catch(e){if(e.statusCode!==400)throw e;return send(e.message,active.step,active.options.map(o=>[o.id,o.label,o.value]),draft);}
  if(['NAME','PHONE','EMAIL','LEVEL','REVIEW','EDIT','CONSENT'].includes(active.step))return send('Votre inscription est en cours. '+({NAME:c.name,PHONE:c.phone,EMAIL:c.email,LEVEL:c.level,REVIEW:c.confirm,EDIT:'Choisissez le champ à corriger.',CONSENT:'Confirmez ou annulez la collecte.'}[active.step]),active.step,active.options.map(o=>[o.id,o.label,o.value]),draft);
  return send('Choisissez une option du menu.','DONE',[['menu','Menu principal']]);
 }
 return {resolve};
}
module.exports={CERTIFICATION_RULE,CERTIFICATION_LEVELS,createAdmissionJourney,DEFAULTS,LEVELS,identity,validateContent,prices,schedules,frenchDay,trialOffer};
