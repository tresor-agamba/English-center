// Linux READ-ONLY inspector. No process manager CLI, application import, network,
// child process, secret output, signal, file write or dependency installation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function json(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function read(file){return fs.readFileSync(file,'utf8');}
function fingerprint(value){return value?crypto.createHash('sha256').update(value).digest('hex'):null;}
function flags(env){const names=['NODE_ENV','WHATSAPP_ENABLED','WHATSAPP_WORKERS_ENABLED','META_WHATSAPP_INBOX_ENABLED','META_INBOX_ENVIRONMENT','META_INBOX_WORKER_ENABLED','META_INBOX_SEND_ENABLED','META_INBOX_PRODUCTION_AUTHORIZED','META_INBOX_WORKER_PRODUCTION_AUTHORIZED','META_INBOX_SEND_PRODUCTION_AUTHORIZED','NVA_CHATBOT_AI_ENABLED'];return Object.fromEntries(names.map(k=>[k,env[k]===undefined?'UNSET':k.endsWith('ENABLED')||k.endsWith('AUTHORIZED')?String(env[k]).trim().toLowerCase()==='true'?'true':String(env[k]).trim().toLowerCase()==='false'?'false':'INVALID':['production','test','development'].includes(env[k])?env[k]:'INVALID']));}
function urlIdentity(value){if(!value)return {present:false};try{const u=new URL(value);return {present:true,protocol:u.protocol,host:u.hostname,port:u.port||'5432',database:decodeURIComponent(u.pathname.slice(1)),role:decodeURIComponent(u.username),passwordPresent:Boolean(u.password),overridesPresent:Boolean(u.search||u.hash)};}catch{return {present:true,invalid:true};}}
function envSummary(env){return {flags:flags(env),database:Object.fromEntries(['DATABASE_URL','META_INBOX_DATABASE_URL','META_INBOX_WORKER_DATABASE_URL'].map(k=>[k,urlIdentity(env[k])])),secretPresence:Object.fromEntries(['SESSION_SECRET','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','WHATSAPP_ACCESS_TOKEN','SMTP_USER','SMTP_PASSWORD','META_INBOX_LOOKUP_KEYS_JSON','META_INBOX_STREAM_KEY_HEX','META_INBOX_ENCRYPTION_KEYS_JSON'].map(k=>[k,Boolean(env[k])])),scopeFingerprints:Object.fromEntries(['META_INBOX_ENDPOINT_ID','META_INBOX_APPLICATION_KEY','META_INBOX_APP_ID','WHATSAPP_BUSINESS_ACCOUNT_ID','WHATSAPP_PHONE_NUMBER_ID'].map(k=>[k,fingerprint(env[k])]))};}
function main(){
 if(process.platform!=='linux')throw Error('LINUX_INSPECTION_ONLY');
 const supplied=process.argv[2];if(!supplied||!path.isAbsolute(supplied))throw Error('ABSOLUTE_NVA_APP_DIR_REQUIRED');
 const app=fs.realpathSync(supplied);if(/novance/i.test(app)||json(path.join(app,'package.json')).name!=='english-center')throw Error('NVA_IDENTITY_REFUSED');
 const scripts=['src/server.js','src/jobs/processMetaInbox.js','src/jobs/processWhatsAppDeliveries.js'];
 const proc=[],unreadable=[],cron=[];
 for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
  let cwd;try{cwd=fs.realpathSync('/proc/'+pid+'/cwd');}catch{continue;}
  let raw,env;try{raw=read('/proc/'+pid+'/cmdline').split('\0');env=Object.fromEntries(read('/proc/'+pid+'/environ').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));}catch{if(cwd===app)unreadable.push(Number(pid));continue;}
  const executable=env.pm_exec_path||'';
  if(cwd!==app&&!executable.startsWith(app+path.sep)&&!raw.some(a=>a.startsWith(app+path.sep)))continue;
  const markers=scripts.filter(s=>executable===path.join(app,s)||raw.some(a=>a===s||a===path.join(app,s)));
  let binary='UNREADABLE';try{binary=fs.readlinkSync('/proc/'+pid+'/exe');}catch{}
  let linuxState='UNKNOWN';try{const match=read('/proc/'+pid+'/status').match(/^State:\s*([A-Z])/m);if(match)linuxState=match[1];}catch{}
  proc.push({pid:Number(pid),linuxState,pm2Status:'NOT_QUERIED',environmentEvidence:'STARTUP_ENVIRONMENT_NOT_DOTENV_RUNTIME_PROOF',cwd,binary,scripts:markers,pm2Id:/^\d+$/.test(env.pm_id||'')?Number(env.pm_id):null,nodeInstance:/^\d+$/.test(env.NODE_APP_INSTANCE||'')?Number(env.NODE_APP_INSTANCE):null,...envSummary(env)});
 }
 const cronFiles=['/etc/crontab'];for(const dir of ['/etc/cron.d','/var/spool/cron/crontabs','/var/spool/cron']){try{for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isFile())cronFiles.push(p);}}catch{cron.push({directory:dir,coverage:'UNREADABLE_OR_ABSENT'});}}
 for(const file of [...new Set(cronFiles)]){try{const lines=read(file).split(/\r?\n/),matching=[];lines.forEach((line,i)=>{if(!line.trim().startsWith('#')&&(line.includes(app)||/processMetaInbox|processWhatsAppDeliveries|whatsapp:meta-inbox|whatsapp:process/.test(line)))matching.push(i+1);});if(matching.length)cron.push({file,matchingLineNumbers:matching,commands:'NOT_PRINTED'});}catch{cron.push({file,coverage:'UNREADABLE_OR_ABSENT'});}}
 let savedPM2={status:'NOT_SUPPLIED',live:false};if(process.env.NVA_PM2_DUMP){try{const rows=json(process.env.NVA_PM2_DUMP),selected=rows.map(r=>r.pm2_env||r).filter(r=>r.pm_cwd&&path.resolve(r.pm_cwd)===app);savedPM2={live:false,status:'SAVED_CONFIGURATION_ONLY',entries:selected.map(r=>({name:r.name,script:r.pm_exec_path,instances:r.instances,mode:r.exec_mode,waitReady:r.wait_ready,killTimeout:r.kill_timeout,...envSummary(r.env||r)}))};}catch{savedPM2={live:false,status:'UNREADABLE_OR_INVALID'};}}
 let pm2Version='NOT_SUPPLIED';if(process.env.NVA_PM2_PACKAGE){try{const pkg=json(process.env.NVA_PM2_PACKAGE);pm2Version=pkg.name==='pm2'?pkg.version:'WRONG_PACKAGE';}catch{pm2Version='UNREADABLE';}}
 const metadata={};for(const file of ['.env','ecosystem.config.cjs','package-lock.json']){try{const s=fs.statSync(path.join(app,file));metadata[file]={mode:(s.mode&0o777).toString(8),uid:s.uid,gid:s.gid,size:s.size,mtime:s.mtime.toISOString()};}catch{metadata[file]={status:'ABSENT_OR_UNREADABLE'};}}
 return {inspection:'READ_ONLY_NO_PM2_COMMAND',time:new Date().toISOString(),app,host:{platform:os.platform(),release:os.release(),arch:os.arch(),inspectorNode:process.version,pm2PackageVersion:pm2Version},processes:proc,knownMetaWorkerProcesses:proc.filter(p=>p.scripts.includes('src/jobs/processMetaInbox.js')).length,unreadableNvaPids:unreadable,coverageWarning:'Readable /proc only; zero does not prove absence. systemd, containers, alternate paths/users and cron require operator reconciliation.',cron,savedPM2,fileMetadata:metadata};
}
try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}catch(e){process.stderr.write('READ_ONLY_INSPECTION_REFUSED: '+(['LINUX_INSPECTION_ONLY','ABSOLUTE_NVA_APP_DIR_REQUIRED','NVA_IDENTITY_REFUSED'].includes(e.message)?e.message:'INPUT_OR_PERMISSION_ERROR')+'\n');process.exitCode=2;}
