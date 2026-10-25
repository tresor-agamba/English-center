// REVIEW ARTIFACT ONLY. Do not start beside existing NVA processes.
// No secrets. Activation and exact process identity require operator review.
const path=require('node:path');
const base=require('../../ecosystem.config.cjs').apps[0];
const cwd=path.resolve(__dirname,'../..');
const disabled={NODE_ENV:'production',WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false',META_INBOX_WORKER_ENABLED:'false',META_INBOX_SEND_ENABLED:'false'};
module.exports={apps:[
 {...base,cwd,wait_ready:true,listen_timeout:30000,kill_timeout:130000,env_production:{...disabled}},
 {name:'nva-meta-inbox-worker-candidate',cwd,script:'src/jobs/processMetaInbox.js',instances:1,exec_mode:'fork',autorestart:true,stop_exit_codes:[0],restart_delay:5000,max_memory_restart:'512M',kill_timeout:130000,wait_ready:true,listen_timeout:30000,time:true,out_file:'logs/meta-worker.log',error_file:'logs/meta-worker-error.log',env_production:{...disabled}},
]};
