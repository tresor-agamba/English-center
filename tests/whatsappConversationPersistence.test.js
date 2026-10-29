const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhatsAppConversationService, messageTypeForProvider, inboundText } = require('../src/services/whatsappConversationService');

function memoryClient() {
  const state = { conversations: [], messages: [], consents: [], followUps: [], followUpCancellationReasons: [], nextConversationId: 1, nextMessageId: 1 };
  const tx = {
    user: { findMany: async () => [] },
    whatsAppConversation: {
      upsert: async ({ where, create }) => {
        let row = state.conversations.find((item) => item.phoneNumber === where.phoneNumber);
        if (!row) { row = { id: state.nextConversationId++, engineState: null, userId: null, ...create }; state.conversations.push(row); }
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = state.conversations.find((item) => item.id === where.id);
        if (!row) throw new Error('conversation missing');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }) => {
        if (where.controlState?.notIn) {
          const row = state.conversations.find((item) => item.id === where.id);
          if (!row || where.controlState.notIn.includes(row.controlState)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }
        const rows = state.messages.filter((item) => item.conversationId === where.conversationId && item.direction === where.direction && item.deliveryStatus === where.deliveryStatus);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      findUnique: async ({ where }) => state.conversations.find((item) => item.id === where.id) || null,
    },
    whatsAppConversationMessage: {
      updateMany: async ({ where, data }) => {
        const rows = state.messages.filter(item => Object.entries(where).every(([key, value]) => item[key] === value));
        rows.forEach(row => Object.assign(row, data));
        return { count: rows.length };
      },
      create: async ({ data }) => {
        if (data.providerMessageId && state.messages.some((item) => item.providerMessageId === data.providerMessageId)) {
          const error = new Error('unique'); error.code = 'P2002'; throw error;
        }
        if (data.idempotencyKey && state.messages.some((item) => item.idempotencyKey === data.idempotencyKey)) {
          const error = new Error('unique'); error.code = 'P2002'; throw error;
        }
        const row = { id: state.nextMessageId++, ...data };
        state.messages.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.messages.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
      findUnique: async ({ where }) => state.messages.find((item) => item.providerMessageId === where.providerMessageId) || null,
    },
    whatsAppCommercialConsentEvent: {
      create: async ({ data }) => {
        if (state.consents.some((item) => item.deduplicationKey === data.deduplicationKey)) {
          const error = new Error('unique'); error.code = 'P2002'; throw error;
        }
        const row = { id: state.consents.length + 1, ...data };
        state.consents.push(row);
        return row;
      },
    },
    whatsAppProspectFollowUp: {
      upsert: async ({ where, create }) => {
        let row = state.followUps.find((item) => item.deduplicationKey === where.deduplicationKey);
        if (!row) { row = { id: state.followUps.length + 1, ...create }; state.followUps.push(row); }
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
    whatsAppPreference: { findMany: async () => [] },
  };
  const client = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  return { client, state };
}

function makeService({ templatesConfigured = false, catalogCourses = [], registrationCourses = [] } = {}) {
  const { client, state } = memoryClient();
  const service = createWhatsAppConversationService({
    client,
    catalog: { listPublished: async () => catalogCourses },
    registration: { listCoursesForPublicRegistration: async () => registrationCourses },
    preferences: { recordWhatsAppOptOut: async () => {} },
    followUps: {
      cancelForConversation: async (_conversationId, reason) => { state.followUpCancellationReasons.push(reason); },
      schedule: async (input, tx) => {
        const config = { prospectFollowUp24hTemplate: 'nva_follow_up_24h', prospectFollowUp72hTemplate: 'nva_follow_up_72h' };
        const consent = state.consents.find((event) => event.id === input.consentEventId);
        for (const [hours, templateName] of [[24, config.prospectFollowUp24hTemplate], [72, config.prospectFollowUp72hTemplate]]) {
          const deduplicationKey = `wa-prospect-follow-up:consent-${consent.id}:${hours}h`;
          await tx.whatsAppProspectFollowUp.upsert({ where: { deduplicationKey }, create: { conversationId: input.conversationId, consentEventId: consent.id, sequenceHours: hours, templateName, scheduledFor: new Date(input.consentedAt.getTime() + hours * 3600000), deduplicationKey }, update: {} });
        }
      },
    },
    followUpConfig: () => templatesConfigured ? { prospectFollowUp24hTemplate: 'nva_follow_up_24h', prospectFollowUp72hTemplate: 'nva_follow_up_72h' } : {},
    publicAppUrl: 'https://nva.example',
    now: () => new Date('2026-10-09T12:00:00Z'),
  });
  return { service, state, client };
}

test('persiste la clarification et réutilise le contexte depuis une nouvelle instance du service', async () => {
  const course = { id: 11, slug: 'anglais-general', title: 'Anglais général', pricingActive: true, pricingMode: 'ONE_TIME', price: 137, currency: 'USD', upcomingSessionCount: 1,
    session: { id: 101, weekDays: ['Lundi'], startTime: '18:00', endTime: '19:30', registrationGroups: [] } };
  const other = { ...course, id: 12, slug: 'anglais-affaires', title: 'Anglais des affaires' };
  const catalog = [course, other];
  const { service, state, client } = makeService({ catalogCourses: catalog, registrationCourses: catalog });
  const incoming = (id, body) => ({ id, from: '243821234567', type: 'text', text: { body } });
  await service.processInboundMessage(incoming('wamid.price', 'prix'));
  assert.equal(state.conversations[0].engineState.pendingQuestion.intent, 'PRICE');
  // Mimic JSON storage and a new service lifecycle; no retained engine instance.
  state.conversations[0].engineState = JSON.parse(JSON.stringify(state.conversations[0].engineState));
  const restarted = createWhatsAppConversationService({ client,
    catalog: { listPublished: async () => catalog }, registration: { listCoursesForPublicRegistration: async () => catalog },
    publicAppUrl: 'https://nva.example', followUpConfig: () => ({}), now: () => new Date('2026-10-09T12:00:00Z'),
  });
  await restarted.processInboundMessage(incoming('wamid.course', 'Anglais général'));
  assert.equal(state.conversations[0].engineState.selectedCourseId, 11);
  assert.match(state.messages.at(-1).body, /137\s?USD/);
  await restarted.processInboundMessage(incoming('wamid.schedule', 'Et les horaires ?'));
  assert.match(state.messages.at(-1).body, /18:00–19:30/);
  await restarted.processInboundMessage(incoming('wamid.registration', 'inscription'));
  assert.match(state.messages.at(-1).body, /register\?session=101/);
  assert.equal(state.conversations[0].engineState.step, 'REGISTRATION');
  const before = state.messages.length;
  const duplicate = await restarted.processInboundMessage(incoming('wamid.registration', 'inscription'));
  assert.equal(duplicate.duplicate, true); assert.equal(state.messages.length, before);
});

test('le transfert humain annule les réponses ordinaires et conserve la mémoire contextuelle', async () => {
  const course = { id: 11, slug: 'anglais-general', title: 'Anglais général', upcomingSessionCount: 1 };
  const { service, state } = makeService({ catalogCourses: [course] });
  const incoming = (id, body) => ({ id, from: '243821234567', type: 'text', text: { body } });
  await service.processInboundMessage(incoming('wamid.selected', 'Anglais général'));
  assert.equal(state.messages[1].deliveryStatus, 'QUEUED');
  await service.processInboundMessage(incoming('wamid.human', 'conseiller'));
  assert.equal(state.messages[1].deliveryStatus, 'CANCELLED');
  assert.equal(state.conversations[0].controlState, 'HUMAN_TAKEOVER');
  assert.equal(state.conversations[0].engineState.selectedCourseId, 11);
  const result = await service.processInboundMessage(incoming('wamid.paused', 'prix'));
  assert.equal(result.queuedResponses, 0); assert.equal(state.conversations[0].engineState.selectedCourseId, 11);
});

test('normalise le contenu entrant sans conserver le payload Meta brut', () => {
  assert.equal(messageTypeForProvider('text'), 'TEXT');
  assert.equal(messageTypeForProvider('image'), 'MEDIA');
  assert.equal(messageTypeForProvider('interactive'), 'INTERACTIVE');
  assert.equal(inboundText({ interactive: { button_reply: { title: 'Formations' } } }), 'Formations');
  assert.equal(inboundText({ image: { caption: 'ignored as text' } }), '');
});

test('persiste entrant, état moteur et réponse en attente dans le même traitement', async () => {
  const { service, state } = makeService();
  const result = await service.processInboundMessage({
    id: 'wamid.in.1', from: '243821234567', timestamp: '1791547200', type: 'text', text: { body: 'Bonjour' },
  });
  assert.equal(result.queuedResponses, 1);
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].controlState, 'BOT_ACTIVE');
  assert.equal(state.conversations[0].engineState.processedMessageIds.includes('wamid.in.1'), true);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].processingStatus, 'PROCESSED');
  assert.equal(state.messages[1].direction, 'OUTBOUND');
  assert.equal(state.messages[1].deliveryStatus, 'QUEUED');
  assert.equal(state.messages[1].idempotencyKey, 'wa-reply:wamid.in.1:0');
});

