// Offline source audit only: no dotenv, database, sender, PM2 or OS service access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const grants=read('docs/sql/meta-inbox-production-worker-role.sql');
const update=grants.match(/GRANT UPDATE\s*\(([^)]+)\)\s*ON public\."WhatsAppAdmissionRequest"/);
const columns=update?update[1].split(',').map(s=>s.trim().replaceAll('"','')):[];
const migrations=fs.readdirSync(path.join(root,'prisma/migrations')).filter(name=>fs.existsSync(path.join(root,'prisma/migrations',name,'migration.sql'))).sort().map(name=>({name,sha256:hash(read('prisma/migrations/'+name+'/migration.sql'))}));
const pm2=require('../ecosystem.config.cjs');
const logger=require('../src/services/loggerService');
const sample=logger.sanitize(new Error('Synthetic prospect: audit@example.test +243800000001'));
const pkg=require('../package.json');
const files=['src/services/whatsappAdmissionService.js','src/services/whatsappAdmissionVerification.js','src/services/whatsappInteractive.js','src/services/metaInboxRuntime.js','src/services/metaInboxWorkerService.js','src/services/metaInboxService.js','src/services/loggerService.js','src/services/registrationService.js','src/config/metaInboxWorkerConfig.js','src/server.js','src/jobs/processMetaInbox.js','ecosystem.config.cjs','package.json','package-lock.json','docs/sql/meta-inbox-schema-reviewed.sql','docs/sql/meta-inbox-production-worker-role.sql','deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql','deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs','deploy/whatsapp-chatbot/operator-functions.sh'];
const lock=require('../package-lock.json');
const report={auditDate:'2026-10-24',scope:'offline source; no production inspection',node:process.version,platform:process.platform,prisma:pkg.dependencies['@prisma/client'],packageEngines:pkg.engines||null,
 dependencyNodeEngines:Object.fromEntries(['file-type','nodemailer','@prisma/client'].map(name=>[name,lock.packages['node_modules/'+name]?.engines?.node])),
 pm2Candidate:require('../deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs').apps.map(a=>({name:a.name,script:a.script,waitReady:a.wait_ready,killTimeout:a.kill_timeout,instances:a.instances})),
 workerAdmissionUpdateColumns:columns,workerReconfirmationWritesDraft:read('src/services/whatsappAdmissionService.js').includes('consentAt:now,confirmationDraft:receivedDraft'),workerGrantMissingDraft:!columns.includes('confirmationDraft'),
 loggerSyntheticEmailSurvives:sample.message.includes('audit@example.test'),loggerSyntheticPhoneSurvives:sample.message.includes('+243800000001'),
 pm2:pm2.apps.map(a=>({name:a.name,script:a.script,instances:a.instances,execMode:a.exec_mode,killTimeout:a.kill_timeout,waitReady:a.wait_ready})),
 metaDDLInPrismaMigrations:migrations.some(m=>/CREATE TABLE\s+"?meta_webhook_/i.test(read('prisma/migrations/'+m.name+'/migration.sql'))),
 migrations,sourceHashes:Object.fromEntries(files.map(f=>[f,hash(read(f))]))};
const out=path.join(root,'output/nva-v2-preproduction-source-audit.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({evidence:'output/nva-v2-preproduction-source-audit.json',migrationCount:migrations.length,workerGrantMissingDraft:report.workerGrantMissingDraft,loggerSyntheticEmailSurvives:report.loggerSyntheticEmailSurvives,loggerSyntheticPhoneSurvives:report.loggerSyntheticPhoneSurvives,metaDDLInPrismaMigrations:report.metaDDLInPrismaMigrations}));
