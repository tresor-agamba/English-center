// Called only after the parent launcher has attested its hard-coded local cluster.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto'),{Client}=require('pg');
module.exports=async function prepare({root,out,target,owner,runner,passwords,testEnv}){
 assert.deepEqual(target,{host:'127.0.0.1',port:58432,database:'nva_whatsapp_v2_test'});
 const sql=new Client({...target,user:owner});await sql.connect();
 try{
  const {rows:[identity]}=await sql.query("SELECT current_database() db,current_setting('data_directory') directory,inet_server_port() port");assert.equal(identity.db,target.database);assert.equal(identity.port,target.port);assert.equal(path.resolve(identity.directory).toLowerCase(),path.join(out,'cluster').toLowerCase());
  const ddl=fs.readFileSync(path.join(root,'docs/sql/meta-inbox-schema-reviewed.sql'),'utf8'),hash=createHash('sha256').update(ddl).digest('hex');
  const exists=(await sql.query("SELECT to_regclass('public.meta_webhook_endpoints') AS t")).rows[0].t;
  if(!exists){try{await sql.query('BEGIN;\n'+ddl+'\nCOMMIT;');}catch(e){await sql.query('ROLLBACK');throw e;}fs.writeFileSync(path.join(out,'meta-schema.sha256'),hash+'\n');}
  else assert.equal(fs.readFileSync(path.join(out,'meta-schema.sha256'),'utf8').trim(),hash,'Refuse unknown Meta schema');
  const consentDDL=fs.readFileSync(path.join(root,'docs/sql/whatsapp-admission-worker-consent-function.sql'),'utf8');await sql.query('BEGIN;\n'+consentDDL+'\nCOMMIT;');
  for(const table of ['meta_webhook_endpoints','meta_webhook_events','meta_webhook_receipts','meta_webhook_receipt_items'])assert.equal((await sql.query('SELECT count(*)::int n FROM public.'+table)).rows[0].n,0,'Pristine Meta laboratory required');
  const roleFiles=[['nva_v2_meta_ingress','nva_meta_inbox_ingress_prod','docs/sql/meta-inbox-production-ingress-role.sql'],['nva_v2_meta_worker','nva_meta_inbox_worker_prod','docs/sql/meta-inbox-production-worker-role.sql']];
  for(const [role,source,file]of roleFiles){
   let script=fs.readFileSync(path.join(root,file),'utf8').replace(/^\\.*$/gm,'').replaceAll(source,role).replaceAll('english_center',target.database).replace(/\b5432\b/g,String(target.port));
   const present=(await sql.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
   if(present)script='BEGIN;\n'+script.slice(script.indexOf('GRANT CONNECT'));
   try{await sql.query(script);}catch(e){await sql.query('ROLLBACK');throw e;}
   passwords[role]=randomBytes(32).toString('hex');
   await sql.query('ALTER ROLE '+role+' LOGIN PASSWORD '+sql.escapeLiteral(passwords[role]));
   const key=role.endsWith('worker')?'META_INBOX_WORKER_DATABASE_URL':'META_INBOX_DATABASE_URL';testEnv[key]=`postgresql://${role}:${passwords[role]}@127.0.0.1:58432/nva_whatsapp_v2_test`;
  }
  // Only this dedicated lab's HBA changes; no service/installation or other cluster.
  const hbaPath=path.join(out,'cluster/pg_hba.conf');let hba=fs.readFileSync(hbaPath,'utf8');
  for(const [role]of roleFiles)if(!hba.includes(' '+role+' '))hba=hba.replace('host all all 127.0.0.1/32 reject',`host nva_whatsapp_v2_test ${role} 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject`);
  fs.writeFileSync(hbaPath,hba);await sql.query('SELECT pg_reload_conf()');
  // Reproduce an existing worker missing precisely the old admission draft grant,
  // then run candidate 06 with ONLY its role/database/port names adapted.
  await sql.query('REVOKE UPDATE ("confirmationDraft") ON public."WhatsAppAdmissionRequest" FROM nva_v2_meta_worker');
  const before=(await sql.query("SELECT has_column_privilege('nva_v2_meta_worker','public.\"WhatsAppAdmissionRequest\"','confirmationDraft','UPDATE') p")).rows[0].p;assert.equal(before,false);
  const repair=fs.readFileSync(path.join(root,'deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql'),'utf8');
  try{await sql.query(repair.replace(/^\\.*$/gm,'').replaceAll('english_center',target.database).replaceAll('nva_meta_inbox_worker_prod','nva_v2_meta_worker').replace(/\b5432\b/g,String(target.port)));}catch(e){await sql.query('ROLLBACK');throw e;}
  const after=(await sql.query("SELECT has_column_privilege('nva_v2_meta_worker','public.\"WhatsAppAdmissionRequest\"','confirmationDraft','UPDATE') p")).rows[0].p;assert.equal(after,true);
  fs.writeFileSync(path.join(out,'meta-grant-repair.json'),JSON.stringify({before,after,source:'deploy/whatsapp-chatbot/06-worker-admission-draft-grant.sql',sha256:createHash('sha256').update(repair).digest('hex'),productionExecuted:false},null,2)+'\n');
  const webGrants=fs.readFileSync(path.join(root,'deploy/whatsapp-chatbot/07-admin-meta-manual-grants.sql'),'utf8').match(/GRANT (?:SELECT|EXECUTE)[\s\S]*?;/g);assert.equal(webGrants.length,3);
  await sql.query(webGrants.join('\n').replaceAll(':"nva_app_role"',runner));
  await sql.query('GRANT SELECT ON public.whatsapp_commercial_consent_events TO '+runner);
  const inventory=[];for(const [role]of roleFiles){
   const flags=(await sql.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[role])).rows[0];
   const columns=(await sql.query('SELECT table_name,column_name,privilege_type,is_grantable FROM information_schema.column_privileges WHERE grantee=$1 ORDER BY table_name,column_name,privilege_type',[role])).rows;
   const sequences=(await sql.query("SELECT c.relname,has_sequence_privilege($1,c.oid,'USAGE') AS usage,has_sequence_privilege($1,c.oid,'SELECT') AS select,has_sequence_privilege($1,c.oid,'UPDATE') AS update FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname",[role])).rows;
   inventory.push({flags,columns,sequences});
  }fs.writeFileSync(path.join(out,'meta-acl-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
  const triggers=(await sql.query("SELECT tgname,tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('meta_webhook_endpoints'::regclass,'meta_webhook_events'::regclass,'meta_webhook_receipts'::regclass,'meta_webhook_receipt_items'::regclass) ORDER BY tgname")).rows;assert.equal(triggers.length,7);assert.ok(triggers.every(t=>t.tgenabled==='O'));
  const consentFunction=(await sql.query("SELECT p.prosecdef AS security_definer,p.proconfig AS settings,pg_get_userbyid(p.proowner) AS owner,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid='public.nva_record_admission_consent(integer,text,jsonb)'::regprocedure")).rows[0];assert.equal(consentFunction.public_execute,false);assert.equal(consentFunction.security_definer,true);
  fs.writeFileSync(path.join(out,'meta-role-preparation.json'),JSON.stringify({target,ddlSha256:hash,consentFunctionSha256:createHash('sha256').update(consentDDL).digest('hex'),consentFunction,roles:roleFiles.map(x=>x[0]),canonicalSource:roleFiles.map(x=>x[2]),adaptation:'Only laboratory database, port, role names; original grants and checks retained',triggers},null,2)+'\n');
  testEnv.NVA_V2_META_FIXTURE_URL=`postgresql://${owner}@127.0.0.1:58432/nva_whatsapp_v2_test`;
 }finally{await sql.end();}
};