test('déduplique un message Meta répété sans créer une nouvelle réponse', async () => {
  const { service, state } = makeService();
  const message = { id: 'wamid.duplicate', from: '243821234567', type: 'text', text: { body: 'Bonjour' } };
  await service.processInboundMessage(message);
  const repeated = await service.processInboundMessage(message);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.queuedResponses, 0);
  assert.equal(state.messages.length, 2);
});

test('conserve l’heure fournisseur d’un webhook retardé séparément de l’activité locale', async () => {
  const { service, state } = makeService();
  const oldTime = new Date('2026-10-08T10:00:00Z');
  await service.processInboundMessage({ id: 'wamid.delayed', from: '243821234567', timestamp: String(oldTime.getTime() / 1000), type: 'text', text: { body: 'Bonjour' } });
  assert.equal(state.messages[0].providerTimestamp.getTime(), oldTime.getTime());
  assert.equal(state.messages[0].receivedAt.toISOString(), '2026-10-09T12:00:00.000Z');
  assert.equal(state.conversations[0].lastMessageAt.toISOString(), '2026-10-09T12:00:00.000Z');
});

test('un horodatage absent ou futur ne devient pas une heure fournisseur locale', async () => {
  for (const timestamp of [undefined, 'invalid', String(new Date('2026-10-10T12:00:00Z').getTime() / 1000)]) {
    const { service, state } = makeService();
    await service.processInboundMessage({ id: 'wamid.timestamp', from: '243821234567', timestamp, type: 'text', text: { body: 'Bonjour' } });
    assert.equal(state.messages[0].providerTimestamp, null);
    assert.equal(state.messages[0].processingStatus, 'PROCESSED');
  }
});

