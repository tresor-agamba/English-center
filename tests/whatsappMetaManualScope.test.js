const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {readScope,matches}=require('../src/services/metaManualReplyScope');
const {createMetaInboxCrypto}=require('../src/services/metaInboxProtocol');
function env(){return {NODE_ENV:'test',META_WHATSAPP_INBOX_ENABLED:'true',META_INBOX_ENVIRONMENT:'test',META_INBOX_DATABASE_URL:'postgresql://nva_meta_inbox_ingress:synthetic@127.0.0.1:55432/nva_whatsapp_test',META_INBOX_ENDPOINT_ID:'77777777-7777-4777-8777-777777777777',META_INBOX_APPLICATION_KEY:'scope',META_INBOX_APP_ID:'3001',WHATSAPP_BUSINESS_ACCOUNT_ID:'2001',WHATSAPP_PHONE_NUMBER_ID:'1001',META_INBOX_STREAM_KEY_HEX:'02'.repeat(32),META_INBOX_SEND_ENABLED:'true',WHATSAPP_ENABLED:'false',WHATSAPP_WORKERS_ENABLED:'false'};}
test('manual channel uses Meta while legacy is disabled and fails closed on coexistence',()=>{
 const e=env();assert.equal(readScope(e).enabled,true);assert.equal(readScope({...e,META_INBOX_SEND_ENABLED:'false'}).enabled,false);assert.throws(()=>readScope({...e,WHATSAPP_ENABLED:'TRUE'}));
 const human=require('../src/services/whatsappHumanHandoffService').createWhatsAppHumanHandoffService({env:e,configProvider:()=>({enabled:false})});assert.equal(human.channelEnabled(),true);
});
test('manual stream identity is identical to the existing inbox crypto protocol',()=>{
 const e=env(),crypto=createMetaInboxCrypto({lookupKeys:{l1:Buffer.alloc(32,1)},currentLookupVersion:'l1',streamKey:Buffer.alloc(32,2),streamKeyVersion:'s1',encryptionKeys:{e1:Buffer.alloc(32,3)},currentEncryptionVersion:'e1'});
 assert.deepEqual(readScope(e).stream('+243812345678'),crypto.stream(e.META_INBOX_ENDPOINT_ID,'243812345678'));
});
test('only explicit endpoint-scoped, conversation-bound, authored TEXT messages match',()=>{
 const e=env(),row={idempotencyKey:'wa-meta-manual:'+e.META_INBOX_ENDPOINT_ID+':7:11111111-1111-4111-8111-111111111111',conversationId:7,senderUserId:1,direction:'OUTBOUND',messageType:'TEXT'};assert.equal(matches(row,e.META_INBOX_ENDPOINT_ID),true);
 for(const change of [{conversationId:8},{senderUserId:null},{messageType:'SYSTEM'},{interactivePayload:{type:'button'}},{idempotencyKey:'wa-manual:7:11111111-1111-4111-8111-111111111111'}])assert.equal(matches({...row,...change},e.META_INBOX_ENDPOINT_ID),false);
 assert.equal(matches(row,'88888888-8888-4888-8888-888888888888'),false);
});
test('the 58432 laboratory target requires all local opt-in guards and is never production',()=>{
 const {validateMetaInboxTarget}=require('../src/services/metaInboxRuntime'),e={...env(),NVA_V2_DATABASE_TESTS_ENABLED:'true',NVA_V2_DATABASE_EXPECTED_DIRECTORY:path.resolve(__dirname,'../output/nva-whatsapp-v2-postgres-20261024/cluster'),META_INBOX_DATABASE_URL:'postgresql://nva_v2_meta_ingress:synthetic@127.0.0.1:58432/nva_whatsapp_v2_test'};
 assert.equal(validateMetaInboxTarget(e).lab,true);for(const change of [{NVA_V2_DATABASE_TESTS_ENABLED:'false'},{NODE_ENV:'production'},{NVA_V2_DATABASE_EXPECTED_DIRECTORY:path.resolve(__dirname,'../output/other')}])assert.throws(()=>validateMetaInboxTarget({...e,...change}));
});
