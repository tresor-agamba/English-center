const {analyzeMessage,normalize,answers,isRefusal}=require('./whatsappCommercialIntents');
const {resolveCourse,commercialAnswer}=require('./whatsappCommercialPolicy');
const COURSE_TOPICS=new Set(['PRICING','PAYMENT_TERMS','FREE_TRIAL','TRAINING_DURATION','CERTIFICATION','CERTIFICATE_COST']);
const DYNAMIC=new Set(['SESSION_START_DATE','AVAILABLE_SESSIONS','TRAINING_SCHEDULE']);
const question=text=>/[?？]/.test(text)||/^(?:et |combien|quel|quand|comment|pourquoi|est ce|vous |je peux|puis je|les cinq|les 5|ca dure)/.test(normalize(text));
const collecting=active=>active&&!['MENU','DONE','FREE','INVITE','METHOD'].includes(active.step);
function identityInput(text,active){return active?.step==='NAME'&&!isRefusal(text)&&!question(text)&&/^\p{L}[\p{L}'’ -]+\s\p{L}[\p{L}'’ -]*$/u.test(String(text||'').trim())&&!/\b(?:menu|annuler|abandonner|conseiller|humain|inscrire|site|whatsapp|merci|pas|non)\b/.test(normalize(text));}
async function respond({text,state,active,send,menu,catalog,registration,now,schedules,info}){
 if(active?.step==='EMAIL'&&String(text).includes('@')||identityInput(text,active))return null;
 const a=analyzeMessage(text,{registrationMethod:active?.step==='METHOD'});let intents=a.intents;
 if(a.ambiguity==='REGISTRATION_METHOD')return send('Pour éviter de choisir à votre place, quelle méthode souhaitez-vous utiliser ?','METHOD',[['online','Via le site'],['admin','Via WhatsApp'],['menu','Menu']]);
 if(active?.pendingIntents?.length){
  const candidates=await catalog.listPublished();const selected=resolveCourse(text,candidates,{}).course;
  if(selected&&normalize(selected.title).split(' ').some(w=>w.length>3&&normalize(text).split(' ').includes(w))){
   state={...state,selectedCourseId:selected.id,selectedCourseSlug:selected.slug||null};
   intents=[...active.pendingIntents,...(active.pendingRegistration?['REGISTRATION']:[])];
  }
 }
 if(intents.includes('REFUSAL')||intents.includes('CANCEL_REQUEST')){
  const r=send('Votre choix est respecté. Aucune nouvelle demande ne sera transmise. Vous pourrez reprendre quand vous le souhaiterez en écrivant « inscription ».','DONE',[['menu','Menu']]);r.state.admission.declined=true;return r;
 }
 if(intents.includes('HUMAN_ADVISOR'))return {text:'Votre demande est enregistrée pour un conseiller. Sa prise en charge reste à confirmer.',actions:[{type:'HUMAN_HANDOFF'}],state:{...state,automationPaused:true,step:'HUMAN_HANDOFF'}};
 if(intents.includes('MAIN_MENU'))return menu();
 if(intents.includes('GREETING')&&!collecting(active))return menu();
 const wantsMethod=intents.includes('REGISTRATION')&&!collecting(active);
 const method=()=>{const r=send('🎉 Excellent choix !\n\nPour faciliter votre inscription, deux possibilités s’offrent à vous :\n\n🌐 Vous inscrire personnellement sur notre site NVA.\n\n💬 Vous inscrire directement ici avec mon assistance.\n\n😊 Quelle méthode préférez-vous ?','METHOD',[['online','Via le site'],['admin','Via WhatsApp'],['menu','Menu']]);r.state.admission.declined=false;return r;};
 if(intents.includes('REGISTRATION_WEBSITE'))return send('Inscrivez-vous sur https://www.newvisionacademy.org/register depuis le site officiel https://www.newvisionacademy.org. Je reste disponible pour vous accompagner.','METHOD',[['admin','Via WhatsApp'],['menu','Menu']]);
 if(intents.includes('REGISTRATION_WHATSAPP'))return send('Acceptez-vous la collecte temporaire de vos coordonnées pour préparer votre demande ? Rien ne sera transmis avant votre confirmation finale.','CONSENT',[['accept','J’accepte'],['cancel','Annuler']]);
 if(collecting(active)&&!question(text))return null;
 if(intents.includes('TRAINING_LIST')||intents.includes('TRAINING_INFORMATION'))return info('catalog');
 const supported=intents.filter(i=>answers[i]||DYNAMIC.has(i));
 if(!supported.length){if(wantsMethod)return method();return null;}
 const courses=await catalog.listPublished();let course;
 if(supported.some(i=>COURSE_TOPICS.has(i)||DYNAMIC.has(i))){
  const resolution=resolveCourse(text,courses,state);course=resolution.course;
  if(!course&&(resolution.unavailable||supported.some(i=>COURSE_TOPICS.has(i)))){const body=courses.length?'Pour quelle formation souhaitez-vous ces informations ?\n'+courses.slice(0,8).map(c=>'• '+c.title).join('\n'):'Aucune formation publiée actuellement. Un conseiller peut vous renseigner.';
   if(collecting(active))return {text:body,actions:[],state};
   const r=send(body,'FREE',[['question','Préciser ma question'],['menu','Menu']]);r.state.admission.pendingIntents=supported;r.state.admission.pendingRegistration=wantsMethod;return r;
  }
 }
 let dynamic=[];if(supported.some(i=>DYNAMIC.has(i)))dynamic=await registration.listCoursesForPublicRegistration();
 if(course)dynamic=dynamic.filter(c=>c.id===course.id);
 const body=supported.map(i=>{
  if(DYNAMIC.has(i))return dynamic.length?dynamic.map(c=>{const s=c.session;const date=s?.startDate?new Date(s.startDate).toLocaleDateString('fr-FR',{timeZone:s.timezone||'Africa/Kinshasa'}):'date non publiée';return c.title+' — début : '+date+'\n'+schedules([c]);}).join('\n\n'):'Aucune session ouverte actuellement. Vous pouvez demander un conseiller.';
  return COURSE_TOPICS.has(i)?commercialAnswer(i,course,now()):answers[i];
 }).filter(Boolean).join('\n\n');
 if(collecting(active))return {text:body+'\n\nVotre saisie est conservée. Vous pouvez poursuivre l’étape en cours ou écrire « menu ».',actions:[],state};
 const r=wantsMethod?method():send(body,'FREE',active?.declined?[['question','Autre question'],['menu','Menu']]:[['registration','M’inscrire'],['question','Autre question'],['menu','Menu']]);
 if(wantsMethod){r.text=body+'\n\n'+r.text;if(r.interactive&&r.text.length<=1024)r.interactive.body.text=body+'\n\n'+r.interactive.body.text;else r.interactive=null;}
 if(course){r.state.selectedCourseId=course.id;r.state.selectedCourseSlug=course.slug||null;}
 return r;
}
module.exports={respond,question,identityInput};
