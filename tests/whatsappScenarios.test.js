const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {validateScenario,createScenarioService}=require('../src/services/whatsappScenarioService');
const {createConversationEngine}=require('../src/services/whatsappConversationEngine');
const {validateInteractive,interactionId}=require('../src/services/whatsappInteractive');
const {buildInteractivePayload,sendInteractiveMessage}=require('../src/services/whatsappCloudApiService');
const {normalizeMetaBatch}=require('../src/services/metaInboxProtocol');
function fixture(type='button'){
 return {id:randomUUID(),revision:1,...validateScenario({title:'Accueil',triggers:'menu,bonjour',priority:10,enabled:true,definition:{entry:'accueil',nodes:[{id:'accueil',type,body:'Bienvenue',options:[{id:randomUUID(),label:'Nos formations',action:{type:'CATALOG',intent:'CATALOG'}},{id:randomUUID(),label:'Conseiller',action:{type:'HANDOFF'}},{id:randomUUID(),label:'Détails',action:{type:'GOTO',nodeId:'details'}}]},{id:'details',type:'text',body:'Informations officielles NVA',next:{type:'END'}}]}})};
}
function setup(rows=[fixture()],settings={enabled:true},clock=()=>new Date('2026-10-20T12:00:00Z')){
 const database={whatsAppScenario:{findMany:async()=>rows.filter(r=>r.enabled)},whatsAppChatbotSettings:{findUnique:async()=>settings}};
 const scenarios=createScenarioService({database,now:clock});
 const engine=createConversationEngine({scenarios,catalog:{listPublished:async()=>[{id:1,title:'Anglais officiel',slug:'anglais'}]},registration:{listCoursesForPublicRegistration:async()=>[]},whatsappConfig:()=>({})});
 return {rows,database,engine,scenarios};
}
async function start(e){return e.handleMessage({text:'menu',messageId:randomUUID()});}
function click(result,index=0){const p=result.interactive;return p.type==='button'?p.action.buttons[index].reply.id:p.action.sections[0].rows[index].id;}
test('stable UUID survives label changes, button/list limits and safe conditions are validated',()=>{
 const r=fixture();const stable=r.definition.nodes[0].options[0].id;r.definition.nodes[0].options[0].label='Autre nom';assert.equal(validateScenario(r).definition.nodes[0].options[0].id,stable);
 for(const mutate of [x=>x.definition.nodes[0].options.push({...x.definition.nodes[0].options[0],id:randomUUID()}),x=>x.definition.nodes[0].options[0].label='x'.repeat(21),x=>x.definition.nodes[0].options[0].id='display-title',x=>x.definition.nodes[0].condition={field:'sql',equals:true},x=>x.definition.nodes[0].options[0].action={type:'EVAL',code:'bad'},x=>x.definition.nodes[0].options={},x=>x.definition.nodes.push(null),x=>x.definition.entry='missing']){
 const copy=structuredClone(r);mutate(copy);assert.throws(()=>validateScenario(copy),{statusCode:400});
 }
 const list=fixture('list');list.definition.nodes[0].options[0].label='x'.repeat(24);assert.doesNotThrow(()=>validateScenario(list));
});
test('automatic local loops rejected and missing local nodes rejected',()=>{
 const r=fixture();r.definition.nodes[1].next={type:'GOTO',nodeId:'details'};assert.throws(()=>validateScenario(r),{statusCode:400});
 r.definition.nodes[1].next={type:'GOTO',nodeId:'absent'};assert.throws(()=>validateScenario(r),{statusCode:400});
});
for(const format of ['button','list'])test(format+' click dispatches by identifier, never by displayed label',async()=>{
 const r=fixture(format);r.definition.nodes[0].options[2].label='STOP';const {engine}=setup([r]);const first=await start(engine);
 const next=await engine.handleMessage({text:'STOP',interactionId:click(first,2),state:first.state,messageId:randomUUID()});
 assert.equal(next.text,'Informations officielles NVA');assert.equal(next.state.optedOut,false);assert.equal(next.state.scenarioMenu,null);
 assert.equal(first.state.scenarioMenu.options[2].id,r.definition.nodes[0].options[2].id);
});
test('numbered fallback uses the exact visible order and dispatches handoff',async()=>{
 const {engine}=setup();const first=await start(engine);assert.match(first.text,/1. Nos formations/);
 const handoff=await engine.handleMessage({text:'2',state:JSON.parse(JSON.stringify(first.state)),messageId:randomUUID()});
 assert.equal(handoff.actions[0].type,'HUMAN_HANDOFF');assert.equal(handoff.state.automationPaused,true);
 assert.equal((await engine.handleMessage({text:'menu',state:handoff.state})).text,null);
});
test('STOP and duplicates precede scenarios; paused/opted-out never execute clicks',async()=>{
 const {engine}=setup();const first=await start(engine);const stop=await engine.handleMessage({text:'STOP',state:first.state,messageId:'stop'});assert.equal(stop.actions[0].type,'OPT_OUT');
 assert.equal((await engine.handleMessage({interactionId:click(first),state:stop.state})).text,null);
 const duplicate=await engine.handleMessage({text:'menu',state:first.state,messageId:first.state.processedMessageIds[0]});assert.equal(duplicate.duplicate,true);
 const paused=await engine.handleMessage({interactionId:click(first),state:{...first.state,automationPaused:true}});assert.equal(paused.text,null);
});
test('conditions filter options and are rechecked on a later click',async()=>{
 const r=fixture();r.definition.nodes[0].options[0].condition={field:'commercialConsent',equals:true};const {engine}=setup([r]);
 const first=await start(engine);assert.equal(first.state.scenarioMenu.options.length,2);assert.match(first.text,/1. Conseiller/);
 const accepted=await engine.handleMessage({text:'menu',state:{commercialFollowUpsGranted:true}});assert.equal(accepted.state.scenarioMenu.options.length,3);
 const denied=await engine.handleMessage({interactionId:click(accepted),state:{...accepted.state,commercialFollowUpsGranted:false}});assert.match(denied.text,/expiré/);assert.deepEqual(denied.actions,[]);
});
test('entry conditions and conditional counselor fallback',async()=>{
 const r=fixture();r.definition.nodes[0].condition={field:'prospect',equals:true};r.definition.nodes[0].otherwise={type:'HANDOFF'};const {engine}=setup([r]);
 const result=await engine.handleMessage({text:'menu',allowCommercialFollowUpConsent:false});assert.equal(result.actions[0].type,'HUMAN_HANDOFF');
});
test('revision, disabled scenario, expired menu, unknown and stale IDs fail closed',async()=>{
 let clock=new Date('2026-10-20T12:00:00Z');const r=fixture();const {engine}=setup([r],{enabled:true},()=>clock);
 const first=await start(engine);
 for(const id of ['forged',click(first).replace(/.$/,'x')]){const result=await engine.handleMessage({interactionId:id,state:first.state});assert.match(result.text,/expiré/);}
 r.revision++;assert.match((await engine.handleMessage({interactionId:click(first),state:first.state})).text,/expiré/);r.revision--;
 r.enabled=false;assert.match((await engine.handleMessage({interactionId:click(first),state:first.state})).text,/expiré/);r.enabled=true;
 clock=new Date('2026-10-22T12:00:00Z');assert.match((await engine.handleMessage({text:'1',state:first.state})).text,/expiré/);
 const newer=await start(engine);assert.match((await engine.handleMessage({interactionId:click(first),state:newer.state})).text,/expiré/);
});
test('cross-scenario transition and automatic cross-scenario cycle bound',async()=>{
 const a=fixture(),b=fixture();b.definition.nodes[1].body='Scénario suivant';a.definition.nodes[0].options[2].action={type:'GOTO',scenarioId:b.id,nodeId:'details'};const {engine}=setup([a,b]);
 const first=await start(engine);const next=await engine.handleMessage({interactionId:click(first,2),state:first.state});assert.equal(next.text,'Scénario suivant');
 b.definition.nodes[1].next={type:'GOTO',scenarioId:a.id,nodeId:'details'};a.definition.nodes[1].next={type:'GOTO',scenarioId:b.id,nodeId:'details'};
 const cycle=await engine.handleMessage({interactionId:click(first,2),state:first.state});assert.match(cycle.text,/expiré/);
});
test('catalog actions delegate to the original engine and global suspension applies',async()=>{
 const {engine}=setup();const first=await start(engine);const result=await engine.handleMessage({interactionId:click(first,0),state:first.state});assert.match(result.text,/Anglais officiel/);assert.equal(result.intent,'CATALOG');
 assert.equal((await start(setup(undefined,{enabled:false}).engine)).interactive,undefined);
});
test('Meta interactive payload is correlated and invalid shapes fail locally',async()=>{
 const first=await start(setup().engine);const payload=buildInteractivePayload({phoneNumber:'+243812345678',interactive:first.interactive,idempotencyKey:'reply:1'});assert.equal(payload.type,'interactive');assert.equal(payload.biz_opaque_callback_data,'reply:1');
 assert.throws(()=>validateInteractive({...first.interactive,body:{text:'x'.repeat(1025)}}),{code:'INVALID_INTERACTIVE'});
 assert.throws(()=>validateInteractive({...first.interactive,action:{buttons:[]}}),{code:'INVALID_INTERACTIVE'});
 await assert.rejects(sendInteractiveMessage({phoneNumber:'+243812345678',interactive:first.interactive},{config:{enabled:false},fetchImpl:async()=>assert.fail('network forbidden')}),{code:'WHATSAPP_DISABLED'});
});
test('Meta normalization retains button/list IDs in encrypted-data projection',()=>{
 for(const kind of ['button_reply','list_reply']){
 const message={id:'wamid.menu',from:'243812345678',type:'interactive',timestamp:'1792497599',interactive:{[kind]:{id:'stable-opaque-id',title:'Renamed label'}}};
 const batch=normalizeMetaBatch({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[message]}}]}]},{wabaId:'2001',phoneNumberId:'1001',receivedAt:new Date('2026-10-20T12:00:00Z')});
 assert.equal(batch[0].data.message.interactive[kind].id,'stable-opaque-id');assert.equal(interactionId(batch[0].data.message),'stable-opaque-id');
 }
});
