const { randomUUID }=require('node:crypto');
const {normalizeText}=require('./whatsappConversationEngine');
const {validateInteractive,length}=require('./whatsappInteractive');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE=/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const CATALOG=['CATALOG','PRICE','SCHEDULE','TRIAL','REGISTRATION'];
const TTL=24*60*60*1000;
function bad(message='Scénario invalide.') {return Object.assign(new Error(message),{statusCode:400});}
function condition(value) {
 if(value==null)return null;
 if(!['selectedCourse','commercialConsent','prospect'].includes(value.field)||typeof value.equals!=='boolean')throw bad('Condition non autorisée.');
 return {field:value.field,equals:value.equals};
}
function allows(c,state,prospect){return !c || ({selectedCourse:Boolean(state.selectedCourseId||state.selectedCourseSlug),commercialConsent:state.commercialFollowUpsGranted===true,prospect:prospect===true}[c.field]===c.equals);}
function validateScenario(input) {
 const title=typeof input.title==='string'?input.title.trim():'';
 const raw=Array.isArray(input.triggers)?input.triggers:typeof input.triggers==='string'?input.triggers.split(/[,\n]/):[];
 if(raw.some(x=>typeof x!=='string'))throw bad();
 const triggers=[...new Set(raw.map(normalizeText).filter(Boolean))];
 const priority=Number(input.priority);
 let def=input.definition;
 if(typeof def==='string'){if(def.length>150000)throw bad();try{def=JSON.parse(def)}catch{throw bad('Définition JSON invalide.')}}
 if(!title||title.length>120||!triggers.length||triggers.length>20||triggers.some(t=>t.length>100)||!Number.isInteger(priority)||priority<0||priority>1000||!def||!Array.isArray(def.nodes)||!def.nodes.length||def.nodes.length>40)throw bad();
 const nodes=new Set(),optionIds=new Set();
 for(const n of def.nodes){if(!n || typeof n !== 'object')throw bad();if(!NODE.test(n.id)||nodes.has(n.id))throw bad('Identifiant de nœud invalide ou dupliqué.');nodes.add(n.id);}
 if(!nodes.has(def.entry))throw bad('Le nœud initial est absent.');
 function action(a){
  if(a==null)return null;
  if(a.type==='HANDOFF'||a.type==='END')return {type:a.type};
  if(a.type==='CATALOG'&&CATALOG.includes(a.intent))return {type:a.type,intent:a.intent};
  if(a.type==='GOTO'&&NODE.test(a.nodeId)&&(!a.scenarioId||UUID.test(a.scenarioId))){if(!a.scenarioId&&!nodes.has(a.nodeId))throw bad('Transition vers un nœud absent.');return {type:a.type,nodeId:a.nodeId,...(a.scenarioId?{scenarioId:a.scenarioId}:{})};}
  throw bad('Action non autorisée.');
 }
 const normalized=def.nodes.map(n=>{
  if(!['button','list','text'].includes(n.type)||typeof n.body!=='string'||!n.body.trim()||length(n.body)>(n.type==='text'?2000:1024))throw bad('Texte ou type de nœud invalide.');
  if(n.options!=null&&!Array.isArray(n.options))throw bad();
  const options=(n.options||[]).map(o=>{
   if(!o||typeof o!=='object')throw bad();
   if(!UUID.test(o.id)||optionIds.has(o.id)||typeof o.label!=='string'||!o.label.trim()||length(o.label)>(n.type==='button'?20:24))throw bad('Option invalide : identifiant UUID stable et libellé court requis.');
   optionIds.add(o.id);const next=action(o.action);if(!next)throw bad('Chaque option doit définir une action.');
   return {id:o.id,label:o.label,condition:condition(o.condition),action:next};
  });
  if((n.type==='text'&&options.length)||(n.type!=='text'&&(!options.length||options.length>(n.type==='button'?3:10)))||new Set(options.map(o=>o.label)).size!==options.length)throw bad('Nombre d’options ou libellés dupliqués invalides.');
  const buttonLabel=n.buttonLabel||'Choisir';if(typeof buttonLabel!=='string'||!buttonLabel.trim()||length(buttonLabel)>20)throw bad();
  return {id:n.id,type:n.type,body:n.body,buttonLabel,options,condition:condition(n.condition),otherwise:action(n.otherwise),next:action(n.next)};
 });
 // Reject automatic local cycles. User-driven menu loops are permitted.
 for(const start of normalized){let node=start;const visited=new Set();while(node){if(visited.has(node.id))throw bad('Boucle automatique : ajoutez un menu ou une fin.');visited.add(node.id);const a=node.type==='text'?node.next:null;node=a?.type==='GOTO'&&!a.scenarioId?normalized.find(n=>n.id===a.nodeId):null;}}
 return {title,triggers,priority,enabled:input.enabled===true||input.enabled==='on',definition:{entry:def.entry,nodes:normalized}};
}
function createScenarioService({database,now=()=>new Date(),token=()=>randomUUID()}={}){
 async function resolve({text,intent,interactionId,state,prospect=true}){
  if(state.optedOut||state.automationPaused||!database?.whatsAppScenario)return null;
  if(state.pendingQuestion && intent!=='MENU' && !interactionId)return null;
  const settings=await database.whatsAppChatbotSettings?.findUnique({where:{id:1}});
  if(settings?.enabled===false)return null;
  if(!['UNKNOWN','GREETING','MENU'].includes(intent)&&!interactionId)return null;
  const rows=await database.whatsAppScenario.findMany({where:{enabled:true},orderBy:[{priority:'desc'},{id:'asc'}],take:100});
  const stale=()=>({text:'Ce menu a expiré ou a été modifié. Écrivez « menu » pour recommencer.',state:{...state,scenarioMenu:null},actions:[]});
  let scenario,nodeId,action=null;
  const active=state.scenarioMenu;
  if(interactionId || (/^[1-9]\d?$/.test(String(text).trim())&&active)){
   if(!active||!Number.isFinite(Date.parse(active.expiresAt))||+now()>Date.parse(active.expiresAt))return stale();
   scenario=rows.find(r=>r.id===active.scenarioId&&r.revision===active.revision);
   if(!scenario)return stale();
   const node=scenario.definition.nodes.find(n=>n.id===active.nodeId);
   const selected=interactionId?active.options.find(o=>o.wireId===interactionId):active.options[Number(String(text).trim())-1];
   const option=node?.options.find(o=>o.id===selected?.id);
   if(!option||!allows(node.condition,state,prospect)||!allows(option.condition,state,prospect))return stale();
   action=option.action;
  }else{
   const normalized=' '+normalizeText(text)+' ';
   scenario=rows.find(r=>r.triggers.some(t=>normalized.includes(' '+normalizeText(t)+' ')));
   if(!scenario)return null;
   nodeId=scenario.definition.entry;
  }
  let nextState={...state,pendingQuestion:null,scenarioMenu:null};const parts=[];
  for(let step=0;step<12;step++){
   if(action){
    if(action.type==='HANDOFF')return {text:[...parts,'Je transmets votre demande à un conseiller.'].join('\n'),state:{...nextState,automationPaused:true,step:'HUMAN_HANDOFF'},actions:[{type:'HUMAN_HANDOFF',context:{scenarioId:scenario.id}}]};
    if(action.type==='END')return {text:parts.join('\n')||'Merci. Écrivez « menu » pour recommencer.',state:nextState,actions:[]};
    if(action.type==='CATALOG')return {catalogIntent:action.intent,state:nextState};
    if(action.type==='GOTO'){
     if(action.scenarioId){scenario=rows.find(r=>r.id===action.scenarioId);if(!scenario)return stale();}
     nodeId=action.nodeId;
    }
   }
   const node=scenario.definition.nodes.find(n=>n.id===nodeId);
   if(!node)return stale();
   if(!allows(node.condition,state,prospect)){action=node.otherwise||{type:'END'};continue;}
   parts.push(node.body);
   if(parts.join('\n').length>2800)return stale();
   if(node.type==='text'){action=node.next||{type:'END'};continue;}
   const visible=node.options.filter(o=>allows(o.condition,state,prospect));
   if(!visible.length){action=node.otherwise||{type:'HANDOFF'};continue;}
   const menuToken=token();const options=visible.map(o=>({id:o.id,label:o.label,wireId:'nva:'+o.id+':'+menuToken}));
   const body=parts.join('\n');const fallback=body+'\n\n'+options.map((o,i)=>(i+1)+'. '+o.label).join('\n')+'\nRépondez par numéro.';
   if(length(body)>1024||fallback.length>4000)return stale();
   const interactive=node.type==='button'?{type:'button',body:{text:body},action:{buttons:options.map(o=>({type:'reply',reply:{id:o.wireId,title:o.label}}))}}:{type:'list',body:{text:body},action:{button:node.buttonLabel,sections:[{title:'Options',rows:options.map(o=>({id:o.wireId,title:o.label}))}]}};
   return {text:fallback,interactive:validateInteractive(interactive),actions:[],state:{...nextState,scenarioMenu:{scenarioId:scenario.id,revision:scenario.revision,nodeId:node.id,options,expiresAt:new Date(+now()+TTL).toISOString()}}};
  }
  return stale(); // Cross-scenario automatic cycles are bounded too.
 }
 return {resolve};
}
module.exports={validateScenario,createScenarioService,allows,TTL,UUID};
