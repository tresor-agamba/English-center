const ID = /^[a-zA-Z0-9:_-]{1,200}$/;
const length = value => [...String(value)].length;
function invalid() { return Object.assign(new Error('Menu interactif invalide.'),{code:'INVALID_INTERACTIVE',acceptanceRejected:true,uncertain:false,retryable:false,statusCode:400}); }
function validateInteractive(value) {
 if(!value || !['button','list'].includes(value.type) || typeof value.body?.text!=='string' || !value.body.text.trim() || length(value.body.text)>1024)throw invalid();
 let options;
 if(value.type==='button') {
  options=value.action?.buttons;
  if(!Array.isArray(options)||options.length<1||options.length>3)throw invalid();
  options=options.map(b=>{if(b.type!=='reply')throw invalid();return b.reply});
 }else{
  const sections=value.action?.sections;
  if(typeof value.action?.button!=='string'||!value.action.button.trim()||length(value.action.button)>20||!Array.isArray(sections)||sections.length!==1)throw invalid();
  if(typeof sections[0].title!=='string'||length(sections[0].title)>24)throw invalid();
  options=sections[0].rows;
  if(!Array.isArray(options)||options.length<1||options.length>10)throw invalid();
 }
 const ids=new Set(),titles=new Set();
 for(const o of options){if(!o || !ID.test(o.id)||typeof o.title!=='string'||!o.title.trim()||length(o.title)>(value.type==='button'?20:24)||ids.has(o.id)||titles.has(o.title))throw invalid();ids.add(o.id);titles.add(o.title);}
 return value.type==='button'?{type:'button',body:{text:value.body.text},action:{buttons:options.map(o=>({type:'reply',reply:{id:o.id,title:o.title}}))}}:{type:'list',body:{text:value.body.text},action:{button:value.action.button,sections:[{title:value.action.sections[0].title,rows:options.map(o=>({id:o.id,title:o.title}))}]}};
}
function interactionId(message) {
 const reply=message?.interactive?.button_reply||message?.interactive?.list_reply;
 return typeof reply?.id==='string' && reply.id.trim() && reply.id.length<=256?reply.id:null;
}
module.exports={validateInteractive,interactionId,ID,length};
