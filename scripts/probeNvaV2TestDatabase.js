// Read-only connection diagnostics. Never connects to DATABASE_URL or runs DDL/DML.
const fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');
const {assertSafeTestDatabase}=require('../src/utils/testDatabaseGuard');
const root=path.resolve(__dirname,'..');
async function probe(label,url){
 const parsed=new URL(url);if(!['127.0.0.1','localhost','::1','[::1]'].includes(parsed.hostname))return {label,status:'REFUSED',code:'NONLOCAL_TARGET'};
 const client=new Client({connectionString:url,connectionTimeoutMillis:2000,options:'-c default_transaction_read_only=on -c statement_timeout=3000'});
 try{
  await client.connect();const {rows:[r]}=await client.query("SELECT current_database() AS db,inet_server_port() AS port,current_setting('transaction_read_only') AS readonly");
  if(r.db!==decodeURIComponent(parsed.pathname.slice(1))||r.port!==Number(parsed.port||5432)||r.readonly!=='on')return {label,status:'REFUSED',code:'IDENTITY_MISMATCH'};
  return {label,status:'READ_ONLY_CONNECTION_OK',port:r.port,readOnly:true,note:'Connection alone is not attestation of an isolated writable test database.'};
 }catch(e){return {label,status:'UNAVAILABLE',code:e.code||'CONNECTION_FAILED'};}finally{await client.end().catch(()=>{});}
}
async function main(){
 const envFile=path.join(root,'.env');const configured={...(fs.existsSync(envFile)?require('dotenv').parse(fs.readFileSync(envFile)):{}),...process.env};
 const results=[];
 try{assertSafeTestDatabase(configured);results.push(await probe('configured_test_database',configured.TEST_DATABASE_URL));}catch(e){results.push({label:'configured_test_database',status:'REFUSED',code:e.code||'UNSAFE_TEST_CONFIGURATION'});}
 // Historical local lab: explicit endpoint, not an inherited application URL.
 results.push(await probe('historical_isolated_lab','postgresql://nva_validation_app@127.0.0.1:56432/nva_admissions_validation_v2?sslmode=disable'));
 const share='C:/Program Files/PostgreSQL/16/share/postgres.bki';
 const report={date:'2026-10-24',mode:'READ_ONLY',results,postgresBootstrapCatalogPresent:fs.existsSync(share),writeValidationPerformed:false};
 fs.writeFileSync(path.join(root,'output/nva-v2-database-probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(!results.some(r=>r.status==='READ_ONLY_CONNECTION_OK'))process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error(e.code||'PROBE_FAILED');process.exitCode=2;});
module.exports={probe};
