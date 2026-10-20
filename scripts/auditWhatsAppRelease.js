// Offline only: never opens a database connection or prints environment values.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),base=path.join(root,'prisma/migrations');
const approved=['20261020120000_add_whatsapp_chatbot_admin','20261020140000_add_whatsapp_interactive_scenarios'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const migrations=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>{const bytes=fs.readFileSync(path.join(base,x.name,'migration.sql'));const text=bytes.toString('utf8');return {name:x.name,sha256:sha(bytes),compatibleChecksums:[...new Set([sha(bytes),sha(text.replace(/\r\n/g,'\n')),sha(text.replace(/\r?\n/g,'\r\n'))])],approved:approved.includes(x.name)};}).sort((a,b)=>a.name.localeCompare(b.name));
const blockers=[];
for(const name of approved){
 const sql=fs.readFileSync(path.join(base,name,'migration.sql'),'utf8').replace(/--[^\n]*/g,'');
 for(const stmt of sql.split(';').map(x=>x.trim()).filter(Boolean))if(!/^(CREATE TABLE |CREATE INDEX |INSERT INTO "WhatsAppChatbotRule" |ALTER TABLE "whatsapp_conversation_messages" ADD COLUMN )/.test(stmt))blockers.push('Unapproved SQL statement in '+name);
}
const arg=process.argv.indexOf('--history');let pending=null;
if(arg>=0){const history=JSON.parse(fs.readFileSync(process.argv[arg+1],'utf8'));if(!Array.isArray(history))throw Error('History must be a JSON array');
 const applied=new Set();
 for(const row of history){if(row.rolled_back_at)continue;if(!row.finished_at){blockers.push('Unfinished migration: '+row.migration_name);continue;}
 const local=migrations.find(m=>m.name===row.migration_name);if(!local)blockers.push('Applied migration missing locally: '+row.migration_name);else if(!local.compatibleChecksums.includes(row.checksum))blockers.push('Checksum mismatch: '+row.migration_name);applied.add(row.migration_name);}
 pending=migrations.filter(m=>!applied.has(m.name)).map(m=>m.name);
 for(const name of pending)if(!approved.includes(name))blockers.push('Unapproved pending migration: '+name);
}else blockers.push('Remote migration history not supplied: pending set and checksums unverified');
const result={checkedAt:new Date().toISOString(),prisma:require('../package.json').dependencies['@prisma/client'],approved,pending,blockers,migrations};
const outputArg=process.argv.indexOf('--output');const out=outputArg<0?path.join(root,'output/whatsapp-readiness'):path.resolve(process.argv[outputArg+1]);
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'migration-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({approved,pending,blockers},null,2));process.exitCode=blockers.length?2:0;
