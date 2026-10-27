#!/usr/bin/env bash
# Source manually on Contabo after approval. No deployment runs when sourced.
set -euo pipefail
umask 077
nva_check_context() {
  : "${NVA_APP_DIR:?}" "${NVA_PROCESS:?}"
  export NVA_APP_DIR NVA_PROCESS
  node <<'NODE'
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
try {
 const dir=fs.realpathSync(process.env.NVA_APP_DIR), name=process.env.NVA_PROCESS;
 if(/novance/i.test(name)||/novance/i.test(dir))throw Error('Forbidden application');
 const list=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:16*1024*1024}));
 const selected=list.filter(p=>p.name===name);
 if(selected.length!==1||fs.realpathSync(selected[0].pm2_env.pm_cwd)!==dir)throw Error('NVA process/cwd mismatch');
 if(require(dir+'/package.json').name!=='english-center')throw Error('Wrong project');
 console.log('NVA_CONTEXT_OK');
} catch { console.error('NVA_CONTEXT_REFUSED: verify process name and absolute cwd; no action performed');process.exit(1); }
NODE
}
nva_restart_disabled() {
  nva_check_context
  node <<'NODE'
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const dir=process.env.NVA_APP_DIR;
try {
 const dotenv=require(dir+'/node_modules/dotenv');
 const file=dotenv.parse(fs.readFileSync(dir+'/.env'));
 if(file.WHATSAPP_ENABLED!=='false'||file.WHATSAPP_WORKERS_ENABLED!=='false'||file.NVA_CHATBOT_AI_ENABLED!=='false')throw Error('Outbound flags must be false');
 if(['META_INBOX_SEND_ENABLED','META_INBOX_WORKER_ENABLED'].some(k=>String(file[k]||'').trim().toLowerCase()==='true'))throw Error('Meta processing and sending must be disabled');
 const env={...process.env,...file,NODE_ENV:'production',WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false',NVA_AI_ENABLED:'false',NVA_FOLLOWUPS_ENABLED:'false',NVA_FOLLOWUPS_DRY_RUN:'true',META_INBOX_SEND_ENABLED:'false',META_INBOX_WORKER_ENABLED:'false'};
 const result=spawnSync('pm2',['restart',process.env.NVA_PROCESS,'--update-env'],{env,stdio:['ignore','inherit','inherit']});
 if(result.error||result.status!==0)process.exit(1);
} catch {console.error('NVA_RESTART_REFUSED');process.exit(1);}
NODE
}
nva_prisma() {
  : "${NVA_APP_DIR:?}" "${NVA_MIGRATION_ENV:?}" "${NVA_DB:?}" "${NVA_PGPORT:?}"
  export NVA_APP_DIR NVA_MIGRATION_ENV NVA_DB NVA_PGPORT
  node - "$@" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
try {
 const candidate=process.cwd();
 const pkg=require(path.join(candidate,'package.json'));
 if(pkg.name!=='english-center'||require(path.join(candidate,'node_modules/prisma/package.json')).version!=='6.19.3')throw Error('Wrong candidate or Prisma version');
 const dotenv=require(path.join(candidate,'node_modules/dotenv'));
 const file=dotenv.parse(fs.readFileSync(process.env.NVA_MIGRATION_ENV));
 const url=new URL(file.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||decodeURIComponent(url.pathname.slice(1))!==process.env.NVA_DB||(url.port||'5432')!==process.env.NVA_PGPORT)throw Error('Wrong migration target');
 const args=process.argv.slice(2);
 if(args[0]!=='migrate'||!['status','deploy'].includes(args[1])||args.length!==2)throw Error('Only migration status/deploy allowed');
 const env={...process.env,...file,WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false',NVA_CHATBOT_AI_ENABLED:'false'};
 const result=spawnSync(process.execPath,[path.join(candidate,'node_modules/prisma/build/index.js'),...args],{cwd:process.cwd(),env,encoding:'utf8',maxBuffer:16*1024*1024});
 let output=(result.stdout||'')+(result.stderr||'');
 for(const [k,v] of Object.entries(env))if(/secret|password|token|api_key|database_url/i.test(k)&&v&&v.length>=4)output=output.split(v).join('[REDACTED]');
 for(const v of [url.password,decodeURIComponent(url.password)])if(v)output=output.split(v).join('[REDACTED]');
 output=output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[DATABASE_URL]');
 process.stdout.write(output);
 process.exit(result.status===0?0:1);
} catch {console.error('NVA_PRISMA_REFUSED: invalid target, command or configuration');process.exit(1);}
NODE
}
