const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {createConversationEngine}=require('../../src/services/whatsappConversationEngine');
const {createAdmissionJourney}=require('../../src/services/whatsappAdmissionJourney');
const {validateInteractive}=require('../../src/services/whatsappInteractive');
const {validateSession}=require('../../src/services/registrationService');
const {recordConfirmed,createAdmissionService}=require('../../src/services/whatsappAdmissionService');
const course={id:12,title:'Anglais professionnel',slug:'anglais-professionnel',shortDescription:'Cours en direct pour adultes',durationValue:8,durationUnit:'WEEK',isPublished:true,lmsStatus:'PUBLISHED',archivedAt:null,closedAt:null,structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',pricingMode:'ONE_TIME',pricingActive:true,price:60,currency:'USD'};
const baseSession={id:22,course,status:'OPEN',levelNumber:1,startDate:new Date('2100-01-08T10:00:00Z'),registrationDeadline:new Date('2099-12-31'),capacity:12,_count:{enrollments:0},timezone:'Africa/Kinshasa',weekDays:['Friday','Saturday'],startTime:'16:00',endTime:'17:30',registrationGroups:[]};
function harness({courses=[course],sessions=[baseSession]}={}){
 // These regression suites exercise existing prospects and the legacy AI-off path.
 let state={welcomeSentAt:'2026-10-23T09:00:00Z',processedMessageIds:['existing-prospect']},now=new Date('2026-10-23T10:00:00Z'),seq=0;const transcript=[];
 const open=()=>sessions.flatMap(s=>{try{return [validateSession(s,now)];}catch{return [];}});
 const catalog={listPublished:async()=>courses};
 const registration={listSessionsForPublicRegistration:async()=>open(),listCoursesForPublicRegistration:async()=>courses.flatMap(c=>{const session=open().find(s=>s.course.id===c.id);return session?[{...c,session}]:[];})};
 const admissions=createAdmissionJourney({database:{whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}},catalog,registration,now:()=>now});
 const engine=createConversationEngine({catalog,registration,admissions,now:()=>now,whatsappConfig:()=>({})});
 async function send(text,interactionId){const r=await engine.handleMessage({text,interactionId,state:structuredClone(state),messageId:'validation-'+(++seq),phoneNumber:'+243812345678'});state=r.state;if(r.interactive)validateInteractive(r.interactive);transcript.push({input:interactionId?'click:'+interactionId.split(':')[1]:text,step:state.admission?.step||state.step,text:r.text,actions:r.actions});return r;}
 async function click(id){const option=state.admission?.options?.find(o=>o.id===id);assert.ok(option,'Missing '+id+' at '+state.admission?.step);return send('',option.wireId);}
 return {send,click,engine,get state(){return state;},transcript,advance:ms=>{now=new Date(+now+ms);},setState:value=>{state=value;},sessions};
}
async function collect(h){await h.send('Je veux m’inscrire');await h.click('admin');await h.send('oui');await h.send('Alice Mukendi');await h.click('phone-confirm');await h.send('alice@example.test');await h.click('level-BEGINNER');}
function db(){
 const rows=[],events=[],notifications=[];const tx={course:{findUnique:async()=>course},trainingSession:{findUnique:async()=>baseSession},user:{findMany:async()=>[{id:99}]},
 whatsAppAdmissionRequest:{findUnique:async({where})=>rows.find(r=>Object.entries(where).every(([k,v])=>r[k]===v))||null,findFirst:async()=>rows.find(r=>['PENDING','PROCESSING'].includes(r.status))||null,create:async({data})=>{const row={id:rows.length+1,status:'PENDING',...data};rows.push(row);return row;},update:async({where,data})=>Object.assign(rows.find(r=>r.id===where.id),data),findMany:async()=>rows},
 whatsAppAdmissionEvent:{create:async({data})=>events.push(data)},notification:{upsert:async({create})=>{if(!notifications.some(x=>x.deduplicationKey===create.deduplicationKey))notifications.push(create);}}};
 return {tx,rows,events,notifications};
}

module.exports={harness,collect,db,course,baseSession};
