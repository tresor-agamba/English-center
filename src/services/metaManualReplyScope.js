// No singleton DB or sender. Manual messages use the existing conversation outbox.
const {streamDigest}=require('./metaInboxProtocol');
const {validateMetaInboxTarget}=require('./metaInboxRuntime');
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY=new RegExp('^wa-meta-manual:('+UUID+'):(\\d+):('+UUID+')$','i');
const prefix=endpointId=>'wa-meta-manual:'+endpointId+':';
function readScope(env){
 if(env.META_WHATSAPP_INBOX_ENABLED!=='true')return null;
 const {production}=validateMetaInboxTarget(env);
 if(['WHATSAPP_ENABLED','WHATSAPP_WORKERS_ENABLED'].some(k=>String(env[k]||'').trim().toLowerCase()==='true'))throw Error('META_MANUAL_LEGACY_CONFLICT');
 if(!new RegExp('^'+UUID+'$','i').test(env.META_INBOX_ENDPOINT_ID||'')||!/^[a-f0-9]{64}$/i.test(env.META_INBOX_STREAM_KEY_HEX||''))throw Error('META_MANUAL_SCOPE_INVALID');
 return {endpointId:env.META_INBOX_ENDPOINT_ID,environment:env.META_INBOX_ENVIRONMENT,applicationKey:env.META_INBOX_APPLICATION_KEY,metaAppId:env.META_INBOX_APP_ID,wabaId:env.WHATSAPP_BUSINESS_ACCOUNT_ID,phoneNumberId:env.WHATSAPP_PHONE_NUMBER_ID,
  enabled:env.META_INBOX_SEND_ENABLED==='true'&&(!production||env.META_INBOX_SEND_PRODUCTION_AUTHORIZED==='true'),
  stream:phone=>streamDigest(Buffer.from(env.META_INBOX_STREAM_KEY_HEX,'hex'),env.META_INBOX_ENDPOINT_ID,String(phone).replace(/^\+/, ''))};
}
function matches(row,endpointId){const m=KEY.exec(row.idempotencyKey||'');return Boolean(m&&m[1]===endpointId&&m[2]===String(row.conversationId)&&row.senderUserId&&row.direction==='OUTBOUND'&&row.messageType==='TEXT'&&!row.interactivePayload);}
module.exports={readScope,prefix,matches};
