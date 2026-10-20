const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const approved=['20261020120000_add_whatsapp_chatbot_admin','20261020140000_add_whatsapp_interactive_scenarios'];
function history(){return fs.readdirSync('prisma/migrations',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({migration_name:x.name,checksum:createHash('sha256').update(fs.readFileSync(path.join('prisma/migrations',x.name,'migration.sql'))).digest('hex'),finished_at:'2026-10-20',rolled_back_at:null}));}
test('migration audit accepts only the two reviewed migrations and refuses drift or failed history',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nva-release-audit-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));const file=path.join(temp,'history.json');
 function run(rows){fs.writeFileSync(file,JSON.stringify(rows));return spawnSync(process.execPath,['scripts/auditWhatsAppRelease.js','--history',file,'--output',temp],{encoding:'utf8'});}
 const baseline=history().filter(x=>!approved.includes(x.migration_name));assert.equal(run(baseline).status,0);
 assert.equal(run(baseline.slice(1)).status,2);
 assert.equal(run(baseline.map((r,i)=>i?r:{...r,checksum:'tampered'})).status,2);
 assert.equal(run(baseline.map((r,i)=>i?r:{...r,finished_at:null})).status,2);
});
test('operator helper embedded Node scripts compile and contain no global PM2 operation',()=>{
 const shell=fs.readFileSync('deploy/whatsapp-chatbot/operator-functions.sh','utf8');const blocks=[...shell.matchAll(/<<'NODE'\n([\s\S]*?)\nNODE/g)];assert.equal(blocks.length,3);for(const [,code]of blocks)new vm.Script(code);
 assert.doesNotMatch(shell,/restart all|reload all|pm2 kill|pm2 save/);assert.match(shell,/WHATSAPP_ENABLED:'false'/);assert.match(shell,/WHATSAPP_WORKERS_ENABLED:'false'/);
});

test('production poller never loads processors or schedules work while either authorization flag is false',async()=>{
 const {createWhatsAppDeliveryPoller}=require('../src/jobs/whatsappWorkerControl');
 for(const flags of [{enabled:false,workersEnabled:false},{enabled:true,workersEnabled:false},{enabled:false,workersEnabled:true}]){
  const poller=createWhatsAppDeliveryPoller({environment:()=> 'production',configProvider:()=>flags,loadProcessors:()=>assert.fail('No processors'),schedule:()=>assert.fail('No timer')});
  assert.equal(poller.start(),false);assert.deepEqual(await poller.runOnce(),[]);
 }
});
