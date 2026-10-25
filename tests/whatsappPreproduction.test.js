const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const logger=require('../src/services/loggerService');
test('logs redact labeled identity, contact details and entire Prisma diagnostics',()=>{
 const sensitive=Object.assign(Error('fullName: "Alice Example" email: alice@example.test phone: +243800000001'),{name:'PrismaClientKnownRequestError',code:'P2002'});
 const output=JSON.stringify(logger.sanitize({error:sensitive,email:'alice@example.test',phoneNumber:'+243800000001',fullName:'Alice Example',context:'Contact alice@example.test at +243800000001',requestId:'audit-1'}));
 for(const value of ['Alice Example','alice@example.test','243800000001'])assert.ok(!output.includes(value));assert.match(output,/P2002/);assert.match(output,/audit-1/);
});
test('worker column permissions include every reconfirmation field',()=>{
 const sql=fs.readFileSync('docs/sql/meta-inbox-production-worker-role.sql','utf8');
 const columns=sql.match(/GRANT UPDATE\s*\(([^)]+)\)\s*ON public\."WhatsAppAdmissionRequest"/)[1].split(',').map(s=>s.trim().replaceAll('"',''));
 for(const name of ['fullName','phoneNumber','email','requestedLevel','consentAt','updatedAt','confirmationDraft'])assert.ok(columns.includes(name),name);
 assert.ok(!columns.includes('status'));assert.ok(!columns.includes('enrollmentId'));
});
test('candidate separates web and worker, announces readiness and keeps sends disabled',()=>{
 const {apps}=require('../deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs');assert.equal(apps.length,2);assert.equal(apps[1].script,'src/jobs/processMetaInbox.js');
 for(const a of apps){assert.equal(a.instances,1);assert.equal(a.wait_ready,true);assert.equal(a.env_production.WHATSAPP_WORKERS_ENABLED,'false');assert.equal(a.env_production.META_INBOX_SEND_ENABLED,'false');assert.equal(a.env_production.META_INBOX_WORKER_ENABLED,'false');assert.ok(a.kill_timeout>=130000);}
});
test('CLI advertises readiness after DB gate and closes before returning',async()=>{
 const order=[],env={META_INBOX_WORKER_ENABLED:'true'};
 await require('../src/jobs/processMetaInbox').run({env,notifyReady:()=>order.push('ready'),createWorker:()=>({ready:async()=>order.push('db-verified'),intervalMs:1,runOnce:async()=>{order.push('batch');env.META_INBOX_WORKER_ENABLED='false';},close:async()=>order.push('closed')})});
 assert.deepEqual(order,['db-verified','ready','batch','closed']);
});
test('disabled restart helper clears inherited Meta worker and send flags',()=>{
 const helper=fs.readFileSync('deploy/whatsapp-chatbot/operator-functions.sh','utf8');assert.match(helper,/META_INBOX_SEND_ENABLED:'false'/);assert.match(helper,/META_INBOX_WORKER_ENABLED:'false'/);
});
test('CLI shutdown stops new worker claims immediately, before waiting for batch completion',async()=>{
 const order=[],env={META_INBOX_WORKER_ENABLED:'true'};
 await require('../src/jobs/processMetaInbox').run({env,notifyReady:()=>{},createWorker:()=>({ready:async()=>{},intervalMs:1,requestStop:()=>order.push('stop-claims'),runOnce:async()=>{order.push('in-flight');process.emit('SIGTERM');assert.deepEqual(order,['in-flight','stop-claims']);order.push('completed-current');},close:async()=>order.push('closed')})});
 assert.deepEqual(order,['in-flight','stop-claims','completed-current','closed']);
});
