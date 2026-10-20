const db=require('../utils/prisma');
const {randomUUID}=require('node:crypto');
const {validateScenario,createScenarioService,UUID}=require('../services/whatsappScenarioService');
const {createConversationEngine}=require('../services/whatsappConversationEngine');
function error(statusCode,message){return Object.assign(new Error(message),{statusCode});}
async function render(req,res,extra={}){
 const rows=await db.whatsAppScenario.findMany({orderBy:[{priority:'desc'},{id:'asc'}],take:100});
 const selected=rows.find(r=>r.id===req.query.edit);
 res.set('Cache-Control','no-store');
 res.render('admin/whatsapp/scenarios',{title:'Menus et scénarios WhatsApp',rows,selected,error:'',draft:null,simulation:req.session.waScenarioSimulation||null,...extra});
}
async function save(req,res){
 try{
  const data=validateScenario(req.body);
  const id=req.body.id;
  if(id&&!UUID.test(id))throw error(400,'Identifiant de scénario invalide.');
  const targets=new Map();
  for(const n of data.definition.nodes)for(const a of [n.next,n.otherwise,...n.options.map(o=>o.action)])if(a?.scenarioId){
   const target=await db.whatsAppScenario.findUnique({where:{id:a.scenarioId}});
   if(!target||!target.definition.nodes.some(node=>node.id===a.nodeId))throw error(400,'Transition vers un scénario ou un nœud absent.');
   targets.set(a.scenarioId,true);
  }
  let savedId=id;
  if(id){
   const revision=Number(req.body.revision);
   if(!Number.isInteger(revision)||revision<1)throw error(400,'Révision invalide.');
   const result=await db.whatsAppScenario.updateMany({where:{id,revision},data:{...data,revision:{increment:1}}});
   if(!result.count)throw error(409,'Ce scénario a été modifié ailleurs. Rechargez avant de sauvegarder.');
  }else{
   if(await db.whatsAppScenario.count()>=100)throw error(400,'Limite de 100 scénarios atteinte.');
   savedId=randomUUID();await db.whatsAppScenario.create({data:{id:savedId,...data}});
  }
  res.redirect(303,'/admin/whatsapp/chatbot/scenarios?edit='+savedId);
 }catch(e){if(![400,409].includes(e.statusCode))throw e;res.status(e.statusCode);return render(req,res,{error:e.message,draft:req.body});}
}
async function simulate(req,res){
 const rows=await db.whatsAppScenario.findMany({orderBy:[{priority:'desc'},{id:'asc'}],take:100});
 let simulation=req.session.waScenarioSimulation;
 let text=typeof req.body.text==='string'?req.body.text:'';
 const click=typeof req.body.interactionId==='string'?req.body.interactionId:null;
 if(text.length>1000||(click&&click.length>200))throw error(400,'Message de simulation trop long.');
 if(req.body.reset==='on'||!simulation){
  const selected=rows.find(r=>r.id===req.body.scenarioId);
  if(!selected)throw error(400,'Choisissez un scénario.');
  const state={commercialFollowUpsGranted:req.body.commercialConsent==='on'};
  // Test context only; a catalogue lookup still revalidates this course in the engine.
  const courseId=Number(req.body.selectedCourseId);
  if(Number.isSafeInteger(courseId)&&courseId>0)state.selectedCourseId=courseId;
  simulation={state,history:[],prospect:req.body.prospect==='on',scenarioId:selected.id};
  text=selected.triggers[0];
 }
 const ordered=[...rows].sort((a,b)=>Number(b.id===simulation.scenarioId)-Number(a.id===simulation.scenarioId));
 // Drafts are visible only in this authenticated, no-send simulator.
 const previewDb={whatsAppScenario:{findMany:async()=>ordered.map(r=>({...r,enabled:true}))},whatsAppChatbotSettings:{findUnique:async()=>({enabled:true})}};
 const engine=createConversationEngine({scenarios:createScenarioService({database:previewDb})});
 const result=await engine.handleMessage({text,interactionId:click,messageId:'sim:'+randomUUID(),state:simulation.state,allowCommercialFollowUpConsent:simulation.prospect,publicAppUrl:process.env.PUBLIC_APP_URL||''});
 simulation.state=result.state;
 simulation.history=[...simulation.history,{input:click?'Clic : '+click:text,intent:result.intent,text:result.text,actions:result.actions.map(a=>a.type)}].slice(-30);
 simulation.interactive=result.interactive||null;
 req.session.waScenarioSimulation=simulation;
 res.redirect(303,'/admin/whatsapp/chatbot/scenarios#simulator');
}
module.exports={render,save,simulate};
