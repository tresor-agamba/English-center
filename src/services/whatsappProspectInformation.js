// Shared prospect information for interactive menus, free questions and AI facts.
const PRICING='💵 L’anglais général coûte 60 USD par niveau. Les trois niveaux coûtent 180 USD. Le certificat NVA coûte 20 USD après les trois niveaux, sous réserve des conditions de certification, soit 200 USD avec certificat.';
const PAYMENT_TERMS='🎁 Les 5 premières séances sont gratuites et incluses dans les 16 séances du niveau 1. Il faut verser au moins 30 USD pour poursuivre à partir de la 6e séance ; le solde doit être réglé avant la fin du niveau.';
const FREE_TRIAL=PAYMENT_TERMS;
const TRAINING='L’anglais général se suit en ligne, avec des exercices pratiques, sur trois niveaux, à raison de deux séances de 1h30 par semaine (16 séances par niveau).';
const USUAL_SCHEDULE='🕒 Horaires habituels : vendredi et samedi, 9h30–11h00, 16h00–17h30 et 19h00–20h30, heure de Kinshasa.';
const USUAL_SCHEDULE_EN='Usual hours: Friday and Saturday, 9:30–11:00, 16:00–17:30 and 19:00–20:30, Kinshasa time.';
async function readAvailability(registration){
 try{return {courses:await registration.listCoursesForPublicRegistration(),error:false};}
 catch{return {courses:[],error:true};}
}
function scheduleInformation(availability,renderSlots){
 const status=availability.error?'Impossible de vérifier l’état des inscriptions actuellement. Réessayez ou demandez un conseiller.':availability.courses.length?'Inscriptions ouvertes. Créneaux disponibles pour la session :\n'+renderSlots(availability.courses):'Aucune session ouverte aux inscriptions actuellement.';
 return USUAL_SCHEDULE+'\n\n'+status;
}
module.exports={PRICING,PAYMENT_TERMS,FREE_TRIAL,TRAINING,USUAL_SCHEDULE,USUAL_SCHEDULE_EN,readAvailability,scheduleInformation};
