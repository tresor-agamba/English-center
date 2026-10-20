const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const routes = require('../src/routes/adminWhatsAppRoutes');
const csrf = require('../src/middlewares/csrfProtection');
const human = require('../src/services/whatsappHumanHandoffService');
const admin = require('../src/services/whatsappConversationAdminService');

async function harness(t, behavior = async () => ({ message: { id: 1 } })) {
  const old = { NODE_ENV: process.env.NODE_ENV, CSRF_ENFORCE: process.env.CSRF_ENFORCE };
  process.env.NODE_ENV = 'test'; process.env.CSRF_ENFORCE = 'true';
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const queue = t.mock.method(human, 'queueManualReply', behavior);
  t.mock.method(admin, 'get', async () => ({ id: 7 }));
  const app = express(); app.use(express.urlencoded({ extended: false }));
  const store = new session.MemoryStore();
  app.use(session({ secret: 'isolated-session-secret-for-tests-only', resave: false, saveUninitialized: false, store }));
  // Test-only login does not exist in the production router.
  app.post('/test-login', (req, res) => {
    req.session.user = { id: 1 }; req.session.actor = { id: 1, role: req.body.role || 'ADMIN', isActive: req.body.active !== 'false', mustChangePassword: false };
    res.sendStatus(200);
  });
  app.use((req, res, next) => { req.authenticatedUser = req.session.actor; res.render = (view, locals) => res.json({ error: locals.manualError, body: locals.messageBody, simulation: locals.simulation }); next(); });
  app.use(csrf.protect);
  app.get('/test-csrf', (req, res) => res.json({ token: req.session.csrfToken }));
  app.use('/admin/whatsapp', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => new Promise(resolve => store.clear(resolve)));
  let cookie = '';
  async function request(path, method = 'GET', data) {
    const body = data ? new URLSearchParams(data).toString() : '';
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => {
          if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
          let output = ''; res.on('data', chunk => { output += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: output }));
        });
      req.on('error', reject); req.end(body);
    });
  }
  return { request, queue, async login(role = 'ADMIN', active = 'true') {
    await request('/test-login', 'POST', { role, active });
    return JSON.parse((await request('/test-csrf')).body).token;
  } };
}
test('HTTP manual reply refuses an unauthenticated session before calling queue', async t => {
  const h = await harness(t); const token = JSON.parse((await h.request('/test-csrf')).body).token;
  const result = await h.request('/admin/whatsapp/conversations/7/reply', 'POST', { _csrf: token, message: 'test' });
  assert.equal(result.status, 302); assert.equal(result.headers.location, '/login'); assert.equal(h.queue.mock.callCount(), 0);
});
test('HTTP manual reply refuses non-admin and inactive administrators', async t => {
  const h = await harness(t);
  for (const [role, active] of [['STUDENT', 'true'], ['ADMIN', 'false']]) {
    const token = await h.login(role, active);
    assert.equal((await h.request('/admin/whatsapp/conversations/7/reply', 'POST', { _csrf: token, message: 'test' })).status, 403);
  }
  assert.equal(h.queue.mock.callCount(), 0);
});
test('HTTP manual reply requires a valid CSRF token, including in test mode', async t => {
  const h = await harness(t); await h.login();
  for (const data of [{ message: 'test' }, { message: 'test', _csrf: 'wrong' }]) {
    assert.equal((await h.request('/admin/whatsapp/conversations/7/reply', 'POST', data)).status, 403);
  }
  assert.equal(h.queue.mock.callCount(), 0);
});
test('HTTP authorized reply queues with authenticated actor and redirects after POST', async t => {
  const h = await harness(t); const token = await h.login();
  const result = await h.request('/admin/whatsapp/conversations/7/reply', 'POST', { _csrf: token, message: 'Bonjour', submissionId: 'test-id', senderUserId: '2' });
  assert.equal(result.status, 303); assert.equal(result.headers.location, '/admin/whatsapp/conversations/7?action=queued');
  assert.deepEqual(h.queue.mock.calls[0].arguments, [7, 1, 'Bonjour', 'test-id']);
});
test('HTTP rejected body keeps understandable validation error on the conversation page', async t => {
  const h = await harness(t, async () => { throw Object.assign(new Error('Le message ne peut pas être vide.'), { statusCode: 400, code: 'WHATSAPP_HUMAN_ACTION_REFUSED' }); });
  const token = await h.login();
  const result = await h.request('/admin/whatsapp/conversations/7/reply', 'POST', { _csrf: token, message: '' });
  assert.equal(result.status, 400); assert.equal(JSON.parse(result.body).error, 'Le message ne peut pas être vide.');
  assert.equal(result.headers['cache-control'], 'no-store');
});


