// Readiness-only probe, never starts runOnce, polling or a Meta sender.
async function check({env=process.env,createWorker=options=>require('../src/services/metaInboxWorkerService').createMetaInboxWorker(options)}={}){
 const worker=createWorker({env:{...env,META_INBOX_SEND_ENABLED:'false'}});
 try{await worker.ready();return {ready:true,sendEnabled:false,polling:false};}
 finally{await worker.close();}
}
if(require.main===module){
 if(process.argv[2]!=='--readiness-only'){console.error('READINESS_ONLY_ARGUMENT_REQUIRED');process.exitCode=2;}
 else{require('dotenv').config({quiet:true});check().then(()=>console.log('META_WORKER_READY_SEND_DISABLED')).catch(()=>{console.error('META_WORKER_READINESS_FAILED');process.exitCode=1;});}
}
module.exports={check};