test('enregistre STOP comme retrait commercial et place la conversation en opt-out', async () => {
  const { service, state } = makeService();
  const result = await service.processInboundMessage({ id: 'wamid.stop', from: '243821234567', type: 'text', text: { body: 'ARRET' } });
  assert.equal(result.queuedResponses, 0);
  assert.equal(state.conversations[0].controlState, 'OPTED_OUT');
  assert.equal(state.consents.length, 1);
  assert.equal(state.consents[0].decision, 'REVOKED');
  assert.equal(state.consents[0].evidenceProviderMessageId, 'wamid.stop');
  assert.ok(state.followUpCancellationReasons.includes('CONSENT_WITHDRAWN'));
});

test('un message entrant ordinaire ne vaut pas consentement aux relances commerciales', async () => {
  const { service, state } = makeService();
  await service.processInboundMessage({ id: 'wamid.prospect', from: '243821234567', type: 'text', text: { body: 'Je veux connaître les formations' } });
  assert.doesNotMatch(state.messages[1].body, /OUI RELANCES/);
  assert.equal(state.consents.some((event) => event.decision === 'GRANTED'), false);
  assert.equal(state.consents.length, 0);
});

test('le prospect accepte uniquement après une demande explicite et les deux rappels sont dédupliqués', async () => {
  const { service, state } = makeService({ templatesConfigured: true });
  await service.processInboundMessage({ id: 'wamid.interest', from: '243821234567', type: 'text', text: { body: 'Je veux apprendre l’anglais' } });
  assert.match(state.messages[1].body, /OUI RELANCES/);
  assert.equal(state.consents.length, 0);

  const grant = await service.processInboundMessage({ id: 'wamid.grant', from: '243821234567', type: 'text', text: { body: 'OUI RELANCES' } });
  assert.equal(grant.queuedResponses, 1);
  assert.equal(state.consents.length, 1);
  assert.equal(state.consents[0].decision, 'GRANTED');
  assert.equal(state.consents[0].scope, 'COMMERCIAL_FOLLOW_UPS');
  assert.equal(state.consents[0].evidenceProviderMessageId, 'wamid.grant');
  assert.deepEqual(state.followUps.map((item) => item.sequenceHours), [24, 72]);
});

