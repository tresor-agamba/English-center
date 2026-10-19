// Pure mocked configuration/storage contracts. Never opens a database or socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createMetaInboxRuntime, validateMetaInboxTarget } = require('../src/services/metaInboxRuntime');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
function env() { return {
  NODE_ENV:'production', META_INBOX_ENVIRONMENT:'production', META_WHATSAPP_INBOX_ENABLED:'true',
  META_INBOX_PRODUCTION_AUTHORIZED:'true', WHATSAPP_ENABLED:'false', WHATSAPP_WORKERS_ENABLED:'false',
  META_INBOX_DATABASE_URL:'postgresql://nva_meta_inbox_ingress_prod:synthetic-unused@127.0.0.1:5432/english_center',
  META_INBOX_ENDPOINT_ID:'55555555-5555-4555-8555-555555555555', META_INBOX_APPLICATION_KEY:'synthetic-prod',
  META_INBOX_APP_ID:'3001', WHATSAPP_BUSINESS_ACCOUNT_ID:'2001', WHATSAPP_PHONE_NUMBER_ID:'1001',
  WHATSAPP_APP_SECRET:'synthetic-app-secret-not-real-123456789', WHATSAPP_VERIFY_TOKEN:'synthetic-verify-token-not-real-123456789',
  META_INBOX_AUTH_KEY_VERSION:'a1', META_INBOX_LOOKUP_KEYS_JSON:JSON.stringify({l1:'01'.repeat(32)}),
  META_INBOX_LOOKUP_KEY_VERSION:'l1', META_INBOX_STREAM_KEY_HEX:'02'.repeat(32), META_INBOX_STREAM_KEY_VERSION:'s1',
  META_INBOX_ENCRYPTION_KEYS_JSON:JSON.stringify({e1:'03'.repeat(32)}), META_INBOX_ENCRYPTION_KEY_VERSION:'e1'
}; }
function setup(changes={}, identityChanges={}, forbidden=false) {
  const e={...env(),...changes};let constructions=0;
  const backend=createMetaInboxMock({id:e.META_INBOX_ENDPOINT_ID,environment:e.META_INBOX_ENVIRONMENT,
    applicationKey:e.META_INBOX_APPLICATION_KEY,metaAppId:e.META_INBOX_APP_ID,wabaId:e.WHATSAPP_BUSINESS_ACCOUNT_ID,
    phoneNumberId:e.WHATSAPP_PHONE_NUMBER_ID,inboxEnabled:true,processingEnabled:false,disabledAt:null,
    identityVersion:1,normalizationVersion:1,lookupKeyVersion:'l1',streamKeyVersion:'s1'});
  const original=backend.db.$queryRaw;
  backend.db.$queryRaw=async(strings,...values)=>{
    const sql=strings.join('');
    if(sql.includes('current_database()'))return [{database:'english_center',role:'nva_meta_inbox_ingress_prod',address:'127.0.0.1',port:5432,
      rolcanlogin:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolinherit:false,
      memberships:false,database_create:false,schema_create:false,...identityChanges}];
    if(sql.includes('AS forbidden'))return [{forbidden}];
    return original(strings,...values);
  };
  const runtime=createMetaInboxRuntime(e,{createDatabase:options=>{
    constructions++; const u=new URL(options.datasourceUrl);
    assert.equal(u.searchParams.get('connection_limit'),'4');assert.deepEqual(options.log,[]);
    return {...backend.db,$disconnect:async()=>{}};
  }});
  const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'2001',changes:[{field:'messages',
    value:{messaging_product:'whatsapp',metadata:{phone_number_id:'1001'},messages:[{id:'wamid.synthetic.prod',from:'15555550123',type:'text',text:{body:'STOP'}}]}}]}]}));
  const request={rawBody,signature:'sha256='+createHmac('sha256',e.WHATSAPP_APP_SECRET).update(rawBody).digest('hex'),receivedAt:backend.time()};
  return {runtime,backend,request,constructions};
}
test('production persists only through explicit mode, validates SQL identity, encrypts and deduplicates',async()=>{
  const s=setup();assert.equal(await s.runtime.ready(),true);
  assert.equal((await s.runtime.acceptRaw(s.request)).accepted,true);
  assert.equal((await s.runtime.acceptRaw(s.request)).duplicateCount,1);
  const rows=s.backend.rows('metaWebhookEvent');assert.equal(rows.length,1);
  assert.ok(rows[0].normalizedPayloadCiphertext.length>29);assert.equal(rows[0].encryptionKeyVersion,'e1');
  assert.equal(rows[0].state,'READY');assert.equal(s.backend.rows('whatsAppConversation').length,0);
  await s.runtime.close();
});
for(const [name,changes] of Object.entries({disabled:{META_WHATSAPP_INBOX_ENABLED:'false'},notAuthorized:{META_INBOX_PRODUCTION_AUTHORIZED:'false'},
  missingAuthorization:{META_INBOX_PRODUCTION_AUTHORIZED:undefined},wrongNodeEnvironment:{NODE_ENV:'test'},
  productionNodeTestScope:{META_INBOX_ENVIRONMENT:'test'},unknownScope:{META_INBOX_ENVIRONMENT:'staging'}})) {
  test('production gate rejects '+name,()=>assert.throws(()=>setup(changes),{code:'META_INBOX_NOT_ACTIVATED'}));
}
for(const [name,url] of Object.entries({missing:undefined,wrongHost:'postgresql://nva_meta_inbox_ingress_prod:x@localhost:5432/english_center',
  remote:'postgresql://nva_meta_inbox_ingress_prod:x@192.0.2.1:5432/english_center',wrongPort:'postgresql://nva_meta_inbox_ingress_prod:x@127.0.0.1:55432/english_center',
  wrongDatabase:'postgresql://nva_meta_inbox_ingress_prod:x@127.0.0.1:5432/nva_whatsapp_test',
  adminRole:'postgresql://postgres:x@127.0.0.1:5432/english_center',testRole:'postgresql://nva_meta_inbox_ingress:x@127.0.0.1:5432/english_center',
  missingPassword:'postgresql://nva_meta_inbox_ingress_prod@127.0.0.1:5432/english_center',
  queryOverride:'postgresql://nva_meta_inbox_ingress_prod:x@127.0.0.1:5432/english_center?host=example.com',
  invalidEncoding:'postgresql://%ZZ:x@127.0.0.1:5432/english_center'})) {
  test('production rejects target '+name+' without DATABASE_URL fallback',()=>assert.throws(()=>setup({META_INBOX_DATABASE_URL:url,DATABASE_URL:env().META_INBOX_DATABASE_URL}),{code:'META_INBOX_INVALID_CONFIGURATION'}));
}
for(const field of ['WHATSAPP_ENABLED','WHATSAPP_WORKERS_ENABLED'])test('incoming-only rejects outgoing flag '+field,()=>
  assert.throws(()=>setup({[field]:'TRUE'}),{code:'META_INBOX_OUTBOUND_MUST_BE_DISABLED'}));
