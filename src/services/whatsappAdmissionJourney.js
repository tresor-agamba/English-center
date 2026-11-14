const prospect=require('./whatsappProspectInformation');
const {randomUUID}=require('node:crypto');
const {normalizeText}=require('./whatsappConversationEngine');
const {validateInteractive}=require('./whatsappInteractive');
const {accessLimits}=require('./courseStructureService');
const {normalizePhoneNumber,isValidWhatsAppPhoneNumber}=require('../utils/phoneNumber');
const LEVELS={BEGINNER:'Débutant',INTERMEDIATE:'Intermédiaire',ADVANCED:'Avancé',UNKNOWN:'Je ne connais pas mon niveau'};
// Mandatory communication rule; does not control certificate issuance.
const CERTIFICATION_RULE='Formation complète : trois niveaux, soit 48 séances. Certificat NVA uniquement après les trois niveaux, sous réserve des conditions de certification. Aucun certificat à la fin d’un seul niveau.';
const CERTIFICATION_LEVELS='Niveau 1 → Niveau 2 → Niveau 3 (16 séances par niveau).';
const DEFAULTS={certificationIntro:'NVA propose des formations d’anglais pratiques, 100 % en ligne et certifiantes.',certificationLabel:'Formation certifiante',certificationNotice:'Un certificat NVA peut être délivré à l’issue de la formation, conformément aux conditions de certification définies par l’académie. Sa délivrance n’est pas automatique.',welcome:'👋 Bienvenue chez *NEW VISION ACADEMY (NVA)* ! 🎓\n\n🌍 New Vision Academy est un centre de formation *100 % en ligne*, proposant des formations d’anglais certifiantes, pratiques et interactives.\n\n🎯 Parlez anglais avec confiance pour vos études, votre carrière et vos opportunités professionnelles.\n💻 Apprenez où que vous soyez grâce à nos cours en direct et à distance.',catalog:'📚 Nos formations pratiques et interactives sont accessibles en ligne.',price:'💰 TARIFS NEW VISION ACADEMY',schedule:'🕒 HORAIRES DES FORMATIONS NVA',registration:'📝 INSCRIPTIONS NEW VISION ACADEMY\n🚀 Rejoignez notre centre de formation 100 % en ligne.',promotion:'🎁 {{trialOffer}}',invitation:'Souhaitez-vous commencer votre inscription ?',name:'Quel est votre nom complet ?',phone:'Confirmez votre numéro WhatsApp ci-dessous, ou saisissez le bon numéro au format international.',level:'Quel est votre niveau actuel en anglais ?',advisor:'👨‍💼 ASSISTANCE NEW VISION ACADEMY\nNotre équipe vous accompagne dans votre inscription.',confirm:'Confirmez-vous l’envoi de votre demande d’inscription à l’équipe New Vision Academy ?'};
function invalid(message){return Object.assign(new Error(message),{statusCode:400})}
function validateContent(body){const result={};for(const key of Object.keys(DEFAULTS)){const value=body[key]??DEFAULTS[key];if(typeof value!=='string'||!value.trim()||value.length>700||/\x00/.test(value))throw invalid('Contenu invalide : '+key);const prose=value.replace(/100\s*%/g,'');if(/\d|\b(USD|EUR|CDF|dollars?|euros?|Friday|Saturday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|gratuites?|essais?)\b/i.test(prose))throw invalid('Les chiffres, tarifs et horaires sont calculés depuis le catalogue. Utilisez {{trialOffer}} pour la promotion.');result[key]=value.trim();}if(result.certificationIntro.length>180||result.certificationLabel.length>80||result.certificationNotice.length>260||result.certificationLabel.length+result.certificationNotice.length+result.promotion.replace('{{trialOffer}}',trialOffer([{accessPolicy:'LEGACY_STAGED'}])).length+result.invitation.length>550)throw invalid('Raccourcissez les mentions de certification, la promotion ou l’invitation pour le message interactif.');if(!result.promotion.includes('{{trialOffer}}'))throw invalid('Conservez {{trialOffer}} dans la promotion.');return result;}
function identity(data,{requireEmail=true}={}){
 if(!data||['fullName','phoneNumber','requestedLevel'].some(k=>typeof data[k]!=='string'))throw invalid('Coordonnées invalides.');
 if(requireEmail&&typeof data.email!=='string')throw invalid('Adresse e-mail invalide.');
 const fullName=String(data.fullName||'').trim().replace(/\s+/g,' '),email=requireEmail?data.email.trim().toLowerCase():'',phoneNumber=normalizePhoneNumber(data.phoneNumber);
 if(fullName.length<3||fullName.length>120||!fullName.includes(' ')||/[\d<>\x00-\x1f]/.test(fullName))throw invalid('Saisissez votre nom et prénom (3 à 120 caractères).');
 if(!isValidWhatsAppPhoneNumber(phoneNumber))throw invalid('Numéro WhatsApp invalide.');
 if(requireEmail&&(email.length>254||!email||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))throw invalid('Adresse e-mail invalide.');
 if(!Object.hasOwn(LEVELS,data.requestedLevel))throw invalid('Niveau invalide.');return {fullName,...(requireEmail?{email}:{}),phoneNumber,requestedLevel:data.requestedLevel};
}
const DAYS={monday:'lundi',tuesday:'mardi',wednesday:'mercredi',thursday:'jeudi',friday:'vendredi',saturday:'samedi',sunday:'dimanche',mon:'lundi',tue:'mardi',wed:'mercredi',thu:'jeudi',fri:'vendredi',sat:'samedi',sun:'dimanche'};
function frenchDay(day){const n=normalizeText(day);return DAYS[n]||(['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(n)?n:'jour non renseigné');}
function trialOffer(courses){const eligible=courses.filter(c=>require('./whatsappCommercialPolicy').englishCourse(c)&&accessLimits(c).trial===5);return eligible.length?prospect.FREE_TRIAL:'Les conditions d’essai dépendent de la formation choisie ; un conseiller vous les précisera.';}
function prices(courses,now=new Date()){return courses.map(c=>require('./whatsappCommercialPolicy').commercialAnswer('PRICING',c,now)).join('\n\n')||'Aucun tarif publié actuellement.';}
function schedules(courses){return courses.slice(0,8).map(c=>{const session=c.session;if(!session)return '• '+c.title+' : aucune session ouverte.';const groups=(session.registrationGroups||[]).filter(g=>g.isActive&&!g.isFull&&g.startTime&&g.endTime);const slots=groups.length?groups:(!session.registrationGroups?.length&&session.startTime&&session.endTime?[session]:[]);
 const lines=slots.map(g=>(g.weekDays||[]).map(frenchDay).join(' et ')+' : '+g.startTime+' – '+g.endTime);return '• '+c.title+'\n'+(lines.join('\n')||'Aucun créneau disponible confirmé.');}).join('\n\n')||'Aucune session ouverte aux inscriptions.';}
function createAdmissionJourney({database,catalog,registration,now=()=>new Date(),token=()=>randomUUID(),conversationTtlMs=86400000}={}){
 if(!Number.isFinite(conversationTtlMs)||conversationTtlMs<60000||conversationTtlMs>604800000)throw new TypeError('Durée de conversation invalide.');
 async function resolve({text,interactionId,state,phoneNumber,messageId,intent,isFirstContact,registrationAction=null,informationBody=null,publicAppUrl=process.env.PUBLIC_APP_URL}){
  if(!database?.whatsAppChatbotSettings)return null;const settings=await database.whatsAppChatbotSettings.findUnique({where:{id:1}});
  if((!settings?.admissionsEnabled||settings.enabled===false)&&!registrationAction)return null;
  if(interactionId&&!interactionId.startsWith('adm:'))return null;
  const c={...DEFAULTS,...(settings.admissionContent||{}),level:DEFAULTS.level};let active=state.admission;const normalized=normalizeText(text);
 if(active&&intent!=='GREETING'&&(!Number.isFinite(Date.parse(active.expiresAt))||Date.parse(active.expiresAt)<=+now())){active=null;state.admission=null;}
  const levelOptions=()=>Object.entries(LEVELS).map(([id,label])=>['level-'+id,id==='UNKNOWN'?'Je ne sais pas':label,id]);
  // Retire the legacy field without consuming the inbound as personal data.
  if(active?.step==='EMAIL'){active={...active,step:'LEVEL',options:levelOptions().map(([id,label,value])=>({id,label,value,wireId:'adm:'+id+':'+token()}))};state={...state,admission:active};}
  let certificationExplained=active?.certificationExplained===true;
  const send=(body,step,choices=[],draft={},extra={})=>{
   const t=token(),options=choices.map(([id,label,value])=>({id,label,value:value||id,wireId:'adm:'+id+':'+t}));
   let interactive=null;if(options.length&&body.length<=1024){const useButtons=options.length<=3&&options.every(o=>[...o.label].length<=20);interactive=useButtons?{type:'button',body:{text:body},action:{buttons:options.map(o=>({type:'reply',reply:{id:o.wireId,title:o.label}}))}}:{type:'list',body:{text:body},action:{button:'Voir les options',sections:[{title:'Options',rows:options.map(o=>({id:o.wireId,title:o.label}))}]}};interactive=validateInteractive(interactive);}
   const fallback=body+(options.length?'\n\n'+options.map((o,i)=>(i+1)+'. '+o.label).join('\n')+'\nRépondez par numéro.':'');
   return {text:fallback.slice(0,4000),interactive,actions:[],state:{...state,mode:state.mode==='QUESTION_AI'?state.mode:null,questionAIStartedAt:state.mode==='QUESTION_AI'?state.questionAIStartedAt:null,pendingQuestion:null,scenarioMenu:null,admission:{step,draft,options,consultationOptions:[...(active?.consultationOptions||[]),...(active?.options||[]).filter(o=>['catalog','price','schedule','trial','question','menu'].includes(o.value)).map(o=>({...o,expiresAt:active.expiresAt}))].filter(o=>Date.parse(o.expiresAt)>+now()),certificationExplained,declined:active?.declined===true,expiresAt:new Date(+now()+conversationTtlMs).toISOString()}},...extra};
  };
  const allCourses=()=>catalog.listPublished();
  const openSessions=async()=>registration.listSessionsForPublicRegistration
   ? registration.listSessionsForPublicRegistration()
   : (await registration.listCoursesForPublicRegistration()).filter(c=>c.session).map(c=>({...c.session,course:c}));

  // PUBLIC_APP_URL is the existing public registration origin configuration.
  const websiteBase=String(publicAppUrl||'').replace(/\/+$/, '')==='https://www.newvisionacademy.org' ? String(publicAppUrl).replace(/\/+$/, '') : 'https://www.newvisionacademy.org';
  const viaWebsite=async()=>{
   const availability=await prospect.readAvailability(registration);
   const lead=availability.error?'Impossible de vérifier les sessions ouvertes actuellement. Consultez le formulaire officiel :':!availability.courses.some(course=>course.session)?'Aucune session n’est ouverte aux inscriptions actuellement. Consultez le formulaire officiel pour connaître les prochaines ouvertures :':'Pour vous inscrire à New Vision Academy, remplissez le formulaire en ligne :';
   const result=send(lead+'\n'+websiteBase.replace(/\/+$/, '')+'/register\n\nSur le site, indiquez votre numéro de téléphone et choisissez un mot de passe. Ces deux identifiants vous permettront de vous connecter à votre espace étudiant.','DONE');
   result.state={...result.state,mode:null,questionAIStartedAt:null,pendingRegistrationOffer:null};
   return result;
  };
  const method=viaWebsite,viaWhatsApp=viaWebsite;
  if(intent==='ENGLISH_CAMPAIGN'){
   const result=send(c.welcome,'MENU',[['schedule','Voir les horaires'],['price','Voir le tarif'],['registration','S’inscrire']]);
   result.state={...result.state,preferredLanguage:'fr',mode:null,questionAIStartedAt:null,pendingRegistrationOffer:null,welcomeSentAt:state.welcomeSentAt||now().toISOString()};
   return result;
  }
  if(registrationAction||intent==='AI_REGISTRATION'||(active&&!['MENU','DONE','FREE','INVITE'].includes(active.step)))return viaWebsite();
  const menu=async(greeting=false)=>{
   const first=isFirstContact!==false&&!state.welcomeSentAt&&!state.processedMessageIds?.length&&!state.lastIntent&&!active;
   const english=state.preferredLanguage==='en';
   const introduction=english?'👋 Welcome to *New Vision Academy (NVA)*! We are an online training academy. Discover our courses and ask me your questions. 🎓\nhttps://www.newvisionacademy.org': '👋 Bienvenue chez *New Vision Academy (NVA)* ! Découvrez notre formation en ligne d’anglais général, avec exercices pratiques : trois niveaux, deux séances de 1h30 par semaine. Posez-moi vos questions. 🎓\nhttps://www.newvisionacademy.org';
   const menuText=english?'📋 *NVA MAIN MENU*\n\nWhat would you like to explore?':'📋 *MENU PRINCIPAL NVA*\n\nQue souhaitez-vous découvrir ?';
   const greetingLead=/\bbonsoir\b/.test(normalized)?'🌙 Bonsoir':/\bsalut\b/.test(normalized)?'👋 Salut':'👋 Bonjour';
   const greetingText=first?greetingLead.replace('Salut','Bonjour')+' et bienvenue à New Vision Academy !\nDécouvrez notre formation d’anglais en ligne. 🎁 Les 5 premières séances du niveau 1 sont gratuites et font partie des 16 séances.\nComment puis-je vous aider ?':greetingLead+', ravi de vous revoir !\nComment puis-je vous aider ?';
   const result=send(greeting?greetingText:first?introduction:menuText,'MENU',first&&!greeting
    ? [['registration',"📝 S'inscrire"],['question','💬 Poser une question']]
    : [['catalog',english?'Our courses':'Nos formations'],['registration',english?'Register':"S'inscrire"],['question',english?'Ask a question':'Poser une question']]);
   if(active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step))result.state.admission={...active,consultationOptions:[...(active.consultationOptions||[]),...result.state.admission.options.map(o=>({...o,expiresAt:active.expiresAt}))]};
   result.state.mode=null;result.state.questionAIStartedAt=null;
   if(first)result.state.welcomeSentAt=now().toISOString();
   return result;
  };
  const info=async (topic,answer)=>{
   const courses=await allCourses();
   let body,availability;
   if(topic==='answer')body=answer;
   else if(topic==='catalog')body=(c.catalog===DEFAULTS.catalog?'📚 Nos formations':c.catalog)+'\n\n'+courses.slice(0,8).map(x=>require('./whatsappCommercialPolicy').officialEnglishCourse(x)?'• '+x.title.slice(0,100)+'\n'+prospect.TRAINING:'• '+x.title+(x.shortDescription?' — '+x.shortDescription:'')).join('\n');
   else if(topic==='price')body=prices(courses,now());
   else if(topic==='schedule'){availability=await prospect.readAvailability(registration);body=prospect.scheduleInformation(availability,schedules);}
   else body=c.registration;
   if(active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step))return resume(body);
   if(topic==='catalog'&&courses.some(require('./whatsappCommercialPolicy').officialEnglishCourse))body=body.slice(0,650)+'\n\nCertificat NVA après les trois niveaux, sous réserve des conditions de certification.';
   if(active?.declined)return send(body,'FREE',[['question','Autre question'],['menu','Menu']]);
   availability=availability||await prospect.readAvailability(registration);
   if(availability.error||!availability.courses.length)return send((topic==='schedule'||/Impossible de vérifier l’état des inscriptions|Aucune session ouverte/.test(body)?body:body+'\n\n'+(availability.error?'Impossible de vérifier l’état des inscriptions actuellement.':'Aucune session ouverte aux inscriptions actuellement.'))+' Un conseiller peut vous aider.','FREE',[['advisor','Parler à un conseiller'],['menu','Menu']]);
   const choices=[['registration',"S’inscrire"]];
   if(topic==='catalog'||topic==='schedule')choices.push(['price','Tarifs'],['schedule','Horaires'],['trial','Essai gratuit']);
   return send(body+(active?.step==='INVITE'?'':'\n\n📝 Souhaitez-vous vous inscrire ?'),'INVITE',choices);

  };
  const resume=()=>viaWebsite();
  if(typeof informationBody==='string'&&informationBody.trim())return info('answer',informationBody);
  if(!interactionId && ['GREETING','THANKS'].includes(intent)) {
   const returningGreeting=(/\bbonsoir\b/.test(normalized)?'🌙 Bonsoir':/\bsalut\b/.test(normalized)?'👋 Salut':'👋 Bonjour')+', ravi de vous revoir !';
   if(active && !['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step))return resume(intent==='THANKS'?'Avec plaisir ! 😊':returningGreeting);
   if(intent==='THANKS')return {text:'Avec plaisir ! 😊 Je reste disponible pour vos questions.',actions:[],state};
   if(active?.step==='METHOD')return resume(returningGreeting);
   return menu(true);
  }
  if(['annuler','abandonner'].includes(normalized))return send('Votre saisie a été annulée. Aucune nouvelle demande n’a été transmise.','DONE',[['menu','Menu principal']]);
  if(/^(menu|accueil|menu principal|retour au menu(?: principal)?)$/.test(normalized))return menu();
  if(!interactionId){
   const commercial=await require('./whatsappCommercialResponder').respond({text,state,active,send,menu,catalog,registration,now,schedules,info,registrationNavigation:{method,viaWebsite,viaWhatsApp}});
   if(commercial){if(active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step)&&!commercial.actions?.length&&commercial.state.admission?.step===active.step)return resume(commercial.text);return commercial;}
  }
  if(!active){if(interactionId?.startsWith('adm:'))return send('⚠️ Ce choix a expiré. Revenez au menu.','DONE',[['menu','Menu principal']]);if(['bonjour','bonsoir','salut','hello'].includes(normalized))return menu();if(['formations','formation','cours'].includes(normalized))return info('catalog');if(['prix','tarifs','tarif'].includes(normalized))return info('price');if(['horaires','horaire'].includes(normalized))return info('schedule');if(['inscription','inscriptions'].includes(normalized))return info('registration');return null;}
  let value=null;
  if(interactionId){const chosen=active.options?.find(o=>o.wireId===interactionId)||(active.consultationOptions||[]).find(o=>o.wireId===interactionId&&Date.parse(o.expiresAt)>+now());if(!chosen)return send('⚠️ Ce choix a expiré. Revenez au menu.','DONE',[['menu','Menu principal']]);value=chosen.value;}
  else if(/^[1-9]\d?$/.test(normalized)&&active.options?.length)value=active.options[Number(normalized)-1]?.value;
  else if(active.step==='INVITE'&&['oui','non'].includes(normalized))value=normalized==='oui'?'yes':'no';
  else if(active.step==='CONSENT'&&['oui','non'].includes(normalized))value=normalized==='oui'?'accept':'cancel';
  else if(active.step==='REVIEW'&&['oui','je confirme','confirmer'].includes(normalized))value='confirm';
  else value=active.options?.find(o=>normalizeText(o.label)===normalized)?.value;
  if(value==='menu')return menu();
  if(value==='catalog')return info('catalog');
  if(value==='question'){
   if(active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step))return resume('Quelle est votre question sur NVA ?');
   const result=send('Je suis votre assistant virtuel NVA. Quelle est votre question ? Évitez de partager vos coordonnées personnelles. Une aide IA peut être utilisée.','FREE');
    result.state.mode='QUESTION_AI';result.state.questionAIStartedAt=now().toISOString();return result;
  }
  if(active.step==='FREE'&&!value)return null;
  if(!interactionId&&active.step==='METHOD'){
   if(/whatsapp|deuxieme|option 2/.test(normalized))value='admin';
   else if(/site|premiere|option 1/.test(normalized))value='online';
  }
  if(value==='registration')return active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step)?resume('Votre dossier est déjà en cours.'):method();
  if(value==='admin')return viaWhatsApp();
  if(value==='online')return viaWebsite();
  if(['price','schedule'].includes(value))return info(value);
  if(value==='trial')return resolve({text:{trial:'essai gratuit',price:'tarifs',schedule:'horaires'}[value],state:{...state,admission:{...active,step:'FREE'}},phoneNumber,messageId,intent});
  if(['MENU','DONE'].includes(active.step)&&!interactionId){const topic={formations:'catalog',formation:'catalog',cours:'catalog',prix:'price',tarifs:'price',horaires:'schedule',inscription:'registration',inscriptions:'registration'}[normalized];if(topic)return info(topic);if(!value)return null;}
  if(value==='advisor')return {text:c.advisor+'\nUn conseiller prendra en charge votre demande selon les disponibilités de l’équipe.',actions:[{type:'HUMAN_HANDOFF'}],state:{...state,admission:null,automationPaused:true,step:'HUMAN_HANDOFF'}};
  if(active.step==='MENU'&&['catalog','price','schedule','registration'].includes(value))return info(value);
  if(active.step==='INVITE'){
   if(value==='no'){const r=send('😊 Merci pour votre intérêt envers New Vision Academy ! Revenez au menu pour découvrir nos services.','DONE',[['menu','Menu principal']]);r.state.admission.declined=true;return r;}
   if(value==='yes')return method();
  }
  return send('Choisissez une option du menu.','DONE',[['menu','Menu principal']]);
 }
 async function resolveUnknown({state}){
  const settings=await database?.whatsAppChatbotSettings?.findUnique({where:{id:1}});
  if(!settings?.admissionsEnabled||settings.enabled===false)return null;
  const previous=state.admission;
  const failures=previous?.step==='FREE'&&Date.parse(previous.expiresAt)>+now()?(previous.failures||0)+1:1;
  if(failures>=3)return {text:'Je ne parviens pas à comprendre votre demande. Je l’enregistre pour un conseiller ; la prise en charge reste à confirmer.',actions:[{type:'HUMAN_HANDOFF'}],state:{...state,automationPaused:true,step:'HUMAN_HANDOFF',admission:null}};
  return {text:'Je suis l’assistant virtuel NVA. Pouvez-vous reformuler votre question sur les formations, les tarifs, les horaires ou les inscriptions ? Écrivez « conseiller » pour une assistance humaine.',actions:[],state:{...state,admission:{step:'FREE',draft:{},options:[],failures,declined:previous?.declined===true,expiresAt:new Date(+now()+conversationTtlMs).toISOString()}}};
 }
 return {resolve,resolveUnknown};
}
module.exports={CERTIFICATION_RULE,CERTIFICATION_LEVELS,createAdmissionJourney,DEFAULTS,LEVELS,identity,validateContent,prices,schedules,frenchDay,trialOffer};