test('chatbot administration protects reads, writes and simulations with admin and CSRF', async t => {
 const h=await harness(t);
 assert.equal((await h.request('/admin/whatsapp/chatbot')).status,302);
 for(const role of ['STUDENT','TEACHER']) {
  const token=await h.login(role);
  assert.equal((await h.request('/admin/whatsapp/chatbot')).status,403);
  assert.equal((await h.request('/admin/whatsapp/chatbot/messages/rules','POST',{_csrf:token})).status,403);
  assert.equal((await h.request('/admin/whatsapp/chatbot/overview/simulate','POST',{_csrf:token,text:'bonjour'})).status,403);
 }
 await h.login();
 for(const path of ['/admin/whatsapp/chatbot/settings','/admin/whatsapp/chatbot/messages/rules','/admin/whatsapp/chatbot/rules/1/delete','/admin/whatsapp/chatbot/overview/simulate'])
  assert.equal((await h.request(path,'POST',{})).status,403);
});

test('authorized chatbot CRUD validates and persists only permitted fields',async t=>{
 const db=require('../src/utils/prisma');const h=await harness(t);const token=await h.login();
 const create=t.mock.method(db.whatsAppChatbotRule,'create',async()=>({id:1}));
 t.mock.method(db.whatsAppChatbotRule,'count',async()=>0);
 t.mock.method(db.whatsAppChatbotRule,'findMany',async()=>[]);
 t.mock.method(db.whatsAppChatbotSettings,'findUnique',async()=>null);
 t.mock.method(db.whatsAppChatbotAiBudget,'findUnique',async()=>null);
 const path='/admin/whatsapp/chatbot/messages/rules';
 assert.equal((await h.request(path,'POST',{_csrf:token,kind:'MESSAGE',title:'Accueil',triggers:'hello',body:'Bienvenue',priority:'4',enabled:'on',secret:'ignored'})).status,303);
 assert.equal(create.mock.calls[0].arguments[0].data.secret,undefined);
 assert.equal((await h.request(path,'POST',{_csrf:token,kind:'MESSAGE',title:'',triggers:'hello',body:'test',priority:'4'})).status,400);
 assert.equal(create.mock.callCount(),1);
});


test('scenario editor and clickable simulator enforce administrator authorization and CSRF',async t=>{
 const h=await harness(t);assert.equal((await h.request('/admin/whatsapp/chatbot/scenarios')).headers.location,'/login');
 const student=await h.login('STUDENT');assert.equal((await h.request('/admin/whatsapp/chatbot/scenarios')).status,403);
 assert.equal((await h.request('/admin/whatsapp/chatbot/scenarios/simulate','POST',{_csrf:student})).status,403);
 await h.login();for(const path of ['/admin/whatsapp/chatbot/scenarios/save','/admin/whatsapp/chatbot/scenarios/simulate'])assert.equal((await h.request(path,'POST',{})).status,403);
});


test('scenario simulator persists test state across clicks without writing business data',async t=>{
 const db=require('../src/utils/prisma'),{randomUUID}=require('node:crypto');const h=await harness(t);const token=await h.login();
 const scenario={id:randomUUID(),revision:1,title:'Draft',priority:0,enabled:false,triggers:['menu'],definition:{entry:'start',nodes:[{id:'start',type:'button',body:'Menu de test',options:[{id:randomUUID(),label:'Conseiller',action:{type:'HANDOFF'}}]}]}};
 t.mock.method(db.whatsAppScenario,'findMany',async()=>[scenario]);
 const start=await h.request('/admin/whatsapp/chatbot/scenarios/simulate','POST',{_csrf:token,reset:'on',scenarioId:scenario.id,prospect:'on'});assert.equal(start.status,303);
 const first=JSON.parse((await h.request('/admin/whatsapp/chatbot/scenarios')).body).simulation;
 assert.equal(first.interactive.type,'button');
 const id=first.interactive.action.buttons[0].reply.id;
 assert.equal((await h.request('/admin/whatsapp/chatbot/scenarios/simulate','POST',{_csrf:token,interactionId:id})).status,303);
 const next=JSON.parse((await h.request('/admin/whatsapp/chatbot/scenarios')).body).simulation;
 assert.equal(next.state.automationPaused,true);assert.deepEqual(next.history.at(-1).actions,['HUMAN_HANDOFF']);
 // Every unmocked Prisma write is rejected by the isolation guard.
});

test('scenario saves detect concurrent edits instead of overwriting them',async t=>{
 const db=require('../src/utils/prisma'),{randomUUID}=require('node:crypto');const h=await harness(t);const token=await h.login();
 t.mock.method(db.whatsAppScenario,'findMany',async()=>[]);const update=t.mock.method(db.whatsAppScenario,'updateMany',async()=>({count:0}));
 const definition={entry:'start',nodes:[{id:'start',type:'text',body:'Official answer',next:{type:'END'}}]};
 const result=await h.request('/admin/whatsapp/chatbot/scenarios/save','POST',{_csrf:token,id:randomUUID(),revision:'1',title:'NVA',triggers:'menu',priority:'0',definition:JSON.stringify(definition)});
 assert.equal(result.status,409);assert.equal(update.mock.callCount(),1);assert.equal(update.mock.calls[0].arguments[0].where.revision,1);
});