for(const [name,changes] of Object.entries({zeroId:{META_INBOX_APP_ID:'0'},badWaba:{WHATSAPP_BUSINESS_ACCOUNT_ID:'abc'},
  missingPhone:{WHATSAPP_PHONE_NUMBER_ID:''},missingAppSecret:{WHATSAPP_APP_SECRET:''},missingVerify:{WHATSAPP_VERIFY_TOKEN:''},
  sameKeys:{META_INBOX_STREAM_KEY_HEX:'01'.repeat(32)},missingKeyVersion:{META_INBOX_ENCRYPTION_KEY_VERSION:''},invalidEndpoint:{META_INBOX_ENDPOINT_ID:'not-uuid'}})) {
  test('production rejects configuration '+name,()=>assert.throws(()=>setup(changes)));
}
for(const [name,value] of Object.entries({database:'other',role:'postgres',address:'192.0.2.1',port:55432,rolsuper:true,rolcreatedb:true,
  rolcreaterole:true,rolreplication:true,rolbypassrls:true,rolinherit:true,memberships:true,database_create:true,schema_create:true,rolcanlogin:false})) {
  test('actual SQL identity/privileges rejected: '+name,async()=>{
    const s=setup({}, {[name]:value});await assert.rejects(s.runtime.acceptRaw(s.request),{code:'META_INBOX_DATABASE_IDENTITY_REJECTED'});
    assert.equal(s.backend.rows('metaWebhookEvent').length,0);
  });
}
test('unexpected effective ACLs including PUBLIC fail before persistence',async()=>{
  const s=setup({}, {},true);await assert.rejects(s.runtime.ready(),{code:'META_INBOX_DATABASE_PRIVILEGES_REJECTED'});
});
test('invalid HMAC and foreign Meta identifiers never persist in production',async()=>{
  const s=setup();await assert.rejects(s.runtime.acceptRaw({...s.request,signature:'sha256'+'0'.repeat(64)}),{code:'META_INBOX_INVALID_SIGNATURE'});
  const rawBody=Buffer.from(s.request.rawBody.toString().replace('2001','9999'));
  await assert.rejects(s.runtime.acceptRaw({...s.request,rawBody,signature:'sha256='+createHmac('sha256',env().WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}),{code:'META_INBOX_ACCOUNT_MISMATCH'});
  assert.equal(s.backend.rows('metaWebhookEvent').length,0);
});
test('test mode retains exact Windows target and cannot opt in to production target',()=>{
  const e={...env(),NODE_ENV:'test',META_INBOX_ENVIRONMENT:'test',META_INBOX_PRODUCTION_AUTHORIZED:'true',
    META_INBOX_DATABASE_URL:'postgresql://nva_meta_inbox_ingress:synthetic-unused@127.0.0.1:55432/nva_whatsapp_test'};
  assert.equal(validateMetaInboxTarget(e).production,false);
  for(const changes of [{META_INBOX_DATABASE_URL:env().META_INBOX_DATABASE_URL},{NODE_ENV:'production'},
    {META_INBOX_DATABASE_URL:e.META_INBOX_DATABASE_URL.replace('55432','5432')}])assert.throws(()=>validateMetaInboxTarget({...e,...changes}));
});
test('service independently refuses unauthorized production and test-in-production',async()=>{
  for(const [environment,nodeEnvironment] of [['production','production'],['test','production']]){
    const scope={environment,wabaId:'2001',phoneNumberId:'1001'};let called=false;
    const service=createMetaInboxService({repository:{scope,accept:async()=>{called=true;}},scope,authentication:{secret:'synthetic',version:'a1'},
      mode:'durable',activationEnabled:true,nodeEnvironment});
    await assert.rejects(service.acceptRaw({}),{code:'META_INBOX_NOT_ACTIVATED'});assert.equal(called,false);
  }
});
test('test service cannot keep operating if the actual process switches to production',async()=>{
  const scope={environment:'test',wabaId:'2001',phoneNumberId:'1001'};
  const service=createMetaInboxService({repository:{scope,accept:async()=>{throw Error('must not run');}},scope,
    authentication:{secret:'synthetic',version:'a1'},mode:'durable',activationEnabled:true,nodeEnvironment:'test'});
  const previous=process.env.NODE_ENV;
  try {process.env.NODE_ENV='production';await assert.rejects(service.acceptRaw({}),{code:'META_INBOX_NOT_ACTIVATED'});}
  finally {if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