test('persiste la prise en charge humaine et permet une reprise explicite', async () => {
  const { service, state } = makeService();
  const handoff = await service.processInboundMessage({
    id: 'wamid.handoff', from: '243821234567', type: 'text', text: { body: 'Je veux parler à un conseiller' },
  });
  assert.equal(handoff.queuedResponses, 1);
  assert.equal(state.messages[1].messageType, 'SYSTEM');
  assert.equal(state.messages[1].idempotencyKey, 'wa-handoff:wamid.handoff:0');
  const repeated = await service.processInboundMessage({ id: 'wamid.handoff', from: '243821234567', type: 'text', text: { body: 'conseiller' } });
  assert.equal(repeated.duplicate, true);
  assert.equal(state.messages.filter(message => message.idempotencyKey === 'wa-handoff:wamid.handoff:0').length, 1);
  assert.equal(state.conversations[0].controlState, 'HUMAN_TAKEOVER');
  assert.ok(state.followUpCancellationReasons.includes('HUMAN_TAKEOVER'));
  const duringHandoff = await service.processInboundMessage({
    id: 'wamid.during', from: '243821234567', type: 'text', text: { body: 'Bonjour' },
  });
  assert.equal(duringHandoff.queuedResponses, 0);
  assert.equal(state.messages.length, 3);

  const resumed = await service.resumeAutomation(state.conversations[0].id);
  assert.equal(resumed.controlState, 'BOT_ACTIVE');
  assert.equal(resumed.engineState.automationPaused, false);
});


test('scenario reply payload and stable inbound click survive persistence and native deduplication',async()=>{
 const {client,state}=memoryClient(),{randomUUID}=require('node:crypto');
 const scenario={id:randomUUID(),revision:1,enabled:true,triggers:['menu'],definition:{entry:'start',nodes:[{id:'start',type:'button',body:'NVA',options:[{id:randomUUID(),label:'Information',action:{type:'GOTO',nodeId:'info'}}]},{id:'info',type:'text',body:'Réponse officielle',next:{type:'END'}}]}};
 // The existing mock transaction shares these model objects by reference.
 const original=client.$transaction;client.$transaction=work=>original(tx=>work({...tx,whatsAppScenario:{findMany:async()=>[scenario]},whatsAppChatbotSettings:{findUnique:async()=>({enabled:true})}}));
 const service=createWhatsAppConversationService({client,catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},followUps:{cancelForConversation:async()=>{}},followUpConfig:()=>({})});
 await service.processInboundMessage({id:'wamid.start-menu',from:'243821234567',type:'text',text:{body:'menu'}});
 const outbound=state.messages.find(m=>m.direction==='OUTBOUND');assert.equal(outbound.messageType,'INTERACTIVE');assert.ok(outbound.interactivePayload);
 const wireId=outbound.interactivePayload.action.buttons[0].reply.id;
 state.conversations[0].engineState=JSON.parse(JSON.stringify(state.conversations[0].engineState));
 const click={id:'wamid.click-menu',from:'243821234567',type:'interactive',interactive:{button_reply:{id:wireId,title:'Changed display label'}}};
 await service.processInboundMessage(click);
 assert.equal(state.messages.at(-1).body,'Réponse officielle');assert.equal(state.messages.find(m=>m.providerMessageId===click.id).interactivePayload.button_reply.id,wireId);
 const duplicate=await service.processInboundMessage(click);assert.equal(duplicate.duplicate,true);
});


