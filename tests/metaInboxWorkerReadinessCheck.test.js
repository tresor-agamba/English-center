const test=require('node:test'),assert=require('node:assert/strict');
const {check}=require('../scripts/checkMetaInboxWorkerReady');
test('readiness-only probe forces sending off, never polls, and closes',async()=>{
 let ready=0,closed=0;const env={META_INBOX_SEND_ENABLED:'true'};
 const result=await check({env,createWorker:opts=>{assert.equal(opts.env.META_INBOX_SEND_ENABLED,'false');return {ready:async()=>ready++,runOnce:()=>assert.fail('must not poll'),close:async()=>closed++};}});
 assert.deepEqual(result,{ready:true,sendEnabled:false,polling:false});assert.equal(ready,1);assert.equal(closed,1);assert.equal(env.META_INBOX_SEND_ENABLED,'true');
});
test('readiness-only probe closes after failed identity check',async()=>{
 let closed=0;await assert.rejects(()=>check({createWorker:()=>({ready:async()=>{throw Error('rejected')},close:async()=>closed++})}),/rejected/);assert.equal(closed,1);
});
