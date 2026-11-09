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
  if(!settings?.admissionsEnabled||settings.enabled===false)return null;
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
   return {text:fallback.slice(0,4000),interactive,actions:[],state:{...state,mode:step==='FREE'?state.mode:null,questionAIStartedAt:step==='FREE'?state.questionAIStartedAt:null,pendingQuestion:null,scenarioMenu:null,admission:{step,draft,options,consultationOptions:[...(active?.consultationOptions||[]),...(active?.options||[]).filter(o=>['catalog','price','schedule','trial','question','menu'].includes(o.value)).map(o=>({...o,expiresAt:active.expiresAt}))].filter(o=>Date.parse(o.expiresAt)>+now()),certificationExplained,declined:active?.declined===true,expiresAt:new Date(+now()+conversationTtlMs).toISOString()}},...extra};
  };
  const allCourses=()=>catalog.listPublished();
  const openSessions=async()=>registration.listSessionsForPublicRegistration
   ? registration.listSessionsForPublicRegistration()
   : (await registration.listCoursesForPublicRegistration()).filter(c=>c.session).map(c=>({...c.session,course:c}));

  const method=async()=>{const availability=await prospect.readAvailability(registration);if(availability.error||!availability.courses.length)return send((availability.error?'Impossible de vérifier l’état des inscriptions actuellement.':'Aucune session ouverte aux inscriptions actuellement.')+' Un conseiller peut vous aider.','METHOD',[['advisor','Parler à un conseiller'],['menu','Menu']]);return send(state.preferredLanguage==='en'?'🎉 Choose registration on our official website or guided registration here on WhatsApp. 😊':'🎉 Pour votre inscription, choisissez le site officiel ou mon assistance sur WhatsApp. 😊','METHOD',[['online',state.preferredLanguage==='en'?'Via website':'Via le site'],['admin','Via WhatsApp'],['menu','Menu']]);};
  const websiteBase=publicAppUrl||'https://www.newvisionacademy.org';
  const viaWebsite=()=>send('Complétez le formulaire officiel puis choisissez votre formation et une session disponible :\n'+websiteBase.replace(/\/+$/, '')+'/register','DONE',[['menu','Menu principal']]);
  const consent=(draft={})=>send('Acceptez-vous la collecte temporaire de vos coordonnées pour préparer votre demande ? Rien ne sera transmis à l’équipe avant votre confirmation finale. Annulez à tout moment ; saisie valable 24 h.','CONSENT',[['accept','J’accepte'],['cancel','Annuler']],draft);
  const viaWhatsApp=async()=>{
   const draft={...active?.draft};
   try{
    const courses=await allCourses();
    const chosen=courses.find(x=>x.id===(draft.courseId||state.selectedCourseId))||(courses.length===1?courses[0]:null);
    if(!chosen){if(!courses.length)return send('Aucune formation ouverte aux inscriptions.','METHOD',[['advisor','Parler à un conseiller'],['menu','Menu']],draft);return send('Choisissez votre formation avant de vérifier les inscriptions.','AVAILABILITY_COURSE',courses.slice(0,10).map(x=>['available-'+x.id,x.title.slice(0,24),String(x.id)]),draft);}
    draft.courseId=chosen.id;draft.courseTitle=chosen.title;
    const sessions=await openSessions();
    if(!sessions.some(x=>x.course?.id===chosen.id))return send('Aucune session ouverte aux inscriptions pour cette formation.','METHOD',[['advisor','Parler à un conseiller'],['menu','Menu']],draft);
    return consent(draft);
   }catch{return send('La disponibilité n’a pas pu être vérifiée. Réessayez ou parlez à un conseiller.','METHOD',[['admin','Via WhatsApp'],['advisor','Parler à un conseiller'],['menu','Menu']],draft);}
  };
  if(registrationAction){
   if(!['CHOOSE_METHOD','WEBSITE','WHATSAPP'].includes(registrationAction))throw invalid('Transition d’inscription invalide.');
   if(require('./whatsappRegistrationTransition').isCollecting(state))return null;
   state={...state,mode:null,questionAIStartedAt:null,pendingRegistrationOffer:null};
   const result=await {CHOOSE_METHOD:method,WEBSITE:viaWebsite,WHATSAPP:viaWhatsApp}[registrationAction]();
   result.state.admission.declined=false;return result;
  }
  if(intent==='AI_REGISTRATION')return method();
  const review=draft=>send('Récapitulatif :\n'+draft.fullName+'\n'+draft.phoneNumber+'\nNiveau actuel : '+LEVELS[draft.requestedLevel]+(draft.courseTitle?'\nFormation : '+draft.courseTitle:'')+(draft.sessionLabel?'\nSession : '+draft.sessionLabel:'\nAucune session sélectionnée : demande à examiner par un conseiller.')+'\n\n'+c.confirm,'REVIEW',[['confirm','CONFIRMER'],['modify','MODIFIER']],draft);
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
   const choices=[['admin','Via WhatsApp'],['online','Via le site']];
   if(topic==='catalog'||topic==='schedule')choices.push(['price','Tarifs'],['schedule','Horaires'],['trial','Essai gratuit']);
   return send(body+'\n\n📝 Comment souhaitez-vous vous inscrire ?','INVITE',choices);

  };
  const resume=body=>{
   const prompt={NAME:c.name,PHONE:c.phone,LEVEL:c.level,COURSE:'Choisissez votre formation.',AVAILABILITY_COURSE:'Choisissez votre formation.',SESSION:'Choisissez votre session.',GROUP:'Choisissez votre créneau.',REVIEW:c.confirm,CONSENT:'Acceptez-vous la collecte temporaire de vos coordonnées ?',EDIT:'Quel champ souhaitez-vous corriger ?',METHOD:'Choisissez votre inscription via WhatsApp ou via le site.'}[active?.step];
   const result=send(body+'\n\nPour reprendre votre inscription, '+(prompt?prompt[0].toLowerCase()+prompt.slice(1):'poursuivez le choix en cours.'),active.step,(active.options||[]).filter(o=>o.value!=='EMAIL').map(o=>[o.id,o.label,o.value]),{...active.draft});
   result.state.admission={...active,options:result.state.admission.options,expiresAt:Date.parse(active.expiresAt)>+now()?active.expiresAt:result.state.admission.expiresAt};return result;
  };
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
  if(active.step==='AVAILABILITY_COURSE'&&value){state={...state,selectedCourseId:Number(value)};return viaWhatsApp();}
  if(active.step==='METHOD'){
   if(value==='online')return viaWebsite();
   if(value==='admin')return viaWhatsApp();
   return method();
  }
  if(active.step==='CONSENT'&&value==='cancel')return send('Collecte annulée.','DONE',[['menu','Menu principal']]);
  if(active.step==='CONSENT'&&value==='accept')return send(c.name,'NAME',[],{...active.draft,consentToCollect:true});
  let draft={...active.draft};
  if(draft.consentToCollect&&['modifier','corriger'].includes(normalized)||active.step==='REVIEW'&&value==='modify')return send('Quel champ souhaitez-vous corriger ?','EDIT',[['edit-name','Nom','NAME'],['edit-phone','WhatsApp','PHONE'],['edit-level','Niveau','LEVEL']],draft);
  if(active.step==='EDIT'&&value==='EMAIL')return send(c.level,'LEVEL',levelOptions(),{...active.draft});
  if(active.step==='EDIT'&&['NAME','PHONE','LEVEL'].includes(value))return send({NAME:c.name,PHONE:c.phone,LEVEL:c.level}[value],value,value==='LEVEL'?Object.entries(LEVELS).map(([id,label])=>['level-'+id,id==='UNKNOWN'?'Je ne sais pas':label,id]):[],draft);
  try{
   if(active.step==='NAME'){const name=String(text||'').trim().replace(/\s+/g,' ');if(name.length<3||name.length>120||!name.includes(' ')||/[\d<>\x00-\x1f]/.test(name))throw invalid('Indiquez votre nom et prénom.');draft.fullName=name;const candidate=draft.phoneNumber||phoneNumber;return send(c.phone+(candidate?'\n'+candidate:''),'PHONE',candidate?[['phone-confirm','Confirmer le numéro']]:[],{...draft,phoneCandidate:candidate});}
   if(active.step==='PHONE'){if(value!=='phone-confirm'&&!/^[+\d\s().-]+$/.test(String(text||'')))return resume('Souhaitez-vous poser une question ? Pouvez-vous préciser votre demande ?');const phone=normalizePhoneNumber(value==='phone-confirm'?draft.phoneCandidate:text);if(!isValidWhatsAppPhoneNumber(phone))throw invalid('Indiquez un numéro international valide, par exemple +243…');draft.phoneNumber=phone;delete draft.phoneCandidate;return send(c.level,'LEVEL',levelOptions(),draft);}
   if(active.step==='LEVEL'&&Object.hasOwn(LEVELS,value)){
    draft.requestedLevel=value;identity(draft,{requireEmail:false});const courses=await allCourses();
    if(!courses.length)return review(draft);
    return send('Choisissez votre formation parmi les formations actives.','COURSE',courses.slice(0,10).map((x,i)=>['course-'+x.id,(i+1)+'. '+[...x.title].slice(0,20).join(''),String(x.id)]),draft);
   }
   if(active.step==='COURSE'&&value){
    const course=(await allCourses()).find(x=>String(x.id)===value);if(!course)throw invalid('Cette formation n’est plus disponible. Revenez au menu.');
    draft.courseId=course.id;draft.courseTitle=course.title;delete draft.requestedSessionId;delete draft.requestedGroupId;delete draft.sessionLabel;
    const sessions=(await openSessions()).filter(x=>x.course?.id===course.id);
    if(!sessions.length)return send('Aucune session ouverte pour cette formation. Votre demande peut être examinée par un conseiller.','SESSION',[['wait','Demander un suivi']],draft);
    const lines=sessions.slice(0,10).map((x,i)=>`${i+1}. ${course.title} — niveau ${x.levelNumber||'non précisé'} — ${new Date(x.startDate).toLocaleDateString('fr-FR',{timeZone:x.timezone||'Africa/Kinshasa'})}${x.endDate?' au '+new Date(x.endDate).toLocaleDateString('fr-FR'):''}\n${schedules([{...course,session:x}])}${Number.isFinite(x.remainingPlaces)?'\nPlaces : '+x.remainingPlaces:''}`);
    return send(lines.join('\n\n'),'SESSION',sessions.slice(0,10).map((x,i)=>['session-'+x.id,'Session '+(i+1),String(x.id)]),draft);
   }
   if(active.step==='SESSION'&&value){
    if(value==='wait')return review(draft);
    const session=(await openSessions()).find(x=>String(x.id)===value&&x.course?.id===draft.courseId);
    if(!session)throw invalid('Cette session n’est plus disponible. Revenez au menu pour recommencer.');
    draft.requestedSessionId=session.id;draft.sessionLabel='Niveau '+(session.levelNumber||'non précisé')+' — '+new Date(session.startDate).toLocaleDateString('fr-FR')+' — '+schedules([{...session.course,session}]);
    const groups=(session.registrationGroups||[]).filter(g=>g.isActive&&!g.isFull);
    if(groups.length)return send('Choisissez votre créneau :\n'+groups.slice(0,10).map((g,i)=>(i+1)+'. '+g.name+' — '+(g.weekDays||[]).map(frenchDay).join(', ')+' '+g.startTime+'–'+g.endTime).join('\n'),'GROUP',groups.slice(0,10).map((g,i)=>['group-'+g.id,'Créneau '+(i+1),String(g.id)]),draft);
    return review(draft);
   }
   if(active.step==='GROUP'&&value){
    const session=(await openSessions()).find(x=>x.id===draft.requestedSessionId&&x.course?.id===draft.courseId);
    const group=session?.registrationGroups?.find(g=>String(g.id)===value&&g.isActive&&!g.isFull);
    if(!group)throw invalid('Ce créneau n’est plus disponible. Revenez au menu.');
    draft.requestedGroupId=group.id;draft.sessionLabel+='\nCréneau choisi : '+group.name+' '+group.startTime+'–'+group.endTime;
    return review(draft);
   }
   if(active.step==='REVIEW'&&value==='confirm'){
    const data=identity(draft,{requireEmail:false});if(!draft.consentToCollect)throw invalid('Consentement manquant.');
    let finalSessions;try{finalSessions=await openSessions();}catch{return resume('La disponibilité n’a pas pu être vérifiée. Aucune demande transmise.');}
    if(!draft.requestedSessionId){
     if(!draft.courseId){const courses=await allCourses();return send('Choisissez votre formation. Vos coordonnées sont conservées.','COURSE',courses.slice(0,10).map((x,i)=>['course-'+x.id,(i+1)+'. '+x.title.slice(0,20),String(x.id)]),draft);}
     const sessions=finalSessions.filter(x=>x.course?.id===draft.courseId);
     if(!sessions.length)return resume('Aucune session ouverte pour ce dossier. Aucune demande transmise. Écrivez « conseiller » pour obtenir de l’aide.');
     return send('Choisissez une session ouverte avant de confirmer. Vos coordonnées sont conservées.','SESSION',sessions.slice(0,10).map((x,i)=>['session-'+x.id,'Session '+(i+1),String(x.id)]),draft);
    }
    if(draft.requestedSessionId){
     const available=finalSessions.find(x=>x.id===draft.requestedSessionId&&x.course?.id===draft.courseId);
     if(!available)throw invalid('La session sélectionnée n’est plus disponible. Revenez au menu.');
     if(draft.requestedGroupId&&!available.registrationGroups?.some(g=>g.id===draft.requestedGroupId&&g.isActive&&!g.isFull))throw invalid('Le créneau sélectionné n’est plus disponible. Revenez au menu.');
    }
    return {...send('Votre demande sera enregistrée en attente de validation administrative. Elle ne confirme pas encore une inscription.','DONE',[['menu','Menu principal']]),actions:[{type:'ADMISSION_REQUEST',data:{...data,...(draft.requestedSessionId?{requestedSessionId:draft.requestedSessionId}:{}),...(draft.requestedGroupId?{requestedGroupId:draft.requestedGroupId}:{}),...(draft.courseId?{courseId:draft.courseId}:{})},sourceMessageId:messageId,consentVersion:'admissions-v1'}]};
   }
  }catch(e){if(e.statusCode!==400)throw e;return send('⚠️ '+e.message,active.step,active.options.filter(o=>o.value!=='EMAIL').map(o=>[o.id,o.label,o.value]),draft);}
  if(['NAME','PHONE','LEVEL','REVIEW','EDIT','CONSENT','COURSE','SESSION','GROUP'].includes(active.step))return send('Votre inscription est en cours. '+({NAME:c.name,PHONE:c.phone,LEVEL:c.level,REVIEW:c.confirm,EDIT:'Choisissez le champ à corriger.',CONSENT:'Confirmez ou annulez la collecte.',COURSE:'Choisissez une formation dans la liste, ou écrivez « menu ».',SESSION:'Choisissez une session dans la liste, ou écrivez « menu ».',GROUP:'Choisissez un créneau dans la liste, ou écrivez « menu ».'}[active.step]),active.step,active.options.filter(o=>o.value!=='EMAIL').map(o=>[o.id,o.label,o.value]),draft);
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