test('historical ingress commits QUESTION_AI fallback before post-commit completion',async t=>{
 const {client,state}=memoryClient();let inside=false,calls=0;const transaction=client.$transaction;
 state.conversations.push({id:1,phoneNumber:'+243821234567',controlState:'BOT_ACTIVE',engineState:{mode:'QUESTION_AI',questionAIStartedAt:'2026-10-26T00:00:00Z'}});
 client.$transaction=async work=>{inside=true;try{return await transaction(tx=>work({...tx,whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}}))}finally{inside=false}};
 const completion=require('../src/services/whatsappQuestionAICompletionService');
 t.mock.method(completion,'createQuestionAICompletionService',()=>({completeReply:async key=>{assert.equal(inside,false);assert.equal(key,'wa-reply:wamid.defer:0');assert.equal(state.messages.find(m=>m.direction==='OUTBOUND').failureCode,'QUESTION_AI_PENDING');calls++;}}));
 const service=createWhatsAppConversationService({client,env:{NVA_AI_ENABLED:'true'},catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},followUpConfig:()=>({})});
 const incoming={id:'wamid.defer',from:'243821234567',type:'text',text:{body:'une question inconnue'}};
 await service.processInboundMessage(incoming);assert.equal(calls,1);await service.processInboundMessage(incoming);assert.equal(calls,1);
});

test('welcome marker survives service reconstruction and duplicate first delivery',async t=>{
 const {client,state}=memoryClient();const transaction=client.$transaction;
 client.$transaction=work=>transaction(tx=>work({...tx,whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}}));
 const completion=require('../src/services/whatsappQuestionAICompletionService');
 t.mock.method(completion,'createQuestionAICompletionService',()=>({completeReply:async()=>({skipped:true})}));
 const make=()=>createWhatsAppConversationService({client,env:{NVA_AI_ENABLED:'true'},catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},followUpConfig:()=>({})});
 const first={id:'wamid.welcome.persist',from:'243821234567',type:'text',text:{body:'Comment débuter ?'}};
 await make().processInboundMessage(first);assert.ok(state.conversations[0].engineState.welcomeSentAt);
 assert.equal(state.messages.filter(m=>m.direction==='OUTBOUND').length,1);
 assert.equal((await make().processInboundMessage(first)).duplicate,true);
 await make().processInboundMessage({...first,id:'wamid.welcome.next',text:{body:'Bonjour'}});
 const replies=state.messages.filter(m=>m.direction==='OUTBOUND');assert.equal(replies.length,2);assert.equal(replies[1].failureCode,'QUESTION_AI_PENDING');
 assert.ok(state.conversations[0].engineState.welcomeSentAt);
});


test('confirmed admission action uses the original conversation transaction and native deduplication',async t=>{
 const {client,state}=memoryClient();state.conversations.push({id:1,phoneNumber:'+243821234567',controlState:'BOT_ACTIVE',engineState:{admission:{step:'REVIEW',expiresAt:'2100-01-01',draft:{fullName:'Marie Kalala',phoneNumber:'+243821234567',email:'synthetic@example.test',requestedLevel:'BEGINNER',consentToCollect:true},options:[{id:'confirm',value:'confirm',wireId:'adm:confirm:synthetic'}]}}});
 const original=client.$transaction;client.$transaction=work=>original(tx=>work({...tx,whatsAppChatbotSettings:{findUnique:async()=>({enabled:true,admissionsEnabled:true})}}));
 const admissions=require('../src/services/whatsappAdmissionService');const record=t.mock.method(admissions,'recordConfirmed',async(tx,input)=>{assert.equal(tx.$transaction,undefined);assert.equal(input.conversationId,1);assert.equal(input.data.fullName,'Marie Kalala');return {id:1}});
 const service=createWhatsAppConversationService({client,catalog:{listPublished:async()=>[]},registration:{listCoursesForPublicRegistration:async()=>[]},followUpConfig:()=>({})});
 const message={id:'wamid.admission-confirm',from:'243821234567',type:'interactive',interactive:{button_reply:{id:'adm:confirm:synthetic',title:'CONFIRMER'}}};
 await service.processInboundMessage(message);assert.equal(record.mock.callCount(),1);assert.deepEqual(state.conversations[0].engineState.admission.draft,{});await service.processInboundMessage(message);assert.equal(record.mock.callCount(),1);
});
