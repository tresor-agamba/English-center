const {normalize,answers}=require('./whatsappCommercialIntents');
const {accessLimits}=require('./courseStructureService');
const englishCourse=c=>/\b(anglais|english)\b/.test(normalize((c?.title||'')+' '+(c?.slug||'')));
const officialEnglishCourse=c=>englishCourse(c)&&c.structureType==='LEVEL_BASED'&&c.numberOfLevels===3&&c.sessionCount===16;
const generic=new Set('formation formations cours de d du des en a l la le les professionnel professionnelle general generale nva'.split(' '));
function resolveCourse(text,courses,state={}){
 const t=normalize(text),tokens=t.split(' ');
 const full=courses.filter(c=>[normalize(c.title),normalize(c.slug)].some(name=>name&&(' '+t+' ').includes(' '+name+' ')));
 if(full.length===1)return {course:full[0]};
 if(full.length>1)return {clarify:true,candidates:full};
 const explicit=courses.filter(c=>normalize(c.title).split(' ').filter(w=>w.length>3&&!generic.has(w)).some(w=>tokens.includes(w)));
 if(explicit.length===1)return {course:explicit[0]};
 if(explicit.length>1)return {clarify:true,candidates:explicit};
 // A named, unavailable product must not silently inherit another product.
 const named=t.match(/\b(?:formation|cours) (?:de |d |en )?([a-z]+)$/);
 const questionWords=new Set('anglais cout coute coutez combien gratuit gratuite gratuitee prix tarif niveau temps duree certificat ligne total complete complet'.split(' '));
 if(named&&!questionWords.has(named[1])&&!generic.has(named[1]))return {clarify:true,unavailable:true,candidates:courses};
 const selected=courses.find(c=>c.id===state.selectedCourseId||c.id===state.admission?.draft?.courseId);
 if(selected)return {course:selected};
 if(courses.length===1)return {course:courses[0]};
 return {clarify:true,candidates:courses};
}
function publishedPrice(course,now=new Date()){
 if(!course||course.pricingActive!==true||course.pricingMode!=='ONE_TIME'||!Number.isFinite(Number(course.price))||Number(course.price)<=0||!(/^[A-Z]{3}$/).test(course.currency||'')||course.pricingStartsAt&&new Date(course.pricingStartsAt)>now||course.pricingEndsAt&&new Date(course.pricingEndsAt)<=now)return null;
 return Number(course.price)+' '+course.currency;
}
function commercialAnswer(intent,course,now){
 const english=officialEnglishCourse(course),price=publishedPrice(course,now);
 if(intent==='PRICING'){
  if(!price)return 'Le tarif de '+course.title+' n’est pas publié actuellement. Un conseiller peut le vérifier.';
  if(english&&price==='60 USD')return answers.PRICING;
  return 'Le tarif publié pour '+course.title+' est '+price+(course.structureType==='LEVEL_BASED'?' par niveau.':' pour la formation.');
 }
 if(intent==='FREE_TRIAL')return english&&accessLimits(course).trial===5?answers.FREE_TRIAL:'Les règles publiées pour '+course.title+' ne permettent pas de promettre cinq séances gratuites. Un conseiller peut préciser les possibilités.';
 if(intent==='PAYMENT_TERMS')return english&&accessLimits(course).legacy&&price==='60 USD'?answers.PAYMENT_TERMS:'Les modalités de paiement de '+course.title+' doivent être vérifiées avec un conseiller. Je ne peux pas promettre un acompte ou une échéance non publiés.';
 if(intent==='TRAINING_DURATION')return english?answers.TRAINING_DURATION:(course.sessionCount?course.title+' comprend '+course.sessionCount+' séances. La durée détaillée doit être confirmée.':'La durée de '+course.title+' doit être confirmée avec un conseiller.');
 if(intent==='CERTIFICATE_COST'){
  if(english)return answers.CERTIFICATE_COST;
  if(course.certificateFee!=null&&Number.isFinite(Number(course.certificateFee))&&Number(course.certificateFee)>=0&&course.currency)return 'Les frais de certificat publiés pour '+course.title+' sont '+Number(course.certificateFee)+' '+course.currency+'.';
  return 'Les frais de certificat de '+course.title+' ne sont pas publiés dans les informations consultées. Un conseiller peut les confirmer.';
 }
 if(intent==='CERTIFICATION')return english?answers.CERTIFICATION:'Les conditions de certification de '+course.title+' doivent être confirmées auprès de NVA. Je ne peux affirmer aucune reconnaissance internationale ni accréditation externe sans preuve.';
 return answers[intent];
}
module.exports={englishCourse,officialEnglishCourse,resolveCourse,publishedPrice,commercialAnswer};
