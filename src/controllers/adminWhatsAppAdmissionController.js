const db=require('../utils/prisma');
const admissions=require('../services/whatsappAdmissionService');
const registration=require('../services/registrationService');
const {DEFAULTS,LEVELS,validateContent,createAdmissionJourney}=require('../services/whatsappAdmissionJourney');
const {createConversationEngine}=require('../services/whatsappConversationEngine');
const catalog=require('../services/publicCourseService');
const crypto=require('node:crypto'),passwords=require('../services/passwordService');
function noStore(res){res.set('Cache-Control','no-store');}
async function index(req,res){noStore(res);res.render('admin/whatsapp/admissions',{title:'Demandes d’inscription WhatsApp',...await admissions.list(req.query),statuses:admissions.STATUSES,levels:LEVELS});}
async function detail(req,res,extra={}){noStore(res);const row=await admissions.get(req.params.id);const [courses,matches]=await Promise.all([registration.listSessionsForPublicRegistration().then(rows=>rows.map(session=>({...session.course,session}))),db.user.findMany({where:{OR:[{phoneNumber:row.phoneNumber},{email:row.email}]},select:{id:true,firstName:true,lastName:true,phoneNumber:true,email:true,role:true,isActive:true},take:10})]);res.render('admin/whatsapp/admission',{title:'Demande WhatsApp',row,courses,matches,levels:LEVELS,error:'',...extra});}
async function update(req,res){try{await admissions.update(req.params.id,req.authenticatedUser.id,req.body);res.redirect(303,'/admin/whatsapp/admissions/'+req.params.id);}catch(e){if(![400,403,409].includes(e.statusCode))throw e;res.status(e.statusCode);return detail(req,res,{error:e.message});}}
async function convert(req,res){
 try{const temporaryPassword='Nva!'+crypto.randomBytes(12).toString('base64url');const passwordHash=await passwords.hashPassword(temporaryPassword);const result=await admissions.convert(req.params.id,req.authenticatedUser.id,{...req.body,passwordHash});
 if(result.already||!result.accountCreated)return res.redirect(303,'/admin/whatsapp/admissions/'+req.params.id);
 const enrollment=await registration.findEnrollmentForViewer(result.enrollment.id);noStore(res);res.render('admin/students/enrollment-confirmation',{title:'Inscription confirmée',enrollment,temporaryPassword,loginUrl:'https://www.newvisionacademy.org/login'});
 }catch(e){if(![400,403,404,409].includes(e.statusCode)&&!['P2002','P2034'].includes(e.code)&&!e.message.includes('téléphone'))throw e;res.status(e.statusCode||409);return detail(req,res,{error:e.code==='P2002'?'Un compte utilise déjà ces coordonnées. Vérifiez le compte existant.':e.code==='P2034'?'Une opération concurrente a modifié les places. Rechargez avant de réessayer.':e.message});}
}
async function content(req,res,extra={}){noStore(res);const settings=await db.whatsAppChatbotSettings.findUnique({where:{id:1}});res.render('admin/whatsapp/admission-content',{title:'Accueil et inscription WhatsApp',content:{...DEFAULTS,...settings?.admissionContent},enabled:settings?.admissionsEnabled===true,error:'',...extra});}
async function saveContent(req,res){try{const admissionContent=validateContent(req.body);await db.whatsAppChatbotSettings.upsert({where:{id:1},create:{id:1,admissionsEnabled:req.body.enabled==='on',admissionContent},update:{admissionsEnabled:req.body.enabled==='on',admissionContent}});res.redirect(303,'/admin/whatsapp/admissions/content');}catch(e){if(e.statusCode!==400)throw e;res.status(400);return content(req,res,{error:e.message});}}
async function simulator(req,res){noStore(res);res.render('admin/whatsapp/admission-simulator',{title:'Simulation inscription WhatsApp',simulation:req.session.admissionSimulation||null});}
async function simulate(req,res){
 const previous=req.body.reset==='on'?null:req.session.admissionSimulation;let text=typeof req.body.text==='string'?req.body.text:'';if(text.length>1000)throw Object.assign(new Error('Message trop long.'),{statusCode:400});const click=typeof req.body.interactionId==='string'?req.body.interactionId:null;if(click&&click.length>200)throw Object.assign(new Error('Choix invalide.'),{statusCode:400});
 const settings=await db.whatsAppChatbotSettings.findUnique({where:{id:1}});
 const preview={whatsAppChatbotSettings:{findUnique:async()=>({...settings,enabled:true,admissionsEnabled:true})}};
 const engine=createConversationEngine({admissions:createAdmissionJourney({database:preview,catalog,registration})});
 const result=await engine.handleMessage({text:previous?text:'bonjour',interactionId:click,phoneNumber:'+243812345678',messageId:'sim:'+crypto.randomUUID(),state:previous?.state,allowCommercialFollowUpConsent:false});
 req.session.admissionSimulation={state:result.state,interactive:result.interactive,history:[...(previous?.history||[]),{input:click?'Clic : '+click:text||'bonjour',text:result.text,actions:result.actions.map(a=>a.type)}].slice(-30)};
 res.redirect(303,'/admin/whatsapp/admissions/simulator');
}
module.exports={index,detail,update,convert,content,saveContent,simulator,simulate};
